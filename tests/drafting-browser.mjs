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
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
try {
  await page.goto(process.env.BASE_URL || "http://localhost:8080/");
  await page.waitForFunction(() => window.joinery);
  await page.evaluate(() => {
    const { emptyProject, panel } = Joinery.Model;
    joinery.project = emptyProject();
    joinery.project.layers.push(
      {
        id: "joinery",
        name: "Vrstva 2",
        color: "#cccccc",
        visible: true,
        locked: false,
      },
      {
        id: "dimensions",
        name: "Vrstva 3",
        color: "#cccccc",
        visible: true,
        locked: false,
      },
    );
    joinery.project.entities = [panel(0, 0, 40, 250), panel(60, 0, 40, 250)];
    joinery.project.settings.object = false;
    joinery.project.settings.grid = false;
    joinery.selection.clear();
    joinery.render();
    joinery.canvas.fit();
  });
  const click = async (x, y, modifiers = []) => {
    const p = await page.evaluate(
      (p) => {
        const s = joinery.canvas.toScreen(p),
          b = joinery.canvas.canvas.getBoundingClientRect();
        return { x: s.x + b.left, y: s.y + b.top };
      },
      { x, y },
    );
    for (const key of modifiers) await page.keyboard.down(key);
    await page.mouse.click(p.x, p.y);
    for (const key of modifiers) await page.keyboard.up(key);
  };
  // Real selection, grouping dialog, and projected-view exclusion.
  await click(0, 80);
  await click(60, 80, ["Shift"]);
  assert.equal(await page.evaluate(() => joinery.selection.size), 2);
  await page.keyboard.press("Control+g");
  await page.locator('[name="name"]').fill("Leg projections");
  await page.locator('#dialog-actions button[type="submit"]').click();
  assert.equal(
    await page.evaluate(
      () => Joinery.Woodworking.cutList(joinery.project).length,
    ),
    0,
  );
  const original = await page.evaluate(() =>
    structuredClone(joinery.project.entities),
  );
  assert.equal(original[0].groupId, original[1].groupId);
  await click(0, 80);
  assert.equal(await page.evaluate(() => joinery.selection.size), 2);
  await click(0, 80, ["Alt"]);
  assert.equal(await page.evaluate(() => joinery.selection.size), 1);
  await page.locator("#physical-part").check();
  assert.equal(
    await page.evaluate(
      () => Joinery.Woodworking.cutList(joinery.project).length,
    ),
    1,
  );
  await page.locator("#undo").click();
  await click(0, 80);
  await page.keyboard.press("c");
  await click(0, 0);
  await click(120, 0);
  let entities = await page.evaluate(() =>
    structuredClone(joinery.project.entities),
  );
  assert.equal(entities.length, 4);
  assert.equal(entities[2].groupId, entities[3].groupId);
  assert.notEqual(entities[2].groupId, entities[0].groupId);
  await page.locator("#undo").click();
  assert.equal(await page.evaluate(() => joinery.project.entities.length), 2);
  await page.locator("#redo").click();
  await page.keyboard.press("v");
  await click(120, 80);
  await page.locator("#multi-edit").click();
  await page.locator('[data-operation="array"]').click();
  await page.locator('[name="columns"]').fill("2");
  await page.locator('[name="rows"]').fill("2");
  await page.locator('[name="dx"]').fill("160");
  await page.locator('[name="dy"]').fill("300");
  await page.locator('#dialog-actions button[type="submit"]').click();
  const groups = await page.evaluate(() => {
    const m = {};
    for (const e of joinery.project.entities)
      m[e.groupId] = (m[e.groupId] || 0) + 1;
    return Object.values(m);
  });
  assert.equal(groups.length, 5);
  assert.ok(groups.every((n) => n === 2));
  await page.keyboard.press("Control+Shift+g");
  assert.equal(
    await page.evaluate(
      () => joinery.project.entities.filter((e) => !e.groupId).length,
    ),
    2,
  );
  await page.locator("#undo").click();
  // Locked/hidden members prevent partial group transformations.
  const blocked = await page.evaluate(() => {
    const e = joinery.project.entities[0];
    e.layer = "joinery";
    joinery.project.layers.find((l) => l.id === "joinery").locked = true;
    joinery.select(e.id);
    return joinery.editableSelection().length;
  });
  assert.equal(blocked, 0);
  await page.locator("#drafting-settings").click();
  await page.locator('[name="textHeight"]').selectOption("3.5");
  await page.locator('#dialog-actions button[type="submit"]').click();
  await page.evaluate(() => joinery.save());
  await page.reload();
  await page.waitForFunction(() => window.joinery);
  assert.equal(
    await page.evaluate(() => joinery.project.settings.dimensionTextHeight),
    3.5,
  );
  assert.equal(
    await page.evaluate(() => joinery.project.entities[0].groupName),
    "Leg projections",
  );
  for (const theme of ["dark", "light"]) {
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      joinery.render();
      joinery.canvas.render();
    }, theme);
    const colors = await page.evaluate(() => {
      const canvas = joinery.canvas;
      const pixels = canvas.ctx.getImageData(
        0,
        0,
        canvas.canvas.width,
        canvas.canvas.height,
      ).data;
      let colored = 0;
      for (let i = 0; i < pixels.length; i += 4)
        if (pixels[i] !== pixels[i + 1] || pixels[i + 1] !== pixels[i + 2])
          colored++;
      return {
        colored,
        background: getComputedStyle(document.documentElement)
          .getPropertyValue("--canvas")
          .trim(),
      };
    });
    assert.equal(colors.colored, 0);
    assert.equal(colors.background, theme === "dark" ? "#000000" : "#ffffff");
    await page.screenshot({ path: `/tmp/joinery-drafting-${theme}.png` });
  }
  await page.locator('[data-tab="cutlist"]').click();
  assert.ok(
    !(await page.locator("#cutlist-summary").innerText()).includes(
      "Material area",
    ),
  );
  assert.ok(
    !(await page.locator("#cutlist-summary").innerText()).includes("m²"),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  await page.locator('[data-tab="design"]').click();
  await page.screenshot({ path: "/tmp/joinery-drafting-mobile.png" });
  // A compact 13/14/13 fixture recreates the problematic drawing on A4.
  const pdf = await page.evaluate(() => {
    const p = Joinery.Model.emptyProject();
    p.name = "Leg views";
    p.settings.dimensionTextHeight = 2.5;
    const line = (id, points) => ({
      id,
      type: "polyline",
      layer: "panels",
      closed: true,
      points: points.map(([x, y]) => ({ x, y })),
    });
    p.entities = [
      line("front", [
        [0, 0],
        [40, 0],
        [40, 250],
        [27, 250],
        [27, 210],
        [13, 210],
        [13, 250],
        [0, 250],
      ]),
      line("side", [
        [60, 0],
        [100, 0],
        [100, 250],
        [60, 250],
      ]),
      line("top", [
        [0, 270],
        [40, 270],
        [40, 310],
        [0, 310],
      ]),
    ];
    const dim = (id, a, b, offset, mode = "horizontal") => ({
      id,
      type: "dimension",
      layer: "dimensions",
      mode,
      points: [a, b, offset].map(([x, y]) => ({ x, y })),
    });
    p.entities.push(
      dim("13a", [0, 310], [13, 310], [0, 322]),
      dim("14", [13, 310], [27, 310], [13, 322]),
      dim("13b", [27, 310], [40, 310], [27, 322]),
      dim("250", [100, 0], [100, 250], [110, 0], "vertical"),
      dim("40", [0, 210], [0, 250], [-10, 210], "vertical"),
    );
    return Array.from(Joinery.Woodworking.exportPDF(p, { paper: "A4" }));
  });
  await writeFile("/tmp/joinery-drafting-check.pdf", Buffer.from(pdf));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: grouping, Alt-click, physical-part exclusion, copy and independent array groups, undo/redo, lock protection, drafting settings persistence, grayscale canvas pixels in both themes, mobile layout, A4 dimension fixture.",
  );
} finally {
  await browser.close();
}
