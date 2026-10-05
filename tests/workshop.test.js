import test from "node:test";
import assert from "node:assert/strict";
import {
  demoProject,
  emptyProject,
  normalizeBasicLayers,
  panel,
  validateProject,
  exportPDF,
  pdfText,
  exportDXF,
  exportSVG,
  importDXF,
  cutList,
  materialConsumption,
  isPart,
  panelSize,
  pointInRegion,
  dimensionGeometry,
  transformEntity,
  rotatePoint,
  primitives,
  Tools,
} from "./support.js";

test("custom layers, title block and drafting defaults survive validation and project round-trip", () => {
  const p = emptyProject();
  assert.equal(p.layers.length, 1);
  assert.equal(p.layers[0].name, "Vrstva 1");
  p.layers[0].name = "Čelní pohled";
  p.settings.titleBlock = {
    author: "Čermák Jiří",
    title: "Stůl – příčný řez",
    number: "V-001",
    revision: "B",
  };
  p.settings.dimensionTermination = "filled";
  const restored = validateProject(JSON.parse(JSON.stringify(p)));
  assert.equal(restored.layers[0].name, "Čelní pohled");
  assert.equal(restored.settings.titleBlock.author, "Čermák Jiří");
  assert.equal(restored.settings.dimensionTermination, "filled");
  const text = pdfText(exportPDF(restored));
  for (const value of [
    "Čermák Jiří",
    "Stůl – příčný řez",
    "V-001",
    "Revize\nB",
    "List\n1 / 1",
    "Formát\nA3",
  ])
    assert.ok(text.includes(value), value);
});

test("section hatches respect Boolean holes and rotated part geometry", () => {
  const stock = panel(0, 0, 100, 60);
  stock.materialKind = "solid-cross";
  const polygons = Joinery.Boolean.booleanPolygons(
    "difference",
    [stock, { type: "circle", center: { x: 50, y: 30 }, radius: 12 }],
    { tolerance: 0.01 },
  );
  const region = {
    type: "region",
    polygons,
    stockPoints: stock.points,
    part: stock,
  };
  for (const e of [
    region,
    transformEntity(region, (p) => rotatePoint(p, { x: 0, y: 0 }, 0.4)),
  ]) {
    const hatches = Joinery.Hatching.primitives(e, 2).filter((p) => p.hatch);
    assert.ok(hatches.length > 10);
    for (const p of hatches) {
      const midpoint = {
        x: (p.points[0].x + p.points[1].x) / 2,
        y: (p.points[0].y + p.points[1].y) / 2,
      };
      assert.ok(
        pointInRegion(midpoint, e.polygons),
        "a hatch crossed a cutout",
      );
    }
  }
});

test("all requested materials retain their designation in manufacturing exports", () => {
  const p = emptyProject();
  p.entities = Joinery.Materials.kinds.map((kind, i) => ({
    ...panel(i * 130, 0, 100, 60),
    materialKind: kind.id,
    material: kind.name,
  }));
  const restored = importDXF(exportDXF(p)).project;
  assert.deepEqual(
    cutList(restored).map((r) => r.materialKind),
    Joinery.Materials.kinds.map((k) => k.id),
  );
  for (const e of p.entities) {
    const items = Joinery.Scene.primitives(e);
    assert.ok(items.some((p) => p.hatch));
    assert.ok(!items.some((p) => p.materialTag));
  }
});

test("three dimension terminations preserve measured points and connected witness lines", () => {
  const e = {
    type: "dimension",
    mode: "horizontal",
    points: [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 0, y: 20 },
    ],
  };
  for (const termination of ["slash", "open", "filled"]) {
    const g = dimensionGeometry(e, { paperScale: 2, termination });
    assert.equal(g.value, 40);
    assert.deepEqual(g.points, [
      { x: 0, y: 20 },
      { x: 40, y: 20 },
    ]);
    assert.ok(g.segments[0][1].y > 20);
    assert.ok(g.segments[1][1].y > 20);
    assert.equal(g.symbols.length, termination === "filled" ? 2 : 0);
  }
});

