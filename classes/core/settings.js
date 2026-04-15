const fs = require("fs");
const fsp = require("fs").promises;
const DEFAULT_SETTINGS = require("../../consts");
const util = require("../core/utility");
const { requiresMediaServerCredential } = require("../mediaservers/mediaServerFactory");

/** Normalize form/JSON values to "true" | "false" for settings file (checkboxes, toggles). */
function toSettingsBoolStr(value, fallback) {
  if (value === undefined || value === null || value === "") {
    if (fallback === undefined || fallback === null) return "false";
    return fallback === true || fallback === "true" ? "true" : "false";
  }
  if (value === true || value === "true" || value === "on" || value === 1 || value === "1")
    return "true";
  return "false";
}

/**
 * @desc settings object is used to get and set all settings for poster
 * @returns {<object>} settings
 */
class Settings {
  constructor() {
    // default values
    this.password = DEFAULT_SETTINGS.password;
    this.slideDuration = DEFAULT_SETTINGS.slideDuration;
    this.playThemes = DEFAULT_SETTINGS.playThemes;
    this.genericThemes = DEFAULT_SETTINGS.genericThemes;
    this.fade = DEFAULT_SETTINGS.fade;
    this.hideSettingsLinks = DEFAULT_SETTINGS.hideSettingsLinks;
    this.theaterRoomMode = DEFAULT_SETTINGS.theaterRoomMode;
    this.mediaServerType = DEFAULT_SETTINGS.mediaServerType;
    this.plexIP = DEFAULT_SETTINGS.plexIP;
    this.plexHTTPS = DEFAULT_SETTINGS.plexHTTPS;
    this.plexPort = DEFAULT_SETTINGS.plexPort;
    this.plexToken = DEFAULT_SETTINGS.plexToken;
    this.onDemandLibraries = DEFAULT_SETTINGS.onDemandLibraries;
    this.onDemand3dLibraries = DEFAULT_SETTINGS.onDemand3dLibraries;
    this.numberOnDemand = DEFAULT_SETTINGS.numberOnDemand;
    this.onDemandRefresh = DEFAULT_SETTINGS.onDemandRefresh;
    this.sonarrURL = DEFAULT_SETTINGS.sonarrURL;
    this.sonarrToken = DEFAULT_SETTINGS.sonarrToken;
    this.sonarrCalDays = DEFAULT_SETTINGS.sonarrCalDays;
    this.sonarrPremieres = DEFAULT_SETTINGS.sonarrPremieres;
    this.radarrURL = DEFAULT_SETTINGS.radarrURL;
    this.radarrToken = DEFAULT_SETTINGS.radarrToken;
    this.radarrCalDays = DEFAULT_SETTINGS.radarrCalDays;
    this.lidarrURL = DEFAULT_SETTINGS.lidarrURL;
    this.lidarrToken = DEFAULT_SETTINGS.lidarrToken;
    this.lidarrCalDays = DEFAULT_SETTINGS.lidarrCalDays;
    this.readarrURL = DEFAULT_SETTINGS.readarrURL;
    this.readarrToken = DEFAULT_SETTINGS.readarrToken;
    this.readarrCalDays = DEFAULT_SETTINGS.readarrCalDays;
    this.bookArrKind = DEFAULT_SETTINGS.bookArrKind;
    this.hasArt = DEFAULT_SETTINGS.hasArt;
    this.showCast = DEFAULT_SETTINGS.showCast;
    this.showDirectors = DEFAULT_SETTINGS.showDirectors;
    this.showAuthors = DEFAULT_SETTINGS.showAuthors;
    this.showAlbumArtist = DEFAULT_SETTINGS.showAlbumArtist;
    this.displayPosterAlbum = DEFAULT_SETTINGS.displayPosterAlbum;
    this.displayPosterVideo = DEFAULT_SETTINGS.displayPosterVideo;
    this.displayPosterBooks = DEFAULT_SETTINGS.displayPosterBooks;
    this.displayPosterActor = DEFAULT_SETTINGS.displayPosterActor;
    this.displayPosterActress = DEFAULT_SETTINGS.displayPosterActress;
    this.displayPosterDirector = DEFAULT_SETTINGS.displayPosterDirector;
    this.displayPosterAuthor = DEFAULT_SETTINGS.displayPosterAuthor;
    this.displayPosterArtist = DEFAULT_SETTINGS.displayPosterArtist;
    this.shuffleSlides = DEFAULT_SETTINGS.shuffleSlides;
    this.genres = DEFAULT_SETTINGS.genres;
    this.custBrand = DEFAULT_SETTINGS.custBrand;
    this.nowScreening = DEFAULT_SETTINGS.nowScreening;
    this.comingSoon = DEFAULT_SETTINGS.comingSoon;
    this.onDemand = DEFAULT_SETTINGS.onDemand;
    this.recentlyAddedDays = DEFAULT_SETTINGS.recentlyAddedDays;
    this.recentlyAdded = DEFAULT_SETTINGS.recentlyAdded;
    this.iframe = DEFAULT_SETTINGS.iframe;
    this.playing = DEFAULT_SETTINGS.playing;
    this.picture = DEFAULT_SETTINGS.picture;
    this.ebook = DEFAULT_SETTINGS.ebook;
    this.trivia = DEFAULT_SETTINGS.trivia;
    this.titleColour = DEFAULT_SETTINGS.titleColour;
    this.footColour = DEFAULT_SETTINGS.footColour;
    this.bgColour = DEFAULT_SETTINGS.bgColour;
    this.enableNS = DEFAULT_SETTINGS.enableNS;
    this.nowPlayingEveryPosters = DEFAULT_SETTINGS.nowPlayingEveryPosters;
    this.enableNowShowingListInPoster = DEFAULT_SETTINGS.enableNowShowingListInPoster;
    this.nowShowingListEveryMins = DEFAULT_SETTINGS.nowShowingListEveryMins;
    this.nowShowingListOnly = DEFAULT_SETTINGS.nowShowingListOnly;
    this.nowShowingListBanner = DEFAULT_SETTINGS.nowShowingListBanner;
    this.nowShowingFillFromServer = DEFAULT_SETTINGS.nowShowingFillFromServer;
    this.nowShowingFillLibraryMax = DEFAULT_SETTINGS.nowShowingFillLibraryMax;
    this.nowShowingCuratedWeight = DEFAULT_SETTINGS.nowShowingCuratedWeight;
    this.nowShowingShowtimeCount = DEFAULT_SETTINGS.nowShowingShowtimeCount;
    this.nowShowingShowPrices = DEFAULT_SETTINGS.nowShowingShowPrices;
    this.nowShowingAutoPriceEnabled =
      DEFAULT_SETTINGS.nowShowingAutoPriceEnabled;
    this.nowShowingAutoPriceMin = DEFAULT_SETTINGS.nowShowingAutoPriceMin;
    this.nowShowingAutoPriceMax = DEFAULT_SETTINGS.nowShowingAutoPriceMax;
    this.nowShowing3dPriceExtra = DEFAULT_SETTINGS.nowShowing3dPriceExtra;
    this.nowShowingCurrencyCode = DEFAULT_SETTINGS.nowShowingCurrencyCode;
    this.enableNowShowingPageCycle = DEFAULT_SETTINGS.enableNowShowingPageCycle;
    this.nowShowingPageCycleEveryMins =
      DEFAULT_SETTINGS.nowShowingPageCycleEveryMins;
    this.nowShowingPageCycleStayMins =
      DEFAULT_SETTINGS.nowShowingPageCycleStayMins;
    this.enableOD = DEFAULT_SETTINGS.enableOD;
    this.enableSonarr = DEFAULT_SETTINGS.enableSonarr;
    this.enableRadarr = DEFAULT_SETTINGS.enableRadarr;
    this.enableLidarr = DEFAULT_SETTINGS.enableLidarr;
    this.enableReadarr = DEFAULT_SETTINGS.enableReadarr;
    this.filterRemote = DEFAULT_SETTINGS.filterRemote;
    this.filterLocal = DEFAULT_SETTINGS.filterLocal;
    this.filterDevices = DEFAULT_SETTINGS.filterDevices;
    this.filterUsers = DEFAULT_SETTINGS.filterUsers;
    this.odHideTitle = DEFAULT_SETTINGS.odHideTitle;
    this.odHideFooter = DEFAULT_SETTINGS.odHideFooter;
    this.enableCustomPictures = DEFAULT_SETTINGS.enableCustomPictures;
    this.enableCustomPictureThemes = DEFAULT_SETTINGS.enableCustomPictureThemes;
    this.customPictureTheme = DEFAULT_SETTINGS.customPictureTheme;
    this.customPictureEveryPosters = DEFAULT_SETTINGS.customPictureEveryPosters;
    this.enableAds = DEFAULT_SETTINGS.enableAds;
    this.adsOnly = DEFAULT_SETTINGS.adsOnly;
    this.adsTheme = DEFAULT_SETTINGS.adsTheme;
    this.adsEveryPosters = DEFAULT_SETTINGS.adsEveryPosters;
    this.adsCurrencyCode = DEFAULT_SETTINGS.adsCurrencyCode;
    this.adsTitleOutline = DEFAULT_SETTINGS.adsTitleOutline;
    this.adsRotationSeconds = DEFAULT_SETTINGS.adsRotationSeconds;
    this.adsPageStaySeconds = DEFAULT_SETTINGS.adsPageStaySeconds;
    this.adsGlobalBackgroundPath = DEFAULT_SETTINGS.adsGlobalBackgroundPath;
    this.serverID = DEFAULT_SETTINGS.serverID;
    this.sleepStart = DEFAULT_SETTINGS.sleepStart;
    this.sleepEnd = DEFAULT_SETTINGS.sleepEnd;
    this.enableSleep = DEFAULT_SETTINGS.enableSleep;
    this.triviaTimer = DEFAULT_SETTINGS.triviaTimer;
    this.triviaCategories = DEFAULT_SETTINGS.triviaCategories;
    this.enableTrivia = DEFAULT_SETTINGS.enableTrivia;
    this.triviaNumber = DEFAULT_SETTINGS.triviaNumber;
    this.triviaFrequency = DEFAULT_SETTINGS.triviaFrequency;
    this.pinNS = DEFAULT_SETTINGS.pinNS;
    this.hideUser = DEFAULT_SETTINGS.hideUser;
    this.contentRatings = DEFAULT_SETTINGS.contentRatings;
    this.links = DEFAULT_SETTINGS.links;
    this.enableAwtrix = DEFAULT_SETTINGS.enableAwtrix;
    this.awtrixIP = DEFAULT_SETTINGS.awtrixIP;
    this.enableLinks = DEFAULT_SETTINGS.enableLinks;
    this.links = DEFAULT_SETTINGS.links;
    this.rotate = DEFAULT_SETTINGS.rotate;
    this.excludeLibs = DEFAULT_SETTINGS.excludeLibs;
    this.posterCacheRefreshMins = DEFAULT_SETTINGS.posterCacheRefreshMins;
    this.posterCacheMinAgeBeforeChangeCheckMins =
      DEFAULT_SETTINGS.posterCacheMinAgeBeforeChangeCheckMins;
    this.preferCachedPosters = DEFAULT_SETTINGS.preferCachedPosters;
    this.cachedPosterSlideCount = DEFAULT_SETTINGS.cachedPosterSlideCount;
    this.tmdbApiKey = DEFAULT_SETTINGS.tmdbApiKey;
    this.newFeaturesAcknowledgedVersion =
      DEFAULT_SETTINGS.newFeaturesAcknowledgedVersion;
    return;
  }

