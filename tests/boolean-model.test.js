import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyProject,
  uid,
  panel,
  partSpec,
  panelSize,
  isPart,
  validateProject,
  booleanPolygons,
  polygonArea,
  pointInRegion,
  vertices,
  segments,
  bounds,
  hitDistance,
  transformEntity,
  rotatePoint,
  snapPoint,
} from "./support.js";
function cutPart() {
  const stock = panel(0, 0, 300, 200, 18, "Door", "Oak plywood");
  const polygons = booleanPolygons("difference", [
    stock,
    { type: "circle", center: { x: 150, y: 100 }, radius: 25 },
  ]);
  return {
    id: stock.id,
    layer: stock.layer,
    name: stock.name,
    type: "region",
    polygons,
    closed: true,
    stockPoints: stock.points,
    part: {
      material: stock.material,
      thickness: stock.thickness,
      quantity: 2,
      banding: [1, 0, 2, 0],
    },
  };
}
test("machined parts validate and retain their original oriented blank specification", () => {
  const e = cutPart(),
    project = emptyProject();
  project.entities = [e];
  const restored = validateProject(project).entities[0];
  assert.equal(isPart(restored), true);
  assert.deepEqual(panelSize(restored), { width: 300, height: 200 });
  assert.equal(partSpec(restored).quantity, 2);
  assert.deepEqual(restored.polygons, e.polygons);
});
test("region membership, picking distance and boundary segments account for holes", () => {
  const e = cutPart();
  assert.equal(pointInRegion({ x: 150, y: 100 }, e.polygons), false);
  assert.equal(pointInRegion({ x: 100, y: 100 }, e.polygons), true);
  assert.equal(pointInRegion({ x: 310, y: 100 }, e.polygons), false);
  assert.equal(segments(e).length, vertices(e).length);
  assert.ok(Math.abs(hitDistance(e, { x: 150, y: 100 }) - 25) < 0.011);
  assert.deepEqual(bounds([e]).min, { x: 0, y: 0 });
  assert.deepEqual(bounds([e]).max, { x: 300, y: 200 });
});
test("region rotation and mirroring transform every hole and its stock rectangle together", () => {
  const e = cutPart(),
    rotated = transformEntity(e, (p) =>
      rotatePoint(p, { x: 0, y: 0 }, Math.PI / 2),
    );
  assert.equal(pointInRegion({ x: -100, y: 150 }, rotated.polygons), false);
  assert.equal(pointInRegion({ x: -100, y: 100 }, rotated.polygons), true);
  assert.ok(Math.abs(panelSize(rotated).width - 300) < 1e-7);
  assert.ok(
    Math.abs(polygonArea(rotated.polygons) - polygonArea(e.polygons)) < 1e-7,
  );
  const mirrored = transformEntity(rotated, (p) => ({ x: -p.x, y: p.y }));
  assert.equal(pointInRegion({ x: 100, y: 150 }, mirrored.polygons), false);
  const project = emptyProject();
  project.entities = [mirrored];
  assert.doesNotThrow(() => validateProject(project));
});
test("OSNAP targets real region edges and hole endpoints rather than a false connecting segment", () => {
  const e = cutPart(),
    hole = e.polygons[0][1],
    p = hole[0];
  const snap = snapPoint({ x: p.x + 0.01, y: p.y + 0.01 }, [e], {
    tolerance: 0.1,
    modes: { midpoint: false, center: false, intersection: false },
  });
  assert.equal(snap.kind, "Endpoint");
  assert.ok(Math.hypot(snap.point.x - p.x, snap.point.y - p.y) < 1e-7);
  const ringSegments = segments(e);
  assert.ok(
    !ringSegments.some(
      ([a, b]) => e.polygons[0][0].includes(a) && hole.includes(b),
    ),
  );
});
test("import validation rejects malformed topology data and invalid stock metadata", () => {
  const bads = [
    (e) => (e.polygons[0][1][0].x = NaN),
    (e) => (e.polygons = []),
    (e) =>
      (e.polygons[0][1] = [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]),
    (e) => (e.part.quantity = 1.5),
    (e) => (e.stockPoints[2].x += 1),
    (e) => delete e.stockPoints,
    (e) => (e.part.banding = [1, 2]),
  ];
  for (const mutate of bads) {
    const project = emptyProject(),
      e = cutPart();
    mutate(e);
    project.entities = [e];
    assert.throws(() => validateProject(project));
  }
});