test("PDF preview uses the same drawing, title block, Czech text and material marks as the download", () => {
  const p = emptyProject();
  p.name = "Židle č. 1";
  p.entities = [
    { ...panel(0, 0, 40, 150), materialKind: "laminate", material: "Lamino" },
  ];
  p.settings.titleBlock = { author: "Jiří Čermák", number: "Ž-01" };
  const result = exportPDF(p, { paper: "A4", preview: true });
  assert.ok(result.bytes instanceof Uint8Array);
  const text = pdfText(result.bytes);
  for (const value of [p.name, "Jiří Čermák", "Ž-01", "DTD-L", "Lamino"]) {
    assert.ok(text.includes(value));
    assert.ok(result.svg.includes(value));
  }
  assert.ok(result.svg.includes("@font-face"));
  assert.ok(
    result.svg.includes('fill-rule="evenodd"') ||
      result.svg.includes('stroke="rgb(0,0,0)"'),
  );
  assert.doesNotMatch(result.svg, /<script|(?:href|src)="https?:/);
});

test("demoProject retains only Layer 1 with all entities assigned to it", () => {
  const p = demoProject();
  assert.equal(p.layers.length, 1);
  assert.equal(p.layers[0].name, "Vrstva 1");
  assert.ok(p.entities.length > 0);
  assert.ok(p.entities.every((e) => e.layer === p.layers[0].id));
});

test("normalizeBasicLayers removes legacy basic layers and moves entities to Layer 1", () => {
  const p = {
    version: 1,
    name: "Legacy Project",
    layers: [
      { id: "panels", name: "Panels", color: "#cccccc", visible: true, locked: false },
      { id: "joinery", name: "Joinery", color: "#cccccc", visible: true, locked: false },
      { id: "drilling", name: "Drilling", color: "#cccccc", visible: true, locked: false },
      { id: "dimensions", name: "Dimensions", color: "#cccccc", visible: true, locked: false },
    ],
    entities: [
      { id: "p1", type: "panel", layer: "panels", points: [{x:0, y:0}], width: 100, height: 100, thickness: 18 },
      { id: "d1", type: "drill", layer: "drilling", center: {x:10, y:10}, radius: 5 },
      { id: "c1", type: "cutout", layer: "joinery", points: [{x:0,y:0}], closed: true },
      { id: "dim1", type: "dimension", layer: "dimensions", points: [{x:0,y:0},{x:10,y:0},{x:0,y:5}] }
    ],
    settings: { units: "mm", grid: true, object: true, ortho: false, gridSize: 10 }
  };
  const normalized = normalizeBasicLayers(p);
  assert.equal(normalized.layers.length, 1);
  assert.equal(normalized.layers[0].name, "Vrstva 1");
  assert.equal(normalized.layers[0].id, "panels");
  assert.ok(normalized.entities.every((e) => e.layer === "panels"));
});

test("rectangle tool draws with two clicks and supports shift square constraint", () => {
  const added = [];
  const fakeApp = {
    canvas: {
      pick: () => null,
      visibleEntities: () => [],
      preview: [],
      snap: null,
      invalidate: () => {},
      zoom: 1,
    },
    project: {
      settings: { grid: false, object: false, ortho: false, gridSize: 10, units: "mm" },
      layers: [{ id: "panels", name: "Vrstva 1", visible: true, locked: false }],
      entities: [],
    },
    activeLayer: "panels",
    selection: new Set(),
    updateToolUI: () => {},
    coordinates: () => {},
    toast: () => {},
    add: (entities) => added.push(...entities),
  };
  const tools = new Tools(fakeApp);
  tools.set("rectangle");

  // Two click interactive
  tools.click({ x: 0, y: 0 });
  assert.equal(tools.points.length, 1);
  tools.click({ x: 120, y: 80 });
  assert.equal(tools.points.length, 0);
  assert.equal(added.length, 1);
  assert.deepEqual(added[0].points, [
    { x: 0, y: 0 },
    { x: 120, y: 0 },
    { x: 120, y: 80 },
    { x: 0, y: 80 },
  ]);

  // Shift key square constraint
  added.length = 0;
  tools.click({ x: 10, y: 20 });
  tools.click({ x: 110, y: 40 }, { shiftKey: true });
  assert.equal(added.length, 1);
  assert.deepEqual(added[0].points, [
    { x: 10, y: 20 },
    { x: 110, y: 20 },
    { x: 110, y: 120 },
    { x: 10, y: 120 },
  ]);

  // Custom size 1-click placement
  added.length = 0;
  tools.options.rectWidth = 400;
  tools.options.rectHeight = 250;
  tools.click({ x: 50, y: 60 });
  assert.equal(added.length, 1);
  assert.deepEqual(added[0].points, [
    { x: 50, y: 60 },
    { x: 450, y: 60 },
    { x: 450, y: 310 },
    { x: 50, y: 310 },
  ]);

  // Drag-and-release
  added.length = 0;
  tools.options.rectWidth = "";
  tools.options.rectHeight = "";
  tools.click({ x: 5, y: 5 });
  assert.equal(tools.points.length, 1);
  tools.dragEnd({ x: 55, y: 35 });
  assert.equal(tools.points.length, 0);
  assert.equal(added.length, 1);
  assert.deepEqual(added[0].points, [
    { x: 5, y: 5 },
    { x: 55, y: 5 },
    { x: 55, y: 35 },
    { x: 5, y: 35 },
  ]);
});

test("polyline tool automatically closes when clicking near start point and sets closed object properties", () => {
  const added = [];
  const fakeApp = {
    canvas: {
      pick: () => null,
      visibleEntities: () => [],
      preview: [],
      snap: null,
      invalidate: () => {},
      zoom: 1,
    },
    project: {
      settings: { grid: false, object: false, ortho: false, gridSize: 10, units: "mm" },
      layers: [{ id: "layer1", name: "Vrstva 1", visible: true, locked: false }],
      entities: [],
    },
    activeLayer: "layer1",
    selection: new Set(),
    updateToolUI: () => {},
    coordinates: () => {},
    toast: () => {},
    add: (entities) => added.push(...entities),
  };
  const tools = new Tools(fakeApp);
  tools.set("polyline");
  tools.click({ x: 0, y: 0 });
  tools.click({ x: 200, y: 0 });
  tools.click({ x: 200, y: 150 });
  tools.click({ x: 0, y: 150 });
  // Click back on start point
  tools.click({ x: 0, y: 0 });
  assert.equal(added.length, 1);
  assert.equal(added[0].type, "polyline");
  assert.equal(added[0].closed, true);
  assert.equal(added[0].points.length, 4);
  assert.ok(isPart(added[0]));
  const size = panelSize(added[0]);
  assert.equal(size.width, 200);
  assert.equal(size.height, 150);
});

test("closed polyline is included in cutList and respects thickness, quantity and material", () => {
  const p = emptyProject();
  p.entities.push({
    id: "poly1",
    type: "polyline",
    layer: p.layers[0].id,
    closed: true,
    name: "Lichoběžník",
    thickness: 19,
    quantity: 2,
    material: "Dub masiv",
    materialKind: "solid-wood",
    banding: [0, 0, 0, 0],
    points: [
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ],
  });
  const list = cutList(p);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Lichoběžník");
  assert.equal(list[0].length, 300);
  assert.equal(list[0].width, 100);
  assert.equal(list[0].thickness, 19);
  assert.equal(list[0].quantity, 2);
  assert.equal(list[0].material, "Dub masiv");
});

test("user can add manual cutlist items and they are included in cutList and material consumption", () => {
  const p = emptyProject();
  p.customCutlist = [
    {
      id: "custom-1",
      name: "Dno zásuvky",
      length: 500,
      width: 400,
      thickness: 4,
      quantity: 3,
      material: "Sololit bílý",
      materialKind: "hdf",
      edgeBanding: "—",
    },
  ];
  const list = cutList(p);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Dno zásuvky");
  assert.equal(list[0].length, 500);
  assert.equal(list[0].width, 400);
  assert.equal(list[0].custom, true);

  const consumption = materialConsumption(p);
  assert.equal(consumption.items.length, 1);
  assert.equal(consumption.items[0].name, "Dno zásuvky");
  assert.equal(consumption.items[0].pieceNet, 0.2);
  assert.equal(consumption.items[0].rowNet, 0.6);
  assert.equal(consumption.totalNetArea, 0.6);
});

test("material consumption calculates piece share, total net area, gross with waste, and sheet count", () => {
  const p = emptyProject();
  p.entities.push({
    id: "p1",
    type: "panel",
    layer: p.layers[0].id,
    name: "Bok",
    thickness: 18,
    quantity: 2,
    material: "Lamino bílé",
    materialKind: "laminate",
    points: [
      { x: 0, y: 0 },
      { x: 1000, y: 0 },
      { x: 1000, y: 500 },
      { x: 0, y: 500 },
    ],
  });
  const c = materialConsumption(p);
  assert.equal(c.sheetWidth, 2800);
  assert.equal(c.sheetHeight, 2070);
  assert.equal(c.items[0].pieceNet, 0.5);
  assert.equal(c.items[0].rowNet, 1.0);
  assert.equal(c.totalNetArea, 1.0);
  assert.equal(c.totalGrossArea, 1.1);
  assert.equal(c.sheetsCount, 1);
  assert.equal(c.materialSummary.length, 1);
  assert.equal(c.materialSummary[0].material, "Lamino bílé");
});

test("PDF export produces a 2-page document with Page 2 containing cutlist and material consumption", () => {
  const p = demoProject();
  p.customCutlist = [
    {
      id: "c-test",
      name: "Ruční police",
      length: 800,
      width: 300,
      thickness: 18,
      quantity: 1,
      material: "Dub masiv",
      edgeBanding: "Přední 2mm",
    },
  ];
  const { bytes, pages, svg } = exportPDF(p, { preview: true });
  assert.ok(pages);
  assert.equal(pages.length, 2);
  assert.equal(pages[0], svg);
  assert.ok(pages[1].toUpperCase().includes("KUSOVNÍK A SPOTŘEBA MATERIÁLU"));
  assert.ok(pages[1].toUpperCase().includes("SPOTŘEBA MATERIÁLU"));
  assert.ok(pages[1].includes("Ruční police"));

  const pdfString = Buffer.from(bytes).toString("latin1");
  assert.ok(pdfString.includes("/Count 2"));
  assert.ok(pdfString.includes("/Kids [3 0 R 10 0 R]"));
  const text = pdfText(bytes);
  assert.ok(text.includes("Kusovník") || text.includes("KUSOVNÍK"));
  assert.ok(text.includes("Spotřeba") || text.includes("SPOTŘEBA"));
});

test("text orientation supports vertical orientation and export in SVG, DXF, and PDF", () => {
  const p = emptyProject();
  p.entities.push({
    id: "t-vert",
    type: "text",
    layer: p.layers[0].id,
    text: "Svislý popisek",
    size: 16,
    orientation: "vertical",
    points: [{ x: 100, y: 100 }],
  });
  const svg = exportSVG(p);
  assert.ok(svg.includes('transform="rotate(-90 '));

  const dxf = exportDXF(p);
  assert.ok(dxf.includes("50\n90"));

  const pdf = exportPDF(p);
  const pdfStr = Buffer.from(pdf).toString("latin1");
  assert.ok(pdfStr.includes("0 1 -1 0"));

  const prims = primitives(p.entities[0], "mm");
  assert.equal(prims[0].orientation, "vertical");
});

test("hatching clips out and avoids text bounding box with margin", () => {
  const e = {
    id: "panel-hatch",
    type: "panel",
    layer: "layer1",
    materialKind: "solid-wood",
    points: [
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 0, y: 100 },
    ],
  };
  const textHole = [
    { x: 40, y: 40 },
    { x: 120, y: 40 },
    { x: 120, y: 60 },
    { x: 40, y: 60 },
  ];
  const itemsWithText = primitives(e, "mm", { textHoles: [textHole] });
  const hatches = itemsWithText.filter((p) => p.kind === "path" && p.thin);
  for (const h of hatches) {
    for (const pt of h.points) {
      const insideHole =
        pt.x > 40.01 && pt.x < 119.99 && pt.y > 40.01 && pt.y < 59.99;
      assert.ok(!insideHole, `Hatch point (${pt.x}, ${pt.y}) should not be inside text hole`);
    }
  }
});



