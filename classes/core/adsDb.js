const fs = require("fs");
const path = require("path");
const { CONFIG_ROOT } = require("./appPaths");

const DB_FILE = path.join(CONFIG_ROOT, "ads.db");

/**
 * Future ADS system DB.
 * Stores metadata/config only; image/media bytes remain on disk cache paths.
 */
const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS ads_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT DEFAULT '',
  media_path TEXT DEFAULT '',
  background_media_path TEXT DEFAULT '',
  price_addon REAL DEFAULT 0,
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT ''
);
CREATE TABLE IF NOT EXISTS ads_item_prices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id INTEGER NOT NULL,
  line_title TEXT DEFAULT '',
  amount REAL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  FOREIGN KEY(ad_id) REFERENCES ads_items(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ads_item_addons (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ad_id INTEGER NOT NULL,
  line_title TEXT DEFAULT '',
  amount REAL,
  sort_order INTEGER DEFAULT 0,
  created_at TEXT DEFAULT '',
  updated_at TEXT DEFAULT '',
  FOREIGN KEY(ad_id) REFERENCES ads_items(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS ads_settings (
  key TEXT PRIMARY KEY NOT NULL,
  value TEXT DEFAULT ''
);
`;

/** @type {any} */
let _db = null;

function assertDb() {
  if (!_db) throw new Error("ADS DB not initialized");
}

function persistDb() {
  assertDb();
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, Buffer.from(_db.export()));
}

function ensureAdsSchemaColumns() {
  assertDb();
  const existing = new Set();
  let changed = false;
  const s = _db.prepare("PRAGMA table_info(ads_items)");
  while (s.step()) {
    const row = s.getAsObject();
    existing.add(String(row.name || "").toLowerCase());
  }
  s.free();
  if (!existing.has("background_media_path")) {
    _db.run("ALTER TABLE ads_items ADD COLUMN background_media_path TEXT DEFAULT ''");
    changed = true;
  }
  if (!existing.has("price_addon")) {
    _db.run("ALTER TABLE ads_items ADD COLUMN price_addon REAL DEFAULT 0");
    changed = true;
  }
  migrateLegacyPriceAddonColumnToAddonsTable();
  return changed;
}

function migrateLegacyPriceAddonColumnToAddonsTable() {
  assertDb();
  let migrated = false;
  const now = new Date().toISOString();
  const sel = _db.prepare(
    "SELECT id, price_addon FROM ads_items WHERE IFNULL(price_addon,0) > 0"
  );
  while (sel.step()) {
    const r = sel.getAsObject();
    const id = Number(r.id);
    const amt = parseMoneyAmount(r.price_addon);
    if (amt == null || amt <= 0) continue;
    const chk = _db.prepare(
      "SELECT COUNT(*) AS c FROM ads_item_addons WHERE ad_id=? LIMIT 1"
    );
    chk.bind([id]);
    chk.step();
    const cnt = Number(chk.getAsObject().c) || 0;
    chk.free();
    if (cnt > 0) continue;
    _db.run(
      "INSERT INTO ads_item_addons (ad_id, line_title, amount, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      [id, "Add-on", amt, 0, now, now]
    );
    _db.run("UPDATE ads_items SET price_addon=0, updated_at=? WHERE id=?", [
      now,
      id,
    ]);
    migrated = true;
  }
  sel.free();
  if (migrated) persistDb();
}

function parseMoneyAmount(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

function rowToAdItem(r) {
  return {
    id: Number(r.id),
    title: String(r.title || ""),
    mediaPath: String(r.media_path || ""),
    backgroundMediaPath: String(r.background_media_path || ""),
    enabled: Number(r.enabled) === 1,
    createdAt: String(r.created_at || ""),
    updatedAt: String(r.updated_at || ""),
    prices: [],
    addons: [],
  };
}

function sanitizeAddonLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line, index) => {
      const title = String(line && line.title != null ? line.title : "").trim();
      const amount = parseMoneyAmount(line && line.amount);
      if (amount == null) return null;
      return {
        title,
        amount,
        sortOrder: Number.isFinite(Number(line && line.sortOrder))
          ? Math.max(0, parseInt(line.sortOrder, 10))
          : index,
      };
    })
    .filter(Boolean);
}

function sanitizePriceLines(lines) {
  if (!Array.isArray(lines)) return [];
  return lines
    .map((line, index) => {
      const title = String(line && line.title != null ? line.title : "").trim();
      const amount = parseMoneyAmount(line && line.amount);
      if (!title && amount == null) return null;
      return {
        title,
        amount,
        sortOrder: Number.isFinite(Number(line && line.sortOrder))
          ? Math.max(0, parseInt(line.sortOrder, 10))
          : index,
      };
    })
    .filter(Boolean);
}

function listAds() {
  assertDb();
  const out = [];
  const s = _db.prepare("SELECT * FROM ads_items ORDER BY id ASC");
  while (s.step()) out.push(rowToAdItem(s.getAsObject()));
  s.free();
  if (!out.length) return out;
  const priceStmt = _db.prepare(
    "SELECT id, ad_id, line_title, amount, sort_order FROM ads_item_prices ORDER BY ad_id ASC, sort_order ASC, id ASC"
  );
  const byAdId = new Map(out.map((ad) => [ad.id, ad]));
  while (priceStmt.step()) {
    const row = priceStmt.getAsObject();
    const adId = Number(row.ad_id);
    const ad = byAdId.get(adId);
    if (!ad) continue;
    ad.prices.push({
      id: Number(row.id),
      title: String(row.line_title || ""),
      amount: parseMoneyAmount(row.amount),
      sortOrder: Number(row.sort_order) || 0,
    });
  }
  priceStmt.free();
  const addonStmt = _db.prepare(
    "SELECT id, ad_id, line_title, amount, sort_order FROM ads_item_addons ORDER BY ad_id ASC, sort_order ASC, id ASC"
  );
  while (addonStmt.step()) {
    const row = addonStmt.getAsObject();
    const adId = Number(row.ad_id);
    const ad = byAdId.get(adId);
    if (!ad) continue;
    ad.addons.push({
      id: Number(row.id),
      title: String(row.line_title || ""),
      amount: parseMoneyAmount(row.amount),
      sortOrder: Number(row.sort_order) || 0,
    });
  }
  addonStmt.free();
  return out;
}

function getAdById(id) {
  assertDb();
  const nid = parseInt(id, 10);
  if (!nid) return null;
  const s = _db.prepare("SELECT * FROM ads_items WHERE id=? LIMIT 1");
  s.bind([nid]);
  let row = null;
  if (s.step()) row = rowToAdItem(s.getAsObject());
  s.free();
  if (!row) return null;
  const ps = _db.prepare(
    "SELECT id, line_title, amount, sort_order FROM ads_item_prices WHERE ad_id=? ORDER BY sort_order ASC, id ASC"
  );
  ps.bind([nid]);
  while (ps.step()) {
    const p = ps.getAsObject();
    row.prices.push({
      id: Number(p.id),
      title: String(p.line_title || ""),
      amount: parseMoneyAmount(p.amount),
      sortOrder: Number(p.sort_order) || 0,
    });
  }
  ps.free();
  const as = _db.prepare(
    "SELECT id, line_title, amount, sort_order FROM ads_item_addons WHERE ad_id=? ORDER BY sort_order ASC, id ASC"
  );
  as.bind([nid]);
  while (as.step()) {
    const a = as.getAsObject();
    row.addons.push({
      id: Number(a.id),
      title: String(a.line_title || ""),
      amount: parseMoneyAmount(a.amount),
      sortOrder: Number(a.sort_order) || 0,
    });
  }
  as.free();
  return row;
}

function createAd(input) {
  assertDb();
  const now = new Date().toISOString();
  const title = String((input && input.title) || "").trim();
  const mediaPath = String((input && input.mediaPath) || "").trim();
  const backgroundMediaPath = String(
    (input && input.backgroundMediaPath) || ""
  ).trim();
  const enabled = input && input.enabled === false ? 0 : 1;
  _db.run(
    "INSERT INTO ads_items (title, media_path, background_media_path, price_addon, enabled, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
    [title, mediaPath, backgroundMediaPath, 0, enabled, now, now]
  );
  const rs = _db.exec("SELECT last_insert_rowid() AS id");
  const id =
    rs &&
    rs[0] &&
    rs[0].values &&
    rs[0].values[0] &&
    parseInt(rs[0].values[0][0], 10);
  persistDb();
  return id || 0;
}

function updateAd(id, input) {
  assertDb();
  const nid = parseInt(id, 10);
  if (!nid) throw new Error("Invalid ad id");
  const current = getAdById(nid);
  if (!current) throw new Error("Ad not found");
  const title =
    input && Object.prototype.hasOwnProperty.call(input, "title")
      ? String(input.title || "").trim()
      : current.title;
  const mediaPath =
    input && Object.prototype.hasOwnProperty.call(input, "mediaPath")
      ? String(input.mediaPath || "").trim()
      : current.mediaPath;
  const backgroundMediaPath =
    input && Object.prototype.hasOwnProperty.call(input, "backgroundMediaPath")
      ? String(input.backgroundMediaPath || "").trim()
      : current.backgroundMediaPath;
  const enabled =
    input && Object.prototype.hasOwnProperty.call(input, "enabled")
      ? input.enabled === false
        ? 0
        : 1
      : current.enabled
      ? 1
      : 0;
  _db.run(
    "UPDATE ads_items SET title=?, media_path=?, background_media_path=?, enabled=?, updated_at=? WHERE id=?",
    [
      title,
      mediaPath,
      backgroundMediaPath,
      enabled,
      new Date().toISOString(),
      nid,
    ]
  );
  persistDb();
}

function replaceAdPrices(id, lines) {
  assertDb();
  const nid = parseInt(id, 10);
  if (!nid) throw new Error("Invalid ad id");
  const clean = sanitizePriceLines(lines);
  _db.run("DELETE FROM ads_item_prices WHERE ad_id=?", [nid]);
  const now = new Date().toISOString();
  for (let i = 0; i < clean.length; i++) {
    const line = clean[i];
    _db.run(
      "INSERT INTO ads_item_prices (ad_id, line_title, amount, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      [nid, line.title, line.amount, line.sortOrder != null ? line.sortOrder : i, now, now]
    );
  }
  _db.run("UPDATE ads_items SET updated_at=? WHERE id=?", [now, nid]);
  persistDb();
}

function replaceAdAddons(id, lines) {
  assertDb();
  const nid = parseInt(id, 10);
  if (!nid) throw new Error("Invalid ad id");
  const clean = sanitizeAddonLines(lines);
  _db.run("DELETE FROM ads_item_addons WHERE ad_id=?", [nid]);
  const now = new Date().toISOString();
  for (let i = 0; i < clean.length; i++) {
    const line = clean[i];
    _db.run(
      "INSERT INTO ads_item_addons (ad_id, line_title, amount, sort_order, created_at, updated_at) VALUES (?,?,?,?,?,?)",
      [nid, line.title, line.amount, line.sortOrder != null ? line.sortOrder : i, now, now]
    );
  }
  _db.run("UPDATE ads_items SET updated_at=? WHERE id=?", [now, nid]);
  persistDb();
}

function deleteAd(id) {
  assertDb();
  const nid = parseInt(id, 10);
  if (!nid) return;
  _db.run("DELETE FROM ads_item_addons WHERE ad_id=?", [nid]);
  _db.run("DELETE FROM ads_item_prices WHERE ad_id=?", [nid]);
  _db.run("DELETE FROM ads_items WHERE id=?", [nid]);
  persistDb();
}

function getSetting(key, fallbackValue) {
  assertDb();
  const k = String(key || "").trim();
  if (!k) return fallbackValue;
  const s = _db.prepare("SELECT value FROM ads_settings WHERE key=? LIMIT 1");
  s.bind([k]);
  let value = fallbackValue;
  if (s.step()) {
    const row = s.getAsObject();
    value = row && row.value != null ? String(row.value) : fallbackValue;
  }
  s.free();
  return value;
}

function setSetting(key, value) {
  assertDb();
  const k = String(key || "").trim();
  if (!k) return;
  _db.run(
    "INSERT INTO ads_settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [k, String(value == null ? "" : value)]
  );
  persistDb();
}

async function initAdsDb() {
  if (_db) return;
  const initSqlJs = require("sql.js");
  const wasmPath = path.join(
    path.dirname(require.resolve("sql.js/package.json")),
    "dist",
    "sql-wasm.wasm"
  );
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  if (fs.existsSync(DB_FILE)) {
    _db = new SQL.Database(fs.readFileSync(DB_FILE));
  } else {
    _db = new SQL.Database();
  }
  _db.exec(SCHEMA_SQL);
  _db.run("PRAGMA foreign_keys = ON");
  const schemaChanged = ensureAdsSchemaColumns();
  if (!fs.existsSync(DB_FILE)) {
    persistDb();
  } else if (schemaChanged) {
    persistDb();
  }
}

module.exports = {
  DB_FILE,
  initAdsDb,
  listAds,
  getAdById,
  createAd,
  updateAd,
  replaceAdPrices,
  replaceAdAddons,
  deleteAd,
  getSetting,
  setSetting,
};
