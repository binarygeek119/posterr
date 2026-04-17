const axios = require("axios");
const fs = require("fs");
const path = require("path");
const mediaCard = require("./../cards/MediaCard");
const cType = require("./../cards/CardType");
const util = require("./../core/utility");
const core = require("./../core/cache");
const { IMAGE_CACHE_DIR } = require("./../core/appPaths");
const tmdbBackdropFallback = require("./../core/tmdbBackdropFallback");
const posterSyncLib = require("./../core/posterSyncProgress");
const posterSyncRetry = require("./../core/posterSyncRetry");
const posterMetadataDb = require("./../core/posterMetadataDb");
const {
  PosterSyncAbortedError,
  checkPosterSyncAborted,
} = require("./../core/posterSyncAbort");
const { CardTypeEnum } = require("./../cards/CardType");
const posterrPackage = require("../../package.json");

/**
 * Paginated GET /Users/{id}/Items (recursive library scan) often exceeds 2 minutes on large
 * libraries, slow storage, or remote Jellyfin; poster sync uses this per page.
 */
const LIBRARY_ITEMS_PAGE_TIMEOUT_MS = 600000;

/**
 * How many items each library page requests. Fewer HTTP round trips = faster listing on LAN.
 * If Jellyfin times out or returns errors, set env POSTERR_JELLYFIN_LIBRARY_PAGE_LIMIT lower (min 50).
 * @see process.env.POSTERR_JELLYFIN_LIBRARY_PAGE_LIMIT — integer 50–500, default 300
 */
const LIBRARY_ITEMS_PAGE_LIMIT = (() => {
  const raw = parseInt(process.env.POSTERR_JELLYFIN_LIBRARY_PAGE_LIMIT, 10);
  if (Number.isFinite(raw) && raw >= 50 && raw <= 500) return raw;
  return 300;
})();
const LIBRARY_ITEMS_FIRST_PAGE_LIMIT = (() => {
  const raw = parseInt(
    process.env.POSTERR_JELLYFIN_LIBRARY_FIRST_PAGE_LIMIT,
    10
  );
  if (Number.isFinite(raw) && raw >= 50 && raw <= 500) return raw;
  return 120;
})();
const LIBRARY_ITEMS_FIRST_PAGE_FALLBACK_LIMIT = (() => {
  const raw = parseInt(
    process.env.POSTERR_JELLYFIN_LIBRARY_FIRST_PAGE_FALLBACK_LIMIT,
    10
  );
  if (Number.isFinite(raw) && raw >= 10 && raw <= 500) return raw;
  return 30;
})();
const LIBRARY_ITEMS_FIRST_PAGE_FALLBACK_LIMIT_METADATA_ONLY = (() => {
  const raw = parseInt(
    process.env.POSTERR_JELLYFIN_LIBRARY_FIRST_PAGE_FALLBACK_LIMIT_METADATA_ONLY,
    10
  );
  if (Number.isFinite(raw) && raw >= 10 && raw <= 500) return raw;
  return 30;
})();
const LIBRARY_ITEMS_FIRST_PAGE_TIMEOUT_MS = (() => {
  const raw = parseInt(
    process.env.POSTERR_JELLYFIN_LIBRARY_FIRST_PAGE_TIMEOUT_MS,
    10
  );
  if (Number.isFinite(raw) && raw >= 10000 && raw <= 600000) return raw;
  return 90000;
})();
/** GET /Sessions (Now Playing / Now Screening) — default 60s axios is often too low on busy Jellyfin. */
const SESSIONS_API_TIMEOUT_MS = (() => {
  const raw = parseInt(process.env.POSTERR_JELLYFIN_SESSIONS_TIMEOUT_MS, 10);
  if (Number.isFinite(raw) && raw >= 30000 && raw <= 600000) return raw;
  return 180000;
})();
const SESSIONS_API_MAX_RETRIES = (() => {
  const raw = parseInt(process.env.POSTERR_JELLYFIN_SESSIONS_MAX_RETRIES, 10);
  if (Number.isFinite(raw) && raw >= 0 && raw <= 5) return raw;
  return 2;
})();
/**
 * Pagination pages after the first (GET /Users/{id}/Items). Defaults to the long library timeout;
 * optional env can shorten per-request wait and rely on retries when Jellyfin intermittently stalls.
 */
const LIBRARY_ITEMS_CONTINUATION_PAGE_TIMEOUT_MS = (() => {
  const raw = parseInt(
    process.env.POSTERR_JELLYFIN_LIBRARY_CONTINUATION_TIMEOUT_MS,
    10
  );
  if (Number.isFinite(raw) && raw >= 60000 && raw <= 900000) return raw;
  return LIBRARY_ITEMS_PAGE_TIMEOUT_MS;
})();
const LIBRARY_ITEMS_CONTINUATION_MAX_RETRIES = (() => {
  const raw = parseInt(
    process.env.POSTERR_JELLYFIN_LIBRARY_CONTINUATION_MAX_RETRIES,
    10
  );
  if (Number.isFinite(raw) && raw >= 0 && raw <= 8) return raw;
  return 3;
})();
const METADATA_ONLY_MAX_ITEMS_PER_LIBRARY = (() => {
  const raw = parseInt(
    process.env.POSTERR_JELLYFIN_METADATA_ONLY_MAX_ITEMS_PER_LIBRARY,
    10
  );
  if (Number.isFinite(raw) && raw >= 0) return raw;
  return 0;
})();
const FULL_SYNC_ENRICH_DETAILS = (() => {
  const raw = String(
    process.env.POSTERR_JELLYFIN_FULL_SYNC_ENRICH_DETAILS || ""
  ).trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes" || raw === "on";
})();
const LIBRARY_ITEMS_PAGE_LIMIT_METADATA_ONLY = (() => {
  const raw = parseInt(
    process.env.POSTERR_JELLYFIN_LIBRARY_PAGE_LIMIT_METADATA_ONLY,
    10
  );
  if (Number.isFinite(raw) && raw >= 50 && raw <= 500) return raw;
  return 120;
})();

/**
 * Jellyfin poster sync worker size. Each batch processes image pulls and then triggers
 * metadata registration callback (when enabled), so this also controls metadata flush cadence.
 */
const POSTER_SYNC_BATCH_SIZE = 10;

/**
 * Full poster sync: fetch this many Items per HTTP page, cache them fully, flush DB, then next page.
 * @see process.env.POSTERR_POSTER_SYNC_STREAM_CHUNK_SIZE — integer 25–500, default 100
 */
const POSTER_SYNC_STREAM_CHUNK_SIZE = (() => {
  const raw = parseInt(process.env.POSTERR_POSTER_SYNC_STREAM_CHUNK_SIZE, 10);
  if (Number.isFinite(raw) && raw >= 25 && raw <= 500) return raw;
  return 100;
})();

/** GET /Users/{id}/Items page 1: extra axios retries before outer “smaller limit” fallback (0–3). */
const LIBRARY_ITEMS_FIRST_PAGE_HTTP_RETRIES = (() => {
  const raw = parseInt(
    process.env.POSTERR_JELLYFIN_FIRST_PAGE_HTTP_RETRIES,
    10
  );
  if (Number.isFinite(raw) && raw >= 0 && raw <= 3) return raw;
  return 1;
})();

function _axiosErrCode(e) {
  if (!e || typeof e !== "object") return "";
  if (e.code != null) return String(e.code);
  const c = e.cause;
  if (c && c.code != null) return String(c.code);
  return "";
}

const RETRYABLE_AXIOS_NETWORK_CODES = new Set([
  "ETIMEDOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
]);

function _axiosErrorIsRetriableTimeout(e) {
  if (!e || typeof e !== "object") return false;
  if (e.code === "ECONNABORTED") return true;
  return String(e.message || "").toLowerCase().includes("timeout");
}

function _axiosErrorIsRetriableNetwork(e) {
  const code = _axiosErrCode(e);
  if (RETRYABLE_AXIOS_NETWORK_CODES.has(code)) return true;
  const msg = String((e && e.message) || "").toLowerCase();
  return (
    msg.includes("etimedout") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("enotfound")
  );
}

/**
 * Same filtering as the legacy “load entire library then filter” path, applied to one page of Items.
 * @param {object[]} items
 * @param {string[]} genres
 * @param {number} recentlyAdded
 * @param {string[]} contentRatings
 */
function filterMediaItemsForOdemandFilters(items, genres, recentlyAdded, contentRatings) {
  if (!items || !items.length) return [];
  let all = items.slice();
  if (recentlyAdded > 0) {
    const from = new Date();
    from.setDate(from.getDate() - recentlyAdded);
    from.setHours(0, 0, 0, 0);
    all = all.filter((m) => m.DateCreated && new Date(m.DateCreated) >= from);
  } else {
    if (genres && genres.length > 0) {
      all = all.filter((m) => {
        const itemGenres = m.Genres || [];
        return genres.some((val) => {
          const valLower = (val || "").toLowerCase();
          return itemGenres.some((g) =>
            (g || "").toLowerCase().includes(valLower)
          );
        });
      });
    }
    if (contentRatings && contentRatings.length > 0) {
      all = all.filter((m) => {
        const cr = ((m.OfficialRating || "") + "").toLowerCase();
        return !contentRatings.some((r) => r.toLowerCase() === cr);
      });
    }
  }
  return all;
}

