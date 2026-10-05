import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const browser = await chromium.launch({
  headless: true,
  args: ["--no-sandbox"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }),
  errors = [],
  downloads = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("download", (d) => downloads.push(d));
try {
  await page.goto(process.env.BASE_URL || "http://localhost:8080/");
  await page.waitForFunction(() => window.joinery);
  assert.equal(await page.locator("html").getAttribute("lang"), "cs");
  assert.equal(await page.locator(".layer-row").count(), 1);
  assert.equal(await page.locator("[data-layer]").innerText(), "Vrstva 1");
  const toolbar = await page.locator(".toolbar").boundingBox(),
    canvas = await page.locator("#cad-canvas").boundingBox();
  assert.ok(toolbar.y + toolbar.height < canvas.y + 1);
  await page.locator('[data-tool="line"]').hover();
  await page.locator("#tool-tooltip:not([hidden])").waitFor();
  assert.match(
    await page.locator("#tool-tooltip").innerText(),
    /Délku lze zadat/,
  );
  assert.equal(await page.locator("[title]").count(), 0);
  assert.equal(
    await page
      .locator('[data-tool="line"]')
      .evaluate((e) => getComputedStyle(e).borderRadius),
    "0px",
  );
  await page.locator("[data-rename]").click();
  await page.locator('[name="name"]').fill("Čelní pohled");
  await page.locator('#dialog-actions [type="submit"]').click();
  await page.locator("#add-layer").click();
  await page.locator('[name="name"]').fill("Moje kóty");
  await page.locator('#dialog-actions [type="submit"]').click();
  const active = await page.evaluate(() => joinery.activeLayer);
  for (const tool of ["drill", "dimension", "panel"]) {
    await page.locator(`[data-tool="${tool}"]`).click();
    assert.equal(await page.evaluate(() => joinery.activeLayer), active);
  }
  await page.locator('[data-option="width"]').fill("100");
  await page.locator('[data-option="height"]').fill("200");
  const names = await page
    .locator('[data-option="materialKind"] option')
    .allTextContents();
  assert.deepEqual(names, [
    "Bez značení",
    "Masiv – příčný řez",
    "Masiv – podélný řez",
    "DTD",
    "Sololit",
    "Lamino",
    "Sklo",
  ]);
  await page.locator('[data-option="materialKind"]').selectOption("laminate");
  const p = await page.evaluate(() => {
    const r = joinery.canvas.canvas.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    joinery.canvas.fit();
    joinery.select(joinery.project.entities[0].id);
  });
  assert.equal(
    await page.locator('[data-prop="material"]').inputValue(),
    "Lamino",
  );
  const box = await page
    .locator(".physical-part-label")
    .evaluate((e) => ({
      direction: getComputedStyle(e).flexDirection,
      height: e.offsetHeight,
      child: e.querySelector("input").offsetHeight,
    }));
  assert.equal(box.direction, "row");
  assert.ok(box.height < 28);
  await page.locator("#physical-part").uncheck();
  assert.equal(await page.locator("[data-part]").count(), 0);
  await page.locator("#physical-part").check();
  await page.locator("#drafting-settings").click();
  assert.equal(await page.locator('[name="termination"] option').count(), 3);
  await page.locator('[name="termination"]').selectOption("filled");
  await page.locator('#dialog-actions [type="submit"]').click();
  await page.locator("#export").click();
  assert.equal(await page.locator("[data-format]").count(), 3);
  await page.locator('[data-format="pdf"]').click();
  await page.locator('[name="paper"]').selectOption("A4");
  await page.locator("#pdf-stamp").click();
  await page.locator('[name="author"]').fill("Jiří Čermák");
  await page.locator('[name="title"]').fill("Židle – příčný řez");
  await page.locator('[name="number"]').fill("Ž-001");
  await page.locator('#dialog-actions [type="submit"]').click();
  assert.equal(await page.locator('[name="paper"]').inputValue(), "A4");
  await page.locator('#dialog-actions [type="submit"]').click();
  await page.locator("#pdf-preview").waitFor();
  await page.frameLocator("#pdf-preview").locator("svg").waitFor();
  const text = await page
    .frameLocator("#pdf-preview")
    .locator("svg")
    .textContent();
  assert.ok(text.includes("Jiří Čermák"));
  assert.ok(text.includes("Ž-001"));
  assert.ok(text.includes("A4"));
  assert.equal(downloads.length, 0, "preview must not trigger a download");
  await page.screenshot({ path: "/tmp/joinery-czech-preview.png" });
  const event = page.waitForEvent("download");
  await page.locator("#preview-download").click();
  const download = await event;
  await download.saveAs("/tmp/joinery-czech-workshop.pdf");
  assert.equal(downloads.length, 1);
  await page.locator("#dialog-close").click();
  await page.waitForFunction(() => joinery.previewURL === null);
  await page.evaluate(() => joinery.save());
  await page.reload();
  await page.waitForFunction(() => window.joinery);
  assert.equal(
    await page.evaluate(() => joinery.project.settings.titleBlock.author),
    "Jiří Čermák",
  );
  assert.equal(
    await page.evaluate(() => joinery.project.settings.dimensionTermination),
    "filled",
  );
  assert.equal(
    await page.locator("[data-layer]").first().innerText(),
    "Čelní pohled",
  );
  await page.evaluate(() => joinery.select(joinery.project.entities[0].id));
  await page.screenshot({ path: "/tmp/joinery-czech-workshop.png" });
  await writeFile(
    "/tmp/joinery-czech-dom.txt",
    await page.locator("body").innerText(),
  );
  assert.deepEqual(errors, []);
  console.log(
    "PASS: Czech UI, horizontal tools, custom tooltips, square edges, own layers, six section materials, inline checkbox, dimension styles, persistent stamp, matching offline preview before download.",
  );
} finally {
  await browser.close();
}
