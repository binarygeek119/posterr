const axios = require("axios");
const { URL } = require("url");
const mediaCard = require("./../cards/MediaCard");
const cType = require("./../cards/CardType");
const util = require("./../core/utility");
const core = require("./../core/cache");
const { CardTypeEnum } = require("./../cards/CardType");
const EmbyJellyfinBase = require("./embyJellyfinBase");

/**
 * Kodi JSON-RPC over HTTP (Settings → Services → Control → Allow remote control via HTTP).
 * Reuses plexIP / plexPort / plexHTTPS / plexToken:
 * - plexToken empty = no auth; or "password" (user defaults to kodi); or "username:password".
 */
class Kodi {
  constructor({ plexHTTPS, plexIP, plexPort, plexToken }) {
    this.https = plexHTTPS === true || plexHTTPS === "true";
    this.host = plexIP;
    this.port = String(plexPort);
    const auth = Kodi.parseAuth(plexToken);
    this.authUser = auth.username;
    this.authPass = auth.password;
    this._rpcId = 1;
  }

  static parseAuth(token) {
    if (token === undefined || token === null || String(token).trim() === "") {
      return { username: "", password: "" };
    }
    const s = String(token).trim();
    const i = s.indexOf(":");
    if (i === -1) {
      return { username: "kodi", password: s };
    }
    return { username: s.slice(0, i).trim() || "kodi", password: s.slice(i + 1) };
  }

  baseUrl() {
    return `${this.https ? "https" : "http"}://${this.host}:${this.port}`;
  }

  jsonRpcUrl() {
    return `${this.baseUrl()}/jsonrpc`;
  }

  axiosConfig() {
    const cfg = {
      headers: { "Content-Type": "application/json" },
      timeout: 60000,
    };
    if (this.authUser !== "" || this.authPass !== "") {
      cfg.auth = {
        username: this.authUser || "kodi",
        password: this.authPass || "",
      };
    }
    return cfg;
  }

  async rpc(method, params = {}) {
    const body = {
      jsonrpc: "2.0",
      method,
      params,
      id: this._rpcId++,
    };
    const res = await axios.post(this.jsonRpcUrl(), body, this.axiosConfig());
    if (res.data && res.data.error) {
      const e = res.data.error;
      throw new Error((e.message || e.data || "") + " (" + method + ")");
    }
    return res.data.result;
  }

  /** Image URL for CacheImage (optional HTTP basic auth embedded). */
  vfsImageUrl(vfsPath) {
    if (!vfsPath) return null;
    const path = this.baseUrl() + "/image/" + encodeURIComponent(vfsPath);
    if (!this.authUser && !this.authPass) return path;
    try {
      const u = new URL(path);
      u.username = this.authUser || "kodi";
      u.password = this.authPass || "";
      return u.toString();
    } catch (e) {
      return path;
    }
  }

  posterFromItem(it) {
    if (!it) return null;
    if (it.thumbnail) return it.thumbnail;
    if (it.art) {
      if (it.art.poster) return it.art.poster;
      if (it.art.thumb) return it.art.thumb;
    }
    return null;
  }

  fanartFromItem(it) {
    if (!it || !it.art) return null;
    return it.art.fanart || it.fanart || null;
  }

  static timeToSeconds(t) {
    if (!t || typeof t !== "object") return 0;
    return (
      (t.hours || 0) * 3600 +
      (t.minutes || 0) * 60 +
      (t.seconds || 0) +
      (t.milliseconds || 0) / 1000
    );
  }

  static genresToArray(genre) {
    if (!genre) return [];
    if (Array.isArray(genre)) return genre;
    return String(genre)
      .split(/[\/,]/)
      .map((g) => g.trim())
      .filter(Boolean);
  }

  async GetVideoSources() {
    const r = await this.rpc("Files.GetSources", { media: "video" });
    return r.sources || [];
  }

