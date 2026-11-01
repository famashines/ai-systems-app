#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { androidpublisher, auth } = require("@googleapis/androidpublisher");

const SCOPE = "https://www.googleapis.com/auth/androidpublisher";
const PACKAGE_NAME = "com.famashines.ai";
const DEFAULT_TRACK = "internal";
const RELEASE_STATUSES = ["completed", "draft"];

function readAppVersion(packagePath = path.resolve(__dirname, "../package.json")) {
  const version = JSON.parse(fs.readFileSync(packagePath, "utf8")).version;
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error("The app version must use the major.minor.patch format");
  }
  return version;
}

function readConfig(argv = process.argv, env = process.env, readVersion = readAppVersion) {
  const input = argv[2];
  if (!input) throw new Error("Usage: node scripts/publish-google-play.js <path-to-aab>");

  const aabPath = path.resolve(input);
  const stat = fs.statSync(aabPath);
  if (!stat.isFile() || path.extname(aabPath).toLowerCase() !== ".aab") {
    throw new Error(`Not an .aab file: ${aabPath}`);
  }

  const releaseStatus = env.GOOGLE_PLAY_RELEASE_STATUS || "completed";
  if (!RELEASE_STATUSES.includes(releaseStatus)) {
    throw new Error(`GOOGLE_PLAY_RELEASE_STATUS must be one of: ${RELEASE_STATUSES.join(", ")}`);
  }

  return {
    aabPath,
    packageName: PACKAGE_NAME,
    track: env.GOOGLE_PLAY_TRACK || DEFAULT_TRACK,
    releaseStatus,
    appVersion: readVersion(),
  };
}

function createClient() {
  return androidpublisher({
    version: "v3",
    auth: new auth.GoogleAuth({ scopes: [SCOPE] }),
  });
}

async function getCurrentVersion(client, packageName, track) {
  const current = await client.applications.tracks.releases.list({
    parent: `applications/${packageName}/tracks/${track}`,
  });
  const currentVersions = (current.data.releases || [])
    .flatMap((release) => release.releaseName?.match(/\d+\.\d+\.\d+/g) || [])
    .sort(compareVersions);
  return currentVersions.at(-1);
}

async function publish(client, config) {
  const { aabPath, packageName, track, releaseStatus, appVersion } = config;
  const currentVersion = await getCurrentVersion(client, packageName, track);
  if (currentVersion && compareVersions(appVersion, currentVersion) <= 0) {
    throw new Error(
      `AAB version ${appVersion} must be newer than Google Play version ${currentVersion}. Prepare and rebuild the app.`,
    );
  }

  const edit = await client.edits.insert({ packageName, requestBody: {} });
  const editId = edit.data.id;
  if (!editId) throw new Error("Google Play did not return an edit ID");

  const bundle = await client.edits.bundles.upload(
    {
      packageName,
      editId,
      media: {
        mimeType: "application/octet-stream",
        body: fs.createReadStream(aabPath),
      },
    },
    { timeout: 600000 },
  );
  const versionCode = bundle.data.versionCode;
  if (!Number.isInteger(versionCode)) {
    throw new Error("Google Play did not return a version code");
  }

  await client.edits.tracks.update({
    packageName,
    editId,
    track,
    requestBody: {
      track,
      releases: [
        {
          name: `${versionCode} (${appVersion})`,
          versionCodes: [String(versionCode)],
          status: releaseStatus,
        },
      ],
    },
  });

  await client.edits.commit({
    packageName,
    editId,
    changesInReviewBehavior: "CANCEL_IN_REVIEW_AND_SUBMIT",
  });

  return { versionCode, appVersion, track, releaseStatus };
}

function compareVersions(a, b) {
  const left = a.split(".").map(Number);
  const right = b.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

async function main() {
  const result = await publish(createClient(), readConfig());
  process.stdout.write(
    `Google Play version ${result.versionCode} (${result.appVersion}) committed to ${result.track} as ${result.releaseStatus}.\n`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    const apiError = error.response?.data?.error;
    process.stderr.write(`${apiError?.message || error.message}\n`);
    if (apiError) process.stderr.write(`${JSON.stringify(apiError, null, 2)}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  DEFAULT_TRACK,
  PACKAGE_NAME,
  compareVersions,
  createClient,
  getCurrentVersion,
  publish,
  readAppVersion,
  readConfig,
};
