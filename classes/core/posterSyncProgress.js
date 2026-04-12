/**
 * Helpers for poster full-library sync UI (per-library + overall progress).
 */

/**
 * @param {string} configuredCsv
 * @param {object[]} matchedEntries
 * @param {(e: object) => string} keyFromEntry
 * @param {(e: object) => string} displayFromEntry
 */
function buildLibraryProgressRows(
  configuredCsv,
  matchedEntries,
  keyFromEntry,
  displayFromEntry
) {
  const conf = String(configuredCsv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const map = new Map();
  for (const e of matchedEntries || []) {
    const key = String(keyFromEntry(e) || "")
      .trim()
      .toLowerCase();
    if (key) map.set(key, String(displayFromEntry(e) || "").trim() || key);
  }
  return conf.map((want) => {
    const disp = map.get(want.toLowerCase());
    if (!disp) {
      return {
        name: want,
        fetchStatus: "skipped",
        itemsFound: 0,
        cacheStatus: "skipped",
        itemsCached: 0,
        cacheTotal: 0,
      };
    }
    return {
      name: disp,
      fetchStatus: "pending",
      itemsFound: 0,
      cacheStatus: "pending",
      itemsCached: 0,
      cacheTotal: 0,
    };
  });
}

/** Count raw on-demand rows by library label field (varies by server). */
function countItemsByLibraryFields(items, fieldNames) {
  const fields = Array.isArray(fieldNames) ? fieldNames : [fieldNames];
  const counts = {};
  for (const m of items || []) {
    let k = "";
    for (const f of fields) {
      if (m[f] != null && String(m[f]).trim() !== "") {
        k = String(m[f]).trim();
        break;
      }
    }
    if (!k) k = "Library";
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}

function findLibraryRow(libraries, label) {
  if (!libraries || !label) return null;
  const lc = String(label).trim().toLowerCase();
  return libraries.find((r) => (r.name || "").toLowerCase() === lc) || null;
}

module.exports = {
  buildLibraryProgressRows,
  countItemsByLibraryFields,
  findLibraryRow,
};
