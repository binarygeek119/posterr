const axios = require("axios");
const mediaCard = require("./../cards/MediaCard");
const cType = require("./../cards/CardType");
const util = require("./../core/utility");
const core = require("./../core/cache");
const { CardTypeEnum } = require("./../cards/CardType");

/**
 * Jellyfin and Emby share the same REST surface (X-Emby-Token / api_key).
 * Connection fields reuse Plex-oriented setting names (plexIP, plexPort, plexToken, plexHTTPS).
 */
class JellyfinEmby {
  constructor({ plexHTTPS, plexIP, plexPort, plexToken }) {
    this.https = plexHTTPS === true || plexHTTPS === "true";
    this.host = plexIP;
    this.port = String(plexPort);
    this.apiKey = plexToken;
    this._userId = null;
  }

  baseUrl() {
    return `${this.https ? "https" : "http"}://${this.host}:${this.port}`;
  }

  async apiGet(path, options = {}) {
    const params = { api_key: this.apiKey, ...(options.params || {}) };
    const url = this.baseUrl() + path;
    const res = await axios.get(url, {
      params,
      headers: { "X-Emby-Token": this.apiKey },
      timeout: 60000,
    });
    return res.data;
  }

  async getUserId() {
    if (this._userId) return this._userId;
    const me = await this.apiGet("/Users/Me");
    this._userId = me.Id;
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

  static endpointLooksLocal(remoteEndPoint) {
    if (!remoteEndPoint || typeof remoteEndPoint !== "string") return true;
    const ip = remoteEndPoint.split(":")[0];
    if (/^192\.168\./.test(ip)) return true;
    if (/^10\./.test(ip)) return true;
    if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(ip)) return true;
    if (ip === "127.0.0.1" || ip === "::1") return true;
    return false;
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
    let sessions;
    try {
      sessions = await this.GetNowScreeningRawData();
    } catch (err) {
      let now = new Date();
      console.log(now.toLocaleString() + " *Now Scrn. - Get sessions: " + err);
      throw err;
    }

    if (!Array.isArray(sessions)) {
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

    for (const session of sessions) {
      const item = session.NowPlayingItem;
      if (!item || !item.Type) continue;

      const type = item.Type;
      if (type !== "Episode" && type !== "Movie" && type !== "Audio") continue;

      const medCard = new mediaCard();
      let transcode = "direct";
      const { resCodec, audioCodec } = JellyfinEmby.pickStreams(item);
      const runTicks = item.RunTimeTicks || 1;
      const posTicks = (session.PlayState && session.PlayState.PositionTicks) || 0;
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
      medCard.ratingColour = JellyfinEmby.ratingColour(contentRating);

      if (hideUser !== "true") {
        medCard.user = session.UserName || "";
        medCard.device = session.DeviceName || "";
      }

      const localPlayer = JellyfinEmby.endpointLooksLocal(session.RemoteEndPoint);
      medCard.playerDevice = session.Client || session.DeviceName || "";
      medCard.playerIP = session.RemoteEndPoint || "";
      medCard.playerLocal = localPlayer;

      medCard.genre = await util.emptyIfNull(item.Genres);
      medCard.summary = item.Overview || "";

      if (type === "Audio") {
        medCard.title = item.Name || "";
        medCard.tagLine = [item.AlbumArtist, item.Album, item.Name].filter(Boolean).join(" — ");
        medCard.mediaType = "track";
        medCard.cardType = cType.CardTypeEnum.Playing;
        medCard.resCodec = item.Bitrate ? `${Math.round(item.Bitrate / 1000)} Kbps` : resCodec;
        medCard.audioCodec = audioCodec;
        medCard.rating = "";
        const posterFile = `${safeId || mediaId}.jpg`;
        await core.CacheImage(this.primaryImageUrl(item.Id, item.ImageTags && item.ImageTags.Primary), posterFile);
        medCard.posterURL = "/imagecache/" + posterFile;
        medCard.posterAR = 1;
      } else if (type === "Episode") {
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
        await core.CacheImage(this.primaryImageUrl(imgId, seriesTag), posterFile);
        medCard.posterURL = "/imagecache/" + posterFile;

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
      } else if (type === "Movie") {
        medCard.title = item.Name || "";
        medCard.tagLine = await util.emptyIfNull(item.Taglines && item.Taglines[0]);
        medCard.mediaType = "movie";
        medCard.DBID = String(mediaId);

        const posterFile = `${item.Id}.jpg`.replace(/[^a-zA-Z0-9._-]/g, "_");
        await core.CacheImage(
          this.primaryImageUrl(item.Id, item.ImageTags && item.ImageTags.Primary),
          posterFile
        );
        medCard.posterURL = "/imagecache/" + posterFile;

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

      medCard.studio =
        item.Studios && item.Studios[0] && item.Studios[0].Name
          ? item.Studios[0].Name
          : "";

      medCard.decision = transcode;

      let okToAdd = false;
      if (filterRemote == "true" && medCard.playerLocal === false) okToAdd = true;
      if (filterLocal == "true" && medCard.playerLocal === true) okToAdd = true;
      if (users.length > 0 && users[0] !== "") {
        const un = (session.UserName || "").toLowerCase();
        if (!users.includes(un)) okToAdd = false;
      }
      if (devices.length > 0 && devices[0] !== "") {
        const dn = (medCard.playerDevice || "").toLowerCase();
        if (!devices.includes(dn)) okToAdd = false;
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
    }

    return nsCards;
  }

  includeItemTypesForCollection(collectionType) {
    const t = (collectionType || "").toLowerCase();
    if (t === "movies") return "Movie";
    if (t === "tvshows") return "Series";
    if (t === "music") return "MusicAlbum";
    return "Movie,Series";
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
    const fetchChunk = async (types) =>
      this.apiGet(`/Users/${userId}/Items`, {
        params: {
          ParentId: first.Id,
          Recursive: true,
          IncludeItemTypes: types,
          Limit: limit,
          StartIndex: 0,
          SortBy: "SortName",
        },
      });

    let itemsData = await fetchChunk(includeTypes);
    let raw = itemsData.Items || [];
    if (raw.length === 0 && includeTypes !== "Movie,Series") {
      itemsData = await fetchChunk("Movie,Series");
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

    const baseParams = {
      ParentId: libEntry.id,
      Recursive: true,
      IncludeItemTypes: includeTypes,
      Fields:
        "PrimaryImageTag,BackdropImageTags,Overview,Genres,OfficialRating,CommunityRating,Studios,ProductionYear,RunTimeTicks,DateCreated,ImageTags,Taglines,ProviderIds,SeriesName,ParentIndexNumber",
    };

    let all = [];
    let start = 0;
    const limit = 200;
    while (true) {
      const chunk = await this.apiGet(`/Users/${userId}/Items`, {
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
      console.log(now.toLocaleString() + " *On-demand - Get library keys: " + err);
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
      medCard.ratingColour = JellyfinEmby.ratingColour(contentRating);

      medCard.year = md.ProductionYear;
      medCard.genre = await util.emptyIfNull(md.Genres);
      medCard.summary = md.Overview || "";
      medCard.cardType = md.ctype;

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
}

module.exports = JellyfinEmby;
