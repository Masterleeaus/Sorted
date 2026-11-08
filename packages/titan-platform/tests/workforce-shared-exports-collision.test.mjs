import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(new URL("../", import.meta.url).pathname);

test("workforce-native and workforce-delegation public exports coexist", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  assert.equal(pkg.exports["./workforce-native"], "./src/workforce-native/index.ts");
  assert.equal(pkg.exports["./workforce-delegation"], "./src/workforce-delegation/index.ts");
  const index = fs.readFileSync(path.join(root, "src/index.ts"), "utf8");
  assert.match(index, /export \* from "\.\/workforce-native\/index\.js";/);
  assert.match(index, /export \* from "\.\/workforce-delegation\/index\.js";/);
});
