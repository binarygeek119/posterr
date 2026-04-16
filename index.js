const express = require("express");
const path = require("path");
const app = express();
const multer = require("multer");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const session = require("express-session");
const { check, validationResult } = require("express-validator");
//const user = require('./routes/user.routes');
const vers = require("./classes/core/ver");
const glb = require("./classes/core/globalPage");
const core = require("./classes/core/cache");
const sonr = require("./classes/arr/sonarr");
const radr = require("./classes/arr/radarr");
const lidr = require("./classes/arr/lidarr");
const readr = require("./classes/arr/readarr");
const trivQ = require("./classes/custom/trivia");
const pics = require("./classes/custom/pictures");
const settings = require("./classes/core/settings");
const MemoryStore = require("memorystore")(session);
const util = require("./classes/core/utility");
const DEFAULT_SETTINGS = require("./consts");
const health = require("./classes/core/health");
const pjson = require("./package.json");
const MAX_OD_SLIDES = 150;  // this is with themes. Will be double this if tv and movie themes are off
const triv = require("./classes/custom/trivia");
const links = require("./classes/custom/links");
const awtrix = require("./classes/custom/awtrix");
const movieTrailers = require("./classes/arr/radarrtrailers");
const {
  getMediaServerClass,
  getMediaServerShortLabel,
  getMediaServerKind,
  requiresMediaServerCredential,
} = require("./classes/mediaservers/mediaServerFactory");
const posterMetadata = require("./classes/core/posterMetadataDb");
const posterSyncRetry = require("./classes/core/posterSyncRetry");
const nowShowingDb = require("./classes/core/nowShowingDb");
const adsDb = require("./classes/core/adsDb");
const {
  CONFIG_ROOT,
  CACHE_ROOT,
  IMAGE_CACHE_DIR,
  MP3_CACHE_DIR,
  RANDOM_THEMES_DIR,
  ADS_MEDIA_DIR,
  ADS_VIEW_BG_DIR,
  CUSTOM_PICTURES_DIR,
} = require("./classes/core/appPaths");

// just in case someone puts in a / for the basepath value
if (process.env.BASEPATH == "/") process.env.BASEPATH = "";
let BASEURL = process.env.BASEPATH || "";
let PORT = process.env.PORT || 3000;

// parse any input parameters for binaries.
let args = process.argv.slice(2)

// parse port number
if(args.length !== 0){
  try{
    PORT = parseInt(args[0]);
  }
  catch{
    console.log("Cannot set port: " + args[0] + ". Setting default port 3000");
    PORT = 3000
  }
}

// parse base path
if(args.length == 2){
    BASEURL = args[1];
}

console.log("-------------------------------------------------------");
console.log(" POSTERR - Your media display");
console.log(" Developed by Matt Petersen - Brisbane Australia");
console.log(" ");
console.log(" Version: " + pjson.version);
console.log("-------------------------------------------------------");

// global variables
let odCards = [];
let nsCards = [];
/** TMDB Now Showing list slides for the main poster carousel (when enabled) */
let tmdbNowShowingPosterCards = [];
let csCards = [];
let csrCards = [];
let cslCards = [];
let rtCards = [];
let picCards = [];
/** Enabled ad slides for the main poster deck (from ads DB). */
let adSlideCards = [];
let csbCards = [];
let trivCards = [];
let linkCards = [];
let globalPage = new glb();
let nowScreeningClock;
let onDemandClock;
let triviaClock;
let sonarrClock;
let radarrClock;
let lidarrClock;
let readarrClock;
let houseKeepingClock;
let posterMetadataRefreshClock;
let picturesClock;
let linksClock;
let setng = new settings();
let loadedSettings;
let httpServerStarted = false;
const CUSTOM_PICTURES_ROOT = CUSTOM_PICTURES_DIR;
const ADS_MEDIA_ROOT = ADS_MEDIA_DIR;
const ADS_VIEW_BG_ROOT = ADS_VIEW_BG_DIR;
const customPicturesUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});
const adsMediaUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 30 * 1024 * 1024 },
});
const adsMediaUploadAny = adsMediaUpload.any();
const adsViewBgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

function unlinkAdsGlobalBackgroundFileIfSafe(urlPath) {
  if (!urlPath || typeof urlPath !== "string") return;
  const u = urlPath.trim();
  if (!u.startsWith("/custom/ads-view/")) return;
  const base = path.basename(u);
  if (!base || base.includes("..")) return;
  const diskPath = path.resolve(ADS_VIEW_BG_ROOT, base);
  const rootResolved = path.resolve(ADS_VIEW_BG_ROOT);
  if (
    !diskPath.startsWith(rootResolved + path.sep) &&
    diskPath !== rootResolved
  ) {
    return;
  }
  try {
    if (fs.existsSync(diskPath)) fs.unlinkSync(diskPath);
  } catch (e) {
    /* ignore */
  }
}

function sanitizeCustomPicturesFolderName(value) {
  const trimmed = String(value == null ? "" : value).trim();
  if (!trimmed) return "";
  const normalized = trimmed
    .replace(/[\\\/]/g, "")
    .replace(/[^\w.\- ]/g, "")
    .trim();
  if (!normalized || normalized === "." || normalized === "..") return "";
  return normalized;
}

function normalizeCustomPictureThemeSelection(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value == null ? "" : value)
        .split(",");
  const cleaned = raw
    .map((v) => sanitizeCustomPicturesFolderName(v))
    .filter(Boolean);
  if (!cleaned.length) return DEFAULT_SETTINGS.customPictureTheme;
  return Array.from(new Set(cleaned)).join(",");
}

function resolveCustomPicturesTargetDirectory(themeFolder, newFolderName) {
  const createFolder = sanitizeCustomPicturesFolderName(newFolderName);
  const selectedFolder = sanitizeCustomPicturesFolderName(themeFolder);
  const finalFolder = createFolder || selectedFolder || "default";
  const fullPath = path.resolve(CUSTOM_PICTURES_ROOT, finalFolder);
  if (!fullPath.startsWith(CUSTOM_PICTURES_ROOT)) {
    throw new Error("Invalid custom pictures folder");
  }
  return { finalFolder, fullPath };
}

function copyDirContentsRecursive(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const name of fs.readdirSync(src)) {
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = fs.statSync(from);
    if (st.isDirectory()) {
      copyDirContentsRecursive(from, to);
    } else if (st.isFile()) {
      fs.copyFileSync(from, to);
    }
  }
}

function treeHasPictureMedia(dir) {
  if (!fs.existsSync(dir)) return false;
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(p);
    } catch (e) {
      continue;
    }
    if (st.isFile() && /\.(jpe?g|png|gif|webp)$/i.test(name)) return true;
    if (st.isDirectory() && treeHasPictureMedia(p)) return true;
  }
  return false;
}

/** True if a directory has at least one slide image (ignores .keep, readme, etc.). */
function flatDirHasAdImageMedia(dir) {
  if (!fs.existsSync(dir)) return false;
  for (const name of fs.readdirSync(dir)) {
    if (/^(?:\.keep|readme\.txt|\.ds_store)$/i.test(name)) continue;
    const p = path.join(dir, name);
    let st;
    try {
      st = fs.statSync(p);
    } catch (e) {
      continue;
    }
    if (st.isFile() && /\.(jpe?g|png|gif|webp)$/i.test(name)) return true;
  }
  return false;
}

/**
 * Move legacy public/custom/pictures and public/custom/ads into config/custom-pictures
 * and config/ads when the config side has no image media yet (repo .keep files do not count).
 * After a successful copy, legacy folders are removed and empty placeholders are recreated.
 */
function migrateLegacyPublicCustomMediaToConfig() {
  try {
    const legacyPics = path.resolve(process.cwd(), "public", "custom", "pictures");
    const legacyAds = path.resolve(process.cwd(), "public", "custom", "ads");
    if (
      treeHasPictureMedia(legacyPics) &&
      !treeHasPictureMedia(CUSTOM_PICTURES_ROOT)
    ) {
      copyDirContentsRecursive(legacyPics, CUSTOM_PICTURES_ROOT);
      fs.rmSync(legacyPics, { recursive: true, force: true });
      fs.mkdirSync(legacyPics, { recursive: true });
      fs.mkdirSync(path.join(legacyPics, "default"), { recursive: true });
      const now = new Date();
      console.log(
        now.toLocaleString() +
          " Custom pictures: moved public/custom/pictures → config/custom-pictures"
      );
    }
    if (
      flatDirHasAdImageMedia(legacyAds) &&
      !flatDirHasAdImageMedia(ADS_MEDIA_ROOT)
    ) {
      copyDirContentsRecursive(legacyAds, ADS_MEDIA_ROOT);
      fs.rmSync(legacyAds, { recursive: true, force: true });
      fs.mkdirSync(legacyAds, { recursive: true });
      const now = new Date();
      console.log(
        now.toLocaleString() +
          " Ads media: moved public/custom/ads → config/ads"
      );
    }
  } catch (e) {
    const now = new Date();
    console.log(
      now.toLocaleString() +
        " Legacy public/custom → config media migration skipped: " +
        (e && e.message ? e.message : e)
    );
  }
}

function sanitizeUploadBaseName(value) {
  const base = String(value == null ? "" : value)
    .replace(/[^\w.\- ]/g, "")
    .trim();
  return base || "";
}

function parseAdPriceLinesJson(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return [];
  let parsed = [];
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error("Price lines JSON is invalid");
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((row, idx) => {
      const title = String((row && row.title) || "").trim();
      const amount = parseMoneyAmount(row && row.amount);
      if (!title && amount == null) return null;
      return {
        title,
        amount,
        sortOrder: idx,
      };
    })
    .filter(Boolean);
}

function parseAdAddonLinesJson(value) {
  const raw = String(value == null ? "" : value).trim();
  if (!raw) return [];
  let parsed = [];
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error("Add-on lines JSON is invalid");
  }
  if (!Array.isArray(parsed)) return [];
  return parsed
    .map((row, idx) => {
      const title = String((row && row.title) || "").trim();
      const amount = parseMoneyAmount(row && row.amount);
      if (amount == null) return null;
      return {
        title,
        amount,
        sortOrder: idx,
      };
    })
    .filter(Boolean);
}

function firstUploadedFile(req, fieldName) {
  if (!req || !Array.isArray(req.files)) return null;
  for (const f of req.files) {
    if (f && f.fieldname === fieldName) return f;
  }
  return null;
}

function validateAdsUploadFields(req) {
  const allowed = new Set(["adMediaFile", "adBackgroundFile"]);
  const seen = new Set();
  const files = Array.isArray(req && req.files) ? req.files : [];
  for (const f of files) {
    const n = String((f && f.fieldname) || "");
    if (!allowed.has(n)) {
      throw new Error("Unexpected upload field: " + (n || "(unknown)"));
    }
    seen.add(n);
  }
  return seen;
}

function newFeaturesBannerViewData() {
  const appVersion = String(pjson.version || "").trim();
  const ack = String(
    (loadedSettings && loadedSettings.newFeaturesAcknowledgedVersion) || ""
  ).trim();
  return {
    showNewFeaturesBanner: !!loadedSettings && ack !== appVersion,
    appVersion,
  };
}
//let endPoint = "https://logz-dev.nesretep.net/pstr";
let endPoint = "https://logz.nesretep.net/pstr";
let nsCheckSeconds = 10000; // how often now screening checks are performed. (not available in setup screen as running too often can cause network issues)
let isSonarrEnabled = false;
let isNowShowingEnabled = false;
let isRadarrEnabled = false;
let isLidarrEnabled = false;
let isTriviaEnabled = false;
let isReadarrEnabled = false;
let isOnDemandEnabled = false;
let isSleepEnabled = false;
let isPicturesEnabled = false;
let isMediaServerEnabled = false;
let isMediaServerUnavailable = false;
let isSonarrUnavailable = false;
let isRadarrUnavailable = false;
let isLidarrUnavailable = false;
let isReadarrUnavailable = false;
let isTriviaUnavailable = false;
let isLinksEnabled = false;
let isLinksUnavailable = false;
let hasReported = false;
let cold_start_time = new Date();
let customPicFolders = [];
let serverID = "";
let pinnedMode = false;
let message = "";
let latestVersion = "";
let updateAvailable = false
let sleep = "false";
let apiSleep = false;
let sleepClock;
let triviaToken = "";
let theaterMode = false;
let sleepAPI = false;
let tmpSleepStart;
let tmpSleepEnd;
let recentlyAddedDays;
let contentRatings;
let oldAwtrixApps = [];
let isAwtrixEnabled = false;
let awtrixIP = "";
let restartSeconds = 86400000; 
let excludeLibs = "";

// create working folders if they do not exist
// needed for package binaries
var fs = require('fs');
const { titleColour, enableSleep, sleepStart, sleepEnd, numberOnDemand } = require("./consts");
const CardType = require("./classes/cards/CardType");
const CardTypeEnum = CardType.CardTypeEnum;
const MediaCard = require("./classes/cards/MediaCard");
const Links = require("./classes/custom/links");
const { now } = require("jquery");

var dir = './config';

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir);
}

// Prevent multiple Posterr processes from running at the same time.
const APP_LOCK_FILE = path.join(CONFIG_ROOT, "posterr-app.lock");
let appLockHeld = false;

function processExists(pid) {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function releaseAppLock() {
  if (!appLockHeld) return;
  try {
    if (fs.existsSync(APP_LOCK_FILE)) fs.unlinkSync(APP_LOCK_FILE);
  } catch (e) {
    /* ignore */
  }
  appLockHeld = false;
}

function acquireAppLockOrExit() {
  const payload = JSON.stringify(
    { pid: process.pid, startedAt: new Date().toISOString() },
    null,
    0
  );
  try {
    fs.writeFileSync(APP_LOCK_FILE, payload, { flag: "wx" });
    appLockHeld = true;
    return;
  } catch (e) {
    try {
      if (fs.existsSync(APP_LOCK_FILE)) {
        const raw = fs.readFileSync(APP_LOCK_FILE, "utf8");
        const lock = JSON.parse(raw || "{}");
        const lockPid = parseInt(lock.pid, 10);
        if (!processExists(lockPid)) {
          fs.unlinkSync(APP_LOCK_FILE);
          fs.writeFileSync(APP_LOCK_FILE, payload, { flag: "wx" });
          appLockHeld = true;
          console.log(
            new Date().toLocaleString() +
              " Posterr: removed stale process lock and continued startup"
          );
          return;
        }
        console.log(
          new Date().toLocaleString() +
            " ✘✘ WARNING ✘✘ - Another Posterr instance is already running (pid " +
            lockPid +
            "). Exiting this process."
        );
        process.exit(1);
      }
    } catch (e2) {
      console.log(
        new Date().toLocaleString() +
          " ✘✘ WARNING ✘✘ - Could not acquire app lock: " +
          (e2 && e2.message ? e2.message : e2)
      );
      process.exit(1);
    }
  }
}

acquireAppLockOrExit();
process.on("exit", releaseAppLock);
process.on("SIGINT", () => {
  releaseAppLock();
  process.exit(130);
});
process.on("SIGTERM", () => {
  releaseAppLock();
  process.exit(143);
});

var dir = CACHE_ROOT;

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

var dir = IMAGE_CACHE_DIR;

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

var dir = MP3_CACHE_DIR;

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

var dir = RANDOM_THEMES_DIR;

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

var dir = './public';

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir);
}

var dir = "./public/custom";

if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

fs.mkdirSync(CUSTOM_PICTURES_ROOT, { recursive: true });
fs.mkdirSync(path.join(CUSTOM_PICTURES_ROOT, "default"), { recursive: true });
fs.mkdirSync(ADS_MEDIA_ROOT, { recursive: true });
fs.mkdirSync(ADS_VIEW_BG_ROOT, { recursive: true });
migrateLegacyPublicCustomMediaToConfig();

function checkTime(i) {
  try{
    if (i < 10) {
      i = "0" + i;
    }
    return i;
  }
  catch(ex){
    console.log('*ERROR ' + ex);
    return i;
  }
}
loadLinks
/**
 * @desc Wrapper function to call links.
 * @returns {Promise<object>} mediaCards array - LINKS
 */
async function loadLinks() {
  // stop the clock
  clearInterval(linksClock);
  let linkTicks = 86400000; //loadedSettings.linkFrequency * 1000 * 60; // convert to seconds and then minutes

  // stop timers and dont run if disabled
  if (!isLinksEnabled) {
    return linkCards;
  }

  // instatntiate link class
  let linkArray = loadedSettings.links.split(";");
  let links = new Links();
  // call links
  try {
    linkCards = await links.GetAllLinks(linkArray);
    //console.log(linkCards);
  } catch (err) {
    let now = new Date();
    console.log(now.toLocaleString() + " *Links: " + err);
    console.log("✘✘ WARNING ✘✘ - Next links query will run in 1 minute.");
    isLinksUnavailable = true;
  }
  // restart the 24 hour timer
  linksClock = setInterval(loadLinks, linkTicks); // daily
  const lc = linkCards;
  return linkCards;
}

/**
 * @desc Wrapper function to call Trivia.
 * @returns {Promise<object>} mediaCards array - trivia
 */
 async function loadTrivia() {
  // stop the clock
  clearInterval(triviaClock);
  let triviaTicks = loadedSettings.triviaFrequency * 1000 * 60; // convert to seconds and then minutes

  // stop timers and dont run if disabled
  if (!isTriviaEnabled) {
    return trivCards;
  }

  // instatntiate trivia class
  let trivia = new triv();

  // get trivia token
  if(triviaToken == ""){
    try {
      triviaToken = await trivia.GetToken();
    }
    catch(ex){
      let now = new Date();
      console.log(now.toLocaleString() + " *Trivia - get token: " + err);
      triviaToken = "";
      triviaTicks = 60000;
      console.log("✘✘ WARNING ✘✘ - Next Trivia query will run in 1 minute.");
      isTriviaUnavailable = true;
      }
  }

  // call trivia
  try {
    trivCards = await trivia.GetAllQuestions('false',loadedSettings.hasArt, loadedSettings.triviaNumber, loadedSettings.triviaCategories, triviaToken);
    if (isTriviaUnavailable) {
      console.log(
        "✅ Trivia connection restored - defualt poll timers restored"
      );
      isTriviaUnavailable = false;
      triviaTicks = loadedSettings.triviaFrequency * 1000 * 60; // convert to seconds and then minutes
    }
  } catch (err) {
    let now = new Date();
    console.log(now.toLocaleString() + " *Trivia questions: " + err);
    triviaToken = "";
    triviaTicks = 60000;
    console.log("✘✘ WARNING ✘✘ - Next Trivia query will run in 1 minute.");
    isTriviaUnavailable = true;
  }
  // restart the 24 hour timer
  triviaClock = setInterval(loadTrivia, triviaTicks); // daily

  return trivCards;
}



/**
 * @desc Wrapper function to call Readarr coming soon.
 * @returns {Promise<object>} mediaCards array - coming soon
 */
async function loadReadarrComingSoon() {
  // stop the clock
  clearInterval(readarrClock);
  let readarrTicks = 86400000; // daily

  // stop timers and dont run if disabled
  if (!isReadarrEnabled) {
    return csbCards;
  }

  // instatntiate radarr class
  let readarr = new readr(
    loadedSettings.readarrURL,
    loadedSettings.readarrToken,
    loadedSettings.bookArrKind || "readarr"
  );
  const bookAppLabel = readr.displayLabel(loadedSettings.bookArrKind);

  // set up date range and date formats
  let today = new Date();
  let later = new Date();
  later.setDate(later.getDate() + loadedSettings.readarrCalDays);
  let now = today.toISOString().split("T")[0];
  let ltr = later.toISOString().split("T")[0];

  // call radarr coming soon
  try {
    csbCards = await readarr.GetComingSoon(now, ltr, loadedSettings.hasArt);
    if (isReadarrUnavailable) {
      console.log(
        "✅ " + bookAppLabel + " connection restored - default poll timers restored"
      );
      isReadarrUnavailable = false;
      readarrTicks = 86400000; // daily
    }
  } catch (err) {
    let now = new Date();
    console.log(now.toLocaleString() + " *Coming Soon - Books (" + bookAppLabel + "): " + err);
    readarrTicks = 60000;
    console.log(
      "✘✘ WARNING ✘✘ - Next " + bookAppLabel + " query will run in 1 minute."
    );
    isReadarrUnavailable = true;
  }
  // restart the 24 hour timer
  readarrClock = setInterval(loadReadarrComingSoon, readarrTicks); // daily

  return csbCards;
}


/**
 * @desc Wrapper function to call Radarr coming soon.
 * @returns {Promise<object>} mediaCards array - coming soon
 */
async function loadRadarrComingSoon() {
  // stop the clock
  clearInterval(radarrClock);
  let radarrTicks = 86400000; // daily

  // stop timers and dont run if disabled
  if (!isRadarrEnabled) {
    return csrCards;
  }

  // instatntiate radarr class
  let radarr = new radr(
    loadedSettings.radarrURL,
    loadedSettings.radarrToken,
    loadedSettings.radarrPremieres,
    loadedSettings.hasArt
  );

  // set up date range and date formats
  let today = new Date();
  let later = new Date();
  later.setDate(later.getDate() + loadedSettings.radarrCalDays);
  let now = today.toISOString().split("T")[0];
  let ltr = later.toISOString().split("T")[0];

  // call radarr coming soon
  try {
    csrCards = await radarr.GetComingSoon(now, ltr, loadedSettings.genericThemes, loadedSettings.hasArt);
    if (isRadarrUnavailable) {
      console.log(
        "✅ Radarr connection restored - defualt poll timers restored"
      );
      isRadarrUnavailable = false;
      radarrTicks = 86400000; // daily
    }
  } catch (err) {
    let now = new Date();
    console.log(now.toLocaleString() + " *Coming Soon - Movies: " + err);
    radarrTicks = 60000;
    console.log("✘✘ WARNING ✘✘ - Next Radarr query will run in 1 minute.");
    isRadarrUnavailable = true;
  }
  // restart the 24 hour timer
  radarrClock = setInterval(loadRadarrComingSoon, radarrTicks); // daily

// Temporarily do the radarr trailer call
    
let mt = new movieTrailers()
  //rtCards = await mt.AssembleRadarrTrailers(csrCards,"99a3739ec3bbafa63ac1fc359715012a")

  return csrCards;
}

/**
 * @desc Wrapper function to call Lidarr coming soon (upcoming albums).
 * @returns {Promise<object>} mediaCards array
 */
async function loadLidarrComingSoon() {
  clearInterval(lidarrClock);
  let lidarrTicks = 86400000;

  if (!isLidarrEnabled) {
    return cslCards;
  }

  const lidarr = new lidr(loadedSettings.lidarrURL, loadedSettings.lidarrToken);

  const today = new Date();
  const later = new Date();
  later.setDate(later.getDate() + loadedSettings.lidarrCalDays);
  const now = today.toISOString().split("T")[0];
  const ltr = later.toISOString().split("T")[0];

  try {
    cslCards = await lidarr.GetComingSoon(now, ltr, loadedSettings.hasArt);
    if (isLidarrUnavailable) {
      console.log(
        "✅ Lidarr connection restored - default poll timers restored"
      );
      isLidarrUnavailable = false;
      lidarrTicks = 86400000;
    }
  } catch (err) {
    const t = new Date();
    console.log(t.toLocaleString() + " *Coming Soon - Music (Lidarr): " + err);
    lidarrTicks = 60000;
    console.log("✘✘ WARNING ✘✘ - Next Lidarr query will run in 1 minute.");
    isLidarrUnavailable = true;
  }
  lidarrClock = setInterval(loadLidarrComingSoon, lidarrTicks);
  return cslCards;
}

/**
 * @desc Wrapper function to call Sonarr coming soon.
 * @returns {Promise<object>} mediaCards array - coming soon
 */
async function loadSonarrComingSoon() {
  // stop the clock
  clearInterval(sonarrClock);
  let sonarrTicks = 86400000; // daily

  // stop timers and dont run if disabled
  if (!isSonarrEnabled) {
    return csCards;
  }

  // instatntiate sonarr class
  let sonarr = new sonr(
    loadedSettings.sonarrURL,
    loadedSettings.sonarrToken,
    loadedSettings.sonarrPremieres
  );
  // set up date range and date formats
  let today = new Date();
  let later = new Date();
  later.setDate(later.getDate() + loadedSettings.sonarrCalDays);
  let now = today.toISOString().split("T")[0];
  let ltr = later.toISOString().split("T")[0];

  // call sonarr coming soon
  try {
    csCards = await sonarr.GetComingSoon(
      now,
      ltr,
      loadedSettings.sonarrPremieres,
      loadedSettings.playThemes,
      loadedSettings.hasArt
    );

    if (isSonarrUnavailable) {
      console.log(
        "✅ Sonarr connection restored - defualt poll timers restored"
      );
      isSonarrUnavailable = false;
      sonarrTicks = 86400000; // daily
    }
  } catch (err) {
    let now = new Date();
    console.log(now.toLocaleString() + " *Coming Soon - TV: " + err);
    sonarrTicks = 60000;
    console.log("✘✘ WARNING ✘✘ - Next Sonarr query will run in 1 minute.");
    isSonarrUnavailable = true;
  }

  // restart the 24 hour timer
  sonarrClock = setInterval(loadSonarrComingSoon, sonarrTicks);
  return csCards;
}