  async GetNowScreeningRawData() {
    return this.rpc("Player.GetActivePlayers", {});
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
    let players;
    try {
      players = await this.GetNowScreeningRawData();
    } catch (err) {
      const now = new Date();
      console.log(now.toLocaleString() + " *Now Scrn. - Kodi GetActivePlayers: " + err);
      throw err;
    }

    if (!Array.isArray(players) || players.length === 0) {
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

    const excludePaths = [];
    const exArr = Array.isArray(excludeLibs)
      ? excludeLibs.map((x) => (x || "").trim().toLowerCase()).filter(Boolean)
      : excludeLibs
        ? String(excludeLibs)
            .split(",")
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean)
        : [];
    if (exArr.length > 0) {
      const srcList = await this.GetVideoSources();
      for (const name of exArr) {
        const src = srcList.find((s) => (s.label || "").toLowerCase() === name);
        if (src && src.file) {
          excludePaths.push(String(src.file).toLowerCase());
        }
      }
    }

    const itemProps = [
      "title",
      "album",
      "artist",
      "showtitle",
      "season",
      "episode",
      "thumbnail",
      "fanart",
      "plot",
      "mpaa",
      "genre",
      "runtime",
      "file",
      "rating",
      "tvshowid",
      "art",
      "label",
    ];
    const playProps = [
      "percentage",
      "time",
      "totaltime",
      "repeat",
      "shuffled",
      "position",
      "live",
    ];

    for (const p of players) {
      if (p.type === "picture") continue;

      let itemRes;
      let propRes;
      try {
        itemRes = await this.rpc("Player.GetItem", {
          playerid: p.playerid,
          properties: itemProps,
        });
        propRes = await this.rpc("Player.GetProperties", {
          playerid: p.playerid,
          properties: playProps,
        });
      } catch (err) {
        const now = new Date();
        console.log(now.toLocaleString() + " *Now Scrn. - Kodi player detail: " + err);
        continue;
      }

      const item = itemRes && itemRes.item;
      if (!item || !item.type) continue;

      const type = item.type;
      if (type !== "movie" && type !== "episode" && type !== "song") continue;

      const medCard = new mediaCard();
      const totalSec = Kodi.timeToSeconds(propRes.totaltime);
      const posSec = Kodi.timeToSeconds(propRes.time);
      const runTicks = totalSec > 0 ? totalSec : 1;
      medCard.runTime = Math.round(totalSec / 60);
      medCard.progress = Math.round(posSec / 60);
      medCard.progressPercent =
        propRes.percentage != null && !isNaN(propRes.percentage)
          ? Math.round(propRes.percentage)
          : Math.round((posSec / runTicks) * 100);
      medCard.runDuration = Math.round(totalSec / 60) / 100;
      medCard.runProgress = Math.round(posSec / 60) / 100;

      medCard.playerLocal = true;
      medCard.playerDevice = "Kodi";
      medCard.playerIP = this.host || "";
      if (hideUser !== "true") {
        medCard.user = "";
        medCard.device = "Kodi";
      }

      let contentRating = "NR";
      if (!(await util.isEmpty(item.mpaa))) {
        contentRating = String(item.mpaa).replace(/^Rated\s+/i, "").trim() || "NR";
      }
      medCard.contentRating = contentRating;
      medCard.ratingColour = EmbyJellyfinBase.ratingColour(contentRating);
      medCard.genre = await util.emptyIfNull(Kodi.genresToArray(item.genre));
      medCard.summary = item.plot || "";

      const ratingVal = parseFloat(item.rating);
      if (!isNaN(ratingVal) && ratingVal > 0) {
        medCard.rating =
          ratingVal <= 10
            ? Math.round(ratingVal * 10) + "%"
            : Math.round(ratingVal * 20) + "%";
      } else {
        medCard.rating = "";
      }

      const posterVfs = this.posterFromItem(item);
      const safeName = (item.title || item.label || "kodi")
        .replace(/[^a-zA-Z0-9]/g, "")
        .slice(0, 40);
      const posterFile = `${p.playerid}-${safeName}-${item.id || "x"}.jpg`.replace(
        /\.\./g,
        ""
      );

      if (type === "song") {
        medCard.title = item.title || item.label || "";
        medCard.tagLine = [item.artist, item.album, item.title].filter(Boolean).join(" — ");
        const a = item.artist;
        medCard.albumArtist = Array.isArray(a)
          ? a.filter(Boolean).join(", ")
          : a || "";
        medCard.mediaType = "track";
        medCard.cardType = cType.CardTypeEnum.NowScreening;
        medCard.resCodec = "";
        medCard.audioCodec = "";
        if (posterVfs) {
          const url = this.vfsImageUrl(posterVfs);
          if (url) await core.CacheImage(url, posterFile);
          medCard.posterURL = "/imagecache/" + posterFile;
        }
        if (hasArt === "true") {
          const fan = this.fanartFromItem(item);
          if (fan) {
            const artFile = posterFile.replace(/\.jpg$/, "-art.jpg");
            try {
              await core.CacheImage(this.vfsImageUrl(fan), artFile);
              medCard.posterArtURL = "/imagecache/" + artFile;
            } catch (e) {
              /* optional */
            }
          }
        }
        medCard.posterAR = 1;
      } else if (type === "episode") {
        medCard.title = item.showtitle || "";
        medCard.episodeName = item.title || "";
        const sn = item.season != null ? item.season : "?";
        const en = item.episode != null ? item.episode : "?";
        medCard.tagLine =
          (item.showtitle || "") +
          ", S" +
          sn +
          "E" +
          en +
          " — '" +
          (item.title || "") +
          "'";
        medCard.mediaType = "episode";
        medCard.DBID = String(item.id != null ? item.id : safeName);
        medCard.cardType = cType.CardTypeEnum.NowScreening;
        if (posterVfs) {
          const url = this.vfsImageUrl(posterVfs);
          if (url) await core.CacheImage(url, posterFile);
          medCard.posterURL = "/imagecache/" + posterFile;
        }
        if (hasArt === "true") {
          const fan = this.fanartFromItem(item);
          if (fan) {
            const artFile = posterFile.replace(/\.jpg$/, "-art.jpg");
            try {
              await core.CacheImage(this.vfsImageUrl(fan), artFile);
              medCard.posterArtURL = "/imagecache/" + artFile;
            } catch (e) {
              /* optional */
            }
          }
        }
        medCard.posterAR = 1.5;
        medCard.resCodec = "";
        medCard.audioCodec = "";
      } else if (type === "movie") {
        medCard.title = item.title || item.label || "";
        medCard.tagLine = medCard.title;
        medCard.mediaType = "movie";
        medCard.DBID = String(item.id != null ? item.id : safeName);
        medCard.cardType = cType.CardTypeEnum.NowScreening;
        if (posterVfs) {
          const url = this.vfsImageUrl(posterVfs);
          if (url) await core.CacheImage(url, posterFile);
          medCard.posterURL = "/imagecache/" + posterFile;
        }
        if (hasArt === "true") {
          const fan = this.fanartFromItem(item);
          if (fan) {
            const artFile = posterFile.replace(/\.jpg$/, "-art.jpg");
            try {
              await core.CacheImage(this.vfsImageUrl(fan), artFile);
              medCard.posterArtURL = "/imagecache/" + artFile;
            } catch (e) {
              /* optional */
            }
          }
        }
        medCard.posterAR = 1.5;
        medCard.resCodec = "";
        medCard.audioCodec = "";
      }

      medCard.decision = "direct";

      let okToAdd = false;
      if (filterRemote == "true" && medCard.playerLocal === false) okToAdd = true;
      if (filterLocal == "true" && medCard.playerLocal === true) okToAdd = true;

      if (users.length > 0 && users[0] !== "") okToAdd = false;
      if (devices.length > 0 && devices[0] !== "") {
        const dn = (medCard.playerDevice || "").toLowerCase();
        if (!devices.includes(dn)) okToAdd = false;
      }

      if (excludePaths.length > 0 && item.file) {
        const fp = String(item.file).toLowerCase();
        if (excludePaths.some((prefix) => fp.startsWith(prefix))) {
          okToAdd = false;
        }
      }

      if (okToAdd) {
        nsCards.push(medCard);
      }
    }

    return nsCards;
  }