  /**
   * @desc Returns if settings have been changed from default values
   * @returns {<boolean>} true / false if any value is changed
   */
  GetChanged() {
    let hasChanged = false;
    let SettingChanged;
    try {
      // only worry about required media server settings (Kodi may omit token if no HTTP auth)
      const tokenOk =
        !requiresMediaServerCredential(this.mediaServerType) ||
        (this.plexToken !== undefined && this.plexToken !== "");
      if (this.plexIP !== "" && this.plexPort !== "" && tokenOk) {
        hasChanged = true;
        throw SettingChanged;
      } else {
        let now = new Date();
        console.log(
          now.toISOString().split("T")[0] +
            " INVALID MEDIA SERVER SETTINGS - Please visit setup page to resolve"
        );
      }
    } catch (e) {
      if (e !== SettingChanged) throw e;
    }

    return hasChanged;
  }

  /**
   * @desc Gets all Poster settings
   * @returns {<object>} json - json object for all settings
   */
  async GetSettings() {
    // check if file exists before downloading
    if (!fs.existsSync("config/settings.json")) {
      //file not present, so create it with defaults
      await this.SaveSettings();
      console.log("✅ Config file created");
    }

    const data = fs.readFileSync("config/settings.json", "utf-8");

    let readSettings;
    try {
      readSettings = await JSON.parse(data.toString());

      // if needed settings values missing, then add them to the object, pending a future save. This is for settings file upgrades of exisitng installs. (when default state should be true)
      if(readSettings.enableNS==undefined) readSettings.enableNS = 'true';
      if (readSettings.onDemand3dLibraries === undefined)
        readSettings.onDemand3dLibraries = DEFAULT_SETTINGS.onDemand3dLibraries;
      if (readSettings.nowPlayingEveryPosters === undefined) {
        const legacy = readSettings.nowShowingEveryPosters;
        readSettings.nowPlayingEveryPosters =
          legacy !== undefined && legacy !== null && legacy !== ""
            ? Math.max(0, parseInt(legacy, 10) || 0)
            : 0;
      }
      if (readSettings.enableNowShowingListInPoster === undefined)
        readSettings.enableNowShowingListInPoster = "false";
      if (readSettings.nowShowingListEveryMins === undefined) {
        const legacy = readSettings.nowShowingListEveryPosters;
        readSettings.nowShowingListEveryMins =
          legacy !== undefined && legacy !== null && legacy !== ""
            ? Math.max(0, parseInt(legacy, 10) || 0)
            : DEFAULT_SETTINGS.nowShowingListEveryMins;
      }
      if (readSettings.nowShowingListOnly === undefined)
        readSettings.nowShowingListOnly = "false";
      if (readSettings.nowShowingListBanner === undefined)
        readSettings.nowShowingListBanner = "";
      if (readSettings.nowShowingFillFromServer === undefined)
        readSettings.nowShowingFillFromServer = "false";
      if (readSettings.nowShowingFillLibraryMax === undefined)
        readSettings.nowShowingFillLibraryMax = 12;
      if (readSettings.nowShowingCuratedWeight === undefined)
        readSettings.nowShowingCuratedWeight = 4;
      if (readSettings.nowShowingShowtimeCount === undefined)
        readSettings.nowShowingShowtimeCount =
          DEFAULT_SETTINGS.nowShowingShowtimeCount;
      if (readSettings.nowShowingShowPrices === undefined)
        readSettings.nowShowingShowPrices = DEFAULT_SETTINGS.nowShowingShowPrices;
      if (readSettings.nowShowingAutoPriceEnabled === undefined)
        readSettings.nowShowingAutoPriceEnabled =
          DEFAULT_SETTINGS.nowShowingAutoPriceEnabled;
      if (readSettings.nowShowingAutoPriceMin === undefined)
        readSettings.nowShowingAutoPriceMin =
          DEFAULT_SETTINGS.nowShowingAutoPriceMin;
      if (readSettings.nowShowingAutoPriceMax === undefined)
        readSettings.nowShowingAutoPriceMax =
          DEFAULT_SETTINGS.nowShowingAutoPriceMax;
      if (readSettings.nowShowing3dPriceExtra === undefined)
        readSettings.nowShowing3dPriceExtra =
          DEFAULT_SETTINGS.nowShowing3dPriceExtra;
      if (readSettings.nowShowingCurrencyCode === undefined)
        readSettings.nowShowingCurrencyCode =
          DEFAULT_SETTINGS.nowShowingCurrencyCode;
      if (readSettings.enableNowShowingPageCycle === undefined)
        readSettings.enableNowShowingPageCycle =
          DEFAULT_SETTINGS.enableNowShowingPageCycle;
      if (readSettings.nowShowingPageCycleEveryMins === undefined)
        readSettings.nowShowingPageCycleEveryMins =
          DEFAULT_SETTINGS.nowShowingPageCycleEveryMins;
      if (readSettings.nowShowingPageCycleStayMins === undefined)
        readSettings.nowShowingPageCycleStayMins =
          DEFAULT_SETTINGS.nowShowingPageCycleStayMins;
      if(readSettings.enableOD==undefined) readSettings.enableOD = 'true';
      if(readSettings.enableSonarr==undefined) readSettings.enableSonarr = 'true';
      if(readSettings.enableReadarr==undefined) readSettings.enableReadarr = 'true';
      if(readSettings.enableRadarr==undefined) readSettings.enableRadarr = 'true';
      if(readSettings.enableLinks==undefined) readSettings.enableLinks = "false";
      if(readSettings.filterRemote==undefined) readSettings.filterRemote = 'true';
      if(readSettings.filterLocal==undefined) readSettings.filterLocal = 'true';
      if(readSettings.enableCustomPictures==undefined) readSettings.enableCustomPictures = 'false';
      if(readSettings.customPictureTheme==undefined) readSettings.customPictureTheme = 'default';
      if(readSettings.customPictureEveryPosters==undefined) readSettings.customPictureEveryPosters = 0;
      if (readSettings.enableAds === undefined) readSettings.enableAds = "false";
      if (readSettings.adsOnly === undefined) readSettings.adsOnly = "false";
      if (readSettings.adsTheme === undefined) readSettings.adsTheme = "default";
      if (readSettings.adsEveryPosters === undefined) readSettings.adsEveryPosters = 0;
      if (readSettings.adsCurrencyCode === undefined)
        readSettings.adsCurrencyCode = DEFAULT_SETTINGS.adsCurrencyCode;
      if (readSettings.adsTitleOutline === undefined)
        readSettings.adsTitleOutline = DEFAULT_SETTINGS.adsTitleOutline;
      if (readSettings.adsRotationSeconds === undefined)
        readSettings.adsRotationSeconds = DEFAULT_SETTINGS.adsRotationSeconds;
      if (readSettings.adsPageStaySeconds === undefined)
        readSettings.adsPageStaySeconds = DEFAULT_SETTINGS.adsPageStaySeconds;
      if (readSettings.adsGlobalBackgroundPath === undefined)
        readSettings.adsGlobalBackgroundPath =
          DEFAULT_SETTINGS.adsGlobalBackgroundPath;
      else if (
        typeof readSettings.adsGlobalBackgroundPath === "string" &&
        readSettings.adsGlobalBackgroundPath.trim() !== "" &&
        !readSettings.adsGlobalBackgroundPath
          .trim()
          .startsWith("/custom/ads-view/")
      ) {
        readSettings.adsGlobalBackgroundPath = "";
      }
      if(readSettings.enableSleep==undefined) readSettings.enableSleep = 'false';
      if(readSettings.enableTrivia==undefined) readSettings.enableTrivia = 'false';
      if(readSettings.enableLinks==undefined) readSettings.enableLinks = 'false';
      if(readSettings.recentlyAddedDays==undefined) readSettings.recentlyAddedDays = 0;
      if(readSettings.enableAwtrix==undefined) readSettings.enableAwtrix = 'false';
      if(readSettings.rotate==undefined) readSettings.rotate = 'false';
      if(readSettings.mediaServerType==undefined) readSettings.mediaServerType = 'plex';
      if(readSettings.bookArrKind==undefined) readSettings.bookArrKind = 'readarr';
      if(readSettings.showCast==undefined) readSettings.showCast = 'false';
      if(readSettings.showDirectors==undefined) readSettings.showDirectors = 'false';
      if(readSettings.showAuthors==undefined) readSettings.showAuthors = 'false';
      if(readSettings.showAlbumArtist==undefined) readSettings.showAlbumArtist = 'false';
      if(readSettings.displayPosterAlbum==undefined) readSettings.displayPosterAlbum = 'true';
      if(readSettings.displayPosterVideo==undefined) readSettings.displayPosterVideo = 'true';
      if(readSettings.displayPosterBooks==undefined) readSettings.displayPosterBooks = 'true';
      if(readSettings.displayPosterActor==undefined) readSettings.displayPosterActor = 'false';
      if(readSettings.displayPosterActress==undefined) readSettings.displayPosterActress = 'false';
      if(readSettings.displayPosterDirector==undefined) readSettings.displayPosterDirector = 'false';
      if(readSettings.displayPosterAuthor==undefined) readSettings.displayPosterAuthor = 'false';
      if(readSettings.displayPosterArtist==undefined) readSettings.displayPosterArtist = 'false';
      if(readSettings.posterCacheRefreshMins === undefined) readSettings.posterCacheRefreshMins = 0;
      if(readSettings.posterCacheMinAgeBeforeChangeCheckMins === undefined) readSettings.posterCacheMinAgeBeforeChangeCheckMins = 0;
      if(readSettings.preferCachedPosters === undefined) readSettings.preferCachedPosters = 'true';
      if(readSettings.cachedPosterSlideCount === undefined) readSettings.cachedPosterSlideCount = 48;
      if(readSettings.tmdbApiKey === undefined) readSettings.tmdbApiKey = "";
      if (readSettings.newFeaturesAcknowledgedVersion === undefined)
        readSettings.newFeaturesAcknowledgedVersion = "";
      if(readSettings.enableLidarr==undefined) readSettings.enableLidarr = 'true';
      if(readSettings.lidarrURL==undefined) readSettings.lidarrURL = '';
      if(readSettings.lidarrToken==undefined) readSettings.lidarrToken = '';
      if(readSettings.lidarrCalDays==undefined) readSettings.lidarrCalDays = 30;
    } catch (ex) {
      // do nothing if error as it reads ok anyhow
      let d = new Date();
      console.log(d.toLocaleString() + " *Failed to load settings - GetSettings:", ex);
    }

    // populate settings object with settings from json file
    await Object.assign(this, readSettings);

    // ensure settings loaded before returning
    return new Promise((resolve) => {
      setTimeout(function () {
        resolve(readSettings);
      }, 2000);
    });
  }

