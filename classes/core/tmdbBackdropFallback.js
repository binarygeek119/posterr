const axios = require("axios");

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMG_W1280 = "https://image.tmdb.org/t/p/w1280";

/** In-process cache to limit duplicate TMDB calls during large syncs. */
const backdropUrlCache = new Map();

function cacheGet(key) {
  return backdropUrlCache.has(key) ? backdropUrlCache.get(key) : undefined;
}

function cacheSet(key, val) {
  if (backdropUrlCache.size > 6000) backdropUrlCache.clear();
  backdropUrlCache.set(key, val);
}

async function fetchJson(url, params) {
  const r = await axios.get(url, { params, timeout: 20000 });
  return r.data;
}

function backdropPathToUrl(p) {
  if (!p || typeof p !== "string") return null;
  return TMDB_IMG_W1280 + p;
}

/**
 * Parse Plex agent guids (md.guid and md.Guid[]) for TMDB / IMDb / TVDB ids.
 * @param {object} md Plex metadata object
 */
function collectPlexExternalIds(md) {
  const out = {};
  const list = [];
  if (md && md.Guid && Array.isArray(md.Guid)) {
    for (const g of md.Guid) {
      const id = g && (g.id || g.Id);
      if (id) list.push(String(id));
    }
  }
  if (md && md.guid) list.push(String(md.guid));
  for (const s of list) {
    const str = String(s || "");
    let m = str.match(/themoviedb:\/\/(\d+)/i);
    if (m) out.tmdbId = parseInt(m[1], 10);
    m = str.match(/imdb:\/\/(tt\d+)/i);
    if (m) out.imdbId = m[1];
    m = str.match(/imdb:\/\/(\d+)/i);
    if (m && !out.imdbId) out.imdbId = "tt" + m[1];
    m = str.match(/tvdb:\/\/(\d+)/i);
    if (m) out.tvdbId = m[1];
  }
  return out;
}

/**
 * Jellyfin / Emby ProviderIds.
 * @param {object} md Item from API
 */
function collectJellyfinProviderIds(md) {
  if (!md) return {};
  const p = md.ProviderIds || md.providerIds || {};
  const tRaw =
    p.Tmdb ||
    p.TMDB ||
    p.tmdb ||
    p.TmdbId ||
    p.TmdbID ||
    "";
  const tmdbId =
    tRaw !== "" && tRaw != null ? parseInt(String(tRaw).replace(/\D/g, ""), 10) : NaN;
  const imdbRaw = p.Imdb || p.IMDB || p.imdb || "";
  const tvdbRaw = p.Tvdb || p.TVDB || p.tvdb || "";
  return {
    tmdbId: !isNaN(tmdbId) && tmdbId > 0 ? tmdbId : undefined,
    imdbId: imdbRaw ? String(imdbRaw).trim() : undefined,
    tvdbId: tvdbRaw != null && tvdbRaw !== "" ? String(tvdbRaw).trim() : undefined,
  };
}

/**
 * Kodi movie / TV show item (imdbnumber, uniqueid map).
 * @param {object} md
 */
function collectKodiExternalIds(md) {
  if (!md) return {};
  const out = {};
  if (md.imdbnumber) {
    const im = String(md.imdbnumber).trim();
    out.imdbId = im.startsWith("tt") ? im : "tt" + im.replace(/^tt?/i, "");
  }
  const u = md.uniqueid;
  if (u && typeof u === "object") {
    if (u.tmdb && !out.tmdbId) {
      const t = parseInt(String(u.tmdb), 10);
      if (!isNaN(t) && t > 0) out.tmdbId = t;
    }
    if (u.imdb) out.imdbId = String(u.imdb).trim();
    if (u.tvdb) out.tvdbId = String(u.tvdb).trim();
  }
  return out;
}

async function getDetailsBackdrop(apiKey, tmdbNumericId, isTv) {
  const key = `${isTv ? "tv" : "m"}:${tmdbNumericId}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;
  const path = isTv ? `/tv/${tmdbNumericId}` : `/movie/${tmdbNumericId}`;
  try {
    const d = await fetchJson(`${TMDB_BASE}${path}`, { api_key: apiKey });
    const url = backdropPathToUrl(d.backdrop_path);
    cacheSet(key, url);
    return url;
  } catch (e) {
    cacheSet(key, null);
    return null;
  }
}

async function findByImdb(apiKey, imdbId) {
  const raw = String(imdbId || "").trim();
  if (!raw) return null;
  const tt = raw.startsWith("tt") ? raw : "tt" + raw.replace(/^tt?/i, "");
  const cacheKey = `find:imdb:${tt}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const d = await fetchJson(
      `${TMDB_BASE}/find/${encodeURIComponent(tt)}`,
      {
        api_key: apiKey,
        external_source: "imdb_id",
      }
    );
    const mv = d.movie_results && d.movie_results[0];
    const tv = d.tv_results && d.tv_results[0];
    let url = mv && backdropPathToUrl(mv.backdrop_path);
    if (!url && tv) url = backdropPathToUrl(tv.backdrop_path);
    cacheSet(cacheKey, url || null);
    return url || null;
  } catch (e) {
    cacheSet(cacheKey, null);
    return null;
  }
}

