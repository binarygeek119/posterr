const mediaCard = require("../cards/MediaCard");
const cType = require("../cards/CardType");
const util = require("../core/utility");
const core = require("../core/cache");
const axios = require("axios");
const { cache } = require("ejs");
const sizeOf = require('image-size');
const bookcovers=""; // = require("bookcovers");

/**
 * @desc Used to communicate with Readarr or Chaptarr (Readarr-compatible API) for upcoming books.
 * @param {string} readarrUrl - Base URL (no trailing slash)
 * @param {string} readarrToken - API key
 * @param {string} [bookArrKind="readarr"] - "readarr" | "chaptarr"
 */
class Readarr {
  constructor(readarrUrl, readarrToken, bookArrKind) {
    this.readarrUrl = readarrUrl;
    this.readarrToken = readarrToken;
    this.bookArrKind = bookArrKind === "chaptarr" ? "chaptarr" : "readarr";
    this.appLabel = this.bookArrKind === "chaptarr" ? "Chaptarr" : "Readarr";
  }

  async getCovers(isbn) {
    let coverUrl = "";
    let data;
    // try {
      await bookcovers
        .withIsbn(isbn)
        .then(results => {
          if (results.amazon !== null) {
            console.log('   ✅ Found art on Amazon');
            data = results.amazon;
          }
          else {
            if (results.google !== null) {
              console.log('   ✅ Found art on Google');
              data = results.google;
            }
            else {
              if (results.openLibrary !== null) {
                console.log('   ✅ Found art on OpenLibrary');
                data = results.openLibrary;
              }
              else {
                //console.log('default');
                console.log('   ✘ No art found');
                data = null;
              }
            }
          }

          //let data = results.amazon;
          if (data !== null && Object.keys(data).length !== 0) {
            let lastKeyIndex = Object.keys(data).length - 1;
            // console.log(Object.keys(data)[lastKeyIndex]);
            // Object.keys(data).forEach(k => {
            const URL = data[Object.keys(data)[lastKeyIndex]];
            coverUrl = URL;
          }
          else {
            coverUrl = 'none';
          }
          // });
        }, Promise.resolve(coverUrl));
      return coverUrl;
    // }
    // catch (ex) {
    //   return 'none';
    //   console.log(ex);
    // }
  }




  /**
   * @desc Gets the movie titles that fall within the range specified
   * @param {string} startDate - in yyyy-mm-dd format - Generally todays date
   * @param {string} endDate - in yyyy-mm-dd format - future date
   * @returns {Promise<object>} json results - results of search
   */
  async GetComingSoonRawData(startDate, endDate) {
    //console.log(this.readarrUrl + "/api/v1/calendar?unmonitored=false&apikey=" + this.readarrToken + "&start=" + startDate + "&end=" + endDate);
    let response;
    try {
      response = await axios
        .get(
          this.readarrUrl +
          "/api/v1/calendar?unmonitored=false&apikey=" +
          this.readarrToken +
          "&start=" +
          startDate +
          "&end=" +
          endDate
        )
        .catch((err) => {
          throw err;
        });
    } catch (err) {
      let d = new Date();
      console.log(
        d.toLocaleString() + " *" + this.appLabel + " - Get calendar data:",
        err.message
      );
      throw err;
    }
    return response;
  }

  /**
   * @desc Gets book info
   * @param {integer} bookId - The ID of the book in readarr
   * @returns {Promise<object>} json results - results of search
   */
  async GetBookRawData(bookId) {
    //console.log(this.readarrUrl + "/api/v1/book/" + bookId + "?apikey=" + this.readarrToken);
    let response;
    try {
      response = await axios
        .get(
          this.readarrUrl +
          "/api/v1/book/" +
          bookId + 
          "?apikey=" +
          this.readarrToken
        )
        .catch((err) => {
          throw err;
        });
    } catch (err) {
      let d = new Date();
      console.log(
        d.toLocaleString() + " *" + this.appLabel + " - Get book data:",
        err.message
      );
      throw err;
    }
    return response;
  }

