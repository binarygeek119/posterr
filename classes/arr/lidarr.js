const mediaCard = require("./../cards/MediaCard");
const cType = require("./../cards/CardType");
const util = require("./../core/utility");
const core = require("./../core/cache");
const axios = require("axios");

/**
 * @desc Lidarr — upcoming album releases (same *arr pattern as Sonarr/Radarr)
 * @param {string} lidarrUrl - Base URL, no trailing slash
 * @param {string} lidarrToken - API key
 */
class Lidarr {
  constructor(lidarrUrl, lidarrToken) {
    this.lidarrUrl = lidarrUrl;
    this.lidarrToken = lidarrToken;
  }

  /**
   * @param {string} startDate - yyyy-mm-dd
   * @param {string} endDate - yyyy-mm-dd
   */
  async GetComingSoonRawData(startDate, endDate) {
    let response;
    try {
      response = await axios
        .get(
          this.lidarrUrl +
            "/api/v1/calendar?unmonitored=false&apikey=" +
            this.lidarrToken +
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
        d.toLocaleString() + " *Lidarr - Get calendar data:",
        err.message
      );
      throw err;
    }
    return response;
  }

  static pickCoverUrl(images) {
    if (!images || !Array.isArray(images)) return undefined;
    let url;
    images.forEach((i) => {
      const t = (i.coverType || "").toLowerCase();
      if (t === "cover" || t === "poster") {
        if (i.remoteUrl) url = i.remoteUrl;
      }
    });
    return url;
  }

  static pickFanartUrl(images) {
    if (!images || !Array.isArray(images)) return undefined;
    let url;
    images.forEach((i) => {
      if ((i.coverType || "").toLowerCase() === "fanart" && i.remoteUrl) {
        url = i.remoteUrl;
      }
    });
    return url;
  }

  /** Artist / band poster for portrait strip when Lidarr provides it */
  static pickArtistImageUrl(images) {
    if (!images || !Array.isArray(images)) return undefined;
    let url;
    images.forEach((i) => {
      const t = (i.coverType || "").toLowerCase();
      if ((t === "poster" || t === "cover" || t === "banner") && i.remoteUrl) {
        url = i.remoteUrl;
      }
    });
    return url;
  }

  /**
   * Album already fully on disk — skip for “coming soon”
   */
  static albumComplete(md) {
    const s = md.statistics;
    if (!s) return false;
    if (s.percentOfTracks != null && s.percentOfTracks >= 100) return true;
    if (
      s.trackCount > 0 &&
      s.trackFileCount != null &&
      s.trackFileCount >= s.trackCount
    ) {
      return true;
    }
    return false;
  }

  /**
   * @param {string} startDate
   * @param {string} endDate
   * @param {string} hasArt - "true" / "false"
   */
  async GetComingSoon(startDate, endDate, hasArt) {
    const cslCards = [];
    let raw;
    try {
      raw = await this.GetComingSoonRawData(startDate, endDate);
    } catch (err) {
      const d = new Date();
      console.log(d.toLocaleString() + " *Lidarr - Get raw data: " + err);
      throw err;
    }

    if (raw != null && Array.isArray(raw.data)) {
      await raw.data.reduce(async (memo, md) => {
        await memo;
        if (Lidarr.albumComplete(md)) {
          return undefined;
        }

        const medCard = new mediaCard();
        const artistName =
          (md.artist && (md.artist.artistName || md.artist.name)) || "";
        let releaseLabel = "No release date";
        if (!(await util.isEmpty(md.releaseDate))) {
          const rd = new Date(md.releaseDate);
          releaseLabel = rd.toISOString().split("T")[0];
        }
        medCard.tagLine =
          (artistName ? artistName + " — " : "") +
          (md.title || "") +
          " (" +
          releaseLabel +
          ")";
        medCard.title = md.title || "";
        medCard.DBID =
          md.foreignAlbumId ||
          (md.id != null ? String(md.id) : "") ||
          "lidarr-album";
        medCard.genre = md.genres || [];
        medCard.summary = await util.emptyIfNull(md.overview);
        medCard.mediaType = "album";
        medCard.cardType = cType.CardTypeEnum.ComingSoon;
        medCard.studio = artistName;
        medCard.albumArtist = artistName;
        medCard.featuredArtistName = artistName;
        medCard.featuredArtistCredits = [md.title || ""].filter(Boolean).slice(0, 5);
        medCard.theme = "";

        if (md.duration != null && md.duration > 0) {
          medCard.runTime = Math.round(md.duration / 60);
        }

        if (md.ratings && md.ratings.value != null && md.ratings.value > 0) {
          medCard.rating = Math.round(md.ratings.value * 10) + "%";
        }

        const safeFileBase = String(medCard.DBID).replace(/[^a-zA-Z0-9._-]/g, "_");
        let posterUrl = Lidarr.pickCoverUrl(md.images);
        if (posterUrl) {
          await core.CacheImage(posterUrl, safeFileBase + ".jpg");
          medCard.posterURL = "/imagecache/" + safeFileBase + ".jpg";
        } else {
          medCard.posterURL = "/images/no-poster-available.png";
        }

        if (hasArt === "true") {
          const fan = Lidarr.pickFanartUrl(md.images);
          if (fan) {
            await core.CacheImage(fan, safeFileBase + "-art.jpg");
            medCard.posterArtURL = "/imagecache/" + safeFileBase + "-art.jpg";
          }
        }

        const artistImgs = md.artist && md.artist.images;
        const artistPoster = Lidarr.pickArtistImageUrl(artistImgs);
        if (artistPoster) {
          await core.CacheImage(artistPoster, safeFileBase + "-artist.jpg");
          medCard.portraitArtistURL = "/imagecache/" + safeFileBase + "-artist.jpg";
        }

        medCard.posterAR = 1;

        let contentRating = "NR";
        medCard.contentRating = contentRating;
        medCard.ratingColour = "badge-dark";

        cslCards.push(medCard);
      }, undefined);
    }

    const now = new Date();
    if (cslCards.length === 0) {
      console.log(now.toLocaleString() + " No Coming soon 'music' titles found");
    } else {
      console.log(now.toLocaleString() + " Coming soon 'music' (Lidarr) refreshed");
    }
    return cslCards;
  }
}

module.exports = Lidarr;
