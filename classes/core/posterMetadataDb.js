const fs = require("fs");
const path = require("path");
const Cache = require("./cache");
const MediaCard = require("../cards/MediaCard");
const CardType = require("../cards/CardType");

const SAVED = path.join(process.cwd(), "saved");
/** SQLite poster metadata (replaces legacy JSON). */
const SQLITE_DB = path.join(SAVED, "posterr-poster-metadata.db");
/** Legacy file; migrated once into SQLite then renamed. */
const LEGACY_JSON = path.join(SAVED, "posterr-poster-metadata.json");
const IMAGECACHE = path.join(SAVED, "imagecache");
const MP3CACHE = path.join(SAVED, "mp3cache");
/** Upper bound on poster metadata rows (full-library sync can exceed the old 2500 cap). */
const MAX_ENTRIES = 100000;
const MIN_FILE_BYTES = 256;
const DEFAULT_FALLBACK_COUNT = 24;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS poster_entries (
  cache_file TEXT PRIMARY KEY NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  tag_line TEXT NOT NULL DEFAULT '',
  year TEXT NOT NULL DEFAULT '',
  media_type TEXT NOT NULL DEFAULT 'movie',
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

function assertDb() {
  if (!_sqlDb) {
    throw new Error(
      "Poster metadata database was not initialized. Ensure initPosterMetadataDb() runs at startup."
    );
  }
}

function persistDb() {
  assertDb();
  fs.mkdirSync(SAVED, { recursive: true });
  const data = _sqlDb.export();
  fs.writeFileSync(SQLITE_DB, Buffer.from(data));
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
  fs.mkdirSync(SAVED, { recursive: true });

  const hadSqliteFile = fs.existsSync(SQLITE_DB);
  if (hadSqliteFile) {
    const buf = fs.readFileSync(SQLITE_DB);
    _sqlDb = new SQL.Database(buf);
  } else {
    _sqlDb = new SQL.Database();
  }
  _sqlDb.exec(SCHEMA_SQL);

  const cnt = countRows();
  if (cnt === 0 && fs.existsSync(LEGACY_JSON)) {
    try {
      migrateLegacyJson();
      persistDb();
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
  } else if (!hadSqliteFile) {
    persistDb();
  }
}

function migrateLegacyJson() {
  assertDb();
  const raw = fs.readFileSync(LEGACY_JSON, "utf8");
  const parsed = JSON.parse(raw);
  const entries = parsed && Array.isArray(parsed.entries) ? parsed.entries : [];
  const ins = _sqlDb.prepare(`
    INSERT OR REPLACE INTO poster_entries (
      cache_file, title, tag_line, year, media_type, summary, server_kind, poster_ar,
      dbid, api_item_id, library_kind, library_name, source_url, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  try {
    _sqlDb.run("BEGIN");
    for (const e of entries) {
      const row = entryToParams({
        cacheFile: e.cacheFile,
        title: e.title,
        tagLine: e.tagLine,
        year: e.year,
        mediaType: e.mediaType,
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
    title: r.title || "",
    tagLine: r.tag_line || "",
    year: r.year || "",
    mediaType: r.media_type || "",
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
    e.title || "",
    e.tagLine || "",
    e.year || "",
    e.mediaType || "movie",
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
      cache_file, title, tag_line, year, media_type, summary, server_kind, poster_ar,
      dbid, api_item_id, library_kind, library_name, source_url, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
  const idx = posterURL.indexOf("/imagecache/");
  if (idx === -1) return null;
  let rest = posterURL.slice(idx + "/imagecache/".length);
  if (rest.includes("?")) rest = rest.split("?")[0];
  const base = path.basename(rest);
  if (!base || /[\\/]/.test(base) || base.includes("..")) return null;
  return base;
}

function fileOk(cacheFile) {
  const fp = path.join(IMAGECACHE, cacheFile);
  try {
    const st = fs.statSync(fp);
    return st.isFile() && st.size >= MIN_FILE_BYTES;
  } catch (e) {
    return false;
  }
}

function unlinkCacheAndArt(cacheFile) {
  const fp = path.join(IMAGECACHE, cacheFile);
  try {
    if (fs.existsSync(fp)) fs.unlinkSync(fp);
  } catch (e) {
    /* ignore */
  }
  const m = String(cacheFile).match(/^(.+)\.jpg$/i);
  if (m) {
    try {
      const art = path.join(IMAGECACHE, m[1] + "-art.jpg");
      if (fs.existsSync(art)) fs.unlinkSync(art);
    } catch (e) {
      /* ignore */
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
  if (cards.length === 0) return;

  assertDb();
  let changed = false;
  const now = new Date().toISOString();
  const kind = String(serverKind || "plex").toLowerCase();

  const ins = _sqlDb.prepare(`
    INSERT OR REPLACE INTO poster_entries (
      cache_file, title, tag_line, year, media_type, summary, server_kind, poster_ar,
      dbid, api_item_id, library_kind, library_name, source_url, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    _sqlDb.run("BEGIN");
    for (const card of cards) {
      const cacheFile = normalizeCacheFile(card.posterURL);
      if (!cacheFile || !fileOk(cacheFile)) continue;

      const title = String(card.title || "").trim();
      if (!title) continue;

      let sourceUrl = String(card.posterDownloadURL || "").trim();
      let apiItemId = String(card.posterApiItemId || "").trim();
      let libraryKind = String(card.posterLibraryKind || "").trim();
      const libraryName = String(card.posterLibraryLabel || "").trim();

      const old = getEntryByCacheFile(cacheFile);
      if (!sourceUrl && old && old.sourceUrl) sourceUrl = old.sourceUrl;
      if (!apiItemId && old && old.apiItemId) apiItemId = old.apiItemId;
      if (!libraryKind && old && old.libraryKind) libraryKind = old.libraryKind;
      if (!libraryName && old && old.libraryName) libraryName = old.libraryName;

      const row = {
        cacheFile,
        title,
        tagLine: String(card.tagLine || "").trim(),
        year: String(card.year || "").trim(),
        mediaType: String(card.mediaType || "movie").trim() || "movie",
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

      const needsWrite =
        !old ||
        old.title !== row.title ||
        old.tagLine !== row.tagLine ||
        old.year !== row.year ||
        old.mediaType !== row.mediaType ||
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
    const m = String(row.cacheFile).match(/^(.+)\.(jpe?g)$/i);
    if (m) {
      const artFn = `${m[1]}-art.jpg`;
      if (fileOk(artFn)) card.posterArtURL = "/imagecache/" + artFn;
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
    c.posterArtURL = "";
    if (row.posterAR) c.posterAR = row.posterAR;
    c.DBID = row.dbid || "";
    c.theme = "";
    cards.push(c);
  }
  return cards;
}

/**
 * Remove all files in saved/imagecache and reset poster metadata DB (used from settings).
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
    const fp = path.join(IMAGECACHE, entry.cacheFile);
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
    const portM = fname.match(
      /^(.+)-(actor|actress|director|author|artist)\.jpg$/i
    );
    if (portM) {
      const base = portM[1] + ".jpg";
      if (fileToLibrary.has(base)) return fileToLibrary.get(base);
    }
    return "(unassigned)";
  }

  const byCategory = { primary: 0, fanart: 0, portrait: 0, other: 0 };
  const diskByLib = {};
  let imageFiles = 0;
  let imageBytes = 0;

  const portraitRe = /-(actor|actress|director|author|artist)\.jpg$/i;
  const primarySet = new Set(entries.map((e) => e.cacheFile).filter(Boolean));

  if (fs.existsSync(IMAGECACHE)) {
    try {
      for (const fname of fs.readdirSync(IMAGECACHE)) {
        if (!/\.(jpe?g)$/i.test(fname)) continue;
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

        let cat = "other";
        if (primarySet.has(fname)) cat = "primary";
        else if (/-art\.jpg$/i.test(fname)) cat = "fanart";
        else if (portraitRe.test(fname)) cat = "portrait";
        byCategory[cat] += 1;

        const lib = libraryForImageFile(fname);
        if (!diskByLib[lib]) {
          diskByLib[lib] = {
            name: lib,
            primary: 0,
            fanart: 0,
            portrait: 0,
            other: 0,
            bytes: 0,
          };
        }
        diskByLib[lib][cat] += 1;
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
};
