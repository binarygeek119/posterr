const plex = require("../classes/mediaservers/plex");
const jellyfin = require("../classes/mediaservers/jellyfin");
const emby = require("../classes/mediaservers/emby");
const kodi = require("../classes/mediaservers/kodi");
const {
  getMediaServerClass,
  getMediaServerKind,
  isJellyfinFamily,
  isKodi,
  getMediaServerShortLabel,
  usesPlexThemeHost,
  requiresMediaServerCredential,
} = require("../classes/mediaservers/mediaServerFactory");

describe("mediaServerFactory", () => {
  describe("getMediaServerClass", () => {
    it("returns Kodi for kodi", () => {
      expect(getMediaServerClass("kodi")).toBe(kodi);
    });
    it("returns Jellyfin module for jellyfin", () => {
      expect(getMediaServerClass("jellyfin")).toBe(jellyfin);
    });
    it("returns Emby module for emby", () => {
      expect(getMediaServerClass("emby")).toBe(emby);
    });
    it("returns Plex by default", () => {
      expect(getMediaServerClass()).toBe(plex);
      expect(getMediaServerClass("plex")).toBe(plex);
    });
  });

  describe("Kodi-specific flags", () => {
    it("isKodi is true only for kodi", () => {
      expect(isKodi("kodi")).toBe(true);
      expect(isKodi("KODI")).toBe(true);
      expect(isKodi("plex")).toBe(false);
      expect(isKodi("jellyfin")).toBe(false);
    });
    it("requiresMediaServerCredential is false for Kodi", () => {
      expect(requiresMediaServerCredential("kodi")).toBe(false);
    });
    it("usesPlexThemeHost is false for Kodi", () => {
      expect(usesPlexThemeHost("kodi")).toBe(false);
    });
    it("getMediaServerShortLabel", () => {
      expect(getMediaServerShortLabel("kodi")).toBe("Kodi");
    });
  });

  describe("getMediaServerKind", () => {
    it("normalizes Kodi", () => {
      expect(getMediaServerKind("Kodi")).toBe("kodi");
    });
  });

  describe("isJellyfinFamily", () => {
    it("excludes Kodi", () => {
      expect(isJellyfinFamily("kodi")).toBe(false);
    });
  });
});
