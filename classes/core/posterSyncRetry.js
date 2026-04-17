const fs = require("fs");
const path = require("path");
const { CACHE_ROOT } = require("./appPaths");
const posterMetadataDb = require("./posterMetadataDb");

const RETRY_FILE = path.join(CACHE_ROOT, "poster-sync-retry.json");
const MAX_KEYS = 80000;

function plexRawKey(md) {
  if (!md || md.ratingKey == null) return "";
  return String(md.ratingKey);
}

function jfRawKey(md) {
  if (!md || md.Id == null) return "";
  return String(md.Id);
}

function kodiRawKey(md) {
  if (!md) return "";
  if (md._kodiKind === "show" && md.tvshowid != null)
    return "s:" + String(md.tvshowid);
  if (md._kodiKind === "movie" && md.movieid != null)
    return "m:" + String(md.movieid);
  return "";
}

/**
 * Stable id for retry file + prioritization (must match raw row key helpers).
 * @param {object} card
 * @param {string} serverKind
 */
function keyFromCard(card, serverKind) {
  const k = String((card && card.posterApiItemId) || "").trim();
  if (!k) return "";
  const sk = String(serverKind || "").toLowerCase();
  if (sk === "kodi") {
    const mt = String((card && card.mediaType) || "").toLowerCase();
    if (mt === "show") return "s:" + k;
    if (mt === "movie") return "m:" + k;
  }
  return k;
}

/**
 * Move items whose keys were saved after the previous sync to the front of the queue.
 * @param {object[]} odRaw
 * @param {string[]} retryKeys
 * @param {string} serverKind
 */
function prioritizeOdRaw(odRaw, retryKeys, serverKind) {
  if (!odRaw || !odRaw.length || !retryKeys || !retryKeys.length) return odRaw;
  const sk = String(serverKind || "").toLowerCase();
  let getKey;
  if (sk === "plex") getKey = plexRawKey;
  else if (sk === "jellyfin" || sk === "emby") getKey = jfRawKey;
  else if (sk === "kodi") getKey = kodiRawKey;
  else getKey = () => "";

  const order = new Map();
  for (let i = 0; i < retryKeys.length; i++) {
    const k = String(retryKeys[i] || "").trim();
    if (k && !order.has(k)) order.set(k, i);
  }
  const scored = odRaw.map((item, idx) => {
    const k = getKey(item);
    const pri = k && order.has(k) ? order.get(k) : 1e9;
    return { item, idx, pri };
  });
  scored.sort((a, b) => a.pri - b.pri || a.idx - b.idx);
  return scored.map((s) => s.item);
}

function loadRetryKeys(serverKind) {
  try {
    if (!fs.existsSync(RETRY_FILE)) return [];
    const j = JSON.parse(fs.readFileSync(RETRY_FILE, "utf8"));
    if (
      !j ||
      String(j.serverKind || "").toLowerCase() !==
        String(serverKind || "").toLowerCase()
    ) {
      return [];
    }
    const keys = j.keys;
    return Array.isArray(keys) ? keys.map(String).filter(Boolean) : [];
  } catch (e) {
    return [];
  }
}

function saveRetryKeys(serverKind, keys) {
  const uniq = [];
  const seen = new Set();
  for (const k of keys || []) {
    const s = String(k || "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    uniq.push(s);
    if (uniq.length >= MAX_KEYS) break;
  }
  try {
    fs.mkdirSync(CACHE_ROOT, { recursive: true });
    fs.writeFileSync(
      RETRY_FILE,
      JSON.stringify({
        serverKind: String(serverKind || "").toLowerCase(),
        savedAt: new Date().toISOString(),
        keys: uniq,
      }),
      "utf8"
    );
  } catch (e) {
    /* ignore */
  }
}

function wantPosterForCard(card, imagePull) {
  const mt = String((card && card.mediaType) || "").toLowerCase();
  if (mt === "album") return imagePull.albumPoster !== false;
  return imagePull.videoPoster !== false;
}

function posterGap(card, imagePull) {
  if (!wantPosterForCard(card, imagePull)) return false;
  const dl = String((card && card.posterDownloadURL) || "").trim();
  const url = String((card && card.posterURL) || "");
  if (url.includes("no-poster") || url.includes("no-cover")) {
    return !!dl;
  }
  const fn = posterMetadataDb.normalizeCacheFile(card.posterURL);
  if (!fn) return !!dl;
  return !posterMetadataDb.fileOk(fn);
}

function backdropGap(card, imagePull) {
  if (imagePull.background === false) return false;
  const artUrl = String((card && card.posterArtURL) || "").trim();
  if (!artUrl || !artUrl.includes("/imagecache/")) return false;
  const af = posterMetadataDb.normalizeCacheFile(artUrl);
  return !!(af && !posterMetadataDb.fileOk(af));
}

function logoGap(card, imagePull) {
  if (imagePull.logo === false) return false;
  const u = String((card && card.posterLogoURL) || "").trim();
  if (!u || !u.includes("/imagecache/")) return false;
  const lf = posterMetadataDb.normalizeCacheFile(u);
  return !!(lf && !posterMetadataDb.fileOk(lf));
}

function cardNeedsRetry(card, imagePull) {
  return (
    posterGap(card, imagePull) ||
    backdropGap(card, imagePull) ||
    logoGap(card, imagePull)
  );
}

/**
 * Keys to prioritize on the *next* full sync (missing cache files / failed downloads).
 * @param {object[]} cards
 * @param {string} serverKind
 * @param {object} imagePull
 * @returns {string[]}
 */
function collectRetryKeysFromCards(cards, serverKind, imagePull) {
  const pull = imagePull || {};
  const out = [];
  const seen = new Set();
  if (!Array.isArray(cards)) return out;
  for (const c of cards) {
    if (!c || !cardNeedsRetry(c, pull)) continue;
    const k = keyFromCard(c, serverKind);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

function clearRetryFile() {
  try {
    if (fs.existsSync(RETRY_FILE)) fs.unlinkSync(RETRY_FILE);
  } catch (e) {
    /* ignore */
  }
}

module.exports = {
  loadRetryKeys,
  saveRetryKeys,
  prioritizeOdRaw,
  collectRetryKeysFromCards,
  keyFromCard,
  plexRawKey,
  jfRawKey,
  kodiRawKey,
  clearRetryFile,
};
