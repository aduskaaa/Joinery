import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.PLAYWRIGHT_MODULE).href
    : "playwright"
);
const base = process.env.BASE_URL || "http://localhost:8080/";
const artifacts = process.env.BROWSER_ARTIFACTS || tmpdir();
await mkdir(artifacts, { recursive: true });
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
page.on("pageerror", (error) => errors.push(error.message));
page.on("request", (request) => {
  if (
    !request.url().startsWith(appRoot) &&
    !request.url().startsWith("data:") &&
    !request.url().startsWith("blob:")
  )
    external.push(request.url());
});

const rectangle = (id, x, y, width, height) => ({
  id,
  type: "rectangle",
  name: id,
  layer: "panels",
  closed: true,
  points: [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ],
});
const stock = () => ({
  ...rectangle("stock", 0, 0, 300, 200),
  type: "panel",
  name: "Oak door",
  material: "18 mm Oak plywood",
  thickness: 18,
  quantity: 2,
  banding: [1, 2, 0, 1],
});
const circle = (id, x, y, radius) => ({
  id,
  type: "circle",
  name: id,
  layer: "panels",
  center: { x, y },
  radius,
});

// Only fixture creation touches the debugging API. Selection, operations and
// exports below use real pointer events, keyboard events and UI controls.
const seed = async (entities) => {
  assert.equal(
    await page.evaluate((next) => {
      joinery.chooseTool("select");
      joinery.selection.clear();
      const ok = joinery.commit(() => {
        joinery.project = Joinery.Model.emptyProject();
        joinery.project.name = "Boolean browser regression";
        joinery.project.settings.grid = false;
        joinery.project.settings.object = false;
        joinery.project.entities = next;
      });
      joinery.history.clear();
      joinery.render();
      joinery.canvas.fit();
      return ok;
    }, entities),
    true,
    "fixture must be a valid project",
  );
};
const worldClick = async (x, y) => {
  const q = await page.evaluate(
    (p) => {
      const s = joinery.canvas.toScreen(p);
      const r = joinery.canvas.canvas.getBoundingClientRect();
      return {
        x: s.x + r.left,
        y: s.y + r.top,
        inside: s.x > 1 && s.y > 1 && s.x < r.width - 1 && s.y < r.height - 1,
      };
    },
    { x, y },
  );
  assert.ok(q.inside, `world click (${x}, ${y}) must be inside the canvas`);
  await page.mouse.click(q.x, q.y);
};
const choose = async (operation) => {
  await page.locator('[data-tool="boolean"]').click();
  await page.locator(`[data-boolean-tool="${operation}"]`).click();
  await page.locator("#boolean-apply").waitFor({ state: "visible" });
};
const entities = () =>
  page.evaluate(() => structuredClone(joinery.project.entities));
const selection = () => page.evaluate(() => [...joinery.selection]);
const area = (e) =>
  e.polygons.reduce(
    (total, polygon) =>
      total +
      polygon.reduce((sum, ring, index) => {
        const twice = ring.reduce((a, p, i) => {
          const q = ring[(i + 1) % ring.length];
          return a + p.x * q.y - p.y * q.x;
        }, 0);
        return sum + ((index ? -1 : 1) * Math.abs(twice)) / 2;
      }, 0),
    0,
  );
const close = (actual, expected, epsilon = 1e-6) =>
  assert.ok(
    Math.abs(actual - expected) <= epsilon,
    `expected ${actual} to be within ${epsilon} of ${expected}`,
  );
const contourCount = (e) => e.polygons.reduce((n, p) => n + p.length, 0);
const assertCompound = (e, expectedArea, islands = 2, contours = 4) => {
  assert.equal(e.type, "region");
  assert.equal(e.polygons.length, islands);
  assert.equal(contourCount(e), contours);
  close(area(e), expectedArea);
};
const assertTransformed = (before, after, fn) => {
  assert.equal(after.polygons.length, before.polygons.length);
  for (let p = 0; p < before.polygons.length; p++) {
    assert.equal(after.polygons[p].length, before.polygons[p].length);
    for (let r = 0; r < before.polygons[p].length; r++) {
      assert.equal(after.polygons[p][r].length, before.polygons[p][r].length);
      for (let i = 0; i < before.polygons[p][r].length; i++) {
        const expected = fn(before.polygons[p][r][i]);
        // Browser pointer coordinates have float precision; 1 µm remains much
        // tighter than the configurable 0.01 mm curved-outline tolerance.
        close(after.polygons[p][r][i].x, expected.x, 0.001);
        close(after.polygons[p][r][i].y, expected.y, 0.001);
      }
    }
  }
};
const download = async (format) => {
  await page.locator("#export").click();
  const pending = page.waitForEvent("download");
  if (format === "svg") {
    await page.evaluate(() => {
      joinery.exportFile("svg");
      document.getElementById("app-dialog").close();
    });
  } else await page.locator(`[data-format="${format}"]`).click();
  if (format === "pdf") {
    await page.locator("#dialog-form button[type=submit]").click();
    await page.locator("#preview-download").click();
    await page.locator("#dialog-close").click();
  }
  const file = await pending;
  assert.ok(file.suggestedFilename().endsWith(`.${format}`));
  const path = join(artifacts, `joinery-boolean.${format}`);
  await file.saveAs(path);
  return readFile(path, "utf8");
};