function extractEmbyTags(item) {
  if (!item || typeof item !== "object") return "";
  const out = [];
  const add = (v) => {
    if (!v) return;
    if (Array.isArray(v)) {
      for (const it of v) add(it);
      return;
    }
    if (typeof v === "object") {
      add(
        v.Name ||
          v.name ||
          v.Tag ||
          v.tag ||
          v.Title ||
          v.title ||
          v.DisplayName ||
          v.displayName ||
          ""
      );
      return;
    }
    const s = String(v).trim();
    if (!s) return;
    out.push(s);
  };
  add(item.Tags);
  add(item.tags);
  add(item.TagItems);
  add(item.tagItems);
  add(item.Genres);
  add(item.genres);
  add(item.Studios);
  add(item.studios);
  const uniq = [];
  const seen = new Set();
  for (const s of out) {
    const lc = s.toLowerCase();
    if (seen.has(lc)) continue;
    seen.add(lc);
    uniq.push(s);
  }
  return uniq.join(", ");
}

/**
 * Shared Emby/Jellyfin REST client.
 * Emby: X-Emby-Token + api_key query (legacy, still widely used).
 * Jellyfin 10.11+: legacy auth may be disabled; sending X-Emby-Token together with MediaBrowser auth can 401 (jellyfin#16086).
 * Jellyfin therefore uses only Authorization: MediaBrowser Token="…".
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
    this._libraryFirstPageLimitHint = null;
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

  /** Emby keeps legacy header + api_key; Jellyfin uses MediaBrowser Authorization only. */
  _usesLegacyEmbyTokenQueryAuth() {
    return this.appName !== "Jellyfin";
  }

  /** Jellyfin / Emby “MediaBrowser” scheme (API keys and access tokens). */
  _mediaBrowserAuthorizationHeader(key) {
    const ver = (posterrPackage && posterrPackage.version) || "1.0";
    const tok = String(key).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return `MediaBrowser Client="Posterr", Device="Posterr", DeviceId="posterr", Version="${ver}", Token="${tok}"`;
  }

  /**
   * Jellyfin image URLs are fetched with `request()` (not axios). Newer servers expect the same
   * MediaBrowser Authorization as the JSON API; query-only api_key/ApiKey is often rejected on /Images/.
   * @returns {object|null} headers object or null for Emby (uses api_key on URL)
   */
  jellyfinImageAuthHeaders() {
    if (this.appName !== "Jellyfin") return null;
    const key =
      this.apiKey != null && this.apiKey !== ""
        ? String(this.apiKey).trim()
        : "";
    if (!key) return null;
    return { Authorization: this._mediaBrowserAuthorizationHeader(key) };
  }

  async _cacheImageFromServer(url, fileName) {
    const h = this.jellyfinImageAuthHeaders();
    return core.CacheImage(url, fileName, h ? { headers: h } : undefined);
  }

  /**
   * Try several image URLs (e.g. Jellyfin /Logo/0 vs /Logo); unlink stale attempts so a bad response
   * does not block the next URL. @returns {Promise<boolean>}
   */
  async _cacheFirstImageUrl(urls, fileName) {
    const list = (urls || []).filter(Boolean);
    if (list.length === 0) return false;
    const savePath = path.join(IMAGE_CACHE_DIR, fileName);
    const h = this.jellyfinImageAuthHeaders();
    const opts = h ? { headers: h } : undefined;
    for (const u of list) {
      try {
        if (fs.existsSync(savePath)) fs.unlinkSync(savePath);
      } catch (e) {
        /* ignore */
      }
      const ok = await core.CacheImage(u, fileName, opts);
      if (ok) return true;
    }
    return false;
  }

  /** Candidate GET URLs for a Logo image (Jellyfin: indexed + unindexed paths; PNG first for clearlogo/logo.png). */
  logoImageFetchUrls(itemId, tag) {
    const id = itemId != null ? String(itemId) : "";
    if (!id) return [];
    if (this.appName === "Jellyfin") {
      const base = this.baseUrl();
      const qPng = EmbyJellyfinBase._jellyfinLogoQueryString(tag);
      const qTagOnly =
        tag != null && String(tag).length > 0
          ? `?tag=${encodeURIComponent(String(tag))}`
          : "";
      return [
        `${base}/Items/${id}/Images/Logo/0${qPng}`,
        `${base}/Items/${id}/Images/Logo${qPng}`,
        `${base}/Items/${id}/Images/Logo/0${qTagOnly}`,
        `${base}/Items/${id}/Images/Logo${qTagOnly}`,
      ];
    }
    return [this.logoImageUrl(id, tag)];
  }

  async apiGet(path, options = {}) {
    const key =
      this.apiKey != null && this.apiKey !== ""
        ? String(this.apiKey).trim()
        : "";
    if (!key) {
      throw new Error(
        `${this.appName}: no API key in settings. Create one in the server dashboard (Jellyfin: Dashboard → API Keys) and paste it into Posterr’s server token field.`
      );
    }
    const params = { ...(options.params || {}) };
    let headers;
    if (this._usesLegacyEmbyTokenQueryAuth()) {
      if (params.api_key === undefined) {
        params.api_key = key;
      }
      headers = { "X-Emby-Token": key };
    } else {
      delete params.api_key;
      headers = {
        Authorization: this._mediaBrowserAuthorizationHeader(key),
      };
    }
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
          headers,
          timeout: timeoutMs,
        });
        return res.data;
      } catch (e) {
        const canRetry =
          attempt < maxRetries &&
          (_axiosErrorIsRetriableTimeout(e) ||
            _axiosErrorIsRetriableNetwork(e));
        if (canRetry) {
          attempt++;
          const backoffMs = Math.min(
            12000,
            500 + attempt * 750 + (attempt > 2 ? 1500 : 0)
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        }
        const status = e.response && e.response.status;
        if (status === 401) {
          if (this._usesLegacyEmbyTokenQueryAuth()) {
            e.message += ` | ${this.appName}: HTTP 401 — wrong or revoked API key, or the key lacks access. Regenerate the key in the server dashboard and update Posterr. If you use a reverse proxy, ensure it forwards the X-Emby-Token header (Posterr also sends api_key on the query string).`;
          } else {
            e.message += ` | Jellyfin: HTTP 401 — invalid or revoked API key (Dashboard → API Keys), or the server blocked the request. Posterr uses Authorization: MediaBrowser (required on Jellyfin 10.11+ when legacy X-Emby-Token is disabled). Ensure your reverse proxy forwards the Authorization header if you use one.`;
          }
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
      const me = await this.apiGet("/Users/Me", {
        timeoutMs: LIBRARY_ITEMS_PAGE_TIMEOUT_MS,
        maxRetries: 1,
      });
      if (me && me.Id) {
        this._userId = me.Id;
        return this._userId;
      }
    } catch (e) {
      /* fall through */
    }
    const list = await this.apiGet("/Users", {
      timeoutMs: LIBRARY_ITEMS_PAGE_TIMEOUT_MS,
      maxRetries: 2,
    });
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

  /**
   * Image endpoints are fetched with `request` (no MediaBrowser header). Jellyfin 10.11+ treats `api_key` as legacy;
   * use `ApiKey` for Jellyfin. Emby keeps `api_key`.
   */
  _imageUrlApiQuery() {
    const key = encodeURIComponent(
      String(this.apiKey != null ? this.apiKey : "").trim()
    );
    if (this.appName === "Jellyfin") {
      return `ApiKey=${key}`;
    }
    return `api_key=${key}`;
  }

  primaryImageUrl(itemId, tag) {
    if (this.appName === "Jellyfin") {
      const q = tag ? `?tag=${encodeURIComponent(tag)}` : "";
      return `${this.baseUrl()}/Items/${itemId}/Images/Primary/0${q}`;
    }
    const t = tag ? `&tag=${encodeURIComponent(tag)}` : "";
    return `${this.baseUrl()}/Items/${itemId}/Images/Primary?${this._imageUrlApiQuery()}${t}`;
  }

  backdropImageUrl(itemId, index = 0) {
    if (this.appName === "Jellyfin") {
      return `${this.baseUrl()}/Items/${itemId}/Images/Backdrop/${index}`;
    }
    return `${this.baseUrl()}/Items/${itemId}/Images/Backdrop/${index}?${this._imageUrlApiQuery()}`;
  }

  bannerImageUrl(itemId, tag) {
    if (this.appName === "Jellyfin") {
      const q = tag ? `?tag=${encodeURIComponent(tag)}` : "";
      return `${this.baseUrl()}/Items/${itemId}/Images/Banner/0${q}`;
    }
    const t = tag ? `&tag=${encodeURIComponent(tag)}` : "";
    return `${this.baseUrl()}/Items/${itemId}/Images/Banner/0?${this._imageUrlApiQuery()}${t}`;
  }

  logoImageUrl(itemId, tag) {
    if (this.appName === "Jellyfin") {
      // Local fanart often uses logo.png / clearlogo.png; ask for PNG so Jellyfin does not fall back to opaque JPEG.
      const qs = EmbyJellyfinBase._jellyfinLogoQueryString(tag);
      return `${this.baseUrl()}/Items/${itemId}/Images/Logo/0${qs}`;
    }
    const t = tag ? `&tag=${encodeURIComponent(tag)}` : "";
    return `${this.baseUrl()}/Items/${itemId}/Images/Logo?${this._imageUrlApiQuery()}${t}`;
  }

  /** Query string for Jellyfin Logo image (transparency: logo.png / clearlogo.png in library folders). */
  static _jellyfinLogoQueryString(tag) {
    const parts = ["format=Png"];
    if (tag != null && String(tag).length > 0) {
      parts.push("tag=" + encodeURIComponent(String(tag)));
    }
    return "?" + parts.join("&");
  }

  /**
   * Cache a primary image using multiple Jellyfin id/tag candidates.
   * Returns web path or empty string when all candidates fail.
   */
  async cachePrimaryImageAny(candidates, fileName, medCard) {
    const seen = new Set();
    for (const c of candidates || []) {
      if (!c || !c.id) continue;
      const key = String(c.id) + "|" + String(c.tag || "");
      if (seen.has(key)) continue;
      seen.add(key);
      try {
        const imgUrl = this.primaryImageUrl(c.id, c.tag || null);
        if (medCard) medCard.posterDownloadURL = imgUrl;
        await this._cacheImageFromServer(imgUrl, fileName);
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

  /** True if Jellyfin/Emby item has at least one backdrop tag/path. */
  static hasBackdropImage(item) {
    if (!item) return false;
    const bt = item.BackdropImageTags || item.backdropImageTags;
    if (Array.isArray(bt) && bt.length > 0) return true;
    if (item.ImageTags && item.ImageTags.Backdrop) return true;
    if (item.imageTags && item.imageTags.backdrop) return true;
    if (item.art && item.art.fanart) return true;
    if (item.fanart) return true;
    return false;
  }

  /** True if Jellyfin/Emby item has a banner image (separate from backdrop). */
  static hasBannerImage(item) {
    if (!item) return false;
    const bt = item.BannerImageTags || item.bannerImageTags;
    if (Array.isArray(bt) && bt.length > 0) return true;
    if (item.ImageTags && item.ImageTags.Banner) return true;
    if (item.imageTags && item.imageTags.banner) return true;
    return false;
  }

  static bannerImageTag(item) {
    if (!item) return null;
    const tags = item.ImageTags || item.imageTags;
    if (!tags || typeof tags !== "object") return null;
    const b = tags.Banner ?? tags.banner;
    return b !== undefined && b !== null && String(b).length > 0
      ? String(b)
      : null;
  }

  /** Jellyfin serializes ImageTags keys as enum names, but some clients/servers use numeric strings (Logo = 4). */
  static _jellyfinLogoEnumKey() {
    return "4";
  }

  static _logoTagFromBlurHashes(item) {
    const bh = item.ImageBlurHashes || item.imageBlurHashes;
    if (!bh || typeof bh !== "object") return null;
    const logoMap = bh.Logo ?? bh.logo;
    if (!logoMap || typeof logoMap !== "object") return null;
    const keys = Object.keys(logoMap);
    for (const k of keys) {
      if (k != null && String(k).length > 0) return String(k);
    }
    return null;
  }

  static _ownLogoTagFromImageTags(item) {
    const tags = item.ImageTags || item.imageTags;
    if (!tags || typeof tags !== "object") return null;
    const L = tags.Logo ?? tags.logo;
    if (L !== undefined && L !== null && String(L).length > 0) {
      return String(L);
    }
    const n = tags[EmbyJellyfinBase._jellyfinLogoEnumKey()];
    if (n !== undefined && n !== null && String(n).length > 0) {
      return String(n);
    }
    return null;
  }

  /**
   * Resolves which item id + cache tag to use for Logo (own ImageTags, blur-hash-only hint, or parent logo).
   * @returns {{ itemId: string, tag: string } | null}
   */
  static logoImageRef(item) {
    if (!item) return null;
    const ownId = item.Id ?? item.id;
    if (ownId == null || String(ownId).length === 0) return null;
    let tag =
      EmbyJellyfinBase._ownLogoTagFromImageTags(item) ||
      EmbyJellyfinBase._logoTagFromBlurHashes(item);
    if (tag) {
      return { itemId: String(ownId), tag };
    }
    const pid = item.ParentLogoItemId ?? item.parentLogoItemId;
    const ptag = item.ParentLogoImageTag ?? item.parentLogoImageTag;
    if (
      pid != null &&
      String(pid).length > 0 &&
      ptag != null &&
      String(ptag).length > 0
    ) {
      return { itemId: String(pid), tag: String(ptag) };
    }
    return null;
  }

  static hasLogoImage(item) {
    return EmbyJellyfinBase.logoImageRef(item) != null;
  }

  static logoImageTag(item) {
    const ref = EmbyJellyfinBase.logoImageRef(item);
    return ref ? ref.tag : null;
  }

  /**
   * Ref used when caching logos. Jellyfin list items often lack ImageTags.Logo / blur hashes even when
   * folder art (logo.png, clearlogo.png) was picked up — during full sync, still hit /Images/Logo (no tag).
   * @returns {{ itemId: string, tag: string|null } | null}
   */
  logoImageRefForCache(item, posterSyncFull) {
    const ref = EmbyJellyfinBase.logoImageRef(item);
    if (ref) return ref;
    if (
      !posterSyncFull ||
      (this.appName !== "Jellyfin" && this.appName !== "Emby")
    ) {
      return null;
    }
    const type = item.Type || item.type;
    if (type !== "Series" && type !== "Movie" && type !== "MusicAlbum") {
      return null;
    }
    const ownId = item.Id ?? item.id;
    if (ownId == null || String(ownId).length === 0) return null;
    return { itemId: String(ownId), tag: null };
  }

  /**
   * Full poster sync: fetch each Series/Movie DTO from the server so Overview, People, ImageTags, etc.
   * match the item detail (recursive library pages are slimmer than GET …/Items/{id}).
   */
  async enrichItemForPosterSync(
    listRow,
    posterSyncFull,
    metadataOnlySync,
    enrichDetails
  ) {
    if (metadataOnlySync || !enrichDetails) {
      return listRow;
    }
    const type = listRow.Type || listRow.type;
    if (
      !posterSyncFull ||
      (type !== "Series" && type !== "Movie") ||
      listRow.Id == null
    ) {
      return listRow;
    }
    try {
      const userId = await this.getUserId();
      const detail = await this.apiGet(
        `/Users/${userId}/Items/${encodeURIComponent(listRow.Id)}`,
        {
          timeoutMs: 45000,
          maxRetries: 1,
          // List pages omit Taglines unless Fields asks for it; same for some detail defaults.
          params: { Fields: "Taglines,Overview,Genres,People" },
        }
      );
      if (!detail || !detail.Id) return listRow;
      const merged = { ...listRow, ...detail };
      merged._jfLibraryName = listRow._jfLibraryName;
      merged.ctype = listRow.ctype;
      return merged;
    } catch (e) {
      return listRow;
    }
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

  /**
   * Pick a display tagline from Jellyfin/Emby BaseItemDto-shaped JSON.
   * Jellyfin omits the Taglines field on GET /Users/{id}/Items list rows unless Fields includes
   * ItemFields.Taglines (see Items API). Without it, Taglines is empty and we fall back to
   * overview/title. When Taglines is present, use the first entry that is not a junk duplicate of
   * title / title+year / title+premiere date; otherwise short/overview, then genres.
   * @param {object} item BaseItemDto-shaped object (PascalCase and camelCase tolerated)
   * @returns {string}
   */
  static pickBaseItemTagline(item) {
    if (!item || typeof item !== "object") return "";
    const name = String(item.Name || item.name || "").trim();
    const yearRaw = item.ProductionYear ?? item.productionYear;
    const year =
      yearRaw != null && yearRaw !== "" ? String(yearRaw).trim() : "";
    const lines = item.Taglines || item.taglines;

    const isJunkTagline = (s) => {
      if (!s) return true;
      if (!name) return false;
      const sl = s.toLowerCase();
      const nl = name.toLowerCase();
      if (sl === nl) return true;
      if (year && sl === `${nl} (${year})`) return true;
      if (year && sl === `${nl} ${year}`) return true;
      const prem = item.PremiereDate || item.premiereDate;
      if (prem && typeof prem === "string") {
        const d = prem.slice(0, 10);
        if (d && /\d{4}-\d{2}-\d{2}/.test(d) && sl.startsWith(nl) && sl.includes(d)) {
          return true;
        }
      }
      return false;
    };

    let fromTags = "";
    if (Array.isArray(lines)) {
      const candidates = lines
        .map((x) => (x == null ? "" : String(x).trim()))
        .filter(Boolean);
      const good = candidates.find((s) => !isJunkTagline(s));
      if (good) return good;
      fromTags = candidates[0] || "";
    }

    if (fromTags && !isJunkTagline(fromTags)) return fromTags;

    const shortO = String(item.ShortOverview || item.shortOverview || "").trim();
    if (shortO) return shortO.length > 280 ? shortO.slice(0, 277) + "…" : shortO;

    const ov = String(item.Overview || item.overview || "").trim();
    if (ov) {
      const para = ov.split(/\n+/)[0].trim();
      let bit = (para.split(/(?<=[.!?])\s+/)[0] || para).trim();
      if (!bit) bit = para;
      if (bit.length > 280) bit = bit.slice(0, 277) + "…";
      return bit;
    }

    const genres = item.Genres || item.genres;
    if (Array.isArray(genres) && genres.length) {
      const g = genres.filter(Boolean).slice(0, 3).join(" · ");
      if (g) return g;
    }

    return "";
  }

  async GetNowScreeningRawData() {
    return this.apiGet("/Sessions", {
      timeoutMs: SESSIONS_API_TIMEOUT_MS,
      maxRetries: SESSIONS_API_MAX_RETRIES,
    });
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

        const typeLc = type.toLowerCase();
        // Do not skip sessions just because image tags/types are unexpected.
        // Unknown types fall back to a generic now-playing card branch.

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
      medCard.tags = extractEmbyTags(item);
      medCard.summary = item.Overview || "";
      medCard.cast = util.formatCastFromEmbyPeople(item.People);
      medCard.directors = util.formatDirectorsFromEmbyPeople(item.People);

      if (typeLc === "audio") {
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
          posterFile,
          medCard
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
              await this._cacheImageFromServer(
                this.backdropImageUrl(albumIdBg, 0),
                artFile
              );
              medCard.posterArtURL = "/imagecache/" + artFile;
            } catch (e) {
              /* optional backdrop */
            }
          }
        }
      } else if (typeLc === "book" || typeLc === "audiobook") {
        medCard.title = item.Name || "";
        const byline = [item.AlbumArtist, item.SeriesName]
          .filter(Boolean)
          .join(" — ");
        medCard.tagLine =
          byline ||
          (Array.isArray(item.Genres) && item.Genres[0]) ||
          medCard.title;
        medCard.mediaType = typeLc === "audiobook" ? "audiobook" : "ebook";
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
          posterFile,
          medCard
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
            await this._cacheImageFromServer(
              this.backdropImageUrl(item.Id, 0),
              artFile
            );
            medCard.posterArtURL = "/imagecache/" + artFile;
          } catch (e) {
            /* optional backdrop */
          }
        }
        const ms0 = item.MediaSources && item.MediaSources[0];
        if (ms0 && ms0.TranscodingUrl) transcode = "transcode";
      } else if (typeLc === "episode") {
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
          posterFile,
          medCard
        );
        medCard.posterURL = epPoster || "/images/no-poster-available.png";

        if (hasArt === "true" && item.SeriesId) {
          const artFile = `${mediaId}-art.jpg`;
          try {
            await this._cacheImageFromServer(
              this.backdropImageUrl(item.SeriesId, 0),
              artFile
            );
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
      } else if (typeLc === "movie") {
        medCard.title = item.Name || "";
        let tagSrc = item;
        const sessTl = item.Taglines || item.taglines;
        const hasTl =
          Array.isArray(sessTl) &&
          sessTl.some((x) => x != null && String(x).trim() !== "");
        if (!hasTl && (item.Id || item.id)) {
          try {
            const userId = await this.getUserId();
            const det = await this.apiGet(
              `/Users/${userId}/Items/${encodeURIComponent(item.Id || item.id)}`,
              {
                timeoutMs: 8000,
                maxRetries: 0,
                params: { Fields: "Taglines,Overview" },
              }
            );
            if (det && det.Id) tagSrc = { ...item, ...det };
          } catch (e) {
            /* keep session payload */
          }
        }
        medCard.tagLine = EmbyJellyfinBase.pickBaseItemTagline(tagSrc);
        if (!medCard.tagLine) medCard.tagLine = medCard.title || "";
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
          posterFile,
          medCard
        );
        medCard.posterURL = mvPoster || "/images/no-poster-available.png";

        if (hasArt === "true") {
          const artFile = `${item.Id}-art.jpg`.replace(/[^a-zA-Z0-9._-]/g, "_");
          try {
            await this._cacheImageFromServer(
              this.backdropImageUrl(item.Id, 0),
              artFile
            );
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
      } else {
        // Generic fallback for Jellyfin item types we don't model explicitly.
        medCard.title = item.Name || item.name || "Now Playing";
        medCard.tagLine =
          item.SeriesName ||
          item.Album ||
          item.AlbumArtist ||
          item.Type ||
          medCard.title;
        medCard.mediaType = "movie";
        medCard.DBID = String(mediaId);
        const anyPoster = await this.cachePrimaryImageAny(
          [
            {
              id: item.Id,
              tag:
                (item.ImageTags && item.ImageTags.Primary) ||
                (item.imageTags && item.imageTags.primary) ||
                item.PrimaryImageTag ||
                item.primaryImageTag,
            },
            { id: item.SeriesId || item.seriesId, tag: null },
            { id: item.Id, tag: null },
          ],
          `${String(item.Id || mediaId || "x").replace(/[^a-zA-Z0-9._-]/g, "_")}.jpg`,
          medCard
        );
        medCard.posterURL = anyPoster || "/images/no-poster-available.png";
        medCard.posterAR = 1.47;
        medCard.cardType = cType.CardTypeEnum.NowScreening;
      }

      const portraitKey = String(item.Id || safeId || mediaId || "x").replace(
        /[^a-zA-Z0-9._-]/g,
        "_"
      );
      try {
        await this.cacheItemPersonPortraits(medCard, item, portraitKey);
      } catch (e) {
        /* portraits are optional; keep base card */
      }
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

        const rawItemId = item.Id || item.id;
        if (rawItemId) medCard.posterApiItemId = String(rawItemId);

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
        // Last-resort: keep at least a minimal card so UI does not go empty.
        try {
          const item = session.NowPlayingItem || session.nowPlayingItem;
          if (item) {
            const fallback = new mediaCard();
            fallback.title = item.Name || item.name || "Now Playing";
            fallback.tagLine =
              item.SeriesName ||
              item.Album ||
              item.AlbumArtist ||
              item.ProductionYear ||
              "";
            fallback.mediaType = (item.Type || item.type || "").toLowerCase();
            if (fallback.mediaType === "book") fallback.mediaType = "ebook";
            if (fallback.mediaType === "audiobook")
              fallback.mediaType = "audiobook";
            fallback.cardType = cType.CardTypeEnum.NowScreening;
            fallback.posterURL =
              fallback.mediaType === "ebook" ||
              fallback.mediaType === "audiobook"
                ? "/images/no-cover-available.png"
                : "/images/no-poster-available.png";
            fallback.posterAR =
              fallback.mediaType === "track" ||
              fallback.mediaType === "album" ||
              fallback.mediaType === "audiobook"
                ? 1
                : 1.47;
            fallbackCards.push(fallback);
          }
        } catch (e2) {
          /* ignore */
        }
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

  async _posterSyncProcessRawMdList(rawList, ctx) {
    const {
      posterSyncFull,
      metadataOnlySync,
      enrichDetails,
      opts,
      sp,
      runTag,
      retrySet,
      pullBackground,
      pullLogo,
      pullVideoPoster,
      pullAlbumPoster,
      odCards,
      onPosterSyncBatch,
      batchMeta,
      getProgressTotal,
      imagePull,
    } = ctx;
    const completedBatchCards = [];
    for (const rawMd of rawList) {
    if (posterSyncFull) {
      const rawApiId = String((rawMd && rawMd.Id) || "").trim();
      const sourceUpdatedAt =
        (rawMd && rawMd.DateLastSaved) ||
        (rawMd && rawMd.DateModified) ||
        (rawMd && rawMd.DateCreated) ||
        "";
      const mustRetry = !!(retrySet && rawApiId && retrySet.has(rawApiId));
      if (
        rawApiId &&
        !mustRetry &&
        posterMetadataDb.shouldSkipSyncItem(
          this.appName.toLowerCase(),
          rawApiId,
          sourceUpdatedAt
        )
      ) {
        if (sp) {
          sp.processed = Math.min(sp.total || 0, (sp.processed || 0) + 1);
        }
        continue;
      }
    }
    const md = await this.enrichItemForPosterSync(
      rawMd,
      posterSyncFull,
      metadataOnlySync,
      enrichDetails
    );
    const medCard = new mediaCard();
    medCard.posterLibraryLabel = String(md._jfLibraryName || "").trim();
    const type = md.Type;
    const probeVideoArt = posterSyncFull && pullBackground;

    if (type === "Series") {
      medCard.tagLine = EmbyJellyfinBase.pickBaseItemTagline(md);
      const mediaId = (md.Id || "").replace(/[^a-zA-Z0-9]/g, "");
      medCard.DBID = mediaId;
      medCard.theme = "";
      if (await util.isEmpty(md.CommunityRating)) {
        medCard.rating = "";
      } else {
        medCard.rating = Math.round(md.CommunityRating * 10) + "%";
      }
      const fileName = `${mediaId}.jpg`;
      const primaryTag = md.ImageTags && md.ImageTags.Primary;
      const seriesPosterUrl = this.primaryImageUrl(md.Id, primaryTag);
      medCard.posterDownloadURL = seriesPosterUrl;
      if (pullVideoPoster) {
        let posterOk = false;
        if (EmbyJellyfinBase.hasPrimaryImage(md)) {
          posterOk = await this._cacheImageFromServer(seriesPosterUrl, fileName);
        } else if (posterSyncFull) {
          const fallbackUrl = this.primaryImageUrl(md.Id, null);
          posterOk = await this._cacheImageFromServer(fallbackUrl, fileName);
          if (posterOk) medCard.posterDownloadURL = fallbackUrl;
        }
        medCard.posterURL = posterOk
          ? "/imagecache/" + fileName
          : "/images/no-poster-available.png";
      } else if (metadataOnlySync && seriesPosterUrl) {
        medCard.posterURL = "/imagecache/" + fileName;
      } else {
        medCard.posterURL = "/images/no-poster-available.png";
      }
      {
        const logoRef = this.logoImageRefForCache(md, posterSyncFull);
        if (pullLogo && logoRef) {
          const logoName = `${mediaId}-logo.png`;
          try {
            const ok = await this._cacheFirstImageUrl(
              this.logoImageFetchUrls(logoRef.itemId, logoRef.tag),
              logoName
            );
            if (ok) medCard.posterLogoURL = "/imagecache/" + logoName;
          } catch (e) {
            /* optional */
          }
        }
      }
      let jfBannerSeriesOk = false;
      if (
        pullBackground &&
        (EmbyJellyfinBase.hasBackdropImage(md) || probeVideoArt)
      ) {
        const artName = `${mediaId}-art.jpg`;
        try {
          const ok = await this._cacheImageFromServer(
            this.backdropImageUrl(md.Id, 0),
            artName
          );
          if (ok) medCard.posterArtURL = "/imagecache/" + artName;
        } catch (e) {
          /* optional */
        }
      }
      if (
        pullBackground &&
        (EmbyJellyfinBase.hasBannerImage(md) || probeVideoArt)
      ) {
        const bnName = `${mediaId}-banner.jpg`;
        try {
          const ok = await this._cacheImageFromServer(
            this.bannerImageUrl(md.Id, EmbyJellyfinBase.bannerImageTag(md)),
            bnName
          );
          if (ok) {
            jfBannerSeriesOk = true;
            if (!medCard.posterArtURL) {
              medCard.posterArtURL = "/imagecache/" + bnName;
            }
          }
        } catch (e) {
          /* optional */
        }
      }
      {
        const jfYear =
          md.ProductionYear ||
          (md.PremiereDate ? String(md.PremiereDate).slice(0, 4) : "");
        await tmdbBackdropFallback.cacheTmdbBannerIfNeeded({
          tmdbApiKey: opts && opts.tmdbApiKey,
          pullBackground,
          serverBannerOk: jfBannerSeriesOk,
          mediaType: "show",
          title: md.Name,
          year: jfYear,
          ...tmdbBackdropFallback.collectJellyfinProviderIds(md),
          bannerFileName: `${mediaId}-banner.jpg`,
          medCard,
          cacheImage: (u, f) => core.CacheImage(u, f),
        });
      }
      medCard.posterAR = 1.47;
      medCard.runTime = md.RunTimeTicks
        ? Math.round(md.RunTimeTicks / 6000000000)
        : 0;
      medCard.title = md.Name || "";
      medCard.mediaType = "show";
    } else if (type === "Movie") {
      const movieFileName = `${md.Id}.jpg`.replace(/[^a-zA-Z0-9._-]/g, "_");
      const primaryTag = md.ImageTags && md.ImageTags.Primary;
      const moviePosterUrl = this.primaryImageUrl(md.Id, primaryTag);
      medCard.posterDownloadURL = moviePosterUrl;
      if (pullVideoPoster) {
        let posterOk = false;
        if (EmbyJellyfinBase.hasPrimaryImage(md)) {
          posterOk = await this._cacheImageFromServer(
            moviePosterUrl,
            movieFileName
          );
        } else if (posterSyncFull) {
          const fallbackUrl = this.primaryImageUrl(md.Id, null);
          posterOk = await this._cacheImageFromServer(
            fallbackUrl,
            movieFileName
          );
          if (posterOk) medCard.posterDownloadURL = fallbackUrl;
        }
        medCard.posterURL = posterOk
          ? "/imagecache/" + movieFileName
          : "/images/no-poster-available.png";
      } else if (metadataOnlySync && moviePosterUrl) {
        medCard.posterURL = "/imagecache/" + movieFileName;
      } else {
        medCard.posterURL = "/images/no-poster-available.png";
      }
      {
        const logoRef = this.logoImageRefForCache(md, posterSyncFull);
        if (pullLogo && logoRef) {
          const logoMovie = movieFileName.replace(/\.jpe?g$/i, "") + "-logo.png";
          try {
            const ok = await this._cacheFirstImageUrl(
              this.logoImageFetchUrls(logoRef.itemId, logoRef.tag),
              logoMovie
            );
            if (ok) medCard.posterLogoURL = "/imagecache/" + logoMovie;
          } catch (e) {
            /* optional */
          }
        }
      }
      let jfBannerMovieOk = false;
      if (
        pullBackground &&
        (EmbyJellyfinBase.hasBackdropImage(md) || probeVideoArt)
      ) {
        const artName = `${md.Id}-art.jpg`.replace(/[^a-zA-Z0-9._-]/g, "_");
        try {
          const ok = await this._cacheImageFromServer(
            this.backdropImageUrl(md.Id, 0),
            artName
          );
          if (ok) medCard.posterArtURL = "/imagecache/" + artName;
        } catch (e) {
          /* optional */
        }
      }
      if (
        pullBackground &&
        (EmbyJellyfinBase.hasBannerImage(md) || probeVideoArt)
      ) {
        const bnName = `${md.Id}-banner.jpg`.replace(/[^a-zA-Z0-9._-]/g, "_");
        try {
          const ok = await this._cacheImageFromServer(
            this.bannerImageUrl(md.Id, EmbyJellyfinBase.bannerImageTag(md)),
            bnName
          );
          if (ok) {
            jfBannerMovieOk = true;
            if (!medCard.posterArtURL) {
              medCard.posterArtURL = "/imagecache/" + bnName;
            }
          }
        } catch (e) {
          /* optional */
        }
      }
      {
        const jfYear =
          md.ProductionYear ||
          (md.PremiereDate ? String(md.PremiereDate).slice(0, 4) : "");
        const bnMovie = `${md.Id}-banner.jpg`.replace(/[^a-zA-Z0-9._-]/g, "_");
        await tmdbBackdropFallback.cacheTmdbBannerIfNeeded({
          tmdbApiKey: opts && opts.tmdbApiKey,
          pullBackground,
          serverBannerOk: jfBannerMovieOk,
          mediaType: "movie",
          title: md.Name,
          year: jfYear,
          ...tmdbBackdropFallback.collectJellyfinProviderIds(md),
          bannerFileName: bnMovie,
          medCard,
          cacheImage: (u, f) => core.CacheImage(u, f),
        });
      }
      medCard.posterAR = 1.47;
      medCard.theme = "";
      medCard.title = md.Name || "";
      medCard.runTime = md.RunTimeTicks
        ? Math.round(md.RunTimeTicks / 6000000000)
        : 0;
      medCard.resCodec = "";
      medCard.audioCodec = "";
      medCard.tagLine = EmbyJellyfinBase.pickBaseItemTagline(md);
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
      if (pullAlbumPoster && EmbyJellyfinBase.hasPrimaryImage(md)) {
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
          albumFileName,
          medCard
        );
        medCard.posterURL = albumPoster || "/images/no-poster-available.png";
      } else if (metadataOnlySync) {
        medCard.posterURL = "/imagecache/" + albumFileName;
      } else {
        medCard.posterURL = "/images/no-poster-available.png";
      }
      if (pullBackground && EmbyJellyfinBase.hasBackdropImage(md)) {
        const artName = `${md.Id}-art.jpg`.replace(/[^a-zA-Z0-9._-]/g, "_");
        try {
          await this._cacheImageFromServer(
            this.backdropImageUrl(md.Id, 0),
            artName
          );
          medCard.posterArtURL = "/imagecache/" + artName;
        } catch (e) {
          /* optional */
        }
      }
      if (pullBackground && EmbyJellyfinBase.hasBannerImage(md)) {
        const bnName = `${md.Id}-banner.jpg`.replace(/[^a-zA-Z0-9._-]/g, "_");
        try {
          await this._cacheImageFromServer(
            this.bannerImageUrl(md.Id, EmbyJellyfinBase.bannerImageTag(md)),
            bnName
          );
          if (!medCard.posterArtURL) {
            medCard.posterArtURL = "/imagecache/" + bnName;
          }
        } catch (e) {
          /* optional */
        }
      }
      {
        const logoRef = this.logoImageRefForCache(md, posterSyncFull);
        if (pullLogo && logoRef) {
          const logoAlb = `${md.Id}-logo.png`.replace(/[^a-zA-Z0-9._-]/g, "_");
          try {
            const ok = await this._cacheFirstImageUrl(
              this.logoImageFetchUrls(logoRef.itemId, logoRef.tag),
              logoAlb
            );
            if (ok) medCard.posterLogoURL = "/imagecache/" + logoAlb;
          } catch (e) {
            /* optional */
          }
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
    medCard.tags = extractEmbyTags(md);
    medCard.summary = md.Overview || "";
    medCard.cast = util.formatCastFromEmbyPeople(md.People);
    medCard.directors = util.formatDirectorsFromEmbyPeople(md.People);
    {
      const cp = String(medCard.cast || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      medCard.actor1 = cp[0] || "";
      medCard.actor2 = cp[1] || "";
    }
    medCard.cardType = md.ctype;

    const odPortraitKey = String(medCard.DBID || md.Id || "x").replace(
      /[^a-zA-Z0-9._-]/g,
      "_"
    );
    await this.cacheItemPersonPortraits(
      medCard,
      md,
      odPortraitKey,
      imagePull
    );

    if (md.Id) medCard.posterApiItemId = String(md.Id);

    odCards.push(medCard);
    completedBatchCards.push(medCard);
    if (sp) {
      sp.processed = Math.min(sp.total || 0, (sp.processed || 0) + 1);
    }
    if (posterSyncFull && sp && sp.libraries) {
      const lr = posterSyncLib.findLibraryRow(
        sp.libraries,
        medCard.posterLibraryLabel
      );
      if (lr && lr.cacheStatus !== "skipped") {
        lr.cacheStatus = "running";
        lr.itemsCached = (lr.itemsCached || 0) + 1;
        if (lr.cacheTotal > 0 && lr.itemsCached >= lr.cacheTotal) {
          lr.cacheStatus = "done";
        }
      }
    }
    if (posterSyncFull && sp) {
      const n = odCards.length;
      const total = sp.total || getProgressTotal();
      const step = Math.max(25, Math.min(500, Math.floor(total / 15) || 1));
      if (n === 1 || n >= total || n % step === 0) {
        const t = medCard.mediaType || String(type || "").toLowerCase() || "?";
        const title = String(medCard.title || "").slice(0, 72);
          console.log(
          new Date().toLocaleString() +
            " [poster sync]" +
            runTag +
            " " +
            n +
            "/" +
            total +
            " " +
            t +
            ' — "' +
            title +
            '"'
        );
      }
    }
      checkPosterSyncAborted(opts, posterSyncFull, sp);
    }
    if (onPosterSyncBatch && completedBatchCards.length > 0) {
    await onPosterSyncBatch(completedBatchCards, batchMeta);
    }
  }

  async GetAllMediaForLibrary(
    libEntry,
    genres,
    recentlyAdded,
    contentRatings,
    syncProgress,
    metadataOnlySync,
    streamOptions = null
  ) {
    const runTag =
      syncProgress && syncProgress.runId
        ? ` [run ${syncProgress.runId}]`
        : "";
    let fetchRow = null;
    if (syncProgress && syncProgress.libraries) {
      fetchRow = posterSyncLib.findLibraryRow(
        syncProgress.libraries,
        libEntry.name
      );
      if (fetchRow && fetchRow.fetchStatus !== "skipped") {
        fetchRow.fetchStatus = "loading";
      }
    }
    if (syncProgress) {
      console.log(
        new Date().toLocaleString() +
          ` [poster sync]${runTag} ${this.appName} — user id + item list for library “${libEntry.name || libEntry.id}”…`
      );
    }
    const userId = await this.getUserId();
    const includeTypes = this.includeItemTypesForCollection(libEntry.collectionType);

    // Jellyfin omits Taglines (and often a useful Overview) on /Items unless Fields includes them.
    // Use current ItemFields names only (Jellyfin 10.9+ rejects legacy enum strings with HTTP 400).
    const baseParams = {
      ParentId: libEntry.id,
      Recursive: true,
      IncludeItemTypes: EmbyJellyfinBase.splitCsvTypes(includeTypes),
    };
    // Cast (People) + marketing taglines + plot text; same field set for full and metadata-only sync.
    baseParams.Fields = "People,Taglines,Overview,Genres";

    const streaming =
      streamOptions && typeof streamOptions.onPage === "function";
    const streamPageSize = streaming
      ? Number.isFinite(streamOptions.pageSize)
        ? Math.max(25, Math.min(500, Number(streamOptions.pageSize)))
        : POSTER_SYNC_STREAM_CHUNK_SIZE
      : POSTER_SYNC_STREAM_CHUNK_SIZE;
    let metadataEmittedThisLib = 0;
    let serverRowsSeen = 0;

    let all = [];
    let start = 0;
    const limit = metadataOnlySync
      ? LIBRARY_ITEMS_PAGE_LIMIT_METADATA_ONLY
      : LIBRARY_ITEMS_PAGE_LIMIT;
    let firstPageLimit = Math.min(
      limit,
      this._libraryFirstPageLimitHint != null
        ? this._libraryFirstPageLimitHint
        : LIBRARY_ITEMS_FIRST_PAGE_LIMIT
    );
    const firstPageFallbackFloor = metadataOnlySync
      ? Math.min(limit, LIBRARY_ITEMS_FIRST_PAGE_FALLBACK_LIMIT_METADATA_ONLY)
      : Math.min(limit, LIBRARY_ITEMS_FIRST_PAGE_FALLBACK_LIMIT);
    let firstPageFallbackAttempts = 0;
    /** Avoid infinite loop if StartIndex is ignored or broken (would return full limit forever). */
    const maxPages = 20000;
    let page = 0;
    while (true) {
      page++;
      const pageLimit = streaming
        ? page === 1
          ? Math.min(firstPageLimit, streamPageSize)
          : streamPageSize
        : page === 1
          ? firstPageLimit
          : limit;
      const pageTimeoutMs =
        page === 1
          ? LIBRARY_ITEMS_FIRST_PAGE_TIMEOUT_MS
          : LIBRARY_ITEMS_CONTINUATION_PAGE_TIMEOUT_MS;
      const pageMaxRetries =
        page === 1
          ? LIBRARY_ITEMS_FIRST_PAGE_HTTP_RETRIES
          : LIBRARY_ITEMS_CONTINUATION_MAX_RETRIES;
      if (page > maxPages) {
        console.log(
          new Date().toLocaleString() +
            ` [poster sync] ✘✘ WARNING ✘✘ — pagination stopped after ${maxPages} pages (~${
              streaming ? serverRowsSeen : all.length
            } items) in “${libEntry.name}” to avoid a runaway loop. Check Jellyfin / network.`
        );
        break;
      }
      if (syncProgress) {
        syncProgress.label = `Fetching “${libEntry.name}”… ${
          streaming ? serverRowsSeen : all.length
        } items so far`;
        if (page === 1 || page % 15 === 1) {
          console.log(
            new Date().toLocaleString() +
              ` [poster sync]${runTag} “${libEntry.name}” — GET /Users/${userId}/Items StartIndex=${start} Limit=${pageLimit} (client timeout ${Math.round(
                pageTimeoutMs / 60000
              )} min per request; first page can look idle until Jellyfin responds)…`
          );
        }
      }
      let chunk;
      try {
        chunk = await this.apiGet(`/Users/${userId}/Items`, {
          timeoutMs: pageTimeoutMs,
          maxRetries: pageMaxRetries,
          params: { ...baseParams, StartIndex: start, Limit: pageLimit },
        });
      } catch (e) {
        const isFirstPageFallbackCandidate =
          page === 1 &&
          firstPageFallbackAttempts < 2 &&
          pageLimit > firstPageFallbackFloor;
        const status = e && e.response ? Number(e.response.status) : 0;
        const msg = String((e && e.message) || "").toLowerCase();
        const isRetriableFirstPageError =
          e &&
          (e.code === "ECONNABORTED" ||
            msg.includes("timeout") ||
            status >= 500);
        if (isFirstPageFallbackCandidate && isRetriableFirstPageError) {
          const halved = Math.floor(pageLimit / 2);
          firstPageLimit = Math.max(
            1,
            Math.min(pageLimit - 1, Math.max(firstPageFallbackFloor, halved))
          );
          // Persist a lower first-page hint for later libraries in this sync run.
          this._libraryFirstPageLimitHint = this._libraryFirstPageLimitHint == null
            ? firstPageLimit
            : Math.min(this._libraryFirstPageLimitHint, firstPageLimit);
          firstPageFallbackAttempts += 1;
          console.log(
            new Date().toLocaleString() +
              ` [poster sync]${runTag} ${this.appName} — “${libEntry.name || libEntry.id}” first page retry ${firstPageFallbackAttempts}/2 with smaller limit (${firstPageLimit}) after ${e.code || status || "request error"}`
          );
          continue;
        }
        throw e;
      }
      const items = chunk.Items || [];
      if (streaming) {
        serverRowsSeen += items.length;
        let toSend = filterMediaItemsForOdemandFilters(
          items,
          genres,
          recentlyAdded,
          contentRatings
        );
        for (const m of toSend) {
          m._jfLibraryName = libEntry.name;
        }
        if (
          metadataOnlySync &&
          METADATA_ONLY_MAX_ITEMS_PER_LIBRARY > 0 &&
          metadataEmittedThisLib >= METADATA_ONLY_MAX_ITEMS_PER_LIBRARY
        ) {
          if (syncProgress) {
            console.log(
              new Date().toLocaleString() +
                ` [poster sync]${runTag} ${this.appName} — “${libEntry.name}” metadata-only cap reached (${METADATA_ONLY_MAX_ITEMS_PER_LIBRARY}); stopping early`
            );
          }
          break;
        }
        if (
          metadataOnlySync &&
          METADATA_ONLY_MAX_ITEMS_PER_LIBRARY > 0 &&
          toSend.length > 0
        ) {
          const room = METADATA_ONLY_MAX_ITEMS_PER_LIBRARY - metadataEmittedThisLib;
          if (room <= 0) {
            break;
          }
          if (toSend.length > room) {
            toSend = toSend.slice(0, room);
          }
        }
        if (page === 1 && fetchRow && fetchRow.fetchStatus !== "skipped") {
          const trc = chunk.TotalRecordCount;
          if (Number.isFinite(trc) && trc >= 0) {
            fetchRow.itemsFound = trc;
          }
        }
        if (page === 1 && typeof streamOptions.onLibraryTotal === "function") {
          const trc = chunk.TotalRecordCount;
          if (Number.isFinite(trc) && trc >= 0) {
            streamOptions.onLibraryTotal(libEntry.name, trc);
          }
        }
        if (toSend.length > 0) {
          await streamOptions.onPage(toSend);
          metadataEmittedThisLib += toSend.length;
        }
        if (syncProgress) {
          const logOften = page <= 3 || page % 10 === 0 || items.length < pageLimit;
          if (logOften) {
            console.log(
              new Date().toLocaleString() +
                ` [poster sync]${runTag} “${libEntry.name}” — page ${page}, +${items.length} rows from API, ${serverRowsSeen} cumulative (streamed fetch)`
            );
          }
        }
        if (items.length < pageLimit) {
          break;
        }
        start += items.length;
        continue;
      }

      all = all.concat(items);
      if (
        metadataOnlySync &&
        METADATA_ONLY_MAX_ITEMS_PER_LIBRARY > 0 &&
        all.length >= METADATA_ONLY_MAX_ITEMS_PER_LIBRARY
      ) {
        all = all.slice(0, METADATA_ONLY_MAX_ITEMS_PER_LIBRARY);
        if (syncProgress) {
          console.log(
            new Date().toLocaleString() +
              ` [poster sync]${runTag} ${this.appName} — “${libEntry.name}” metadata-only cap reached (${METADATA_ONLY_MAX_ITEMS_PER_LIBRARY}); stopping early`
          );
        }
        break;
      }
      if (syncProgress) {
        const logOften = page <= 3 || page % 10 === 0 || items.length < pageLimit;
        if (logOften) {
          console.log(
            new Date().toLocaleString() +
              ` [poster sync]${runTag} “${libEntry.name}” — page ${page}, +${items.length} rows, total ${all.length}`
          );
        }
      }
      if (items.length < pageLimit) break;
      start += pageLimit;
    }

    if (!streaming) {
      all = filterMediaItemsForOdemandFilters(
        all,
        genres,
        recentlyAdded,
        contentRatings
      );
    }

    if (fetchRow && fetchRow.fetchStatus !== "skipped") {
      fetchRow.fetchStatus = "done";
      if (!streaming) {
        fetchRow.itemsFound = all.length;
      }
    }
    return all;
  }

  async GetOnDemandRawData(
    onDemandLibraries,
    numberOnDemand,
    genres,
    recentlyAdded,
    contentRating,
    fullLibraryForPosterSync,
    syncProgress,
    metadataOnlySync = false
  ) {
    const runTag =
      syncProgress && syncProgress.runId
        ? ` [run ${syncProgress.runId}]`
        : "";
    let odSet = [];
    try {
      if (syncProgress) {
        console.log(
          new Date().toLocaleString() +
            ` [poster sync]${runTag} ${this.appName} — GET /Library/MediaFolders (match configured libraries)…`
        );
      }
      const libEntries = await this.GetLibraryKeys(onDemandLibraries);
      if (syncProgress) {
        console.log(
          new Date().toLocaleString() +
            ` [poster sync]${runTag} ${this.appName} — ${libEntries.length} library folder(s) matched; loading items…`
        );
        syncProgress.libraries = posterSyncLib.buildLibraryProgressRows(
          onDemandLibraries,
          libEntries,
          (e) => e.name,
          (e) => e.name
        );
      }
      for (const entry of libEntries) {
        const result = await this.GetAllMediaForLibrary(
          entry,
          genres,
          recentlyAdded,
          contentRating,
          syncProgress,
          metadataOnlySync
        );
        const od = await util.build_random_od_set(
          numberOnDemand,
          result,
          recentlyAdded,
          fullLibraryForPosterSync ? { includeAll: true } : undefined
        );
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
    contentRatings,
    opts
  ) {
    const posterSyncFull = opts && opts.posterSyncFullLibrary === true;
    const metadataOnlySync = posterSyncFull && opts && opts.metadataOnlySync === true;
    const enrichDetails =
      posterSyncFull &&
      !metadataOnlySync &&
      (opts && opts.posterSyncEnrichDetails !== undefined
        ? opts.posterSyncEnrichDetails === true
        : FULL_SYNC_ENRICH_DETAILS);
    const sp = opts && opts.syncProgress;
    const runTag = sp && sp.runId ? ` [run ${sp.runId}]` : "";
    const imagePull = (opts && opts.imagePull) || {};
    if (posterSyncFull && sp) {
      sp.phase = "fetching";
      sp.label = "Fetching library from media server…";
      sp.processed = 0;
      sp.total = 0;
    }
    const effHasArt = posterSyncFull ? "true" : hasArt;
    const pullBackground = effHasArt === "true" && imagePull.background !== false;
    const pullLogo = effHasArt === "true" && imagePull.logo !== false;
    const pullVideoPoster = imagePull.videoPoster !== false;
    const pullAlbumPoster = imagePull.albumPoster !== false;

    let odCards = [];
    let odRaw;
    let posterStreamUsed = false;
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
      if (posterSyncFull) {
        if (sp) {
          const now = new Date();
          console.log(
            now.toLocaleString() +
              " [poster sync]" +
              runTag +
              " " +
              this.appName +
              " — fetching full library list…"
          );
          if (!enrichDetails) {
            console.log(
              now.toLocaleString() +
                " [poster sync]" +
                runTag +
                " " +
                this.appName +
                " — full sync detail enrich is OFF (faster mode)"
            );
          }
        }
        const onPosterSyncBatchEarly =
          opts && typeof opts.onPosterSyncBatch === "function"
            ? opts.onPosterSyncBatch
            : null;
        const usePosterStreamChunking =
          !!onPosterSyncBatchEarly &&
          opts.posterSyncStreamChunks !== false &&
          !(
            opts.retryLibraryKeysFromLastSync &&
            opts.retryLibraryKeysFromLastSync.length
          );
        if (usePosterStreamChunking) {
          try {
          posterStreamUsed = true;
          if (sp) {
            const nowS = new Date();
            console.log(
              nowS.toLocaleString() +
                " [poster sync]" +
                runTag +
                " " +
                this.appName +
                " — streaming library fetch (" +
                POSTER_SYNC_STREAM_CHUNK_SIZE +
                " Items per HTTP page; DB write after each chunk; already-synced rows skipped)…"
            );
          }
          odRaw = [];
          let streamDbFlushSeq = 0;
          let plannedGrandTotal = 0;
          const libEntries = await this.GetLibraryKeys(onDemandLibraries);
          if (sp) {
            sp.libraries = posterSyncLib.buildLibraryProgressRows(
              onDemandLibraries,
              libEntries,
              (e) => e.name,
              (e) => e.name
            );
            sp.phase = "caching";
            sp.label = metadataOnlySync
              ? "Syncing metadata…"
              : "Caching posters and images…";
          }
          const streamRetrySet =
            opts && Array.isArray(opts.retryLibraryKeysFromLastSync)
              ? new Set(
                  opts.retryLibraryKeysFromLastSync.map((k) => String(k))
                )
              : null;
          for (const entry of libEntries) {
            await this.GetAllMediaForLibrary(
              entry,
              genres,
              0,
              contentRatings,
              sp,
              metadataOnlySync,
              {
                pageSize: POSTER_SYNC_STREAM_CHUNK_SIZE,
                onLibraryTotal: (libName, trc) => {
                  const lr = posterSyncLib.findLibraryRow(sp.libraries, libName);
                  if (lr && Number.isFinite(trc) && trc >= 0) {
                    lr.cacheTotal = trc;
                    lr.itemsCached = 0;
                    lr.cacheStatus =
                      lr.fetchStatus === "skipped"
                        ? "skipped"
                        : trc > 0
                          ? "pending"
                          : "done";
                    plannedGrandTotal += trc;
                    if (sp) {
                      sp.total = plannedGrandTotal;
                    }
                  }
                },
                onPage: async (pageItems) => {
                  streamDbFlushSeq += 1;
                  if (sp) {
                    const batchPrefix = metadataOnlySync
                      ? "Syncing metadata… chunk "
                      : "Caching posters and images… chunk ";
                    sp.label =
                      batchPrefix +
                      streamDbFlushSeq +
                      " (" +
                      pageItems.length +
                      " titles)";
                    console.log(
                      new Date().toLocaleString() +
                        " [poster sync]" +
                        runTag +
                        " " +
                        this.appName +
                        " — stream chunk " +
                        streamDbFlushSeq +
                        " (" +
                        pageItems.length +
                        " items)"
                    );
                  }
                  await this._posterSyncProcessRawMdList(pageItems, {
                    posterSyncFull,
                    metadataOnlySync,
                    enrichDetails,
                    opts,
                    sp,
                    runTag,
                    retrySet: streamRetrySet,
                    pullBackground,
                    pullLogo,
                    pullVideoPoster,
                    pullAlbumPoster,
                    odCards,
                    onPosterSyncBatch: onPosterSyncBatchEarly,
                    batchMeta: {
                      batchIndex: streamDbFlushSeq,
                      totalBatches: null,
                    },
                    getProgressTotal: () =>
                      Math.max((sp && sp.total) || 0, odCards.length || 0),
                    imagePull,
                  });
                },
              }
            );
          }
          odRaw = odCards;
          if (sp) {
            const nowE = new Date();
            console.log(
              nowE.toLocaleString() +
                " [poster sync]" +
                runTag +
                " " +
                this.appName +
                " — streaming pass done — " +
                (plannedGrandTotal || odCards.length) +
                " item(s) reported by Jellyfin; " +
                odCards.length +
                " title(s) processed this run (" +
                onDemandLibraries +
                ")"
            );
          }
          } catch (e) {
            if (!(e instanceof PosterSyncAbortedError)) {
              throw e;
            }
          }
        } else {
          odRaw = await this.GetOnDemandRawData(
            onDemandLibraries,
            numberOnDemand,
            genres,
            0,
            contentRatings,
            true,
            sp,
            metadataOnlySync
          );
        }
      } else if (recentlyAdded > 0) {
        odRaw = await this.GetOnDemandRawData(
          onDemandLibraries,
          numberOnDemand,
          genres,
          recentlyAdded,
          contentRatings,
          false,
          false
        );
        if (odRaw !== undefined) {
          odRaw = odRaw.concat(
            await this.GetOnDemandRawData(
              onDemandLibraries,
              numberOnDemand,
              genres,
              0,
              contentRatings,
              false,
              false
            )
          );
        } else {
          odRaw = await this.GetOnDemandRawData(
            onDemandLibraries,
            numberOnDemand,
            genres,
            0,
            contentRatings,
            false,
            false
          );
        }
      } else {
        odRaw = await this.GetOnDemandRawData(
          onDemandLibraries,
          numberOnDemand,
          genres,
          0,
          contentRatings,
          false,
          false
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

    if ((!odRaw || odRaw.length === 0) && !posterStreamUsed) {
      if (posterSyncFull && sp) {
        sp.total = 0;
        sp.processed = 0;
        sp.phase = "complete";
        sp.label = "No titles to sync";
        if (sp.libraries) {
          for (const row of sp.libraries) {
            row.cacheTotal = 0;
            row.itemsCached = 0;
            row.cacheStatus =
              row.fetchStatus === "skipped" ? "skipped" : "done";
          }
        }
      }
      let now = new Date();
      if (onDemandLibraries && String(onDemandLibraries).trim()) {
        console.log(now.toLocaleString() + " *On-demand - No results returned - check library names or filters");
      }
      return odCards;
    }

    if (
      !posterStreamUsed &&
      posterSyncFull &&
      opts &&
      Array.isArray(opts.retryLibraryKeysFromLastSync) &&
      opts.retryLibraryKeysFromLastSync.length &&
      odRaw &&
      odRaw.length > 0
    ) {
      const kind = String(opts.posterSyncServerKind || "jellyfin")
        .toLowerCase()
        .trim();
      odRaw = posterSyncRetry.prioritizeOdRaw(
        odRaw,
        opts.retryLibraryKeysFromLastSync,
        kind
      );
      const nowJ = new Date();
      console.log(
        nowJ.toLocaleString() +
          " [poster sync] " +
          this.appName +
          " — prioritizing " +
          opts.retryLibraryKeysFromLastSync.length +
          " id(s) from last sync (missing images/metadata)"
      );
    }

    if (posterSyncFull && sp && !posterStreamUsed) {
      sp.total = odRaw.length;
      sp.phase = "caching";
      sp.label = metadataOnlySync
        ? "Syncing metadata…"
        : "Caching posters and images…";
      const counts = posterSyncLib.countItemsByLibraryFields(odRaw, [
        "_jfLibraryName",
      ]);
      for (const row of sp.libraries || []) {
        row.cacheTotal = counts[row.name] || 0;
        row.itemsCached = 0;
        if (row.fetchStatus === "skipped") {
          row.cacheStatus = "skipped";
        } else {
          row.cacheStatus = row.cacheTotal > 0 ? "pending" : "done";
        }
      }
      const now = new Date();
      console.log(
        now.toLocaleString() +
          " [poster sync]" +
          runTag +
          " " +
          this.appName +
          " — " +
          odRaw.length +
          " item(s) to download (" +
          onDemandLibraries +
          ")"
      );
    }

    const odBatches =
      posterSyncFull && posterStreamUsed
        ? []
        : posterSyncFull
          ? Array.from(
              { length: Math.ceil(odRaw.length / POSTER_SYNC_BATCH_SIZE) },
              (_, i) =>
                odRaw.slice(
                  i * POSTER_SYNC_BATCH_SIZE,
                  (i + 1) * POSTER_SYNC_BATCH_SIZE
                )
            )
          : [odRaw];
    const totalBatches = odBatches.length;
    const retrySet =
      posterSyncFull &&
      opts &&
      Array.isArray(opts.retryLibraryKeysFromLastSync)
        ? new Set(opts.retryLibraryKeysFromLastSync.map((k) => String(k)))
        : null;
    const onPosterSyncBatch =
      posterSyncFull && opts && typeof opts.onPosterSyncBatch === "function"
        ? opts.onPosterSyncBatch
        : null;

    syncBatches: for (let batchIdx = 0; batchIdx < totalBatches; batchIdx++) {
      const batch = odBatches[batchIdx];
      if (posterSyncFull && sp) {
        const batchPrefix = metadataOnlySync
          ? "Syncing metadata… batch "
          : "Caching posters and images… batch ";
        sp.label =
          batchPrefix +
          (batchIdx + 1) +
          "/" +
          totalBatches;
        console.log(
          new Date().toLocaleString() +
            " [poster sync]" +
            runTag +
            " " +
            this.appName +
            " — processing batch " +
            (batchIdx + 1) +
            "/" +
            totalBatches +
            " (" +
            batch.length +
            " items)"
        );
      }
      try {
        checkPosterSyncAborted(opts, posterSyncFull, sp);
      } catch (e) {
        if (e instanceof PosterSyncAbortedError) {
          break syncBatches;
        }
        throw e;
      }
      try {
        await this._posterSyncProcessRawMdList(batch, {
          posterSyncFull,
          metadataOnlySync,
          enrichDetails,
          opts,
          sp,
          runTag,
          retrySet,
          pullBackground,
          pullLogo,
          pullVideoPoster,
          pullAlbumPoster,
          odCards,
          onPosterSyncBatch,
          batchMeta: {
            batchIndex: batchIdx + 1,
            totalBatches,
          },
          getProgressTotal: () =>
            Math.max((sp && sp.total) || 0, (odRaw && odRaw.length) || 0),
          imagePull,
        });
      } catch (e) {
        if (e instanceof PosterSyncAbortedError) {
          break syncBatches;
        }
        throw e;
      }
    }

    let now = new Date();
    if (odCards.length === 0) {
      console.log(now.toLocaleString() + " No On-demand titles available");
    } else if (posterSyncFull) {
      console.log(
        now.toLocaleString() +
          " [poster sync]" +
          runTag +
          " " +
          this.appName +
          " — finished caching " +
          odCards.length +
          " item(s) from (" +
          onDemandLibraries +
          ")" +
          (opts &&
          typeof opts.posterSyncAbortCheck === "function" &&
          opts.posterSyncAbortCheck()
            ? " (aborted)"
            : "")
      );
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
  async cacheItemPersonPortraits(medCard, item, safePrefix, imagePull) {
    const safe = String(safePrefix || "x").replace(/[^a-zA-Z0-9._-]/g, "_");
    const people = item.People || item.people || [];
    const pull = imagePull || {};
    const pullCast = pull.castPortrait !== false;
    const pullDirector = pull.directorPortrait !== false;
    const pullAuthor = pull.authorPortrait !== false;
    const pullArtist = pull.artistPortrait !== false;

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
        await this._cacheImageFromServer(
          this.primaryImageUrl(pid, tag || null),
          fn
        );
        return "/imagecache/" + fn;
      } catch (e) {
        return "";
      }
    };

    const actors = people.filter((p) => (p.Type || p.type || "") === "Actor");
    if (pullCast) {
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
    }

    const dirs = people.filter((p) => (p.Type || p.type || "") === "Director");
    if (pullDirector && dirs[0]) {
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
    if (pullAuthor && writers[0]) {
      medCard.portraitAuthorURL = await cachePerson(writers[0], "author");
      medCard.featuredAuthorName = writers[0].Name || writers[0].name || "";
      medCard.featuredAuthorCredits = await this.getPersonCredits(
        writers[0].Id || writers[0].id,
        5,
        "Book,AudioBook,Series"
      );
    }

    const albumArtists = item.AlbumArtists || item.albumArtists;
    if (pullArtist && albumArtists && albumArtists[0]) {
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
          await this._cacheImageFromServer(
            this.primaryImageUrl(pid, tag || null),
            fn
          );
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
        timeoutMs: LIBRARY_ITEMS_PAGE_TIMEOUT_MS,
        maxRetries: 1,
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

  /**
   * True if a cached poster row's library item no longer exists on Jellyfin/Emby.
   * @param {{ apiItemId?: string, sourceUrl?: string }} entry
   */
  async posterMetadataEntryGone(entry) {
    const { probeImageUrlGone } = require("../core/posterMetadataProbe");
    const id = String(entry.apiItemId || "").trim();
    if (id) {
      try {
        const userId = await this.getUserId();
        await this.apiGet(`/Users/${userId}/Items/${encodeURIComponent(id)}`, {
          timeoutMs: 12000,
        });
        return false;
      } catch (e) {
        const st = e.response && e.response.status;
        if (st === 404 || st === 410) return true;
        return false;
      }
    }
    return probeImageUrlGone(entry.sourceUrl);
  }
}

module.exports = EmbyJellyfinBase;
