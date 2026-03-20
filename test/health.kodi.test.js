jest.mock("axios");

const axios = require("axios");
const Health = require("../classes/core/health");

function rpcOk(result) {
  return Promise.resolve({ data: { result, id: 1 } });
}

const kodiSettings = {
  mediaServerType: "kodi",
  plexHTTPS: "false",
  plexIP: "127.0.0.1",
  plexPort: "8080",
  plexToken: "",
};

describe("Health with Kodi (debug / JSON-RPC paths)", () => {
  beforeAll(() => {
    jest.spyOn(console, "log").mockImplementation(() => {});
  });
  afterAll(() => {
    console.log.mockRestore();
  });

  beforeEach(() => {
    axios.post.mockReset();
  });

  it("PlexNSCheck calls Player.GetActivePlayers", async () => {
    axios.post.mockImplementation(() => rpcOk([]));
    const h = new Health(kodiSettings);
    await h.PlexNSCheck();
    const methods = axios.post.mock.calls.map((c) => c[1] && c[1].method);
    expect(methods).toContain("Player.GetActivePlayers");
  });

  it("PlexODCheck calls Files.GetSources and VideoLibrary.GetMovies for sample titles", async () => {
    axios.post.mockImplementation((_url, body) => {
      const m = body.method;
      if (m === "Files.GetSources") {
        return rpcOk({ sources: [{ label: "Videos", file: "/storage/movies/" }] });
      }
      if (m === "VideoLibrary.GetMovies") {
        return rpcOk({ movies: [{ title: "Sample Film" }] });
      }
      return rpcOk(null);
    });
    const h = new Health(kodiSettings);
    await h.PlexODCheck();
    const methods = axios.post.mock.calls.map((c) => c[1] && c[1].method);
    expect(methods).toContain("Files.GetSources");
    expect(methods).toContain("VideoLibrary.GetMovies");
  });

  it("PlexODCheck falls back to TV shows when no movies", async () => {
    axios.post.mockImplementation((_url, body) => {
      const m = body.method;
      if (m === "Files.GetSources") {
        return rpcOk({ sources: [{ label: "TV", file: "/storage/tv/" }] });
      }
      if (m === "VideoLibrary.GetMovies") {
        return rpcOk({ movies: [] });
      }
      if (m === "VideoLibrary.GetTVShows") {
        return rpcOk({ tvshows: [{ title: "Sample Show" }] });
      }
      return rpcOk(null);
    });
    const h = new Health(kodiSettings);
    await h.PlexODCheck();
    const methods = axios.post.mock.calls.map((c) => c[1] && c[1].method);
    expect(methods).toContain("VideoLibrary.GetTVShows");
  });
});
