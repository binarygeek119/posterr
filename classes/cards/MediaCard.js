const util = require("./../core/utility");

/**
 * @desc mediaCards base class for defining every card that is showed in the poster app
 * @returns nothing
 */
class MediaCard {
  constructor() {
    this.ID = null;
    this.DBID = "";
    this.mediaType = "";
    this.active = null;
    this.title = "";
    this.year = "";
    this.posterURL = "";
    /** Original poster image URL used before caching (for periodic cache refresh) */
    this.posterDownloadURL = "";
    /** Stable server item id for delete checks (Plex ratingKey, Jellyfin Id, Kodi movie/show/episode id) */
    this.posterApiItemId = "";
    /** Kodi: movie | show | episode */
    this.posterLibraryKind = "";
    /** Plex/Jellyfin/Emby/Kodi on-demand library display name (for cache stats) */
    this.posterLibraryLabel = "";
    /** True when this title comes from a library configured as 3D. */
    this.is3D = false;
    this.posterArtURL = "";
    /** Cached title logo / clearlogo (PNG under /imagecache/*-logo.png) when sync pulls it */
    this.posterLogoURL = "";
    this.posterAR = "";
    this.contentRating = "";
    this.ratingColour = "";
    this.rating = "";
    this.summary = "";
    this.tagLine = "";
    this.episodeName = "";
    this.runTime = "";
    this.pageCount = "";
    this.resCodec = "";
    this.studio = "";
    this.network = "";
    this.audioCodec = "";
    this.playerDevice = "";
    this.playerIP = "";
    this.device = "";
    this.playerLocal = "";
    this.user = "";
    this.genre = [];
    this.cardType = null;
    this.progress = "";
    this.progressPercent = "";
    this.decision = "";
    this.theme = "";
    this.rendered = "";
    this.user ="";
    this.ip ="";
    this.triviaCategory = "";
    this.triviaType = "";
    this.triviaAnswer = "";
    this.triviaQuestion = "";
    this.triviaOptions = [];
    this.triviaDifficulty = "";
    this.runDuration = "";
    this.runProgress = "";
    this.linkUrl = "";
    this.youtubeKey = "";
    /** Comma-separated principal cast; shown when settings.showCast is true */
    this.cast = "";
    /** First two billed names for compact on-demand pills (optional; falls back to splitting cast) */
    this.actor1 = "";
    this.actor2 = "";
    /** Comma-separated directors; shown when settings.showDirectors is true */
    this.directors = "";
    /** Comma-separated authors; shown when settings.showAuthors is true */
    this.authors = "";
    /** Album artist / performer for music; shown when settings.showAlbumArtist is true */
    this.albumArtist = "";
    /** Optional portrait URLs for display-poster settings (cached under /imagecache/) */
    this.portraitActorURL = "";
    this.portraitActressURL = "";
    this.portraitDirectorURL = "";
    this.portraitAuthorURL = "";
    this.portraitArtistURL = "";
    this.featuredActorName = "";
    this.featuredActressName = "";
    this.featuredDirectorName = "";
    this.featuredAuthorName = "";
    this.featuredArtistName = "";
    this.featuredActorCredits = [];
    this.featuredActressCredits = [];
    this.featuredDirectorCredits = [];
    this.featuredAuthorCredits = [];
    this.featuredArtistCredits = [];
    /** Rich HTML for Ad card price/add-on badges in the footer strip */
    this.adPricingHtml = "";
  }