/**
 * @desc Wrapper function to call Readarr coming soon.
 * @returns {Promise<object>} mediaCards array - coming soon
 */
async function loadPictures() {
  // stop the clock
  clearInterval(picturesClock);
  let picturesTicks = 1200000; // refreshed every 20 minutes

  // stop timers and dont run if disabled
  if (!isPicturesEnabled) {
    return picCards;
  }

  let cPics = new pics();
  picCards = await cPics.GetPictures(loadedSettings.customPictureTheme, loadedSettings.enableCustomPictureThemes, loadedSettings.hasArt);

  // restart the 24 hour timer
  picturesClock = setInterval(loadPictures, picturesTicks);
  return picCards;
}

function preferCachedPostersEnabled() {
  if (!loadedSettings) return true;
  const v = loadedSettings.preferCachedPosters;
  if (v === undefined || v === null) return true;
  const s = String(v).toLowerCase().trim();
  return s !== "false" && s !== "0" && s !== "off" && s !== "no";
}

/** True when poster metadata DB has at least one row (sync may have run while server was up). */
function cachedPosterDbHasRows() {
  try {
    return posterMetadata.countRows() > 0;
  } catch (e) {
    return false;
  }
}

function primaryCachedPosterSlideCount() {
  const raw = loadedSettings && loadedSettings.cachedPosterSlideCount;
  const parsed = parseInt(raw, 10);
  if (!isNaN(parsed) && parsed > 0 && Number.isFinite(parsed)) return parsed;
  return 48;
}

function settingEnabled(val, defaultValue) {
  if (val === undefined || val === null) return !!defaultValue;
  const s = String(val).toLowerCase().trim();
  if (!s) return !!defaultValue;
  return s !== "false" && s !== "0" && s !== "off" && s !== "no";
}

function buildImagePullOptions() {
  const hasArtOn = settingEnabled(loadedSettings && loadedSettings.hasArt, false);
  return {
    background: hasArtOn,
    /** Title logos / clear logos (same toggle as fanart for sync scope) */
    logo: hasArtOn,
    videoPoster: settingEnabled(
      loadedSettings && loadedSettings.displayPosterVideo,
      true
    ),
    albumPoster: settingEnabled(
      loadedSettings && loadedSettings.displayPosterAlbum,
      true
    ),
    bookPoster: settingEnabled(
      loadedSettings && loadedSettings.displayPosterBooks,
      true
    ),
    castPortrait:
      settingEnabled(loadedSettings && loadedSettings.displayPosterActor, false) ||
      settingEnabled(loadedSettings && loadedSettings.displayPosterActress, false),
    directorPortrait: settingEnabled(
      loadedSettings && loadedSettings.displayPosterDirector,
      false
    ),
    authorPortrait: settingEnabled(
      loadedSettings && loadedSettings.displayPosterAuthor,
      false
    ),
    artistPortrait: settingEnabled(
      loadedSettings && loadedSettings.displayPosterArtist,
      false
    ),
  };
}

/**
 * Poster metadata sync must always pull primary posters so rows can be registered
 * in poster metadata DB, even when UI display toggles hide some poster categories.
 */
function buildPosterSyncImagePullOptions() {
  const base = buildImagePullOptions();
  return {
    ...base,
    videoPoster: true,
    albumPoster: true,
    bookPoster: true,
  };
}

