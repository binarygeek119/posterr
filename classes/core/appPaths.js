const path = require("path");

const ROOT = process.cwd();
const CONFIG_ROOT = path.join(ROOT, "config");

/**
 * Poster DB (SQLite), imagecache, mp3cache, randomthemes — under config/cache
 * (replaces the former top-level saved/ directory).
 */
const CACHE_ROOT = path.join(CONFIG_ROOT, "cache");
const IMAGE_CACHE_DIR = path.join(CACHE_ROOT, "imagecache");
const MP3_CACHE_DIR = path.join(CACHE_ROOT, "mp3cache");
const RANDOM_THEMES_DIR = path.join(CACHE_ROOT, "randomthemes");

/** Previous layout for one-time data migration */
const LEGACY_SAVED_ROOT = path.join(ROOT, "saved");

/**
 * Ad slide images. Canonical: config/ads (served at /custom/ads).
 * Legacy public/custom/ads is cleared on startup after a one-time move into config/ads.
 */
const ADS_MEDIA_DIR = path.join(CONFIG_ROOT, "ads");
/**
 * Dedicated /ads page backdrop only. Canonical: config/ads-view (served at /custom/ads-view).
 */
const ADS_VIEW_BG_DIR = path.join(CONFIG_ROOT, "ads-view");
/**
 * Custom picture themes. Canonical: config/custom-pictures (served at /custom/pictures).
 * Legacy public/custom/pictures is cleared after a one-time move into config/custom-pictures.
 */
const CUSTOM_PICTURES_DIR = path.join(CONFIG_ROOT, "custom-pictures");

module.exports = {
  ROOT,
  CONFIG_ROOT,
  CACHE_ROOT,
  IMAGE_CACHE_DIR,
  MP3_CACHE_DIR,
  RANDOM_THEMES_DIR,
  LEGACY_SAVED_ROOT,
  ADS_MEDIA_DIR,
  ADS_VIEW_BG_DIR,
  CUSTOM_PICTURES_DIR,
};
