const fs = require("fs");
const path = require("path");
const Cache = require("./cache");
const MediaCard = require("../cards/MediaCard");
const CardType = require("../cards/CardType");
const { CACHE_ROOT, CONFIG_ROOT, LEGACY_SAVED_ROOT } = require("./appPaths");

/** SQLite poster metadata (moved from config/cache to config root). */
const SQLITE_DB = path.join(CONFIG_ROOT, "posterr-poster-metadata.db");
/** Previous path under config/cache; auto-migrated to config root. */
const LEGACY_CACHE_SQLITE = path.join(CACHE_ROOT, "posterr-poster-metadata.db");
/** Legacy JSON under former saved/; migrated once into SQLite then renamed. */
const LEGACY_JSON = path.join(LEGACY_SAVED_ROOT, "posterr-poster-metadata.json");
/** Legacy SQLite under former saved/; migrated into config/cache on first start. */
const LEGACY_SQLITE = path.join(LEGACY_SAVED_ROOT, "posterr-poster-metadata.db");
const IMAGECACHE = path.join(CACHE_ROOT, "imagecache");
/** Pre–config/cache layout; still checked so poster DB rows match files users never moved. */
const LEGACY_IMAGECACHE = path.join(LEGACY_SAVED_ROOT, "imagecache");
const MP3CACHE = path.join(CACHE_ROOT, "mp3cache");
/** Upper bound on poster metadata rows (full-library sync can exceed the old 2500 cap). */
const MAX_ENTRIES = 100000;
const MIN_FILE_BYTES = 256;
const DEFAULT_FALLBACK_COUNT = 24;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS poster_entries (
  cache_file TEXT PRIMARY KEY NOT NULL,
  logo_cache_file TEXT NOT NULL DEFAULT '',
  art_cache_file TEXT NOT NULL DEFAULT '',
  banner_cache_file TEXT NOT NULL DEFAULT '',
  portrait_actor_cache_file TEXT NOT NULL DEFAULT '',
  portrait_actress_cache_file TEXT NOT NULL DEFAULT '',
  portrait_director_cache_file TEXT NOT NULL DEFAULT '',
  portrait_author_cache_file TEXT NOT NULL DEFAULT '',
  portrait_artist_cache_file TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  tag_line TEXT NOT NULL DEFAULT '',
  year TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'movie',
  genres TEXT NOT NULL DEFAULT '',
  top_cast TEXT NOT NULL DEFAULT '',
  actor_1 TEXT NOT NULL DEFAULT '',
  actor_2 TEXT NOT NULL DEFAULT '',
  studio TEXT NOT NULL DEFAULT '',
  runtime_mins INTEGER NOT NULL DEFAULT 0,
  rating TEXT NOT NULL DEFAULT '',
  content_rating TEXT NOT NULL DEFAULT '',
  plot TEXT NOT NULL DEFAULT '',
  rating_score TEXT NOT NULL DEFAULT '',
  rating_content TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  server_kind TEXT NOT NULL DEFAULT 'plex',
  poster_ar TEXT NOT NULL DEFAULT '',
  dbid TEXT NOT NULL DEFAULT '',
  api_item_id TEXT NOT NULL DEFAULT '',
  library_kind TEXT NOT NULL DEFAULT '',
  library_name TEXT NOT NULL DEFAULT '',
  source_url TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_poster_server_updated ON poster_entries(server_kind, updated_at);
CREATE INDEX IF NOT EXISTS idx_poster_server_api ON poster_entries(server_kind, api_item_id);
CREATE INDEX IF NOT EXISTS idx_poster_server_dbid ON poster_entries(server_kind, dbid);
`;

/** @type {any} */
let _sqlDb = null;
const EXTRA_SCHEMA_COLUMNS = [
  { name: "logo_cache_file", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "art_cache_file", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "banner_cache_file", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "portrait_actor_cache_file", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "portrait_actress_cache_file", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "portrait_director_cache_file", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "portrait_author_cache_file", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "portrait_artist_cache_file", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "genres", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "top_cast", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "actor_1", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "actor_2", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "studio", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "runtime_mins", def: "INTEGER NOT NULL DEFAULT 0" },
  { name: "rating", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "content_rating", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "plot", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "rating_score", def: "TEXT NOT NULL DEFAULT ''" },
  { name: "rating_content", def: "TEXT NOT NULL DEFAULT ''" },
];

function assertDb() {
  if (!_sqlDb) {
    throw new Error(
      "Poster metadata database was not initialized. Ensure initPosterMetadataDb() runs at startup."
    );
  }
}

function persistDb() {
  assertDb();
  fs.mkdirSync(path.dirname(SQLITE_DB), { recursive: true });
  const data = _sqlDb.export();
  fs.writeFileSync(SQLITE_DB, Buffer.from(data));
}

function ensurePosterEntriesExtraColumns() {
  assertDb();
  const existing = new Set();
  let changed = false;
  const s = _sqlDb.prepare("PRAGMA table_info(poster_entries)");
  while (s.step()) {
    const row = s.getAsObject();
    existing.add(String(row.name || "").toLowerCase());
  }
  s.free();
  for (const c of EXTRA_SCHEMA_COLUMNS) {
    if (!existing.has(c.name.toLowerCase())) {
      _sqlDb.run(`ALTER TABLE poster_entries ADD COLUMN ${c.name} ${c.def}`);
      changed = true;
    }
  }
  return changed;
}

/**
 * Load sql.js WASM and open (or create) the poster SQLite file.
 * Call once from application startup before any other poster DB access.
 */
async function initPosterMetadataDb() {
  if (_sqlDb) return;
  const initSqlJs = require("sql.js");
  const wasmPath = path.join(
    path.dirname(require.resolve("sql.js/package.json")),
    "dist",
    "sql-wasm.wasm"
  );
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  fs.mkdirSync(CACHE_ROOT, { recursive: true });

  const hadNewSqlite = fs.existsSync(SQLITE_DB);
  let loadedFromLegacySqlite = false;
  let loadedFromLegacyCacheSqlite = false;
  if (hadNewSqlite) {
    _sqlDb = new SQL.Database(fs.readFileSync(SQLITE_DB));
  } else if (fs.existsSync(LEGACY_CACHE_SQLITE)) {
    _sqlDb = new SQL.Database(fs.readFileSync(LEGACY_CACHE_SQLITE));
    loadedFromLegacyCacheSqlite = true;
  } else if (fs.existsSync(LEGACY_SQLITE)) {
    _sqlDb = new SQL.Database(fs.readFileSync(LEGACY_SQLITE));
    loadedFromLegacySqlite = true;
  } else {
    _sqlDb = new SQL.Database();
  }
  _sqlDb.exec(SCHEMA_SQL);
  const addedSchemaColumns = ensurePosterEntriesExtraColumns();

  let migratedJson = false;
  const cntAfterOpen = countRows();
  if (cntAfterOpen === 0 && fs.existsSync(LEGACY_JSON)) {
    try {
      migrateLegacyJson();
      persistDb();
      migratedJson = true;
      const bak = LEGACY_JSON + ".migrated.bak";
      try {
        if (fs.existsSync(bak)) fs.unlinkSync(bak);
      } catch (e) {
        /* ignore */
      }
      fs.renameSync(LEGACY_JSON, bak);
      const now = new Date();
      console.log(
        now.toLocaleString() +
          " Poster metadata: migrated legacy JSON → SQLite (" +
          SQLITE_DB +
          "); backup at " +
          bak
      );
    } catch (e) {
      console.log(
        new Date().toLocaleString() +
          " Poster metadata: legacy JSON migration failed — " +
          (e && e.message ? e.message : e)
      );
    }
  }

  if (loadedFromLegacyCacheSqlite) {
    persistDb();
    try {
      const lbak = LEGACY_CACHE_SQLITE + ".migrated.bak";
      if (fs.existsSync(lbak)) fs.unlinkSync(lbak);
      fs.renameSync(LEGACY_CACHE_SQLITE, lbak);
      console.log(
        new Date().toLocaleString() +
          " Poster metadata: migrated SQLite DB from config/cache → " +
          SQLITE_DB +
          "; backup at " +
          lbak
      );
    } catch (e) {
      console.log(
        new Date().toLocaleString() +
          " Poster metadata: could not rename legacy config/cache DB — " +
          (e && e.message ? e.message : e)
      );
    }
  } else if (loadedFromLegacySqlite) {
    persistDb();
    try {
      const lbak = LEGACY_SQLITE + ".migrated.bak";
      if (fs.existsSync(lbak)) fs.unlinkSync(lbak);
      fs.renameSync(LEGACY_SQLITE, lbak);
      console.log(
        new Date().toLocaleString() +
          " Poster metadata: migrated SQLite DB from saved/ → " +
          SQLITE_DB +
          "; backup at " +
          lbak
      );
    } catch (e) {
      console.log(
        new Date().toLocaleString() +
          " Poster metadata: could not remove legacy saved/*.db — " +
          (e && e.message ? e.message : e)
      );
    }
  } else if (!hadNewSqlite && !migratedJson) {
    persistDb();
  } else if (addedSchemaColumns) {
    // Existing DB upgraded with new columns; persist ALTER TABLE changes immediately.
    persistDb();
    console.log(
      new Date().toLocaleString() +
        " Poster metadata: schema upgraded with additional metadata/cache columns"
    );
  }

  logLegacySavedImageHint();
}

/** One-time hint if old saved/imagecache has JPEGs but config/cache/imagecache is empty. */
function logLegacySavedImageHint() {
  try {
    const oldImg = path.join(LEGACY_SAVED_ROOT, "imagecache");
    if (!fs.existsSync(oldImg)) return;
    const j = fs.readdirSync(oldImg).filter((f) => /\.(jpe?g)$/i.test(f));
    if (j.length === 0) return;
    if (!fs.existsSync(IMAGECACHE)) return;
    const n = fs.readdirSync(IMAGECACHE).length;
    if (n > 0) return;
    console.log(
      new Date().toLocaleString() +
        " Posterr: cached images are still under saved/imagecache; move files to config/cache/imagecache (and mp3cache → config/cache/mp3cache), or copy your old saved/ tree into config/cache/."
    );
  } catch (e) {
    /* ignore */
  }
}

function migrateLegacyJson() {
  assertDb();
  const raw = fs.readFileSync(LEGACY_JSON, "utf8");
  const parsed = JSON.parse(raw);
  const entries = parsed && Array.isArray(parsed.entries) ? parsed.entries : [];
  const ins = _sqlDb.prepare(`
    INSERT OR REPLACE INTO poster_entries (
      cache_file, logo_cache_file, art_cache_file, banner_cache_file,
      portrait_actor_cache_file, portrait_actress_cache_file,
      portrait_director_cache_file, portrait_author_cache_file, portrait_artist_cache_file,
      title, tag_line, year, media_type, genres, top_cast, actor_1, actor_2, studio, runtime_mins, rating, content_rating, plot, rating_score, rating_content, summary, server_kind, poster_ar,
      dbid, api_item_id, library_kind, library_name, source_url, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    _sqlDb.run("BEGIN");
    for (const e of entries) {
      const row = entryToParams({
        cacheFile: e.cacheFile,
        logoCacheFile: e.logoCacheFile,
        artCacheFile: e.artCacheFile,
        bannerCacheFile: e.bannerCacheFile,
        portraitActorCacheFile: e.portraitActorCacheFile,
        portraitActressCacheFile: e.portraitActressCacheFile,
        portraitDirectorCacheFile: e.portraitDirectorCacheFile,
        portraitAuthorCacheFile: e.portraitAuthorCacheFile,
        portraitArtistCacheFile: e.portraitArtistCacheFile,
        title: e.title,
        tagLine: e.tagLine,
        year: e.year,
        mediaType: e.mediaType,
        genres: e.genres,
        topCast: e.topCast,
        actor1: e.actor1,
        actor2: e.actor2,
        studio: e.studio,
        runtimeMins: e.runtimeMins,
        rating: e.rating,
        contentRating: e.contentRating,
        plot: e.plot,
        ratingScore: e.ratingScore,
        ratingContent: e.ratingContent,
        summary: e.summary,
        serverKind: e.serverKind,
        posterAR: e.posterAR,
        dbid: e.dbid,
        apiItemId: e.apiItemId,
        libraryKind: e.libraryKind,
        libraryName: e.libraryName,
        sourceUrl: e.sourceUrl,
        updatedAt: e.updatedAt,
      });
      ins.run(row);
    }
    _sqlDb.run("COMMIT");
  } catch (e) {
    try {
      _sqlDb.run("ROLLBACK");
    } catch (e2) {
      /* ignore */
    }
    throw e;
  } finally {
    ins.free();
  }
}

