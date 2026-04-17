const fs = require("fs");
const path = require("path");
const { CONFIG_ROOT } = require("./appPaths");

const DB_FILE = path.join(CONFIG_ROOT, "holidays.db");

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS holiday_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL DEFAULT 'fixed',
  start_md TEXT NOT NULL DEFAULT '',
  end_md TEXT NOT NULL DEFAULT '',
  month_num INTEGER NOT NULL DEFAULT 11,
  weekday_num INTEGER NOT NULL DEFAULT 4,
  nth_value TEXT NOT NULL DEFAULT '4',
  span_days INTEGER NOT NULL DEFAULT 0,
  tag_text TEXT NOT NULL DEFAULT '',
  title_keywords TEXT NOT NULL DEFAULT '',
  plot_keywords TEXT NOT NULL DEFAULT '',
  match_mode TEXT NOT NULL DEFAULT 'or',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT ''
);
`;

let _db = null;

function assertDb() {
  if (!_db) throw new Error("Holidays DB not initialized");
}

function persistDb() {
  assertDb();
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  fs.writeFileSync(DB_FILE, Buffer.from(_db.export()));
}

function ensureExtraColumns() {
  assertDb();
  const cols = new Set();
  const s = _db.prepare("PRAGMA table_info(holiday_rules)");
  while (s.step()) {
    const r = s.getAsObject();
    cols.add(String(r.name || "").toLowerCase());
  }
  s.free();
  let changed = false;
  if (!cols.has("plot_keywords")) {
    _db.run("ALTER TABLE holiday_rules ADD COLUMN plot_keywords TEXT NOT NULL DEFAULT ''");
    changed = true;
  }
  if (!cols.has("title_keywords")) {
    _db.run("ALTER TABLE holiday_rules ADD COLUMN title_keywords TEXT NOT NULL DEFAULT ''");
    changed = true;
  }
  if (!cols.has("match_mode")) {
    _db.run("ALTER TABLE holiday_rules ADD COLUMN match_mode TEXT NOT NULL DEFAULT 'or'");
    changed = true;
  }
  if (changed) persistDb();
}

async function initHolidaysDb() {
  if (_db) return;
  const initSqlJs = require("sql.js");
  const wasmPath = path.join(
    path.dirname(require.resolve("sql.js/package.json")),
    "dist",
    "sql-wasm.wasm"
  );
  const SQL = await initSqlJs({ locateFile: () => wasmPath });
  fs.mkdirSync(path.dirname(DB_FILE), { recursive: true });
  if (fs.existsSync(DB_FILE)) _db = new SQL.Database(fs.readFileSync(DB_FILE));
  else _db = new SQL.Database();
  _db.exec(SCHEMA_SQL);
  ensureExtraColumns();
  if (!fs.existsSync(DB_FILE)) persistDb();
}

function listRules() {
  assertDb();
  const out = [];
  const s = _db.prepare("SELECT * FROM holiday_rules ORDER BY sort_order ASC, id ASC");
  while (s.step()) {
    const r = s.getAsObject();
    out.push({
      id: Number(r.id),
      mode: String(r.mode || "fixed"),
      start: String(r.start_md || ""),
      end: String(r.end_md || ""),
      month: Number(r.month_num) || 11,
      weekday: Number(r.weekday_num) || 4,
      nth: String(r.nth_value || "4"),
      spanDays: Number(r.span_days) || 0,
      tag: String(r.tag_text || ""),
      titleKeywords: String(r.title_keywords || ""),
      plotKeywords: String(r.plot_keywords || ""),
      matchMode: String(r.match_mode || "or"),
      sortOrder: Number(r.sort_order) || 0,
    });
  }
  s.free();
  return out;
}

function replaceRules(rules) {
  assertDb();
  const list = Array.isArray(rules) ? rules : [];
  const now = new Date().toISOString();
  const ins = _db.prepare(
    "INSERT INTO holiday_rules (mode, start_md, end_md, month_num, weekday_num, nth_value, span_days, tag_text, title_keywords, plot_keywords, match_mode, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
  );
  try {
    _db.run("BEGIN");
    _db.run("DELETE FROM holiday_rules");
    for (let i = 0; i < list.length; i++) {
      const r = list[i] || {};
      ins.run([
        String(r.mode || "fixed"),
        String(r.start || ""),
        String(r.end || ""),
        Number(r.month) || 11,
        Number(r.weekday) || 4,
        String(r.nth || "4"),
        Number(r.spanDays) || 0,
        String(r.tag || ""),
        String(r.titleKeywords || ""),
        String(r.plotKeywords || ""),
        String(r.matchMode || "or"),
        i,
        now,
        now,
      ]);
    }
    _db.run("COMMIT");
  } catch (e) {
    try {
      _db.run("ROLLBACK");
    } catch (_e) {}
    throw e;
  } finally {
    ins.free();
  }
  persistDb();
}

function migrateLegacyRulesFromJson(raw) {
  assertDb();
  if (listRules().length > 0) return false;
  let parsed = [];
  try {
    parsed = JSON.parse(String(raw || "[]"));
  } catch (e) {
    parsed = [];
  }
  if (!Array.isArray(parsed) || !parsed.length) return false;
  replaceRules(parsed);
  return true;
}

module.exports = {
  DB_FILE,
  initHolidaysDb,
  listRules,
  replaceRules,
  migrateLegacyRulesFromJson,
};

