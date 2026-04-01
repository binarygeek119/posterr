const fs = require("fs");
const fsp = require("fs").promises;
const DEFAULT_SETTINGS = require("../../consts");
const util = require("../core/utility");
const ping = require("ping");
const pms = require("../mediaservers/plex");
const Kodi = require("../mediaservers/kodi");
const {
  getMediaServerClass,
  isJellyfinFamily,
  isKodi,
  getMediaServerShortLabel,
  usesPlexThemeHost,
} = require("../mediaservers/mediaServerFactory");
const axios = require("axios");

/**
 * @desc health object is used poster health checks
 * @returns {<object>} health
 */
class Health {
  constructor(settings) {
    // default values
    this.settings = settings;
    return;
  }

  async PlexNSCheck() {
    if (isJellyfinFamily(this.settings.mediaServerType)) {
      const Pms = getMediaServerClass(this.settings.mediaServerType);
      const ms = new Pms({
        plexHTTPS: this.settings.plexHTTPS,
        plexIP: this.settings.plexIP,
        plexPort: this.settings.plexPort,
        plexToken: this.settings.plexToken,
      });
      try {
        const sessions = await ms.GetNowScreeningRawData();
        const playing = Array.isArray(sessions)
          ? sessions.filter((s) => s.NowPlayingItem || s.nowPlayingItem).length
          : 0;
        if (playing === 0) {
          console.log(
            "Nothing returned as playing. Please verify this is correct"
          );
        } else {
          console.log(playing + " media item(s) playing.");
        }
      } catch (err) {
        console.log(err);
      }
      return;
    }

    if (isKodi(this.settings.mediaServerType)) {
      const ms = new Kodi({
        plexHTTPS: this.settings.plexHTTPS,
        plexIP: this.settings.plexIP,
        plexPort: this.settings.plexPort,
        plexToken: this.settings.plexToken,
      });
      try {
        const players = await ms.GetNowScreeningRawData();
        const n = Array.isArray(players) ? players.length : 0;
        if (n === 0) {
          console.log(
            "Nothing returned as playing. Please verify this is correct"
          );
        } else {
          console.log(n + " media item(s) playing.");
        }
      } catch (err) {
        console.log(err);
      }
      return;
    }

    const ms = new pms({
      plexHTTPS: this.settings.plexHTTPS,
      plexIP: this.settings.plexIP,
      plexPort: this.settings.plexPort,
      plexToken: this.settings.plexToken,
    });

    try {
      const result = await Promise.resolve(
        ms.client.query("/status/sessions")
      );
      const size =
        result && result.MediaContainer ? result.MediaContainer.size : 0;
      if (size == 0) {
        console.log(
          "Nothing returned as playing. Please verify this is correct"
        );
      } else {
        console.log(size + " media item(s) playing.");
      }
    } catch (err) {
      console.log(err);
    }
  }

