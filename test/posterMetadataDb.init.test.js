const fs = require("fs");
const os = require("os");
const path = require("path");

describe("posterMetadataDb SQLite", () => {
  let tmp;
  let origCwd;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "posterr-pmdb-"));
    origCwd = process.cwd;
    process.cwd = () => tmp;
    jest.resetModules();
  });

  afterEach(() => {
    process.cwd = origCwd;
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch (e) {
      /* ignore */
    }
  });

  test("init creates db file and returns empty stats", async () => {
    const posterMetadata = require("../classes/core/posterMetadataDb");
    await posterMetadata.initPosterMetadataDb();
    const dbPath = path.join(tmp, "config", "posterr-poster-metadata.db");
    expect(fs.existsSync(dbPath)).toBe(true);
    const stats = posterMetadata.getCacheDashboardStats();
    expect(stats.posterDb.rowCount).toBe(0);
  });

  test("migrates legacy JSON when sqlite is new", async () => {
    const legacyDir = path.join(tmp, "saved");
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacyDoc = {
      v: 1,
      entries: [
        {
          cacheFile: "abc123.jpg",
          title: "Test Movie",
          tagLine: "",
          year: "2020",
          mediaType: "movie",
          summary: "",
          serverKind: "plex",
          posterAR: "",
          dbid: "x",
          apiItemId: "1",
          libraryKind: "",
          libraryName: "Movies",
          sourceUrl: "http://example/p.jpg",
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    fs.writeFileSync(
      path.join(legacyDir, "posterr-poster-metadata.json"),
      JSON.stringify(legacyDoc),
      "utf8"
    );

    const posterMetadata = require("../classes/core/posterMetadataDb");
    await posterMetadata.initPosterMetadataDb();
    const stats = posterMetadata.getCacheDashboardStats();
    expect(stats.posterDb.rowCount).toBe(1);
    expect(
      fs.existsSync(path.join(legacyDir, "posterr-poster-metadata.json"))
    ).toBe(false);
    expect(
      fs.existsSync(
        path.join(legacyDir, "posterr-poster-metadata.json.migrated.bak")
      )
    ).toBe(true);
  });

  test("poster row counts as valid when file exists only under saved/imagecache", async () => {
    const legacyDir = path.join(tmp, "saved");
    fs.mkdirSync(legacyDir, { recursive: true });
    const legacyDoc = {
      v: 1,
      entries: [
        {
          cacheFile: "legacy-only.jpg",
          title: "Legacy Path Movie",
          tagLine: "",
          year: "2021",
          mediaType: "movie",
          summary: "",
          serverKind: "plex",
          posterAR: "",
          dbid: "y",
          apiItemId: "2",
          libraryKind: "",
          libraryName: "Movies",
          sourceUrl: "http://example/p2.jpg",
          updatedAt: new Date().toISOString(),
        },
      ],
    };
    fs.writeFileSync(
      path.join(legacyDir, "posterr-poster-metadata.json"),
      JSON.stringify(legacyDoc),
      "utf8"
    );
    fs.mkdirSync(path.join(legacyDir, "imagecache"), { recursive: true });
    fs.writeFileSync(
      path.join(legacyDir, "imagecache", "legacy-only.jpg"),
      Buffer.alloc(400, 2)
    );

    const posterMetadata = require("../classes/core/posterMetadataDb");
    await posterMetadata.initPosterMetadataDb();
    const stats = posterMetadata.getCacheDashboardStats();
    expect(stats.posterDb.rowCount).toBe(1);
    expect(stats.posterDb.rowsWithValidFile).toBe(1);
    expect(stats.posterDb.rowsMissingFile).toBe(0);
  });
});
