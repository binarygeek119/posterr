const axios = require("axios");
const mediaCard = require("./../cards/MediaCard");
const cType = require("./../cards/CardType");
const util = require("./../core/utility");
const core = require("./../core/cache");
const { CardTypeEnum } = require("./../cards/CardType");

/**
 * Shared Emby/Jellyfin REST client (X-Emby-Token / api_key).
 * Use {@link ../jellyfin} or {@link ../emby} as the media-server plugin; do not wire this base in the factory.
 * Connection fields reuse Plex-oriented setting names (plexIP, plexPort, plexToken, plexHTTPS).
 */
class EmbyJellyfinBase {
  constructor({ plexHTTPS, plexIP, plexPort, plexToken }) {
    this.https = plexHTTPS === true || plexHTTPS === "true";
    this.host = typeof plexIP === "string" ? plexIP.trim() : plexIP;
    this.port = String(plexPort == null ? "" : plexPort).trim();
    this.apiKey = typeof plexToken === "string" ? plexToken.trim() : plexToken;
    this._userId = null;
  }

  /** @returns {"Jellyfin"|"Emby"} — overridden by plugin subclasses */
  get appName() {
    return "Jellyfin";
  }

  baseUrl() {
    return `${this.https ? "https" : "http"}://${this.host}:${this.port}`;
  }

  /**
   * Jellyfin binds IncludeItemTypes / SortBy etc. from repeated keys or comma-separated values.
   * Axios default array encoding uses brackets (IncludeItemTypes[]=Movie), which can yield HTTP 400 with empty ProblemDetails.
   */
  static splitCsvTypes(csv) {
    if (csv == null || csv === "") return [];
    return String(csv)
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
  }

  _serializeQueryParams(params) {
    const parts = [];
    for (const key of Object.keys(params)) {
      const v = params[key];
      if (v === undefined || v === null) continue;
      const encKey = encodeURIComponent(key);
      if (Array.isArray(v)) {
        for (const item of v) {
          if (item === undefined || item === null) continue;
          parts.push(encKey + "=" + encodeURIComponent(String(item)));
        }
      } else if (typeof v === "boolean") {
        parts.push(encKey + "=" + (v ? "true" : "false"));
      } else {
        parts.push(encKey + "=" + encodeURIComponent(String(v)));
      }
    }
    return parts.join("&");
  }

  async apiGet(path, options = {}) {
    const params = { ...(options.params || {}) };
    const timeoutMs =
      options.timeoutMs != null ? Number(options.timeoutMs) : 60000;
    const maxRetries =
      options.maxRetries != null ? Number(options.maxRetries) : 0;
    const qs = this._serializeQueryParams(params);
    const url = qs ? `${this.baseUrl() + path}?${qs}` : this.baseUrl() + path;
    let attempt = 0;
    while (true) {
      try {
        const res = await axios.get(url, {
          headers: { "X-Emby-Token": this.apiKey },
          timeout: timeoutMs,
        });
        return res.data;
      } catch (e) {
        const isTimeout =
          e.code === "ECONNABORTED" ||
          String(e.message || "").toLowerCase().includes("timeout");
        if (isTimeout && attempt < maxRetries) {
          attempt++;
          continue;
        }
        const d = e.response && e.response.data;
        if (d != null) {
          const s = typeof d === "string" ? d : JSON.stringify(d);
          e.message += " | " + String(s).slice(0, 500);
        }
        e.message += " | GET " + path;
        throw e;
      }
    }
  }

  /**
   * Jellyfin GET /Users/Me returns 400 when the token is an API key with no associated user
   * (User.GetUserId() is empty). Library calls still need a real user GUID — use GET /Users and pick one.
   */
  async getUserId() {
    if (this._userId) return this._userId;
    try {
      const me = await this.apiGet("/Users/Me");
      if (me && me.Id) {
        this._userId = me.Id;
        return this._userId;
      }
    } catch (e) {
      /* fall through */
    }
    const list = await this.apiGet("/Users");
    const users = Array.isArray(list) ? list : [];
    if (users.length === 0) {
      throw new Error(
        `${this.appName}: GET /Users returned no users; cannot resolve a user id for on-demand/library calls. Check API key permissions.`
      );
    }
    const admin = users.find((u) => u.Policy && u.Policy.IsAdministrator);
    const pick = admin || users[0];
    if (!pick || !pick.Id) {
      throw new Error(
        `${this.appName}: could not read user Id from GET /Users response.`
      );
    }
    this._userId = pick.Id;
    return this._userId;
  }

  /**
   * @param {Map} cache — item Id → root library display name (for exclude-libraries)
   */
  async resolvePlayingLibraryName(userId, itemId, cache) {
    if (!itemId || !userId) return "";
    if (cache.has(itemId)) return cache.get(itemId);
    try {
      const data = await this.apiGet(
        `/Users/${userId}/Items/${encodeURIComponent(itemId)}/Ancestors`
      );
      const list = Array.isArray(data) ? data : data && data.Items ? data.Items : [];
      let libName = "";
      for (const a of list) {
        if (a.CollectionType) {
          libName = a.Name || "";
          break;
        }
      }
      if (!libName && list.length > 0) {
        libName = list[list.length - 1].Name || "";
      }
      cache.set(itemId, libName);
      return libName;
    } catch (e) {
      cache.set(itemId, "");
      return "";
    }
  }