  /**
   * @desc Saves settings if no settings file exists
   * @returns nothing
   */
  async SaveSettings() {
    // convert JSON object to string (pretty format)
    this.serverID = util.createUUID();
    this.enableNS = 'false';
    this.enableOD = 'false';
    this.enableSonarr = 'false';
    this.enableRadarr = 'false';
    this.enableLidarr = 'false';
    this.enableReadarr = 'false';
    this.enableTrivia = 'false';
    this.enableLinks = 'false';
    this.enableAwtrix = 'false';

    const data = JSON.stringify(this, null, 4);

    // write JSON string to a file
    fs.writeFileSync("config/settings.json", data, (err) => {
      if (err) {
        console.log('ERROR: failed to write settings file',err);
        throw err;
      }
      console.log(`✅ New settings file saved
      `);
    });
    return;
  }

  async UpdateSettings(settings){

    if(fs.existsSync("config/settings.json")){
    // convert JSON object to string (pretty format)
    const data = JSON.stringify(settings, null, 4);

    
    // write JSON string to a file
    fs.writeFileSync("config/settings.json", data, (err) => {
      if (err) {
        console.log('Error - writing to settings file',err);
        throw err;
      }
    });
  }
  console.log(`✅ Upgraded settings file
  `);

    return;
  }    