function countRows() {
  assertDb();
  const s = _sqlDb.prepare("SELECT COUNT(*) AS c FROM poster_entries");
  s.step();
  const o = s.getAsObject();
  s.free();
  return Number(o.c) || 0;
}

/**
 * @param {object} r sql.js getAsObject() row
 */
function rowFromDb(r) {
  if (!r) return null;
  return {
    cacheFile: r.cache_file,
    logoCacheFile: r.logo_cache_file || "",
    artCacheFile: r.art_cache_file || "",
    bannerCacheFile: r.banner_cache_file || "",
    portraitActorCacheFile: r.portrait_actor_cache_file || "",
    portraitActressCacheFile: r.portrait_actress_cache_file || "",
    portraitDirectorCacheFile: r.portrait_director_cache_file || "",
    portraitAuthorCacheFile: r.portrait_author_cache_file || "",
    portraitArtistCacheFile: r.portrait_artist_cache_file || "",
    title: r.title || "",
    tagLine: r.tag_line || "",
    year: r.year || "",
    mediaType: r.media_type || "",
    genres: r.genres || "",
    topCast: r.top_cast || "",
    actor1: r.actor_1 || "",
    actor2: r.actor_2 || "",
    studio: r.studio || "",
    runtimeMins: Number(r.runtime_mins) || 0,
    rating: r.rating || "",
    contentRating: r.content_rating || "",
    plot: r.plot || r.summary || "",
    ratingScore: r.rating_score || r.rating || "",
    ratingContent: r.rating_content || r.content_rating || "",
    summary: r.summary || "",
    serverKind: r.server_kind || "",
    posterAR: r.poster_ar || "",
    dbid: r.dbid || "",
    apiItemId: r.api_item_id || "",
    libraryKind: r.library_kind || "",
    libraryName: r.library_name || "",
    sourceUrl: r.source_url || "",
    updatedAt: r.updated_at || "",
  };
}