  /**
   * @desc renders the properties of the card into html, then sets this to the 'rendered' property
   * @returns nothing
   */
  async Render(
    hasArt,
    baseUrl,
    hideTitle,
    hideFooter,
    showCast,
    showDirectors,
    showAuthors,
    showAlbumArtist,
    displayPosterAlbum,
    displayPosterVideo,
    displayPosterBooks,
    displayPosterActor,
    displayPosterActress,
    displayPosterDirector,
    displayPosterAuthor,
    displayPosterArtist
  ) {
    const isEnabled = (v) => {
      if (v === true) return true;
      const s = String(v == null ? "" : v).toLowerCase().trim();
      return s === "true" || s === "on" || s === "1" || s === "yes";
    };
    let hiddenTitle = "";
    let hiddenFooter = "";
    let hidden = "";
    let fullScreen = "";
    let pauseMessage = "";

    // set header/footer hidden values
    // Keep metadata footer visible for on-demand music/books (legacy) and for on-demand
    // movies/shows/episodes so rating, year, genre, studio, etc. pills can appear.
    const isMusicCard = this.mediaType === "album" || this.mediaType === "track";
    const isBookCard =
      this.mediaType === "ebook" || this.mediaType === "audiobook";
    const isVideoOnDemand =
      this.cardType[0] === "On-demand" &&
      (this.mediaType === "movie" ||
        this.mediaType === "episode" ||
        this.mediaType === "show");
    const keepMetaFooter = isMusicCard || isBookCard || isVideoOnDemand;
    if (hideTitle == "true" && this.cardType[0] == "On-demand" && !keepMetaFooter) {
      hiddenTitle = "hidden";
    }
    if (hideFooter == "true" && this.cardType[0] == "On-demand" && !keepMetaFooter) {
      hiddenFooter = "hidden";
    }
    if(hiddenTitle !== "" && hiddenFooter !== "") fullScreen="fullscreen";
    if(this.cardType[0] == "Picture" || this.cardType == "Trivia Question" || this.cardType == "WebURL"){
      hiddenTitle="hidden";
      hiddenFooter="hidden";
      if(hasArt && this.posterArtURL !== ""){
        // if has art, then reduce poster by 6% to improve look
        fullScreen="fullscreenCustom";
      }
      else{
        // if no art, then likely portrait and so go full screen
        fullScreen="fullscreen";
      }
    }

    if (this.cardType[0] == "Ad") {
      if (hasArt == "true" && this.posterArtURL !== "") {
        fullScreen = "fullscreenCustom";
      } else {
        fullScreen = "fullscreen";
      }
    }

    if(this.cardType[0] == "Picture"){
      pauseMessage = `<div style="position: relative; z-index: 1;">
  <span id="overlay_text` + this.ID + `" style="position: fixed; bottom: 5px; z-index: 3;"></span>
  </div>`
    }


    // set to hide progress bar if not a playing type of card
    if (this.cardType[0] != "Now Screening" && this.cardType[0] != "Playing") hidden = "hidden";
    
    // get custom card title
    let cardCustomTitle = this.cardType[1] !== "" ? this.cardType[1] : this.cardType[0];
    if (this.cardType[0] == "Ad") {
      const t = String(this.title || "").trim();
      cardCustomTitle = t ? util.escapeHtml(t) : "Ad";
    }

    var decRemainingTime = this.runDuration - this.runProgress;
    var et = new Date();
    et.setMinutes(et.getMinutes()+decRemainingTime);
    //console.log(decRemainingTime);
    //console.log(et.toLocaleTimeString());
    var endTime = et.toLocaleTimeString("en-US", {hour12: false, hour: "2-digit", minute: "2-digit"});

    this.triviaRender="";
    this.linkRender="";
    // if a trivia card, then prepare html

    if(this.cardType[0] == "Trivia Question"){
     
      let options = "<ol type='A' class='listOptions'>";
      this.triviaOptions.forEach(o => {
        if(o == this.triviaAnswer){
          options += "<li class='theAnswer'>" + o + "</li>";
        }
        else{
        options += "<li>" + o + "</li>";
        }
      });
      options += "</ol>";

      this.triviaRender = `
      <div id='quiz' class='quiz quizText'>
        <div id='question' class='question'>` + this.triviaQuestion + `</div>
        <div class='options'>` + options + `</div>
        <div class="countdown timer` + this.ID + `">
          <div class="time_left_txt` + this.ID + `">Time Left</div>
          <div class="time timer_sec` + this.ID + `"></div>
          <div class="time_line` + this.ID + `"></div>
        </div>
      </div>`;
    }

    if(this.cardType[0] == "WebURL"){
      hiddenFooter = "hidden";
      fullScreen="fullscreen";
      hiddenTitle="hidden";
      this.linkRender = `<embed type="text/html" src="` + this.linkUrl + `" width=100% height=100% style="border: none; overflow: hidden;>`
      //this.linkRender = `<iframe scrolling="no" src="` + this.linkUrl + `" width=100% height=100%  style="border: none; overflow: hidden;" >`;
//      console.log(this.linkRender);
    }


    // pill variables
    let contentRatingPill = "";
    let resCodecPill = "";
    let audioCodecPill = "";
    let runTimePill = "";
    let ratingPill = "";
    let networkPill = "";
    let studioPill = "";
    let ipPill = "";
    let userPill = "";
    let devicePill = "";
    let yearPill = "";
    let pagePill = "";
    let endTimePill = "";
    let threeDPill = "";
    let genrePill = "";
    let libraryPill = "";
    let episodePill = "";
    let leadCastPill1 = "";
    let leadCastPill2 = "";
    let castPill = "";
    let directorPill = "";
    let authorPill = "";
    let albumArtistPill = "";

    // toggle background art as per settings
    if(hasArt=="true") {
      // leave art if present
    }
    else{
      this.posterArtURL = "";
    }

    let mainPosterURL = this.posterURL;
    if (
      !isEnabled(displayPosterAlbum) &&
      (this.mediaType === "album" || this.mediaType === "track")
    ) {
      mainPosterURL = "/images/no-poster-available.png";
    }
    if (
      !isEnabled(displayPosterVideo) &&
      (this.mediaType === "movie" ||
        this.mediaType === "episode" ||
        this.mediaType === "show")
    ) {
      mainPosterURL = "/images/no-poster-available.png";
    }
    if (
      !isEnabled(displayPosterBooks) &&
      (this.mediaType === "ebook" || this.mediaType === "audiobook")
    ) {
      mainPosterURL = "/images/no-cover-available.png";
    }
    if (!mainPosterURL || String(mainPosterURL).trim() === "") {
      if (this.mediaType === "ebook" || this.mediaType === "audiobook") {
        mainPosterURL = "/images/no-cover-available.png";
      } else {
        mainPosterURL = "/images/no-poster-available.png";
      }
    }
    const posterFallbackURL =
      this.mediaType === "ebook" || this.mediaType === "audiobook"
        ? "/images/no-cover-available.png"
        : "/images/no-poster-available.png";

    let displayedTagLine = this.tagLine;
    const castPosterEnabled =
      isEnabled(displayPosterActor) || isEnabled(displayPosterActress);
    const directorPosterEnabled = isEnabled(displayPosterDirector);
    const authorPosterEnabled = isEnabled(displayPosterAuthor);
    const artistPosterEnabled = isEnabled(displayPosterArtist);
    const isVideoCard =
      this.mediaType === "movie" ||
      this.mediaType === "episode" ||
      this.mediaType === "show";
    const allowFeaturedPeoplePoster =
      !isVideoCard || !isEnabled(displayPosterVideo);
    if (
      allowFeaturedPeoplePoster &&
      (castPosterEnabled ||
        directorPosterEnabled ||
        authorPosterEnabled ||
        artistPosterEnabled)
    ) {
      const canUseActress =
        this.portraitActressURL && String(this.portraitActressURL).trim() !== "";
      const canUseActor =
        this.portraitActorURL && String(this.portraitActorURL).trim() !== "";
      const canUseDirector =
        this.portraitDirectorURL &&
        String(this.portraitDirectorURL).trim() !== "";
      const canUseAuthor =
        this.portraitAuthorURL && String(this.portraitAuthorURL).trim() !== "";
      const canUseArtist =
        this.portraitArtistURL && String(this.portraitArtistURL).trim() !== "";
      let personName = "";
      let personCredits = [];
      let personPoster = "";

      if (artistPosterEnabled && canUseArtist) {
        personName = this.featuredArtistName || "";
        personCredits = Array.isArray(this.featuredArtistCredits)
          ? this.featuredArtistCredits
          : [];
        personPoster = this.portraitArtistURL;
      } else if (authorPosterEnabled && canUseAuthor) {
        personName = this.featuredAuthorName || "";
        personCredits = Array.isArray(this.featuredAuthorCredits)
          ? this.featuredAuthorCredits
          : [];
        personPoster = this.portraitAuthorURL;
      } else if (directorPosterEnabled && canUseDirector) {
        personName = this.featuredDirectorName || "";
        personCredits = Array.isArray(this.featuredDirectorCredits)
          ? this.featuredDirectorCredits
          : [];
        personPoster = this.portraitDirectorURL;
      } else if (isEnabled(displayPosterActress) && canUseActress) {
        personName = this.featuredActressName || "";
        personCredits = Array.isArray(this.featuredActressCredits)
          ? this.featuredActressCredits
          : [];
        personPoster = this.portraitActressURL;
      } else if (isEnabled(displayPosterActor) && canUseActor) {
        personName = this.featuredActorName || "";
        personCredits = Array.isArray(this.featuredActorCredits)
          ? this.featuredActorCredits
          : [];
        personPoster = this.portraitActorURL;
      } else if (canUseActor) {
        personName = this.featuredActorName || "";
        personCredits = Array.isArray(this.featuredActorCredits)
          ? this.featuredActorCredits
          : [];
        personPoster = this.portraitActorURL;
      } else if (canUseActress) {
        personName = this.featuredActressName || "";
        personCredits = Array.isArray(this.featuredActressCredits)
          ? this.featuredActressCredits
          : [];
        personPoster = this.portraitActressURL;
      }

      if (personPoster) {
        mainPosterURL = personPoster;
        if (personName) cardCustomTitle = util.escapeHtml(personName);
        if (personCredits.length > 0) {
          displayedTagLine = personCredits.slice(0, 5).join("  •  ");
        } else if (this.title) {
          displayedTagLine = String(this.title);
        }
      }
    }

    const isAdCard = this.cardType[0] == "Ad";

    const portraitStrip = (() => {
      const parts = [];
      const add = (on, url, cls) => {
        if (isEnabled(on) && url && String(url).trim() !== "") {
          parts.push(
            `<div class="cardPortrait ` +
              cls +
              `" style="background-image:url('` +
              baseUrl +
              util.escapeHtml(url) +
              `')"></div>`
          );
        }
      };
      add(displayPosterActor, this.portraitActorURL, "cardPortraitActor");
      add(displayPosterActress, this.portraitActressURL, "cardPortraitActress");
      add(displayPosterDirector, this.portraitDirectorURL, "cardPortraitDirector");
      add(displayPosterAuthor, this.portraitAuthorURL, "cardPortraitAuthor");
      add(displayPosterArtist, this.portraitArtistURL, "cardPortraitArtist");
      if (parts.length === 0) return "";
      return `<div class="cardPortraitStrip">` + parts.join("") + `</div>`;
    })();

    // include if value present
    if (!(await util.isEmpty(this.year))) {
      yearPill =
        "<span class='badge badge-pill badge-dark'> " +
        this.year +
        "</span>";
    }

    const genreStr = (() => {
      const g = this.genre;
      if (g == null) return "";
      if (Array.isArray(g)) {
        return g
          .map((x) => String(x || "").trim())
          .filter(Boolean)
          .slice(0, 4)
          .join(" · ");
      }
      const s = String(g).trim();
      if (!s) return "";
      return s
        .split(/[,|]/)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 4)
        .join(" · ");
    })();
    if (!(await util.isEmpty(genreStr))) {
      genrePill =
        "<span class='badge badge-pill badge-info'>" +
        util.escapeHtml(genreStr) +
        "</span>";
    }

