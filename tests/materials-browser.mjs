import assert from "node:assert/strict";
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
    joinery.project = Joinery.Model.emptyProject();
    joinery.project.entities = [
      Joinery.Model.panel(0, 0, 100, 200, 18, "Door", "Oak veneer"),
    ];
    joinery.project.settings.object = false;
    joinery.project.settings.grid = false;
    joinery.selection.clear();
    joinery.render();
    joinery.canvas.fit();
    joinery.select(joinery.project.entities[0].id);
  });
  await page
    .locator('[data-prop="materialKind"]')
    .selectOption("particleboard");
  assert.equal(
    await page.locator('[data-prop="material"]').inputValue(),
    "Oak veneer",
  );
  assert.match(await page.locator(".material-class-note").innerText(), /DTD/);
  await page.locator("#undo").click();
  assert.equal(
    await page.evaluate(() => joinery.project.entities[0].materialKind),
    undefined,
  );
  await page.locator("#redo").click();
  const click = async (x, y) => {
    const p = await page.evaluate(
      (p) => {
        const s = joinery.canvas.toScreen(p),
          r = joinery.canvas.canvas.getBoundingClientRect();
        return { x: s.x + r.left, y: s.y + r.top };
      },
      { x, y },
    );
    await page.mouse.click(p.x, p.y);
  };
  await page.locator('[data-tool="panel"]').click();
  await page.locator('[data-option="width"]').fill("100");
  await page.locator('[data-option="height"]').fill("200");
  await page.locator('[data-option="materialKind"]').selectOption("hardboard");
  await page.locator('[data-option="material"]').fill("Paint-grade MDF");
  await click(180, 0);
  assert.equal(
    await page.evaluate(() => joinery.project.entities[1].materialKind),
    "hardboard",
  );
  assert.equal(
    await page.evaluate(() => joinery.project.entities[1].material),
    "Paint-grade MDF",
  );
  await page.locator('[data-tab="cutlist"]').click();
  const table = await page.locator("#cutlist-table").innerText();
  assert.match(table, /DTD/);
  assert.match(table, /Sololit/);
  assert.equal(await page.locator("#cutlist-view th").count(), 8);
  await page.screenshot({ path: "/tmp/joinery-material-classes.png" });
  await page.locator('[data-tab="design"]').click();
  await page.evaluate(() => {
    const first = joinery.project.entities[0];
    joinery.add([
      {
        id: "bore",
        type: "circle",
        layer: "panels",
        center: { x: 50, y: 100 },
        radius: 10,
      },
    ]);
    joinery.select(first.id);
    joinery.select("bore", true);
  });
  await page.locator('[data-quick-boolean="difference"]').click();
  await page.locator("#boolean-apply").click();
  assert.equal(
    await page.evaluate(
      () =>
        joinery.project.entities.find((e) => e.type === "region").part
          .materialKind,
    ),
    "particleboard",
  );
  await page.locator('[data-prop="materialKind"]').selectOption("laminate");
  assert.equal(
    await page.evaluate(
      () =>
        joinery.project.entities.find((e) => e.type === "region").part
          .materialKind,
    ),
    "laminate",
  );
  assert.equal(
    await page.locator('[data-prop="material"]').inputValue(),
    "Oak veneer",
  );
  await page.evaluate(() => joinery.save());
  await page.reload();
  await page.waitForFunction(() => window.joinery);
  assert.equal(
    await page.evaluate(
      () =>
        joinery.project.entities.find((e) => e.type === "region").part
          .materialKind,
    ),
    "laminate",
  );
  // Picking uses the displayed geometry after dimension lines have been staggered.
  const pick = await page.evaluate(() => {
    const p = Joinery.Model.emptyProject();
    p.settings.grid = false;
    p.entities = [0, 13, 27].map((x, i) => ({
      id: `d${i}`,
      type: "dimension",
      layer: "panels",
      mode: "horizontal",
      points: [
        { x, y: 0 },
        { x: [13, 27, 40][i], y: 0 },
        { x, y: 20 },
      ],
    }));
    joinery.project = p;
    joinery.render();
    joinery.canvas.zoom = 1;
    joinery.canvas.render();
    const items = joinery.canvas.renderedScene.get("d1"),
      line = items[2].points;
    const midpoint = Joinery.Geometry.midpoint(...line);
    return { raised: line[0].y > 20, id: joinery.canvas.pick(midpoint)?.id };
  });
  assert.equal(pick.raised, true);
  assert.equal(pick.id, "d1");
  assert.deepEqual(errors, []);
  console.log(
    "PASS: material class menus, editable names, declared-class notes, undo/redo, panel creation, cut-list classifications, Boolean metadata, region inspector changes, reload and staggered dimension picking.",
  );
} finally {
  await browser.close();
}