/** @returns {any[]} ordered values for INSERT */
function entryToParams(e) {
  return [
    e.cacheFile,
    e.logoCacheFile || "",
    e.artCacheFile || "",
    e.bannerCacheFile || "",
    e.portraitActorCacheFile || "",
    e.portraitActressCacheFile || "",
    e.portraitDirectorCacheFile || "",
    e.portraitAuthorCacheFile || "",
    e.portraitArtistCacheFile || "",
    e.title || "",
    e.tagLine || "",
    e.year || "",
    e.mediaType || "movie",
    e.genres || "",
    e.topCast || "",
    e.actor1 || "",
    e.actor2 || "",
    e.studio || "",
    Number.isFinite(Number(e.runtimeMins)) ? Math.max(0, Math.round(Number(e.runtimeMins))) : 0,
    e.rating || "",
    e.contentRating || "",
    e.plot || "",
    e.ratingScore || "",
    e.ratingContent || "",
    e.summary || "",
    e.serverKind || "plex",
    e.posterAR || "",
    e.dbid || "",
    e.apiItemId || "",
    e.libraryKind || "",
    e.libraryName || "",
    e.sourceUrl || "",
    e.updatedAt || "",
  ];
}

function selectAllEntries() {
  assertDb();
  const out = [];
  const s = _sqlDb.prepare("SELECT * FROM poster_entries");
  while (s.step()) {
    out.push(rowFromDb(s.getAsObject()));
  }
  s.free();
  return out;
}

function selectByServerKind(kind) {
  assertDb();
  const out = [];
  const s = _sqlDb.prepare("SELECT * FROM poster_entries WHERE server_kind = ?");
  s.bind([kind]);
  while (s.step()) {
    out.push(rowFromDb(s.getAsObject()));
  }
  s.free();
  return out;
}

function getEntryByCacheFile(cacheFile) {
  assertDb();
  const s = _sqlDb.prepare("SELECT * FROM poster_entries WHERE cache_file = ?");
  s.bind([cacheFile]);
  let row = null;
  if (s.step()) row = rowFromDb(s.getAsObject());
  s.free();
  return row;
}

function getEntryByServerAndApiItemId(serverKind, apiItemId) {
  assertDb();
  const sk = String(serverKind || "").toLowerCase().trim();
  const aid = String(apiItemId || "").trim();
  if (!sk || !aid) return null;
  const s = _sqlDb.prepare(
    "SELECT * FROM poster_entries WHERE server_kind = ? AND api_item_id = ? LIMIT 1"
  );
  s.bind([sk, aid]);
  let row = null;
  if (s.step()) row = rowFromDb(s.getAsObject());
  s.free();
  return row;
}

/**
 * Full sync optimization: skip expensive metadata/image pull when a valid cached
 * poster row already exists and source item was not updated.
 * @param {string} serverKind
 * @param {string} apiItemId
 * @param {string|number|Date} sourceUpdatedAt
 */
function shouldSkipSyncItem(serverKind, apiItemId, sourceUpdatedAt) {
  const row = getEntryByServerAndApiItemId(serverKind, apiItemId);
  if (!row || !row.cacheFile || !fileOk(row.cacheFile)) return false;
  if (sourceUpdatedAt === undefined || sourceUpdatedAt === null || sourceUpdatedAt === "")
    return true;
  const srcTs = new Date(sourceUpdatedAt).getTime();
  const rowTs = new Date(row.updatedAt || 0).getTime();
  if (!Number.isFinite(srcTs) || srcTs <= 0) return true;
  if (!Number.isFinite(rowTs) || rowTs <= 0) return false;
  return srcTs <= rowTs;
}

function deleteByCacheFiles(files) {
  if (!files.length) return;
  assertDb();
  const del = _sqlDb.prepare("DELETE FROM poster_entries WHERE cache_file = ?");
  try {
    _sqlDb.run("BEGIN");
    for (const cf of files) del.run([cf]);
    _sqlDb.run("COMMIT");
  } catch (e) {
    try {
      _sqlDb.run("ROLLBACK");
    } catch (e2) {
      /* ignore */
    }
    throw e;
  } finally {
    del.free();
  }
}

