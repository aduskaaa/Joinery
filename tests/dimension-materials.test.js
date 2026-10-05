import { pdfText } from "./support.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyProject,
  panel,
  dimensionGeometry,
  distance,
  projectPoint,
  sub,
  dot,
  unit,
  cutList,
  bomSummary,
  exportCSV,
  exportDXF,
  importDXF,
  exportPDF,
  validateProject,
} from "./support.js";
const { draftingScene } = Joinery.Scene;

test("extension lines reach and overrun dimensions on either side with reversed endpoints", () => {
  for (const mode of ["horizontal", "vertical", "aligned"])
    for (const reverse of [false, true])
      for (const side of [-1, 1])
        for (const paperScale of [1, 2, 5]) {
          const points =
            mode === "vertical"
              ? [
                  { x: 10, y: 0 },
                  { x: 10, y: 40 },
                ]
              : mode === "aligned"
                ? [
                    { x: 0, y: 0 },
                    { x: 40, y: 20 },
                  ]
                : [
                    { x: 0, y: 10 },
                    { x: 40, y: 10 },
                  ];
          if (reverse) points.reverse();
          const placement =
            mode === "vertical"
              ? { x: 10 + side * 30, y: 0 }
              : { x: 0, y: 10 + side * 30 };
          const e = { type: "dimension", mode, points: [...points, placement] },
            g = dimensionGeometry(e, { paperScale });
          for (let i = 0; i < 2; i++) {
            const witness = g.segments[i],
              end = g.points[i],
              outward = unit(sub(end, e.points[i]));
            assert.ok(distance(projectPoint(end, ...witness), end) < 1e-8);
            assert.ok(
              Math.abs(dot(sub(witness[1], end), outward) - 2 * paperScale) <
                1e-8,
            );
          }
          assert.ok(
            Math.abs(distance(...g.segments[3]) / paperScale - 2.5) < 1e-8,
          );
        }
});

test("crowded chain dimensions stagger their actual dimension lines and preserve connected witnesses", () => {
  const entities = [0, 13, 27].map((x, i) => ({
    id: `d${i}`,
    type: "dimension",
    mode: "horizontal",
    points: [
      { x, y: 0 },
      { x: [13, 27, 40][i], y: 0 },
      { x, y: 20 },
    ],
  }));
  const scene = draftingScene(entities, "mm", { paperScale: 5 });
  const middle = scene[1].items;
  assert.ok(middle[2].points[0].y > 20);
  for (const { items } of scene)
    for (let i = 0; i < 2; i++)
      assert.ok(
        distance(
          projectPoint(items[2].points[i], ...items[i].points),
          items[2].points[i],
        ) < 1e-8,
      );
  assert.equal(entities[1].points[2].y, 20);
});

test("declared material classes distinguish equal names and survive validation, CSV and DXF", () => {
  const p = emptyProject();
  p.entities = [panel(0, 0, 500, 700), panel(520, 0, 500, 700)];
  for (const e of p.entities) e.material = "Oak finish";
  p.entities[0].materialClass = "pb-p2";
  p.entities[1].materialClass = "pb-p3";
  const rows = cutList(validateProject(p));
  assert.equal(rows[0].materialStandard, "EN 312");
  assert.equal(rows[0].materialGrade, "P2");
  assert.equal(rows[0].materialCSN, "ČSN EN 312");
  assert.equal(bomSummary(p).materials, 2);
  assert.ok(exportCSV(p).includes('"EN 312","P2","ČSN EN 312"'));
  const restored = importDXF(exportDXF(p)).project;
  assert.deepEqual(
    restored.entities.map((e) => e.materialClass),
    ["pb-p2", "pb-p3"],
  );
  assert.equal(restored.entities[0].material, "Oak finish");
  delete p.entities[0].materialClass;
  assert.equal(cutList(p)[0].materialStandard, "");
  p.entities[0].materialClass = "unknown-grade";
  assert.throws(() => validateProject(p), /material class/);
});

test("catalogue differentiates panel use classes and does not assign stock grades from names", () => {
  const { catalogue, get } = Joinery.Materials;
  assert.equal(new Set(catalogue.map((p) => p.id)).size, catalogue.length);
  assert.equal(get("mdf-h").standard, "EN 622-5");
  assert.match(get("mdf-hls").use, /short-duration/);
  assert.equal(get("osb-3").standard, "EN 300");
  assert.equal(get("ply-2-ns").standard, "EN 636");
  assert.equal(get("swp-2-s").standard, "EN 13353");
  assert.equal(get("timber-c24").standard, "EN 338");
  assert.equal(
    panel(0, 0, 100, 100, 18, "Part", "MDF").materialClass,
    undefined,
  );
});

test("printed footer contains scale and units without application status messages", () => {
  const p = emptyProject();
  p.entities = [panel(0, 0, 40, 250)];
  const pdf = pdfText(exportPDF(p));
  assert.match(pdf, /Měřítko\n1:/);
  assert.match(pdf, /Jednotky\nmm/);
  assert.doesNotMatch(pdf, /No material estimate|mm on paper|2D views/);
});