try {
  await page.goto(base);
  await page.waitForFunction(
    () => window.joinery?.tools && window.Joinery?.Boolean,
  );

  // A real nested circle cut leaves a hole, preserves the woodworking stock,
  // and remains a single undoable action instead of an annotation overlay.
  await seed([stock(), circle("hinge", 150, 100, 25)]);
  const original = await entities();
  await choose("difference");
  await worldClick(20, 20);
  await worldClick(175, 100); // Circle boundary, not an ambiguous interior pick.
  assert.deepEqual(await selection(), ["stock", "hinge"]);
  assert.equal(await page.locator("#boolean-base").inputValue(), "stock");
  assert.equal(await page.locator("#boolean-apply").isDisabled(), false);
  assert.deepEqual(
    await entities(),
    original,
    "preview must not mutate operands",
  );
  assert.equal(
    await page.evaluate(() => joinery.canvas.preview[0]?.polygons[0].length),
    2,
  );
  await worldClick(175, 100);
  assert.deepEqual(
    await selection(),
    ["stock"],
    "clicking an operand again removes it",
  );
  assert.equal(await page.locator("#boolean-apply").isDisabled(), true);
  await worldClick(175, 100);
  assert.deepEqual(await selection(), ["stock", "hinge"]);
  await page.screenshot({
    path: join(artifacts, "joinery-boolean-preview.png"),
  });
  await page.locator("#boolean-apply").click();
  const firstCut = await entities();
  assert.equal(firstCut.length, 1);
  assert.equal(firstCut[0].type, "region");
  assert.equal(firstCut[0].polygons.length, 1);
  assert.equal(firstCut[0].polygons[0].length, 2);
  close(area(firstCut[0]), 60000 - Math.PI * 25 ** 2, 5);
  close(
    await page.evaluate(() =>
      Joinery.Boolean.polygonArea(joinery.project.entities[0].polygons),
    ),
    area(firstCut[0]),
  );
  assert.deepEqual(firstCut[0].stockPoints, original[0].points);
  assert.deepEqual(firstCut[0].part, {
    material: original[0].material,
    thickness: 18,
    quantity: 2,
    banding: original[0].banding,
  });
  assert.equal(await page.locator("[data-part]").count(), 1);
  await page.locator('[data-tool="select"]').click();
  await worldClick(150, 100);
  assert.deepEqual(
    await selection(),
    [],
    "a hole must not select surrounding material",
  );
  await worldClick(20, 20);
  assert.deepEqual(await selection(), [firstCut[0].id]);
  await page.locator("#undo").click();
  assert.deepEqual(await entities(), original);
  await page.locator("#redo").click();
  assert.deepEqual(await entities(), firstCut);

  // Cut the result again using an actual drawn cutter and the same workflow.
  await page.locator('[data-tool="circle"]').click();
  await page.locator('[data-option="radius"]').fill("15");
  await worldClick(235, 100);
  await worldClick(250, 100);
  await page.locator('[data-tool="select"]').click();
  await worldClick(310, 20);
  await choose("difference");
  await worldClick(20, 20);
  await worldClick(250, 100);
  await page.locator("#boolean-apply").click();
  const repeatedCut = (await entities())[0];
  assert.equal(repeatedCut.polygons[0].length, 3);
  close(area(repeatedCut), 60000 - Math.PI * (25 ** 2 + 15 ** 2), 7);
  assert.deepEqual(repeatedCut.stockPoints, original[0].points);
  await page.locator('[data-tool="select"]').click();
  await worldClick(235, 100);
  assert.deepEqual(await selection(), []);
  await page.screenshot({ path: join(artifacts, "joinery-boolean-holes.png") });

  // Subtraction order is explicit, editable, and supports retaining cutters.
  await seed([
    rectangle("left", 0, 0, 100, 80),
    rectangle("right", 60, 0, 100, 80),
  ]);
  await choose("difference");
  await worldClick(10, 40);
  await worldClick(150, 40);
  assert.deepEqual(await selection(), ["left", "right"]);
  await page.locator("#boolean-base").selectOption("right");
  assert.equal((await selection())[0], "right");
  await page.locator("#boolean-keep").check();
  await page.locator("#boolean-apply").click();
  const kept = await entities();
  assert.equal(kept.length, 2);
  assert.deepEqual(
    kept.find((e) => e.id === "left"),
    rectangle("left", 0, 0, 100, 80),
  );
  const rightRemainder = kept.find((e) => e.type === "region");
  close(area(rightRemainder), 4800);
  assert.ok(rightRemainder.polygons.flat(2).every((p) => p.x >= 100 - 1e-6));

  for (const [operation, expectedArea, islands] of [
    ["union", 12800, 1],
    ["intersection", 3200, 1],
    ["xor", 9600, 2],
  ]) {
    await seed([
      rectangle("left", 0, 0, 100, 80),
      rectangle("right", 60, 0, 100, 80),
    ]);
    await choose(operation);
    await worldClick(10, 40);
    await worldClick(150, 40);
    if (operation === "xor") await page.keyboard.press("Enter");
    else await page.locator("#boolean-apply").click();
    const result = await entities();
    assert.equal(result.length, 1);
    assertCompound(result[0], expectedArea, islands, islands);
  }

  // Empty intersections and cancellation are non-destructive.
  await seed([
    rectangle("left", 0, 0, 100, 80),
    rectangle("right", 180, 0, 100, 80),
  ]);
  const disjointOriginal = await entities();
  await choose("intersection");
  await worldClick(20, 40);
  await worldClick(200, 40);
  assert.equal(await page.locator("#boolean-apply").isDisabled(), true);
  await page.locator("#cad-canvas").focus();
  await page.keyboard.press("Enter");
  assert.deepEqual(await entities(), disjointOriginal);
  assert.equal(await page.evaluate(() => joinery.history.undoStack.length), 0);
  await page.locator("#boolean-cancel").click();
  assert.deepEqual(await entities(), disjointOriginal);
  assert.equal(await page.evaluate(() => joinery.tools.active), "select");

  // A single compound object can hold disconnected islands and real holes.
  // Copy, rotation, mirror and array must transform every ring of every island.
  await seed([repeatedCut, rectangle("island", 380, 0, 40, 40)]);
  await choose("union");
  await worldClick(20, 20);
  await worldClick(400, 20);
  await page.locator("#boolean-apply").click();
  const compound = (await entities())[0];
  const compoundArea = area(repeatedCut) + 1600;
  assertCompound(compound, compoundArea);
  await page.locator('[data-tool="copy"]').click();
  await worldClick(20, 20);
  await worldClick(40, 20);
  const copied = await entities();
  assert.equal(copied.length, 2);
  const copy = copied.find((e) => e.id !== compound.id);
  assertCompound(copy, compoundArea);
  assertTransformed(compound, copy, (p) => ({ x: p.x + 20, y: p.y }));
  assert.deepEqual(await selection(), [copy.id]);

  await page.locator("#inspect-edit").click();
  await page.locator('[data-operation="rotate"]').click();
  await page.locator('[name="degrees"]').fill("90");
  await page.locator("#dialog-form button[type=submit]").click();
  const rotated = (await entities()).find((e) => e.id === copy.id);
  assertCompound(rotated, compoundArea);
  // The copied region spans x=20..440 and y=0..200: its pivot is (230,100).
  assertTransformed(copy, rotated, (p) => ({
    x: 230 - (p.y - 100),
    y: 100 + (p.x - 230),
  }));

  // Fit is navigation only; the actual mirror axis is specified by clicks.
  await page.evaluate(() => joinery.canvas.fit());
  await page.locator("#inspect-edit").click();
  await page.locator('[data-operation="mirror"]').click();
  await worldClick(230, 0);
  await worldClick(230, 200);
  const mirrored = (await entities()).find((e) => e.id === copy.id);
  assertCompound(mirrored, compoundArea);
  assertTransformed(rotated, mirrored, (p) => ({ x: 460 - p.x, y: p.y }));

  await page.locator("#inspect-edit").click();
  await page.locator('[data-operation="array"]').click();
  for (const [field, value] of [
    ["columns", "2"],
    ["rows", "2"],
    ["dx", "480"],
    ["dy", "450"],
  ])
    await page.locator(`[name="${field}"]`).fill(value);
  await page.locator("#dialog-form button[type=submit]").click();
  const array = await entities();
  assert.equal(array.length, 5);
  array.forEach((e) => assertCompound(e, compoundArea));
  for (const shift of [
    { x: 480, y: 0 },
    { x: 0, y: 450 },
    { x: 480, y: 450 },
  ]) {
    assert.ok(
      array.some((e) => {
        const a = e.polygons[0][0][0],
          b = mirrored.polygons[0][0][0];
        return (
          Math.abs(a.x - b.x - shift.x) < 1e-6 &&
          Math.abs(a.y - b.y - shift.y) < 1e-6
        );
      }),
      `array must contain translated compound ${JSON.stringify(shift)}`,
    );
  }

  // Reload uses autosaved validated data, and actual downloaded manufacturing
  // files contain all outer and inner contours rather than bounding boxes.
  await page.locator('[data-tool="select"]').click();
  await page.evaluate(() => joinery.canvas.fit());
  await page.waitForTimeout(450);
  const saved = await entities();
  await page.reload();
  await page.waitForFunction(
    () => window.joinery?.tools && window.Joinery?.Boolean,
  );
  assert.deepEqual(await entities(), saved);
  await page.screenshot({
    path: join(artifacts, "joinery-boolean-compounds.png"),
  });

  const totalContours = saved.reduce((n, e) => n + contourCount(e), 0);
  const svg = await download("svg");
  assert.ok(svg.includes('fill-rule="evenodd"'));
  assert.ok((svg.match(/\bZ\b/g) || []).length >= totalContours);
  const pdf = await download("pdf");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.ok((pdf.match(/\bh\b/g) || []).length >= totalContours);
  const dxf = await download("dxf");
  assert.ok((dxf.match(/\nLWPOLYLINE\n/g) || []).length >= totalContours);
  const roundTrip = await page.evaluate(
    (source) => Joinery.Woodworking.importDXF(source).project.entities,
    dxf,
  );
  assert.equal(roundTrip.length, saved.length);
  assert.deepEqual(
    roundTrip.map((e) => e.polygons),
    saved.map((e) => e.polygons),
  );
  roundTrip.forEach((e) => assertCompound(e, compoundArea));
  const projectJSON = JSON.parse(await download("json"));
  assert.deepEqual(projectJSON.entities, saved);

  // A compound drawing can be assigned stock and edited through the ordinary
  // inspector; dimensions scale the real hole geometry with the stock axes.
  const editable = (await entities())[0];
  await seed([editable]);
  const selectPoint = editable.polygons[0][0][0];
  await worldClick(selectPoint.x, selectPoint.y);
  await page.locator("#assign-region-part").click();
  await page.locator('[name="material"]').fill("Birch plywood");
  await page.locator('[name="thickness"]').fill("15");
  await page.locator('[name="quantity"]').fill("3");
  await page.locator("#dialog-form button[type=submit]").click();
  const assigned = (await entities())[0];
  assert.equal(assigned.part.material, "Birch plywood");
  assert.equal(assigned.part.thickness, 15);
  assert.equal(assigned.part.quantity, 3);
  assert.equal(await page.locator("[data-part]").count(), 1);
  const blank = await page.evaluate(() =>
    Joinery.Model.panelSize(joinery.project.entities[0]),
  );
  const origin = assigned.stockPoints[0];
  await page.locator('[data-prop="width"]').fill(String(blank.width * 1.5));
  await page.locator('[data-prop="width"]').press("Tab");
  const scaled = (await entities())[0];
  assertTransformed(assigned, scaled, (p) => ({
    x: origin.x + (p.x - origin.x) * 1.5,
    y: p.y,
  }));
  await page.locator('[data-prop="material"]').fill("Oak");
  await page.locator('[data-prop="material"]').press("Tab");
  await page.locator('[data-prop="quantity"]').fill("4");
  await page.locator('[data-prop="quantity"]').press("Tab");
  await page.locator('[data-edge="0"]').click();
  const edited = (await entities())[0];
  assert.equal(edited.part.material, "Oak");
  assert.equal(edited.part.quantity, 4);
  assert.equal(edited.part.banding[0], 1);
  assert.deepEqual(edited.polygons, scaled.polygons);

  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log(
    "PASS: real Boolean pointer selection, circle holes, non-destructive preview, metadata, undo/redo, repeated cuts, editable subtraction base, retained cutters, union/intersection/XOR, safe empty intersections/cancel, disconnected compound copy/rotation/mirror/array, autosave reload, SVG/PDF/DXF/project downloads with all contours, and no browser errors or external requests.",
  );
} finally {
  await browser.close();
}
