#!/usr/bin/env node
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { DEFAULT_TRACK, PACKAGE_NAME, createClient, getCurrentVersion, compareVersions, readAppVersion } = require("./publish-google-play");
const { assertReleasable } = require("./release-guard");

function syncAppVersion(version = readAppVersion(), appPath = path.resolve(__dirname, "../app.json")) {
  const app = JSON.parse(fs.readFileSync(appPath, "utf8"));
  app.expo.version = version;
  fs.writeFileSync(appPath, `${JSON.stringify(app, null, 2)}\n`);
}

function runNpmVersion(bump) {
  execFileSync("npm", ["version", bump, "--no-git-tag-version", "--allow-same-version"], { stdio: ["ignore", "ignore", "inherit"] });
  syncAppVersion();
}

async function bumpVersion(bump, client, packageName, track, bumpFn = runNpmVersion, readVersion = readAppVersion) {
  if (!["patch", "minor", "major"].includes(bump)) {
    throw new Error("Usage: node scripts/bump-version.js <patch|minor|major>");
  }

  bumpFn(bump);

  const playVersion = await getCurrentVersion(client, packageName, track);
  if (playVersion && compareVersions(readVersion(), playVersion) <= 0) {
    bumpFn(playVersion);
    bumpFn("patch");
  }

  return readVersion();
}

async function main() {
  if (!process.env.CI) assertReleasable();
  const track = process.env.GOOGLE_PLAY_TRACK || DEFAULT_TRACK;
  const version = await bumpVersion(process.argv[2], createClient(), PACKAGE_NAME, track);
  process.stdout.write(`${version}\n`);
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error.response?.data?.error?.message || error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { bumpVersion, syncAppVersion };
