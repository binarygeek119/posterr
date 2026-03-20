const Kodi = require("../classes/mediaservers/kodi");

describe("Kodi.parseAuth", () => {
  it("empty token means no HTTP auth", () => {
    expect(Kodi.parseAuth("")).toEqual({ username: "", password: "" });
    expect(Kodi.parseAuth(undefined)).toEqual({ username: "", password: "" });
  });
  it("password-only uses default user kodi", () => {
    expect(Kodi.parseAuth("secret")).toEqual({ username: "kodi", password: "secret" });
  });
  it("user:password form", () => {
    expect(Kodi.parseAuth("myuser:mypass")).toEqual({
      username: "myuser",
      password: "mypass",
    });
  });
  it("empty user before colon defaults to kodi", () => {
    expect(Kodi.parseAuth(":onlypass")).toEqual({ username: "kodi", password: "onlypass" });
  });
});
