const { assertReleasable } = require("./release-guard");

function fakeGit({ status = "", head = "aaa", remote = "aaa" } = {}) {
  return (...args) => {
    if (args[0] === "status") return status;
    if (args[0] === "rev-parse") return args[1] === "HEAD" ? head : remote;
    return "";
  };
}

test("accepts a clean tree at the tip of origin/main", () => {
  expect(() => assertReleasable(fakeGit())).not.toThrow();
});

test("rejects a tree with uncommitted changes", () => {
  expect(() => assertReleasable(fakeGit({ status: " M src/app/index.tsx" }))).toThrow("uncommitted changes");
});

test("rejects a commit that is not the tip of origin/main", () => {
  expect(() => assertReleasable(fakeGit({ head: "bbb" }))).toThrow("not the tip of origin/main");
});