async function findByTvdb(apiKey, tvdbId) {
  const id = String(tvdbId || "").trim();
  if (!id) return null;
  const cacheKey = `find:tvdb:${id}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const d = await fetchJson(`${TMDB_BASE}/find/${encodeURIComponent(id)}`, {
      api_key: apiKey,
      external_source: "tvdb_id",
    });
    const tv = d.tv_results && d.tv_results[0];
    const url = tv && backdropPathToUrl(tv.backdrop_path);
    cacheSet(cacheKey, url || null);
    return url || null;
  } catch (e) {
    cacheSet(cacheKey, null);
    return null;
  }
}

async function searchByTitle(apiKey, title, yearStr, isTv) {
  const q = String(title || "").trim();
  if (!q) return null;
  const cacheKey = `search:${isTv ? "tv" : "mv"}:${q}|${yearStr || ""}`;
  const cached = cacheGet(cacheKey);
  if (cached !== undefined) return cached;
  const path = isTv ? "/search/tv" : "/search/movie";
  const params = {
    api_key: apiKey,
    query: q,
    include_adult: false,
    page: 1,
  };
  const y = parseInt(String(yearStr || "").slice(0, 4), 10);
  if (!isNaN(y) && y > 1800) {
    if (isTv) params.first_air_date_year = y;
    else params.year = y;
  }
  try {
    const d = await fetchJson(`${TMDB_BASE}${path}`, params);
    const results = (d && d.results) || [];
    for (const item of results.slice(0, 6)) {
      const u = backdropPathToUrl(item.backdrop_path);
      if (u) {
        cacheSet(cacheKey, u);
        return u;
      }
    }
    const first = results[0];
    if (first && first.id) {
      const u = await getDetailsBackdrop(apiKey, first.id, isTv);
      cacheSet(cacheKey, u || null);
      return u;
    }
    cacheSet(cacheKey, null);
    return null;
  } catch (e) {
    cacheSet(cacheKey, null);
    return null;
  }
}

/**
 * Resolve a TMDB backdrop (wide) image URL for movies or TV using ids or title search.
 * Skips music-only types.
 *
 * @param {{ apiKey: string, mediaType: string, title?: string, year?: string|number, tmdbId?: number, imdbId?: string, tvdbId?: string|number }} ctx
 * @returns {Promise<string|null>} HTTPS image URL or null
 */
async function resolveTmdbBackdropImageUrl(ctx) {
  const apiKey = String(ctx.apiKey || "").trim();
  if (!apiKey) return null;
  const mt = String(ctx.mediaType || "").toLowerCase();
  if (mt === "album" || mt === "track" || mt === "artist") return null;
  const isTv = mt === "show" || mt === "series" || mt === "episode";

  const tmdbRaw = ctx.tmdbId;
  const tmdbNum =
    tmdbRaw != null && tmdbRaw !== ""
      ? parseInt(String(tmdbRaw).replace(/\D/g, ""), 10)
      : NaN;
  if (!isNaN(tmdbNum) && tmdbNum > 0) {
    const u = await getDetailsBackdrop(apiKey, tmdbNum, isTv);
    if (u) return u;
  }

  if (ctx.imdbId) {
    const u = await findByImdb(apiKey, ctx.imdbId);
    if (u) return u;
  }

  if (isTv && ctx.tvdbId) {
    const u = await findByTvdb(apiKey, ctx.tvdbId);
    if (u) return u;
  }

  const year =
    ctx.year != null && ctx.year !== ""
      ? String(ctx.year).slice(0, 4)
      : "";
  return searchByTitle(apiKey, ctx.title, year, isTv);
}

/**
 * When the media server did not supply a banner, fetch a TMDB backdrop into imagecache.
 *
 * @param {{ tmdbApiKey: string, pullBackground: boolean, serverBannerOk: boolean, mediaType: string, title?: string, year?: string|number, tmdbId?: number, imdbId?: string, tvdbId?: string|number, bannerFileName: string, medCard: object, cacheImage: function }} p
 */
async function cacheTmdbBannerIfNeeded(p) {
  const key = String(p.tmdbApiKey || process.env.TMDB_API_KEY || "").trim();
  if (!p.pullBackground || !key || p.serverBannerOk) return;
  const mt = String(p.mediaType || "").toLowerCase();
  if (mt === "album") return;
  const bn = String(p.bannerFileName || "").trim();
  if (!bn || bn.includes("..") || /[\\/]/.test(bn)) return;

  const url = await resolveTmdbBackdropImageUrl({
    apiKey: key,
    mediaType: mt,
    title: p.title,
    year: p.year,
    tmdbId: p.tmdbId,
    imdbId: p.imdbId,
    tvdbId: p.tvdbId,
  });
  if (!url) return;
  try {
    await p.cacheImage(url, bn);
    if (!p.medCard.posterArtURL) {
      p.medCard.posterArtURL = "/imagecache/" + bn;
    }
  } catch (e) {
    /* optional */
  }
}

module.exports = {
  collectPlexExternalIds,
  collectJellyfinProviderIds,
  collectKodiExternalIds,
  resolveTmdbBackdropImageUrl,
  cacheTmdbBannerIfNeeded,
};
