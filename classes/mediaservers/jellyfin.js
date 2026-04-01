const EmbyJellyfinBase = require("./embyJellyfinBase");

/**
 * Jellyfin media server plugin (Emby-compatible REST API).
 * Shared logic lives in {@link ./embyJellyfinBase}.
 */
class Jellyfin extends EmbyJellyfinBase {}

module.exports = Jellyfin;
