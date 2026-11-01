const fs = require("fs");
const os = require("os");
const path = require("path");
const { bumpVersion, syncAppVersion } = require("./bump-version");
const appJson = require("../app.json");
const packageJson = require("../package.json");

function clientWithLatestRelease(releaseName) {
  return {
    applications: {
      tracks: {
        releases: {
          list: async () => ({ data: { releases: [{ releaseName }] } }),
        },
      },
    },
  };
}

function fakeNpmVersion(start) {
  let parts = start.split(".").map(Number);
  const bumpFn = jest.fn((bump) => {
    if (bump === "major") parts = [parts[0] + 1, 0, 0];
    else if (bump === "minor") parts = [parts[0], parts[1] + 1, 0];
    else if (bump === "patch") parts = [parts[0], parts[1], parts[2] + 1];
    else parts = bump.split(".").map(Number);
  });
  return { bumpFn, readVersion: () => parts.join(".") };
}

test.each([
  ["1.0.1", "1.0.2", "patch", "1.0.3"],
  ["1.24.0", "1.25.0", "patch", "1.25.1"],
  ["1.24.0", "1.25.0", "minor", "1.25.1"],
  ["1.23.0", "1.25.0", "minor", "1.25.1"],
])("from %s with Google Play at %s, a %s bump gives %s", async (local, play, bump, expected) => {
  const { bumpFn, readVersion } = fakeNpmVersion(local);

  const result = await bumpVersion(bump, clientWithLatestRelease(`5 (${play})`), "com.famashines.ai", "internal", bumpFn, readVersion);

  expect(result).toBe(expected);
  expect(bumpFn.mock.calls).toEqual([[bump], [play], ["patch"]]);
});

test("does not bump again when already ahead of Google Play", async () => {
  const bumpFn = jest.fn();

  const result = await bumpVersion(
    "patch",
    clientWithLatestRelease("5 (1.0.1)"),
    "com.famashines.ai",
    "internal",
    bumpFn,
    () => "1.0.2",
  );

  expect(result).toBe("1.0.2");
  expect(bumpFn).toHaveBeenCalledTimes(1);
  expect(bumpFn).toHaveBeenCalledWith("patch");
});

test("rejects an unknown bump type", async () => {
  await expect(bumpVersion("banana", clientWithLatestRelease("1 (1.0.0)"), "com.famashines.ai", "internal")).rejects.toThrow(
    "Usage: node scripts/bump-version.js <patch|minor|major>",
  );
});

test("app.json and package.json have the same version", () => {
  expect(appJson.expo.version).toBe(packageJson.version);
});

test("writes the new version into app.json", () => {
  const appPath = path.join(os.tmpdir(), `ai-systems-app-${process.pid}.json`);
  fs.writeFileSync(appPath, JSON.stringify({ expo: { name: "AI Systems", version: "1.0.0" } }));

  try {
    syncAppVersion("1.0.1", appPath);
    expect(JSON.parse(fs.readFileSync(appPath, "utf8"))).toEqual({ expo: { name: "AI Systems", version: "1.0.1" } });
  } finally {
    fs.unlinkSync(appPath);
  }
});
