/**
 * @desc utility class for string and object handling
 * @returns {<object>} utility
 */
class utility {
  /**
   * @desc Returns true is null, empty or undefined
   * @param {string} val
   * @returns {Promise<boolean>} boolean - true empty, undefined or null
   */
  static async isEmpty(val) {
    if (val == undefined || val == "" || val == null) {
      return true;
    } else {
      return false;
    }
  }

  static createUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
       var r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
       return v.toString(16);
    });
  }

  /** Escape text for safe insertion into HTML attribute or body context */
  static escapeHtml(str) {
    if (str == null || str === "") return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /** Plex Genre/Role/Director-style entries: { tag } or { Tag } */
  static _plexTagNames(tagged, max) {
    if (tagged == null) return "";
    const arr = Array.isArray(tagged) ? tagged : [tagged];
    const names = arr
      .map((r) => (r && (r.tag != null ? r.tag : r.Tag)) || "")
      .filter(Boolean);
    return names.slice(0, max).join(", ");
  }

  /** Comma-separated actor names from Plex Role metadata */
  static formatCastFromPlexRole(role) {
    return utility._plexTagNames(role, 12);
  }

  /** Comma-separated director names from Plex Director metadata */
  static formatDirectorsFromPlexDirector(director) {
    return utility._plexTagNames(director, 8);
  }

  static _embyPeopleByType(people, typeName, max) {
    if (!people || !Array.isArray(people)) return "";
    const names = people
      .filter((p) => (p.Type || p.type || "").toString() === typeName)
      .map((p) => p.Name || p.name)
      .filter(Boolean);
    return names.slice(0, max).join(", ");
  }

  /** Comma-separated actor names from Jellyfin/Emby People array */
  static formatCastFromEmbyPeople(people) {
    return utility._embyPeopleByType(people, "Actor", 12);
  }

  /** Comma-separated director names from Jellyfin/Emby People array */
  static formatDirectorsFromEmbyPeople(people) {
    return utility._embyPeopleByType(people, "Director", 8);
  }

  static _embyPeopleByTypes(people, typeNames, max) {
    if (!people || !Array.isArray(people) || !typeNames.length) return "";
    const set = new Set(typeNames);
    const names = people
      .filter((p) => set.has((p.Type || p.type || "").toString()))
      .map((p) => p.Name || p.name)
      .filter(Boolean);
    return names.slice(0, max).join(", ");
  }

  /** Jellyfin/Emby book & audiobook: AlbumArtist plus Writer/Author from People */
  static formatAuthorsFromEmbyBookItem(item) {
    if (!item) return "";
    const album = (item.AlbumArtist || item.albumArtist || "").trim();
    const fromPeople = utility._embyPeopleByTypes(item.People, ["Writer", "Author"], 8);
    if (album && fromPeople) return album + ", " + fromPeople;
    return album || fromPeople;
  }

  /**
   * @desc Returns an empty string if undefined, null or empty, else the submitted value
   * @param {string} val
   * @returns {Promise<string>} string - either an empty string or the submitted string value
   */
  static async emptyIfNull(val) {
    if (val == undefined || val == null || val == "") {
      return "";
    } else {
      return val;
    }
  }

  /**
   * @desc Gets a random item from an array
   * @param {Array} items - a given array of anything
   * @returns {Promise<object>} object - returns one random item
   */
  static async random_item(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  /**
   * @desc builds random set of on-demand cards
   * @param {number} numberOnDemand - the number of on-demand cards to return
   * @param {object} mediaCards - an array of on-demand mediaCards
   * @returns {Promise<object>} mediaCard[] - an array of mediaCards
   */
  static async build_random_od_set(
    numberOnDemand,
    mediaCards,
    recentlyAdded,
    options
  ) {
    if (Number(numberOnDemand) <= 0) {
      return Array.isArray(mediaCards) ? mediaCards.slice() : [];
    }
    if (options && options.includeAll === true) {
      return Array.isArray(mediaCards) ? mediaCards.slice() : [];
    }
    if (recentlyAdded > 0) {
      return mediaCards;
    }
    const pool = Array.isArray(mediaCards) ? mediaCards.slice() : [];
    if (pool.length === 0) {
      return [];
    }
    const requested = Math.max(0, Math.floor(Number(numberOnDemand)));
    const want = Math.min(requested, pool.length);
    if (want === 0) {
      return [];
    }
    // Fisher–Yates shuffle, then take first `want` — always unique (reference equality per slot).
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const t = pool[i];
      pool[i] = pool[j];
      pool[j] = t;
    }
    if (requested > pool.length && pool.length > 0) {
      const d = new Date();
      console.log(
        d.toLocaleString() +
          " *On-demand — requested " +
          requested +
          " unique title(s) but only " +
          pool.length +
          " match the current library/filters; showing " +
          pool.length +
          ". (Lower “number to display” or widen libraries/filters.)"
      );
    }
    return pool.slice(0, want);
    }
}

module.exports = utility;