  async PlexODCheck() {
    if (isJellyfinFamily(this.settings.mediaServerType)) {
      const Pms = getMediaServerClass(this.settings.mediaServerType);
      const ms = new Pms({
        plexHTTPS: this.settings.plexHTTPS,
        plexIP: this.settings.plexIP,
        plexPort: this.settings.plexPort,
        plexToken: this.settings.plexToken,
      });
      try {
        const data = await ms.apiGet("/Library/MediaFolders");
        const folders = (data && data.Items) || [];
        let now = new Date();
        console.log(
          now.toLocaleString() +
            " *On-demand - " +
            getMediaServerShortLabel(this.settings.mediaServerType) +
            " libraries (" +
            folders.length +
            " folders)"
        );
        folders.slice(0, 5).forEach((lib) => {
          console.log(" -", lib.Name);
        });

        const sample = await ms.fetchSampleTitlesFromFirstLibrary(5);
        now = new Date();
        if (!sample.ok) {
          console.log(now.toLocaleString() + " *On-demand - " + sample.message);
          return;
        }
        console.log(
          now.toLocaleString() +
            " *On-demand - get 5 titles from first library"
        );
        const n = sample.titles.length;
        for (let x = 0; x < n; x++) {
          console.log(" -", sample.titles[x]);
        }
        if (n === 0) {
          console.log(
            " - (no items returned — empty library or adjust IncludeItemTypes for folder type '" +
              (sample.collectionType || "unknown") +
              "')"
          );
        }
      } catch (err) {
        const now = new Date();
        console.log(
          now.toLocaleString() + " *On-demand - title retrieval: " + err
        );
      }
      return;
    }

    if (isKodi(this.settings.mediaServerType)) {
      const ms = new Kodi({
        plexHTTPS: this.settings.plexHTTPS,
        plexIP: this.settings.plexIP,
        plexPort: this.settings.plexPort,
        plexToken: this.settings.plexToken,
      });
      try {
        const sources = await ms.GetVideoSources();
        let now = new Date();
        console.log(
          now.toLocaleString() +
            " *On-demand - " +
            getMediaServerShortLabel(this.settings.mediaServerType) +
            " video sources (" +
            sources.length +
            ")"
        );
        sources.slice(0, 5).forEach((s) => {
          console.log(" -", s.label);
        });

        const sample = await ms.fetchSampleTitlesFromFirstLibrary(5);
        now = new Date();
        if (!sample.ok) {
          console.log(now.toLocaleString() + " *On-demand - " + sample.message);
          return;
        }
        console.log(
          now.toLocaleString() +
            " *On-demand - get 5 titles from first library"
        );
        const n = sample.titles.length;
        for (let x = 0; x < n; x++) {
          console.log(" -", sample.titles[x]);
        }
        if (n === 0) {
          console.log(
            " - (no items — empty source or library not scanned in Kodi)"
          );
        }
      } catch (err) {
        const now = new Date();
        console.log(
          now.toLocaleString() + " *On-demand - title retrieval: " + err
        );
      }
      return;
    }

    const ms = new pms({
      plexHTTPS: this.settings.plexHTTPS,
      plexIP: this.settings.plexIP,
      plexPort: this.settings.plexPort,
      plexToken: this.settings.plexToken,
    });

    try {
      const result = await Promise.resolve(
        ms.client.query("/library/sections/" + 1 + "/all")
      );
      const now = new Date();
      console.log(
        now.toLocaleString() + " *On-demand - get 5 titles from first library"
      );
      const meta = (result.MediaContainer && result.MediaContainer.Metadata) || [];
      const n = Math.min(5, meta.length);
      for (let x = 0; x < n; x++) {
        console.log(" -", meta[x].title);
      }
      if (n === 0) {
        console.log(
          " - (no titles in library section 1 — check library key exists)"
        );
      }
    } catch (err) {
      const now = new Date();
      console.log(
        now.toLocaleString() + " *On-demand - title retrieval: " + err
      );
    }
  }

async SonarrCheck() {
  let response;
  // set up date range and date formats
  let today = new Date();
  let later = new Date();
  later.setDate(later.getDate() + 7);
  let startDate = today.toISOString().split("T")[0];
  let endDate = later.toISOString().split("T")[0];
  // call sonarr API and return results
  try {
    response = await axios
      .get(
        this.settings.sonarrURL +
          "/api/v3/calendar?apikey=" +
          this.settings.sonarrToken +
          "&start=" +
          startDate +
          "&end=" +
          endDate
      )
      .catch((err) => {
        throw err;
      });
  } catch (err) {
    // displpay error if call failed
    let d = new Date();
    console.log(
      d.toLocaleString() + " *SONARR CHECK - Get calendar data:",
      err.message
    );
    throw err;
  }
  // console.log(response.data);
  response.data.forEach(tvShow => {
    console.log(tvShow.title,tvShow.airDate);
  });
  return;
}

async TriviaCheck() {
  let resp;
  // call trivia API and return results
  try {
    resp = await axios
      .get("https://opentdb.com/api.php?amount=5&category=11")
      .catch((err) => {
        throw err;
      });
  } catch (err) {
    // displpay error if call failed
    let d = new Date();
    console.log(
      d.toLocaleString() + " *Trivia check failed - :",
      err.message
    );
    throw err;
  }
  let cnt = 0;
  resp.data.results.forEach(question => {
    cnt++;
    console.log(cnt + " - " + question.question);
  });
  return;
}

async ReadarrCheck() {
  let resp;
  const bookLabel =
    this.settings.bookArrKind === "chaptarr" ? "Chaptarr" : "Readarr";
  // set up date range and date formats
  let today = new Date();
  let later = new Date();
  later.setDate(later.getDate() + 30);
  let startDate = today.toISOString().split("T")[0];
  let endDate = later.toISOString().split("T")[0];
  // Readarr / Chaptarr share the same calendar API
  try {
    resp = await axios
      .get(
        this.settings.readarrURL +
          "/api/v1/calendar?unmonitored=false&apikey=" +
          this.settings.readarrToken +
          "&start=" +
          startDate +
          "&end=" +
          endDate
      )
      .catch((err) => {
        throw err;
      });
  } catch (err) {
    // displpay error if call failed
    let d = new Date();
    console.log(
      d.toLocaleString() + " *" + bookLabel.toUpperCase() + " CHECK- Get calendar data:",
      err.message
    );
    throw err;
  }

  resp.data.forEach(book => {
    console.log(book.title);
  });
  return;
}



async RadarrCheck() {
  let resp;
  // set up date range and date formats
  let today = new Date();
  let later = new Date();
  later.setDate(later.getDate() + 30);
  let startDate = today.toISOString().split("T")[0];
  let endDate = later.toISOString().split("T")[0];
  // call sonarr API and return results
  try {
    resp = await axios
      .get(
        this.settings.radarrURL +
          "/api/v3/calendar?apikey=" +
          this.settings.radarrToken +
          "&start=" +
          startDate +
          "&end=" +
          endDate
      )
      .catch((err) => {
        throw err;
      });
  } catch (err) {
    // displpay error if call failed
    let d = new Date();
    console.log(
      d.toLocaleString() + " *RADARR CHECK- Get calendar data:",
      err.message
    );
    throw err;
  }

  resp.data.forEach(movie => {
    console.log(movie.title);
  });
  return;
}

async LidarrCheck() {
  let resp;
  const today = new Date();
  const later = new Date();
  later.setDate(later.getDate() + 30);
  const startDate = today.toISOString().split("T")[0];
  const endDate = later.toISOString().split("T")[0];
  try {
    resp = await axios
      .get(
        this.settings.lidarrURL +
          "/api/v1/calendar?unmonitored=false&apikey=" +
          this.settings.lidarrToken +
          "&start=" +
          startDate +
          "&end=" +
          endDate
      )
      .catch((err) => {
        throw err;
      });
  } catch (err) {
    const d = new Date();
    console.log(
      d.toLocaleString() + " *LIDARR CHECK - Get calendar data:",
      err.message
    );
    throw err;
  }

  (resp.data || []).forEach((album) => {
    console.log(
      (album.artist && album.artist.artistName) || "",
      "-",
      album.title
    );
  });
  return;
}