    if (!(await util.isEmpty(this.posterLibraryLabel))) {
      const is3dTitle =
        this.is3D === true || String(this.is3D || "").toLowerCase() === "true";
      const libTrim = String(this.posterLibraryLabel).trim();
      // On-demand 3D: only the "3D" badge, not the library (e.g. "3D Movies").
      // On-demand non-3D movie: hide generic library names like "Movies" / "Films" (no extra pill).
      const genericMovieLibraryPill =
        this.mediaType === "movie" &&
        /^(movies?|films?)$/i.test(libTrim);
      const suppressLibraryPill =
        (isVideoOnDemand && is3dTitle) ||
        (isVideoOnDemand && !is3dTitle && genericMovieLibraryPill);
      if (!suppressLibraryPill) {
        libraryPill =
          "<span class='badge badge-pill badge-dark'>" +
          util.escapeHtml(libTrim.slice(0, 48)) +
          "</span>";
      }
    }

    if (
      !(await util.isEmpty(this.episodeName)) &&
      this.mediaType === "episode"
    ) {
      episodePill =
        "<span class='badge badge-pill badge-secondary'>" +
        util.escapeHtml(this.episodeName) +
        "</span>";
    }

    if (this.is3D === true || String(this.is3D || "").toLowerCase() === "true") {
      threeDPill = "<span class='badge badge-pill badge-dark'>3D</span>";
    }

