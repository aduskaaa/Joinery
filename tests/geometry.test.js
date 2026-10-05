import {
  intersection,
  snapPoint,
  circleThrough,
  distance,
  rotatePoint,
  transformEntity,
  offsetEntity,
  adaptiveSpacing,
  dimensionGeometry,
  angle,
  panel,
  panelSize,
  validateProject,
  demoProject,
  History,
} from "./support.js";
import test from "node:test";
import assert from "node:assert/strict";
const near = (a, b, tol = 1e-7) =>
  assert.ok(Math.abs(a - b) < tol, `${a} ≈ ${b}`);
test("segment intersection excludes extrapolation unless requested", () => {
  const a = { x: 0, y: 0 },
    b = { x: 10, y: 0 },
    c = { x: 15, y: -2 },
    d = { x: 15, y: 2 };
  assert.equal(intersection(a, b, c, d), null);
  assert.deepEqual(intersection(a, b, c, d, true), { x: 15, y: 0 });
  assert.equal(intersection(a, b, { x: 0, y: 1 }, { x: 10, y: 1 }), null);
});
test("grid and ortho preserve an off-grid base coordinate", () => {
  const r = snapPoint({ x: 31, y: 4 }, [], {
    base: { x: 3, y: 7 },
    grid: true,
    object: false,
    gridSize: 10,
    ortho: true,
  });
  assert.deepEqual(r.point, { x: 30, y: 7 });
});
test("OSNAP endpoint, midpoint, center and crossing segments", () => {
  const lines = [
    {
      type: "line",
      points: [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
      ],
    },
    {
      type: "line",
      points: [
        { x: 30, y: -20 },
        { x: 30, y: 20 },
      ],
    },
  ];
  assert.equal(
    snapPoint({ x: 0.3, y: 0.4 }, lines, { tolerance: 2 }).kind,
    "Endpoint",
  );
  assert.equal(
    snapPoint({ x: 50, y: 1 }, lines, { tolerance: 2 }).kind,
    "Midpoint",
  );
  assert.equal(
    snapPoint({ x: 30.1, y: 0.2 }, lines, {
      tolerance: 2,
      modes: { midpoint: false },
    }).kind,
    "Intersection",
  );
  assert.equal(
    snapPoint(
      { x: 5.1, y: 5 },
      [{ type: "circle", center: { x: 5, y: 5 }, radius: 3 }],
      { tolerance: 2 },
    ).kind,
    "Center",
  );
});
test("perpendicular and parallel reference snaps", () => {
  const e = {
    type: "line",
    points: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
    ],
  };
  const off = {
    endpoint: false,
    midpoint: false,
    center: false,
    intersection: false,
  };
  const r = snapPoint({ x: 25, y: 0.2 }, [e], {
    base: { x: 25, y: 30 },
    tolerance: 1,
    modes: { ...off, parallel: false },
  });
  assert.equal(r.kind, "Perpendicular");
  assert.deepEqual(r.point, { x: 25, y: 0 });
  const p = snapPoint({ x: 75, y: 30.5 }, [e], {
    base: { x: 25, y: 30 },
    tolerance: 1,
    modes: { ...off, perpendicular: false },
  });
  assert.equal(p.kind, "Parallel");
  near(p.point.y, 30);
});
test("three-point arcs remain accurate far from the origin", () => {
  const base = 1e6,
    a = { x: base + 10, y: base },
    b = { x: base, y: base + 10 },
    c = { x: base - 10, y: base };
  const arc = circleThrough(a, b, c);
  near(arc.radius, 10);
  near(arc.center.x, base);
  assert.equal(
    circleThrough({ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 2 }),
    null,
  );
});
test("rotated and mirrored panels keep exact cut dimensions", () => {
  const p = panel(25, 30, 420, 720);
  const r = transformEntity(p, (q) =>
    rotatePoint(q, { x: 0, y: 0 }, Math.PI / 5),
  );
  const s = panelSize(r);
  near(s.width, 420);
  near(s.height, 720);
  const project = demoProject();
  project.entities = [r];
  validateProject(project);
  const mirrored = transformEntity(r, (q) => ({ x: -q.x, y: q.y }));
  project.entities = [mirrored];
  validateProject(project);
  near(panelSize(mirrored).height, 720);
});
test("mirror arcs reverses handedness and keeps the original locus", () => {
  const a = {
    type: "arc",
    center: { x: 0, y: 0 },
    radius: 10,
    start: 0,
    end: Math.PI / 2,
  };
  const r = transformEntity(a, (q) => ({ x: -q.x, y: q.y }));
  near(r.start, Math.PI / 2);
  near(r.end, Math.PI);
});
test("outward and inward offsets handle rectangle orientation and collapse", () => {
  const p = panel(0, 0, 100, 200),
    q = offsetEntity(p, 10);
  assert.deepEqual(q.points[0], { x: -10, y: -10 });
  assert.equal(q.type, "polyline");
  assert.equal(offsetEntity(p, -60), null);
  const reversed = { ...p, points: [...p.points].reverse() };
  const o = offsetEntity(reversed, 10);
  near(Math.min(...o.points.map((p) => p.x)), -10);
  assert.equal(
    offsetEntity(
      {
        type: "slot",
        points: [
          { x: 0, y: 0 },
          { x: 10, y: 0 },
        ],
        width: 5,
      },
      1,
    ),
    null,
  );
});
test("linear and aligned dimensions use model-space lengths", () => {
  const d = {
    type: "dimension",
    points: [
      { x: 0, y: 0 },
      { x: 300, y: 400 },
      { x: 20, y: 20 },
    ],
    mode: "aligned",
  };
  near(dimensionGeometry(d).value, 500);
  near(dimensionGeometry({ ...d, mode: "horizontal" }).value, 300);
  near(dimensionGeometry({ ...d, mode: "vertical" }).value, 400);
});
test("adaptive grid follows 1/2/5 and retains a useful screen interval", () => {
  for (const z of [0.01, 0.05, 0.5, 1, 5, 20]) {
    const spacing = adaptiveSpacing(z);
    assert.ok(spacing * z >= 36);
    assert.ok(spacing * z <= 90);
  }
});
test("history supports redo and invalidates it after a new edit", () => {
  const h = new History(),
    p = demoProject();
  h.record(p);
  const changed = { ...p, name: "Changed" };
  assert.equal(h.undo(changed).name, p.name);
  assert.equal(h.redo(p).name, "Changed");
  h.undo(changed);
  h.record(p);
  assert.equal(h.redo(p), null);
});
test("project validation rejects nonfinite coordinates and malformed panels", () => {
  const p = demoProject();
  p.entities[0].points[0].x = NaN;
  assert.throws(() => validateProject(p));
  const q = demoProject();
  q.entities[0].quantity = 1.5;
  assert.throws(() => validateProject(q));
  const r = demoProject();
  r.entities[0].points[2].x += 10;
  assert.throws(() => validateProject(r), /rectangle/);
});

test("OSNAP analytically intersects line/circle and circle/circle geometry", () => {
  const circle = { type: "circle", center: { x: 0, y: 0 }, radius: 10 },
    line = {
      type: "line",
      points: [
        { x: -20, y: 0 },
        { x: 20, y: 0 },
      ],
    };
  const r = snapPoint({ x: 10, y: 0.2 }, [circle, line], { tolerance: 1 });
  assert.equal(r.kind, "Intersection");
  near(r.point.x, 10);
  near(r.point.y, 0);
  const other = { type: "circle", center: { x: 10, y: 0 }, radius: 10 },
    q = snapPoint({ x: 5, y: Math.sqrt(75) + 0.1 }, [circle, other], {
      tolerance: 1,
    });
  assert.equal(q.kind, "Intersection");
  near(q.point.x, 5);
  near(q.point.y, Math.sqrt(75));
});