  primaryImageUrl(itemId, tag) {
    const t = tag ? `&tag=${encodeURIComponent(tag)}` : "";
    return `${this.baseUrl()}/Items/${itemId}/Images/Primary?api_key=${encodeURIComponent(
      this.apiKey
    )}${t}`;
  }

  backdropImageUrl(itemId, index = 0) {
    return `${this.baseUrl()}/Items/${itemId}/Images/Backdrop/${index}?api_key=${encodeURIComponent(
      this.apiKey
    )}`;
  }

  /**
   * Cache a primary image using multiple Jellyfin id/tag candidates.
   * Returns web path or empty string when all candidates fail.
   */
  async cachePrimaryImageAny(candidates, fileName) {
    const seen = new Set();
    for (const c of candidates || []) {
      if (!c || !c.id) continue;
      const key = String(c.id) + "|" + String(c.tag || "");
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        await core.CacheImage(this.primaryImageUrl(c.id, c.tag || null), fileName);
        return "/imagecache/" + fileName;
      } catch (e) {
        /* try next candidate */
      }
    }
    return "";
  }

  /**
   * Jellyfin RemoteEndPoint may be IPv4:port, [IPv6]:port, hostname, or blank (treat as local).
   * Hostnames on LAN were previously misclassified as "remote" (breaking Now Screening when only Local was enabled).
   */
  static endpointLooksLocal(remoteEndPoint) {
    if (!remoteEndPoint || typeof remoteEndPoint !== "string") return true;
    const raw = remoteEndPoint.trim();
    let host = raw;
    if (raw.startsWith("[") && raw.includes("]")) {
      host = raw.slice(1, raw.indexOf("]"));
    } else {
      const lastColon = raw.lastIndexOf(":");
      const firstColon = raw.indexOf(":");
      if (lastColon > firstColon) {
        const maybeIp = raw.slice(0, lastColon);
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(maybeIp)) host = maybeIp;
      }
    }
    const h = host.toLowerCase();
    if (h === "127.0.0.1" || h === "::1" || h === "localhost") return true;
    if (h.startsWith("fe80:") || h.startsWith("fc") || h.startsWith("fd")) return true;
    if (/^192\.168\./.test(host)) return true;
    if (/^10\./.test(host)) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return true;
    if (h.endsWith(".local") || h.endsWith(".lan") || h.endsWith(".home.arpa")) return true;
    if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(host) && !host.includes(":")) {
      if (!host.includes(".")) return true;
    }
    return false;
  }

  /** True if Jellyfin reports a Primary image tag (cover/poster) for this item. */
  static hasPrimaryImage(item) {
    if (!item) return false;
    const tags = item.ImageTags || item.imageTags;
    if (!tags || typeof tags !== "object") return false;
    const p = tags.Primary ?? tags.primary;
    return p !== undefined && p !== null && String(p).length > 0;
  }

  /** Match Jellyfin Client / DeviceName against comma-separated filter (substring, case-insensitive). */
  static sessionDeviceMatchesFilter(session, playerDeviceLabel, wantedDevices) {
    if (!wantedDevices || wantedDevices.length === 0 || !wantedDevices[0]) return true;
    const blobs = [session.Client, session.DeviceName, playerDeviceLabel]
      .filter(Boolean)
      .map((s) => String(s).toLowerCase());
    return wantedDevices.some((want) => {
      const w = String(want).toLowerCase().trim();
      if (!w) return false;
      return blobs.some((b) => b === w || b.includes(w) || w.includes(b));
    });
  }

  static pickStreams(item) {
    const ms = item.MediaSources && item.MediaSources[0];
    if (!ms || !ms.MediaStreams) return { resCodec: "", audioCodec: "" };
    const video = ms.MediaStreams.find((s) => s.Type === "Video");
    const audio = ms.MediaStreams.find((s) => s.Type === "Audio");
    let resCodec = "";
    if (video) {
      const res = video.Width && video.Height ? `${video.Width}x${video.Height} ` : "";
      resCodec = (res + (video.Codec || "")).trim();
    }
    let audioCodec = "";
    if (audio) {
      const ch = audio.ChannelLayout || audio.Channels || "";
      audioCodec = `${(audio.Codec || "").toUpperCase()} ${ch}`.trim();
    }
    return { resCodec, audioCodec };
  }

  static ratingColour(contentRating) {
    let cr = (contentRating || "NR").toLowerCase();
    let ratingColour = "badge-dark";
    switch (cr) {
      case "nr":
      case "unrated":
        ratingColour = "badge-dark";
        break;
      case "g":
      case "tv-g":
      case "tv-y":
        ratingColour = "badge-success";
        break;
      case "pg":
      case "tv-pg":
      case "tv-y7":
        ratingColour = "badge-info";
        break;
      case "pg-13":
      case "tv-14":
        ratingColour = "badge-warning";
        break;
      case "tv-ma":
      case "r":
      case "nc-17":
        ratingColour = "badge-danger";
        break;
      default:
        ratingColour = "badge-dark";
    }
    return ratingColour;
  }

  async GetNowScreeningRawData() {
    return this.apiGet("/Sessions");
  }

  async GetNowScreening(
    playThemes,
    playGenenericThemes,
    hasArt,
    filterRemote,
    filterLocal,
    filterDevices,
    filterUsers,
    hideUser,
    excludeLibs
  ) {
    const nsCards = [];
    const fallbackCards = [];
    let sessions;
    try {
      sessions = await this.GetNowScreeningRawData();
    } catch (err) {
      let now = new Date();
      console.log(now.toLocaleString() + " *Now Scrn. - Get sessions: " + err);
      throw err;
    }

    const sessionList = Array.isArray(sessions)
      ? sessions
      : (sessions && sessions.Items) || [];
    if (!Array.isArray(sessionList) || sessionList.length === 0) {
      return nsCards;
    }

    const devices = (filterDevices || "")
      .toLowerCase()
      .replace(/, /g, ",")
      .replace(/ ,/g, ",")
      .replace(/,+$/, "")
      .split(",")
      .filter(Boolean);
    const users = (filterUsers || "")
      .toLowerCase()
      .replace(/, /g, ",")
      .replace(/ ,/g, ",")
      .replace(/,+$/, "")
      .split(",")
      .filter(Boolean);

    const libNameCache = new Map();
    let userIdForLibs = null;

    for (const session of sessionList) {
      try {
        const item = session.NowPlayingItem || session.nowPlayingItem;
        const rawType = item && (item.Type || item.type);
        const type = String(rawType || "");
        if (!item || !type) continue;

        const allowedTypes = new Set([
          "episode",
          "movie",
          "audio",
          "book",
          "audiobook",
        ]);
        if (!allowedTypes.has(type.toLowerCase())) continue;
        // Do not skip sessions just because image tags are missing.
        // Poster URL fallback/placeholder handling happens later.

      const medCard = new mediaCard();
      let transcode = "direct";
      const { resCodec, audioCodec } = EmbyJellyfinBase.pickStreams(item);
      const runTicks = item.RunTimeTicks || 1;
      const playState = session.PlayState || session.playState;
      const posTicks = (playState && playState.PositionTicks) || 0;
      const runMs = Math.floor(runTicks / 10000);
      const posMs = Math.floor(posTicks / 10000);

      medCard.runTime = Math.round(runMs / 60000);
      medCard.progress = Math.round(posMs / 60000);
      medCard.progressPercent = Math.round((posTicks / runTicks) * 100);
      medCard.runDuration = Math.round(runMs / 600) / 100;
      medCard.runProgress = Math.round(posMs / 600) / 100;

      const safeId = (item.Id || "").replace(/[^a-zA-Z0-9]/g, "");
      const tvdb =
        item.ProviderIds &&
        (item.ProviderIds.Tvdb || item.ProviderIds.tvdb || item.ProviderIds.Imdb);
      const mediaId = tvdb || safeId || "x";

      let contentRating = "NR";
      if (!(await util.isEmpty(item.OfficialRating))) {
        contentRating = item.OfficialRating;
      }
      medCard.contentRating = contentRating;
      medCard.ratingColour = EmbyJellyfinBase.ratingColour(contentRating);

      if (hideUser !== "true") {
        medCard.user = session.UserName || session.userName || "";
        medCard.device = session.DeviceName || session.deviceName || "";
      }

      const remoteEp = session.RemoteEndPoint || session.remoteEndPoint;
      const localPlayer = EmbyJellyfinBase.endpointLooksLocal(remoteEp);
      medCard.playerDevice = session.Client || session.client || session.DeviceName || session.deviceName || "";
      medCard.playerIP = remoteEp || "";
      medCard.playerLocal = localPlayer;

      medCard.genre = await util.emptyIfNull(item.Genres);
      medCard.summary = item.Overview || "";
      medCard.cast = util.formatCastFromEmbyPeople(item.People);
      medCard.directors = util.formatDirectorsFromEmbyPeople(item.People);

      if (type.toLowerCase() === "audio") {
        const albumName = ((item.Album || item.album || "") + "").trim();
        medCard.title = albumName || item.Name || "";
        medCard.tagLine = [item.AlbumArtist || item.albumArtist, item.Name]
          .filter(Boolean)
          .join(" — ");
        medCard.albumArtist = (
          (item.AlbumArtist || item.albumArtist || "") + ""
        ).trim();
        medCard.mediaType = "track";
        medCard.cardType = cType.CardTypeEnum.NowScreening;
        medCard.resCodec = item.Bitrate ? `${Math.round(item.Bitrate / 1000)} Kbps` : resCodec;
        medCard.audioCodec = audioCodec;
        medCard.rating = "";
        const posterFile = `${safeId || mediaId}.jpg`;
        const albumId = item.AlbumId || item.albumId;
        const albumTag =
          item.AlbumPrimaryImageTag || item.albumPrimaryImageTag;
        const trackTag =
          (item.ImageTags && item.ImageTags.Primary) ||
          (item.imageTags && item.imageTags.primary);
        let imgId = item.Id;
        let imgTag = trackTag;
        if (albumId) {
          imgId = albumId;
          if (albumTag) imgTag = albumTag;
        }
        const trackPoster = await this.cachePrimaryImageAny(
          [
            { id: imgId, tag: imgTag },
            { id: imgId, tag: null },
            { id: albumId, tag: albumTag },
            { id: albumId, tag: null },
            { id: item.ParentId || item.parentId, tag: null },
            { id: item.Id, tag: trackTag },
            { id: item.Id, tag: null },
          ],
          posterFile
        );
        medCard.posterURL = trackPoster || "/images/no-poster-available.png";
        medCard.posterAR = 1;
        if (hasArt === "true") {
          const albumIdBg = item.AlbumId || item.albumId;
          if (albumIdBg) {
            const artFile = `${safeId || mediaId}-album-art.jpg`.replace(
              /[^a-zA-Z0-9._-]/g,
              "_"
            );
            try {
              await core.CacheImage(
                this.backdropImageUrl(albumIdBg, 0),
                artFile
              );
              medCard.posterArtURL = "/imagecache/" + artFile;
            } catch (e) {
              /* optional backdrop */
            }
          }
        }
      } else if (
        type.toLowerCase() === "book" ||
        type.toLowerCase() === "audiobook"
      ) {
        medCard.title = item.Name || "";
        const byline = [item.AlbumArtist, item.SeriesName]
          .filter(Boolean)
          .join(" — ");
        medCard.tagLine =
          byline ||
          (Array.isArray(item.Genres) && item.Genres[0]) ||
          medCard.title;
        medCard.mediaType =
          type.toLowerCase() === "audiobook" ? "audiobook" : "ebook";
        medCard.authors = util.formatAuthorsFromEmbyBookItem(item);
        medCard.cardType = cType.CardTypeEnum.NowScreening;
        medCard.DBID = String(mediaId);
        medCard.rating =
          item.CommunityRating != null
            ? Math.round(item.CommunityRating * 10) + "%"
            : "";
        const posterFile = `${safeId || mediaId}.jpg`.replace(/[^a-zA-Z0-9._-]/g, "_");
        const primaryTag =
          (item.ImageTags && item.ImageTags.Primary) ||
          (item.imageTags && item.imageTags.primary);
        const bookPoster = await this.cachePrimaryImageAny(
          [
            { id: item.Id, tag: primaryTag },
            { id: item.Id, tag: null },
            { id: item.SeriesId || item.seriesId, tag: null },
          ],
          posterFile
        );
        medCard.posterURL = bookPoster || "/images/no-cover-available.png";
        medCard.posterAR = type === "AudioBook" ? 1 : 1.47;
        medCard.resCodec = resCodec;
        medCard.audioCodec = audioCodec;
        if (hasArt === "true") {
          const artFile = `${safeId || mediaId}-art.jpg`.replace(
            /[^a-zA-Z0-9._-]/g,
            "_"
          );
          try {
            await core.CacheImage(this.backdropImageUrl(item.Id, 0), artFile);
            medCard.posterArtURL = "/imagecache/" + artFile;
          } catch (e) {
            /* optional backdrop */
          }
        }
        const ms0 = item.MediaSources && item.MediaSources[0];
        if (ms0 && ms0.TranscodingUrl) transcode = "transcode";
      } else if (type.toLowerCase() === "episode") {
        medCard.episodeName = item.Name || "";
        medCard.title = item.SeriesName || "";
        const s = item.ParentIndexNumber != null ? item.ParentIndexNumber : "?";
        const e = item.IndexNumber != null ? item.IndexNumber : "?";
        medCard.tagLine =
          (item.SeriesName || "") +
          ", S" +
          s +
          "E" +
          e +
          " — '" +
          (item.Name || "") +
          "'";
        medCard.mediaType = "episode";
        medCard.DBID = String(mediaId);
        medCard.rating =
          item.CommunityRating != null
            ? Math.round(item.CommunityRating * 10) + "%"
            : "";

        const posterFile = `${mediaId}.jpg`;
        const imgId = item.SeriesId || item.Id;
        const seriesTag =
          item.SeriesPrimaryImageTag ||
          (item.ImageTags && item.ImageTags.Primary) ||
          "";
        const epPoster = await this.cachePrimaryImageAny(
          [
            { id: imgId, tag: seriesTag },
            { id: imgId, tag: null },
            { id: item.Id, tag: null },
          ],
          posterFile
        );
        medCard.posterURL = epPoster || "/images/no-poster-available.png";

        if (hasArt === "true" && item.SeriesId) {
          const artFile = `${mediaId}-art.jpg`;
          try {
            await core.CacheImage(this.backdropImageUrl(item.SeriesId, 0), artFile);
            medCard.posterArtURL = "/imagecache/" + artFile;
          } catch (e) {
            /* optional backdrop */
          }
        }
        medCard.posterAR = 1.5;
        medCard.resCodec = resCodec;
        medCard.audioCodec = audioCodec;
        medCard.cardType = cType.CardTypeEnum.NowScreening;

        const ms0 = item.MediaSources && item.MediaSources[0];
        if (ms0 && ms0.TranscodingUrl) transcode = "transcode";
      } else if (type.toLowerCase() === "movie") {
        medCard.title = item.Name || "";
        medCard.tagLine = await util.emptyIfNull(item.Taglines && item.Taglines[0]);
        medCard.mediaType = "movie";
        medCard.DBID = String(mediaId);

        const posterFile = `${item.Id}.jpg`.replace(/[^a-zA-Z0-9._-]/g, "_");
        const mvPoster = await this.cachePrimaryImageAny(
          [
            {
              id: item.Id,
              tag:
                (item.ImageTags && item.ImageTags.Primary) ||
                (item.imageTags && item.imageTags.primary),
            },
            { id: item.Id, tag: null },
          ],
          posterFile
        );
        medCard.posterURL = mvPoster || "/images/no-poster-available.png";

        if (hasArt === "true") {
          const artFile = `${item.Id}-art.jpg`.replace(/[^a-zA-Z0-9._-]/g, "_");
          try {
            await core.CacheImage(this.backdropImageUrl(item.Id, 0), artFile);
            medCard.posterArtURL = "/imagecache/" + artFile;
          } catch (e) {
            /* optional */
          }
        }
        medCard.posterAR = 1.5;
        medCard.rating =
          item.CommunityRating != null
            ? Math.round(item.CommunityRating * 10) + "%"
            : "";
        medCard.resCodec = resCodec;
        medCard.audioCodec = audioCodec;
        medCard.cardType = cType.CardTypeEnum.NowScreening;

        const ms0 = item.MediaSources && item.MediaSources[0];
        if (ms0 && ms0.TranscodingUrl) transcode = "transcode";
      }

      const portraitKey = String(item.Id || safeId || mediaId || "x").replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );
      await this.cacheItemPersonPortraits(medCard, item, portraitKey);
      fallbackCards.push(medCard);

      medCard.studio =
        item.Studios && item.Studios[0] && item.Studios[0].Name
          ? item.Studios[0].Name
          : "";

      medCard.decision = transcode;

      const wantRemote = filterRemote == "true";
      const wantLocal = filterLocal == "true";
      let okToAdd = false;
      if (!wantRemote && !wantLocal) {
        okToAdd = true;
      } else {
        if (wantRemote && medCard.playerLocal === false) okToAdd = true;
        if (wantLocal && medCard.playerLocal === true) okToAdd = true;
      }
      if (users.length > 0 && users[0] !== "") {
        const un = (session.UserName || session.userName || "").toLowerCase();
        if (!users.includes(un)) okToAdd = false;
      }
      if (devices.length > 0 && devices[0] !== "") {
        if (!EmbyJellyfinBase.sessionDeviceMatchesFilter(session, medCard.playerDevice, devices)) {
          okToAdd = false;
        }
      }
      if (excludeLibs !== undefined && excludeLibs !== null && excludeLibs !== "") {
        const excludedNames = Array.isArray(excludeLibs)
          ? excludeLibs.map((s) => (s || "").trim().toLowerCase()).filter(Boolean)
          : String(excludeLibs)
              .split(",")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean);
        if (excludedNames.length > 0 && item.Id) {
          if (!userIdForLibs) userIdForLibs = await this.getUserId();
          const playingLib = await this.resolvePlayingLibraryName(
            userIdForLibs,
            item.Id,
            libNameCache
          );
          if (
            playingLib &&
            excludedNames.includes(playingLib.toLowerCase())
          ) {
            okToAdd = false;
          }
        }
      }

        if (okToAdd) {
          nsCards.push(medCard);
        }
      } catch (sessionErr) {
        let now = new Date();
        console.log(
          now.toLocaleString() +
            " *Now Scrn. - Skip broken Jellyfin session: " +
            sessionErr
        );
      }
    }

    if (nsCards.length === 0 && fallbackCards.length > 0) {
      const now = new Date();
      console.log(
        now.toLocaleString() +
          " *Now Scrn. - All Jellyfin sessions filtered; using fallback unfiltered session cards"
      );
      return fallbackCards;
    }

    return nsCards;
  }

  includeItemTypesForCollection(collectionType) {
    const t = (collectionType || "").toLowerCase();
    if (t === "movies") return "Movie";
    if (t === "tvshows") return "Series";
    if (t === "music") return "MusicAlbum";
    if (t === "books" || t === "audiobooks") return "Book,AudioBook";
    // Unknown folder types: ask for all major cardable media kinds.
    return "Movie,Series,MusicAlbum,Book,AudioBook";
  }

  /**
   * Debug / health check: first N item names from the first media folder (parity with Plex OD test).
   */
  async fetchSampleTitlesFromFirstLibrary(limit = 5) {
    const userId = await this.getUserId();
    const data = await this.apiGet("/Library/MediaFolders");
    const folders = (data && data.Items) || [];
    if (folders.length === 0) {
      return {
        ok: false,
        message: "No media libraries found",
        titles: [],
        libraryName: "",
        totalLibraries: 0,
      };
    }
    const first = folders[0];
    const includeTypes = this.includeItemTypesForCollection(first.CollectionType);
    const fetchChunk = async (typesCsv) =>
      this.apiGet(`/Users/${userId}/Items`, {
        params: {
          ParentId: first.Id,
          Recursive: true,
          IncludeItemTypes: EmbyJellyfinBase.splitCsvTypes(typesCsv),
          Limit: limit,
          StartIndex: 0,
          SortBy: "SortName",
        },
      });

    let itemsData = await fetchChunk(includeTypes);
    let raw = itemsData.Items || [];
    if (
      raw.length === 0 &&
      includeTypes !== "Movie,Series,MusicAlbum,Book,AudioBook"
    ) {
      itemsData = await fetchChunk("Movie,Series,MusicAlbum,Book,AudioBook");
      raw = itemsData.Items || [];
    }
    const titles = raw.map((i) => i.Name || "(unnamed)");
    return {
      ok: true,
      libraryName: first.Name || "",
      collectionType: first.CollectionType || "",
      titles,
      totalLibraries: folders.length,
    };
  }

  async GetLibraryKeys(onDemandLibraries) {
    if (!onDemandLibraries || onDemandLibraries.length === 0) {
      onDemandLibraries = " ";
    }
    const data = await this.apiGet("/Library/MediaFolders");
    const folders = data.Items || [];
    const keys = [];
    const names = onDemandLibraries.split(",").map((v) => v.trim().toLowerCase()).filter(Boolean);

    for (const want of names) {
      let found = false;
      for (const lib of folders) {
        if ((lib.Name || "").toLowerCase() === want) {
          keys.push({ id: lib.Id, collectionType: lib.CollectionType, name: lib.Name });
          found = true;
          break;
        }
      }
      if (!found) {
        let d = new Date();
        console.log(
          d.toLocaleString() + " ✘✘ WARNING ✘✘ - On-demand library '" + want + "' not found"
        );
      }
    }
    return keys;
  }

  async GetAllMediaForLibrary(libEntry, genres, recentlyAdded, contentRatings) {
    const userId = await this.getUserId();
    const includeTypes = this.includeItemTypesForCollection(libEntry.collectionType);

    // Omit Fields: Jellyfin 10.9+ rejects legacy ItemFields names with HTTP 400; default DTO is enough for on-demand cards.
    const baseParams = {
      ParentId: libEntry.id,
      Recursive: true,
      IncludeItemTypes: EmbyJellyfinBase.splitCsvTypes(includeTypes),
      Fields: "People",
    };

    let all = [];
    let start = 0;
    // 100 keeps payload sizes moderate on large Jellyfin libraries.
    const limit = 100;
    while (true) {
      const chunk = await this.apiGet(`/Users/${userId}/Items`, {
        timeoutMs: 120000,
        maxRetries: 1,
        params: { ...baseParams, StartIndex: start, Limit: limit },
      });
      const items = chunk.Items || [];
      all = all.concat(items);
      if (items.length < limit) break;
      start += limit;
      if (start > 25000) break;
    }

    if (recentlyAdded > 0) {
      const from = new Date();
      from.setDate(from.getDate() - recentlyAdded);
      from.setHours(0, 0, 0, 0);
      all = all.filter((m) => m.DateCreated && new Date(m.DateCreated) >= from);
    } else {
      if (genres && genres.length > 0) {
        const mapGenre = (arr, gs) =>
          gs.reduce((acc, val) => {
            const valLower = (val || "").toLowerCase();
            const libMatches = arr.filter(
              (m) =>
                m.Genres &&
                m.Genres.some((g) =>
                  (g || "").toLowerCase().includes(valLower)
                )
            );
            if (libMatches.length > 0) return acc.concat(libMatches);
            return acc;
          }, []);
        const matched = mapGenre(all, genres);
        const byId = new Map();
        for (const m of matched) {
          if (m.Id) byId.set(m.Id, m);
        }
        all = Array.from(byId.values());
      }

      if (contentRatings && contentRatings.length > 0) {
        const exclude = new Set();
        for (const m of all) {
          const cr = (m.OfficialRating || "").toLowerCase();
          if (contentRatings.some((r) => r.toLowerCase() === cr)) {
            exclude.add(m);
          }
        }
        all = all.filter((m) => !exclude.has(m));
      }
    }

    return all;
  }

  async GetOnDemandRawData(onDemandLibraries, numberOnDemand, genres, recentlyAdded, contentRating) {
    let odSet = [];
    try {
      const libEntries = await this.GetLibraryKeys(onDemandLibraries);
      for (const entry of libEntries) {
        const result = await this.GetAllMediaForLibrary(
          entry,
          genres,
          recentlyAdded,
          contentRating
        );
        const od = await util.build_random_od_set(numberOnDemand, result, recentlyAdded);
        for (const odc of od) {
          odc.ctype =
            recentlyAdded > 0 ? CardTypeEnum.RecentlyAdded : CardTypeEnum.OnDemand;
          odc._jfLibraryName = entry.name;
          odSet.push(odc);
        }
      }
    } catch (err) {
      let now = new Date();
      console.log(
        now.toLocaleString() +
          " *On-demand - " +
          this.appName +
          " request failed: " +
          err
      );
      throw err;
    }
    return odSet;
  }

  async GetOnDemand(
    onDemandLibraries,
    numberOnDemand,
    playThemes,
    playGenenericThemes,
    hasArt,
    genres,
    recentlyAdded,
    contentRatings
  ) {
    let odCards = [];
    let odRaw;
    if (genres != undefined) {
      genres = genres
        .replace(/, /g, ",")
        .replace(/ ,/g, ",")
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);
    }
    if (contentRatings !== undefined) {
      contentRatings = contentRatings
        .replace(/, /g, ",")
        .replace(/ ,/g, ",")
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean);
    }

    try {
      if (recentlyAdded > 0) {
        odRaw = await this.GetOnDemandRawData(
          onDemandLibraries,
          numberOnDemand,
          genres,
          recentlyAdded,
          contentRatings
        );
        if (odRaw !== undefined) {
          odRaw = odRaw.concat(
            await this.GetOnDemandRawData(
              onDemandLibraries,
              numberOnDemand,
              genres,
              0,
              contentRatings
            )
          );
        } else {
          odRaw = await this.GetOnDemandRawData(
            onDemandLibraries,
            numberOnDemand,
            genres,
            0,
            contentRatings
          );
        }
      } else {
        odRaw = await this.GetOnDemandRawData(
          onDemandLibraries,
          numberOnDemand,
          genres,
          0,
          contentRatings
        );
      }
    } catch (err) {
      let now = new Date();
      console.log(now.toLocaleString() + " *On-demand - Get raw data: " + err);
      throw err;
    }

    if (JSON.stringify(odRaw) === "[null,null]") {
      odRaw = [];
    }

    if (!odRaw || odRaw.length === 0) {
      let now = new Date();
      if (onDemandLibraries && String(onDemandLibraries).trim()) {
        console.log(now.toLocaleString() + " *On-demand - No results returned - check library names or filters");
      }
      return odCards;
    }

    for (const md of odRaw) {
      const medCard = new mediaCard();
      const type = md.Type;

      if (type === "Series") {
        medCard.tagLine = md.Name || "";
        const mediaId = (md.Id || "").replace(/[^a-zA-Z0-9]/g, "");
        medCard.DBID = mediaId;
        medCard.theme = "";
        if (await util.isEmpty(md.CommunityRating)) {
          medCard.rating = "";
        } else {
          medCard.rating = Math.round(md.CommunityRating * 10) + "%";
        }
        const fileName = `${mediaId}.jpg`;
        await core.CacheImage(
          this.primaryImageUrl(md.Id, md.ImageTags && md.ImageTags.Primary),
          fileName
        );
        medCard.posterURL = "/imagecache/" + fileName;
        if (hasArt === "true") {
          const artName = `${mediaId}-art.jpg`;
          try {
            await core.CacheImage(this.backdropImageUrl(md.Id, 0), artName);
            medCard.posterArtURL = "/imagecache/" + artName;
          } catch (e) {
            /* optional */
          }
        }
        medCard.posterAR = 1.47;
        medCard.runTime = md.RunTimeTicks
          ? Math.round(md.RunTimeTicks / 6000000000)
          : 0;
        medCard.title = md.Name || "";
        medCard.mediaType = "show";
      } else if (type === "Movie") {
        const movieFileName = `${md.Id}.jpg`.replace(/[^a-zA-Z0-9._-]/g, "_");
        await core.CacheImage(
          this.primaryImageUrl(md.Id, md.ImageTags && md.ImageTags.Primary),
          movieFileName
        );
        medCard.posterURL = "/imagecache/" + movieFileName;
        if (hasArt === "true") {
          const artName = `${md.Id}-art.jpg`.replace(/[^a-zA-Z0-9._-]/g, "_");
          try {
            await core.CacheImage(this.backdropImageUrl(md.Id, 0), artName);
            medCard.posterArtURL = "/imagecache/" + artName;
          } catch (e) {
            /* optional */
          }
        }
        medCard.posterAR = 1.47;
        medCard.theme = "";
        medCard.title = md.Name || "";
        medCard.runTime = md.RunTimeTicks
          ? Math.round(md.RunTimeTicks / 6000000000)
          : 0;
        medCard.resCodec = "";
        medCard.audioCodec = "";
        medCard.tagLine = await util.emptyIfNull(md.Taglines && md.Taglines[0]);
        if (await util.isEmpty(md.CommunityRating)) {
          medCard.rating = "";
        } else {
          medCard.rating = Math.round(md.CommunityRating * 10) + "%";
        }
        medCard.mediaType = "movie";
      } else if (type === "MusicAlbum") {
        const albumFileName = `${md.Id}.jpg`.replace(/[^a-zA-Z0-9._-]/g, "_");
        medCard.DBID = (md.Id || "").replace(/[^a-zA-Z0-9]/g, "") || String(md.Id || "");
        const albumTag =
          (md.ImageTags && md.ImageTags.Primary) ||
          (md.imageTags && md.imageTags.primary) ||
          md.PrimaryImageTag ||
          md.primaryImageTag ||
          "";
        const albumPoster = await this.cachePrimaryImageAny(
          [
            { id: md.Id, tag: albumTag },
            { id: md.Id, tag: null },
            {
              id:
                md.AlbumArtists &&
                md.AlbumArtists[0] &&
                (md.AlbumArtists[0].Id || md.AlbumArtists[0].id),
              tag: null,
            },
          ],
          albumFileName
        );
        medCard.posterURL = albumPoster || "/images/no-poster-available.png";
        if (hasArt === "true") {
          const artName = `${md.Id}-art.jpg`.replace(/[^a-zA-Z0-9._-]/g, "_");
          try {
            await core.CacheImage(this.backdropImageUrl(md.Id, 0), artName);
            medCard.posterArtURL = "/imagecache/" + artName;
          } catch (e) {
            /* optional */
          }
        }
        medCard.posterAR = 1;
        medCard.theme = "";
        medCard.title = md.Name || "";
        const albumArtist =
          (md.AlbumArtist && String(md.AlbumArtist).trim()) ||
          (md.AlbumArtists &&
            md.AlbumArtists[0] &&
            (md.AlbumArtists[0].Name || md.AlbumArtists[0].name)) ||
          "";
        medCard.tagLine = albumArtist
          ? `${albumArtist} — ${medCard.title}`
          : medCard.title;
        medCard.albumArtist = albumArtist;
        medCard.runTime = md.RunTimeTicks
          ? Math.round(md.RunTimeTicks / 6000000000)
          : 0;
        medCard.resCodec = "";
        medCard.audioCodec = "";
        if (await util.isEmpty(md.CommunityRating)) {
          medCard.rating = "";
        } else {
          medCard.rating = Math.round(md.CommunityRating * 10) + "%";
        }
        medCard.mediaType = "album";
      } else {
        continue;
      }

      if (!(await util.isEmpty(md.Studios && md.Studios[0] && md.Studios[0].Name))) {
        medCard.studio = md.Studios[0].Name;
      }

      if (medCard.tagLine === "") medCard.tagLine = medCard.title;

      let contentRating = "NR";
      if (!(await util.isEmpty(md.OfficialRating))) {
        contentRating = md.OfficialRating;
      }
      medCard.contentRating = contentRating;
      medCard.ratingColour = EmbyJellyfinBase.ratingColour(contentRating);

      medCard.year = md.ProductionYear;
      medCard.genre = await util.emptyIfNull(md.Genres);
      medCard.summary = md.Overview || "";
      medCard.cast = util.formatCastFromEmbyPeople(md.People);
      medCard.directors = util.formatDirectorsFromEmbyPeople(md.People);
      medCard.cardType = md.ctype;

      const odPortraitKey = String(medCard.DBID || md.Id || "x").replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );
      await this.cacheItemPersonPortraits(medCard, md, odPortraitKey);

      odCards.push(medCard);
    }

    let now = new Date();
    if (odCards.length === 0) {
      console.log(now.toLocaleString() + " No On-demand titles available");
    } else {
      console.log(
        now.toLocaleString() + " On-demand titles refreshed (" + onDemandLibraries + ")"
      );
    }
    return odCards;
  }

  /**
   * Caches person primary images for display-poster settings (cast, director, author, album artist).
   * @param {object} medCard
   * @param {object} item - session NowPlayingItem or on-demand row
   * @param {string} safePrefix - safe cache filename prefix
   */
  async cacheItemPersonPortraits(medCard, item, safePrefix) {
    const safe = String(safePrefix || "x").replace(/[^a-zA-Z0-9._-]/g, "_");
    const people = item.People || item.people || [];

    const cachePerson = async (person, suffix) => {
      if (!person) return "";
      const pid = person.Id || person.id;
      if (!pid) return "";
      const tag =
        person.PrimaryImageTag ||
        person.primaryImageTag ||
        (person.ImageTags && person.ImageTags.Primary) ||
        (person.imageTags && person.imageTags.primary) ||
        "";
      const fn = `${safe}-${suffix}.jpg`;
      try {
        await core.CacheImage(this.primaryImageUrl(pid, tag || null), fn);
        return "/imagecache/" + fn;
      } catch (e) {
        return "";
      }
    };

    const actors = people.filter((p) => (p.Type || p.type || "") === "Actor");
    if (actors[0]) {
      medCard.portraitActorURL = await cachePerson(actors[0], "actor");
      medCard.featuredActorName = actors[0].Name || actors[0].name || "";
      medCard.featuredActorCredits = await this.getPersonCredits(
        actors[0].Id || actors[0].id,
        5
      );
    }
    let actressPerson = null;
    for (let i = 1; i < actors.length; i++) {
      const g = actors[i].Gender || actors[i].gender;
      if (g === "Female" || g === 1 || g === "1") {
        actressPerson = actors[i];
        break;
      }
    }
    if (!actressPerson && actors[1]) actressPerson = actors[1];
    if (actressPerson) {
      medCard.portraitActressURL = await cachePerson(actressPerson, "actress");
      medCard.featuredActressName =
        actressPerson.Name || actressPerson.name || "";
      medCard.featuredActressCredits = await this.getPersonCredits(
        actressPerson.Id || actressPerson.id,
        5
      );
    }

    const dirs = people.filter(
      (p) => (p.Type || p.type || "") === "Director"
    );
    if (dirs[0]) {
      medCard.portraitDirectorURL = await cachePerson(dirs[0], "director");
      medCard.featuredDirectorName = dirs[0].Name || dirs[0].name || "";
      medCard.featuredDirectorCredits = await this.getPersonCredits(
        dirs[0].Id || dirs[0].id,
        5
      );
    }

    const writers = people.filter((p) =>
      ["Writer", "Author"].includes(String(p.Type || p.type || ""))
    );
    if (writers[0]) {
      medCard.portraitAuthorURL = await cachePerson(writers[0], "author");
      medCard.featuredAuthorName = writers[0].Name || writers[0].name || "";
      medCard.featuredAuthorCredits = await this.getPersonCredits(
        writers[0].Id || writers[0].id,
        5,
        "Book,AudioBook,Series"
      );
    }

    const albumArtists = item.AlbumArtists || item.albumArtists;
    if (albumArtists && albumArtists[0]) {
      const aa = albumArtists[0];
      const pid = aa.Id || aa.id;
      medCard.featuredArtistName =
        aa.Name || aa.name || item.AlbumArtist || item.albumArtist || "";
      medCard.featuredArtistCredits = await this.getPersonCredits(
        pid,
        5,
        "MusicAlbum"
      );
      if (pid) {
        const tag =
          aa.PrimaryImageTag ||
          (aa.ImageTags && aa.ImageTags.Primary) ||
          "";
        const fn = `${safe}-artist.jpg`;
        try {
          await core.CacheImage(this.primaryImageUrl(pid, tag || null), fn);
          medCard.portraitArtistURL = "/imagecache/" + fn;
        } catch (e) {
          /* optional */
        }
      }
    }
  }

  /**
   * Returns up to `limit` Movie/Series titles for the person.
   */
  async getPersonCredits(personId, limit = 5, includeTypesCsv = "Movie,Series") {
    if (!personId) return [];
    try {
      const userId = await this.getUserId();
      const data = await this.apiGet(`/Users/${userId}/Items`, {
        params: {
          Recursive: true,
          PersonIds: personId,
          IncludeItemTypes: EmbyJellyfinBase.splitCsvTypes(includeTypesCsv),
          SortBy: "DateCreated",
          SortOrder: "Descending",
          Limit: limit,
        },
        timeoutMs: 120000,
      });
      const items = (data && data.Items) || [];
      return items
        .map((x) => x.Name || x.name || "")
        .filter(Boolean)
        .slice(0, limit);
    } catch (e) {
      return [];
    }
  }
}

module.exports = EmbyJellyfinBase;