    if (!(await util.isEmpty(this.contentRating))) {
      const ratingColourClass = this.ratingColour || "badge-dark";
      const crRaw = String(this.contentRating).trim();
      const crLabel =
        isVideoOnDemand && crRaw && !/^(nr|unrated)$/i.test(crRaw)
          ? "Rated " + util.escapeHtml(crRaw)
          : util.escapeHtml(crRaw);
      contentRatingPill =
        "<span class='badge badge-pill " +
        ratingColourClass +
        "'>" +
        crLabel +
        "</span>";
    }

    if (!(await util.isEmpty(this.ip))) {
      ipPill =
        "<span class='badge badge-pill badge-dark'> " +
        this.ip +
        "</span>";
    }

    if (!(await util.isEmpty(this.device))) {
      devicePill =
        "<span class='badge badge-pill badge-dark'> " +
        this.device +
        "</span>";
    }

    if (!(await util.isEmpty(this.user))) {
      userPill =
        "<span class='badge badge-pill badge-dark'> " +
        this.user +
        "</span>";
    }

    if (!(await util.isEmpty(this.resCodec))) {
      let resBadge = "badge-dark";
      // if(this.resCodec.toLocaleLowerCase().includes('4k') && this.resCodec.toLocaleLowerCase().includes('main 10 hdr')){
      //   resBadge = "badge-primary super-res";
      // }
      resCodecPill =
        "<span class='badge badge-pill " + resBadge + "'> " +
        this.resCodec +
        "</span>";
    }