  /**
   * @desc Get books coming soon data and formats into mediaCard array
   * @param {string} startDate - in yyyy-mm-dd format - Generally todays date
   * @param {string} endDate - in yyyy-mm-dd format - future date
   * @returns {Promise<object>} mediaCards array - results of search
   */
  async GetComingSoon(startDate, endDate, hasArt) {
    let csbCards = [];
    let raw;
    // get raw data first
    try {
      raw = await this.GetComingSoonRawData(startDate, endDate);
    }
    catch (err) {
      let d = new Date();
      console.log(d.toLocaleString() + " *" + this.appLabel + " - Get Raw Data: " + err);
      throw err;
    }

    // reutrn an empty array if no results
    if (raw != null) {
      let d = new Date();
      // move through results and populate media cards
      await raw.data.reduce(async (memo, md) => {
        await memo;
        const medCard = new mediaCard();

        // get book info
        let rawBook;
        try {
          rawBook = await this.GetBookRawData(md.id);
        }
        catch (err) {
          let d = new Date();
          console.log(d.toLocaleString() + " *" + this.appLabel + " - Get book Data: " + err);
          throw err;
        }

        let bookReleaseDate;
        if (!await util.isEmpty(md.releaseDate)) {
          let releaseDate = new Date(md.releaseDate);
          bookReleaseDate = releaseDate.toISOString().split("T")[0];
        }
        else {
          bookReleaseDate = "No release date";
        }
        let series = "";
        if (md.seriesTitle !== null && md.seriesTitle.length > 0) {
          series = ", " + md.seriesTitle;
        }
        medCard.tagLine =
          md.title + series + " (" + bookReleaseDate + ")";
        medCard.title = md.title;
        medCard.DBID = md.foreignBookId;
        //medCard.runTime = md.runtime;
        medCard.genre = md.genres;
        medCard.summary = await util.emptyIfNull(md.overview);
        medCard.mediaType = "ebook";
        medCard.cardType = cType.CardTypeEnum.EBook;
        let authorsStr = "";
        const auth = rawBook.data && rawBook.data.author;
        if (auth) {
          if (Array.isArray(auth)) {
            authorsStr = auth
              .map((x) => (x && x.authorName) || "")
              .filter(Boolean)
              .join(", ");
          } else if (auth.authorName) {
            authorsStr = auth.authorName;
          }
        }
        medCard.authors = authorsStr;
        medCard.studio = authorsStr;
        if (Math.round(md.ratings.value * 20) !== 0) medCard.rating = Math.round(md.ratings.value * 20) + "%";
        medCard.theme = "";
        medCard.pageCount = md.pageCount;

        // try to get book cover
        let cover = 'none';
        if(md.images[0] !== undefined && md.images[0].url.includes('lastWrite')==true ){ 
          cover = this.readarrUrl + "/api/v1/mediacover/book/" + md.id + "/cover.jpg?apikey=" +  this.readarrToken;
        }
        else{
          cover = "none";
        }

        // cache image
        // if no poster available, use the generic one
        if (cover == 'none') {
          medCard.posterURL = "/images/no-cover-available.png";
        }
        else {
          // cache poster image
          let fileName = md.foreignBookId + ".jpg";
          let url = cover;
          let dlResult;
          dlResult = await core.CacheImage(url, fileName);
          medCard.posterURL = "/imagecache/" + fileName;
        }
        if (
          hasArt === "true" &&
          cover !== "none" &&
          medCard.posterURL &&
          medCard.posterURL.indexOf("/imagecache/") === 0
        ) {
          try {
            const artName = md.foreignBookId + "-art.jpg";
            const artUrl =
              this.readarrUrl +
              "/api/v1/mediacover/book/" +
              md.id +
              "/cover.jpg?apikey=" +
              this.readarrToken;
            await core.CacheImage(artUrl, artName);
            medCard.posterArtURL = "/imagecache/" + artName;
          } catch (e) {
            medCard.posterArtURL = "";
          }
        }
        medCard.posterAR = 1.47;

        if (md.grabbed == false && !await util.isEmpty(md.releaseDate)) {
          csbCards.push(medCard);
        }

      }, undefined);
    }
    let now = new Date();
    if (csbCards.length == 0) {
      console.log(now.toLocaleString() + " No Coming soon 'book' titles found");
    } else {
      console.log(
        now.toLocaleString() + " Coming soon 'book' titles refreshed");
    }
    return csbCards;
  }




  /** @param {string} [kind] */
  static displayLabel(kind) {
    return kind === "chaptarr" ? "Chaptarr" : "Readarr";
  }
}

module.exports = Readarr;
