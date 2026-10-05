import "../src/vendor/polygon-clipping.umd.js";
import {
  emptyProject,
  uid,
  panel,
  primitives,
  cutList,
  bomSummary,
  exportCSV,
  exportDXF,
  importDXF,
  exportSVG,
  exportPDF,
} from "./support.js";
import test from "node:test";
import assert from "node:assert/strict";

const rectangle = (x, y, w, h) => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];
function regionProject(withPart = false) {
  const project = emptyProject();
  project.name = "Machined cabinet side";
  const region = {
    id: uid(),
    type: "region",
    layer: "panels",
    name: "Cabinet side",
    polygons: [
      [rectangle(0, 0, 600, 500), rectangle(100, 100, 100, 100).reverse()],
      [rectangle(700, 0, 100, 500)],
    ],
  };
  if (withPart) {
    region.stockPoints = rectangle(0, 0, 800, 500);
    region.part = {
      thickness: 18,
      material: "Oak plywood",
      quantity: 2,
      banding: [1, 2, 0, 2],
    };
  }
  project.entities = [region];
  return project;
}

test("region primitives retain holes and islands as one compound shape", () => {
  const project = regionProject(true),
    entity = project.entities[0],
    list = primitives(entity);
  assert.equal(list.length, 1);
  assert.equal(list[0].kind, "region");
  assert.equal(list[0].fill, "region");
  assert.deepEqual(list[0].polygons, entity.polygons);
  assert.ok(
    !list.some((p) => p.banding),
    "Removed stock edges have no banding strokes",
  );
});

test("SVG exports a compound even-odd path with holes and disconnected islands", () => {
  const svg = exportSVG(regionProject());
  const compound = svg.match(/<path d="([^"]*)"[^>]*fill-rule="evenodd"/);
  assert.ok(compound);
  assert.equal((compound[1].match(/M/g) || []).length, 3);
  assert.equal((compound[1].match(/ Z/g) || []).length, 3);
  assert.ok(svg.includes('width="880mm"'));
  assert.ok(svg.includes('height="580mm"'));
  assert.ok(!/NaN|Infinity|undefined/.test(svg));
});

test("PDF fills and strokes every region contour using the even-odd operator", () => {
  const pdf = new TextDecoder().decode(exportPDF(regionProject()));
  const compound = pdf.split("\n").find((line) => line.endsWith(" B*"));
  assert.ok(compound);
  assert.equal((compound.match(/ m/g) || []).length, 3);
  assert.equal((compound.match(/ h/g) || []).length, 3);
  assert.ok(!/NaN|Infinity|undefined/.test(pdf));
  const stream = pdf.match(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/);
  assert.equal(+stream[1], stream[2].length);
});

test("DXF restores exact region topology and woodworking metadata without duplicate contours", () => {
  const original = regionProject(true),
    dxf = exportDXF(original),
    restored = importDXF(dxf).project;
  assert.equal((dxf.match(/\nLWPOLYLINE\n/g) || []).length, 3);
  const records = dxf.slice(dxf.indexOf("2\nENTITIES\n"));
  assert.equal((records.match(/\n70\n1\n/g) || []).length, 3);
  assert.equal((dxf.match(/\n1000\nSKIP\n/g) || []).length, 2);
  assert.equal(restored.entities.length, 1);
  assert.equal(restored.entities[0].type, "region");
  assert.deepEqual(
    restored.entities[0].polygons,
    original.entities[0].polygons,
  );
  assert.deepEqual(
    restored.entities[0].stockPoints,
    original.entities[0].stockPoints,
  );
  assert.deepEqual(restored.entities[0].part, original.entities[0].part);
  assert.deepEqual(
    cutList(restored).map(({ id, ...row }) => row),
    cutList(original).map(({ id, ...row }) => row),
  );
});

test("DXF exposes closed hole and island outlines to CAD readers without Joinery metadata", () => {
  const dxf = exportDXF(regionProject()).replace(
    /1001\nJOINERY\n(?:1000\n[^\n]*\n)+/g,
    "",
  );
  const restored = importDXF(dxf).project;
  assert.equal(restored.entities.length, 3);
  assert.ok(restored.entities.every((e) => e.type === "polyline" && e.closed));
  assert.ok(restored.entities.every((e) => e.points.length === 4));
});

test("machined region cut list retains original blank dimensions, quantity and edge metadata", () => {
  const project = regionProject(true),
    row = cutList(project)[0],
    summary = bomSummary(project);
  assert.equal(row.name, "Cabinet side");
  assert.deepEqual(
    [row.length, row.width, row.thickness, row.quantity, row.material],
    [800, 500, 18, 2, "Oak plywood"],
  );
  assert.deepEqual(row.banding, { bottom: 1, right: 2, top: 0, left: 2 });
  assert.equal(row.edgeBanding, "B:1mm R:2mm L:2mm");
  assert.equal(summary.quantity, 2);
  assert.equal(summary.area, undefined);
  assert.equal(summary.banding, undefined);
  assert.ok(
    exportCSV(project).includes(
      '"800","500","18","2","Oak plywood","1","2","0","2"',
    ),
  );
});

test("rotated stock metadata uses its physical dimensions and generic boolean regions are omitted from BOM", () => {
  const project = regionProject(true),
    entity = project.entities[0];
  entity.stockPoints = entity.stockPoints.map(({ x, y }) => ({
    x: 25 - y,
    y: 40 + x,
  }));
  assert.equal(cutList(project)[0].length, 800);
  assert.equal(cutList(project)[0].width, 500);
  project.entities.push({ ...regionProject().entities[0], id: uid() });
  project.entities.push(panel(1000, 0, 400, 200));
  assert.equal(cutList(project).length, 2);
  assert.equal(cutList(regionProject()).length, 0);
});

test("SVG and PDF omit regions on hidden layers", () => {
  const project = regionProject();
  project.layers.find((l) => l.id === "panels").visible = false;
  assert.ok(!exportSVG(project).includes('fill-rule="evenodd"'));
  assert.ok(!new TextDecoder().decode(exportPDF(project)).includes(" B*"));
});
