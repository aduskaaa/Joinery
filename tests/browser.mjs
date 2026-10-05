import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const base = process.env.BASE_URL || "http://localhost:8080",
  artifacts = process.env.BROWSER_ARTIFACTS || tmpdir();
const appRoot = base.startsWith("file:")
  ? new URL(".", base).href
  : new URL(base).origin;
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [],
  external = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
  if (
    !r.url().startsWith(appRoot) &&
    !r.url().startsWith("data:") &&
    !r.url().startsWith("blob:")
  )
    external.push(r.url());
});
await page.goto(base);
await page.waitForFunction(() => window.joinery?.tools);
await page.evaluate(() => {
  joinery.project = Joinery.Model.demoProject();
  joinery.render();
  joinery.canvas.fit();
});
const worldClick = async (x, y) => {
  const q = await page.evaluate(
    (p) => {
      const s = joinery.canvas.toScreen(p),
        r = joinery.canvas.canvas.getBoundingClientRect();
      return { x: s.x + r.left, y: s.y + r.top };
    },
    { x, y },
  );
  await page.mouse.click(q.x, q.y);
};
const worldMove = async (x, y) => {
  const q = await page.evaluate(
    (p) => {
      const s = joinery.canvas.toScreen(p),
        r = joinery.canvas.canvas.getBoundingClientRect();
      return { x: s.x + r.left, y: s.y + r.top };
    },
    { x, y },
  );
  await page.mouse.move(q.x, q.y);
};
await page.locator("[data-part]").first().click();
await page.locator('[data-prop="width"]').fill("450");
await page.locator('[data-prop="width"]').press("Tab");
assert.equal(
  await page.evaluate(() => joinery.project.entities[0].points[1].x),
  450,
);
await page.locator('[data-edge="0"]').click();
assert.equal(
  await page.evaluate(() => joinery.project.entities[0].banding[0]),
  1,
);
await page.locator("#undo").click();
assert.equal(
  await page.evaluate(() => joinery.project.entities[0].banding[0]),
  0,
);
await page.locator("#redo").click();
assert.equal(
  await page.evaluate(() => joinery.project.entities[0].banding[0]),
  1,
);
// Panel creation uses actual tool fields and a real click.
await page.locator('[data-tool="panel"]').click();
for (const [k, v] of [
  ["width", "120"],
  ["height", "80"],
  ["thickness", "12"],
])
  await page.locator(`[data-option="${k}"]`).fill(v);
await worldClick(710, 210);
assert.equal(await page.locator("[data-part]").count(), 4);
await page.keyboard.press("Escape");
await page.locator("[data-part]").last().click();
assert.equal(await page.locator('[data-prop="thickness"]').inputValue(), "12");
// Move selected panel 50mm via two click base/destination.
await page.locator('[data-tool="move"]').click();
await worldClick(710, 210);
await worldClick(760, 210);
assert.ok(
  Math.abs(
    (await page.evaluate(() => joinery.panels().at(-1).points[0].x)) - 760,
  ) < 0.001,
);
// Copy keeps the original and creates a discrete part.
await page.locator('[data-tool="copy"]').click();
await worldClick(760, 210);
await worldClick(890, 210);
assert.equal(await page.locator("[data-part]").count(), 5);
// Contextual array dialog uses selected copies.
await page.keyboard.press("Escape");
await page.locator("[data-part]").last().click();
await page.locator("#inspect-edit").click();
await page.locator('[data-operation="array"]').click();
await page.locator('[name="columns"]').fill("2");
await page.locator('[name="dx"]').fill("130");
await page.locator("#dialog-form button[type=submit]").click();
assert.equal(await page.locator("[data-part]").count(), 6);
// A real exact-length line uses keyboard entry.
await page.locator('[data-tool="line"]').click();
await worldClick(560, 700);
await worldMove(760, 700);
await page.keyboard.type("200");
await page.keyboard.press("Enter");
const length = await page.evaluate(() => {
  const e = joinery.project.entities.filter((e) => e.type === "line").at(-1);
  return Math.hypot(
    e.points[1].x - e.points[0].x,
    e.points[1].y - e.points[0].y,
  );
});
assert.ok(Math.abs(length - 200) < 1e-8);
await page.keyboard.press("Escape");
const old = await page.evaluate(() => joinery.canvas.view());
await page.locator("[data-tab=cutlist]").click();
assert.equal(await page.locator("#cutlist-table tr").count(), 6);
await page.locator("[data-tab=design]").click();
const next = await page.evaluate(() => joinery.canvas.view());
assert.deepEqual(next, old);
// Zoom remains fixed at the pointer's world coordinate.
await worldMove(300, 400);
const fixed = await page.evaluate(() => ({ ...joinery.canvas.cursor }));
await page.mouse.wheel(0, -100);
const after = await page.evaluate(() => joinery.canvas.cursor);
assert.ok(Math.abs(fixed.x - after.x) < 0.1);
await page.locator("#theme").click();
assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
await page.locator("#theme").click();
// True exports must cause browser downloads.
for (const format of ["dxf", "json"]) {
  await page.locator("#export").click();
  const [d] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(`[data-format="${format}"]`).click(),
  ]);
  assert.ok(d.suggestedFilename().includes("."));
}
await page.locator("#export").click();
await page.locator("[data-format=pdf]").click();
await page.locator("#dialog-form button[type=submit]").click();
await page.locator("#pdf-preview").waitFor();
const [pdf] = await Promise.all([
  page.waitForEvent("download"),
  page.locator("#preview-download").click(),
]);
assert.ok(pdf.suggestedFilename().endsWith(".pdf"));
await page.locator("#dialog-close").click();
await page.locator("[data-tab=cutlist]").click();
await Promise.all([
  page.waitForEvent("download"),
  page.locator("#cutlist-csv").click(),
]);
await page.locator("[data-tab=design]").click();
await page.waitForTimeout(450);
const state = await page.evaluate(() =>
  JSON.stringify(joinery.project.entities),
);
await page.reload();
await page.waitForFunction(() => window.joinery?.tools);
assert.equal(
  await page.evaluate(() => JSON.stringify(joinery.project.entities)),
  state,
);
await page.screenshot({ path: join(artifacts, "joinery-edited.png") });
const mobile = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
});
mobile.on("pageerror", (e) => errors.push(e.message));
await mobile.goto(base);
await mobile.waitForFunction(() => window.joinery?.tools);
await mobile.screenshot({ path: join(artifacts, "joinery-mobile.png") });
assert.equal(
  await mobile.evaluate(() => document.documentElement.scrollWidth),
  390,
);
await mobile.locator("[data-tool=panel]").click();
await mobile.screenshot({ path: join(artifacts, "joinery-mobile-panel.png") });
assert.deepEqual(errors, []);
assert.deepEqual(external, []);
console.log(
  "PASS: actual panel placement, property edits, edge banding, undo/redo, move, copy, array, numeric line, tabs, zoom, themes, PDF preview and downloads, autosave reload, responsive mobile, no external requests, no browser errors.",
);
await browser.close();