  /**
   * @desc Checks all services available
   * @returns nothing
   */
  async TestPing() {
    this.PingSingleIP(
      getMediaServerShortLabel(this.settings.mediaServerType),
      this.settings.plexIP
    );
    if (this.settings.radarrURL !== undefined)
      this.PingSingleIP("Radarr", this.settings.radarrURL);
    if (this.settings.sonarrURL !== undefined)
      this.PingSingleIP("Sonarr", this.settings.sonarrURL);
    if (this.settings.lidarrURL !== undefined)
      this.PingSingleIP("Lidarr", this.settings.lidarrURL);
    if (this.settings.readarrURL !== undefined)
      this.PingSingleIP(
        this.settings.bookArrKind === "chaptarr" ? "Chaptarr" : "Readarr",
        this.settings.readarrURL
      );
    this.PingSingleIP("TVDB", "artworks.thetvdb.com");
    if (usesPlexThemeHost(this.settings.mediaServerType)) {
      this.PingSingleIP("Plex Themes", "tvthemes.plexapp.com");
    }
    this.PingSingleIP("TMDB", "https://image.tmdb.org");
    this.PingSingleIP("Open Trivia DB", "https://opentdb.com");
    return Promise.resolve(0);
  }

  /**
   * @desc Checks if it can ping a server
   * @returns {boolean} true or false
   */
  PingSingleIP(label, host) {
    let saniHost = this.sanitiseUrl(host);
    ping.sys.probe(saniHost, function (isAlive) {
      let now = new Date();
      console.log(
        now.toLocaleString() + " Ping test - " + label + ": " + host,
        isAlive ? true : false
      );
      return isAlive ? true : false;
    });
  }

  /**
   * @desc Takes a url and just eturns the address portion of the string
   * @returns {string} sanitised Url
   */
  sanitiseUrl(url) {
    // remove forward slashes
    let u = url.replace(/\//g, "");
    // remove https
    u = u.replace(/https:/i, "");
    // remove http
    u = u.replace(/http:/i, "");
    // get the address portion of string
    let parts = u.split(":");

    return parts[0];
  }
}

module.exports = Health;
