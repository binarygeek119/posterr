const DEFAULT_SETTINGS = {
  password : "raidisnotabackup",
  slideDuration : 10,
  playThemes : "true",
  genericThemes : "true",
  fade : "true",
  hideSettingsLinks : "false",
  theaterRoomMode : "false",
  mediaServerType : "plex",
  plexIP : "",
  plexHTTPS : "false",
  plexPort : 32400,
  plexToken : "",
  pinNS : "false",
  hideUser: "false",
  onDemandLibraries : "",
  /** On-demand library names that should be marked as 3D (comma-separated). */
  onDemand3dLibraries : "",
  numberOnDemand : 2,
  onDemandRefresh : 30,
  sonarrURL : "",
  sonarrToken : "",
  sonarrCalDays : 3,
  sonarrPremieres : "false",
  radarrURL : "",
  radarrToken : "",
  radarrCalDays : 30,
  lidarrURL : "",
  lidarrToken : "",
  lidarrCalDays : 30,
  readarrURL : "",
  readarrToken : "",
  readarrCalDays : 60,
  /** "readarr" | "chaptarr" — same API; used for UI and log labels */
  bookArrKind : "readarr",
  hasArt : "false",
  /** When true, show principal cast (actors) on media cards when metadata includes it */
  showCast: "false",
  showDirectors: "false",
  showAuthors: "false",
  /** Album / track artist line when metadata provides it (music) */
  showAlbumArtist: "false",
  /** Show main cover poster for music (album / track) cards */
  displayPosterAlbum: "true",
  /** Show main poster for movie and TV cards (movie / episode / show) */
  displayPosterVideo: "true",
  /** Show main cover poster for ebooks and audiobooks cards */
  displayPosterBooks: "true",
  /** Small portrait image from first cast member with art (Plex / Jellyfin / Emby) */
  displayPosterActor: "false",
  /** Second cast portrait on Plex; Jellyfin/Emby prefers a female actor when Gender is set */
  displayPosterActress: "false",
  displayPosterDirector: "false",
  displayPosterAuthor: "false",
  /** Album / track artist portrait when the server provides separate art */
  displayPosterArtist: "false",
  shuffleSlides: "false",
  genres: "",
  custBrand: "",
  titleColour: "#FAFAD2",
  footColour: "#FAFAD2",
  bgColour: "#000000",
  enableNS: "true",
  /** Insert Now Playing (media server) slides after this many other poster slides; 0 = off */
  nowPlayingEveryPosters: 0,
  /** Include TMDB Now Showing list on the main poster carousel */
  enableNowShowingListInPoster: "false",
  /** Insert one TMDB Now Showing slide every N minutes on the main poster carousel; 0 = off (when mixed with other slides). */
  nowShowingListEveryMins: 0,
  /** When on (and list on home is on), main poster shows only TMDB Now Showing slides when the list is non-empty */
  nowShowingListOnly: "false",
  /** Optional banner title override for TMDB Now Showing slides on the main poster */
  nowShowingListBanner: "",
  /** Dedicated /now-showing view: add random titles from on-demand library pool (global odCards) */
  nowShowingFillFromServer: "false",
  /** Max extra library titles to mix into /now-showing per data refresh (0–48) */
  nowShowingFillLibraryMax: 12,
  /** How many times more often curated (saved) titles appear vs library fillers in the rotating list (1–20) */
  nowShowingCuratedWeight: 4,
  /** Max future showtimes per title on /now-showing and TMDB list slides (1–6) */
  nowShowingShowtimeCount: 6,
  /** Show ticket prices on /now-showing cards when available */
  nowShowingShowPrices: "false",
  /** Auto-generate prices for titles without a saved price */
  nowShowingAutoPriceEnabled: "false",
  /** Minimum auto-generated ticket price */
  nowShowingAutoPriceMin: 8,
  /** Maximum auto-generated ticket price */
  nowShowingAutoPriceMax: 18,
  /** Extra amount added to displayed prices for titles marked as 3D. */
  nowShowing3dPriceExtra: 0,
  /** Currency code used for now-showing ticket price display */
  nowShowingCurrencyCode: "USD",
  /** Auto-switch from home slideshow to dedicated /now-showing page on a timer. */
  enableNowShowingPageCycle: "false",
  /** Minutes to stay on home before switching to /now-showing (1–1440). */
  nowShowingPageCycleEveryMins: 30,
  /** Minutes to stay on /now-showing before returning home (1–120). */
  nowShowingPageCycleStayMins: 5,
  enableOD: "true",
  enableSonarr: "true",
  enableRadarr: "true",
  enableLidarr: "true",
  enableReadarr: "true",
  filterRemote: "true",
  filterLocal: "true",
  filterDevices: "",
  filterUsers: "",
  odHideTitle: "false",
  odHideFooter: "false",
  enableCustomPictures: "false",
  enableCustomPictureThemes: "false",
  customPictureTheme: "default",
  customPictureEveryPosters: 0,
  /** Placeholder: same shape as custom pictures; slideshow wiring added later */
  enableAds: "false",
  adsOnly: "false",
  adsTheme: "default",
  adsEveryPosters: 0,
  adsCurrencyCode: "USD",
  /** When "true", /ads shows a dark stroke around the ad title for contrast. */
  adsTitleOutline: "false",
  /** Seconds each ad stays visible on /ads before advancing (3–600). */
  adsRotationSeconds: 10,
  /**
   * Seconds the dedicated /ads page stays open before redirecting to home posters (/).
   * 0 = stay until manual navigation. When > 0, clamped 30–86400 on save and in the UI.
   */
  adsPageStaySeconds: 0,
  /** URL path under /custom/ads-view/… for the full-page backdrop on /ads only; empty = none. */
  adsGlobalBackgroundPath: "",
  serverID: "",
  sleepStart: "00:00",
  sleepEnd: "07:00",
  enableSleep: "false",
  nowScreening: "",
  comingSoon: "",
  onDemand: "",
  recentlyAdded: "",
  recentlyAddedDays: "0",
  iframe: "",
  playing: "",
  ebook: "",
  trivia: "",
  triviaFrequency: 300,
  triviaTimer: 15,
  triviaCategories: "",
  enableTrivia: "false",
  triviaNumber: "",
  contentRatings: "",
  enableAwtrix: "false",
  awtrixIP: "",
  enableLinks: "false",
  links: "",
  excludeLibs: "",
  /** Minutes between poster DB/cache refresh checks; 0 = disabled. Stale entries re-download from stored URL or are dropped. */
  posterCacheRefreshMins: 0,
  /** Minimum minutes since a poster row was last updated before we check the media server for removal or re-download the image. 0 = no extra wait (only the refresh interval applies to image checks). */
  posterCacheMinAgeBeforeChangeCheckMins: 0,
  /** When true, slideshow library slides come from poster cache/DB first; live on-demand from the media server is only a backup and still fills the cache. */
  preferCachedPosters: "true",
  /** How many cached poster slides to build when preferCachedPosters is on (actual deck is at most entries in the poster DB). */
  cachedPosterSlideCount: 48,
  tmdbApiKey: "",
  /** Last package.json version the admin acknowledged (hides “new features” banner when it matches current version) */
  newFeaturesAcknowledgedVersion: ""
};

module.exports = DEFAULT_SETTINGS;