const path = require("path");

const ROOT = process.cwd();

/**
 * Poster DB (SQLite), imagecache, mp3cache, randomthemes — under config/cache
 * (replaces the former top-level saved/ directory).
 */
const CACHE_ROOT = path.join(ROOT, "config", "cache");
const IMAGE_CACHE_DIR = path.join(CACHE_ROOT, "imagecache");
const MP3_CACHE_DIR = path.join(CACHE_ROOT, "mp3cache");
const RANDOM_THEMES_DIR = path.join(CACHE_ROOT, "randomthemes");

/** Previous layout for one-time data migration */
const LEGACY_SAVED_ROOT = path.join(ROOT, "saved");

module.exports = {
  ROOT,
  CACHE_ROOT,
  IMAGE_CACHE_DIR,
  MP3_CACHE_DIR,
  RANDOM_THEMES_DIR,
  LEGACY_SAVED_ROOT,
};