function customPictureEveryPosters() {
  const raw = loadedSettings && loadedSettings.customPictureEveryPosters;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

function applyCustomPictureSpacing(cards) {
  const every = customPictureEveryPosters();
  if (every <= 0 || !isPicturesEnabled || !Array.isArray(cards) || !cards.length) {
    return cards;
  }
  if (!Array.isArray(picCards) || picCards.length === 0) return cards;
  const picSet = new Set(picCards);
  const pictures = cards.filter((c) => picSet.has(c));
  const nonPictures = cards.filter((c) => !picSet.has(c));
  if (!pictures.length || !nonPictures.length) return cards;

  const out = [];
  let shown = 0;
  let picIdx = 0;
  for (const card of nonPictures) {
    out.push(card);
    shown++;
    if (shown >= every && picIdx < pictures.length) {
      out.push(pictures[picIdx++]);
      shown = 0;
    }
  }
  while (picIdx < pictures.length) out.push(pictures[picIdx++]);
  return out;
}

function nowPlayingEveryPosters() {
  const raw = loadedSettings && loadedSettings.nowPlayingEveryPosters;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

function nowShowingListEveryMinsVal() {
  const raw = loadedSettings && loadedSettings.nowShowingListEveryMins;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

function nowShowingListEverySlidesVal() {
  const mins = nowShowingListEveryMinsVal();
  if (mins <= 0) return 0;
  const slideSecs = Math.max(
    1,
    parseInt(
      (loadedSettings && loadedSettings.slideDuration) || DEFAULT_SETTINGS.slideDuration,
      10
    ) || DEFAULT_SETTINGS.slideDuration
  );
  return Math.max(1, Math.round((mins * 60) / slideSecs));
}

/** Interleave Now Playing (media server) slides after every N other slides */
function applyNowPlayingSpacing(cards) {
  const every = nowPlayingEveryPosters();
  if (every <= 0 || !isNowShowingEnabled || !Array.isArray(cards) || !cards.length) {
    return cards;
  }
  if (!Array.isArray(nsCards) || nsCards.length === 0) return cards;
  const nsSet = new Set(nsCards);
  const nsSlides = cards.filter((c) => nsSet.has(c));
  const otherSlides = cards.filter((c) => !nsSet.has(c));
  if (!nsSlides.length || !otherSlides.length) return cards;

  const out = [];
  let shown = 0;
  let nsIdx = 0;
  for (const card of otherSlides) {
    out.push(card);
    shown++;
    if (shown >= every && nsIdx < nsSlides.length) {
      out.push(nsSlides[nsIdx++]);
      shown = 0;
    }
  }
  while (nsIdx < nsSlides.length) out.push(nsSlides[nsIdx++]);
  return out;
}

/** Interleave TMDB Now Showing list slides after every N other slides */
function applyNowShowingListSpacing(cards) {
  const every = nowShowingListEverySlidesVal();
  if (
    every <= 0 ||
    !loadedSettings ||
    loadedSettings.enableNowShowingListInPoster !== "true" ||
    loadedSettings.nowShowingListOnly === "true" ||
    !Array.isArray(cards) ||
    !cards.length
  ) {
    return cards;
  }
  if (!Array.isArray(tmdbNowShowingPosterCards) || tmdbNowShowingPosterCards.length === 0) {
    return cards;
  }
  const tmdbSet = new Set(tmdbNowShowingPosterCards);
  const tmdbSlides = cards.filter((c) => tmdbSet.has(c));
  const otherSlides = cards.filter((c) => !tmdbSet.has(c));
  if (!tmdbSlides.length || !otherSlides.length) return cards;

  const out = [];
  let shown = 0;
  let tIdx = 0;
  for (const card of otherSlides) {
    out.push(card);
    shown++;
    if (shown >= every && tIdx < tmdbSlides.length) {
      out.push(tmdbSlides[tIdx++]);
      shown = 0;
    }
  }
  while (tIdx < tmdbSlides.length) out.push(tmdbSlides[tIdx++]);
  return out;
}

function formatAdCardFooterBadgesHtml(ad, currencySymbol) {
  const sym = String(currencySymbol != null ? currencySymbol : "$");
  const esc = (v) =>
    util.escapeHtml(v == null ? "" : String(v));
  const addonTitleOutline =
    loadedSettings &&
    String(loadedSettings.adsTitleOutline || "").toLowerCase() === "true";
  const prices = Array.isArray(ad && ad.prices) ? ad.prices : [];
  const addons = Array.isArray(ad && ad.addons) ? ad.addons : [];
  const validPrices = prices.filter(
    (p) => p && p.amount != null && !isNaN(Number(p.amount))
  );
  const validAddons = addons.filter(
    (a) => a && a.amount != null && !isNaN(Number(a.amount))
  );
  const priceParts = [];
  validPrices.forEach((p, pi) => {
    const base = Number(p.amount);
    const t = String(p.title || "").trim();
    const colorClass = "ad-price-pill--c" + String((pi % 6) + 1);
    const valueInner =
      "<span class='ad-price-pill__base'>" +
      esc(sym) +
      esc(base.toFixed(2)) +
      "</span>";
    priceParts.push(
      "<span class='ad-price-pill " +
        colorClass +
        "'>" +
        (t ? "<span class='ad-price-pill__title'>" + esc(t) + "</span>" : "") +
        "<span class='ad-price-pill__value'>" +
        valueInner +
        "</span></span>"
    );
  });
  const addonParts = [];
  validAddons.forEach((a, ai) => {
    const base = Number(a.amount);
    const t = String(a.title || "").trim();
    const colorClass =
      "ad-price-pill--c" + String(((validPrices.length + ai) % 6) + 1);
    const valueInner =
      "<span class='ad-price-pill__plus'>+</span><span class='ad-price-pill__base'>" +
      esc(sym) +
      esc(base.toFixed(2)) +
      "</span>";
    addonParts.push(
      "<span class='ad-price-pill " +
        colorClass +
        "'>" +
        (t ? "<span class='ad-price-pill__title'>" + esc(t) + "</span>" : "") +
        "<span class='ad-price-pill__value'>" +
        valueInner +
        "</span></span>"
    );
  });
  if (!priceParts.length && !addonParts.length) return "";
  if (addonParts.length) {
    const rowClass =
      "ad-poster-pricing-row" +
      (priceParts.length ? "" : " ad-poster-pricing-row--addons-only");
    return (
      "<div class='" +
      rowClass +
      "'>" +
      (priceParts.length
        ? "<span class='ad-poster-pills ad-poster-pills--prices'>" +
          priceParts.join("") +
          "</span>"
        : "") +
      "<div class='ad-poster-addon-section'>" +
      "<span class='bannerBigText Ad ad-poster-addon-heading-mirror" +
      (addonTitleOutline ? " ad-poster-addon-heading--outline" : "") +
      "'>Addons</span>" +
      "<span class='ad-poster-pills ad-poster-pills--addons'>" +
      addonParts.join("") +
      "</span></div></div>"
    );
  }
  return (
    "<span class='ad-poster-pills'>" + priceParts.join("") + "</span>"
  );
}

function buildAdSlideMediaCard(ad, currencySymbol) {
  const mediaPath = String((ad && ad.mediaPath) || "").trim();
  if (!mediaPath) return null;
  const medCard = new MediaCard();
  medCard.cardType = [...CardTypeEnum.Ad];
  medCard.mediaType = "ad";
  medCard.title = String((ad && ad.title) || "").trim();
  medCard.posterURL = mediaPath;
  const bg = String((ad && ad.backgroundMediaPath) || "").trim();
  medCard.posterArtURL = bg;
  medCard.DBID = "ad-" + (ad && ad.id != null ? ad.id : "x");
  medCard.theme = "";
  medCard.tagLine = "";
  medCard.adPricingHtml = formatAdCardFooterBadgesHtml(ad, currencySymbol);
  medCard.posterAR = "";
  medCard.genre = [];
  return medCard;
}

function rebuildAdSlideCardsFromDb() {
  adSlideCards = [];
  if (!loadedSettings) return;
  let list = [];
  try {
    list = adsDb.listAds();
  } catch (e) {
    return;
  }
  const sym = currencySymbolForCode(
    normalizeNowShowingCurrencyCode(
      loadedSettings.adsCurrencyCode || DEFAULT_SETTINGS.adsCurrencyCode
    )
  );
  for (const ad of list) {
    if (!ad || ad.enabled === false) continue;
    const m = buildAdSlideMediaCard(ad, sym);
    if (m) adSlideCards.push(m);
  }
}

function adsEveryPostersVal() {
  const raw = loadedSettings && loadedSettings.adsEveryPosters;
  const n = parseInt(raw, 10);
  return isNaN(n) ? 0 : Math.max(0, n);
}

/** Interleave ad slides after every N non-ad slides when adsEveryPosters > 0. */
function applyAdsSpacing(cards) {
  const every = adsEveryPostersVal();
  if (
    !loadedSettings ||
    loadedSettings.enableAds !== "true" ||
    every <= 0 ||
    !Array.isArray(cards) ||
    !cards.length
  ) {
    return cards;
  }
  if (!Array.isArray(adSlideCards) || adSlideCards.length === 0) {
    return cards;
  }
  const adSet = new Set(adSlideCards);
  const adSlides = cards.filter((c) => adSet.has(c));
  const otherSlides = cards.filter((c) => !adSet.has(c));
  if (!adSlides.length || !otherSlides.length) return cards;

  const out = [];
  let shown = 0;
  let adIdx = 0;
  for (const card of otherSlides) {
    out.push(card);
    shown++;
    if (shown >= every && adIdx < adSlides.length) {
      out.push(adSlides[adIdx++]);
      shown = 0;
    }
  }
  while (adIdx < adSlides.length) out.push(adSlides[adIdx++]);
  return out;
}

/**
 * /now-showing: require both backdrop and logo after TMDB hydrate + cache pass.
 * Library fillers still need both URLs (no TMDB id → not hydrated here).
 */
function nowShowingRowHasBannerAndLogo(m) {
  const b = String(m.bannerUrl || "").trim();
  const l = String(m.logoUrl || "").trim();
  return b.length > 0 && l.length > 0;
}

/** Same basenames as buildTmdbNowShowingListCards — one file per TMDB id (or sqlite id fallback). */
function nowShowingImageCacheFileNames(m) {
  const tid =
    m.tmdbId != null && m.tmdbId !== ""
      ? String(m.tmdbId)
      : m.id != null && m.id !== ""
        ? String(m.id)
        : "x";
  return {
    banner: `nowshowinglist-${tid}.jpg`,
    logo: `nowshowinglist-${tid}-logo.png`,
  };
}

function nowShowingAssetLooksCachedOrLocal(u) {
  return /(^|\/|\\)imagecache\//i.test(String(u || ""));
}

/**
 * Poster deck stores TMDB URLs in now-showing.db (metadata only — not image bytes).
 * For /now-showing/data, download remote banner/logo into config/cache/imagecache and
 * return same-origin URLs so the browser loads from disk cache like other posters.
 */
async function ensureNowShowingMoviesImageCacheForResponse(movies, baseUrl) {
  if (!Array.isArray(movies) || !movies.length) return;
  const root = String(baseUrl || "");
  const ic = root + "/imagecache/";
  for (const m of movies) {
    const { banner: bFn, logo: lFn } = nowShowingImageCacheFileNames(m);
    const bSrc = String(m.bannerUrl || "").trim();
    const lSrc = String(m.logoUrl || "").trim();
    if (bSrc && !nowShowingAssetLooksCachedOrLocal(bSrc) && /^https?:\/\//i.test(bSrc)) {
      try {
        if (await core.CacheImage(bSrc, bFn)) m.bannerUrl = ic + bFn;
      } catch (e) {
        /* keep remote URL */
      }
    } else if (bSrc.startsWith("/imagecache/")) {
      m.bannerUrl = root + bSrc;
    }
    if (lSrc && !nowShowingAssetLooksCachedOrLocal(lSrc) && /^https?:\/\//i.test(lSrc)) {
      try {
        if (await core.CacheImage(lSrc, lFn)) m.logoUrl = ic + lFn;
      } catch (e) {
        /* keep remote URL */
      }
    } else if (lSrc.startsWith("/imagecache/")) {
      m.logoUrl = root + lSrc;
    }
  }
}

async function buildTmdbNowShowingListCards() {
  const out = [];
  if (!loadedSettings || loadedSettings.enableNowShowingListInPoster !== "true") {
    return out;
  }
  CardTypeEnum.NowShowingList[1] = String(loadedSettings.nowShowingListBanner || "");
  let movies = [];
  try {
    const nFuture = nowShowingShowtimeDisplayCount();
    const nsSlots = Math.min(10, nFuture + 2);
    movies =
      nowShowingDb.listMoviesForScreen({ showtimeSlotCount: nsSlots }) || [];
    await nowShowingDb.backfillRemoteAssetsToLocalPaths(movies);
    await nowShowingDb.hydrateMissingBannerLogoFromTmdb(
      movies,
      loadedSettings && loadedSettings.tmdbApiKey
    );
    await nowShowingDb.backfillRemoteAssetsToLocalPaths(movies);
  } catch (e) {
    return out;
  }
  const hasArt = loadedSettings.hasArt === "true";
  for (let i = 0; i < movies.length; i++) {
    const r = movies[i];
    if (!nowShowingRowHasBannerAndLogo(r)) continue;
    const medCard = new MediaCard();
    medCard.cardType = [...CardTypeEnum.NowShowingList];
    medCard.title = r.title || "";
    medCard.year = r.year || "";
    medCard.mediaType = "movie";
    medCard.rating = r.rating || "";
    medCard.contentRating = r.contentRating || "";
    medCard.summary = r.overview || "";
    const nSt = Math.min(8, nowShowingShowtimeDisplayCount() + 2);
    const timesArr = Array.isArray(r.showtimes)
      ? r.showtimes.filter(Boolean).slice(0, nSt)
      : [];
    const times = timesArr.join(" · ");
    medCard.tagLine = times || medCard.title;
    const genreStr = r.genres || "";
    medCard.genre = genreStr
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    medCard.studio = "";
    medCard.theme = "";
    const tid = r.tmdbId != null ? String(r.tmdbId) : String(r.id);
    const fileBanner = `nowshowinglist-${tid}.jpg`;
    const bannerUrl = r.bannerUrl || "";
    if (bannerUrl) {
      try {
        await core.CacheImage(bannerUrl, fileBanner);
        medCard.posterURL = "/imagecache/" + fileBanner;
      } catch (e) {
        medCard.posterURL = "/images/no-poster-available.png";
      }
    } else {
      medCard.posterURL = "/images/no-poster-available.png";
    }
    if (hasArt && r.logoUrl) {
      const fileLogo = `nowshowinglist-${tid}-logo.png`;
      try {
        await core.CacheImage(r.logoUrl, fileLogo);
        medCard.posterArtURL = "/imagecache/" + fileLogo;
      } catch (e) {
        medCard.posterArtURL = "";
      }
    }
    medCard.posterAR = 1.47;
    medCard.DBID = "nowshowinglist-" + (r.id != null ? r.id : tid);
    out.push(medCard);
  }
  return out;
}

/** Library-style slides: cached poster DB first when enabled; live on-demand only as backup. */
function buildLibrarySlideDeckFromPosterCache() {
  if (!preferCachedPostersEnabled()) return odCards;
  const kind = loadedSettings
    ? getMediaServerKind(loadedSettings.mediaServerType)
    : "";
  const cached = posterMetadata.buildFallbackMediaCards(
    primaryCachedPosterSlideCount(),
    kind
  );
  if (cached.length > 0) return cached;
  return odCards;
}

/**
 * Render cached poster-library slides immediately so /getcards can respond before
 * Now Playing / on-demand network work finishes (first paint on /posters).
 */
async function warmCachedPosterDeckEarlyIfPossible() {
  if (!loadedSettings || !preferCachedPostersEnabled()) return;
  if (!cachedPosterDbHasRows()) return;
  const kind = getMediaServerKind(loadedSettings.mediaServerType);
  const warmCount = Math.min(12, primaryCachedPosterSlideCount());
  const cached = posterMetadata.buildFallbackMediaCards(warmCount, kind);
  if (!cached.length) return;
  globalPage.cards = cached.slice();
  try {
    await globalPage.OrderAndRenderCards(
      BASEURL,
      loadedSettings.hasArt,
      loadedSettings.odHideTitle,
      loadedSettings.odHideFooter,
      loadedSettings.showCast !== undefined ? loadedSettings.showCast : "false",
      loadedSettings.showDirectors !== undefined
        ? loadedSettings.showDirectors
        : "false",
      loadedSettings.showAuthors !== undefined ? loadedSettings.showAuthors : "false",
      loadedSettings.showAlbumArtist !== undefined
        ? loadedSettings.showAlbumArtist
        : "false",
      loadedSettings.displayPosterAlbum !== undefined
        ? loadedSettings.displayPosterAlbum
        : "true",
      loadedSettings.displayPosterVideo !== undefined
        ? loadedSettings.displayPosterVideo
        : "true",
      loadedSettings.displayPosterBooks !== undefined
        ? loadedSettings.displayPosterBooks
        : "true",
      loadedSettings.displayPosterActor !== undefined
        ? loadedSettings.displayPosterActor
        : "false",
      loadedSettings.displayPosterActress !== undefined
        ? loadedSettings.displayPosterActress
        : "false",
      loadedSettings.displayPosterDirector !== undefined
        ? loadedSettings.displayPosterDirector
        : "false",
      loadedSettings.displayPosterAuthor !== undefined
        ? loadedSettings.displayPosterAuthor
        : "false",
      loadedSettings.displayPosterArtist !== undefined
        ? loadedSettings.displayPosterArtist
        : "false"
    );
    globalPage.slideDuration = loadedSettings.slideDuration * 1000;
    globalPage.playThemes = loadedSettings.playThemes;
    globalPage.playGenericThemes = loadedSettings.genericThemes;
    globalPage.fadeTransition =
      loadedSettings.fade == "true" ? "carousel-fade" : "";
    globalPage.custBrand = loadedSettings.custBrand;
    globalPage.titleColour = loadedSettings.titleColour;
    globalPage.footColour = loadedSettings.footColour;
    globalPage.bgColour = loadedSettings.bgColour;
    globalPage.hasArt = loadedSettings.hasArt;
    globalPage.quizTime =
      loadedSettings.triviaTimer !== undefined ? loadedSettings.triviaTimer : 15;
    globalPage.hideSettingsLinks =
      loadedSettings.hideSettingsLinks !== undefined
        ? loadedSettings.hideSettingsLinks
        : "false";
    globalPage.rotate =
      loadedSettings.rotate !== undefined ? loadedSettings.rotate : "false";
  } catch (e) {
    /* non-fatal: full deck build in loadNowScreening will retry */
  }
}

/**
 * @desc Wrapper function to call now screening method.
 * @returns {Promise<object>} mediaCards array - results of now screening search
 */
async function loadNowScreening() {

  // stop the clock
  clearInterval(nowScreeningClock);
  rebuildAdSlideCardsFromDb();

  const wantListOnlyHomePoster =
    loadedSettings &&
    loadedSettings.nowShowingListOnly === "true" &&
    loadedSettings.enableNowShowingListInPoster === "true";

  let skipMediaServerNowPlayingFetch = false;
  if (wantListOnlyHomePoster) {
    tmdbNowShowingPosterCards = await buildTmdbNowShowingListCards();
    if (tmdbNowShowingPosterCards.length > 0) {
      skipMediaServerNowPlayingFetch = true;
      nsCards = [];
    }
  } else {
    tmdbNowShowingPosterCards = [];
  }

  // stop timers dont run if disabled
  if (!isMediaServerEnabled && !skipMediaServerNowPlayingFetch) {
    nsCards = [];
    return nsCards;
  }

  let ms = null;
  if (!skipMediaServerNowPlayingFetch) {
    const Pms = getMediaServerClass(loadedSettings.mediaServerType);
    ms = new Pms({
      plexHTTPS: loadedSettings.plexHTTPS,
      plexIP: loadedSettings.plexIP,
      plexPort: loadedSettings.plexPort,
      plexToken: loadedSettings.plexToken,
    });
  }

  let excludeLibraries;
  if(loadedSettings.excludeLibs !== undefined && loadedSettings.excludeLibs !== ""){
    excludeLibraries = loadedSettings.excludeLibs.split(",");
    
    // trim leading and trailing spaces
    excludeLibraries = excludeLibraries.map(function (el) {
      return el.trim();
    });
  }
  

  let pollInterval = nsCheckSeconds;
  // call now screening method
  if (!skipMediaServerNowPlayingFetch) {
    try {
      nsCards = await ms.GetNowScreening(
        loadedSettings.playThemes,
        loadedSettings.genericThemes,
        loadedSettings.hasArt,
        loadedSettings.filterRemote,
        loadedSettings.filterLocal,
        loadedSettings.filterDevices,
        loadedSettings.filterUsers,
        loadedSettings.hideUser,
        excludeLibraries
      );
    // Send to Awtrix, if enabled
    if(isAwtrixEnabled){
      var awt = new awtrix();
      var awtrixApps = []; 

      nsCards.forEach(card => {
        var titleText = card.title.toUpperCase();
        
        titleText = titleText.replaceAll("’","'");
        var appIcon;
        //console.log(card);
        var RED = [255,0,0];
        var GREEN = [0,255,0];
        var BLUE = [0,0,255];
        switch(card.mediaType.toLowerCase()) {
          case 'movie':
            appColour = RED;
            appIcon = 1944;
            break;
          case 'episode':
            appColour = BLUE;    
            titleText = card.title.toUpperCase() + " - " + card.episodeName;
            appIcon = 2649;            
              break;
          case 'track':
          case 'album':
          case 'audiobook':
            appColour = GREEN;
            appIcon = 17668;            
            break;
          case 'ebook':
            appColour = GREEN;
            appIcon = 17668;
            break;
          default:
            appColour = RED;
        }

        var customApp = {
          'text': titleText,
          'pushIcon': 0,
          'icon': appIcon,
          'color': appColour,
          //'duration': 10,
          'textCase': 2,
          'scrollSpeed': 60,
          'progress': card.progressPercent,
          'progressC': appColour,
          'unique': "posterr:" + card.playerIP + ":" + card.playerDevice + ":" + card.title.toUpperCase().replaceAll("’","")
          };

          try{
            awtrixApps.push(customApp)
          }
          catch(ex){
            let now = new Date();
            console.log(now.toLocaleString() + " Failed to communicate with Awtrix. Check Awtrix settings/device, then restart poster - " + ex);
            isAwtrixEnabled = false;
          }
      });
      
        if (isNowShowingEnabled && isAwtrixEnabled) {  
          // add or update now playing item
          await awtrixApps.reduce(async (memo, md) => {
            await memo;
            awtrixIP = loadedSettings.awtrixIP;
            const result = await awt.appFind(oldAwtrixApps,md.unique);
            // add to awtrix if not there
            if(result==undefined){
              try{
                await awt.post(awtrixIP,md);
              }
              catch(ex){
                let now = new Date();
                console.log(now.toLocaleString() + " Failed to communicate with Awtrix. Check Awtrix settings/device, then restart poster. " + ex);
                isAwtrixEnabled = false;
              }
              oldAwtrixApps.push(md);
              let now = new Date();
              console.log(now.toLocaleString() + " Awtrix add: " + md.text);
            }
            else{
              // update if progress has changed
              if(result.progress !== md.progress){
                // find array item id to update
                const index = oldAwtrixApps.map(function (e) {
                  return e.text
                  }).indexOf(md.text);
                //console.log("Awtrix: History index of item to update:" + index);

                // remove from old array and add with new value
                oldAwtrixApps.splice(index,1)
                oldAwtrixApps.push(md);

                // upate with new value
                try{
                  await awt.post(awtrixIP,md);
                }
                catch(ex){
                  let now = new Date();
                  console.log(now.toLocaleString() + " - Failed to communicate with Awtrix. Check Awtrix settings/device, then restart poster. " + ex);
                  isAwtrixEnabled = false;
                }
                let now = new Date();
              //console.log(now.toLocaleString() + " Awtrix update: " + md.text + " - " + result.progress + "% --> " + md.progress +"%");
              }

            }
          }, undefined);

          // remove item if no longer playing
          await oldAwtrixApps.reduce(async (memo, md) => {
            await memo;
            const result = await awt.appFind(awtrixApps,md.unique);
            // remove from awtrix if not playing
            if(result==undefined){
              // remove from display
              await awt.delete(awtrixIP,md.unique);
              // find index
              const index = oldAwtrixApps.map(function (e) {
                return e.text
                }).indexOf(md.text);
              //console.log("Awtrix: History index of item to update:" + index);

              // remove from old array and add with new value
              oldAwtrixApps.splice(index,1)

              let now = new Date();
              console.log(now.toLocaleString() + " Awtrix removed: " + md.text);
            }
          }, undefined);
        }
      }

      // restore defaults if media server is available again after an error
      if (isMediaServerUnavailable) {
        console.log("✅ Media server connection restored - default poll timers restored");
        isMediaServerUnavailable = false;
      }
    } catch (err) {
      let now = new Date();
      console.log(now.toLocaleString() + " *Now Playing. - Get full data: " + dumpError(err));
      pollInterval = nsCheckSeconds + 60000;
      console.log(
        "✘✘ WARNING ✘✘ - Next Now Screening query will be delayed by 1 minute:",
        "(" + pollInterval / 1000 + " seconds)"
      );
      isMediaServerUnavailable = true;
    }
  }

  const librarySlideCards = buildLibrarySlideDeckFromPosterCache();

  const nowShowingListOnlyOn =
    wantListOnlyHomePoster && tmdbNowShowingPosterCards.length > 0;
  const adsOnlyOn =
    loadedSettings &&
    loadedSettings.enableAds === "true" &&
    loadedSettings.adsOnly === "true" &&
    Array.isArray(adSlideCards) &&
    adSlideCards.length > 0;

  // Concatenate cards for all objects load now showing and on-demand cards, else just on-demand (if present)
  // TODO - move this into its own function!
  let mCards = [];

  if (adsOnlyOn) {
    mCards = adSlideCards.slice();
    if (loadedSettings.shuffleSlides !== undefined && loadedSettings.shuffleSlides == "true") {
      mCards = mCards.sort(() => Math.random() - 0.5);
    }
    globalPage.cards = mCards;
  } else if (nowShowingListOnlyOn) {
    mCards = tmdbNowShowingPosterCards.slice();
    if (loadedSettings.shuffleSlides !== undefined && loadedSettings.shuffleSlides == "true") {
      mCards = mCards.sort(() => Math.random() - 0.5);
    }
    globalPage.cards = mCards;
  } else {
  // is now screening false, then clear array
  // If sessions were detected, keep them even when the enable flag is in an
  // unexpected format (e.g. boolean/on/1) to avoid blank screens.
  if (!isNowShowingEnabled && nsCards.length > 0) {
    let now = new Date();
    console.log(
      now.toLocaleString() +
        " *Now Scrn. - Detected active sessions while Now Playing appears disabled; keeping cards for display"
    );
  }

  if (nsCards.length > 0) {
    // check for theater mode and enable
    if(loadedSettings.theaterRoomMode !== undefined && loadedSettings.theaterRoomMode == 'true' && theaterMode !== true){
      theaterOn();
    }

    if (loadedSettings.pinNS !== "true") {
      if (loadedSettings.shuffleSlides !== undefined && loadedSettings.shuffleSlides == "true") {
        mCards = nsCards.concat(librarySlideCards.concat(csCards.concat(csrCards).concat(cslCards).concat(picCards).concat(linkCards).concat(csbCards).concat(trivCards)).sort(() => Math.random() - 0.5));
      }
      else {
        mCards = nsCards.concat(librarySlideCards);
        mCards = mCards.concat(picCards);
        mCards = mCards.concat(csCards);
        mCards = mCards.concat(csrCards);
        mCards = mCards.concat(cslCards);
        mCards = mCards.concat(csbCards);
        mCards = mCards.concat(trivCards);
        mCards = mCards.concat(linkCards);
      }
      pinnedMode = false;
    }
    else {
      // if only one item is playing, then disable sound.
      if (pinnedMode == true && nsCards.length == 1) {
        nsCards[0].theme = "";
      }

      mCards = nsCards;

      if (pinnedMode == false) {
        pinnedMode = true;
        cold_start_time = new Date();
      }
    }
    globalPage.cards = mCards;
  } else {
    // check for theater mode and disable if nothing playing
    if(loadedSettings.theaterRoomMode !== undefined && loadedSettings.theaterRoomMode == 'true' && theaterMode==true){
      theaterOff(true);
    }
    
    // clear nscards if nothing playing
  //  mCards = [];

    pinnedMode = false;
    if (librarySlideCards.length > 0) {
      if (loadedSettings.shuffleSlides !== undefined && loadedSettings.shuffleSlides == "true") {
        mCards = librarySlideCards.concat(csCards.concat(csrCards).concat(cslCards).concat(picCards).concat(csbCards).concat(linkCards).concat(trivCards)).sort(() => Math.random() - 0.5);
      }
      else {
        mCards = librarySlideCards.concat(csCards);
        mCards = mCards.concat(picCards);
        mCards = mCards.concat(csrCards);
        mCards = mCards.concat(cslCards);
        mCards = mCards.concat(csbCards);
        mCards = mCards.concat(trivCards);
        mCards = mCards.concat(linkCards);
      }
      globalPage.cards = mCards;
    } else {
      if (csCards.length > 0) {
        if (loadedSettings.shuffleSlides !== undefined && loadedSettings.shuffleSlides == "true") {
          mCards = csCards.concat(csrCards.concat(cslCards).concat(picCards).concat(csbCards).concat(linkCards).concat(trivCards)).sort(() => Math.random() - 0.5);
        }
        else {
          mCards = csCards.concat(csrCards);
          mCards = mCards.concat(cslCards);
          mCards = mCards.concat(picCards);
          mCards = mCards.concat(csbCards);
          mCards = mCards.concat(trivCards);
          mCards = mCards.concat(linkCards);
        }
        globalPage.cards = mCards;
      } else {
        if (csrCards.length > 0) {
          if (loadedSettings.shuffleSlides !== undefined && loadedSettings.shuffleSlides == "true") {
            mCards = csrCards.concat(cslCards.concat(picCards).concat(csbCards).concat(linkCards).concat(trivCards)).sort(() => Math.random() - 0.5);
          }
          else {
            mCards = csrCards.concat(cslCards);
            mCards = mCards.concat(picCards);
            mCards = mCards.concat(csbCards);
            mCards = mCards.concat(trivCards);
            mCards = mCards.concat(linkCards);
          }
          globalPage.cards = mCards;

          // console.log("CSR:" +csrCards.length);
        }
        else {
          if (cslCards.length > 0) {
            if (loadedSettings.shuffleSlides !== undefined && loadedSettings.shuffleSlides == "true") {
              mCards = cslCards.concat(picCards.concat(csbCards).concat(linkCards).concat(trivCards)).sort(() => Math.random() - 0.5);
            } else {
              mCards = cslCards.concat(picCards);
              mCards = mCards.concat(csbCards);
              mCards = mCards.concat(trivCards);
              mCards = mCards.concat(linkCards);
            }
            globalPage.cards = mCards;
          } else if (csbCards.length > 0) {
            if (loadedSettings.shuffleSlides !== undefined && loadedSettings.shuffleSlides == "true") {
              mCards = csbCards.concat(picCards.concat(trivCards)).concat(linkCards).sort(() => Math.random() - 0.5);
            }
            else {
              mCards = csbCards.concat(picCards);
              mCards = mCards.concat(trivCards);
              mCards = mCards.concat(linkCards);
            }
            globalPage.cards = mCards;
          }
          else {
            if(picCards.length > 0) {
              if (loadedSettings.shuffleSlides !== undefined && loadedSettings.shuffleSlides == "true") {
                mCards = picCards.concat(trivCards).concat(linkCards).sort(() => Math.random() - 0.5);
              }
              else {
                mCards = picCards.concat(trivCards);
                mCards = mCards.concat(linkCards);
              }
              globalPage.cards = mCards;
            }
            else {
              if (loadedSettings.shuffleSlides !== undefined && loadedSettings.shuffleSlides == "true") {
                mCards = trivCards.concat(linkCards).sort(() => Math.random() - 0.5);
              }
              else {
                mCards = trivCards;
                mCards = mCards.concat(linkCards);
              }
              globalPage.cards = mCards;
            }
          }
        }
      }
    }
//console.log(linkCards.length);
//    globalPage.cards = mCards;
  }

    // TMDB Now Showing list is dedicated to /now-showing and is intentionally
    // excluded from the homepage poster deck.
  }

  if (!nowShowingListOnlyOn && !adsOnlyOn) {
    if (
      loadedSettings &&
      loadedSettings.enableAds === "true" &&
      Array.isArray(adSlideCards) &&
      adSlideCards.length
    ) {
      globalPage.cards = globalPage.cards.concat(adSlideCards);
    }
    globalPage.cards = applyNowPlayingSpacing(globalPage.cards);
    globalPage.cards = applyNowShowingListSpacing(globalPage.cards);
    globalPage.cards = applyCustomPictureSpacing(globalPage.cards);
    globalPage.cards = applyAdsSpacing(globalPage.cards);
  }

  if (isMediaServerEnabled) {
    posterMetadata.registerFromMediaServerCards(
      nsCards,
      odCards,
      getMediaServerKind(loadedSettings.mediaServerType)
    );
    posterMetadata
      .purgeMissingServerItems({
        currentServerKind: getMediaServerKind(loadedSettings.mediaServerType),
        isMediaServerEnabled,
        maxChecks: 8,
        minAgeBeforeChangeCheckMins: Math.max(
          0,
          parseInt(loadedSettings.posterCacheMinAgeBeforeChangeCheckMins, 10) ||
            0
        ),
        probeEntryGone: probePosterMetadataEntryGone,
      })
      .catch(() => {});
  }
  if (globalPage.cards.length === 0) {
    const cached = posterMetadata.buildFallbackMediaCards(
      posterMetadata.DEFAULT_FALLBACK_COUNT,
      getMediaServerKind(loadedSettings.mediaServerType)
    );
    if (cached.length > 0) {
      globalPage.cards = cached;
      let now = new Date();
      console.log(
        now.toLocaleString() +
          " Poster cache: displaying " +
          cached.length +
          " cached poster(s) (no other slides)"
      );
    }
  }

  // setup transition - fade or default slide
  let fadeTransition = "";
  if (loadedSettings.fade) {
    fadeTransition = "carousel-fade";
  }

  // put everything into global class, ready to be passed to poster.ejs
  // render html for all cards
  await globalPage.OrderAndRenderCards(
    BASEURL,
    loadedSettings.hasArt,
    loadedSettings.odHideTitle,
    loadedSettings.odHideFooter,
    loadedSettings.showCast !== undefined ? loadedSettings.showCast : "false",
    loadedSettings.showDirectors !== undefined
      ? loadedSettings.showDirectors
      : "false",
    loadedSettings.showAuthors !== undefined
      ? loadedSettings.showAuthors
      : "false",
    loadedSettings.showAlbumArtist !== undefined
      ? loadedSettings.showAlbumArtist
      : "false",
    loadedSettings.displayPosterAlbum !== undefined
      ? loadedSettings.displayPosterAlbum
      : "true",
    loadedSettings.displayPosterVideo !== undefined
      ? loadedSettings.displayPosterVideo
      : "true",
    loadedSettings.displayPosterBooks !== undefined
      ? loadedSettings.displayPosterBooks
      : "true",
    loadedSettings.displayPosterActor !== undefined
      ? loadedSettings.displayPosterActor
      : "false",
    loadedSettings.displayPosterActress !== undefined
      ? loadedSettings.displayPosterActress
      : "false",
    loadedSettings.displayPosterDirector !== undefined
      ? loadedSettings.displayPosterDirector
      : "false",
    loadedSettings.displayPosterAuthor !== undefined
      ? loadedSettings.displayPosterAuthor
      : "false",
    loadedSettings.displayPosterArtist !== undefined
      ? loadedSettings.displayPosterArtist
      : "false"
  );
  globalPage.slideDuration = loadedSettings.slideDuration * 1000;
  globalPage.playThemes = loadedSettings.playThemes;
  globalPage.playGenericThemes = loadedSettings.genericThemes;
  globalPage.fadeTransition =
    loadedSettings.fade == "true" ? "carousel-fade" : "";
  globalPage.custBrand = loadedSettings.custBrand;
  globalPage.titleColour = loadedSettings.titleColour;
  globalPage.footColour = loadedSettings.footColour;
  globalPage.bgColour = loadedSettings.bgColour;
  globalPage.hasArt = loadedSettings.hasArt;
  globalPage.quizTime = loadedSettings.triviaTimer !== undefined ? loadedSettings.triviaTimer : 15;
  globalPage.hideSettingsLinks = loadedSettings.hideSettingsLinks !== undefined ? loadedSettings.hideSettingsLinks : 'false';
  globalPage.rotate = loadedSettings.rotate !== undefined ? loadedSettings.rotate : "false";

  // restart the clock
  nowScreeningClock = setInterval(loadNowScreening, pollInterval);
  return nsCards;
}

/**
 * On-demand slide pool: when "Prefer cached poster library" is on (default), reads from the poster metadata DB
 * only (filled by sync) — no live GetOnDemand. Otherwise pulls from the media server and optionally rewrites URLs
 * from the poster DB when that same setting is on (legacy path is server-only when prefer-cache is off).
 * @param {number} [numberOnDemandOverride] — if set, used instead of settings.numberOnDemand so fill can work when OD count is 0.
 */
async function fetchOnDemandCardsFromServer(numberOnDemandOverride) {
  if (posterSyncProgressState.status === "running") {
    // Avoid concurrent Jellyfin library scans while a full poster sync is in progress.
    return Array.isArray(odCards) ? odCards : [];
  }
  const count =
    numberOnDemandOverride != null && numberOnDemandOverride !== ""
      ? numberOnDemandOverride
      : loadedSettings.numberOnDemand;

  if (preferCachedPostersEnabled()) {
    const kind = loadedSettings
      ? getMediaServerKind(loadedSettings.mediaServerType)
      : "";
    const nRaw =
      typeof count === "number" ? count : parseInt(String(count), 10);
    const n = !isNaN(nRaw) && nRaw > 0 ? nRaw : primaryCachedPosterSlideCount();
    return apply3dLibraryFlagToCards(
      posterMetadata.buildFallbackMediaCards(n, kind)
    );
  }

  const PmsOd = getMediaServerClass(loadedSettings.mediaServerType);
  const ms = new PmsOd({
    plexHTTPS: loadedSettings.plexHTTPS,
    plexIP: loadedSettings.plexIP,
    plexPort: loadedSettings.plexPort,
    plexToken: loadedSettings.plexToken,
  });
  const cards = await ms.GetOnDemand(
    loadedSettings.onDemandLibraries,
    count,
    loadedSettings.playThemes,
    loadedSettings.genericThemes,
    loadedSettings.hasArt,
    loadedSettings.genres,
    loadedSettings.recentlyAddedDays,
    loadedSettings.contentRatings,
    {
      imagePull: buildImagePullOptions(),
      tmdbApiKey: loadedSettings.tmdbApiKey || "",
    }
  );
  return apply3dLibraryFlagToCards(cards);
}

/**
 * Resolves the MediaCard pool used for "Fill with random library titles" on /now-showing.
 * Refetches from the media server when odCards is empty or has no movie/show/episode rows
 * (e.g. on-demand pool is only music, or numberOnDemand is tiny and only albums were picked).
 * @returns {Promise<object[]>}
 */
async function ensureOdCardsForNowShowingFill() {
  const fillOn =
    loadedSettings &&
    loadedSettings.nowShowingFillFromServer === "true" &&
    (Number(loadedSettings.nowShowingFillLibraryMax) || 0) > 0;
  if (!fillOn) return [];
  if (!isMediaServerEnabled && !preferCachedPostersEnabled()) return [];
  if (posterSyncProgressState.status === "running") {
    return Array.isArray(odCards) ? odCards : [];
  }

  const nOdRaw = parseInt(loadedSettings.numberOnDemand, 10);
  const nOd = isNaN(nOdRaw) ? 0 : Math.max(0, nOdRaw);
  const nFill = Math.min(
    48,
    parseInt(loadedSettings.nowShowingFillLibraryMax, 10) || 0
  );
  const pullCount = Math.max(nOd, nFill, 24);

  let pool = Array.isArray(odCards) ? odCards : [];
  if (pool.length > 0 && odCardsHaveNowShowingFillCandidates(pool)) {
    return pool;
  }

  try {
    const fresh = await fetchOnDemandCardsFromServer(pullCount);
    if (!Array.isArray(fresh) || !fresh.length) {
      return pool;
    }
    const useFresh =
      !pool.length || !odCardsHaveNowShowingFillCandidates(pool);
    if (useFresh) {
      if (!Array.isArray(odCards) || !odCards.length) {
        odCards = fresh;
      }
      return fresh;
    }
    return pool;
  } catch (e) {
    const d = new Date();
    console.log(
      d.toLocaleString() +
        " *Now-showing library fill: could not build filler pool — " +
        (e && e.message ? e.message : e)
    );
    return pool;
  }
}

/**
 * @desc Wrapper function to call on-demand method
 * @returns {Promise<object>} mediaCards array - results of on-demand search
 */
async function loadOnDemand() {
  if (posterSyncProgressState.status === "running") {
    const odCheckMinutes = Number(loadedSettings.onDemandRefresh);
    const nextMs = isNaN(odCheckMinutes)
      ? 30 * 60 * 1000
      : Math.max(10, odCheckMinutes) * 60000;
    onDemandClock = setInterval(loadOnDemand, nextMs);
    return odCards;
  }
  // stop the clock
  clearInterval(onDemandClock);

  // dont restart clock and dont run if disabled
  if (!isOnDemandEnabled) {
    return odCards;
  }

  // Changing timings if media server unavailable (live OD only; cache-backed OD ignores this).
  let odCheckMinutes = loadedSettings.onDemandRefresh;
  if (!preferCachedPostersEnabled() && isMediaServerUnavailable) {
    odCheckMinutes = 1;
    console.log("✘✘ WARNING ✘✘ - Next on-demand query will run in 1 minute.");
    // restart interval timer
    onDemandClock = setInterval(loadOnDemand, odCheckMinutes * 60000);

    return odCards;
  }

  try {
    odCards = await fetchOnDemandCardsFromServer();
  } catch (err) {
    let d = new Date();
    console.log(d.toLocaleString() + " *On-demand - Get full data: " + err);
  }

  // restart interval timer
  onDemandClock = setInterval(loadOnDemand, odCheckMinutes * 60000);

  // randomise on-demand results for all libraries queried
  if (loadedSettings.shuffleSlides !== undefined && loadedSettings.shuffleSlides == "true") {
    return odCards.sort(() => Math.random() - 0.5);
  }
  else {
    return odCards;
  }

}

/**
 * @desc Cleans up image and MP3 cache directories
 * @returns nothing
 */
async function houseKeeping() {
  //cold_start_time = new Date();

  // clean cache
  await core.DeleteMP3Cache();
  await core.DeleteImageCache();
}

/*
 * @desc Loads all poster settings
 * @returns {object} json - settings details
 */
async function loadSettings() {
  const ls = await Promise.resolve(await Promise.resolve(setng.GetSettings()));
  return await Promise.resolve(ls);
}

/**
 * @desc check if Now Screening/Playing, On-Demand, Sonarr or Radarr options are empty/disabled
 * @returns nothing
 */
async function checkEnabled() {
  // reset all enabled variables
  isOnDemandEnabled = false;
  isMediaServerEnabled = false;
  isSonarrEnabled = false;
  isRadarrEnabled = false;
  isLidarrEnabled = false;
  isNowShowingEnabled = false;
  isPicturesEnabled = false;
  isReadarrEnabled = false;
  isSleepEnabled = false;
  isTriviaEnabled = false;
  isLinksEnabled = false;
  isAwtrixEnabled = false;

  let sleepStart;
  let sleepEnd;
  let sleepTicks;

  // check links
  if (loadedSettings.enableAwtrix == 'true' && loadedSettings.awtrixIP != null) isAwtrixEnabled = true;

  // check links
  if (loadedSettings.enableLinks == 'true') isLinksEnabled = true;

  // check trivia
  if (loadedSettings.enableTrivia == 'true') isTriviaEnabled = true;

  // check pictures
  if (loadedSettings.enableCustomPictures == 'true') isPicturesEnabled = true;

  // check now showing
  if (
    loadedSettings.enableNS !== 'false'
  ) {
    isNowShowingEnabled = true;
  }

  // check sleep mode
  // let startTime = await util.emptyIfNull(loadedSettings.sleepStart);
  // let endTime = await util.emptyIfNull(loadedSettings.sleepEnd);
  try {
    if(loadedSettings.isSleepEnabled == "true")
    isSleepEnabled = true;
  }
  catch (ex) {
    isSleepEnabled = false;
  }


  try {
    sleepStart = new Date("2100-01-01T" + loadedSettings.sleepStart);
    isSleepEnabled = true;
  }
  catch (ex) {
    console.log("*Invalid sleep start time entered");
    isSleepEnabled = false;
  }

  try {
    sleepEnd = new Date("2100-01-01T" + loadedSettings.sleepEnd);
    isSleepEnabled = true;
  }
  catch (ex) {
    console.log("*Invalid sleep end time entered");
    isSleepEnabled = false;
  }

  try {
    if (loadedSettings.enableSleep == "true" && isSleepEnabled == true && sleepEnd.getTime() !== sleepStart.getTime()) {
      isSleepEnabled = true;
      sleepTicks = sleepEnd - sleepStart;
    }
    else {
      isSleepEnabled = false;
    }
  }
  catch(ex){
    console.log("*Invalid sleep timer settings");
    isSleepEnabled = false;
  }

  // check media server connection fields (Kodi may use empty token if HTTP auth disabled)
  const _tokenOk =
    !requiresMediaServerCredential(loadedSettings.mediaServerType) ||
    (loadedSettings.plexToken !== undefined && loadedSettings.plexToken !== "");
  if (
    loadedSettings.plexIP !== undefined &&
    loadedSettings.plexIP !== "" &&
    _tokenOk &&
    loadedSettings.plexPort !== undefined &&
    loadedSettings.plexPort !== ""
  ) {
    isMediaServerEnabled = true;
  } else {
    isMediaServerEnabled = false;
  }
  
  // On-demand: live library fetches need a configured media server; cache-backed slides can run
  // offline when "Prefer cached poster library" is on and the poster DB has rows (filled by sync).
  const odNotDisabled = loadedSettings.enableOD !== "false";
  const libsConfigured =
    loadedSettings.onDemandLibraries !== undefined &&
    String(loadedSettings.onDemandLibraries || "").trim().length > 0;
  const numConfigured = loadedSettings.numberOnDemand !== undefined;
  if (!odNotDisabled || !numConfigured) {
    isOnDemandEnabled = false;
  } else if (preferCachedPostersEnabled()) {
    isOnDemandEnabled =
      cachedPosterDbHasRows() ||
      (isMediaServerEnabled && libsConfigured);
  } else {
    isOnDemandEnabled = isMediaServerEnabled && libsConfigured;
  }
  
  // check Sonarr
  if (
    loadedSettings.sonarrURL !== undefined &&
    loadedSettings.sonarrCalDays !== undefined &&
    loadedSettings.sonarrToken !== undefined &&
    loadedSettings.enableSonarr !== 'false'
  ) {
    isSonarrEnabled = true;
  }
  else{
    isSonarrEnabled = false;
  }
  
  // check Radarr
  if (
    loadedSettings.radarrURL !== undefined &&
    loadedSettings.radarrCalDays !== undefined &&
    loadedSettings.radarrToken !== undefined &&
    loadedSettings.enableRadarr !== 'false'
  ) {
    isRadarrEnabled = true;
  }
  else{
    isRadarrEnabled = false;
  }

  // check Lidarr
  if (
    loadedSettings.lidarrURL &&
    String(loadedSettings.lidarrURL).trim() !== "" &&
    loadedSettings.lidarrCalDays !== undefined &&
    loadedSettings.lidarrToken &&
    String(loadedSettings.lidarrToken).trim() !== "" &&
    loadedSettings.enableLidarr !== 'false'
  ) {
    isLidarrEnabled = true;
  } else {
    isLidarrEnabled = false;
  }
  
  // check Readarr
  if (
    loadedSettings.readarrURL !== undefined &&
    loadedSettings.readarrCalDays !== undefined &&
    loadedSettings.readarrToken !== undefined &&
    loadedSettings.enableReadarr !== 'false'
  ) {
    isReadarrEnabled = true;
  }
  else{
    isReadarrEnabled = false;
  }

  // check Trivia

  if (
    loadedSettings.triviaCategories !== undefined &&
    loadedSettings.triviaCategories.length !== 0 &&
    loadedSettings.triviaTimer !== undefined &&
    loadedSettings.triviaNumber !== undefined &&
    loadedSettings.triviaFrequency !== undefined &&
    loadedSettings.enableTrivia !== 'false'
  ) {
    isTriviaEnabled = true;
  }
  else{
    isTriviaEnabled = false;
  }

// check Awtrix
  if (
    loadedSettings.awtrixIP !== undefined &&
    loadedSettings.enableAwtrix !== 'false' &&
    loadedSettings.enableNS !== 'false'
  ) {
    isAwtrixEnabled = true;
  }
  else{
    isAwtrixEnabled = false;
  }

  // display status
  let sleepRange = " (Invalid or no date range set)";
  if (isSleepEnabled == true) {
    sleepRange = " (" + checkTime(sleepStart.getHours()) + 
      ":" + checkTime(sleepStart.getMinutes()) + 
      "->" + checkTime(sleepEnd.getHours()) + 
      ":" + checkTime(sleepEnd.getMinutes()) + ")";
  }
  else{
    sleepRange = "";
  }

  // calculate daily restart time
  let timeObject = new Date(Date.now() + restartSeconds);
  
  console.log(
    `--- Enabled Status ---
   Media server (` +
    (loadedSettings.mediaServerType || "plex") +
    `): ` +
    isMediaServerEnabled +
    `
   Now Playing (media server): ` +
    isNowShowingEnabled +
    `
   Awtrix: ` +
    isAwtrixEnabled +
    `
   On-demand: ` +
    isOnDemandEnabled +
    `
   Sonarr: ` +
    isSonarrEnabled +
    `
   Radarr: ` +
    isRadarrEnabled +
    `
   Lidarr: ` +
    isLidarrEnabled +
    `
   Custom Pictures: ` +
    isPicturesEnabled +
    `
   Readarr: ` +
    isReadarrEnabled +
    `
   Sleep timer: ` +
    isSleepEnabled + sleepRange +
    `
   Trivia: ` +
    isTriviaEnabled + 
    `
   Links: ` +
    isLinksEnabled + 
    `
   Daily restart commencing at: ` +
    timeObject.toLocaleTimeString() + 
    `
  `
  );
  return;
}

async function theaterOn(){
  tmpSleepStart = loadedSettings.sleepStart;
  tmpSleepEnd = loadedSettings.sleepEnd;

  let d = new Date();
  let h = checkTime(d.getHours());
  let m = checkTime(d.getMinutes() -5);
  let ms = checkTime(d.getMinutes() -3);
  loadedSettings.sleepEnd = h + ":" + m;
  loadedSettings.sleepStart = h + ":" + ms;
  sleep="true";
  console.log(d.toLocaleString() + ` ** Theatre mode active`);
  theaterMode = true;
}

async function theaterOff(theater) {
  sleep = "false";
  let d = new Date();
  if(theater !== undefined && theater == true && theaterMode == true){
    loadedSettings.sleepStart = tmpSleepStart;
    loadedSettings.sleepEnd = tmpSleepEnd;
    theaterMode = false;
    isSleepEnabled = false;
    //loadedSettings.enableSleep = 'false';
  }
    console.log(d.toLocaleString() + ` ** Theatre mode deactivated`);
}

async function probePosterMetadataEntryGone(entry) {
  if (!isMediaServerEnabled || !loadedSettings) return false;
  try {
    const Pms = getMediaServerClass(loadedSettings.mediaServerType);
    const ms = new Pms({
      plexHTTPS: loadedSettings.plexHTTPS,
      plexIP: loadedSettings.plexIP,
      plexPort: loadedSettings.plexPort,
      plexToken: loadedSettings.plexToken,
    });
    if (typeof ms.posterMetadataEntryGone !== "function") return false;
    return await ms.posterMetadataEntryGone(entry);
  } catch (e) {
    return false;
  }
}

function newMediaServerClient() {
  const Pms = getMediaServerClass(loadedSettings.mediaServerType);
  return new Pms({
    plexHTTPS: loadedSettings.plexHTTPS,
    plexIP: loadedSettings.plexIP,
    plexPort: loadedSettings.plexPort,
    plexToken: loadedSettings.plexToken,
  });
}

function getConfiguredOnDemandLibraryNames(libsCsv) {
  return String(libsCsv || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** @returns {string|null} Canonical name from settings, or null */
function matchConfiguredLibraryName(requested, configuredNames) {
  const r = String(requested || "").trim();
  if (!r) return null;
  const rl = r.toLowerCase();
  for (const c of configuredNames) {
    if (c.toLowerCase() === rl) return c;
  }
  return null;
}

/** Set true when POST /settings/sync/abort runs during a running sync (cooperative cancel between items). */
let posterSyncAbortRequested = false;

/** Live state for full-library poster sync (UI polls GET /settings/sync/progress). */
const posterSyncProgressState = {
  status: "idle",
  phase: "",
  label: "",
  processed: 0,
  total: 0,
  libraries: [],
  syncScope: "all",
  syncSingleLibrary: "",
  metadataOnlySync: false,
  runId: "",
  serverKind: "",
  error: "",
  startedAt: null,
  finishedAt: null,
};

function schedulePosterSyncIdleReset(delayMs) {
  const delay = delayMs != null ? delayMs : 12000;
  setTimeout(() => {
    if (
      posterSyncProgressState.status === "done" ||
      posterSyncProgressState.status === "error"
    ) {
      posterSyncProgressState.status = "idle";
      posterSyncProgressState.phase = "";
      posterSyncProgressState.label = "";
      posterSyncProgressState.processed = 0;
      posterSyncProgressState.total = 0;
      posterSyncProgressState.libraries = [];
      posterSyncProgressState.syncScope = "all";
      posterSyncProgressState.syncSingleLibrary = "";
      posterSyncProgressState.metadataOnlySync = false;
      posterSyncProgressState.runId = "";
      posterSyncProgressState.error = "";
      posterSyncProgressState.serverKind = "";
      posterSyncProgressState.startedAt = null;
      posterSyncProgressState.finishedAt = null;
    }
  }, delay);
}

/**
 * Register posters for every item in the configured on-demand libraries (same genre/content filters as on-demand).
 * Runs at startup and on each poster-cache refresh tick. Updates posterSyncProgressState when opts.syncProgress is passed (manual sync from UI).
 * @param {{ singleLibrary?: string }} [options] If singleLibrary is set, only that library (must match a configured on-demand name, case-insensitive) is synced.
 */
async function syncFullPosterLibraryFromMediaServer(options) {
  const syncDebugEnabled =
    String(process.env.POSTERR_SYNC_DEBUG || "").trim().toLowerCase() === "true";
  const syncDebugLog = (msg) => {
    if (!syncDebugEnabled) return;
    console.log(new Date().toLocaleString() + " [poster sync debug] " + msg);
  };
  if (posterSyncProgressState.status === "running") {
    return;
  }
  if (!loadedSettings || !isMediaServerEnabled || isMediaServerUnavailable) return;
  if (
    !loadedSettings.onDemandLibraries ||
    !String(loadedSettings.onDemandLibraries).trim()
  ) {
    return;
  }
  const configuredNames = getConfiguredOnDemandLibraryNames(
    loadedSettings.onDemandLibraries
  );
  const singleRaw =
    options && options.singleLibrary != null
      ? String(options.singleLibrary).trim()
      : "";
  const metadataOnly =
    options && options.metadataOnlySync === true;
  let libraryCsv = String(loadedSettings.onDemandLibraries).trim();
  if (singleRaw) {
    const resolved = matchConfiguredLibraryName(singleRaw, configuredNames);
    if (!resolved) {
      return;
    }
    libraryCsv = resolved;
  }
  let ms;
  try {
    ms = newMediaServerClient();
  } catch (e) {
    return;
  }
  if (!ms || typeof ms.GetOnDemand !== "function") return;

  posterSyncAbortRequested = false;
  posterSyncProgressState.status = "running";
  posterSyncProgressState.phase = "starting";
  posterSyncProgressState.label = singleRaw
    ? "Starting (one library)…"
    : "Starting…";
  posterSyncProgressState.processed = 0;
  posterSyncProgressState.total = 0;
  posterSyncProgressState.libraries = [];
  posterSyncProgressState.syncScope = singleRaw ? "single" : "all";
  posterSyncProgressState.syncSingleLibrary = singleRaw ? libraryCsv : "";
  posterSyncProgressState.metadataOnlySync = metadataOnly;
  posterSyncProgressState.runId = Math.random().toString(36).slice(2, 8);
  posterSyncProgressState.error = "";
  posterSyncProgressState.startedAt = Date.now();
  posterSyncProgressState.finishedAt = null;
  posterSyncProgressState.serverKind = getMediaServerKind(
    loadedSettings.mediaServerType
  );

  const syncStarted = Date.now();
  const runIdTag = " [run " + posterSyncProgressState.runId + "]";
  syncDebugLog(
    "config: metadataOnly=" +
      metadataOnly +
      ", serverKind=" +
      posterSyncProgressState.serverKind +
      ', libraryCsv="' +
      libraryCsv +
      '"'
  );
  console.log(
    new Date().toLocaleString() +
      " [poster sync] start — " +
      runIdTag +
      " " +
      posterSyncProgressState.serverKind +
      ' — libraries: "' +
      libraryCsv +
      '"' +
      (singleRaw ? " (single library)" : "") +
      (metadataOnly ? " [metadata-only]" : "")
  );

  try {
    let streamRegisterCalls = 0;
    let streamRegisterWritten = 0;
    let streamRegisterTotalCards = 0;
    let streamRowCountBefore = null;
    let streamRowCountAfter = null;
    const selectedLibraries = String(libraryCsv)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const syncTargets = selectedLibraries.length > 0 ? selectedLibraries : [libraryCsv];
    syncDebugLog(
      "targets: " +
        syncTargets.length +
        " library/libraries -> " +
        syncTargets.join(" | ")
    );
    let cards = [];
    for (let i = 0; i < syncTargets.length; i++) {
      const oneLibrary = syncTargets[i];
      const chunkStarted = Date.now();
      syncDebugLog(
        "chunk " + (i + 1) + "/" + syncTargets.length + ' start: "' + oneLibrary + '"'
      );
      if (posterSyncProgressState.status === "running" && syncTargets.length > 1) {
        posterSyncProgressState.label =
          'Scanning library ' + (i + 1) + "/" + syncTargets.length + ': "' + oneLibrary + '"';
      }
      const libCards = await ms.GetOnDemand(
        oneLibrary,
        loadedSettings.numberOnDemand,
        loadedSettings.playThemes,
        loadedSettings.genericThemes,
        loadedSettings.hasArt,
        loadedSettings.genres,
        loadedSettings.recentlyAddedDays,
        loadedSettings.contentRatings,
        {
          posterSyncFullLibrary: true,
          metadataOnlySync: metadataOnly,
          syncProgress: posterSyncProgressState,
          imagePull: metadataOnly
            ? {
                background: false,
                logo: false,
                videoPoster: false,
                albumPoster: false,
                bookPoster: false,
                castPortrait: false,
                directorPortrait: false,
                authorPortrait: false,
                artistPortrait: false,
              }
            : buildPosterSyncImagePullOptions(),
          tmdbApiKey: loadedSettings.tmdbApiKey || "",
          retryLibraryKeysFromLastSync: posterSyncRetry.loadRetryKeys(
            posterSyncProgressState.serverKind
          ),
          posterSyncServerKind: posterSyncProgressState.serverKind,
          posterSyncAbortCheck: () => posterSyncAbortRequested,
          posterSyncStreamChunks:
            String(process.env.POSTERR_POSTER_SYNC_STREAM || "")
              .trim()
              .toLowerCase() !== "false",
          onPosterSyncBatch: async (batchCards, batchMeta) => {
            if (!Array.isArray(batchCards) || batchCards.length === 0) return;
            const rs = posterMetadata.registerFromMediaServerCards(
              [],
              batchCards,
              posterSyncProgressState.serverKind
            );
            streamRegisterCalls += 1;
            streamRegisterWritten += Number((rs && rs.written) || 0);
            streamRegisterTotalCards += Number((rs && rs.totalCards) || 0);
            if (streamRowCountBefore === null && rs) {
              streamRowCountBefore = Number(rs.rowCountBefore || 0);
            }
            if (rs) {
              streamRowCountAfter = Number(rs.rowCountAfter || 0);
            }
            if (posterSyncProgressState.status === "running") {
              if (metadataOnly) {
                posterSyncProgressState.phase = "caching";
                posterSyncProgressState.label =
                  "Syncing metadata… batch " +
                  Number((batchMeta && batchMeta.batchIndex) || streamRegisterCalls);
              } else {
                posterSyncProgressState.phase = "registering";
                posterSyncProgressState.label =
                  "Saving poster metadata… batch " +
                  Number((batchMeta && batchMeta.batchIndex) || streamRegisterCalls);
              }
            }
          },
        }
      );
      if (Array.isArray(libCards) && libCards.length > 0) {
        cards = cards.concat(libCards);
      }
      syncDebugLog(
        "chunk " +
          (i + 1) +
          "/" +
          syncTargets.length +
          ' done: "' +
          oneLibrary +
          '" cards=' +
          (Array.isArray(libCards) ? libCards.length : 0) +
          ", elapsed=" +
          Math.max(1, Math.round((Date.now() - chunkStarted) / 1000)) +
          "s"
      );
    }
    const abortedAfterWork = posterSyncAbortRequested;
    posterSyncAbortRequested = false;
    posterSyncProgressState.phase = "registering";
    posterSyncProgressState.label = "Saving poster metadata…";
    posterSyncProgressState.processed = cards.length;
    posterSyncProgressState.total = Math.max(
      posterSyncProgressState.total,
      cards.length
    );
    const elapsedSec = Math.max(1, Math.round((Date.now() - syncStarted) / 1000));
    let regStats;
    if (streamRegisterCalls > 0) {
      console.log(
        new Date().toLocaleString() +
          " [poster sync] caching done — " +
          runIdTag +
          " " +
          cards.length +
          " title(s) in " +
          elapsedSec +
          "s — metadata DB already updated in " +
          streamRegisterCalls +
          " batch(es)"
      );
      regStats = {
        totalCards: streamRegisterTotalCards,
        written: streamRegisterWritten,
        rowCountBefore:
          streamRowCountBefore == null ? posterMetadata.countRows() : streamRowCountBefore,
        rowCountAfter:
          streamRowCountAfter == null ? posterMetadata.countRows() : streamRowCountAfter,
      };
    } else {
      console.log(
        new Date().toLocaleString() +
          " [poster sync] caching done — " +
          runIdTag +
          " " +
          cards.length +
          " title(s) in " +
          elapsedSec +
          "s — saving metadata DB…"
      );
      regStats = posterMetadata.registerFromMediaServerCards(
        [],
        cards,
        posterSyncProgressState.serverKind
      );
    }
    try {
      const rs = regStats || {};
      console.log(
        new Date().toLocaleString() +
          " [poster sync debug]" +
          runIdTag +
          " cards=" +
          Number(rs.totalCards || 0) +
          " posterURL=" +
          Number(rs.posterUrlPresent || 0) +
          " normalized=" +
          Number(rs.normalizedCacheFile || 0) +
          " fileOk=" +
          Number(rs.fileOk || 0) +
          " titleOk=" +
          Number(rs.titlePresent || 0) +
          " written=" +
          Number(rs.written || 0) +
          " rows " +
          Number(rs.rowCountBefore || 0) +
          "->" +
          Number(rs.rowCountAfter || 0)
      );
    } catch (e) {
      /* ignore debug log errors */
    }
    posterSyncRetry.saveRetryKeys(
      posterSyncProgressState.serverKind,
      posterSyncRetry.collectRetryKeysFromCards(
        cards,
        posterSyncProgressState.serverKind,
        buildImagePullOptions()
      )
    );
    posterSyncProgressState.status = "done";
    posterSyncProgressState.phase = "complete";
    posterSyncProgressState.label = abortedAfterWork
      ? "Stopped — partial sync (" + cards.length + " title(s))"
      : "Complete — " + cards.length + " title(s) " + (metadataOnly ? "metadata synced" : "cached");
    posterSyncProgressState.finishedAt = Date.now();
    console.log(
      new Date().toLocaleString() +
        " [poster sync] " +
        runIdTag +
        " " +
        (abortedAfterWork ? "stopped (aborted) — " : "complete — ") +
        cards.length +
        " title(s) registered (" +
        Math.round((Date.now() - syncStarted) / 1000) +
        "s total)"
    );
    syncDebugLog(
      "summary: cards=" +
        cards.length +
        ", streamedBatches=" +
        streamRegisterCalls +
        ", streamedWritten=" +
        streamRegisterWritten +
        ", elapsed=" +
        Math.round((Date.now() - syncStarted) / 1000) +
        "s"
    );
    schedulePosterSyncIdleReset(12000);
  } catch (e) {
    posterSyncAbortRequested = false;
    posterSyncProgressState.status = "error";
    posterSyncProgressState.phase = "error";
    posterSyncProgressState.error = e && e.message ? e.message : String(e);
    posterSyncProgressState.label = "Sync failed";
    posterSyncProgressState.finishedAt = Date.now();
    const d = new Date();
    console.log(
      d.toLocaleString() +
        " [poster sync] failed — " +
        runIdTag +
        " " +
        posterSyncProgressState.error
    );
    syncDebugLog(
      "error: " + (e && e.stack ? String(e.stack).slice(0, 1200) : String(e))
    );
    schedulePosterSyncIdleReset(20000);
  }
}

function schedulePosterMetadataRefresh() {
  clearInterval(posterMetadataRefreshClock);
  if (!loadedSettings) return;
  const prMins = Math.max(
    0,
    parseInt(loadedSettings.posterCacheRefreshMins, 10) || 0
  );
  if (prMins <= 0) return;
  const tickMs = Math.max(5 * 60 * 1000, prMins * 60 * 1000);
  posterMetadataRefreshClock = setInterval(() => {
    (async () => {
      try {
        let imageDownloadHeaders;
        if (
          getMediaServerKind(loadedSettings.mediaServerType) === "jellyfin"
        ) {
          try {
            const jfMs = newMediaServerClient();
            if (
              jfMs &&
              typeof jfMs.jellyfinImageAuthHeaders === "function"
            ) {
              imageDownloadHeaders = jfMs.jellyfinImageAuthHeaders();
            }
          } catch (e) {
            /* ignore */
          }
        }
        await posterMetadata.runScheduledRefresh({
          refreshMins: prMins,
          minAgeBeforeChangeCheckMins: Math.max(
            0,
            parseInt(loadedSettings.posterCacheMinAgeBeforeChangeCheckMins, 10) ||
              0
          ),
          currentServerKind: getMediaServerKind(loadedSettings.mediaServerType),
          isMediaServerEnabled,
          probeEntryGone: probePosterMetadataEntryGone,
          imageDownloadHeaders: imageDownloadHeaders || undefined,
        });
      } catch (err) {
        const d = new Date();
        console.log(
          d.toLocaleString() +
            " Poster cache refresh error: " +
            (err && err.message ? err.message : err)
        );
      }
      await syncFullPosterLibraryFromMediaServer();
    })();
  }, tickMs);
}

async function suspend() {
  // stop all clocks
  clearInterval(nowScreeningClock);
  clearInterval(onDemandClock);
  clearInterval(sonarrClock);
  clearInterval(radarrClock);
  //todo - possibly remove this permanenetly. trying to debug if cache is cleared inadvertantly. Leave commented for now.      clearInterval(houseKeepingClock);
  clearInterval(picturesClock);
  clearInterval(readarrClock);
  clearInterval(lidarrClock);
  clearInterval(linksClock);
  clearInterval(posterMetadataRefreshClock);
  // set to sleep
  sleep = "true";
  // loadedSettings.playThemes = 'false';
  // loadedSettings.genericThemes = 'false';
  // loadedSettings.enableCustomPictureThemes = 'false';

  let d = new Date();
  if (apiSleep==true)
  {
    console.log(" ** api/sleep - Sleep command issued. (Overrides set schedules)");
  }
  else
  {
    console.log(d.toLocaleString() + ` ** Sleep mode activated (sleep terminates at ` + loadedSettings.sleepEnd + `)`);
  }
}


async function wake(theater) {
  sleep = "false";
  loadedSettings = await loadSettings();
  if (isSonarrEnabled) await loadSonarrComingSoon();
  if (isRadarrEnabled) await loadRadarrComingSoon();
  if (isLidarrEnabled) await loadLidarrComingSoon();
  if (isOnDemandEnabled) await loadOnDemand();
  if (isPicturesEnabled) await loadPictures();
  if (isReadarrEnabled) await loadReadarrComingSoon();
  if (isTriviaEnabled) await loadTrivia();
  if (isLinksEnabled) await loadLinks();
  await loadNowScreening();
  schedulePosterMetadataRefresh();
  let d = new Date();
  if(theater !== true) console.log(d.toLocaleString() + ` ** Sleep mode terminated (next activation at ` + loadedSettings.sleepStart + `)`);
}

/** Bind HTTP listener once, after settings exist (avoids 401/undefined races while GetSettings() delays). */
function startHttpServerOnce() {
  if (httpServerStarted) return;
  httpServerStarted = true;
  app.listen(PORT, () => {
    console.log(`✅ Web server started on internal port ` + PORT);
  });
}

/**
 * @desc Starts everything - calls coming soon 'tv', on-demand and now screening functions. Then initialises timers
 * @returns nothing
 */
async function startup(clearCache) {
  // stop all clocks
  clearInterval(nowScreeningClock);
  clearInterval(onDemandClock);
  clearInterval(sonarrClock);
  clearInterval(radarrClock);
  clearInterval(houseKeepingClock);
  clearInterval(picturesClock);
  clearInterval(readarrClock);
  clearInterval(lidarrClock);
  clearInterval(triviaClock);
  clearInterval(linksClock);
  clearInterval(posterMetadataRefreshClock);

  picCards = [];
  adSlideCards = [];
  odCards = [];
  nsCards = [];
  csCards = [];
  csrCards = [];
  cslCards = [];
  csbCards = [];
  trivCards = [];
  linkCards = [];

  // run housekeeping job 
  if (clearCache === true){
    await houseKeeping();
//    let d = new Date();
//    console.log(d.toLocaleString() + ` ** Restart/reload **`);
  }
// TODO to remove this!       console.log(clearCache);
  // load settings object
  loadedSettings = await Promise.resolve(await loadSettings());
  await posterMetadata.initPosterMetadataDb();
  await nowShowingDb.initNowShowingDb();
  await adsDb.initAdsDb();
  await migrateLegacyGlobalAdsPriceAddOnOnce();
  startHttpServerOnce();
  if (loadedSettings == 'undefined') {
    console.load('settings not loaded!!');
  }
  else {
    console.log(`✅ Settings loaded
  `);

  // set values for noLinks
  globalPage.hideSettingsLinks = loadedSettings.hideSettingsLinks !== undefined ? loadedSettings.hideSettingsLinks : 'false';

    // restart timer for houseKeeping
    //houseKeepingClock = setInterval(houseKeeping, 86400000); // daily
  }

  // check status
  await checkEnabled();

  // set custom titles if available
  CardTypeEnum.NowScreening[1] = loadedSettings.nowScreening !== undefined ? loadedSettings.nowScreening : "";
  CardTypeEnum.OnDemand[1] = loadedSettings.onDemand !== undefined ? loadedSettings.onDemand : "";
  CardTypeEnum.RecentlyAdded[1] = loadedSettings.recentlyAdded !== undefined ? loadedSettings.recentlyAdded : "";
  CardTypeEnum.ComingSoon[1] = loadedSettings.comingSoon !== undefined ? loadedSettings.comingSoon : "";
  CardTypeEnum.IFrame[1] = loadedSettings.iframe !== undefined ? loadedSettings.iframe : "";
  CardTypeEnum.Playing[1] = loadedSettings.playing !== undefined ? loadedSettings.playing : "";
  CardTypeEnum.Picture[1] = loadedSettings.picture !== undefined ? loadedSettings.picture : "";
  CardTypeEnum.EBook[1] = loadedSettings.ebook !== undefined ? loadedSettings.ebook : "";
  CardTypeEnum.Trivia[1] = loadedSettings.trivia !== undefined ? loadedSettings.trivia : ""; 
  CardTypeEnum.WebURL[1] = loadedSettings.links !== undefined ? loadedSettings.links : "";
  CardTypeEnum.NowShowingList[1] =
    loadedSettings.nowShowingListBanner !== undefined ? loadedSettings.nowShowingListBanner : "";

  // initial load of card providers
  if (isSonarrEnabled) await loadSonarrComingSoon();
  if (isRadarrEnabled) await loadRadarrComingSoon();
  if (isLidarrEnabled) await loadLidarrComingSoon();
  if (isOnDemandEnabled) await loadOnDemand();
  if (isPicturesEnabled) await loadPictures();
  if (isReadarrEnabled) await loadReadarrComingSoon();
  if (isTriviaEnabled) await loadTrivia();
  if (isLinksEnabled) await loadLinks();

  // First paint: serve cached poster-library HTML before Now Playing blocks on the media server.
  await warmCachedPosterDeckEarlyIfPossible();

  // Build homepage deck before optional Awtrix (network) work so /getcards can serve cached posters sooner.
  await loadNowScreening();

  // Awtrix initialize - if enabled
  if(isAwtrixEnabled){
    var awt = new awtrix();
    awtrixIP = loadedSettings.awtrixIP;
    try{
      const STATS = await awt.stats(awtrixIP);
      let now = new Date();
      console.log(now.toLocaleString() + " *Awtrix device status: " + STATS.statusText);
    }
    catch(ex){
      let now = new Date();
      //console.log(now.toLocaleString() + " Awtrix failed connectivity test");
      console.log(now.toLocaleString() + " Disabling Awtrix. Check Awtrix settings/device, then restart poster - " + ex);

      isAwtrixEnabled = false;
    }
    try{
      // clear any old awtrix apps
      await awt.clear(awtrixIP);
      // play a pleasant greeting
      var tune = {
        "Flntstn":"d=4,o=5,b=200:g#,c#,8p,c#6,8a#,g#,c#,8p"
      }
      //await awt.rtttl(awtrixIP,tune);
    }
    catch(ex){
      let now = new Date();
      //console.log(now.toLocaleString() + " Awtrix failed clear operation");
      console.log(now.toLocaleString() + " Disabling Awtrix. Check Awtrix settings/device, then restart poster - " + ex);
      isAwtrixEnabled = false;
    }
  }

  syncFullPosterLibraryFromMediaServer().catch(() => {});

  // let now = new Date();
  // console.log(
  //   now.toLocaleString() + " Now screening titles refreshed (First run only)"
  // );
  console.log(" ");
  console.log(`✅ Application ready on http://hostIP:` + PORT + BASEURL + `
   Goto http://hostIP:` + PORT + BASEURL + `/settings to get to setup page.
  `);
  cold_start_time = new Date();

  // add a server id if missing
  if (loadedSettings !== undefined && loadedSettings.serverID == undefined) {
    loadedSettings.serverID = util.createUUID();
    const saved = await setng.UpdateSettings(loadedSettings);
  }

  if (hasReported == false && loadedSettings !== undefined) {
    let v = new vers(endPoint);
    const logzResponse = await v.log(loadedSettings.serverID, pjson.version, isNowShowingEnabled, isOnDemandEnabled, isSonarrEnabled, isRadarrEnabled, isPicturesEnabled, isReadarrEnabled, isTriviaEnabled, isLinksEnabled);
    message = logzResponse.message;
    latestVersion = logzResponse.version;
    hasReported = true;
  }
  if (latestVersion !== undefined && latestVersion !== pjson.version.toString()) {
    // version numbers
    let curMaj = parseInt(pjson.version.toString().split(".")[0]);
    let curMed = parseInt(pjson.version.toString().split(".")[1]);
    let curMin = parseInt(pjson.version.toString().split(".")[2]);
    let rptMaj = parseInt(latestVersion.split(".")[0]);
    let rptMed = parseInt(latestVersion.split(".")[1]);
    let rptMin = parseInt(latestVersion.split(".")[2]);

    // check if update required
    if (rptMaj > curMaj) {
      updateAvailable = true;
    }
    else {
      if (rptMaj == curMaj && rptMed > curMed) {
        updateAvailable = true;
      }
      else {
        if (rptMaj == curMaj && rptMed == curMed && rptMin > curMin) {
          updateAvailable = true;
        }
        else {
          updateAvailable = false;
        }
      }
    }

    if (updateAvailable == true) {
      console.log("*** PLEASE UPDATE TO v" + latestVersion + " ***");
      console.log("");
    }
    else {
      console.log("*** You are running the latest version of Posterr ***");
      console.log("");
    }
  }

  if (message !== undefined && message !== "") {
    console.log("Message: " + message);
    console.log("");
  }

  // setup sleep mode if enabled
  if(isSleepEnabled==true){
    // check times every 5 seconds
    sleepClock = setInterval(() => {
      if(theaterMode !== true){
        let startSleep = new Date("2100-01-01T" + loadedSettings.sleepStart);
        let endSleep = new Date("2100-01-01T" + loadedSettings.sleepEnd);
        let cur = new Date();
        let curDate = new Date("2100-01-01T" + checkTime(cur.getHours()) + ":" + checkTime(cur.getMinutes()));

        if((curDate.getTime() >= startSleep.getTime() && curDate.getTime() < endSleep.getTime() && endSleep.getTime() > startSleep.getTime()) || (endSleep.getTime() < startSleep.getTime() && (curDate.getTime() < endSleep.getTime() || curDate.getTime() >= startSleep.getTime())) ){
          if(sleep !== "true"){
            sleep="true";
            suspend();
          }
        }
        else{
          if(sleep=="true" && apiSleep!=true){
            wake();
            sleep="false";
          } 
        }
      }
    }, 5000);
  }
  else{
    clearInterval(sleepClock);
    sleep = "false";
  }

  schedulePosterMetadataRefresh();

  // restart timer
  houseKeepingClock = setInterval(() => startup(false), restartSeconds); // daily

  return;
}

/**
 * @desc Saves settings and calls startup
 * @returns nothing
 */
async function saveReset(formObject) {
  const saved = await setng.SaveSettingsJSON(formObject);
  // cancel all clocks, then pause 5 seconds to ensure downloads finished
  clearInterval(nowScreeningClock);
  clearInterval(onDemandClock);
  clearInterval(sonarrClock);
  clearInterval(radarrClock);
  clearInterval(readarrClock);
  clearInterval(lidarrClock);
  clearInterval(houseKeepingClock);
  clearInterval(picturesClock);
  clearInterval(triviaClock);
  clearInterval(linksClock);
  clearInterval(posterMetadataRefreshClock);

  // clear cards
  nsCards = [];
  odCards = [];
  csrCards = [];
  csrCards = [];
  picCards = [];
  adSlideCards = [];
  cslCards = [];
  csbCards = [];
  trivCards = [];
  linkCards = [];

  console.log(
    "✘✘ WARNING ✘✘ - Restarting. Please wait while current jobs complete"
  );
  // clear old cards
  globalPage.cards = [];
  // dont clear cached files if restarting after settings saved
  startup(false);
}

// call all card providers - initial card loads and sets scheduled runs
//TODO - to remove!    console.log('<< INITIAL START >>');
startup(false);

//use ejs templating engine
app.set("view engine", "ejs");
app.set('views', path.join(__dirname, 'myviews'));
//console.log('app.set:' + __dirname);

// Express settings
app.use(express.json());
app.use(
  express.urlencoded({
    extended: false,
  })
);
app.use(cors());

app.set("trust proxy", 1);
app.use(cookieParser());
app.use(
  session({
    cookie: {
      secure: true,
      maxAge: 3000000,
    },
    // store: cookieParser,
    store: new MemoryStore({
      checkPeriod: 86400000, // prune expired entries every 24h
    }),
    secret: "xyzzy",
    saveUninitialized: true,
    resave: false,
  })
);

// sets public folder for assets
//app.use(express.static(path.join(__dirname, "public")));

//sets public folder for assets
if (BASEURL == "") {
  //  console.log(__dirname);
  //  console.log(process.cwd());
  app.use("/custom/ads", express.static(ADS_MEDIA_ROOT));
  app.use("/custom/ads-view", express.static(ADS_VIEW_BG_ROOT));
  app.use("/custom/pictures", express.static(CUSTOM_PICTURES_ROOT));
  app.use(express.static(path.join(__dirname, "public")));
  app.use(express.static(CACHE_ROOT));
  app.use(express.static(path.join(process.cwd(), "public")));
  // app.use("/js",express.static(path.join(__dirname, "/node_modules/fitty/dist")));  
  // app.use("/bscss",express.static(path.join(__dirname, "/node_modules/bootstrap/dist/css")));
  // app.use("/js",express.static(path.join(__dirname, "node_modules/bootstrap/dist/js")));
  // app.use("/js",express.static(path.join(__dirname, "node_modules/jquery/dist")));
}
else {
  app.use(BASEURL + "/custom/ads", express.static(ADS_MEDIA_ROOT));
  app.use(BASEURL + "/custom/ads-view", express.static(ADS_VIEW_BG_ROOT));
  app.use(BASEURL + "/custom/pictures", express.static(CUSTOM_PICTURES_ROOT));
  app.use(BASEURL, express.static(__dirname + '/public'));
  app.use(BASEURL, express.static(CACHE_ROOT));
  app.use(BASEURL, express.static(process.cwd() + '/public'));

}


// set routes
function renderPostersHome(req, res) {
  const homeCycleDedicatedView =
    loadedSettings && loadedSettings.homePageCycleDedicatedView === "ads"
      ? "ads"
      : "now-showing";
  const nowShowingListOnHomeEnabled =
    loadedSettings &&
    String(loadedSettings.enableNowShowingListInPoster).toLowerCase() ===
      "true";
  const nowShowingHomeCycleEnabled =
    loadedSettings &&
    String(loadedSettings.enableNowShowingPageCycle).toLowerCase() === "true" &&
    (homeCycleDedicatedView === "ads" || nowShowingListOnHomeEnabled);
  const viewHotkeysEnabled =
    loadedSettings &&
    String(loadedSettings.enableViewHotkeys).toLowerCase() === "true";
  res.render("posters-home", {
    globals: globalPage,
    hasConfig: setng.GetChanged(),
    baseUrl: BASEURL,
    custBrand: globalPage.custBrand,
    hasArt: globalPage.hasArt,
    quizTime: globalPage.quizTime,
    rotate: globalPage.rotate,
    nowShowingPageCycleEnabled: nowShowingHomeCycleEnabled ? "true" : "false",
    nowShowingPageCycleEveryMins:
      loadedSettings && loadedSettings.nowShowingPageCycleEveryMins !== undefined
        ? loadedSettings.nowShowingPageCycleEveryMins
        : DEFAULT_SETTINGS.nowShowingPageCycleEveryMins,
    nowShowingPageCycleStayMins:
      loadedSettings && loadedSettings.nowShowingPageCycleStayMins !== undefined
        ? loadedSettings.nowShowingPageCycleStayMins
        : DEFAULT_SETTINGS.nowShowingPageCycleStayMins,
    homePageCycleDedicatedView: homeCycleDedicatedView,
    viewHotkeysEnabled: viewHotkeysEnabled ? "true" : "false",
    ...newFeaturesBannerViewData(),
  }); // index refers to index.ejs
}

app.get(BASEURL + "/", (req, res) => {
  const homeCycleDedicatedView =
    loadedSettings && loadedSettings.homePageCycleDedicatedView === "ads"
      ? "ads"
      : "now-showing";
  const nowShowingListOnHomeEnabled =
    loadedSettings &&
    String(loadedSettings.enableNowShowingListInPoster).toLowerCase() ===
      "true";
  const nowShowingHomeCycleEnabled =
    loadedSettings &&
    String(loadedSettings.enableNowShowingPageCycle).toLowerCase() === "true" &&
    (homeCycleDedicatedView === "ads" || nowShowingListOnHomeEnabled);
  const viewHotkeysEnabled =
    loadedSettings &&
    String(loadedSettings.enableViewHotkeys).toLowerCase() === "true";
  const everyMins =
    loadedSettings && loadedSettings.nowShowingPageCycleEveryMins !== undefined
      ? loadedSettings.nowShowingPageCycleEveryMins
      : DEFAULT_SETTINGS.nowShowingPageCycleEveryMins;
  const stayMins =
    loadedSettings && loadedSettings.nowShowingPageCycleStayMins !== undefined
      ? loadedSettings.nowShowingPageCycleStayMins
      : DEFAULT_SETTINGS.nowShowingPageCycleStayMins;
  res.render("index", {
    baseUrl: BASEURL,
    nowShowingPageCycleEnabled: nowShowingHomeCycleEnabled ? "true" : "false",
    nowShowingPageCycleEveryMins: everyMins,
    nowShowingPageCycleStayMins: stayMins,
    homePageCycleDedicatedView: homeCycleDedicatedView,
    viewHotkeysEnabled: viewHotkeysEnabled ? "true" : "false",
    ...newFeaturesBannerViewData(),
  });
});

app.get(BASEURL + "/posters", (req, res) => {
  renderPostersHome(req, res);
});

app.get(BASEURL + "/getcards", (req, res) => {
  const postersOnly =
    String((req.query && req.query.postersOnly) || "").trim() === "1";
  if (!postersOnly) {
    return res.send({ globalPage: globalPage, baseUrl: BASEURL }); // get generated cards
  }
  const cards = Array.isArray(globalPage && globalPage.cards)
    ? globalPage.cards.filter((card) => {
        var ct = card && card.cardType;
        var name = Array.isArray(ct) ? String(ct[0] || "") : String(ct || "");
        var n = name.toLowerCase();
        return n !== "ad" && n !== "now showing";
      })
    : [];
  return res.send({
    globalPage: {
      ...globalPage,
      cards,
    },
    baseUrl: BASEURL,
  });
});

app.get(BASEURL + "/now-showing", (req, res) => {
  const cycleEmbed =
    String((req.query && req.query.cycleEmbed) || "").trim() === "1";
  res.render("now-showing", {
    baseUrl: BASEURL,
    hasConfig: setng.GetChanged(),
    titleColour: loadedSettings.titleColour,
    custBrand: loadedSettings.custBrand,
    settingsVersion: nowShowingSettingsVersionToken(),
    nowShowingPageCycleEnabled:
      loadedSettings && loadedSettings.enableNowShowingPageCycle === "true"
        ? "true"
        : "false",
    nowShowingPageCycleStayMins:
      loadedSettings && loadedSettings.nowShowingPageCycleStayMins !== undefined
        ? loadedSettings.nowShowingPageCycleStayMins
        : DEFAULT_SETTINGS.nowShowingPageCycleStayMins,
    viewHotkeysEnabled:
      loadedSettings &&
      String(loadedSettings.enableViewHotkeys).toLowerCase() === "true"
        ? "true"
        : "false",
    viewHotkeysContext: cycleEmbed ? "embed-now-showing" : "now-showing-page",
    ...newFeaturesBannerViewData(),
  });
});

app.get(BASEURL + "/ads", (req, res) => {
  const rotRaw =
    loadedSettings && loadedSettings.adsRotationSeconds !== undefined
      ? loadedSettings.adsRotationSeconds
      : DEFAULT_SETTINGS.adsRotationSeconds;
  const rotN = parseInt(rotRaw, 10);
  const adsRotationSeconds = isNaN(rotN)
    ? DEFAULT_SETTINGS.adsRotationSeconds
    : Math.min(600, Math.max(3, rotN));
  const stayRaw =
    loadedSettings && loadedSettings.adsPageStaySeconds !== undefined
      ? loadedSettings.adsPageStaySeconds
      : DEFAULT_SETTINGS.adsPageStaySeconds;
  const stayN = parseInt(stayRaw, 10);
  const adsPageStaySeconds =
    isNaN(stayN) || stayN <= 0
      ? 0
      : Math.min(86400, Math.max(30, stayN));
  const adsGlobalBgRaw =
    loadedSettings && loadedSettings.adsGlobalBackgroundPath != null
      ? String(loadedSettings.adsGlobalBackgroundPath).trim()
      : "";
  const adsGlobalBackgroundPath =
    adsGlobalBgRaw.startsWith("/custom/ads-view/") ? adsGlobalBgRaw : "";
  const adsCycleEmbed =
    String((req.query && req.query.cycleEmbed) || "").trim() === "1";
  res.render("ads", {
    baseUrl: BASEURL,
    hasConfig: setng.GetChanged(),
    titleColour: loadedSettings.titleColour,
    custBrand: loadedSettings.custBrand,
    adsRotationSeconds,
    adsPageStaySeconds,
    adsGlobalBackgroundPath,
    adsCurrencyCode: normalizeNowShowingCurrencyCode(
      (loadedSettings && loadedSettings.adsCurrencyCode) ||
        DEFAULT_SETTINGS.adsCurrencyCode
    ),
    viewHotkeysEnabled:
      loadedSettings &&
      String(loadedSettings.enableViewHotkeys).toLowerCase() === "true"
        ? "true"
        : "false",
    viewHotkeysContext: adsCycleEmbed ? "embed-ads" : "ads-page",
    ...newFeaturesBannerViewData(),
  });
});

const NOW_SHOWING_OD_TYPES = new Set([
  "movie",
  "show",
  "series",
  "episode",
]);

/** True if the on-demand card list can supply /now-showing library fillers (movie/TV types with a title). */
function odCardsHaveNowShowingFillCandidates(arr) {
  if (!Array.isArray(arr) || !arr.length) return false;
  for (const c of arr) {
    const mt = String(c.mediaType || "").toLowerCase();
    if (!NOW_SHOWING_OD_TYPES.has(mt)) continue;
    const t = normalizeNowShowingTitle(
      (c && (c.title || c.tagLine)) || ""
    );
    if (t) return true;
  }
  return false;
}

function normalizeNowShowingTitle(t) {
  return String(t || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLibraryNameFor3d(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function onDemand3dLibrarySet() {
  const raw =
    loadedSettings && loadedSettings.onDemand3dLibraries != null
      ? loadedSettings.onDemand3dLibraries
      : "";
  const set = new Set();
  String(raw || "")
    .split(",")
    .map((x) => normalizeLibraryNameFor3d(x))
    .filter(Boolean)
    .forEach((x) => set.add(x));
  return set;
}

function apply3dLibraryFlagToCards(cards) {
  if (!Array.isArray(cards) || cards.length === 0) return cards;
  const libs = onDemand3dLibrarySet();
  if (libs.size === 0) {
    for (const c of cards) {
      if (!c || typeof c !== "object") continue;
      c.is3D = false;
    }
    return cards;
  }
  for (const c of cards) {
    if (!c || typeof c !== "object") continue;
    const lib = normalizeLibraryNameFor3d(c.posterLibraryLabel);
    c.is3D = lib !== "" && libs.has(lib);
  }
  return cards;
}

function nowShowingAssetUrlWithBase(u, baseUrl) {
  const s = String(u || "").trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith("/")) return (baseUrl || "") + s;
  return s;
}

function nowShowingSettingsVersionToken() {
  try {
    const p = path.join(__dirname, "config", "settings.json");
    if (!fs.existsSync(p)) return "0";
    const st = fs.statSync(p);
    return String(Math.floor(Number(st.mtimeMs) || 0));
  } catch (e) {
    return "0";
  }
}

/** Read authoritative value from disk (fixes stale `loadedSettings` after editing JSON or partial saves). */
function readNowShowingShowtimeCountFromSettingsFile() {
  try {
    const p = path.join(__dirname, "config", "settings.json");
    if (!fs.existsSync(p)) return null;
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const raw = j && j.nowShowingShowtimeCount;
    if (raw === undefined || raw === null || raw === "") return null;
    const n =
      typeof raw === "number" && !isNaN(raw)
        ? raw
        : parseInt(String(raw).trim(), 10);
    if (isNaN(n)) return null;
    return Math.max(1, Math.min(6, n));
  } catch (e) {
    return null;
  }
}

/** Clamped 1–6 from settings; drives /now-showing, fillers, and TMDB list slides. */
function nowShowingShowtimeDisplayCount() {
  const fromFile = readNowShowingShowtimeCountFromSettingsFile();
  const raw = loadedSettings && loadedSettings.nowShowingShowtimeCount;
  const fromMem =
    typeof raw === "number" && !isNaN(raw)
      ? raw
      : parseInt(String(raw == null ? "" : raw).trim(), 10);
  const fallback = Number(DEFAULT_SETTINGS.nowShowingShowtimeCount) || 6;
  const n =
    fromFile != null ? fromFile : !isNaN(fromMem) ? fromMem : fallback;
  const clamped = Math.max(1, Math.min(6, n));
  if (loadedSettings && loadedSettings.nowShowingShowtimeCount !== clamped) {
    loadedSettings.nowShowingShowtimeCount = clamped;
  }
  return clamped;
}

/** Futures + 2 buffer slots (last played + current) for /now-showing payload; capped at 8. */
function nowShowingTotalSlotsForSchedulePayload() {
  return Math.min(8, nowShowingShowtimeDisplayCount() + 2);
}

function sliceNowShowingMovieShowtimesForDisplay(m, count) {
  const c = Math.max(1, Math.min(10, count));
  const stFull = Array.isArray(m.showtimes) ? m.showtimes : [];
  const isoFull = Array.isArray(m.showtimeStartsIso) ? m.showtimeStartsIso : [];
  const len = Math.min(stFull.length, isoFull.length);
  if (len <= 0) {
    return { ...m, showtimes: [], showtimeStartsIso: [] };
  }
  if (len <= c) {
    return {
      ...m,
      showtimes: stFull.slice(0, len),
      showtimeStartsIso: isoFull.slice(0, len),
    };
  }
  const runMs =
    Math.max(1, Math.min(600, Number(m.runtimeMins) || 120)) * 60000;
  const nowMs = Date.now();
  const toMs = (i) => {
    const ms = Date.parse(String(isoFull[i]));
    return Number.isNaN(ms) ? null : ms;
  };
  let currentIdx = -1;
  for (let i = 0; i < len; i++) {
    const ms = toMs(i);
    if (ms == null) continue;
    if (nowMs >= ms && nowMs < ms + runMs) {
      currentIdx = i;
      break;
    }
  }
  let start = 0;
  if (currentIdx >= 0) {
    start = Math.max(0, currentIdx - 1);
    start = Math.max(start, currentIdx - c + 1);
    start = Math.min(start, len - c);
  } else {
    let lastPast = -1;
    for (let i = 0; i < len; i++) {
      const ms = toMs(i);
      if (ms == null) continue;
      if (ms + runMs <= nowMs) lastPast = i;
    }
    if (lastPast >= 0) {
      start = Math.max(0, Math.min(lastPast, len - c));
    } else {
      start = 0;
    }
  }
  return {
    ...m,
    showtimes: stFull.slice(start, start + c),
    showtimeStartsIso: isoFull.slice(start, start + c),
  };
}

function nowShowingFillerShowtimesWithIso(seedTitle, count, runtimeMins) {
  const rtRaw = Number(runtimeMins);
  const rt = rtRaw > 0 && !isNaN(rtRaw) ? rtRaw : 120;
  const spacingMins = rt + 10;
  const c = Number(count);
  const n = Number.isFinite(c)
    ? Math.max(1, Math.min(10, Math.floor(c)))
    : 4;
  const now = new Date();
  const t = new Date(now);
  t.setMinutes(0, 0, 0);
  t.setHours(t.getHours() + 1);
  const salt = (String(seedTitle || "").length % 4) * 10;
  t.setMinutes(t.getMinutes() + salt);
  const showtimes = [];
  const showtimeStartsIso = [];
  let ms = t.getTime();
  for (let i = 0; i < n; i++) {
    const slot = new Date(ms);
    showtimes.push(
      slot.toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    );
    showtimeStartsIso.push(slot.toISOString());
    ms += spacingMins * 60000;
  }
  return { showtimes, showtimeStartsIso };
}

function parseMoneyAmount(value) {
  if (value === undefined || value === null || value === "") return null;
  const raw = String(value).trim();
  if (!raw) return null;
  const normalized = raw
    .replace(/,/g, "")
    .replace(/[^\d.-]/g, "");
  const n = Number(normalized);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100) / 100;
}

/** One-time: legacy global adsPriceAddOn in settings → each ad row, then clear global. */
async function migrateLegacyGlobalAdsPriceAddOnOnce() {
  try {
    if (!loadedSettings) return;
    const g = parseMoneyAmount(loadedSettings.adsPriceAddOn);
    if (g == null || g <= 0) return;
    for (const ad of adsDb.listAds()) {
      const addons = Array.isArray(ad.addons) ? ad.addons : [];
      if (addons.length) continue;
      adsDb.replaceAdAddons(ad.id, [
        { title: "Add-on", amount: g, sortOrder: 0 },
      ]);
    }
    loadedSettings.adsPriceAddOn = 0;
    await setng.UpdateSettings(loadedSettings);
    const now = new Date();
    console.log(
      now.toLocaleString() +
        " Ads: migrated global price add-on onto each ad; global setting cleared."
    );
  } catch (e) {
    const now = new Date();
    console.log(
      now.toLocaleString() +
        " Ads price add-on migration skipped: " +
        (e && e.message ? e.message : e)
    );
  }
}

function randomMoneyAmountInRange(minRaw, maxRaw) {
  const min = parseMoneyAmount(minRaw);
  const max = parseMoneyAmount(maxRaw);
  const lo = min == null ? 5 : min;
  const hi = max == null ? 20 : max;
  const start = Math.min(lo, hi);
  const end = Math.max(lo, hi);
  if (start === end) return start;
  return Math.round((start + Math.random() * (end - start)) * 100) / 100;
}

function parseReleaseYear(value) {
  const y = parseInt(String(value == null ? "" : value).trim(), 10);
  const current = new Date().getFullYear();
  if (!Number.isFinite(y) || y < 1888 || y > current + 1) return null;
  return y;
}

function autoPriceMultiplierForYear(value) {
  const y = parseReleaseYear(value);
  if (y == null) return 1;
  const age = Math.max(0, new Date().getFullYear() - y);
  if (age >= 60) return 0.8; // classic pricing
  if (age >= 20) return 0.2;
  if (age >= 10) return 0.5;
  if (age >= 5) return 0.8;
  return 1;
}

function autoPriceFromAge(minRaw, maxRaw, yearValue) {
  const base = randomMoneyAmountInRange(minRaw, maxRaw);
  const mult = autoPriceMultiplierForYear(yearValue);
  return Math.round(base * mult * 100) / 100;
}

function normalizeNowShowingCurrencyCode(value) {
  const code = String(value || "").trim().toUpperCase();
  const allowed = new Set(["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "JPY"]);
  if (allowed.has(code)) return code;
  return DEFAULT_SETTINGS.nowShowingCurrencyCode;
}

function currencySymbolForCode(code) {
  const cc = normalizeNowShowingCurrencyCode(code);
  const map = {
    USD: "$",
    EUR: "€",
    GBP: "£",
    CAD: "C$",
    AUD: "A$",
    NZD: "NZ$",
    JPY: "¥",
  };
  return map[cc] || "$";
}

function odCardToNowShowingFiller(card, baseUrl, options) {
  const serverKind = getMediaServerKind(
    loadedSettings && loadedSettings.mediaServerType
  );
  const apiItemId = String((card && card.posterApiItemId) || "").trim();
  const dbMeta =
    apiItemId && serverKind
      ? posterMetadata.getEntryByServerAndApiItemId(serverKind, apiItemId)
      : null;

  const dbLogo = dbMeta && dbMeta.logoCacheFile
    ? "/imagecache/" + dbMeta.logoCacheFile
    : "";
  const dbArt = dbMeta && dbMeta.artCacheFile
    ? "/imagecache/" + dbMeta.artCacheFile
    : "";
  const dbBanner = dbMeta && dbMeta.bannerCacheFile
    ? "/imagecache/" + dbMeta.bannerCacheFile
    : "";
  const dbPoster = dbMeta && dbMeta.cacheFile
    ? "/imagecache/" + dbMeta.cacheFile
    : "";

  const art = String(card.posterArtURL || "").trim();
  const post = String(card.posterURL || "").trim();
  const logoCached = String(card.posterLogoURL || "").trim();
  const bannerSrc = dbBanner || dbArt || dbPoster || art || post;
  const logoSrc = dbLogo || dbPoster || logoCached || post || art;
  const genres = Array.isArray(card.genre)
    ? card.genre.join(", ")
    : String(card.genre || "");
  const runRaw = parseInt(card.runTime, 10);
  const runMins = runRaw > 0 && !isNaN(runRaw) ? runRaw : 120;
  const nFuture = nowShowingShowtimeDisplayCount();
  const nSlots = Math.min(8, nFuture + 2);
  const titleForSeed =
    (dbMeta && dbMeta.title) || card.title || card.tagLine || "Untitled";
  const st = nowShowingFillerShowtimesWithIso(titleForSeed, nSlots, runMins);
  const opt = options && typeof options === "object" ? options : {};
  const autoPriceEnabled = opt.autoPriceEnabled === true;
  const releaseYear =
    (dbMeta && dbMeta.year != null ? String(dbMeta.year) : "") ||
    (card.year != null ? String(card.year) : "");
  const fillerPrice = autoPriceEnabled
    ? autoPriceFromAge(opt.autoPriceMin, opt.autoPriceMax, releaseYear)
    : null;
  return {
    id: null,
    tmdbId: null,
    title: (dbMeta && dbMeta.title) || card.title || card.tagLine || "Untitled",
    year:
      (dbMeta && dbMeta.year != null ? String(dbMeta.year) : "") ||
      (card.year != null ? String(card.year) : ""),
    logoUrl: logoSrc ? nowShowingAssetUrlWithBase(logoSrc, baseUrl) : "",
    bannerUrl: bannerSrc ? nowShowingAssetUrlWithBase(bannerSrc, baseUrl) : "",
    overview: String((dbMeta && dbMeta.summary) || card.summary || "").trim(),
    rating: card.rating || "",
    runtimeMins: runMins,
    contentRating: card.contentRating || "",
    genres,
    showtimeMode: "auto",
    manualTimes: [],
    autoShowings: nFuture,
    autoSeedStart: "",
    priceAmount: fillerPrice,
    priceAutoGenerated: autoPriceEnabled && fillerPrice != null,
    is3D: card && card.is3D === true,
    isCurated: false,
    showtimes: st.showtimes,
    showtimeStartsIso: st.showtimeStartsIso,
  };
}

function nowPlayingNormalizedTitlesFromNsCards() {
  const set = new Set();
  if (!Array.isArray(nsCards)) return set;
  for (const c of nsCards) {
    if (!c) continue;
    const nt = normalizeNowShowingTitle(c.title);
    if (nt) set.add(nt);
  }
  return set;
}

function sampleNowShowingFillersFromOd(cards, curatedTitleSet, maxCount) {
  if (!maxCount || !cards || !cards.length) return [];
  const pool = cards.filter((c) => {
    const mt = String(c.mediaType || "").toLowerCase();
    if (!NOW_SHOWING_OD_TYPES.has(mt)) return false;
    const nt = normalizeNowShowingTitle(
      (c && (c.title || c.tagLine)) || ""
    );
    if (!nt) return false;
    if (curatedTitleSet.has(nt)) return false;
    return true;
  });
  const shuffled = pool.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  const out = [];
  const seen = new Set();
  for (const c of shuffled) {
    const key = `${normalizeNowShowingTitle(
      (c && (c.title || c.tagLine)) || ""
    )}\0${String(c.DBID || c.posterApiItemId || "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
    if (out.length >= maxCount) break;
  }
  return out;
}

app.get(BASEURL + "/now-showing/data", async (req, res) => {
  try {
    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    const nFuture = nowShowingShowtimeDisplayCount();
    const nSlots = nowShowingTotalSlotsForSchedulePayload();
    const autoPriceEnabled =
      loadedSettings &&
      loadedSettings.nowShowingAutoPriceEnabled === "true";
    const autoPriceMin =
      loadedSettings &&
      loadedSettings.nowShowingAutoPriceMin !== undefined
        ? loadedSettings.nowShowingAutoPriceMin
        : DEFAULT_SETTINGS.nowShowingAutoPriceMin;
    const autoPriceMax =
      loadedSettings &&
      loadedSettings.nowShowingAutoPriceMax !== undefined
        ? loadedSettings.nowShowingAutoPriceMax
        : DEFAULT_SETTINGS.nowShowingAutoPriceMax;
    const showPrices =
      loadedSettings && loadedSettings.nowShowingShowPrices === "true";
    const extra3dRaw =
      loadedSettings && loadedSettings.nowShowing3dPriceExtra !== undefined
        ? loadedSettings.nowShowing3dPriceExtra
        : DEFAULT_SETTINGS.nowShowing3dPriceExtra;
    const nowShowing3dPriceExtra = parseMoneyAmount(extra3dRaw) || 0;
    const currencyCode = normalizeNowShowingCurrencyCode(
      loadedSettings && loadedSettings.nowShowingCurrencyCode
    );
    const currencySymbol = currencySymbolForCode(currencyCode);
    const curatedRows = nowShowingDb.listMoviesForScreen({
      showtimeSlotCount: nSlots,
      autoPriceEnabled,
      autoPriceMin,
      autoPriceMax,
    });
    await nowShowingDb.backfillRemoteAssetsToLocalPaths(curatedRows);
    await nowShowingDb.hydrateMissingBannerLogoFromTmdb(
      curatedRows,
      loadedSettings && loadedSettings.tmdbApiKey
    );
    await nowShowingDb.backfillRemoteAssetsToLocalPaths(curatedRows);
    const curated = curatedRows
      .map((r) => ({ ...r, isCurated: true }))
      .filter(nowShowingRowHasBannerAndLogo);
    const curatedSet = new Set(
      curated.map((r) => normalizeNowShowingTitle(r.title))
    );
    let movies = curated.slice();
    const fillOn =
      loadedSettings.nowShowingFillFromServer === "true" &&
      (Number(loadedSettings.nowShowingFillLibraryMax) || 0) > 0;
    if (fillOn) {
      const fillPool = await ensureOdCardsForNowShowingFill();
      const maxN = Math.min(
        48,
        Math.max(0, parseInt(loadedSettings.nowShowingFillLibraryMax, 10) || 0)
      );
      let picked = sampleNowShowingFillersFromOd(fillPool, curatedSet, maxN);
      if (!picked.length && maxN > 0) {
        const kind = getMediaServerKind(loadedSettings.mediaServerType);
        const fb = posterMetadata.buildFallbackMediaCards(
          Math.max(maxN * 2, 24),
          kind
        );
        picked = sampleNowShowingFillersFromOd(fb, curatedSet, maxN);
      }
      movies = curated.concat(
        picked.map((c) =>
          odCardToNowShowingFiller(c, BASEURL, {
            autoPriceEnabled,
            autoPriceMin,
            autoPriceMax,
          })
        )
      );
    }
    movies = movies.filter(nowShowingRowHasBannerAndLogo);
    await ensureNowShowingMoviesImageCacheForResponse(movies, BASEURL);
    let curatedWeight = parseInt(loadedSettings.nowShowingCuratedWeight, 10);
    if (isNaN(curatedWeight))
      curatedWeight = DEFAULT_SETTINGS.nowShowingCuratedWeight;
    curatedWeight = Math.max(1, Math.min(20, curatedWeight));
    const playingSet = nowPlayingNormalizedTitlesFromNsCards();
    const moviesOut = movies.map((m) => {
      const base = sliceNowShowingMovieShowtimesForDisplay(m, nSlots);
      let nextPrice = base.priceAmount;
      let next3dPrice = null;
      if (base.is3D === true && nextPrice != null && nowShowing3dPriceExtra > 0) {
        next3dPrice =
          Math.round((Number(nextPrice) + nowShowing3dPriceExtra) * 100) / 100;
      }
      return {
        ...base,
        priceAmount: nextPrice,
        price3dAmount: next3dPrice,
        isNowPlaying: playingSet.has(normalizeNowShowingTitle(m.title)),
      };
    });
    res.json({
      movies: moviesOut,
      showPrices,
      currencyCode,
      currencySymbol,
      curatedWeight,
      showtimeDisplayCount: nFuture,
      settingsVersion: nowShowingSettingsVersionToken(),
    });
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

app.get(BASEURL + "/ads/data", (req, res) => {
  try {
    res.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    res.set("Pragma", "no-cache");
    res.set("Expires", "0");
    const adsCurrencyCode = normalizeNowShowingCurrencyCode(
      (loadedSettings && loadedSettings.adsCurrencyCode) ||
        DEFAULT_SETTINGS.adsCurrencyCode
    );
    const items = adsDb
      .listAds()
      .filter((ad) => String(ad.mediaPath || "").trim())
      .map((ad) => ({
        id: ad.id,
        title: String(ad.title || "").trim(),
        mediaPath: String(ad.mediaPath || "").trim(),
        backgroundMediaPath: String(ad.backgroundMediaPath || "").trim(),
        addons: Array.isArray(ad.addons)
          ? ad.addons.map((a) => ({
              title: String(a.title || "").trim(),
              amount:
                a.amount !== undefined && a.amount !== null
                  ? Number(a.amount)
                  : null,
            }))
          : [],
        prices: Array.isArray(ad.prices)
          ? ad.prices.map((p) => ({
              title: String(p.title || "").trim(),
              amount:
                p.amount !== undefined && p.amount !== null
                  ? Number(p.amount)
                  : null,
            }))
          : [],
      }));
    const titleOutline =
      loadedSettings && String(loadedSettings.adsTitleOutline).toLowerCase() ===
        "true";
    const rotRaw =
      loadedSettings && loadedSettings.adsRotationSeconds !== undefined
        ? loadedSettings.adsRotationSeconds
        : DEFAULT_SETTINGS.adsRotationSeconds;
    const rotN = parseInt(rotRaw, 10);
    const rotationSeconds = isNaN(rotN)
      ? DEFAULT_SETTINGS.adsRotationSeconds
      : Math.min(600, Math.max(3, rotN));
    const stayRaw =
      loadedSettings && loadedSettings.adsPageStaySeconds !== undefined
        ? loadedSettings.adsPageStaySeconds
        : DEFAULT_SETTINGS.adsPageStaySeconds;
    const stayN = parseInt(stayRaw, 10);
    const pageStaySeconds =
      isNaN(stayN) || stayN <= 0
        ? 0
        : Math.min(86400, Math.max(30, stayN));
    const gRaw =
      loadedSettings && loadedSettings.adsGlobalBackgroundPath != null
        ? String(loadedSettings.adsGlobalBackgroundPath).trim()
        : "";
    const globalBackgroundPath = gRaw.startsWith("/custom/ads-view/")
      ? gRaw
      : "";
    res.json({
      items,
      currencyCode: adsCurrencyCode,
      currencySymbol: currencySymbolForCode(adsCurrencyCode),
      titleOutline,
      rotationSeconds,
      pageStaySeconds,
      globalBackgroundPath,
    });
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

// Used by the web client to check connection status to Posterr, and also to determine if there was a cold start that was missed

app.get(BASEURL + "/conncheck", (req, res) => {
  res.send({ "status": cold_start_time, "sleep": sleep });
});


app.get(BASEURL + "/debug", (req, res) => {
  res.render("debug", { settings: loadedSettings, version: pjson.version, baseUrl: BASEURL });
});

app.get(BASEURL + "/debug/ping", (req, res) => {
  console.log(' ');
  console.log('** PING TESTS **');
  console.log('-------------------------------------------------------');
  let test = new health(loadedSettings);
  test.TestPing();
  res.render("debug", { settings: loadedSettings, version: pjson.version, baseUrl: BASEURL });
});

async function debugMediaServerNs(req, res) {
  const label = getMediaServerShortLabel(
    loadedSettings && loadedSettings.mediaServerType
  );
  console.log(" ");
  console.log("** " + label.toUpperCase() + " 'NOW SCREENING' CHECK **");
  console.log("-------------------------------------------------------");
  const test = new health(loadedSettings);
  await test.PlexNSCheck();
  res.render("debug", {
    settings: loadedSettings,
    version: pjson.version,
    baseUrl: BASEURL,
  });
}

async function debugMediaServerOd(req, res) {
  const label = getMediaServerShortLabel(
    loadedSettings && loadedSettings.mediaServerType
  );
  console.log(" ");
  console.log("** " + label.toUpperCase() + " 'ON-DEMAND' CHECK **");
  console.log("-------------------------------------------------------");
  const test = new health(loadedSettings);
  await test.PlexODCheck();
  res.render("debug", {
    settings: loadedSettings,
    version: pjson.version,
    baseUrl: BASEURL,
  });
}

app.get(BASEURL + "/debug/medians", debugMediaServerNs);
app.get(BASEURL + "/debug/mediaod", debugMediaServerOd);
app.get(BASEURL + "/debug/plexns", debugMediaServerNs);
app.get(BASEURL + "/debug/plexod", debugMediaServerOd);

app.get(BASEURL + "/debug/sonarr", (req, res) => {
  console.log(' ');
  console.log("** SONARR CHECK ** (titles in next 5 days)");
  console.log('-------------------------------------------------------');
  let test = new health(loadedSettings);
  test.SonarrCheck();
  res.render("debug", { settings: loadedSettings, version: pjson.version, baseUrl: BASEURL });
});

app.get(BASEURL + "/debug/radarr", (req, res) => {
  console.log(' ');
  console.log("** RADARR CHECK ** (Any releases in next 30 days)");
  console.log('-------------------------------------------------------');
  let test = new health(loadedSettings);
  test.RadarrCheck();
  res.render("debug", { settings: loadedSettings, version: pjson.version, baseUrl: BASEURL });
});

app.get(BASEURL + "/debug/lidarr", (req, res) => {
  console.log(' ');
  console.log("** LIDARR CHECK ** (Album calendar, next 30 days)");
  console.log('-------------------------------------------------------');
  let test = new health(loadedSettings);
  test.LidarrCheck();
  res.render("debug", { settings: loadedSettings, version: pjson.version, baseUrl: BASEURL });
});

app.get(BASEURL + "/debug/readarr", (req, res) => {
  console.log(' ');
  console.log("** READARR CHECK ** (Any releases in next 90 days)");
  console.log('-------------------------------------------------------');
  let test = new health(loadedSettings);
  test.ReadarrCheck();
  res.render("debug", { settings: loadedSettings, version: pjson.version, baseUrl: BASEURL });
});

app.get(BASEURL + "/debug/trivia", (req, res) => {
  console.log(' ');
  console.log("** Open Trvia DB CHECK ** (Get 5 questions)");
  console.log('-------------------------------------------------------');
  let test = new health(loadedSettings);
  test.TriviaCheck();
  res.render("debug", { settings: loadedSettings, version: pjson.version, baseUrl: BASEURL });
});

// password for settings section
let userData = { valid: false, expires: 10 };

// settings page
app.get(BASEURL + "/logon", (req, res) => {
  res.render("logon", {
    success: req.session.success, baseUrl: BASEURL
  });
  req.session.errors = null;
});


function getDirectories(dirPath) {
  if (!fs.existsSync(dirPath)) return [];
  return fs.readdirSync(dirPath).filter(function (file) {
    return fs.statSync(path.join(dirPath, file)).isDirectory();
  });
}

app.get('/api/sleep', (req, res) => {
  res.send({
    status: sleep
  })
})

app.post(
  BASEURL + "/api/sleep", (req, res) => {
    if(req.body.psw==loadedSettings.password){
      if(req.body.sleep=='true'){
        sleep=true;
        apiSleep=true;
        suspend()
        res.send({
          status: sleep
        })
      }
      else{
        sleep=false;
        apiSleep=false;
        console.log(" ** api/sleep - Wake command issued");
        res.send({
          status: sleep
        })
      }
    }
    else {
      res.send({
        error: 'Incorrect password'
      })
    }
  }
)


app.post(
  BASEURL + "/logon",
  [
    check("password")
      .custom((value) => {
        if (loadedSettings.password !== value) {
          throw new Error("Invalid Password!!");
        }
        userData.valid = true;
        return true;
      })
      .withMessage("Invalid password"),
  ],
  (req, res) => {
    var errors = validationResult(req).array();
    if (errors.length > 0) {
      req.session.errors = errors;
      req.session.success = false;
      res.render("logon", {
        errors: req.session.errors,
        user: { valid: false },
        baseUrl: BASEURL,
        customPicFolders: customPicFolders,
        updateAvailable: updateAvailable
      });
    } else {
      res.render("settings", {
        user: userData,
        success: req.session.success,
        settings: loadedSettings,
        version: pjson.version,
        baseUrl: BASEURL,
        customPicFolders: customPicFolders,
        latestVersion: latestVersion,
        message: message,
        updateAvailable: updateAvailable,
        cacheClearNotice: null,
        ...newFeaturesBannerViewData(),
      });
    }
  }
);

// settings page
app.get(BASEURL + "/settings", (req, res) => {
  // load pic folders
  customPicFolders = getDirectories(CUSTOM_PICTURES_ROOT);

  const cacheClearNotice = req.session.cacheClearNotice || null;
  req.session.cacheClearNotice = null;

  if (loadedSettings.password == undefined) {
    res.render("settings", {
      success: req.session.success,
      user: { valid: true },
      settings: loadedSettings,
      errors: req.session.errors,
      version: pjson.version,
      baseUrl: BASEURL,
      customPicFolders: customPicFolders,
      latestVersion: latestVersion,
      message: message,
      updateAvailable: updateAvailable,
      cacheClearNotice: cacheClearNotice,
      ...newFeaturesBannerViewData(),
    });
  }
  else {
    res.render("settings", {
      success: req.session.success,
      user: { valid: false },
      settings: loadedSettings,
      errors: req.session.errors,
      version: pjson.version,
      baseUrl: BASEURL,
      customPicFolders: customPicFolders,
      latestVersion: latestVersion,
      message: message,
      updateAvailable: updateAvailable,
      cacheClearNotice: cacheClearNotice,
      ...newFeaturesBannerViewData(),
    });
  }
  req.session.errors = null;
});

app.post(BASEURL + "/settings/clear-poster-cache", async (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.redirect(302, BASEURL + "/logon");
  }
  try {
    await posterMetadata.clearPosterCacheAndMetadata();
    posterSyncRetry.clearRetryFile();
    req.session.cacheClearNotice = {
      ok: true,
      text: "Poster image cache and metadata database were cleared.",
    };
  } catch (err) {
    let msg = err && err.message ? err.message : String(err);
    req.session.cacheClearNotice = {
      ok: false,
      text: "Could not clear poster cache: " + msg,
    };
  }
  res.redirect(302, BASEURL + "/settings");
});

app.post(BASEURL + "/settings/new-features-acknowledge", (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.redirect(302, BASEURL + "/logon");
  }
  const ver = String(pjson.version || "").trim();
  const settingsPath = path.join(__dirname, "config", "settings.json");
  try {
    let data = {};
    try {
      if (fs.existsSync(settingsPath)) {
        data = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      } else {
        data = JSON.parse(JSON.stringify(loadedSettings || {}));
      }
    } catch (e) {
      data = JSON.parse(JSON.stringify(loadedSettings || {}));
    }
    data.newFeaturesAcknowledgedVersion = ver;
    fs.writeFileSync(settingsPath, JSON.stringify(data, null, 4), "utf8");
    loadedSettings.newFeaturesAcknowledgedVersion = ver;
    setng.newFeaturesAcknowledgedVersion = ver;
  } catch (e) {
    let d = new Date();
    console.log(
      d.toLocaleString() + " new-features-acknowledge failed: " + (e && e.message ? e.message : e)
    );
  }
  res.redirect(302, BASEURL + "/settings");
});

app.get(BASEURL + "/settings/sync/progress", (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.status(401).json({ error: "unauthorized" });
  }
  const st = posterSyncProgressState;
  const total = Math.max(0, parseInt(st.total, 10) || 0);
  const processed = Math.max(0, parseInt(st.processed, 10) || 0);
  const libs = Array.isArray(st.libraries) ? st.libraries : [];

  function fetchRatioFromLibraries(rows) {
    if (!rows.length) return 0;
    let w = 0;
    for (const r of rows) {
      const fs = r.fetchStatus;
      if (fs === "done" || fs === "skipped") w += 1;
      else if (fs === "loading") w += 0.5;
    }
    return w / rows.length;
  }

  let percent = null;
  let indeterminate =
    st.status === "running" &&
    st.phase === "starting" &&
    total === 0 &&
    libs.length === 0;

  if (st.status === "done") {
    percent = 100;
  } else if (st.status === "error") {
    percent = null;
  } else if (st.status === "running") {
    if (st.phase === "registering") {
      percent = 100;
    } else if (st.phase === "fetching") {
      percent = st.metadataOnlySync
        ? Math.round(10 * fetchRatioFromLibraries(libs))
        : Math.round(50 * fetchRatioFromLibraries(libs));
      if (libs.length === 0) {
        indeterminate = true;
        percent = null;
      }
    } else if (st.phase === "caching" && total > 0) {
      if (st.metadataOnlySync) {
        percent = Math.min(100, Math.round((processed / total) * 100));
      } else {
        percent = Math.min(
          100,
          Math.round(50 + (processed / total) * 50)
        );
      }
    } else if (st.phase === "complete") {
      percent = 100;
    } else if (total > 0) {
      percent = Math.min(100, Math.round((processed / total) * 100));
    } else {
      percent = 0;
    }
  }

  const libraries = libs.map((r) => ({
    name: r.name,
    fetchStatus: r.fetchStatus,
    itemsFound: r.itemsFound != null ? r.itemsFound : 0,
    cacheStatus: r.cacheStatus,
    itemsCached: r.itemsCached != null ? r.itemsCached : 0,
    cacheTotal: r.cacheTotal != null ? r.cacheTotal : 0,
  }));

  res.json({
    status: st.status,
    phase: st.phase,
    label: st.label,
    processed,
    total,
    percent,
    indeterminate,
    error: st.error || null,
    serverKind: st.serverKind || null,
    libraries,
    syncScope: st.syncScope || "all",
    syncSingleLibrary: st.syncSingleLibrary || "",
    metadataOnlySync: st.metadataOnlySync === true,
    runId: st.runId || "",
  });
});

app.get(BASEURL + "/settings/sync", (req, res) => {
  customPicFolders = getDirectories(CUSTOM_PICTURES_ROOT);
  const syncNotice = req.session.syncNotice || null;
  req.session.syncNotice = null;
  res.render("settings-sync", {
    success: req.session.success,
    user:
      loadedSettings.password === undefined ? { valid: true } : userData,
    settings: loadedSettings,
    version: pjson.version,
    baseUrl: BASEURL,
    customPicFolders: customPicFolders,
    latestVersion: latestVersion,
    message: message,
    updateAvailable: updateAvailable,
    syncNotice: syncNotice,
    onDemandLibraryList: getConfiguredOnDemandLibraryNames(
      loadedSettings.onDemandLibraries
    ),
    ...newFeaturesBannerViewData(),
  });
});

app.post(BASEURL + "/settings/sync/trigger", (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.redirect(302, BASEURL + "/logon");
  }
  if (!isMediaServerEnabled) {
    req.session.syncNotice = {
      ok: false,
      text: "Media server is not configured or cannot be reached. Check Settings → Media server.",
    };
    return res.redirect(302, BASEURL + "/settings/sync");
  }
  const libs = loadedSettings.onDemandLibraries;
  if (!libs || !String(libs).trim()) {
    req.session.syncNotice = {
      ok: false,
      text: "Configure on-demand library names in Settings before running a full sync.",
    };
    return res.redirect(302, BASEURL + "/settings/sync");
  }
  if (posterSyncProgressState.status === "running") {
    req.session.syncNotice = {
      ok: false,
      text: "A library sync is already running. Wait for it to finish.",
    };
    return res.redirect(302, BASEURL + "/settings/sync");
  }
  const bodyLib = req.body && req.body.library;
  const modeRaw = req.body && req.body.syncMode;
  const metadataOnly =
    modeRaw != null && String(modeRaw).trim().toLowerCase() === "metadata";
  const wantSingle =
    bodyLib != null && String(bodyLib).trim() !== "";
  let syncOptions = {};
  if (wantSingle) {
    const names = getConfiguredOnDemandLibraryNames(libs);
    const resolved = matchConfiguredLibraryName(bodyLib, names);
    if (!resolved) {
      req.session.syncNotice = {
        ok: false,
        text:
          "That library is not in your configured on-demand list. Check spelling under Settings → Media server.",
      };
      return res.redirect(302, BASEURL + "/settings/sync");
    }
    syncOptions = { singleLibrary: resolved, metadataOnlySync: metadataOnly };
  } else {
    syncOptions = { metadataOnlySync: metadataOnly };
  }
  syncFullPosterLibraryFromMediaServer(syncOptions).catch((err) => {
    const d = new Date();
    console.log(
      d.toLocaleString() +
        " Manual poster sync error: " +
        (err && err.message ? err.message : err)
    );
  });
  res.redirect(302, BASEURL + "/settings/sync");
});

app.post(BASEURL + "/settings/sync/abort", (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.redirect(302, BASEURL + "/logon");
  }
  if (posterSyncProgressState.status === "running") {
    posterSyncAbortRequested = true;
  }
  res.redirect(302, BASEURL + "/settings/sync");
});

app.post(BASEURL + "/settings/sync/clear-cache", async (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.redirect(302, BASEURL + "/logon");
  }
  if (posterSyncProgressState.status === "running") {
    req.session.syncNotice = {
      ok: false,
      text: "Cannot clear sync cache while a library sync is running. Abort or wait for completion first.",
    };
    return res.redirect(302, BASEURL + "/settings/sync");
  }
  try {
    await posterMetadata.clearPosterCacheAndMetadata();
    posterSyncRetry.clearRetryFile();
    req.session.syncNotice = {
      ok: true,
      text: "Sync cache cleared: removed cached files and reset the poster metadata database.",
    };
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    req.session.syncNotice = {
      ok: false,
      text: "Could not clear sync cache: " + msg,
    };
  }
  return res.redirect(302, BASEURL + "/settings/sync");
});

app.get(BASEURL + "/settings/cache/stats", (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    res.json(posterMetadata.getCacheDashboardStats());
  } catch (e) {
    res
      .status(500)
      .json({ error: e && e.message ? e.message : String(e) });
  }
});

app.get(BASEURL + "/settings/cache", (req, res) => {
  customPicFolders = getDirectories(CUSTOM_PICTURES_ROOT);
  res.render("settings-cache", {
    success: req.session.success,
    user:
      loadedSettings.password === undefined ? { valid: true } : userData,
    settings: loadedSettings,
    version: pjson.version,
    baseUrl: BASEURL,
    customPicFolders: customPicFolders,
    latestVersion: latestVersion,
    message: message,
    updateAvailable: updateAvailable,
    ...newFeaturesBannerViewData(),
  });
});

app.get(BASEURL + "/settings/now-showing-slides", (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.redirect(302, BASEURL + "/logon");
  }
  return res.redirect(302, BASEURL + "/settings/now-showing");
});

app.get(BASEURL + "/settings/now-showing", (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.redirect(302, BASEURL + "/logon");
  }
  customPicFolders = getDirectories(CUSTOM_PICTURES_ROOT);
  const notice = req.session.nowShowingNotice || null;
  req.session.nowShowingNotice = null;
  res.render("settings-now-showing", {
    success: req.session.success,
    user:
      loadedSettings.password === undefined ? { valid: true } : userData,
    settings: loadedSettings,
    version: pjson.version,
    baseUrl: BASEURL,
    customPicFolders: customPicFolders,
    latestVersion: latestVersion,
    message: message,
    updateAvailable: updateAvailable,
    notice: notice,
    ...newFeaturesBannerViewData(),
  });
});

app.get(BASEURL + "/settings/ads", (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.redirect(302, BASEURL + "/logon");
  }
  customPicFolders = getDirectories(CUSTOM_PICTURES_ROOT);
  const notice = req.session.adsNotice || null;
  req.session.adsNotice = null;
  let adsItems = [];
  try {
    adsItems = adsDb.listAds();
  } catch (e) {
    adsItems = [];
  }
  const adsCurrencyCode = normalizeNowShowingCurrencyCode(
    loadedSettings.adsCurrencyCode || DEFAULT_SETTINGS.adsCurrencyCode
  );
  const adsCurrencySymbol = currencySymbolForCode(adsCurrencyCode);
  res.render("settings-ads", {
    success: req.session.success,
    user:
      loadedSettings.password === undefined ? { valid: true } : userData,
    settings: loadedSettings,
    version: pjson.version,
    baseUrl: BASEURL,
    customPicFolders: customPicFolders,
    latestVersion: latestVersion,
    message: message,
    updateAvailable: updateAvailable,
    notice: notice,
    adsItems,
    adsCurrencyCode,
    adsCurrencySymbol,
    ...newFeaturesBannerViewData(),
  });
});

app.post(BASEURL + "/settings/ads", async (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.redirect(302, BASEURL + "/logon");
  }
  function bodyScalar(body, name) {
    if (!body || body[name] === undefined || body[name] === null) {
      return undefined;
    }
    const v = body[name];
    if (Array.isArray(v)) {
      return v.length ? v[v.length - 1] : undefined;
    }
    return v;
  }
  try {
    loadedSettings.enableAds = req.body.enableAds ? "true" : "false";
    loadedSettings.adsOnly = req.body.adsOnly ? "true" : "false";
    loadedSettings.adsTitleOutline = req.body.adsTitleOutline
      ? "true"
      : "false";
    const adsEveryRaw = bodyScalar(req.body, "adsEveryPosters");
    const adsEvery = parseInt(String(adsEveryRaw ?? "").trim(), 10);
    loadedSettings.adsEveryPosters = isNaN(adsEvery) ? 0 : Math.max(0, adsEvery);
    loadedSettings.adsCurrencyCode = normalizeNowShowingCurrencyCode(
      bodyScalar(req.body, "adsCurrencyCode")
    );
    const rotRaw = bodyScalar(req.body, "adsRotationSeconds");
    const rotAds = parseInt(String(rotRaw ?? "").trim(), 10);
    loadedSettings.adsRotationSeconds = isNaN(rotAds)
      ? DEFAULT_SETTINGS.adsRotationSeconds
      : Math.min(600, Math.max(3, rotAds));
    const stayRaw = bodyScalar(req.body, "adsPageStaySeconds");
    const stayAds = parseInt(String(stayRaw ?? "").trim(), 10);
    loadedSettings.adsPageStaySeconds =
      stayRaw === undefined ||
      stayRaw === null ||
      String(stayRaw).trim() === "" ||
      isNaN(stayAds) ||
      stayAds <= 0
        ? 0
        : Math.min(86400, Math.max(30, stayAds));
    await setng.UpdateSettings(loadedSettings);
    req.session.adsNotice = { ok: true, text: "ADS settings saved." };
  } catch (e) {
    req.session.adsNotice = {
      ok: false,
      text: "Could not save ADS settings: " + (e && e.message ? e.message : e),
    };
  }
  return res.redirect(302, BASEURL + "/settings/ads");
});

app.post(
  BASEURL + "/settings/ads/global-background",
  adsViewBgUpload.single("adsGlobalBgFile"),
  async (req, res) => {
    if (loadedSettings.password !== undefined && !userData.valid) {
      return res.redirect(302, BASEURL + "/logon");
    }
    try {
      if (!req.file || !req.file.buffer) {
        req.session.adsNotice = {
          ok: false,
          text: "Choose an image file for the dedicated Ads page background.",
        };
        return res.redirect(302, BASEURL + "/settings/ads");
      }
      const ext = path
        .extname(String(req.file.originalname || ""))
        .toLowerCase();
      if (![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) {
        req.session.adsNotice = {
          ok: false,
          text: "Only JPG, PNG, GIF, and WEBP files are supported.",
        };
        return res.redirect(302, BASEURL + "/settings/ads");
      }
      fs.mkdirSync(ADS_VIEW_BG_ROOT, { recursive: true });
      unlinkAdsGlobalBackgroundFileIfSafe(loadedSettings.adsGlobalBackgroundPath);
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const fileName = `bg-${unique}${ext}`;
      const diskPath = path.resolve(ADS_VIEW_BG_ROOT, fileName);
      if (!diskPath.startsWith(path.resolve(ADS_VIEW_BG_ROOT))) {
        throw new Error("Invalid ads-view path");
      }
      await fs.promises.writeFile(diskPath, req.file.buffer);
      loadedSettings.adsGlobalBackgroundPath = `/custom/ads-view/${fileName}`;
      await setng.UpdateSettings(loadedSettings);
      req.session.adsNotice = {
        ok: true,
        text: "Dedicated Ads page background updated.",
      };
    } catch (e) {
      req.session.adsNotice = {
        ok: false,
        text:
          "Could not save Ads page background: " +
          (e && e.message ? e.message : e),
      };
    }
    return res.redirect(302, BASEURL + "/settings/ads");
  }
);

app.post(BASEURL + "/settings/ads/global-background/clear", async (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.redirect(302, BASEURL + "/logon");
  }
  try {
    unlinkAdsGlobalBackgroundFileIfSafe(loadedSettings.adsGlobalBackgroundPath);
    loadedSettings.adsGlobalBackgroundPath = "";
    await setng.UpdateSettings(loadedSettings);
    req.session.adsNotice = {
      ok: true,
      text: "Dedicated Ads page background removed.",
    };
  } catch (e) {
    req.session.adsNotice = {
      ok: false,
      text:
        "Could not clear Ads page background: " +
        (e && e.message ? e.message : e),
    };
  }
  return res.redirect(302, BASEURL + "/settings/ads");
});

app.get(BASEURL + "/settings/ads/list", (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const adsCurrencyCode = normalizeNowShowingCurrencyCode(
      loadedSettings.adsCurrencyCode || DEFAULT_SETTINGS.adsCurrencyCode
    );
    const titleOutline =
      loadedSettings && String(loadedSettings.adsTitleOutline).toLowerCase() ===
        "true";
    const listRotRaw =
      loadedSettings && loadedSettings.adsRotationSeconds !== undefined
        ? loadedSettings.adsRotationSeconds
        : DEFAULT_SETTINGS.adsRotationSeconds;
    const listRotN = parseInt(listRotRaw, 10);
    const rotationSeconds = isNaN(listRotN)
      ? DEFAULT_SETTINGS.adsRotationSeconds
      : Math.min(600, Math.max(3, listRotN));
    res.json({
      items: adsDb.listAds(),
      adsCurrencyCode,
      adsCurrencySymbol: currencySymbolForCode(adsCurrencyCode),
      titleOutline,
      rotationSeconds,
    });
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

app.post(
  BASEURL + "/settings/ads/item",
  adsMediaUploadAny,
  async (req, res) => {
    if (loadedSettings.password !== undefined && !userData.valid) {
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      validateAdsUploadFields(req);
      const mainFile = firstUploadedFile(req, "adMediaFile");
      if (!mainFile) throw new Error("Select an ad image to upload");
      const ext = path.extname(String(mainFile.originalname || "")).toLowerCase();
      if (![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) {
        throw new Error("Only JPG, PNG, GIF, and WEBP files are supported");
      }
      const title = String((req.body && req.body.title) || "").trim();
      const nameBase = sanitizeUploadBaseName(
        title || path.parse(String(mainFile.originalname || "")).name
      );
      if (!nameBase) throw new Error("Ad title or filename is invalid");
      fs.mkdirSync(ADS_MEDIA_ROOT, { recursive: true });
      const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const fileName = `${nameBase}-${unique}${ext}`;
      const diskPath = path.resolve(ADS_MEDIA_ROOT, fileName);
      if (!diskPath.startsWith(ADS_MEDIA_ROOT)) throw new Error("Invalid ad path");
      await fs.promises.writeFile(diskPath, mainFile.buffer);
      const mediaPath = `/custom/ads/${fileName}`;
      let backgroundMediaPath = "";
      const bgFile = firstUploadedFile(req, "adBackgroundFile");
      if (bgFile) {
        const bgExt = path.extname(String(bgFile.originalname || "")).toLowerCase();
        if (![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(bgExt)) {
          throw new Error("Background must be JPG, PNG, GIF, or WEBP");
        }
        const bgBase = sanitizeUploadBaseName(
          "bg-" + (title || path.parse(String(bgFile.originalname || "")).name)
        );
        const bgFileName = `${bgBase}-${unique}${bgExt}`;
        const bgDiskPath = path.resolve(ADS_MEDIA_ROOT, bgFileName);
        if (!bgDiskPath.startsWith(ADS_MEDIA_ROOT)) throw new Error("Invalid ad background path");
        await fs.promises.writeFile(bgDiskPath, bgFile.buffer);
        backgroundMediaPath = `/custom/ads/${bgFileName}`;
      }
      const adId = adsDb.createAd({
        title: title || nameBase,
        mediaPath,
        enabled: true,
      });
      if (backgroundMediaPath) {
        adsDb.updateAd(adId, { backgroundMediaPath });
      }
      const prices = parseAdPriceLinesJson(req.body && req.body.pricesJson);
      adsDb.replaceAdPrices(adId, prices);
      const addons = parseAdAddonLinesJson(req.body && req.body.addonsJson);
      adsDb.replaceAdAddons(adId, addons);
      res.json({ ok: true, item: adsDb.getAdById(adId) });
    } catch (e) {
      res.status(400).json({ error: e && e.message ? e.message : String(e) });
    }
  }
);

app.post(
  BASEURL + "/settings/ads/item/:id",
  adsMediaUploadAny,
  async (req, res) => {
    if (loadedSettings.password !== undefined && !userData.valid) {
      return res.status(401).json({ error: "unauthorized" });
    }
    try {
      validateAdsUploadFields(req);
      const id = parseInt(req.params.id, 10);
      if (!id) throw new Error("Invalid ad id");
      const current = adsDb.getAdById(id);
      if (!current) throw new Error("Ad not found");
      let mediaPath = current.mediaPath;
      let backgroundMediaPath = current.backgroundMediaPath;
      const mainFile = firstUploadedFile(req, "adMediaFile");
      if (mainFile) {
        const ext = path.extname(String(mainFile.originalname || "")).toLowerCase();
        if (![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) {
          throw new Error("Only JPG, PNG, GIF, and WEBP files are supported");
        }
        const title = String((req.body && req.body.title) || current.title || "").trim();
        const nameBase = sanitizeUploadBaseName(
          title || path.parse(String(mainFile.originalname || "")).name
        );
        if (!nameBase) throw new Error("Ad title or filename is invalid");
        fs.mkdirSync(ADS_MEDIA_ROOT, { recursive: true });
        const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const fileName = `${nameBase}-${unique}${ext}`;
        const diskPath = path.resolve(ADS_MEDIA_ROOT, fileName);
        if (!diskPath.startsWith(ADS_MEDIA_ROOT)) throw new Error("Invalid ad path");
        await fs.promises.writeFile(diskPath, mainFile.buffer);
        mediaPath = `/custom/ads/${fileName}`;
      }
      const bgFile = firstUploadedFile(req, "adBackgroundFile");
      const title = String((req.body && req.body.title) || "").trim();
      if (bgFile) {
        const bgExt = path.extname(String(bgFile.originalname || "")).toLowerCase();
        if (![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(bgExt)) {
          throw new Error("Background must be JPG, PNG, GIF, or WEBP");
        }
        const bgBase = sanitizeUploadBaseName(
          "bg-" + (title || current.title || path.parse(String(bgFile.originalname || "")).name)
        );
        const uniqueBg = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const bgFileName = `${bgBase}-${uniqueBg}${bgExt}`;
        const bgDiskPath = path.resolve(ADS_MEDIA_ROOT, bgFileName);
        if (!bgDiskPath.startsWith(ADS_MEDIA_ROOT)) throw new Error("Invalid ad background path");
        await fs.promises.writeFile(bgDiskPath, bgFile.buffer);
        backgroundMediaPath = `/custom/ads/${bgFileName}`;
      }
      adsDb.updateAd(id, {
        title,
        mediaPath,
        backgroundMediaPath,
        enabled: true,
      });
      const prices = parseAdPriceLinesJson(req.body && req.body.pricesJson);
      adsDb.replaceAdPrices(id, prices);
      const addons = parseAdAddonLinesJson(req.body && req.body.addonsJson);
      adsDb.replaceAdAddons(id, addons);
      res.json({ ok: true, item: adsDb.getAdById(id) });
    } catch (e) {
      res.status(400).json({ error: e && e.message ? e.message : String(e) });
    }
  }
);

app.post(BASEURL + "/settings/ads/item/:id/delete", (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const id = parseInt(req.params.id, 10);
    if (!id) throw new Error("Invalid ad id");
    adsDb.deleteAd(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e && e.message ? e.message : String(e) });
  }
});

app.get(BASEURL + "/settings/now-showing/list", (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    res.json({ movies: nowShowingDb.listMoviesForSettings() });
  } catch (e) {
    res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
});

app.get(BASEURL + "/settings/now-showing/search", async (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const q = req.query && req.query.q;
    const results = await nowShowingDb.searchTmdbMovies(
      q,
      loadedSettings && loadedSettings.tmdbApiKey
    );
    res.json({ results });
  } catch (e) {
    res.status(400).json({ error: e && e.message ? e.message : String(e) });
  }
});

app.post(BASEURL + "/settings/now-showing/add", async (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const manualTimes = String(req.body.manualTimes || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6);
    await nowShowingDb.upsertMovieFromTmdb(
      req.body.tmdbId,
      {
        showtimeMode: req.body.showtimeMode === "manual" ? "manual" : "auto",
        autoShowings: req.body.autoShowings,
        manualTimes: manualTimes,
        priceAmount: req.body.priceAmount,
        priceAutoGenerated: false,
      },
      loadedSettings && loadedSettings.tmdbApiKey
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e && e.message ? e.message : String(e) });
  }
});

app.get(BASEURL + "/settings/tmdb-api", (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.redirect(302, BASEURL + "/logon");
  }
  customPicFolders = getDirectories(CUSTOM_PICTURES_ROOT);
  res.render("settings-tmdb", {
    success: req.session.success,
    user:
      loadedSettings.password === undefined ? { valid: true } : userData,
    settings: loadedSettings,
    version: pjson.version,
    baseUrl: BASEURL,
    customPicFolders: customPicFolders,
    latestVersion: latestVersion,
    message: message,
    updateAvailable: updateAvailable,
    notice: req.session.tmdbNotice || null,
    ...newFeaturesBannerViewData(),
  });
  req.session.tmdbNotice = null;
});

app.post(BASEURL + "/settings/tmdb-api", async (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.redirect(302, BASEURL + "/logon");
  }
  try {
    loadedSettings.tmdbApiKey = String(req.body.tmdbApiKey || "").trim();
    await setng.UpdateSettings(loadedSettings);
    req.session.tmdbNotice = { ok: true, text: "TMDB API key saved." };
  } catch (e) {
    req.session.tmdbNotice = {
      ok: false,
      text: "Could not save TMDB API key: " + (e && e.message ? e.message : e),
    };
  }
  return res.redirect(302, BASEURL + "/settings/tmdb-api");
});

app.post(BASEURL + "/settings/now-showing/update/:id", (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const manualTimes = String(req.body.manualTimes || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 6);
    nowShowingDb.updateMovieConfig(req.params.id, {
      showtimeMode: req.body.showtimeMode === "manual" ? "manual" : "auto",
      autoShowings: req.body.autoShowings,
      manualTimes: manualTimes,
      priceAmount: req.body.priceAmount,
      priceAutoGenerated: false,
    });
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e && e.message ? e.message : String(e) });
  }
});

app.post(BASEURL + "/settings/now-showing/delete/:id", (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    nowShowingDb.deleteMovie(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e && e.message ? e.message : String(e) });
  }
});

app.post(BASEURL + "/settings/now-showing/screen", async (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.redirect(302, BASEURL + "/logon");
  }
  try {
    const listInPosterRaw = req.body.enableNowShowingListInPoster;
    loadedSettings.enableNowShowingListInPoster =
      listInPosterRaw === "on" ||
      listInPosterRaw === "true" ||
      listInPosterRaw === true ||
      listInPosterRaw === 1 ||
      listInPosterRaw === "1"
        ? "true"
        : "false";
    const listOnlyRaw = req.body.nowShowingListOnly;
    loadedSettings.nowShowingListOnly =
      listOnlyRaw === "on" ||
      listOnlyRaw === "true" ||
      listOnlyRaw === true ||
      listOnlyRaw === 1 ||
      listOnlyRaw === "1"
        ? "true"
        : "false";
    const fillRaw = req.body.nowShowingFillFromServer;
    loadedSettings.nowShowingFillFromServer =
      fillRaw === "on" || fillRaw === "true" || fillRaw === true || fillRaw === 1 || fillRaw === "1"
        ? "true"
        : "false";
    const maxN = parseInt(req.body.nowShowingFillLibraryMax, 10);
    loadedSettings.nowShowingFillLibraryMax = isNaN(maxN)
      ? DEFAULT_SETTINGS.nowShowingFillLibraryMax
      : Math.max(0, Math.min(48, maxN));
    const w = parseInt(req.body.nowShowingCuratedWeight, 10);
    loadedSettings.nowShowingCuratedWeight = isNaN(w)
      ? DEFAULT_SETTINGS.nowShowingCuratedWeight
      : Math.max(1, Math.min(20, w));
    const stc = parseInt(req.body.nowShowingShowtimeCount, 10);
    loadedSettings.nowShowingShowtimeCount = isNaN(stc)
      ? DEFAULT_SETTINGS.nowShowingShowtimeCount
      : Math.max(1, Math.min(6, stc));
    const showPricesRaw = req.body.nowShowingShowPrices;
    loadedSettings.nowShowingShowPrices =
      showPricesRaw === "on" ||
      showPricesRaw === "true" ||
      showPricesRaw === true ||
      showPricesRaw === 1 ||
      showPricesRaw === "1"
        ? "true"
        : "false";
    const autoPriceRaw = req.body.nowShowingAutoPriceEnabled;
    loadedSettings.nowShowingAutoPriceEnabled =
      autoPriceRaw === "on" ||
      autoPriceRaw === "true" ||
      autoPriceRaw === true ||
      autoPriceRaw === 1 ||
      autoPriceRaw === "1"
        ? "true"
        : "false";
    const pMin = parseMoneyAmount(req.body.nowShowingAutoPriceMin);
    const pMax = parseMoneyAmount(req.body.nowShowingAutoPriceMax);
    const p3dExtra = parseMoneyAmount(req.body.nowShowing3dPriceExtra);
    loadedSettings.nowShowingAutoPriceMin =
      pMin == null ? DEFAULT_SETTINGS.nowShowingAutoPriceMin : pMin;
    loadedSettings.nowShowingAutoPriceMax =
      pMax == null ? DEFAULT_SETTINGS.nowShowingAutoPriceMax : pMax;
    loadedSettings.nowShowing3dPriceExtra =
      p3dExtra == null ? DEFAULT_SETTINGS.nowShowing3dPriceExtra : p3dExtra;
    loadedSettings.nowShowingCurrencyCode = normalizeNowShowingCurrencyCode(
      req.body.nowShowingCurrencyCode
    );
    const cycleOnRaw = req.body.enableNowShowingPageCycle;
    loadedSettings.enableNowShowingPageCycle =
      cycleOnRaw === "on" ||
      cycleOnRaw === "true" ||
      cycleOnRaw === true ||
      cycleOnRaw === 1 ||
      cycleOnRaw === "1"
        ? "true"
        : "false";
    const every = parseInt(req.body.nowShowingPageCycleEveryMins, 10);
    loadedSettings.nowShowingPageCycleEveryMins = isNaN(every)
      ? DEFAULT_SETTINGS.nowShowingPageCycleEveryMins
      : Math.max(1, Math.min(1440, every));
    const stay = parseInt(req.body.nowShowingPageCycleStayMins, 10);
    loadedSettings.nowShowingPageCycleStayMins = isNaN(stay)
      ? DEFAULT_SETTINGS.nowShowingPageCycleStayMins
      : Math.max(1, Math.min(120, stay));
    const dedicatedRaw = String(req.body.homePageCycleDedicatedView || "").trim();
    loadedSettings.homePageCycleDedicatedView =
      dedicatedRaw === "ads" ? "ads" : "now-showing";
    await setng.UpdateSettings(loadedSettings);
    req.session.nowShowingNotice = {
      ok: true,
      text: "Now Showing options saved (home poster and dedicated screen).",
    };
  } catch (e) {
    req.session.nowShowingNotice = {
      ok: false,
      text:
        "Could not save screen options: " +
        (e && e.message ? e.message : String(e)),
    };
  }
  return res.redirect(302, BASEURL + "/settings/now-showing");
});

app.post(BASEURL + "/settings/now-showing/regenerate-showtimes", (req, res) => {
  if (loadedSettings.password !== undefined && !userData.valid) {
    return res.redirect(302, BASEURL + "/logon");
  }
  try {
    nowShowingDb.regenerateAllAutoShowtimes();
    req.session.nowShowingNotice = {
      ok: true,
      text: "Auto showtime schedules cleared. The next visit to /now-showing will rebuild today’s grid from local midnight.",
    };
  } catch (e) {
    req.session.nowShowingNotice = {
      ok: false,
      text:
        "Could not regenerate showtimes: " +
        (e && e.message ? e.message : String(e)),
    };
  }
  return res.redirect(302, BASEURL + "/settings/now-showing");
});

app.post(
  BASEURL + "/settings/custom-pictures/upload",
  customPicturesUpload.single("customPictureUpload"),
  async (req, res) => {
    if (loadedSettings.password !== undefined && !userData.valid) {
      return res.redirect(302, BASEURL + "/logon");
    }
    try {
      if (!req.file) {
        throw new Error("Choose an image file to upload");
      }
      const originalName = String(req.file.originalname || "").trim();
      const ext = path.extname(originalName).toLowerCase();
      if (![".jpg", ".jpeg", ".png", ".gif", ".webp"].includes(ext)) {
        throw new Error("Only JPG, PNG, GIF, and WEBP files are supported");
      }
      const parsedName = path.parse(originalName);
      const safeBaseName = String(parsedName.name || "")
        .replace(/[^\w.\- ]/g, "")
        .trim();
      if (!safeBaseName) {
        throw new Error("Upload filename is invalid");
      }

      const { fullPath } = resolveCustomPicturesTargetDirectory(
        req.body.customPictureTheme,
        req.body.customPictureNewFolder
      );
      fs.mkdirSync(fullPath, { recursive: true });
      const finalPath = path.resolve(fullPath, safeBaseName + ext);
      if (!finalPath.startsWith(fullPath)) {
        throw new Error("Invalid upload target");
      }
      await fs.promises.writeFile(finalPath, req.file.buffer);
      customPicFolders = getDirectories(CUSTOM_PICTURES_ROOT);
      req.session.success = true;
      req.session.errors = [];
    } catch (e) {
      req.session.success = false;
      req.session.errors = [
        { msg: e && e.message ? e.message : "Could not upload picture" },
      ];
    }
    return res.redirect(302, BASEURL + "/settings");
  }
);

app.post(
  BASEURL + "/settings",
  [
    //check("password").not().isEmpty().withMessage("Password cannot be blank"),
    check("slideDuration")
      .not()
      .isEmpty()
      .withMessage("'Slide Duration' cannot be blank. (setting default)")
      .custom((value) => {
        if (isNaN(parseInt(value))) {
          throw new Error("'Slide duration' must be a number");
        }
        if (parseInt(value) < 5) {
          throw new Error("'Slide duration' cannot be less than 5 seconds");
        }
        // Indicates the success of this synchronous custom validator
        return true;
      })
      .withMessage("'Slide Duration' is required and must be 5 or more"),
    check("plexIP").not().isEmpty().withMessage("'Media server address' is required"),
    check("plexPort")
      .not()
      .isEmpty()
      .withMessage("'Media server port' is required. (setting default)")
      .custom((value) => {
        if (parseInt(value) === "NaN") {
          throw new Error("'Media server port' must be a number");
        }
        // Indicates the success of this synchronous custom validator
        return true;
      }),
    check("onDemandRefresh")
      .not()
      .isEmpty()
      .withMessage("'On-demand refresh period' cannot be blank. (setting default)")
      .custom((value) => {
        if (isNaN(parseInt(value))) {
          throw new Error("'On-demand refresh period' must be a number (setting default)");
        }
        if (parseInt(value) < 10) {
          throw new Error("'On-demand refresh period' must be 10 or more");
        }
        // Indicates the success of this synchronous custom validator
        return true;
      })
      .withMessage("'On-demand refresh period' cannot be less than 10 minutes"),
    check("numberOnDemand")
      .not()
      .isEmpty()
      .withMessage("'Number to Display' must be 0 or more. (setting default)")
      .custom((value, { req }) => {
        if (value !== undefined && value !== "" && parseInt(value) !== "NaN") {
          // make sure there are limited slides requested
          let numOfLibraries = 0;
          let themeMessage;

          // double the slide count if tv and movie themes are off
          let maxSlides = MAX_OD_SLIDES;

          if (req.body.themeSwitch == undefined && req.body.genericSwitch == undefined) {
            maxSlides = maxSlides * 2;
            themeMessage = "";
          }
          else {
            maxSlide = MAX_OD_SLIDES;
            themeMessage = "(when themes enabled)";
          }

          if (req.body.plexLibraries !== undefined || req.body.plexLibraries !== "") {
            numberOfLibraries = req.body.plexLibraries.split(",").length;
            if (parseInt(value) * numberOfLibraries > maxSlides) {
              let estimatedNumber = parseInt(maxSlides / numberOfLibraries);
              throw new Error("'Number to Display' cannot be more than '" + estimatedNumber + "' for '" + numberOfLibraries + "' libraries " + themeMessage);
            }
          }
        }
        // Indicates the success of this synchronous custom validator
        return true;
      }),
    check("plexToken").custom((value, { req }) => {
      if (!requiresMediaServerCredential(req.body.mediaServerType || "plex")) {
        return true;
      }
      if (value === undefined || value === null || String(value).trim() === "") {
        throw new Error("'Media server token / API key' is required");
      }
      return true;
    }),
    check("enableSleep")
      .custom((value, { req }) => {
        if(value == "true"){
          if(req.body.sleepStart.length == 0) throw new Error("You must specify sleep start and end times if the sleep timer is enabled");
        }
        if(value == "true"){
          if(req.body.sleepEnd.length == 0) throw new Error("You must specify sleep start and end times if the sleep timer is enabled");
        }
        return true;
      }),
    check("sleepStart")
      .custom((value, { req }) => {
        if(isNaN(Date.parse("2100-01-01T" + value)) == true && value.length !== 0) throw new Error("Sleep start time must be in 24 hour format hh:mm (eg. 07:15 or 23:30)");
        return true;
      }),
    check("sleepEnd")
      .custom((value, { req }) => {
        if(isNaN(Date.parse("2100-01-01T" + value)) == true && value.length !== 0) throw new Error("Sleep end time must be in 24 hour format hh:mm (eg. 07:15 or 23:30)");
        return true;
      }),
    check("sonarrUrl")
      .custom((value, { req }) => {
        const url = value == null ? "" : String(value);
        if (url.endsWith("/") === true && url.length !== 0) {
          throw new Error("Sonarr URL cannot have a trailing slash");
        }
        return true;
      }),
      check("radarrUrl")
        .custom((value, { req }) => {
          const url = value == null ? "" : String(value);
          if (url.endsWith("/") === true && url.length !== 0) {
            throw new Error("Radarr URL cannot have a trailing slash");
          }
          return true;
        }),
      check("lidarrUrl")
        .custom((value, { req }) => {
          const url = value == null ? "" : String(value);
          if (url.endsWith("/") === true && url.length !== 0) {
            throw new Error("Lidarr URL cannot have a trailing slash");
          }
          return true;
        }),
      check("readarrUrl")
        .custom((value, { req }) => {
          const url = value == null ? "" : String(value);
          if (url.endsWith("/") === true && url.length !== 0) {
            throw new Error("Readarr/Chaptarr URL cannot have a trailing slash");
          }
          return true;
        })        
  ],
  (req, res) => {
    //fields value holder. Also sets default values in form passed without them.
    let form = {
      password: req.body.password,
      slideDuration: req.body.slideDuration ? parseInt(req.body.slideDuration) : DEFAULT_SETTINGS.slideDuration,
      artSwitch: req.body.artSwitch,
      themeSwitch: req.body.themeSwitch,
      genericSwitch: req.body.genericSwitch,
      fadeOption: req.body.fadeOption,
      shuffleSwitch: req.body.shuffleSwitch,
      hideSettingsLinks: req.body.hideSettingsLinks,
      theaterRoomMode: req.body.theaterRoomMode,
      mediaServerType: req.body.mediaServerType || "plex",
      plexToken:
        req.body.plexToken !== undefined && req.body.plexToken !== null
          ? req.body.plexToken
          : "",
      plexIP: req.body.plexIP,
      plexHTTPSSwitch: req.body.plexHTTPSSwitch,
      plexPort: req.body.plexPort ? parseInt(req.body.plexPort) : DEFAULT_SETTINGS.plexPort,
      plexLibraries: req.body.plexLibraries,
      onDemand3dLibraries: req.body.onDemand3dLibraries,
      pinNSSwitch: req.body.pinNSSwitch,
      hideUser: req.body.hideUser,
      numberOnDemand: !isNaN(parseInt(req.body.numberOnDemand)) ? parseInt(req.body.numberOnDemand) : DEFAULT_SETTINGS.numberOnDemand,
      recentlyAddedDays: !isNaN(parseInt(req.body.recentlyAddedDays)) ? parseInt(req.body.recentlyAddedDays) : DEFAULT_SETTINGS.recentlyAddedDays, 
      recentlyAdded: req.body.recentlyAdded,
      contentRatings: req.body.contentRatings,
      onDemandRefresh: parseInt(req.body.onDemandRefresh) ? parseInt(req.body.onDemandRefresh) : DEFAULT_SETTINGS.onDemandRefresh,
      genres: req.body.genres,
      sonarrUrl: req.body.sonarrUrl,
      sonarrToken: req.body.sonarrToken,
      sonarrDays: req.body.sonarrDays ? parseInt(req.body.sonarrDays) : DEFAULT_SETTINGS.sonarrCalDays,
      premiereSwitch: req.body.premiereSwitch ? "true" : "false",
      radarrUrl: req.body.radarrUrl,
      radarrToken: req.body.radarrToken,
      radarrDays: req.body.radarrDays ? parseInt(req.body.radarrDays) : DEFAULT_SETTINGS.radarrCalDays,
      lidarrUrl: req.body.lidarrUrl,
      lidarrToken: req.body.lidarrToken,
      lidarrDays: req.body.lidarrDays ? parseInt(req.body.lidarrDays) : DEFAULT_SETTINGS.lidarrCalDays,
      readarrUrl: req.body.readarrUrl,
      readarrToken: req.body.readarrToken,
      readarrDays: req.body.readarrDays ? parseInt(req.body.readarrDays) : DEFAULT_SETTINGS.readarrCalDays,
      bookArrKind:
        req.body.bookArrKind === "chaptarr" ? "chaptarr" : "readarr",
      titleFont: req.body.titleFont,
      nowScreening: req.body.nowScreening,
      comingSoon: req.body.comingSoon,
      onDemand: req.body.onDemand,
      playing: req.body.playing,
      iframe: req.body.iframe,
      trivia: req.body.trivia,
      picture: req.body.picture,
      ebook: req.body.ebook,
      titleColour: req.body.titleColour ? req.body.titleColour : DEFAULT_SETTINGS.titleColour,
      footColour: req.body.footColour ? req.body.footColour : DEFAULT_SETTINGS.footColour,
      bgColour: req.body.bgColour ? req.body.bgColour : DEFAULT_SETTINGS.bgColour,
      enableNS: req.body.enableNS,
      nowPlayingEveryPosters: (() => {
        const raw = req.body.nowPlayingEveryPosters;
        if (raw === undefined || raw === null || raw === "") return 0;
        const n = parseInt(raw, 10);
        return isNaN(n) ? 0 : Math.max(0, n);
      })(),
      enableNowShowingListInPoster: req.body.enableNowShowingListInPoster ? "true" : "false",
      nowShowingListOnly: req.body.nowShowingListOnly ? "true" : "false",
      nowShowingListEveryMins: (() => {
        const raw = req.body.nowShowingListEveryMins;
        if (raw === undefined || raw === null || raw === "") return 0;
        const n = parseInt(raw, 10);
        return isNaN(n) ? 0 : Math.max(0, n);
      })(),
      nowShowingListBanner: String(req.body.nowShowingListBanner || "").trim(),
      enableOD: req.body.enableOD,
      enableSonarr: req.body.enableSonarr,
      enableRadarr: req.body.enableRadarr,
      enableLidarr: req.body.enableLidarr,
      enableReadarr: req.body.enableReadarr,
      filterRemote: req.body.filterRemote,
      filterLocal: req.body.filterLocal,
      filterDevices: req.body.filterDevices,
      filterUsers: req.body.filterUsers,
      odHideTitle: req.body.odHideTitle,
      odHideFooter: req.body.odHideFooter,
      showCast: req.body.showCast ? "true" : "false",
      showDirectors: req.body.showDirectors ? "true" : "false",
      showAuthors: req.body.showAuthors ? "true" : "false",
      showAlbumArtist: req.body.showAlbumArtist ? "true" : "false",
      displayPosterAlbum: req.body.displayPosterAlbum ? "true" : "false",
      displayPosterVideo: req.body.displayPosterVideo ? "true" : "false",
      displayPosterBooks: req.body.displayPosterBooks ? "true" : "false",
      displayPosterCast: req.body.displayPosterCast,
      displayPosterActor: req.body.displayPosterCast ? "true" : "false",
      displayPosterActress: req.body.displayPosterCast ? "true" : "false",
      displayPosterDirector: req.body.displayPosterDirector ? "true" : "false",
      displayPosterAuthor: req.body.displayPosterAuthor ? "true" : "false",
      displayPosterArtist: req.body.displayPosterArtist ? "true" : "false",
      enableCustomPictures: req.body.enableCustomPictures,
      enableCustomPictureThemes: req.body.enableCustomPictureThemes,
      customPictureTheme: normalizeCustomPictureThemeSelection(
        req.body.customPictureTheme
      ),
      customPictureEveryPosters: (() => {
        const raw = req.body.customPictureEveryPosters;
        if (raw === undefined || raw === null || raw === "") return 0;
        const n = parseInt(raw, 10);
        return isNaN(n) ? 0 : Math.max(0, n);
      })(),
      enableAds: req.body.enableAds,
      adsOnly:
        req.body.adsOnly !== undefined
          ? req.body.adsOnly
          : loadedSettings.adsOnly,
      adsTitleOutline:
        req.body.adsTitleOutline !== undefined
          ? req.body.adsTitleOutline
          : loadedSettings.adsTitleOutline,
      adsTheme: req.body.adsTheme ? req.body.adsTheme : DEFAULT_SETTINGS.adsTheme,
      adsEveryPosters: (() => {
        const raw = req.body.adsEveryPosters;
        if (raw === undefined || raw === null || raw === "") return 0;
        const n = parseInt(raw, 10);
        return isNaN(n) ? 0 : Math.max(0, n);
      })(),
      adsRotationSeconds: (() => {
        const raw = req.body.adsRotationSeconds;
        if (raw === undefined || raw === null || raw === "") {
          return loadedSettings.adsRotationSeconds !== undefined &&
            loadedSettings.adsRotationSeconds !== null
            ? loadedSettings.adsRotationSeconds
            : DEFAULT_SETTINGS.adsRotationSeconds;
        }
        const n = parseInt(raw, 10);
        return isNaN(n)
          ? DEFAULT_SETTINGS.adsRotationSeconds
          : Math.min(600, Math.max(3, n));
      })(),
      adsPageStaySeconds: (() => {
        const raw = req.body.adsPageStaySeconds;
        if (raw === undefined || raw === null || String(raw).trim() === "") {
          return loadedSettings.adsPageStaySeconds !== undefined &&
            loadedSettings.adsPageStaySeconds !== null
            ? loadedSettings.adsPageStaySeconds
            : DEFAULT_SETTINGS.adsPageStaySeconds;
        }
        const n = parseInt(raw, 10);
        if (isNaN(n) || n <= 0) return 0;
        return Math.min(86400, Math.max(30, n));
      })(),
      adsGlobalBackgroundPath:
        req.body.adsGlobalBackgroundPath !== undefined
          ? String(req.body.adsGlobalBackgroundPath || "").trim()
          : loadedSettings.adsGlobalBackgroundPath !== undefined
          ? loadedSettings.adsGlobalBackgroundPath
          : "",
      customPicFolders: customPicFolders,
      serverID: loadedSettings.serverID,
      updateAvailable: updateAvailable,
      enableSleep: req.body.enableSleep,
      sleepStart: req.body.sleepStart,
      sleepEnd: req.body.sleepEnd,
      triviaTimer: req.body.triviaTimer ? req.body.triviaTimer : DEFAULT_SETTINGS.triviaTimer,
      triviaCategories: req.body.triviaCategories,
      enableTrivia: req.body.enableTrivia,
      triviaNumber: req.body.triviaNumber,
      triviaFrequency: req.body.triviaFrequency,
      enableAwtrix: req.body.enableAwtrix,
      awtrixIP: req.body.awtrixIP,
      enableLinks: req.body.enableLinks,
      links: req.body.links,
      rotate: req.body.rotate,
      excludeLibs: req.body.excludeLibs,
      posterCacheRefreshMins: (() => {
        const raw = req.body.posterCacheRefreshMins;
        if (raw === undefined || raw === null || raw === "") return 0;
        const n = parseInt(raw, 10);
        return isNaN(n) ? 0 : Math.max(0, n);
      })(),
      posterCacheMinAgeBeforeChangeCheckMins: (() => {
        const raw = req.body.posterCacheMinAgeBeforeChangeCheckMins;
        if (raw === undefined || raw === null || raw === "") return 0;
        const n = parseInt(raw, 10);
        return isNaN(n) ? 0 : Math.max(0, n);
      })(),
      preferCachedPosters: req.body.preferCachedPosters,
      cachedPosterSlideCount: (() => {
        const raw = req.body.cachedPosterSlideCount;
        if (raw === undefined || raw === null || raw === "")
          return DEFAULT_SETTINGS.cachedPosterSlideCount;
        const n = parseInt(raw, 10);
        return isNaN(n) || n < 1 || !Number.isFinite(n)
          ? DEFAULT_SETTINGS.cachedPosterSlideCount
          : Math.floor(n);
      })(),
      saved: false
    };

    // 'try' to reset awtrix if previous enabled
    if(isAwtrixEnabled == true){
      // try to reboot
      let now = new Date();
      console.log(now.toLocaleString() + " *Attempting to reset Awtrix if previously running");
      var awt = new awtrix();
      try{
        awt.reboot(awtrixIP);
      }
      catch(ex){
        let now = new Date();
        console.log(now.toLocaleString() + " *Unable to reset Awtrix, you 'may' need to do so manually. " + ex);
        isAwtrixEnabled = false;
      }
    }


    var errors = validationResult(req).array();
    if (errors.length > 0) {
      req.session.errors = errors;
      form.saved = false;
      req.session.success = false;
      res.render("settings", {
        errors: req.session.errors,
        user: { valid: true },
        formData: form,
        settings: loadedSettings,
        version: pjson.version,
        baseUrl: BASEURL,
        customPicFolders: customPicFolders,
        latestVersion: latestVersion,
        message: message,
        cacheClearNotice: null,
        ...newFeaturesBannerViewData(),
      });
    } else {
      // save settings
      req.session.errors = errors;
      req.session.success = true;
      form.saved = true;
      saveReset(form);
      res.render("settings", {
        errors: req.session.errors,
        version: pjson.version,
        user: { valid: true },
        formData: form,
        settings: loadedSettings,
        baseUrl: BASEURL,
        customPicFolders: customPicFolders,
        latestVersion: latestVersion,
        message: message,
        updateAvailable: updateAvailable,
        cacheClearNotice: null,
        ...newFeaturesBannerViewData(),
      });
    }
  }
);

function dumpError(err) {
  if (typeof err === "object" && err !== null) {
    if (err.message) {
      console.log("\nMessage: " + err.message);
    }
    if (err.stack) {
      console.log("\nStacktrace:");
      console.log("====================");
      console.log(err.stack);
    }
    return err.message || String(err);
  }
  console.log("dumpError :: argument is not an object");
  return String(err);
}