  async getMoviesForPath(pathPrefix, limits) {
    const props = [
      "title",
      "genre",
      "year",
      "rating",
      "plot",
      "mpaa",
      "runtime",
      "thumbnail",
      "fanart",
      "file",
      "art",
      "dateadded",
    ];
    const lim = limits || { start: 0, end: 20000 };
    try {
      const r = await this.rpc("VideoLibrary.GetMovies", {
        properties: props,
        limits: lim,
        filter: {
          field: "path",
          operator: "startswith",
          value: pathPrefix,
        },
      });
      return (r && r.movies) || [];
    } catch (e) {
      const r = await this.rpc("VideoLibrary.GetMovies", {
        properties: props,
        limits: lim,
      });
      const movies = (r && r.movies) || [];
      const norm = pathPrefix.toLowerCase();
      return movies.filter((m) => (m.file || "").toLowerCase().startsWith(norm));
    }
  }

  async getShowsForPath(pathPrefix, limits) {
    const props = [
      "title",
      "genre",
      "year",
      "rating",
      "plot",
      "mpaa",
      "thumbnail",
      "fanart",
      "file",
      "art",
      "studio",
      "dateadded",
    ];
    const lim = limits || { start: 0, end: 20000 };
    try {
      const r = await this.rpc("VideoLibrary.GetTVShows", {
        properties: props,
        limits: lim,
        filter: {
          field: "path",
          operator: "startswith",
          value: pathPrefix,
        },
      });
      return (r && r.tvshows) || [];
    } catch (e) {
      const r = await this.rpc("VideoLibrary.GetTVShows", {
        properties: props,
        limits: lim,
      });
      const shows = (r && r.tvshows) || [];
      const norm = pathPrefix.toLowerCase();
      return shows.filter((m) => (m.file || "").toLowerCase().startsWith(norm));
    }
  }

