/** @param {string} [mediaServerType] — "plex" | "jellyfin" | "emby" | "kodi" */
function getMediaServerClass(mediaServerType) {
  const t = String(mediaServerType || "plex").toLowerCase();
  if (t === "jellyfin") return require("./jellyfin");
  if (t === "emby") return require("./emby");
  if (t === "kodi") return require("./kodi");
  return require("./plex");
}

function getMediaServerKind(mediaServerType) {
  return String(mediaServerType || "plex").toLowerCase();
}

function isJellyfinFamily(mediaServerType) {
  const t = getMediaServerKind(mediaServerType);
  return t === "jellyfin" || t === "emby";
}

function isKodi(mediaServerType) {
  return getMediaServerKind(mediaServerType) === "kodi";
}

function getMediaServerShortLabel(mediaServerType) {
  const t = getMediaServerKind(mediaServerType);
  if (t === "jellyfin") return "Jellyfin";
  if (t === "emby") return "Emby";
  if (t === "kodi") return "Kodi";
  return "Plex";
}

/** True when this server type uses tvthemes.plexapp.com for TV MP3 themes */
function usesPlexThemeHost(mediaServerType) {
  return getMediaServerKind(mediaServerType) === "plex";
}

/** Plex / Jellyfin / Emby need a token or API key; Kodi may use none (no HTTP auth). */
function requiresMediaServerCredential(mediaServerType) {
  return getMediaServerKind(mediaServerType) !== "kodi";
}

module.exports = {
  getMediaServerClass,
  getMediaServerKind,
  isJellyfinFamily,
  isKodi,
  getMediaServerShortLabel,
  usesPlexThemeHost,
  requiresMediaServerCredential,
};
