const fs = require("fs");
const path = require("path");
const axios = require("axios");
const Cache = require("./cache");
const { CACHE_ROOT, CONFIG_ROOT } = require("./appPaths");

const DB_FILE = path.join(CONFIG_ROOT, "now-showing.db");
const LEGACY_CACHE_DB_FILE = path.join(CACHE_ROOT, "now-showing.db");
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE = "https://image.tmdb.org/t/p";

/** logo_url / banner_url store local /imagecache/... paths (image bytes stay on disk, never in DB). */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS now_showing_movies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tmdb_id INTEGER UNIQUE,
  title TEXT NOT NULL,
  year TEXT DEFAULT '',
  logo_url TEXT DEFAULT '',
  banner_url TEXT DEFAULT '',
  overview TEXT DEFAULT '',
  rating TEXT DEFAULT '',
  plot TEXT DEFAULT '',
  rating_score TEXT DEFAULT '',
  rating_content TEXT DEFAULT '',
  studio TEXT DEFAULT '',
  top_cast TEXT DEFAULT '',
  actor_1 TEXT DEFAULT '',
  actor_2 TEXT DEFAULT '',
  runtime_mins INTEGER DEFAULT 120,
  content_rating TEXT DEFAULT '',
  genres TEXT DEFAULT '',
  showtime_mode TEXT DEFAULT 'auto',
  manual_times TEXT DEFAULT '[]',
  auto_showings INTEGER DEFAULT 4,
  auto_seed_start TEXT DEFAULT '',
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT ''
);
`;
const EXTRA_SCHEMA_COLUMNS = [
  { name: "logo_cache_file", def: "TEXT DEFAULT ''" },
  { name: "banner_cache_file", def: "TEXT DEFAULT ''" },
  { name: "auto_schedule_day", def: "TEXT DEFAULT ''" },
  { name: "studio", def: "TEXT DEFAULT ''" },
  { name: "top_cast", def: "TEXT DEFAULT ''" },
  { name: "actor_1", def: "TEXT DEFAULT ''" },
  { name: "actor_2", def: "TEXT DEFAULT ''" },
  { name: "plot", def: "TEXT DEFAULT ''" },
  { name: "rating_score", def: "TEXT DEFAULT ''" },
  { name: "rating_content", def: "TEXT DEFAULT ''" },
  {
    name: "auto_generated_showtimes_json",
    def: "TEXT DEFAULT '[]'",
  },
  { name: "price_amount", def: "REAL" },
  { name: "price_auto_generated", def: "INTEGER DEFAULT 0" },
];

let _db = null;

function assertDb() {
  if (!_db) throw new Error("Now Showing DB not initialized");
}

function persistDb() {
  assertDb();
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, Buffer.from(_db.export()));
}

function ensureNowShowingExtraColumns() {
  assertDb();
  const existing = new Set();
  let changed = false;
  const s = _db.prepare("PRAGMA table_info(now_showing_movies)");
  while (s.step()) {
    const row = s.getAsObject();
    existing.add(String(row.name || "").toLowerCase());
  }
  s.free();
  for (const c of EXTRA_SCHEMA_COLUMNS) {
    if (!existing.has(c.name.toLowerCase())) {
      _db.run(`ALTER TABLE now_showing_movies ADD COLUMN ${c.name} ${c.def}`);
      changed = true;
    }
  }
  return changed;
}

function parseJsonSafe(v, fallback) {
  try {
    return JSON.parse(v);
  } catch (e) {
    return fallback;
  }
}

function parsePriceAmount(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function clampPriceBound(v, fallback) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.round(n * 100) / 100;
}

function randomPriceInRange(minRaw, maxRaw) {
  const min = clampPriceBound(minRaw, 5);
  const max = clampPriceBound(maxRaw, 20);
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (hi === lo) return lo;
  return Math.round((lo + Math.random() * (hi - lo)) * 100) / 100;
}

function parseReleaseYear(yearRaw) {
  const y = parseInt(String(yearRaw == null ? "" : yearRaw).trim(), 10);
  const current = new Date().getFullYear();
  if (!Number.isFinite(y) || y < 1888 || y > current + 1) return null;
  return y;
}

function autoPriceMultiplierForYear(yearRaw) {
  const y = parseReleaseYear(yearRaw);
  if (y == null) return 1;
  const age = Math.max(0, new Date().getFullYear() - y);
  if (age >= 60) return 0.8; // classic pricing
  if (age >= 20) return 0.2;
  if (age >= 10) return 0.5;
  if (age >= 5) return 0.8;
  return 1;
}

function autoPriceFromAge(minRaw, maxRaw, yearRaw) {
  const base = randomPriceInRange(minRaw, maxRaw);
  const mult = autoPriceMultiplierForYear(yearRaw);
  return Math.round(base * mult * 100) / 100;
}

function nowShowingImageCacheFileNames(tmdbId) {
  const tid = String(parseInt(tmdbId, 10) || 0);
  return {
    banner: `nowshowinglist-${tid}.jpg`,
    logo: `nowshowinglist-${tid}-logo.png`,
  };
}

function isLocalImageCachePath(v) {
  const s = String(v || "").trim();
  return s.startsWith("/imagecache/");
}

async function toLocalNowShowingAssetPath(tmdbId, sourceUrl, kind) {
  const src = String(sourceUrl || "").trim();
  if (!src) return "";
  if (isLocalImageCachePath(src)) return src;
  if (!/^https?:\/\//i.test(src)) return "";
  const names = nowShowingImageCacheFileNames(tmdbId);
  const fileName = kind === "logo" ? names.logo : names.banner;
  try {
    const ok = await Cache.CacheImage(src, fileName);
    if (ok) return "/imagecache/" + fileName;
  } catch (e) {
    /* ignore */
  }
  return "";
}

function rowFromDb(r) {
  const logoCache = r.logo_cache_file || "";
  const bannerCache = r.banner_cache_file || "";
  const logoLegacy = r.logo_url || "";
  const bannerLegacy = r.banner_url || "";
  return {
    id: Number(r.id),
    tmdbId: r.tmdb_id != null ? Number(r.tmdb_id) : null,
    title: r.title || "",
    year: r.year || "",
    logoUrl: logoCache || logoLegacy || "",
    bannerUrl: bannerCache || bannerLegacy || "",
    logoCacheFile: logoCache || "",
    bannerCacheFile: bannerCache || "",
    overview: r.overview || "",
    plot: r.plot || r.overview || "",
    rating: r.rating_score || r.rating || "",
    ratingScore: r.rating_score || r.rating || "",
    ratingContent: r.rating_content || r.content_rating || "",
    studio: r.studio || "",
    topCast: r.top_cast || "",
    actor1: r.actor_1 || "",
    actor2: r.actor_2 || "",
    runtimeMins: Number(r.runtime_mins) || 120,
    contentRating: r.rating_content || r.content_rating || "",
    genres: r.genres || "",
    showtimeMode: r.showtime_mode || "auto",
    manualTimes: parseJsonSafe(r.manual_times || "[]", []),
    autoShowings: Math.max(1, Math.min(6, Number(r.auto_showings) || 6)),
    autoSeedStart: r.auto_seed_start || "",
    autoScheduleDay: r.auto_schedule_day || "",
    autoGeneratedShowtimes: parseJsonSafe(
      r.auto_generated_showtimes_json || "[]",
      []
    ),
    priceAmount: parsePriceAmount(r.price_amount),
    priceAutoGenerated:
      Number(r.price_auto_generated) === 1 || String(r.price_auto_generated) === "1",
    createdAt: r.created_at || "",
    updatedAt: r.updated_at || "",
  };
}

function allRows() {
  assertDb();
  const out = [];
  const s = _db.prepare("SELECT * FROM now_showing_movies ORDER BY title ASC");
  while (s.step()) out.push(rowFromDb(s.getAsObject()));
  s.free();
  return out;
}

/** Local calendar date key YYYY-MM-DD (server local timezone). */
function localDateKey(d) {
  const x = d instanceof Date ? d : new Date(d);
  if (isNaN(x.getTime())) return "";
  const y = x.getFullYear();
  const m = String(x.getMonth() + 1).padStart(2, "0");
  const day = String(x.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function startOfLocalDay(d) {
  const x = d instanceof Date ? new Date(d.getTime()) : new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/** First instant of the next local calendar day (exclusive upper bound for “this day”). */
function endOfLocalDayExclusive(d) {
  const s = startOfLocalDay(d);
  s.setDate(s.getDate() + 1);
  return s;
}

/** Stable 0–89 minute offset after local midnight from title (per-title stagger). */
function dayStaggerMinutes(title) {
  let h = 0;
  const s = String(title || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 90;
}

function firstAutoSlotForLocalDay(title, refNow) {
  const ref = refNow instanceof Date ? refNow : new Date(refNow);
  const dayStart = startOfLocalDay(ref);
  return new Date(dayStart.getTime() + dayStaggerMinutes(title) * 60000);
}

/**
 * @param {string} [seedIso] First showtime of the day (local).
 * @param {Date} [dayEndExclusive] If set, omit slots at or after this instant (next midnight).
 */
function generateShowtimes(seedIso, count, runtimeMins, dayEndExclusive) {
  const seed = seedIso ? new Date(seedIso) : new Date();
  const rtRaw = Number(runtimeMins);
  const rt = rtRaw > 0 && !isNaN(rtRaw) ? rtRaw : 120;
  /** Minutes from one listed showtime start to the next (feature + turnaround). */
  const spacingMins = rt + 10;
  const out = [];
  let t = seed.getTime();
  const c = Number(count);
  const n = Number.isFinite(c)
    ? Math.max(1, Math.min(8, Math.floor(c)))
    : 6;
  const endMs =
    dayEndExclusive instanceof Date && !isNaN(dayEndExclusive.getTime())
      ? dayEndExclusive.getTime()
      : null;
  for (let i = 0; i < n; i++) {
    if (endMs != null && t >= endMs) break;
    out.push(new Date(t));
    t += spacingMins * 60000;
  }
  return out;
}

function formatTimes(dates) {
  return dates.map((d) =>
    d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
  );
}

/**
 * Parse a manual showtime string (e.g. "2:30 PM", "14:30") as today in refNow's calendar day.
 */
function parseManualShowtimeToDate(str, refNow) {
  const s = String(str || "").trim();
  if (!s) return null;
  const ref = refNow instanceof Date ? refNow : new Date(refNow);
  const y = ref.getFullYear();
  const mo = ref.getMonth();
  const da = ref.getDate();
  const pad = (n) => String(n).padStart(2, "0");
  const isoDate = `${y}-${pad(mo + 1)}-${pad(da)}`;
  let t = Date.parse(`${isoDate} ${s}`);
  if (!isNaN(t)) return new Date(t);
  t = Date.parse(`${isoDate}T${s}`);
  if (!isNaN(t)) return new Date(t);
  t = Date.parse(`${mo + 1}/${da}/${y} ${s}`);
  if (!isNaN(t)) return new Date(t);
  const long = ref.toLocaleString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
  t = Date.parse(`${long} ${s}`);
  if (!isNaN(t)) return new Date(t);
  const plain = Date.parse(s);
  if (!isNaN(plain)) {
    const d = new Date(plain);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

async function initNowShowingDb() {
  if (_db) return;
  const initSqlJs = require("sql.js");
  const wasmPath = path.join(
    path.dirname(require.resolve("sql.js/package.json")),
    "dist",
    "sql-wasm.wasm"
  );
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  let loadedFromLegacyCacheDb = false;
  if (fs.existsSync(DB_FILE)) {
    _db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else if (fs.existsSync(LEGACY_CACHE_DB_FILE)) {
    _db = new SQL.Database(fs.readFileSync(LEGACY_CACHE_DB_FILE));
    loadedFromLegacyCacheDb = true;
  } else {
    _db = new SQL.Database();
  }
  _db.exec(SCHEMA_SQL);
  const schemaChanged = ensureNowShowingExtraColumns();
  if (!fs.existsSync(DB_FILE) || loadedFromLegacyCacheDb) persistDb();
  if (loadedFromLegacyCacheDb) {
    try {
      const bak = LEGACY_CACHE_DB_FILE + ".migrated.bak";
      if (fs.existsSync(bak)) fs.unlinkSync(bak);
      fs.renameSync(LEGACY_CACHE_DB_FILE, bak);
      console.log(
        new Date().toLocaleString() +
          " Now Showing DB: migrated from config/cache → " +
          DB_FILE +
          "; backup at " +
          bak
      );
    } catch (e) {
      console.log(
        new Date().toLocaleString() +
          " Now Showing DB: could not rename legacy config/cache DB — " +
          (e && e.message ? e.message : e)
      );
    }
  }
  if (schemaChanged && fs.existsSync(DB_FILE) && !loadedFromLegacyCacheDb) {
    persistDb();
    console.log(
      new Date().toLocaleString() +
        " Now Showing DB: schema upgraded with cache path columns"
    );
  }
}

function tmdbApiKey(overrideKey) {
  const k = String(overrideKey || "").trim();
  if (k) return k;
  return String(process.env.TMDB_API_KEY || "").trim();
}

async function searchTmdbMovies(query, overrideKey) {
  const key = tmdbApiKey(overrideKey);
  if (!key) throw new Error("TMDB_API_KEY is missing");
  const q = String(query || "").trim();
  if (!q) return [];
  const r = await axios.get(`${TMDB_BASE}/search/movie`, {
    params: { api_key: key, query: q, include_adult: false, page: 1 },
    timeout: 20000,
  });
  const items = (r.data && r.data.results) || [];
  return items.slice(0, 20).map((m) => ({
    tmdbId: m.id,
    title: m.title || m.name || "",
    year: m.release_date ? String(m.release_date).slice(0, 4) : "",
    rating:
      m.vote_average != null && !isNaN(m.vote_average)
        ? Math.round(Number(m.vote_average) * 10) + "%"
        : "",
    overview: m.overview || "",
    bannerUrl: m.backdrop_path ? `${TMDB_IMAGE}/w780${m.backdrop_path}` : "",
    posterUrl: m.poster_path ? `${TMDB_IMAGE}/w342${m.poster_path}` : "",
  }));
}

async function getTmdbMovieDetails(tmdbId, overrideKey) {
  const key = tmdbApiKey(overrideKey);
  if (!key) throw new Error("TMDB_API_KEY is missing");
  const id = parseInt(tmdbId, 10);
  if (!id) throw new Error("Invalid TMDB id");
  const [details, images, rel, credits] = await Promise.all([
    axios.get(`${TMDB_BASE}/movie/${id}`, {
      params: { api_key: key },
      timeout: 20000,
    }),
    axios.get(`${TMDB_BASE}/movie/${id}/images`, {
      params: { api_key: key, include_image_language: "en,null" },
      timeout: 20000,
    }),
    axios.get(`${TMDB_BASE}/movie/${id}/release_dates`, {
      params: { api_key: key },
      timeout: 20000,
    }),
    axios.get(`${TMDB_BASE}/movie/${id}/credits`, {
      params: { api_key: key },
      timeout: 20000,
    }),
  ]);
  const d = details.data || {};
  const logos = (images.data && images.data.logos) || [];
  const logo = logos.length ? logos[0].file_path : "";
  let cert = "";
  const rs = (rel.data && rel.data.results) || [];
  const us = rs.find((x) => x.iso_3166_1 === "US");
  if (us && Array.isArray(us.release_dates)) {
    const it = us.release_dates.find((x) => x.certification);
    cert = (it && it.certification) || "";
  }
  const cast = (credits.data && credits.data.cast) || [];
  const actor1 = String((cast[0] && cast[0].name) || "").trim();
  const actor2 = String((cast[1] && cast[1].name) || "").trim();
  const topCast = cast
    .slice(0, 2)
    .map((x) => String((x && x.name) || "").trim())
    .filter(Boolean)
    .join(", ");
  const companies = Array.isArray(d.production_companies)
    ? d.production_companies
    : [];
  const studio = companies.length
    ? String((companies[0] && companies[0].name) || "").trim()
    : "";
  return {
    tmdbId: id,
    title: d.title || "",
    year: d.release_date ? String(d.release_date).slice(0, 4) : "",
    logoUrl: logo ? `${TMDB_IMAGE}/w500${logo}` : "",
    bannerUrl: d.backdrop_path ? `${TMDB_IMAGE}/w1280${d.backdrop_path}` : "",
    overview: d.overview || "",
    plot: d.overview || "",
    studio: studio || "",
    topCast: topCast || "",
    actor1: actor1 || "",
    actor2: actor2 || "",
    rating:
      d.vote_average != null && !isNaN(d.vote_average)
        ? Math.round(Number(d.vote_average) * 10) + "%"
        : "",
    runtimeMins: Number(d.runtime) || 120,
    ratingScore:
      d.vote_average != null && !isNaN(d.vote_average)
        ? Math.round(Number(d.vote_average) * 10) + "%"
        : "",
    contentRating: cert || "",
    ratingContent: cert || "",
    genres: Array.isArray(d.genres)
      ? d.genres.map((g) => g.name).filter(Boolean).join(", ")
      : "",
  };
}

async function upsertMovieFromTmdb(tmdbId, options, overrideKey) {
  assertDb();
  const meta = await getTmdbMovieDetails(tmdbId, overrideKey);
  const localBanner = await toLocalNowShowingAssetPath(
    meta.tmdbId,
    meta.bannerUrl,
    "banner"
  );
  const localLogo = await toLocalNowShowingAssetPath(
    meta.tmdbId,
    meta.logoUrl,
    "logo"
  );
  const now = new Date().toISOString();
  const mode =
    options && options.showtimeMode === "manual" ? "manual" : "auto";
  const showings = Math.max(
    1,
    Math.min(6, parseInt(options && options.autoShowings, 10) || 6)
  );
  const manual = Array.isArray(options && options.manualTimes)
    ? options.manualTimes.slice(0, 6)
    : [];
  const ticketPrice = parsePriceAmount(options && options.priceAmount);
  const isAutoPrice = options && options.priceAutoGenerated ? 1 : 0;
  const refNow = new Date();
  const scheduleDay = mode === "manual" ? "" : localDateKey(refNow);
  const seed =
    mode === "manual"
      ? ""
      : firstAutoSlotForLocalDay(meta.title, refNow).toISOString();
  const emptySlotsJson = "[]";
  _db.run(
    `INSERT INTO now_showing_movies
      (tmdb_id,title,year,logo_url,banner_url,logo_cache_file,banner_cache_file,overview,rating,plot,rating_score,rating_content,studio,top_cast,actor_1,actor_2,runtime_mins,content_rating,genres,showtime_mode,manual_times,auto_showings,auto_seed_start,auto_schedule_day,auto_generated_showtimes_json,price_amount,price_auto_generated,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(tmdb_id) DO UPDATE SET
      title=excluded.title, year=excluded.year, logo_url=excluded.logo_url, banner_url=excluded.banner_url,
      logo_cache_file=excluded.logo_cache_file, banner_cache_file=excluded.banner_cache_file, overview=excluded.overview,
      rating=excluded.rating, plot=excluded.plot, rating_score=excluded.rating_score, rating_content=excluded.rating_content,
      studio=excluded.studio, top_cast=excluded.top_cast, actor_1=excluded.actor_1, actor_2=excluded.actor_2, runtime_mins=excluded.runtime_mins, content_rating=excluded.content_rating, genres=excluded.genres,
      showtime_mode=excluded.showtime_mode, manual_times=excluded.manual_times, auto_showings=excluded.auto_showings,
      auto_seed_start=excluded.auto_seed_start, auto_schedule_day=excluded.auto_schedule_day,
      auto_generated_showtimes_json=excluded.auto_generated_showtimes_json, price_amount=excluded.price_amount,
      price_auto_generated=excluded.price_auto_generated, updated_at=excluded.updated_at`,
    [
      meta.tmdbId,
      meta.title,
      meta.year,
      localLogo || meta.logoUrl,
      localBanner || meta.bannerUrl,
      localLogo,
      localBanner,
      meta.overview,
      meta.rating,
      meta.plot || meta.overview || "",
      meta.ratingScore || meta.rating || "",
      meta.ratingContent || meta.contentRating || "",
      meta.studio,
      meta.topCast,
      meta.actor1,
      meta.actor2,
      meta.runtimeMins,
      meta.contentRating,
      meta.genres,
      mode,
      JSON.stringify(manual),
      showings,
      seed,
      scheduleDay,
      emptySlotsJson,
      ticketPrice,
      isAutoPrice,
      now,
      now,
    ]
  );
  persistDb();
}

function updateMovieConfig(id, options) {
  assertDb();
  const nid = parseInt(id, 10);
  if (!nid) throw new Error("Invalid id");
  const mode =
    options && options.showtimeMode === "manual" ? "manual" : "auto";
  const showings = Math.max(
    1,
    Math.min(6, parseInt(options && options.autoShowings, 10) || 6)
  );
  const manual = Array.isArray(options && options.manualTimes)
    ? options.manualTimes.slice(0, 6)
    : [];
  const hasPriceField =
    options && Object.prototype.hasOwnProperty.call(options, "priceAmount");
  const ticketPrice = hasPriceField ? parsePriceAmount(options.priceAmount) : null;
  const isAutoPrice = options && options.priceAutoGenerated ? 1 : 0;
  const sqlParts = [
    "showtime_mode=?",
    "manual_times=?",
    "auto_showings=?",
    "auto_schedule_day=''",
    "auto_seed_start=''",
    "auto_generated_showtimes_json='[]'",
  ];
  const params = [mode, JSON.stringify(manual), showings];
  if (hasPriceField) {
    sqlParts.push("price_amount=?");
    sqlParts.push("price_auto_generated=?");
    params.push(ticketPrice);
    params.push(isAutoPrice);
  }
  sqlParts.push("updated_at=?");
  params.push(new Date().toISOString());
  params.push(nid);
  _db.run(
    `UPDATE now_showing_movies
      SET ${sqlParts.join(", ")}
      WHERE id=?`,
    params
  );
  persistDb();
}

function deleteMovie(id) {
  assertDb();
  const nid = parseInt(id, 10);
  if (!nid) return;
  _db.run("DELETE FROM now_showing_movies WHERE id=?", [nid]);
  persistDb();
}

function listMoviesForSettings() {
  return allRows();
}

/**
 * @param {{ showtimeSlotCount?: number }} [options] When set (1–8), use this many
 * showtimes for every row (auto + manual display). Otherwise auto uses each row’s
 * autoShowings and manual use up to 6 labels (per row); API may request up to 8 slots including buffer.
 */
function listMoviesForScreen(options) {
  assertDb();
  const opt = options && typeof options === "object" ? options : {};
  const autoPriceEnabled = !!opt.autoPriceEnabled;
  const autoPriceMin = clampPriceBound(opt.autoPriceMin, 5);
  const autoPriceMax = clampPriceBound(opt.autoPriceMax, 20);
  let slotCap = null;
  if (
    opt.showtimeSlotCount !== undefined &&
    opt.showtimeSlotCount !== null &&
    opt.showtimeSlotCount !== ""
  ) {
    const raw = parseInt(String(opt.showtimeSlotCount).trim(), 10);
    if (!isNaN(raw)) slotCap = Math.max(1, Math.min(8, raw));
  }
  const slotCountForRow = (rowAuto) => {
    const a = Math.max(1, Math.min(6, Number(rowAuto) || 6));
    return slotCap != null ? slotCap : a;
  };
  const rows = allRows();
  let changed = false;
  const now = new Date();
  const out = rows.map((r) => {
    let nextPriceAmount = parsePriceAmount(r.priceAmount);
    let nextPriceAutoGenerated = r.priceAutoGenerated ? 1 : 0;
    if (autoPriceEnabled && nextPriceAmount == null) {
      nextPriceAmount = autoPriceFromAge(autoPriceMin, autoPriceMax, r.year);
      nextPriceAutoGenerated = 1;
      _db.run(
        "UPDATE now_showing_movies SET price_amount=?, price_auto_generated=?, updated_at=? WHERE id=?",
        [nextPriceAmount, nextPriceAutoGenerated, now.toISOString(), r.id]
      );
      changed = true;
    }
    if (r.showtimeMode === "manual") {
      const maxManual = slotCap != null ? slotCap : 6;
      const labels = (r.manualTimes || []).slice(0, maxManual);
      const showtimeStartsIso = labels.map((lbl) => {
        const dt = parseManualShowtimeToDate(lbl, now);
        return dt ? dt.toISOString() : null;
      });
      return {
        ...r,
        priceAmount: nextPriceAmount,
        priceAutoGenerated: nextPriceAutoGenerated === 1,
        showtimes: labels,
        showtimeStartsIso,
      };
    }
    const nSlots = slotCountForRow(r.autoShowings);
    const todayKey = localDateKey(now);
    const dayEndEx = endOfLocalDayExclusive(now);
    const firstOfDay = firstAutoSlotForLocalDay(r.title, now);
    let scheduleDay = String(r.autoScheduleDay || "").trim();
    let seed = String(r.autoSeedStart || "").trim();
    let needSave = false;

    if (scheduleDay !== todayKey) {
      seed = firstOfDay.toISOString();
      scheduleDay = todayKey;
      needSave = true;
    } else if (!seed) {
      seed = firstOfDay.toISOString();
      needSave = true;
    } else {
      const seedDate = new Date(seed);
      if (isNaN(seedDate.getTime()) || localDateKey(seedDate) !== todayKey) {
        seed = firstOfDay.toISOString();
        needSave = true;
      }
    }

    let slots = generateShowtimes(seed, nSlots, r.runtimeMins, dayEndEx);
    if (!slots.length) {
      seed = firstOfDay.toISOString();
      scheduleDay = todayKey;
      slots = generateShowtimes(seed, nSlots, r.runtimeMins, dayEndEx);
      needSave = true;
    }

    const slotsIso = slots.map((d) => d.toISOString());
    const slotsJson = JSON.stringify(slotsIso);
    const prevStored = Array.isArray(r.autoGeneratedShowtimes)
      ? r.autoGeneratedShowtimes
      : [];
    const prevJson = JSON.stringify(prevStored.map((x) => String(x)));
    const jsonDirty =
      prevJson !== slotsJson ||
      (r.autoScheduleDay || "") !== scheduleDay ||
      String(r.autoSeedStart || "").trim() !== String(seed).trim();

    if (needSave || jsonDirty) {
      _db.run(
        "UPDATE now_showing_movies SET auto_seed_start=?, auto_schedule_day=?, auto_generated_showtimes_json=?, updated_at=? WHERE id=?",
        [seed, scheduleDay, slotsJson, now.toISOString(), r.id]
      );
      changed = true;
    }

    return {
      ...r,
      priceAmount: nextPriceAmount,
      priceAutoGenerated: nextPriceAutoGenerated === 1,
      autoScheduleDay: scheduleDay,
      autoSeedStart: seed,
      autoGeneratedShowtimes: slotsIso,
      showtimes: formatTimes(slots),
      showtimeStartsIso: slotsIso,
    };
  });
  if (changed) persistDb();
  return out;
}

/**
 * First logo from TMDB movie images (same rules as getTmdbMovieDetails).
 */
async function fetchTmdbLogoUrl(tmdbId, overrideKey) {
  const key = tmdbApiKey(overrideKey);
  if (!key) return "";
  const id = parseInt(tmdbId, 10);
  if (!id) return "";
  try {
    const r = await axios.get(`${TMDB_BASE}/movie/${id}/images`, {
      params: { api_key: key, include_image_language: "en,null" },
      timeout: 20000,
    });
    const logos = (r.data && r.data.logos) || [];
    const path = logos.length ? logos[0].file_path : "";
    return path ? `${TMDB_IMAGE}/w500${path}` : "";
  } catch (e) {
    return "";
  }
}

async function backfillRemoteAssetsToLocalPaths(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  let touched = false;
  const nowIso = new Date().toISOString();
  for (const row of rows) {
    if (!row || !row.id || !row.tmdbId) continue;
    const nextBanner = await toLocalNowShowingAssetPath(
      row.tmdbId,
      row.bannerUrl,
      "banner"
    );
    const nextLogo = await toLocalNowShowingAssetPath(
      row.tmdbId,
      row.logoUrl,
      "logo"
    );
    const curBanner = String(row.bannerUrl || "").trim();
    const curLogo = String(row.logoUrl || "").trim();
    if (
      (nextBanner && nextBanner !== curBanner) ||
      (nextLogo && nextLogo !== curLogo)
    ) {
      _db.run(
        `UPDATE now_showing_movies
         SET banner_url=?, logo_url=?, banner_cache_file=?, logo_cache_file=?, updated_at=?
         WHERE id=?`,
        [
          nextBanner || curBanner,
          nextLogo || curLogo,
          nextBanner || row.bannerCacheFile || "",
          nextLogo || row.logoCacheFile || "",
          nowIso,
          row.id,
        ]
      );
      row.bannerUrl = nextBanner || curBanner;
      row.logoUrl = nextLogo || curLogo;
      row.bannerCacheFile = nextBanner || row.bannerCacheFile || "";
      row.logoCacheFile = nextLogo || row.logoCacheFile || "";
      touched = true;
    }
  }
  if (touched) persistDb();
}

/**
 * Curated rows missing logo_url: fetch from TMDB, UPDATE sqlite, patch row.logoUrl in place.
 * @param {object[]} rows from listMoviesForScreen()
 */
async function backfillMissingLogosForNowShowingRows(rows, overrideKey) {
  if (!Array.isArray(rows) || !rows.length) return;
  if (!tmdbApiKey(overrideKey)) return;
  let touched = false;
  for (const row of rows) {
    if (String(row.logoUrl || "").trim()) continue;
    const tid = row.tmdbId != null ? parseInt(row.tmdbId, 10) : 0;
    if (!tid || !row.id) continue;
    const logoUrlRemote = await fetchTmdbLogoUrl(tid, overrideKey);
    if (!logoUrlRemote) continue;
    const logoUrl = await toLocalNowShowingAssetPath(tid, logoUrlRemote, "logo");
    if (!logoUrl) continue;
    assertDb();
    _db.run(
      `UPDATE now_showing_movies
       SET logo_url=?, logo_cache_file=?, updated_at=? WHERE id=?`,
      [logoUrl, logoUrl, new Date().toISOString(), row.id]
    );
    row.logoUrl = logoUrl;
    row.logoCacheFile = logoUrl;
    touched = true;
  }
  if (touched) persistDb();
}

/**
 * Curated DB rows missing banner and/or logo: one TMDB movie fetch, cache images, UPDATE sqlite.
 * Rows without tmdbId or id are skipped (library fillers, etc.).
 * @param {object[]} rows from listMoviesForScreen()
 */
async function hydrateMissingBannerLogoFromTmdb(rows, overrideKey) {
  if (!Array.isArray(rows) || !rows.length) return;
  if (!tmdbApiKey(overrideKey)) return;
  let touched = false;
  const nowIso = new Date().toISOString();
  for (const row of rows) {
    if (!row || !row.id) continue;
    const tid = row.tmdbId != null ? parseInt(row.tmdbId, 10) : 0;
    if (!tid) continue;
    let nextBanner = String(row.bannerUrl || "").trim();
    let nextLogo = String(row.logoUrl || "").trim();
    if (nextBanner && nextLogo) continue;

    let meta;
    try {
      meta = await getTmdbMovieDetails(tid, overrideKey);
    } catch (e) {
      continue;
    }

    let nextBannerCache = String(row.bannerCacheFile || "").trim();
    let nextLogoCache = String(row.logoCacheFile || "").trim();
    let changed = false;

    if (!nextBanner && String(meta.bannerUrl || "").trim()) {
      const loc = await toLocalNowShowingAssetPath(tid, meta.bannerUrl, "banner");
      nextBanner = loc || String(meta.bannerUrl || "").trim();
      nextBannerCache = loc || nextBannerCache;
      changed = true;
    }
    if (!nextLogo && String(meta.logoUrl || "").trim()) {
      const loc = await toLocalNowShowingAssetPath(tid, meta.logoUrl, "logo");
      nextLogo = loc || String(meta.logoUrl || "").trim();
      nextLogoCache = loc || nextLogoCache;
      changed = true;
    }
    if (!changed) continue;
    assertDb();
    _db.run(
      `UPDATE now_showing_movies
       SET banner_url=?, logo_url=?, banner_cache_file=?, logo_cache_file=?, updated_at=?
       WHERE id=?`,
      [
        nextBanner,
        nextLogo,
        nextBannerCache,
        nextLogoCache,
        nowIso,
        row.id,
      ]
    );
    row.bannerUrl = nextBanner;
    row.logoUrl = nextLogo;
    row.bannerCacheFile = nextBannerCache;
    row.logoCacheFile = nextLogoCache;
    touched = true;
  }
  if (touched) persistDb();
}

/** Clears persisted auto grids so the next screen build uses today’s midnight-based schedule. */
function regenerateAllAutoShowtimes() {
  assertDb();
  const iso = new Date().toISOString();
  _db.run(
    `UPDATE now_showing_movies
     SET auto_schedule_day='', auto_seed_start='', auto_generated_showtimes_json='[]', updated_at=?
     WHERE showtime_mode IS NULL
        OR TRIM(COALESCE(showtime_mode,''))=''
        OR LOWER(TRIM(showtime_mode))='auto'`,
    [iso]
  );
  persistDb();
}

module.exports = {
  initNowShowingDb,
  listMoviesForSettings,
  listMoviesForScreen,
  searchTmdbMovies,
  upsertMovieFromTmdb,
  updateMovieConfig,
  deleteMovie,
  regenerateAllAutoShowtimes,
  backfillRemoteAssetsToLocalPaths,
  backfillMissingLogosForNowShowingRows,
  hydrateMissingBannerLogoFromTmdb,
};

