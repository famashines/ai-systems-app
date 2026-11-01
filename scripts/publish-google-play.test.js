const fs = require("fs");
const os = require("os");
const path = require("path");
const { publish, readConfig } = require("./publish-google-play");

test("publishes the uploaded bundle version to the selected track", async () => {
  const aabPath = path.join(os.tmpdir(), `ai-systems-${process.pid}.aab`);
  fs.writeFileSync(aabPath, "bundle");
  const calls = [];
  const client = {
    edits: {
      insert: async (params) => {
        calls.push(["insert", params]);
        return { data: { id: "edit-1" } };
      },
      bundles: {
        upload: async (params, options) => {
          calls.push(["upload", params, options]);
          for await (const chunk of params.media.body) {
            expect(chunk.toString()).toBe("bundle");
          }
          return { data: { versionCode: 42 } };
        },
      },
      tracks: {
        update: async (params) => {
          calls.push(["update", params]);
        },
      },
      commit: async (params) => {
        calls.push(["commit", params]);
      },
    },
    applications: {
      tracks: {
        releases: {
          list: async (params) => {
            calls.push(["list", params]);
            return { data: { releases: [{ releaseName: "5 (1.0.1)" }] } };
          },
        },
      },
    },
  };

  try {
    const result = await publish(client, {
      aabPath,
      packageName: "com.famashines.ai",
      track: "internal",
      releaseStatus: "completed",
      appVersion: "1.0.2",
    });

    expect(result).toEqual({
      versionCode: 42,
      appVersion: "1.0.2",
      track: "internal",
      releaseStatus: "completed",
    });
    expect(calls.map(([name]) => name)).toEqual(["list", "insert", "upload", "update", "commit"]);
    expect(calls[3][1].requestBody.releases).toEqual([
      { name: "42 (1.0.2)", versionCodes: ["42"], status: "completed" },
    ]);
    expect(calls[4][1].changesInReviewBehavior).toBe("CANCEL_IN_REVIEW_AND_SUBMIT");
  } finally {
    fs.unlinkSync(aabPath);
  }
});

test("uses the current app and internal track defaults", () => {
  const aabPath = path.join(os.tmpdir(), `ai-systems-config-${process.pid}.aab`);
  fs.writeFileSync(aabPath, "bundle");

  try {
    expect(readConfig(["node", "script", aabPath], {}, () => "1.0.2")).toEqual({
      aabPath,
      packageName: "com.famashines.ai",
      track: "internal",
      releaseStatus: "completed",
      appVersion: "1.0.2",
    });
  } finally {
    fs.unlinkSync(aabPath);
  }
});

test("sends a draft release when GOOGLE_PLAY_RELEASE_STATUS is draft", () => {
  const aabPath = path.join(os.tmpdir(), `ai-systems-draft-${process.pid}.aab`);
  fs.writeFileSync(aabPath, "bundle");

  try {
    expect(readConfig(["node", "script", aabPath], { GOOGLE_PLAY_RELEASE_STATUS: "draft" }, () => "1.0.0").releaseStatus).toBe("draft");
    expect(() => readConfig(["node", "script", aabPath], { GOOGLE_PLAY_RELEASE_STATUS: "halted" }, () => "1.0.0")).toThrow(
      "GOOGLE_PLAY_RELEASE_STATUS must be one of: completed, draft",
    );
  } finally {
    fs.unlinkSync(aabPath);
  }
});

test.each(["1.0.0", "1.0.1"])("rejects app version %s before upload", async (appVersion) => {
  const client = {
    applications: {
      tracks: {
        releases: {
          list: async () => ({
            data: { releases: [{ releaseName: "5 (1.0.1)" }, { releaseName: "1.0.0" }] },
          }),
        },
      },
    },
  };

  await expect(
    publish(client, {
      aabPath: "unused.aab",
      packageName: "com.famashines.ai",
      track: "internal",
      releaseStatus: "completed",
      appVersion,
    }),
  ).rejects.toThrow(
    `AAB version ${appVersion} must be newer than Google Play version 1.0.1. Prepare and rebuild the app.`,
  );
});