  async GetLibraryKeys(onDemandLibraries) {
    if (!onDemandLibraries || onDemandLibraries.length === 0) {
      onDemandLibraries = " ";
    }
    const sources = await this.GetVideoSources();
    const keys = [];
    const names = onDemandLibraries
      .split(",")
      .map((v) => v.trim().toLowerCase())
      .filter(Boolean);

    for (const want of names) {
      const found = sources.find((s) => (s.label || "").toLowerCase() === want);
      if (found) {
        keys.push({ file: found.file, label: found.label });
      } else {
        const d = new Date();
        console.log(
          d.toLocaleString() +
            " ✘✘ WARNING ✘✘ - On-demand library '" +
            want +
            "' not found (Kodi video source label)"
        );
      }
    }
    return keys;
  }

  filterKodiItems(items, genres, recentlyAdded, contentRatings) {
    let all = items.slice();

    if (recentlyAdded > 0) {
      const from = new Date();
      from.setDate(from.getDate() - recentlyAdded);
      from.setHours(0, 0, 0, 0);
      all = all.filter((m) => {
        if (!m.dateadded) return false;
        const dt = new Date(m.dateadded.replace(/ /, "T"));
        return !isNaN(dt.getTime()) && dt >= from;
      });
    } else {
      if (genres && genres.length > 0) {
        const mapGenre = (arr, gs) =>
          gs.reduce((acc, val) => {
            const valLower = (val || "").toLowerCase();
            const libMatches = arr.filter((m) => {
              const glist = Kodi.genresToArray(m.genre);
              return glist.some((g) => g.toLowerCase().includes(valLower));
            });
            if (libMatches.length > 0) return acc.concat(libMatches);
            return acc;
          }, []);
        const matched = mapGenre(all, genres);
        const byId = new Map();
        for (const m of matched) {
          if (m._kodiKind === "show" && m.tvshowid != null) {
            byId.set("s" + m.tvshowid, m);
          } else if (m._kodiKind === "movie" && m.movieid != null) {
            byId.set("m" + m.movieid, m);
          } else {
            byId.set(String(m.title) + (m.file || ""), m);
          }
        }
        all = Array.from(byId.values());
      }

      if (contentRatings && contentRatings.length > 0) {
        const exclude = new Set();
        for (const m of all) {
          const cr = (m.mpaa || "").toLowerCase().replace(/^rated\s+/i, "").trim();
          if (contentRatings.some((r) => r.toLowerCase() === cr)) {
            exclude.add(m);
          }
        }
        all = all.filter((m) => !exclude.has(m));
      }
    }

    return all;
  }

