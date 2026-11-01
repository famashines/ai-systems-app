const { execFileSync } = require("child_process");

function git(...args) {
  return execFileSync("git", args, { cwd: __dirname, encoding: "utf8" }).trim();
}

function assertReleasable(run = git) {
  if (run("status", "--porcelain")) {
    throw new Error("The working tree has uncommitted changes. Commit or remove them, then try again.");
  }
  run("fetch", "--quiet", "origin", "main");
  if (run("rev-parse", "HEAD") !== run("rev-parse", "FETCH_HEAD")) {
    throw new Error("HEAD is not the tip of origin/main. Switch to main and pull, then try again.");
  }
}

module.exports = { assertReleasable };
