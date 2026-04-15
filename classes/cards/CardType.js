/**
 * @desc A card type enum
 * @returns nothing
 */
class CardType {

  static CardTypeEnum = { 
    NowScreening: ["Now Screening", ""], 
    OnDemand: ["On-demand", ""], 
    ComingSoon: ["Coming Soon", ""], 
    /** TMDB scheduled list shown on the main poster carousel */
    NowShowingList: ["Now Showing", ""], 
    Playing: ["Playing", ""], 
    IFrame: ["", ""], 
    Picture: ["Picture", ""], 
    EBook: ["E-Book Release", ""],
    Trivia: ["Trivia Question", ""],
    RecentlyAdded: ["Recently Added", ""],
    WebURL: ["WebURL", ""],
    /** Promotional slide from ADS settings (main poster rotation + ads-only mode). */
    Ad: ["Ad", ""],
  };
}

module.exports = CardType;