function replaceAllEntries(entries) {
  assertDb();
  const ins = _sqlDb.prepare(`
    INSERT INTO poster_entries (
      cache_file, logo_cache_file, art_cache_file, banner_cache_file,
      portrait_actor_cache_file, portrait_actress_cache_file,
      portrait_director_cache_file, portrait_author_cache_file, portrait_artist_cache_file,
      title, tag_line, year, media_type, genres, top_cast, actor_1, actor_2, studio, runtime_mins, rating, content_rating, plot, rating_score, rating_content, summary, server_kind, poster_ar,
      dbid, api_item_id, library_kind, library_name, source_url, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    _sqlDb.run("BEGIN");
    _sqlDb.run("DELETE FROM poster_entries");
    for (const e of entries) {
      ins.run(entryToParams(e));
    }
    _sqlDb.run("COMMIT");
  } catch (e) {
    try {
      _sqlDb.run("ROLLBACK");
    } catch (e2) {
      /* ignore */
    }
    throw e;
  } finally {
    ins.free();
  }
}

function enforceMaxEntries() {
  const cnt = countRows();
  if (cnt <= MAX_ENTRIES) return;
  const excess = cnt - MAX_ENTRIES;
  assertDb();
  _sqlDb.run(
    `DELETE FROM poster_entries WHERE cache_file IN (
      SELECT cache_file FROM poster_entries ORDER BY updated_at ASC LIMIT ?
    )`,
    [excess]
  );
}

/**
 * @param {string} posterURL
 * @returns {string|null} safe basename under imagecache
 */
function normalizeCacheFile(posterURL) {
  if (!posterURL || typeof posterURL !== "string") return null;
  const idx = posterURL.toLowerCase().indexOf("/imagecache/");
  if (idx === -1) return null;
  let rest = posterURL.slice(idx + "/imagecache/".length);
  if (rest.includes("?")) rest = rest.split("?")[0];
  const base = path.basename(rest.replace(/\\/g, "/"));
  if (!base || /[\\/]/.test(base) || base.includes("..")) return null;
  return base;
}

/**
 * Normalize a poster_entries.cache_file value to a single safe basename (flat imagecache layout).
 * Handles full URLs, Windows paths, and plain basenames.
 * @param {string} cacheFile
 * @returns {string|null}
 */
function cacheBasenameFromStoredValue(cacheFile) {
  if (!cacheFile || typeof cacheFile !== "string") return null;
  const s = cacheFile.trim().replace(/\\/g, "/");
  if (!s) return null;
  const idx = s.toLowerCase().indexOf("/imagecache/");
  let rest = idx === -1 ? s : s.slice(idx + "/imagecache/".length);
  if (rest.includes("?")) rest = rest.split("?")[0];
  const base = path.basename(rest);
  if (!base || base === "." || base === ".." || base.includes("..")) return null;
  return base;
}

function fileOk(cacheFile) {
  const base = cacheBasenameFromStoredValue(cacheFile);
  if (!base) return false;
  const dirs = [IMAGECACHE];
  try {
    if (path.resolve(LEGACY_IMAGECACHE) !== path.resolve(IMAGECACHE)) {
      dirs.push(LEGACY_IMAGECACHE);
    }
  } catch (e) {
    /* ignore */
  }
  for (const dir of dirs) {
    const fp = path.join(dir, base);
    try {
      const st = fs.statSync(fp);
      if (st.isFile() && st.size >= MIN_FILE_BYTES) return true;
    } catch (e) {
      /* try next dir */
    }
  }
  return false;
}

/** Cached wide background: fanart (`-art.jpg`) first, else Plex/JF banner (`-banner.jpg`). */
function resolveBackdropCacheFile(posterCacheFile) {
  const m = String(posterCacheFile || "").match(/^(.+)\.(jpe?g)$/i);
  if (!m) return "";
  const base = m[1];
  const artFn = `${base}-art.jpg`;
  if (fileOk(artFn)) return artFn;
  const bnFn = `${base}-banner.jpg`;
  if (fileOk(bnFn)) return bnFn;
  return "";
}

/** Cached banner only (`-banner.jpg`). */
function resolveBannerCacheFile(posterCacheFile) {
  const m = String(posterCacheFile || "").match(/^(.+)\.(jpe?g)$/i);
  if (!m) return "";
  const bnFn = `${m[1]}-banner.jpg`;
  if (fileOk(bnFn)) return bnFn;
  return "";
}

function unlinkCacheAndArt(cacheFile) {
  const base = cacheBasenameFromStoredValue(cacheFile) || String(cacheFile || "").trim();
  if (!base) return;
  const dirs = [IMAGECACHE];
  try {
    if (path.resolve(LEGACY_IMAGECACHE) !== path.resolve(IMAGECACHE)) {
      dirs.push(LEGACY_IMAGECACHE);
    }
  } catch (e) {
    /* ignore */
  }
  for (const dir of dirs) {
    const fp = path.join(dir, base);
    try {
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    } catch (e) {
      /* ignore */
    }
  }
  const m = String(base).match(/^(.+)\.jpg$/i);
  if (m) {
    for (const suf of ["-art", "-banner"]) {
      for (const dir of dirs) {
        try {
          const side = path.join(dir, m[1] + suf + ".jpg");
          if (fs.existsSync(side)) fs.unlinkSync(side);
        } catch (e) {
          /* ignore */
        }
      }
    }
  }
}

/**
 * Remove poster metadata + files when the library item no longer exists on the media server.
 * @param {{ currentServerKind: string, isMediaServerEnabled: boolean, maxChecks?: number, minAgeBeforeChangeCheckMins?: number, probeEntryGone: function }} opts
 */
async function purgeMissingServerItems(opts) {
  const {
    currentServerKind,
    isMediaServerEnabled,
    maxChecks = 35,
    probeEntryGone,
  } = opts || {};
  const minAgeMs = Math.max(
    0,
    parseInt(opts && opts.minAgeBeforeChangeCheckMins, 10) || 0
  ) * 60 * 1000;
  const nowMs = Date.now();
  if (
    !probeEntryGone ||
    !isMediaServerEnabled ||
    !currentServerKind ||
    typeof probeEntryGone !== "function"
  ) {
    return { removed: 0, checked: 0 };
  }

  assertDb();
  const all = selectByServerKind(currentServerKind).filter(
    (e) =>
      (String(e.apiItemId || "").trim() || String(e.sourceUrl || "").trim()) &&
      nowMs - new Date(e.updatedAt || 0).getTime() >= minAgeMs
  );
  all.sort(
    (a, b) =>
      new Date(a.updatedAt || 0) - new Date(b.updatedAt || 0)
  );
  const candidates = all.slice(0, maxChecks);

  const toRemove = new Set();
  for (const entry of candidates) {
    try {
      const gone = await probeEntryGone({
        apiItemId: entry.apiItemId,
        sourceUrl: entry.sourceUrl,
      });
      if (gone) toRemove.add(entry.cacheFile);
    } catch (e) {
      /* ignore */
    }
  }

  if (toRemove.size === 0) return { removed: 0, checked: candidates.length };

  for (const cf of toRemove) {
    unlinkCacheAndArt(cf);
  }
  deleteByCacheFiles([...toRemove]);
  persistDb();

  const now = new Date();
  console.log(
    now.toLocaleString() +
      " Poster cache: removed " +
      toRemove.size +
      " deleted library item(s) from metadata and disk"
  );
  return { removed: toRemove.size, checked: candidates.length };
}

/**
 * Record poster files + metadata from Plex/Jellyfin/Emby/Kodi now-screening and on-demand cards.
 * @param {object[]} nsCards
 * @param {object[]} odCards
 * @param {string} serverKind plex|jellyfin|emby|kodi
 */
function registerFromMediaServerCards(nsCards, odCards, serverKind) {
  const cards = []
    .concat(Array.isArray(nsCards) ? nsCards : [])
    .concat(Array.isArray(odCards) ? odCards : []);
  if (cards.length === 0) {
    return {
      totalCards: 0,
      posterUrlPresent: 0,
      normalizedCacheFile: 0,
      fileOk: 0,
      titlePresent: 0,
      written: 0,
      rowCountBefore: countRows(),
      rowCountAfter: countRows(),
    };
  }

  assertDb();
  let changed = false;
  let written = 0;
  let posterUrlPresent = 0;
  let normalizedCacheFile = 0;
  let fileOkCount = 0;
  let titlePresent = 0;
  const rowCountBefore = countRows();
  const now = new Date().toISOString();
  const kind = String(serverKind || "plex").toLowerCase();

  const ins = _sqlDb.prepare(`
    INSERT OR REPLACE INTO poster_entries (
      cache_file, logo_cache_file, art_cache_file, banner_cache_file,
      portrait_actor_cache_file, portrait_actress_cache_file,
      portrait_director_cache_file, portrait_author_cache_file, portrait_artist_cache_file,
      title, tag_line, year, media_type, genres, top_cast, actor_1, actor_2, studio, runtime_mins, rating, content_rating, plot, rating_score, rating_content, summary, server_kind, poster_ar,
      dbid, api_item_id, library_kind, library_name, source_url, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    _sqlDb.run("BEGIN");
    for (const card of cards) {
      if (card && String(card.posterURL || "").trim()) posterUrlPresent += 1;
      const cacheFile = normalizeCacheFile(card.posterURL);
      if (!cacheFile) continue;
      normalizedCacheFile += 1;
      if (fileOk(cacheFile)) fileOkCount += 1;

      const title = String(card.title || "").trim();
      if (!title) continue;
      titlePresent += 1;

      let sourceUrl = String(card.posterDownloadURL || "").trim();
      let apiItemId = String(card.posterApiItemId || "").trim();
      let libraryKind = String(card.posterLibraryKind || "").trim();
      let libraryName = String(card.posterLibraryLabel || "").trim();

      const old = getEntryByCacheFile(cacheFile);
      if (!sourceUrl && old && old.sourceUrl) sourceUrl = old.sourceUrl;
      if (!apiItemId && old && old.apiItemId) apiItemId = old.apiItemId;
      if (!libraryKind && old && old.libraryKind) libraryKind = old.libraryKind;
      if (!libraryName && old && old.libraryName) libraryName = old.libraryName;

      const row = {
        cacheFile,
        logoCacheFile: normalizeCacheFile(card.posterLogoURL) || "",
        artCacheFile: normalizeCacheFile(card.posterArtURL) || "",
        bannerCacheFile:
          normalizeCacheFile(card.posterBannerURL) || resolveBannerCacheFile(cacheFile),
        portraitActorCacheFile: normalizeCacheFile(card.portraitActorURL) || "",
        portraitActressCacheFile:
          normalizeCacheFile(card.portraitActressURL) || "",
        portraitDirectorCacheFile:
          normalizeCacheFile(card.portraitDirectorURL) || "",
        portraitAuthorCacheFile:
          normalizeCacheFile(card.portraitAuthorURL) || "",
        portraitArtistCacheFile:
          normalizeCacheFile(card.portraitArtistURL) || "",
        title,
        tagLine: String(card.tagLine || "").trim(),
        year: String(card.year || "").trim(),
        mediaType: String(card.mediaType || "movie").trim() || "movie",
        genres: Array.isArray(card.genre)
          ? card.genre.join(", ")
          : String(card.genre || "").trim(),
        topCast: String(card.cast || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
          .slice(0, 2)
          .join(", "),
        actor1: String(card.cast || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)[0] || "",
        actor2: String(card.cast || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)[1] || "",
        studio: String(card.studio || card.network || "").trim(),
        runtimeMins: Math.max(0, parseInt(card.runTime, 10) || 0),
        rating: String(card.rating || "").trim(),
        contentRating: String(card.contentRating || "").trim(),
        plot: String(card.summary || "").slice(0, 2000),
        ratingScore: String(card.rating || "").trim(),
        ratingContent: String(card.contentRating || "").trim(),
        summary: String(card.summary || "").slice(0, 2000),
        serverKind: kind,
        posterAR: String(card.posterAR || "").trim(),
        dbid: String(card.DBID || "").trim(),
        apiItemId,
        libraryKind,
        libraryName,
        sourceUrl,
        updatedAt: now,
      };
      const incomingTagLine = String(card.tagLine || "").trim();
      const oldTagLine = old ? String(old.tagLine || "").trim() : "";
      const oldTitle = old ? String(old.title || "").trim() : "";
      const looksLikeFallbackTitle =
        incomingTagLine &&
        row.title &&
        incomingTagLine.toLowerCase() === row.title.toLowerCase();
      const oldLooksRealTagline =
        oldTagLine &&
        (!oldTitle || oldTagLine.toLowerCase() !== oldTitle.toLowerCase());
      if (!incomingTagLine && oldTagLine) {
        row.tagLine = oldTagLine;
      } else if (looksLikeFallbackTitle && oldLooksRealTagline) {
        // Keep a previously synced real tagline when current sync only has title fallback.
        row.tagLine = oldTagLine;
      }

      const needsWrite =
        !old ||
        old.title !== row.title ||
        old.logoCacheFile !== row.logoCacheFile ||
        old.artCacheFile !== row.artCacheFile ||
        old.bannerCacheFile !== row.bannerCacheFile ||
        old.portraitActorCacheFile !== row.portraitActorCacheFile ||
        old.portraitActressCacheFile !== row.portraitActressCacheFile ||
        old.portraitDirectorCacheFile !== row.portraitDirectorCacheFile ||
        old.portraitAuthorCacheFile !== row.portraitAuthorCacheFile ||
        old.portraitArtistCacheFile !== row.portraitArtistCacheFile ||
        old.tagLine !== row.tagLine ||
        old.year !== row.year ||
        old.mediaType !== row.mediaType ||
        old.genres !== row.genres ||
        old.topCast !== row.topCast ||
        old.actor1 !== row.actor1 ||
        old.actor2 !== row.actor2 ||
        old.studio !== row.studio ||
        Number(old.runtimeMins || 0) !== Number(row.runtimeMins || 0) ||
        old.rating !== row.rating ||
        old.contentRating !== row.contentRating ||
        old.plot !== row.plot ||
        old.ratingScore !== row.ratingScore ||
        old.ratingContent !== row.ratingContent ||
        old.serverKind !== row.serverKind ||
        old.summary !== row.summary ||
        old.posterAR !== row.posterAR ||
        old.dbid !== row.dbid ||
        old.sourceUrl !== row.sourceUrl ||
        old.apiItemId !== row.apiItemId ||
        old.libraryKind !== row.libraryKind ||
        old.libraryName !== row.libraryName;

      if (needsWrite) {
        ins.run(entryToParams(row));
        changed = true;
        written += 1;
      }
    }
    _sqlDb.run("COMMIT");
  } catch (e) {
    try {
      _sqlDb.run("ROLLBACK");
    } catch (e2) {
      /* ignore */
    }
    throw e;
  } finally {
    ins.free();
  }

  if (changed) {
    enforceMaxEntries();
    persistDb();
  }
  const rowCountAfter = countRows();
  return {
    totalCards: cards.length,
    posterUrlPresent,
    normalizedCacheFile,
    fileOk: fileOkCount,
    titlePresent,
    written,
    rowCountBefore,
    rowCountAfter,
  };
}

function pickRandomEntries(count, serverKindOpt) {
  let valid = selectAllEntries().filter((e) => e.cacheFile && fileOk(e.cacheFile));
  if (valid.length === 0) return [];
  const wantKind =
    serverKindOpt != null && String(serverKindOpt).trim()
      ? String(serverKindOpt).toLowerCase().trim()
      : "";
  if (wantKind) {
    const filtered = valid.filter(
      (e) => String(e.serverKind || "").toLowerCase() === wantKind
    );
    if (filtered.length > 0) valid = filtered;
  }
  const shuffled = valid.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

/** Match EmbyJellyfinBase.ratingColour / MediaCard content-rating pills for DB-built OD cards. */
function ratingColourForContentRating(contentRating) {
  const cr = (contentRating || "NR").toLowerCase();
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
 * For live on-demand cards: point poster (and fanart when present) at disk cache if the poster DB has a match.
 * @param {object[]} cards
 * @param {string} serverKind plex|jellyfin|emby|kodi
 */
function applyCachedPostersToMediaCards(cards, serverKind) {
  if (!Array.isArray(cards) || cards.length === 0) return cards;
  const kind = String(serverKind || "plex").toLowerCase();
  assertDb();
  const byApiId = new Map();
  const byDbId = new Map();
  const bySource = new Map();
  for (const e of selectByServerKind(kind)) {
    if (!e.cacheFile || !fileOk(e.cacheFile)) continue;
    const api = String(e.apiItemId || "").trim();
    const dbid = String(e.dbid || "").trim();
    const src = String(e.sourceUrl || "").trim();
    if (api) byApiId.set(api, e);
    if (dbid) byDbId.set(dbid, e);
    if (src) bySource.set(src, e);
  }
  for (const card of cards) {
    if (!card || typeof card !== "object") continue;
    let row = null;
    const api = String(card.posterApiItemId || "").trim();
    if (api && byApiId.has(api)) row = byApiId.get(api);
    if (!row) {
      const d = String(card.DBID || "").trim();
      if (d && byDbId.has(d)) row = byDbId.get(d);
    }
    if (!row) {
      const u = String(card.posterDownloadURL || "").trim();
      if (u && bySource.has(u)) row = bySource.get(u);
    }
    if (!row) continue;
    card.posterURL = "/imagecache/" + row.cacheFile;
    const artFn = resolveBackdropCacheFile(row.cacheFile);
    if (artFn) card.posterArtURL = "/imagecache/" + artFn;
    if (!card.genre || (Array.isArray(card.genre) && card.genre.length === 0)) {
      const g = row.genres != null ? String(row.genres).trim() : "";
      if (g) card.genre = g;
    }
    if (!card.studio && row.studio) card.studio = row.studio;
    if (
      (!card.runTime || card.runTime === "" || card.runTime === 0) &&
      row.runtimeMins > 0
    ) {
      card.runTime = String(row.runtimeMins);
    }
    if (!card.rating && row.rating) card.rating = row.rating;
    if (!card.contentRating && row.contentRating) {
      card.contentRating = row.contentRating;
      card.ratingColour = ratingColourForContentRating(row.contentRating);
    }
    if (!card.cast && row.topCast) card.cast = String(row.topCast).trim();
    if (!card.cast) {
      const a = [row.actor1, row.actor2].filter((x) => x && String(x).trim());
      if (a.length) card.cast = a.join(", ");
    }
    if (!card.actor1 && row.actor1) card.actor1 = row.actor1;
    if (!card.actor2 && row.actor2) card.actor2 = row.actor2;
    if (!String(card.actor1 || "").trim() || !String(card.actor2 || "").trim()) {
      const cp = String(card.cast || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (!String(card.actor1 || "").trim()) card.actor1 = cp[0] || "";
      if (!String(card.actor2 || "").trim()) card.actor2 = cp[1] || "";
    }
  }
  return cards;
}

/**
 * Build on-demand style cards from the poster metadata DB when nothing else is available.
 * @param {number} count
 * @param {string} [serverKind] When set, prefer random picks from this server (plex|jellyfin|emby|kodi).
 * @returns {MediaCard[]}
 */
function buildFallbackMediaCards(count, serverKind) {
  const n =
    typeof count === "number" &&
    count > 0 &&
    Number.isFinite(count)
      ? Math.floor(count)
      : DEFAULT_FALLBACK_COUNT;
  const rows = pickRandomEntries(n, serverKind);
  const cards = [];
  for (const row of rows) {
    const c = new MediaCard();
    c.cardType = CardType.CardTypeEnum.OnDemand;
    c.mediaType = row.mediaType || "movie";
    c.title = row.title || "";
    c.tagLine = row.tagLine || "";
    c.year = row.year || "";
    c.summary = row.summary || "";
    c.posterURL = "/imagecache/" + row.cacheFile;
    const artFn = resolveBackdropCacheFile(row.cacheFile);
    c.posterArtURL = artFn ? "/imagecache/" + artFn : "";
    if (row.posterAR) c.posterAR = row.posterAR;
    c.DBID = row.dbid || "";
    c.posterApiItemId = String(row.apiItemId || "").trim();
    c.posterLibraryLabel = row.libraryName || "";
    if (row.logoCacheFile) {
      c.posterLogoURL = "/imagecache/" + row.logoCacheFile;
    }
    c.genre = row.genres != null ? String(row.genres).trim() : "";
    c.studio = row.studio || "";
    if (row.runtimeMins > 0) c.runTime = String(row.runtimeMins);
    c.rating = row.rating || "";
    c.contentRating = row.contentRating || "";
    c.ratingColour = ratingColourForContentRating(c.contentRating || "NR");
    const castBits = [row.actor1, row.actor2].filter(
      (x) => x && String(x).trim()
    );
    c.cast =
      row.topCast && String(row.topCast).trim()
        ? String(row.topCast).trim()
        : castBits.join(", ");
    c.actor1 = String(row.actor1 || "").trim();
    c.actor2 = String(row.actor2 || "").trim();
    if (!c.actor1 || !c.actor2) {
      const cp = String(c.cast || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      if (!c.actor1) c.actor1 = cp[0] || "";
      if (!c.actor2) c.actor2 = cp[1] || "";
    }
    if (row.portraitActorCacheFile) {
      c.portraitActorURL = "/imagecache/" + row.portraitActorCacheFile;
    }
    if (row.portraitActressCacheFile) {
      c.portraitActressURL = "/imagecache/" + row.portraitActressCacheFile;
    }
    if (row.portraitDirectorCacheFile) {
      c.portraitDirectorURL = "/imagecache/" + row.portraitDirectorCacheFile;
    }
    if (row.portraitAuthorCacheFile) {
      c.portraitAuthorURL = "/imagecache/" + row.portraitAuthorCacheFile;
    }
    if (row.portraitArtistCacheFile) {
      c.portraitArtistURL = "/imagecache/" + row.portraitArtistCacheFile;
    }
    c.theme = "";
    cards.push(c);
  }
  return cards;
}

/**
 * Remove all files in config/cache/imagecache and reset poster metadata DB (used from settings).
 */
async function clearPosterCacheAndMetadata() {
  await Cache.DeleteImageCache();
  fs.mkdirSync(SAVED, { recursive: true });
  assertDb();
  _sqlDb.run("DELETE FROM poster_entries");
  persistDb();
  try {
    if (fs.existsSync(LEGACY_JSON)) fs.unlinkSync(LEGACY_JSON);
  } catch (e) {
    /* ignore */
  }
  try {
    const strayJson = path.join(CACHE_ROOT, "posterr-poster-metadata.json");
    if (fs.existsSync(strayJson)) fs.unlinkSync(strayJson);
  } catch (e) {
    /* ignore */
  }
  try {
    const bak = LEGACY_JSON + ".migrated.bak";
    if (fs.existsSync(bak)) fs.unlinkSync(bak);
  } catch (e) {
    /* ignore */
  }
  const now = new Date();
  console.log(
    now.toLocaleString() +
      " Poster image cache and metadata database cleared (user action)"
  );
}

/**
 * Drop orphaned DB rows, then re-download stale poster files when sourceUrl is known
 * (otherwise remove file + row). Timer interval should match settings.posterCacheRefreshMins.
 * @param {{ refreshMins: number, minAgeBeforeChangeCheckMins?: number, imageDownloadHeaders?: object }} opts
 */
async function runScheduledRefresh(opts) {
  let purgeResult = { removed: 0, checked: 0 };
  if (
    opts &&
    opts.probeEntryGone &&
    opts.isMediaServerEnabled &&
    opts.currentServerKind
  ) {
    purgeResult = await purgeMissingServerItems(opts);
  }

  const refreshMins = Math.max(
    0,
    parseInt(opts && opts.refreshMins, 10) || 0
  );
  if (refreshMins <= 0) return { skipped: true, purge: purgeResult };

  const maxAgeMs = refreshMins * 60 * 1000;
  const minAgeMs = Math.max(
    0,
    parseInt(opts && opts.minAgeBeforeChangeCheckMins, 10) || 0
  ) * 60 * 1000;
  const now = new Date();
  const nowMs = now.getTime();
  const iso = now.toISOString();

  const entries = selectAllEntries();
  const keep = [];
  let changed = false;
  let refreshed = 0;
  let dropped = 0;

  for (const entry of entries) {
    if (!entry.cacheFile) {
      changed = true;
      dropped++;
      continue;
    }
    if (!fileOk(entry.cacheFile)) {
      changed = true;
      dropped++;
      continue;
    }

    const ageMs = nowMs - new Date(entry.updatedAt || 0).getTime();
    if (ageMs < minAgeMs) {
      keep.push(entry);
      continue;
    }
    if (ageMs < maxAgeMs) {
      keep.push(entry);
      continue;
    }

    const url = String(entry.sourceUrl || "").trim();
    const cacheBase =
      cacheBasenameFromStoredValue(entry.cacheFile) || entry.cacheFile;
    const fp = path.join(IMAGECACHE, cacheBase);
    if (url) {
      try {
        const imgHdr = opts && opts.imageDownloadHeaders;
        await Cache.downloadImageForce(
          url,
          fp,
          imgHdr && typeof imgHdr === "object"
            ? { headers: imgHdr }
            : undefined
        );
        if (fileOk(entry.cacheFile)) {
          entry.updatedAt = iso;
          keep.push(entry);
          refreshed++;
          changed = true;
        } else {
          try {
            if (fs.existsSync(fp)) fs.unlinkSync(fp);
          } catch (e) {
            /* ignore */
          }
          dropped++;
          changed = true;
        }
      } catch (e) {
        try {
          if (fs.existsSync(fp)) fs.unlinkSync(fp);
        } catch (e2) {
          /* ignore */
        }
        dropped++;
        changed = true;
      }
    } else {
      try {
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      } catch (e) {
        /* ignore */
      }
      dropped++;
      changed = true;
    }
  }

  if (changed) {
    replaceAllEntries(keep);
    persistDb();
  }

  if (refreshed > 0 || dropped > 0) {
    console.log(
      now.toLocaleString() +
        " Poster cache refresh: " +
        refreshed +
        " image(s) re-downloaded, " +
        dropped +
        " removed or invalidated"
    );
  }

  return { refreshed, dropped, skipped: false, purge: purgeResult };
}

function dirFileStats(dir) {
  if (!fs.existsSync(dir)) return { count: 0, bytes: 0 };
  let count = 0;
  let bytes = 0;
  try {
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      const st = fs.statSync(fp);
      if (st.isFile()) {
        count += 1;
        bytes += st.size;
      }
    }
  } catch (e) {
    /* ignore */
  }
  return { count, bytes };
}

function libLabel(name) {
  const s = String(name || "").trim();
  return s || "(unknown library)";
}

/** Display / sort order for Settings → Cache image breakdown. */
const IMAGE_KIND_ORDER = [
  "people",
  "album",
  "book",
  "audiobook",
  "poster",
  "logo",
  "banner",
  "background",
  "other",
];

function emptyKindCounts() {
  /** @type {Record<string, number>} */
  const o = {};
  for (const k of IMAGE_KIND_ORDER) o[k] = 0;
  return o;
}

/**
 * Classify a cached image filename into a dashboard bucket.
 * @param {string} fname
 * @param {Set<string>} primarySet
 * @param {Map<string, string>} posterFileToMediaType cache_file -> media_type
 */
function classifyImageKind(fname, primarySet, posterFileToMediaType) {
  if (!fname || typeof fname !== "string") return "other";
  if (!/\.(jpe?g|png)$/i.test(fname)) return "other";
  if (/-logo\.(png|jpe?g)$/i.test(fname)) return "logo";
  if (/\.png$/i.test(fname)) return "other";
  if (/-banner\.jpg$/i.test(fname)) return "banner";
  if (/-(actor|actress|director|author|artist)\.jpg$/i.test(fname))
    return "people";
  if (/-art\.jpg$/i.test(fname)) return "background";
  if (primarySet.has(fname)) {
    const mt = String(posterFileToMediaType.get(fname) || "movie")
      .toLowerCase()
      .trim();
    if (mt === "album") return "album";
    if (mt === "ebook") return "book";
    if (mt === "audiobook") return "audiobook";
    return "poster";
  }
  if (
    /\.jpe?g$/i.test(fname) &&
    !/-(art|banner)\.jpg$/i.test(fname) &&
    !/-(actor|actress|director|author|artist)\.jpg$/i.test(fname)
  ) {
    return "poster";
  }
  return "other";
}

/**
 * Stats for Settings → Cache (poster DB, image files by type/library, mp3 themes).
 * @returns {object}
 */
function getCacheDashboardStats() {
  const entries = selectAllEntries();

  const posterByLib = {};
  let rowsValid = 0;
  let rowsMissing = 0;

  const fileToLibrary = new Map();
  const posterFileToMediaType = new Map();
  for (const e of entries) {
    const lib = libLabel(e.libraryName);
    if (!posterByLib[lib]) {
      posterByLib[lib] = {
        name: lib,
        total: 0,
        valid: 0,
        missingFile: 0,
        byMediaType: {},
      };
    }
    posterByLib[lib].total += 1;
    const mt = String(e.mediaType || "other").toLowerCase() || "other";
    if (e.cacheFile) {
      posterFileToMediaType.set(e.cacheFile, mt);
    }
    if (e.cacheFile && fileOk(e.cacheFile)) {
      rowsValid += 1;
      posterByLib[lib].valid += 1;
      posterByLib[lib].byMediaType[mt] =
        (posterByLib[lib].byMediaType[mt] || 0) + 1;
      fileToLibrary.set(e.cacheFile, lib);
    } else {
      rowsMissing += 1;
      posterByLib[lib].missingFile += 1;
    }
  }

  function libraryForImageFile(fname) {
    if (fileToLibrary.has(fname)) return fileToLibrary.get(fname);
    const artM = fname.match(/^(.+)-art\.jpg$/i);
    if (artM) {
      const base = artM[1] + ".jpg";
      if (fileToLibrary.has(base)) return fileToLibrary.get(base);
    }
    const bannerM = fname.match(/^(.+)-banner\.jpg$/i);
    if (bannerM) {
      const base = bannerM[1] + ".jpg";
      if (fileToLibrary.has(base)) return fileToLibrary.get(base);
    }
    const portM = fname.match(
      /^(.+)-(actor|actress|director|author|artist)\.jpg$/i
    );
    if (portM) {
      const base = portM[1] + ".jpg";
      if (fileToLibrary.has(base)) return fileToLibrary.get(base);
    }
    const logoM = fname.match(/^(.+)-logo\.(png|jpe?g)$/i);
    if (logoM) {
      const base = logoM[1] + ".jpg";
      if (fileToLibrary.has(base)) return fileToLibrary.get(base);
    }
    return "(unassigned)";
  }

  const byCategory = emptyKindCounts();
  const diskByLib = {};
  let imageFiles = 0;
  let imageBytes = 0;

  const primarySet = new Set(entries.map((e) => e.cacheFile).filter(Boolean));

  if (fs.existsSync(IMAGECACHE)) {
    try {
      const names = fs.readdirSync(IMAGECACHE).filter((fname) =>
        /\.(jpe?g|png)$/i.test(fname)
      );
      names.sort((a, b) => {
        const ka = classifyImageKind(a, primarySet, posterFileToMediaType);
        const kb = classifyImageKind(b, primarySet, posterFileToMediaType);
        const ia = IMAGE_KIND_ORDER.indexOf(ka);
        const ib = IMAGE_KIND_ORDER.indexOf(kb);
        const oa = ia === -1 ? 99 : ia;
        const ob = ib === -1 ? 99 : ib;
        if (oa !== ob) return oa - ob;
        return a.localeCompare(b, undefined, { sensitivity: "base" });
      });
      for (const fname of names) {
        const fp = path.join(IMAGECACHE, fname);
        let st;
        try {
          st = fs.statSync(fp);
        } catch (e) {
          continue;
        }
        if (!st.isFile() || st.size < MIN_FILE_BYTES) continue;
        imageFiles += 1;
        imageBytes += st.size;

        const kind = classifyImageKind(fname, primarySet, posterFileToMediaType);
        byCategory[kind] += 1;

        const lib = libraryForImageFile(fname);
        if (!diskByLib[lib]) {
          diskByLib[lib] = {
            name: lib,
            ...emptyKindCounts(),
            bytes: 0,
          };
        }
        diskByLib[lib][kind] += 1;
        diskByLib[lib].bytes += st.size;
      }
    } catch (e) {
      /* ignore */
    }
  }

  const posterLibraries = Object.values(posterByLib).sort((a, b) =>
    a.name.localeCompare(b.name)
  );
  const diskLibraries = Object.values(diskByLib).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  const mp3 = dirFileStats(MP3CACHE);

  return {
    generatedAt: new Date().toISOString(),
    posterDb: {
      rowCount: entries.length,
      rowsWithValidFile: rowsValid,
      rowsMissingFile: rowsMissing,
      byLibrary: posterLibraries,
    },
    imagecache: {
      fileCount: imageFiles,
      totalBytes: imageBytes,
      byCategory,
      kindOrder: IMAGE_KIND_ORDER.slice(),
      byLibrary: diskLibraries,
    },
    mp3cache: {
      fileCount: mp3.count,
      totalBytes: mp3.bytes,
    },
  };
}

module.exports = {
  initPosterMetadataDb,
  registerFromMediaServerCards,
  applyCachedPostersToMediaCards,
  buildFallbackMediaCards,
  clearPosterCacheAndMetadata,
  runScheduledRefresh,
  purgeMissingServerItems,
  getCacheDashboardStats,
  DEFAULT_FALLBACK_COUNT,
  normalizeCacheFile,
  getEntryByServerAndApiItemId,
  shouldSkipSyncItem,
  cacheBasenameFromStoredValue,
  fileOk,
  IMAGE_KIND_ORDER,
  countRows,
};
