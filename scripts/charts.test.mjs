import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";

const ROOT = path.resolve(import.meta.dirname, "..");
const charts = JSON.parse(await readFile(path.join(ROOT, "drinkit-android/charts.json"), "utf8"));

test("Drinkit UI module stacks are the only UI share chart", () => {
  const shares = charts.filter(({ group, kind }) => group === "UI" && kind === "share");
  assert.deepEqual(shares.map(({ id, series }) => ({ id, series })), [{
    id: "ui-module-stacks",
    series: ["Modules:ComposeOnly", "Modules:Mixed", "Modules:ViewOnly"],
  }]);
  assert.equal(charts.some(({ id }) => id === "ui-typography" || id === "ui-colors"), false);
});
