import {
  demoProject,
  validateProject,
  panel,
  uid,
  cutList,
  bomSummary,
  exportCSV,
  exportDXF,
  importDXF,
  exportSVG,
  exportPDF,
  jointGeometry,
} from "./support.js";
import test from "node:test";
import assert from "node:assert/strict";
test("cut list reports specifications without inferring material consumption", () => {
  const p = demoProject(),
    rows = cutList(p),
    s = bomSummary(p);
  assert.equal(rows.length, 3);
  assert.equal(s.quantity, 6);
  assert.equal(s.area, undefined);
  assert.equal(s.banding, undefined);
  assert.ok(rows.every((r) => !("area" in r) && !("bandingLength" in r)));
  assert.equal(rows[0].edgeBanding, "R:2mm");
});
test("DXF round trip retains all geometry, exact specs, quantities and edges", () => {
  const p = demoProject();
  const r = importDXF(exportDXF(p)).project;
  assert.equal(r.entities.length, p.entities.length);
  assert.deepEqual(
    cutList(r).map(({ id, ...rest }) => rest),
    cutList(p).map(({ id, ...rest }) => rest),
  );
  assert.deepEqual(
    r.entities.map((e) => e.type),
    p.entities.map((e) => e.type),
  );
});
test("DXF round trip covers arcs, slots, radius and angle annotations", () => {
  const p = demoProject();
  p.entities.push(
    {
      id: uid(),
      layer: "panels",
      type: "arc",
      center: { x: 10, y: 10 },
      radius: 25,
      start: 1,
      end: 4,
    },
    {
      id: uid(),
      layer: "panels",
      type: "slot",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
      width: 20,
      closed: true,
    },
    {
      id: uid(),
      layer: "dimensions",
      type: "radius",
      center: { x: 10, y: 10 },
      radius: 25,
      points: [{ x: 100, y: 100 }],
    },
    {
      id: uid(),
      layer: "dimensions",
      type: "angle",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 0, y: 100 },
      ],
    },
  );
  const r = importDXF(exportDXF(p)).project;
  assert.equal(r.entities.length, p.entities.length);
  assert.deepEqual(
    r.entities.map((e) => e.type),
    p.entities.map((e) => e.type),
  );
});
test("foreign DXF inches convert to mm and unsupported entities are reported", () => {
  const s =
    "0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n1\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n0\nLINE\n8\n0\n10\n0\n20\n0\n11\n10\n21\n0\n0\nSPLINE\n8\n0\n0\nENDSEC\n0\nEOF\n";
  const r = importDXF(s);
  assert.equal(r.project.entities[0].points[1].x, 254);
  assert.equal(r.skipped, 1);
});
test("DXF bulges import as curved polyline segments", () => {
  const s =
    "0\nSECTION\n2\nENTITIES\n0\nLWPOLYLINE\n8\n0\n90\n2\n70\n0\n10\n0\n20\n0\n42\n1\n10\n100\n20\n0\n0\nENDSEC\n0\nEOF\n";
  const r = importDXF(s).project.entities[0];
  assert.ok(r.points.length > 20);
  assert.ok(Math.abs(Math.min(...r.points.map((p) => p.y)) + 50) < 0.1);
});
test("CSV prevents formula injection and escapes quotes; SVG escapes labels", () => {
  const p = demoProject();
  p.entities[0].name = '=HYPERLINK("x")';
  p.entities.find((e) => e.type === "text").text =
    '<script>alert("x")</script>';
  const csv = exportCSV(p),
    svg = exportSVG(p);
  assert.ok(csv.includes('"\'=HYPERLINK(""x"")"'));
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(!svg.includes("<script>"));
  assert.ok(/width="[\d.]+mm"/.test(svg));
});
test("visible-layer exports omit hidden geometry while DXF preserves it", () => {
  const p = demoProject();
  p.layers.push({
    id: "hidden-layer",
    name: "Skrytá",
    color: "#cccccc",
    visible: false,
    locked: false,
  });
  p.entities[0].layer = "hidden-layer";
  assert.equal(
    importDXF(exportDXF(p)).project.entities.length,
    p.entities.length,
  );
  assert.ok(!exportSVG(p).includes(p.entities[0].name));
});
test("PDF produces a valid binary xref with exact ISO page sizes", () => {
  const p = demoProject(),
    pdf = Buffer.from(exportPDF(p)).toString("latin1");
  assert.ok(pdf.startsWith("%PDF-1.4"));
  assert.ok(pdf.includes("/MediaBox [0 0 1190.5512 841.8898]"));
  const xref = +pdf.match(/startxref\n(\d+)/)[1];
  assert.equal(pdf.slice(xref, xref + 4), "xref");
  const entries = pdf.slice(xref).split("\n").slice(3, 8);
  entries.forEach((line, i) => {
    const offset = +line.slice(0, 10);
    assert.ok(pdf.slice(offset).startsWith(`${i + 1} 0 obj`));
  });
  const stream = pdf.match(/\/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/);
  assert.equal(+stream[1], stream[2].length);
});
test("PDF refuses silently clipped true-scale drawings", () => {
  assert.throws(() => exportPDF(demoProject(), { scale: "1" }), /exceeds/);
  assert.doesNotThrow(() =>
    exportPDF(demoProject(), { paper: "A4", scale: "10" }),
  );
});
test("joint placement follows rotated panel axes; miter is a valid triangular cut", () => {
  const p = demoProject(),
    e = p.entities[0];
  for (const kind of ["dado", "groove", "mortise", "tenon", "miter"]) {
    const joint = jointGeometry(e, kind, {
      width: 18,
      length: 80,
      depth: 8,
      position: 100,
    });
    p.entities.push(joint);
  }
  assert.doesNotThrow(() => validateProject(p));
  assert.throws(
    () =>
      jointGeometry(e, "dado", {
        width: 18,
        length: 80,
        depth: 30,
        position: 100,
      }),
    /depth/,
  );
  assert.throws(
    () =>
      jointGeometry(e, "groove", {
        width: 18,
        length: 80,
        depth: 8,
        position: 415,
      }),
    /fit/,
  );
});