  /**
   * @desc Saves settings after changes from settings page
   * @param {object} json - takes a json object from the submitted form
   * @returns nothing
   */
  async SaveSettingsJSON(jsonObject) {
    // check object passed
    if (typeof jsonObject == "undefined") {
      throw error("JSON object not passed");
    }

    let cs = {};
    try {
      if (fs.existsSync("config/settings.json")) {
        cs = JSON.parse(fs.readFileSync("config/settings.json", "utf-8"));
      }
    } catch (e) {
      cs = {};
    }

    // set passed in values from object. if value not passed, then use current settings
    if (jsonObject.password) this.password = jsonObject.password;
    else this.password = cs.password;
    if (jsonObject.slideDuration) this.slideDuration = jsonObject.slideDuration;
    else this.slideDuration = cs.slideDuration;
    if (jsonObject.themeSwitch) this.playThemes = jsonObject.themeSwitch;
    else this.playThemes = "false";
    if (jsonObject.genericSwitch) this.genericThemes = jsonObject.genericSwitch;
    else this.genericThemes = "false";
    if (jsonObject.fadeOption) this.fade = jsonObject.fadeOption;
    else this.fade = cs.fade;
    if (jsonObject.hideSettingsLinks) this.hideSettingsLinks = jsonObject.hideSettingsLinks;
    else this.hideSettingsLinks = "false";
    if (jsonObject.theaterRoomMode) this.theaterRoomMode = jsonObject.theaterRoomMode;
    else this.theaterRoomMode = "false";
    if (jsonObject.mediaServerType) this.mediaServerType = jsonObject.mediaServerType;
    else this.mediaServerType = cs.mediaServerType != undefined ? cs.mediaServerType : DEFAULT_SETTINGS.mediaServerType;
    if (jsonObject.plexIP) this.plexIP = jsonObject.plexIP;
    else this.plexIP = cs.plexIP;
    if (jsonObject.plexHTTPSSwitch) this.plexHTTPS = jsonObject.plexHTTPSSwitch;
    else this.plexHTTPS = "false";
    if (jsonObject.plexPort) this.plexPort = jsonObject.plexPort;
    else this.plexPort = cs.plexPort;
    if (jsonObject.plexToken !== undefined && jsonObject.plexToken !== null) {
      this.plexToken = jsonObject.plexToken;
    } else {
      this.plexToken = cs.plexToken;
    }
    if (jsonObject.plexLibraries)
      this.onDemandLibraries = jsonObject.plexLibraries;
    else this.onDemandLibraries = cs.onDemandLibraries;
    if (jsonObject.onDemand3dLibraries !== undefined && jsonObject.onDemand3dLibraries !== null)
      this.onDemand3dLibraries = String(jsonObject.onDemand3dLibraries);
    else
      this.onDemand3dLibraries =
        cs.onDemand3dLibraries !== undefined
          ? cs.onDemand3dLibraries
          : DEFAULT_SETTINGS.onDemand3dLibraries;
    if (jsonObject.numberOnDemand || jsonObject.numberOnDemand==0) 
      this.numberOnDemand = jsonObject.numberOnDemand;
    else this.numberOnDemand = cs.numberOnDemand;
    if (jsonObject.onDemandRefresh)
      this.onDemandRefresh = jsonObject.onDemandRefresh;
    else this.onDemandRefresh = cs.onDemandRefresh;
    if (jsonObject.sonarrUrl) this.sonarrURL = jsonObject.sonarrUrl;
    else this.sonarrURL = cs.sonarrURL;
    if (jsonObject.sonarrToken) this.sonarrToken = jsonObject.sonarrToken;
    else this.sonarrToken = cs.sonarrToken;
    if (jsonObject.sonarrDays) this.sonarrCalDays = jsonObject.sonarrDays;
    else this.sonarrCalDays = cs.sonarrCalDays;
    this.sonarrPremieres = toSettingsBoolStr(
      jsonObject.premiereSwitch,
      cs.sonarrPremieres ?? DEFAULT_SETTINGS.sonarrPremieres
    );
    if (jsonObject.radarrUrl) this.radarrURL = jsonObject.radarrUrl;
    else this.radarrURL = cs.radarrURL;
    if (jsonObject.radarrToken) this.radarrToken = jsonObject.radarrToken;
    else this.radarrToken = cs.radarrToken;
    if (jsonObject.radarrDays) this.radarrCalDays = jsonObject.radarrDays;
    else this.radarrCalDays = cs.radarrCalDays;
    if (jsonObject.lidarrUrl) this.lidarrURL = jsonObject.lidarrUrl;
    else this.lidarrURL = cs.lidarrURL;
    if (jsonObject.lidarrToken) this.lidarrToken = jsonObject.lidarrToken;
    else this.lidarrToken = cs.lidarrToken;
    if (jsonObject.lidarrDays) this.lidarrCalDays = jsonObject.lidarrDays;
    else this.lidarrCalDays = cs.lidarrCalDays;
    if (jsonObject.readarrUrl) this.readarrURL = jsonObject.readarrUrl;
    else this.readarrURL = cs.readarrURL;
    if (jsonObject.readarrToken) this.readarrToken = jsonObject.readarrToken;
    else this.readarrToken = cs.readarrToken;
    if (jsonObject.readarrDays) this.readarrCalDays = jsonObject.readarrDays;
    else this.readarrCalDays = cs.readarrCalDays;
    if (jsonObject.bookArrKind === "chaptarr") this.bookArrKind = "chaptarr";
    else if (jsonObject.bookArrKind === "readarr") this.bookArrKind = "readarr";
    else this.bookArrKind =
      cs.bookArrKind !== undefined && cs.bookArrKind !== null
        ? cs.bookArrKind
        : DEFAULT_SETTINGS.bookArrKind;
    if (jsonObject.artSwitch) this.hasArt = jsonObject.artSwitch;
    else this.hasArt = cs.hasArt;
    this.showCast = toSettingsBoolStr(
      jsonObject.showCast,
      cs.showCast ?? DEFAULT_SETTINGS.showCast
    );
    this.showDirectors = toSettingsBoolStr(
      jsonObject.showDirectors,
      cs.showDirectors ?? DEFAULT_SETTINGS.showDirectors
    );
    this.showAuthors = toSettingsBoolStr(
      jsonObject.showAuthors,
      cs.showAuthors ?? DEFAULT_SETTINGS.showAuthors
    );
    this.showAlbumArtist = toSettingsBoolStr(
      jsonObject.showAlbumArtist,
      cs.showAlbumArtist ?? DEFAULT_SETTINGS.showAlbumArtist
    );
    this.displayPosterAlbum = toSettingsBoolStr(
      jsonObject.displayPosterAlbum,
      cs.displayPosterAlbum ?? DEFAULT_SETTINGS.displayPosterAlbum
    );
    this.displayPosterVideo = toSettingsBoolStr(
      jsonObject.displayPosterVideo,
      cs.displayPosterVideo ?? DEFAULT_SETTINGS.displayPosterVideo
    );
    this.displayPosterBooks = toSettingsBoolStr(
      jsonObject.displayPosterBooks,
      cs.displayPosterBooks ?? DEFAULT_SETTINGS.displayPosterBooks
    );
    this.displayPosterActor = toSettingsBoolStr(
      jsonObject.displayPosterActor,
      cs.displayPosterActor ?? DEFAULT_SETTINGS.displayPosterActor
    );
    this.displayPosterActress = toSettingsBoolStr(
      jsonObject.displayPosterActress,
      cs.displayPosterActress ?? DEFAULT_SETTINGS.displayPosterActress
    );
    this.displayPosterDirector = toSettingsBoolStr(
      jsonObject.displayPosterDirector,
      cs.displayPosterDirector ?? DEFAULT_SETTINGS.displayPosterDirector
    );
    this.displayPosterAuthor = toSettingsBoolStr(
      jsonObject.displayPosterAuthor,
      cs.displayPosterAuthor ?? DEFAULT_SETTINGS.displayPosterAuthor
    );
    this.displayPosterArtist = toSettingsBoolStr(
      jsonObject.displayPosterArtist,
      cs.displayPosterArtist ?? DEFAULT_SETTINGS.displayPosterArtist
    );
    if (jsonObject.shuffleSwitch) this.shuffleSlides = jsonObject.shuffleSwitch;
    else this.shuffleSlides = cs.shuffleSlides;
    if (jsonObject.genres) this.genres = jsonObject.genres;
    else this.genres = cs.genres;
    if (jsonObject.pinNSSwitch) this.pinNS = jsonObject.pinNSSwitch;
    else this.pinNS = cs.pinNS;
    if (jsonObject.hideUser) this.hideUser = jsonObject.hideUser;
    else this.hideUser = cs.hideUser;
    if (jsonObject.titleFont) this.custBrand = jsonObject.titleFont;
    else this.custBrand = cs.custBrand;
    if (jsonObject.nowScreening) this.nowScreening = jsonObject.nowScreening;
    else this.nowScreening = cs.nowScreening;
    if (jsonObject.recentlyAddedDays) this.recentlyAddedDays = jsonObject.recentlyAddedDays;
    else this.recentlyAddedDays = cs.recentlyAddedDays;
    if (jsonObject.recentlyAdded) this.recentlyAdded = jsonObject.recentlyAdded;
    else this.recentlyAdded = cs.recentlyAdded;
    if (jsonObject.onDemand) this.onDemand = jsonObject.onDemand;
    else this.onDemand = cs.onDemand;
    if (jsonObject.comingSoon) this.comingSoon = jsonObject.comingSoon;
    else this.comingSoon = cs.comingSoon;
    if (jsonObject.playing) this.playing = jsonObject.playing;
    else this.playing = cs.playing;
    if (jsonObject.iframe) this.iframe = jsonObject.iframe;
    else this.iframe = cs.iframe;
    if (jsonObject.ebook) this.ebook = jsonObject.ebook;
    else this.ebook = cs.ebook;
    if (jsonObject.picture) this.picture = jsonObject.picture;
    else this.picture = cs.picture;
    if (jsonObject.trivia) this.trivia = jsonObject.trivia;
    else this.trivia = cs.trivia;
    if (jsonObject.titleColour) this.titleColour = jsonObject.titleColour;
    else this.titleColour = cs.titleColour;
    if (jsonObject.footColour) this.footColour = jsonObject.footColour;
    else this.footColour = cs.footColour;
    if (jsonObject.bgColour) this.bgColour = jsonObject.bgColour;
    else this.bgColour = cs.bgColour;
    if (jsonObject.enableNS) this.enableNS = jsonObject.enableNS;
    else this.enableNS = "false";
    if (
      jsonObject.nowPlayingEveryPosters !== undefined &&
      jsonObject.nowPlayingEveryPosters !== null &&
      jsonObject.nowPlayingEveryPosters !== ""
    ) {
      const n = parseInt(jsonObject.nowPlayingEveryPosters, 10);
      this.nowPlayingEveryPosters = isNaN(n) ? 0 : Math.max(0, n);
    } else {
      this.nowPlayingEveryPosters =
        cs.nowPlayingEveryPosters !== undefined
          ? cs.nowPlayingEveryPosters
          : DEFAULT_SETTINGS.nowPlayingEveryPosters;
    }
    this.enableNowShowingListInPoster = toSettingsBoolStr(
      jsonObject.enableNowShowingListInPoster,
      cs.enableNowShowingListInPoster ?? DEFAULT_SETTINGS.enableNowShowingListInPoster
    );
    if (
      jsonObject.nowShowingListEveryMins !== undefined &&
      jsonObject.nowShowingListEveryMins !== null &&
      jsonObject.nowShowingListEveryMins !== ""
    ) {
      const n = parseInt(jsonObject.nowShowingListEveryMins, 10);
      this.nowShowingListEveryMins = isNaN(n) ? 0 : Math.max(0, n);
    } else {
      this.nowShowingListEveryMins =
        cs.nowShowingListEveryMins !== undefined
          ? cs.nowShowingListEveryMins
          : cs.nowShowingListEveryPosters !== undefined
            ? cs.nowShowingListEveryPosters
            : DEFAULT_SETTINGS.nowShowingListEveryMins;
    }
    this.nowShowingListOnly = toSettingsBoolStr(
      jsonObject.nowShowingListOnly,
      cs.nowShowingListOnly ?? DEFAULT_SETTINGS.nowShowingListOnly
    );
    if (jsonObject.nowShowingListBanner !== undefined && jsonObject.nowShowingListBanner !== null) {
      this.nowShowingListBanner = String(jsonObject.nowShowingListBanner);
    } else {
      this.nowShowingListBanner =
        cs.nowShowingListBanner !== undefined
          ? cs.nowShowingListBanner
          : DEFAULT_SETTINGS.nowShowingListBanner;
    }
    this.nowShowingFillFromServer = toSettingsBoolStr(
      jsonObject.nowShowingFillFromServer,
      cs.nowShowingFillFromServer ?? DEFAULT_SETTINGS.nowShowingFillFromServer
    );
    if (
      jsonObject.nowShowingFillLibraryMax !== undefined &&
      jsonObject.nowShowingFillLibraryMax !== null &&
      jsonObject.nowShowingFillLibraryMax !== ""
    ) {
      const n = parseInt(jsonObject.nowShowingFillLibraryMax, 10);
      this.nowShowingFillLibraryMax = isNaN(n) ? 0 : Math.max(0, Math.min(48, n));
    } else {
      this.nowShowingFillLibraryMax =
        cs.nowShowingFillLibraryMax !== undefined
          ? cs.nowShowingFillLibraryMax
          : DEFAULT_SETTINGS.nowShowingFillLibraryMax;
    }
    if (
      jsonObject.nowShowingCuratedWeight !== undefined &&
      jsonObject.nowShowingCuratedWeight !== null &&
      jsonObject.nowShowingCuratedWeight !== ""
    ) {
      const n = parseInt(jsonObject.nowShowingCuratedWeight, 10);
      this.nowShowingCuratedWeight = isNaN(n)
        ? DEFAULT_SETTINGS.nowShowingCuratedWeight
        : Math.max(1, Math.min(20, n));
    } else {
      this.nowShowingCuratedWeight =
        cs.nowShowingCuratedWeight !== undefined
          ? cs.nowShowingCuratedWeight
          : DEFAULT_SETTINGS.nowShowingCuratedWeight;
    }
    if (
      jsonObject.nowShowingShowtimeCount !== undefined &&
      jsonObject.nowShowingShowtimeCount !== null &&
      jsonObject.nowShowingShowtimeCount !== ""
    ) {
      const n = parseInt(jsonObject.nowShowingShowtimeCount, 10);
      this.nowShowingShowtimeCount = isNaN(n)
        ? DEFAULT_SETTINGS.nowShowingShowtimeCount
        : Math.max(1, Math.min(6, n));
    } else {
      this.nowShowingShowtimeCount =
        cs.nowShowingShowtimeCount !== undefined
          ? cs.nowShowingShowtimeCount
          : DEFAULT_SETTINGS.nowShowingShowtimeCount;
    }
    this.nowShowingShowPrices = toSettingsBoolStr(
      jsonObject.nowShowingShowPrices,
      cs.nowShowingShowPrices ?? DEFAULT_SETTINGS.nowShowingShowPrices
    );
    this.nowShowingAutoPriceEnabled = toSettingsBoolStr(
      jsonObject.nowShowingAutoPriceEnabled,
      cs.nowShowingAutoPriceEnabled ?? DEFAULT_SETTINGS.nowShowingAutoPriceEnabled
    );
    if (
      jsonObject.nowShowingAutoPriceMin !== undefined &&
      jsonObject.nowShowingAutoPriceMin !== null &&
      jsonObject.nowShowingAutoPriceMin !== ""
    ) {
      const n = parseFloat(jsonObject.nowShowingAutoPriceMin);
      this.nowShowingAutoPriceMin = isNaN(n) ? DEFAULT_SETTINGS.nowShowingAutoPriceMin : Math.max(0, n);
    } else {
      this.nowShowingAutoPriceMin =
        cs.nowShowingAutoPriceMin !== undefined
          ? cs.nowShowingAutoPriceMin
          : DEFAULT_SETTINGS.nowShowingAutoPriceMin;
    }
    if (
      jsonObject.nowShowingAutoPriceMax !== undefined &&
      jsonObject.nowShowingAutoPriceMax !== null &&
      jsonObject.nowShowingAutoPriceMax !== ""
    ) {
      const n = parseFloat(jsonObject.nowShowingAutoPriceMax);
      this.nowShowingAutoPriceMax = isNaN(n) ? DEFAULT_SETTINGS.nowShowingAutoPriceMax : Math.max(0, n);
    } else {
      this.nowShowingAutoPriceMax =
        cs.nowShowingAutoPriceMax !== undefined
          ? cs.nowShowingAutoPriceMax
          : DEFAULT_SETTINGS.nowShowingAutoPriceMax;
    }
    if (
      jsonObject.nowShowing3dPriceExtra !== undefined &&
      jsonObject.nowShowing3dPriceExtra !== null &&
      jsonObject.nowShowing3dPriceExtra !== ""
    ) {
      const n = parseFloat(jsonObject.nowShowing3dPriceExtra);
      this.nowShowing3dPriceExtra = isNaN(n)
        ? DEFAULT_SETTINGS.nowShowing3dPriceExtra
        : Math.max(0, n);
    } else {
      this.nowShowing3dPriceExtra =
        cs.nowShowing3dPriceExtra !== undefined
          ? cs.nowShowing3dPriceExtra
          : DEFAULT_SETTINGS.nowShowing3dPriceExtra;
    }
    if (
      jsonObject.nowShowingCurrencyCode !== undefined &&
      jsonObject.nowShowingCurrencyCode !== null &&
      jsonObject.nowShowingCurrencyCode !== ""
    ) {
      const code = String(jsonObject.nowShowingCurrencyCode).trim().toUpperCase();
      const allowed = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "JPY"];
      this.nowShowingCurrencyCode = allowed.includes(code)
        ? code
        : DEFAULT_SETTINGS.nowShowingCurrencyCode;
    } else {
      this.nowShowingCurrencyCode =
        cs.nowShowingCurrencyCode !== undefined
          ? cs.nowShowingCurrencyCode
          : DEFAULT_SETTINGS.nowShowingCurrencyCode;
    }
    this.enableNowShowingPageCycle = toSettingsBoolStr(
      jsonObject.enableNowShowingPageCycle,
      cs.enableNowShowingPageCycle ?? DEFAULT_SETTINGS.enableNowShowingPageCycle
    );
    if (
      jsonObject.nowShowingPageCycleEveryMins !== undefined &&
      jsonObject.nowShowingPageCycleEveryMins !== null &&
      jsonObject.nowShowingPageCycleEveryMins !== ""
    ) {
      const n = parseInt(jsonObject.nowShowingPageCycleEveryMins, 10);
      this.nowShowingPageCycleEveryMins = isNaN(n)
        ? DEFAULT_SETTINGS.nowShowingPageCycleEveryMins
        : Math.max(1, Math.min(1440, n));
    } else {
      this.nowShowingPageCycleEveryMins =
        cs.nowShowingPageCycleEveryMins !== undefined
          ? cs.nowShowingPageCycleEveryMins
          : DEFAULT_SETTINGS.nowShowingPageCycleEveryMins;
    }
    if (
      jsonObject.nowShowingPageCycleStayMins !== undefined &&
      jsonObject.nowShowingPageCycleStayMins !== null &&
      jsonObject.nowShowingPageCycleStayMins !== ""
    ) {
      const n = parseInt(jsonObject.nowShowingPageCycleStayMins, 10);
      this.nowShowingPageCycleStayMins = isNaN(n)
        ? DEFAULT_SETTINGS.nowShowingPageCycleStayMins
        : Math.max(1, Math.min(120, n));
    } else {
      this.nowShowingPageCycleStayMins =
        cs.nowShowingPageCycleStayMins !== undefined
          ? cs.nowShowingPageCycleStayMins
          : DEFAULT_SETTINGS.nowShowingPageCycleStayMins;
    }
    if (jsonObject.enableOD) this.enableOD = jsonObject.enableOD;
    else this.enableOD = "false";
    if (jsonObject.enableSonarr) this.enableSonarr = jsonObject.enableSonarr;
    else this.enableSonarr = "false";
    if (jsonObject.enableReadarr) this.enableReadarr = jsonObject.enableReadarr;
    else this.enableReadarr = "false";
    if (jsonObject.enableRadarr) this.enableRadarr = jsonObject.enableRadarr;
    else this.enableRadarr = "false";
    if (jsonObject.enableLidarr) this.enableLidarr = jsonObject.enableLidarr;
    else this.enableLidarr = "false";
    if (jsonObject.filterRemote) this.filterRemote = jsonObject.filterRemote;
    else this.filterRemote = "false";
    if (jsonObject.filterLocal) this.filterLocal = jsonObject.filterLocal;
    else this.filterLocal = "false";
    if (jsonObject.filterDevices) this.filterDevices = jsonObject.filterDevices;
    else this.filterDevices = "";
    if (jsonObject.filterUsers) this.filterUsers = jsonObject.filterUsers;
    else this.filterUsers = "";
    if (jsonObject.odHideTitle) this.odHideTitle = jsonObject.odHideTitle;
    else this.odHideTitle = cs.odHideTitle;
    if (jsonObject.odHideFooter) this.odHideFooter = jsonObject.odHideFooter;
    else this.odHideFooter = cs.odHideFooter;
    if (jsonObject.enableCustomPictures) this.enableCustomPictures = jsonObject.enableCustomPictures;
    else this.enableCustomPictures = cs.enableCustomPictures;
    if (jsonObject.enableCustomPictureThemes) this.enableCustomPictureThemes = jsonObject.enableCustomPictureThemes;
    else this.enableCustomPictureThemes = cs.enableCustomPictureThemes;
    if (jsonObject.customPictureTheme) this.customPictureTheme = jsonObject.customPictureTheme;
    else this.customPictureTheme = cs.customPictureTheme;
    if (
      jsonObject.customPictureEveryPosters !== undefined &&
      jsonObject.customPictureEveryPosters !== null &&
      jsonObject.customPictureEveryPosters !== ""
    ) {
      const n = parseInt(jsonObject.customPictureEveryPosters, 10);
      this.customPictureEveryPosters = isNaN(n) ? 0 : Math.max(0, n);
    } else {
      this.customPictureEveryPosters =
        cs.customPictureEveryPosters !== undefined
          ? cs.customPictureEveryPosters
          : DEFAULT_SETTINGS.customPictureEveryPosters;
    }
    if (jsonObject.enableAds) this.enableAds = jsonObject.enableAds;
    else
      this.enableAds =
        cs.enableAds !== undefined ? cs.enableAds : DEFAULT_SETTINGS.enableAds;
    if (
      jsonObject.adsOnly !== undefined &&
      jsonObject.adsOnly !== null &&
      jsonObject.adsOnly !== ""
    ) {
      const s = String(jsonObject.adsOnly).toLowerCase().trim();
      this.adsOnly =
        s === "true" || s === "on" || s === "1" ? "true" : "false";
    } else {
      this.adsOnly =
        cs.adsOnly !== undefined ? cs.adsOnly : DEFAULT_SETTINGS.adsOnly;
    }
    if (jsonObject.adsTheme) this.adsTheme = String(jsonObject.adsTheme);
    else
      this.adsTheme =
        cs.adsTheme !== undefined ? cs.adsTheme : DEFAULT_SETTINGS.adsTheme;
    if (
      jsonObject.adsEveryPosters !== undefined &&
      jsonObject.adsEveryPosters !== null &&
      jsonObject.adsEveryPosters !== ""
    ) {
      const n = parseInt(jsonObject.adsEveryPosters, 10);
      this.adsEveryPosters = isNaN(n) ? 0 : Math.max(0, n);
    } else {
      this.adsEveryPosters =
        cs.adsEveryPosters !== undefined
          ? cs.adsEveryPosters
          : DEFAULT_SETTINGS.adsEveryPosters;
    }
    if (
      jsonObject.adsCurrencyCode !== undefined &&
      jsonObject.adsCurrencyCode !== null &&
      jsonObject.adsCurrencyCode !== ""
    ) {
      const code = String(jsonObject.adsCurrencyCode).trim().toUpperCase();
      const allowed = ["USD", "EUR", "GBP", "CAD", "AUD", "NZD", "JPY"];
      this.adsCurrencyCode = allowed.includes(code)
        ? code
        : DEFAULT_SETTINGS.adsCurrencyCode;
    } else {
      this.adsCurrencyCode =
        cs.adsCurrencyCode !== undefined
          ? cs.adsCurrencyCode
          : DEFAULT_SETTINGS.adsCurrencyCode;
    }
    if (
      jsonObject.adsTitleOutline !== undefined &&
      jsonObject.adsTitleOutline !== null &&
      jsonObject.adsTitleOutline !== ""
    ) {
      const s = String(jsonObject.adsTitleOutline).toLowerCase().trim();
      this.adsTitleOutline =
        s === "true" || s === "on" || s === "1" ? "true" : "false";
    } else {
      this.adsTitleOutline =
        cs.adsTitleOutline !== undefined
          ? cs.adsTitleOutline
          : DEFAULT_SETTINGS.adsTitleOutline;
    }
    if (
      jsonObject.adsRotationSeconds !== undefined &&
      jsonObject.adsRotationSeconds !== null &&
      jsonObject.adsRotationSeconds !== ""
    ) {
      const n = parseInt(jsonObject.adsRotationSeconds, 10);
      this.adsRotationSeconds = isNaN(n)
        ? DEFAULT_SETTINGS.adsRotationSeconds
        : Math.min(600, Math.max(3, n));
    } else {
      this.adsRotationSeconds =
        cs.adsRotationSeconds !== undefined
          ? cs.adsRotationSeconds
          : DEFAULT_SETTINGS.adsRotationSeconds;
    }
    if (
      jsonObject.adsPageStaySeconds !== undefined &&
      jsonObject.adsPageStaySeconds !== null &&
      jsonObject.adsPageStaySeconds !== ""
    ) {
      const n = parseInt(jsonObject.adsPageStaySeconds, 10);
      if (isNaN(n) || n <= 0) {
        this.adsPageStaySeconds = 0;
      } else {
        this.adsPageStaySeconds = Math.min(86400, Math.max(30, n));
      }
    } else {
      this.adsPageStaySeconds =
        cs.adsPageStaySeconds !== undefined
          ? cs.adsPageStaySeconds
          : DEFAULT_SETTINGS.adsPageStaySeconds;
    }
    if (
      jsonObject.adsGlobalBackgroundPath !== undefined &&
      jsonObject.adsGlobalBackgroundPath !== null
    ) {
      const raw = String(jsonObject.adsGlobalBackgroundPath).trim();
      if (raw === "") {
        this.adsGlobalBackgroundPath = "";
      } else if (raw.startsWith("/custom/ads-view/")) {
        this.adsGlobalBackgroundPath = raw;
      } else {
        this.adsGlobalBackgroundPath =
          cs.adsGlobalBackgroundPath !== undefined
            ? cs.adsGlobalBackgroundPath
            : DEFAULT_SETTINGS.adsGlobalBackgroundPath;
      }
    } else {
      this.adsGlobalBackgroundPath =
        cs.adsGlobalBackgroundPath !== undefined
          ? cs.adsGlobalBackgroundPath
          : DEFAULT_SETTINGS.adsGlobalBackgroundPath;
    }
    if (jsonObject.serverID) this.serverID = jsonObject.serverID;
    else this.serverID = cs.serverID;
    if (jsonObject.sleepStart) this.sleepStart = jsonObject.sleepStart;
    else this.sleepStart = cs.sleepStart;
    if (jsonObject.sleepEnd) this.sleepEnd = jsonObject.sleepEnd;
    else this.sleepEnd = cs.sleepEnd;
    if (jsonObject.enableSleep) this.enableSleep = jsonObject.enableSleep;
    else this.enableSleep = cs.enableSleep;
    if (jsonObject.enableTrivia) this.enableTrivia = jsonObject.enableTrivia;
    else this.enableTrivia = cs.enableTrivia;
    if (jsonObject.triviaCategories) this.triviaCategories = jsonObject.triviaCategories;
    else this.triviaCategories = cs.triviaCategories;
    if (jsonObject.triviaTimer) this.triviaTimer = jsonObject.triviaTimer;
    else this.triviaTimer = cs.triviaTimer;
    if (jsonObject.triviaNumber) this.triviaNumber = jsonObject.triviaNumber;
    else this.triviaNumber = cs.triviaNumber;
    if (jsonObject.triviaFrequency) this.triviaFrequency = jsonObject.triviaFrequency;
    else this.triviaFrequency = cs.triviaFrequency;
    if (jsonObject.contentRatings) this.contentRatings = jsonObject.contentRatings;
    else this.contentRatings = cs.contentRatings;
    if (jsonObject.links) this.links = jsonObject.links;
    else this.links = cs.links;
    if (jsonObject.enableLinks) this.enableLinks = jsonObject.enableLinks;
    else this.enableLinks = cs.enableLinks;
    if (jsonObject.enableAwtrix) this.enableAwtrix = jsonObject.enableAwtrix;
    else this.enableAwtrix = cs.enableAwtrix;
    if (jsonObject.awtrixIP) this.awtrixIP = jsonObject.awtrixIP;
    else this.awtrixIP = cs.awtrixIP;
    if (jsonObject.rotate) this.rotate = jsonObject.rotate;
    else this.rotate = cs.rotate;
    if (jsonObject.excludeLibs) this.excludeLibs = jsonObject.excludeLibs;
    else this.excludeLibs = cs.excludeLibs;
    if (
      jsonObject.posterCacheRefreshMins !== undefined &&
      jsonObject.posterCacheRefreshMins !== null &&
      jsonObject.posterCacheRefreshMins !== ""
    ) {
      const n = parseInt(jsonObject.posterCacheRefreshMins, 10);
      this.posterCacheRefreshMins = isNaN(n) ? 0 : Math.max(0, n);
    } else {
      this.posterCacheRefreshMins =
        cs.posterCacheRefreshMins !== undefined
          ? cs.posterCacheRefreshMins
          : DEFAULT_SETTINGS.posterCacheRefreshMins;
    }
    if (
      jsonObject.posterCacheMinAgeBeforeChangeCheckMins !== undefined &&
      jsonObject.posterCacheMinAgeBeforeChangeCheckMins !== null &&
      jsonObject.posterCacheMinAgeBeforeChangeCheckMins !== ""
    ) {
      const n = parseInt(jsonObject.posterCacheMinAgeBeforeChangeCheckMins, 10);
      this.posterCacheMinAgeBeforeChangeCheckMins = isNaN(n)
        ? 0
        : Math.max(0, n);
    } else {
      this.posterCacheMinAgeBeforeChangeCheckMins =
        cs.posterCacheMinAgeBeforeChangeCheckMins !== undefined
          ? cs.posterCacheMinAgeBeforeChangeCheckMins
          : DEFAULT_SETTINGS.posterCacheMinAgeBeforeChangeCheckMins;
    }
    if (jsonObject.preferCachedPosters) this.preferCachedPosters = jsonObject.preferCachedPosters;
    else this.preferCachedPosters = "false";
    if (
      jsonObject.cachedPosterSlideCount !== undefined &&
      jsonObject.cachedPosterSlideCount !== null &&
      jsonObject.cachedPosterSlideCount !== ""
    ) {
      const n = parseInt(jsonObject.cachedPosterSlideCount, 10);
      this.cachedPosterSlideCount = isNaN(n) || n < 1 || !Number.isFinite(n)
        ? DEFAULT_SETTINGS.cachedPosterSlideCount
        : Math.floor(n);
    } else {
      this.cachedPosterSlideCount =
        cs.cachedPosterSlideCount !== undefined
          ? cs.cachedPosterSlideCount
          : DEFAULT_SETTINGS.cachedPosterSlideCount;
    }
    if (jsonObject.tmdbApiKey !== undefined && jsonObject.tmdbApiKey !== null) {
      this.tmdbApiKey = String(jsonObject.tmdbApiKey);
    } else {
      this.tmdbApiKey =
        cs.tmdbApiKey !== undefined ? cs.tmdbApiKey : DEFAULT_SETTINGS.tmdbApiKey;
    }
    if (
      jsonObject.newFeaturesAcknowledgedVersion !== undefined &&
      jsonObject.newFeaturesAcknowledgedVersion !== null
    ) {
      this.newFeaturesAcknowledgedVersion = String(
        jsonObject.newFeaturesAcknowledgedVersion
      );
    } else {
      this.newFeaturesAcknowledgedVersion =
        cs.newFeaturesAcknowledgedVersion !== undefined
          ? cs.newFeaturesAcknowledgedVersion
          : DEFAULT_SETTINGS.newFeaturesAcknowledgedVersion;
    }

    // convert JSON object to string (pretty format)
    const data = JSON.stringify(this, null, 4);
    
    // write JSON string to a file
    fs.writeFileSync("config/settings.json", data, (err) => {
      if (err) {
        console.log('Error - writing to settings file',err);
        throw err;
      }
    });
    console.log(`✅ Settings saved
    `);

    return;
  }
}

module.exports = Settings;