    if (!(await util.isEmpty(this.network))) {
      networkPill =
        "<span class='badge badge-pill badge-dark'> " +
        this.network +
        "</span>";
    }

    if (!(await util.isEmpty(this.studio))) {
      studioPill =
        "<span class='badge badge-pill badge-dark'> " +
        this.studio +
        "</span>";
    }

    if (!(await util.isEmpty(this.audioCodec))) {
      audioCodecPill =
        "<span class='badge badge-pill badge-dark'> " +
        this.audioCodec +
        "</span>";
    }

    if (!(await util.isEmpty(this.pageCount))) {
      pagePill =
        "<span class='badge badge-pill badge-dark'> " +
        this.pageCount +
        " pages</span>";
    }

    if (!(await util.isEmpty(this.runTime))) {
      runTimePill =
        "<span class='badge badge-pill badge-dark'> " +
        this.runTime +
        "m</span>";
    }

    if (!(await util.isEmpty(this.rating))) {
      if (isVideoOnDemand) {
        ratingPill =
          "<span class='badge badge-pill badge-secondary'>Audience " +
          util.escapeHtml(String(this.rating).trim()) +
          "</span>";
      } else {
        ratingPill =
          "<span class='badge badge-pill badge-dark'> " + this.rating + "</span>";
      }
    }

    if(this.cardType[0] == "Now Screening" || this.cardType[0] == "Playing") {
      endTimePill =
        "<span class='badge badge-pill badge-dark'>End: " + endTime + "</span>";
    }

