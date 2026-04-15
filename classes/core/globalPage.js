const cache = require("./cache");

/**
 * @desc globalPage object is passed to poster.ejs and contains all browser settings and card data
 * @param {number} slideDuration - how long each slide will be visible for (seconds)
 * @param {string} fadeTransition - boolean - if true, will fade transition. false will slide.
 * @param {string} custBrand - string - Font name to use for slide titles.
 * @returns {<object>} globalPage
 */
class globalPage {
  constructor(
    slideDuration,
    fadeTransition,
    custBrand,
    titleColour,
    footColour,
    bgColour,
    hasArt,
    quizTime,
    hideSettingsLinks,
    rotate
  ) {
    this.slideDuration = slideDuration;
    this.fadeTransition = fadeTransition;
    this.custBrand = custBrand;
    this.titleColour = titleColour;
    this.footColour = footColour;
    this.bgColour = bgColour;
    this.cards = [];
    this.quizTime = quizTime;
    this.hideSettingsLinks = hideSettingsLinks;
    this.rotate = rotate;
    return;
  }

  /**
   * @desc Takes merged mediaCard set and applies card order number and active card slide, then generates the rendered HTML for each media card.
   * @returns nothing
   */
  async OrderAndRenderCards(
    baseUrl,
    hasArt,
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
    if (this.cards.length != 0) {
      for (let i = 0; i < this.cards.length; i++) {
        const card = this.cards[i];
        card.ID = i + 1;
        card.active = i === 0 ? "active" : "";
      }
      // Parallel render: each card builds its own HTML; order is already fixed by ID.
      await Promise.all(
        this.cards.map((card) =>
          card.Render(
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
          )
        )
      );
    }
    return;
  }
}

module.exports = globalPage;
