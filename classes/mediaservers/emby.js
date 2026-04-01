const EmbyJellyfinBase = require("./embyJellyfinBase");

/**
 * Emby media server plugin (same REST surface as Jellyfin).
 */
class Emby extends EmbyJellyfinBase {
  get appName() {
    return "Emby";
  }
}

module.exports = Emby;