    if (isVideoOnDemand) {
      let n1 = String(this.actor1 || "").trim();
      let n2 = String(this.actor2 || "").trim();
      if (!n1 || !n2) {
        const parts = String(this.cast || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        if (!n1) n1 = parts[0] || "";
        if (!n2) n2 = parts[1] || "";
      }
      if (n1) {
        leadCastPill1 =
          "<span class='badge badge-pill badge-secondary'>" +
          util.escapeHtml(n1) +
          "</span>";
      }
      if (n2) {
        leadCastPill2 =
          "<span class='badge badge-pill badge-secondary'>" +
          util.escapeHtml(n2) +
          "</span>";
      }
    }

    if (
      showCast === "true" &&
      !(await util.isEmpty(this.cast)) &&
      !isVideoOnDemand
    ) {
      castPill =
        "<span class='badge badge-pill badge-secondary'>Cast: " +
        util.escapeHtml(this.cast) +
        "</span>";
    }

    if (showDirectors === "true" && !(await util.isEmpty(this.directors))) {
      directorPill =
        "<span class='badge badge-pill badge-secondary'>Director: " +
        util.escapeHtml(this.directors) +
        "</span>";
    }

    if (showAuthors === "true" && !(await util.isEmpty(this.authors))) {
      authorPill =
        "<span class='badge badge-pill badge-secondary'>Authors: " +
        util.escapeHtml(this.authors) +
        "</span>";
    }

    if (
      showAlbumArtist === "true" &&
      !(await util.isEmpty(this.albumArtist))
    ) {
      albumArtistPill =
        "<span class='badge badge-pill badge-secondary'>Artist: " +
        util.escapeHtml(this.albumArtist) +
        "</span>";
    }

    let tagDetailsHtml = "";
    if (isAdCard) {
      tagDetailsHtml = this.adPricingHtml || "";
    } else if (isVideoOnDemand) {
      tagDetailsHtml =
        contentRatingPill +
        ratingPill +
        studioPill +
        runTimePill +
        leadCastPill1 +
        leadCastPill2 +
        genrePill +
        yearPill +
        threeDPill +
        libraryPill +
        resCodecPill +
        networkPill +
        audioCodecPill +
        pagePill +
        userPill +
        devicePill +
        ipPill +
        episodePill +
        endTimePill +
        castPill +
        directorPill +
        authorPill +
        albumArtistPill;
    } else {
      tagDetailsHtml =
        contentRatingPill +
        resCodecPill +
        networkPill +
        studioPill +
        libraryPill +
        audioCodecPill +
        runTimePill +
        pagePill +
        ratingPill +
        userPill +
        devicePill +
        ipPill +
        yearPill +
        genrePill +
        threeDPill +
        episodePill +
        endTimePill +
        castPill +
        directorPill +
        authorPill +
        albumArtistPill;
    }

    // render data into html
    this.rendered =
      `
    <div class="carousel-item ` +
      this.active +
      ` w-100 h-100" id="` +
      this.ID +
      `">
      <audio id="audio` +
        this.ID +
        `">
        <source src="` +
        baseUrl + this.theme +
        `" type="audio/mpeg" preload="auto">
        Your browser does not support the audio element.
      </audio>
      <div class="myDiv">
      <div class="posterArt" style="background-image: url('` +
      baseUrl + 
      this.posterArtURL + `')">
      </div>
        <div class="banners">
          <div class="bannerBigText ` +
      this.cardType[0] +
      ` ` + hiddenTitle + 
      `">` +
      cardCustomTitle +
      `</div>
       </div> 

      <div id="poster` +
      this.ID +
      `" class="poster` +
      " " + fullScreen +
      `" style="background-image: url('` +
      baseUrl + 
      mainPosterURL + `'), url('` +
      baseUrl +
      posterFallbackURL + `')">` + portraitStrip + pauseMessage + `

      <div class="progress ` +
      hidden +
      `" id="progress` +
      this.ID + `">
          <div class="progress-bar ` +
      this.decision +
      `" role="progressbar" style="width: ` +
      this.progressPercent +
      `%"
            aria-valuenow="` +
      this.progress +
      `" aria-valuemin="0" aria-valuemax="` +
      this.runTime +
      `"></div>
        </div>
      <div class="hidden" id="poster` + this.ID + `AR">`+this.posterAR+`</div>` +
      this.triviaRender + this.linkRender +
      `</div>

      <div class="bottomBanner mx-auto transparent` +
      ` ` + hiddenFooter + 
      `" id="bottomBanner` +
      this.ID +
      `">
        <marquee direction="left" autostart="false" id="marquee`+ this.ID + `"><div class="tagLine" id="tagLine`+ this.ID + `">` +
      displayedTagLine +
      `</div></marquee>
        <div class="tagDetails">` +
      tagDetailsHtml +
      `</div>
      </div>
      </div>
    </div>`;
      return;
  }
}

module.exports = MediaCard;