  async GetAllMediaForSource(entry, genres, recentlyAdded, contentRatings) {
    const movies = await this.getMoviesForPath(entry.file);
    const shows = await this.getShowsForPath(entry.file);
    const tagged = [
      ...movies.map((m) => {
        m._kodiKind = "movie";
        m._kodiLabel = entry.label;
        return m;
      }),
      ...shows.map((m) => {
        m._kodiKind = "show";
        m._kodiLabel = entry.label;
        return m;
      }),
    ];
    return this.filterKodiItems(tagged, genres, recentlyAdded, contentRatings);
  }

  async GetOnDemandRawData(onDemandLibraries, numberOnDemand, genres, recentlyAdded, contentRating) {
    const odSet = [];
    try {
      const libEntries = await this.GetLibraryKeys(onDemandLibraries);
      for (const entry of libEntries) {
        const result = await this.GetAllMediaForSource(
          entry,
          genres,
          recentlyAdded,
          contentRating
        );
        const od = await util.build_random_od_set(numberOnDemand, result, recentlyAdded);
        for (const odc of od) {
          odc.ctype =
            recentlyAdded > 0 ? CardTypeEnum.RecentlyAdded : CardTypeEnum.OnDemand;
          odSet.push(odc);
        }
      }
    } catch (err) {
      const now = new Date();
      console.log(now.toLocaleString() + " *On-demand - Get library keys (Kodi): " + err);
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
      const now = new Date();
      console.log(now.toLocaleString() + " *On-demand - Get raw data (Kodi): " + err);
      throw err;
    }

    if (JSON.stringify(odRaw) === "[null,null]") {
      odRaw = [];
    }

    if (!odRaw || odRaw.length === 0) {
      const now = new Date();
      if (onDemandLibraries && String(onDemandLibraries).trim()) {
        console.log(
          now.toLocaleString() +
            " *On-demand - No results returned - check Kodi source labels or filters"
        );
      }
      return odCards;
    }

    for (const md of odRaw) {
      const medCard = new mediaCard();
      const kind = md._kodiKind;

      if (kind === "show") {
        medCard.tagLine = md.title || "";
        const id = md.tvshowid != null ? md.tvshowid : md.title;
        const mediaId = String(id).replace(/[^a-zA-Z0-9]/g, "");
        medCard.DBID = mediaId;
        medCard.theme = "";
        const ratingVal = parseFloat(md.rating);
        medCard.rating =
          !isNaN(ratingVal) && ratingVal > 0
            ? (ratingVal <= 10
                ? Math.round(ratingVal * 10)
                : Math.round(ratingVal * 20)) + "%"
            : "";
        const posterVfs = this.posterFromItem(md);
        const fileName = `kodi-show-${mediaId}.jpg`;
        if (posterVfs) {
          const url = this.vfsImageUrl(posterVfs);
          if (url) await core.CacheImage(url, fileName);
          medCard.posterURL = "/imagecache/" + fileName;
        }
        if (hasArt === "true") {
          const fan = this.fanartFromItem(md);
          if (fan) {
            const artName = `kodi-show-${mediaId}-art.jpg`;
            try {
              await core.CacheImage(this.vfsImageUrl(fan), artName);
              medCard.posterArtURL = "/imagecache/" + artName;
            } catch (e) {
              /* optional */
            }
          }
        }
        medCard.posterAR = 1.47;
        medCard.runTime =
          md.runtime != null ? Math.round(md.runtime / 60) : 0;
        medCard.title = md.title || "";
        medCard.mediaType = "show";
      } else if (kind === "movie") {
        const mid = md.movieid != null ? md.movieid : md.title;
        const movieFileName = `kodi-movie-${String(mid).replace(/[^a-zA-Z0-9]/g, "")}.jpg`;
        const posterVfs = this.posterFromItem(md);
        if (posterVfs) {
          const url = this.vfsImageUrl(posterVfs);
          if (url) await core.CacheImage(url, movieFileName);
          medCard.posterURL = "/imagecache/" + movieFileName;
        }
        if (hasArt === "true") {
          const fan = this.fanartFromItem(md);
          if (fan) {
            const artName = movieFileName.replace(/\.jpg$/, "-art.jpg");
            try {
              await core.CacheImage(this.vfsImageUrl(fan), artName);
              medCard.posterArtURL = "/imagecache/" + artName;
            } catch (e) {
              /* optional */
            }
          }
        }
        medCard.posterAR = 1.47;
        medCard.theme = "";
        medCard.title = md.title || "";
        medCard.runTime =
          md.runtime != null ? Math.round(md.runtime / 60) : 0;
        medCard.resCodec = "";
        medCard.audioCodec = "";
        medCard.tagLine = medCard.title;
        const ratingVal = parseFloat(md.rating);
        medCard.rating =
          !isNaN(ratingVal) && ratingVal > 0
            ? (ratingVal <= 10
                ? Math.round(ratingVal * 10)
                : Math.round(ratingVal * 20)) + "%"
            : "";
        medCard.mediaType = "movie";
      } else {
        continue;
      }

      const studioVal = Array.isArray(md.studio) ? md.studio[0] : md.studio;
      if (!(await util.isEmpty(studioVal))) {
        medCard.studio = studioVal;
      }

      if (medCard.tagLine === "") medCard.tagLine = medCard.title;

      let contentRating = "NR";
      if (!(await util.isEmpty(md.mpaa))) {
        contentRating = String(md.mpaa).replace(/^Rated\s+/i, "").trim() || "NR";
      }
      medCard.contentRating = contentRating;
      medCard.ratingColour = EmbyJellyfinBase.ratingColour(contentRating);

      medCard.year = md.year;
      medCard.genre = await util.emptyIfNull(Kodi.genresToArray(md.genre));
      medCard.summary = md.plot || "";
      medCard.cardType = md.ctype;

      odCards.push(medCard);
    }

    const now = new Date();
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
   * Debug / health: sample titles from first video source (parity with Plex / Jellyfin tests).
   */
  async fetchSampleTitlesFromFirstLibrary(limit = 5) {
    const sources = await this.GetVideoSources();
    if (sources.length === 0) {
      return {
        ok: false,
        message: "No Kodi video sources found (Files.GetSources)",
        titles: [],
        libraryName: "",
        totalLibraries: 0,
      };
    }
    const first = sources[0];
    const pathPrefix = first.file || "";
    let titles = [];
    const movies = await this.getMoviesForPath(pathPrefix, { start: 0, end: limit });
    titles = (movies || []).map((m) => m.title || "(unnamed)");
    if (titles.length === 0) {
      const shows = await this.getShowsForPath(pathPrefix, { start: 0, end: limit });
      titles = (shows || []).map((m) => m.title || "(unnamed)");
    }
    return {
      ok: true,
      libraryName: first.label || "",
      collectionType: "video",
      titles: titles.slice(0, limit),
      totalLibraries: sources.length,
    };
  }
}

module.exports = Kodi;
