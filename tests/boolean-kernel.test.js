import "../src/vendor/polygon-clipping.umd.js";
import "../src/Boolean.js";
import test from "node:test";
import assert from "node:assert/strict";

const {
  booleanPolygons,
  toPolygons,
  polygonArea,
  signedRingArea,
  isBooleanShape,
  LIMITS,
} = globalThis.Joinery.Boolean;
const point = (x, y) => ({ x, y });
const rectangle = (x, y, width, height, type = "rectangle") => ({
  type,
  points: [
    point(x, y),
    point(x + width, y),
    point(x + width, y + height),
    point(x, y + height),
  ],
  closed: true,
});
const region = (polygons) => ({ type: "region", polygons });
const circle = (x, y, radius, type = "circle") => ({
  type,
  center: point(x, y),
  radius,
});
const near = (actual, expected, tolerance = 1e-7) =>
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `${actual} ≈ ${expected} within ${tolerance}`,
  );
const rotate = (entity, angle, center = point(0, 0)) => ({
  ...entity,
  points: entity.points.map((p) => ({
    x:
      center.x +
      (p.x - center.x) * Math.cos(angle) -
      (p.y - center.y) * Math.sin(angle),
    y:
      center.y +
      (p.x - center.x) * Math.sin(angle) +
      (p.y - center.y) * Math.cos(angle),
  })),
});

test("Boolean operands include closed outlines and exclude construction geometry", () => {
  for (const type of [
    "panel",
    "rectangle",
    "cutout",
    "slot",
    "circle",
    "drill",
    "region",
  ])
    assert.equal(isBooleanShape({ type }), true);
  assert.equal(isBooleanShape({ type: "polyline", closed: true }), true);
  for (const type of ["line", "arc", "dimension", "text", "polyline"])
    assert.equal(isBooleanShape({ type }), false);
  assert.equal(isBooleanShape(null), false);
  assert.throws(
    () => toPolygons({ type: "line", points: [point(0, 0), point(10, 0)] }),
    /closed polylines/,
  );
});

test("rectangle union, subtraction, intersection and XOR have exact areas", () => {
  const a = rectangle(0, 0, 100, 100),
    b = rectangle(50, 0, 100, 100);
  near(polygonArea(booleanPolygons("union", [a, b])), 15000);
  near(polygonArea(booleanPolygons("difference", [a, b])), 5000);
  near(polygonArea(booleanPolygons("intersection", [a, b])), 5000);
  const xor = booleanPolygons("xor", [a, b]);
  near(polygonArea(xor), 10000);
  assert.equal(xor.length, 2);
});

test("subtraction retains a true hole with normalized winding and reusable topology", () => {
  const output = booleanPolygons("difference", [
    rectangle(0, 0, 100, 100, "panel"),
    rectangle(25, 25, 50, 50, "cutout"),
  ]);
  assert.equal(output.length, 1);
  assert.equal(output[0].length, 2);
  assert.ok(signedRingArea(output[0][0]) > 0);
  assert.ok(signedRingArea(output[0][1]) < 0);
  near(polygonArea(output), 7500);
  near(
    polygonArea(
      booleanPolygons("union", [region(output), rectangle(25, 25, 50, 50)]),
    ),
    10000,
  );
  near(polygonArea(toPolygons({ type: "panel", polygons: output })), 7500);
});

test("subtraction uses the first operand and the union of all cutters", () => {
  const output = booleanPolygons("difference", [
    rectangle(0, 0, 100, 100),
    rectangle(10, 10, 40, 40),
    rectangle(30, 10, 40, 40),
  ]);
  near(polygonArea(output), 7600);
  near(
    polygonArea(
      booleanPolygons("difference", [
        rectangle(10, 10, 40, 40),
        rectangle(0, 0, 100, 100),
      ]),
    ),
    0,
  );
});

test("a through cut produces disconnected islands without flattening them", () => {
  const output = booleanPolygons("difference", [
    rectangle(0, 0, 100, 100),
    rectangle(40, -10, 20, 120),
  ]);
  assert.equal(output.length, 2);
  near(polygonArea(output), 8000);
  near(
    polygonArea(
      booleanPolygons("intersection", [
        region(output),
        rectangle(0, 0, 50, 100),
      ]),
    ),
    4000,
  );
});

test("empty intersection and completely consumed subjects return empty polygons", () => {
  assert.deepEqual(
    booleanPolygons("intersection", [
      rectangle(0, 0, 10, 10),
      rectangle(20, 0, 10, 10),
    ]),
    [],
  );
  assert.deepEqual(
    booleanPolygons("difference", [
      rectangle(0, 0, 10, 10),
      rectangle(-10, -10, 30, 30),
    ]),
    [],
  );
  assert.deepEqual(booleanPolygons("union", []), []);
  assert.deepEqual(
    booleanPolygons("intersection", [region([]), rectangle(0, 0, 10, 10)]),
    [],
  );
});

test("identical geometry and shared edges do not leave sliver contours", () => {
  const a = rectangle(0, 0, 100, 100),
    b = rectangle(100, 0, 100, 100);
  assert.deepEqual(booleanPolygons("difference", [a, a]), []);
  assert.deepEqual(booleanPolygons("xor", [a, a]), []);
  near(polygonArea(booleanPolygons("intersection", [a, a])), 10000);
  const union = booleanPolygons("union", [a, b]);
  assert.equal(union.length, 1);
  assert.equal(union[0][0].length, 4);
  near(polygonArea(union), 20000);
  assert.deepEqual(booleanPolygons("intersection", [a, b]), []);
});

test("point tangent shapes remain separate and edge tangent cuts preserve the subject", () => {
  const a = rectangle(0, 0, 10, 10),
    b = rectangle(10, 10, 10, 10);
  assert.equal(booleanPolygons("union", [a, b]).length, 2);
  near(polygonArea(booleanPolygons("difference", [a, b])), 100);
  assert.deepEqual(booleanPolygons("intersection", [a, b]), []);
});

test("rotated panels and coordinates far from origin preserve exact outline areas", () => {
  const a = rotate(
    rectangle(1000000, 2000000, 100, 60, "panel"),
    Math.PI / 7,
    point(1000000, 2000000),
  );
  const b = rotate(
    rectangle(1000025, 2000000, 100, 60),
    Math.PI / 7,
    point(1000000, 2000000),
  );
  near(polygonArea(booleanPolygons("union", [a, b])), 7500, 1e-6);
  near(polygonArea(booleanPolygons("difference", [a, b])), 1500, 1e-6);
  near(polygonArea(booleanPolygons("intersection", [a, b])), 4500, 1e-6);
});

test("circles and drill holes respect the requested maximum chord error", () => {
  for (const radius of [1.5, 17.5, 500]) {
    const tolerance = 0.01,
      polygon = toPolygons(circle(10, 20, radius, "drill"), { tolerance }),
      ring = polygon[0][0];
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length];
      const midpointRadius = Math.hypot(
        (a.x + b.x) / 2 - 10,
        (a.y + b.y) / 2 - 20,
      );
      assert.ok(radius - midpointRadius <= tolerance + 1e-10);
    }
    assert.ok(polygonArea(polygon) <= Math.PI * radius * radius + 1e-7);
  }
  const holes = booleanPolygons("difference", [
    rectangle(0, 0, 100, 100),
    circle(50, 50, 17.5, "drill"),
  ]);
  assert.equal(holes[0].length, 2);
  near(polygonArea(holes), 10000 - Math.PI * 17.5 * 17.5, 1.2);
});

test("slots tessellate rounded caps and support a zero-length centerline", () => {
  const slot = {
    type: "slot",
    points: [point(30, 40), point(70, 40)],
    width: 10,
  };
  near(polygonArea(toPolygons(slot)), 400 + Math.PI * 25, 0.35);
  const vertical = { ...slot, points: [point(50, 20), point(50, 70)] };
  near(polygonArea(toPolygons(vertical)), 500 + Math.PI * 25, 0.35);
  near(
    polygonArea(
      toPolygons({ ...slot, points: [point(50, 50), point(50, 50)] }),
    ),
    Math.PI * 25,
    0.35,
  );
  const output = booleanPolygons("difference", [
    rectangle(0, 0, 100, 100),
    slot,
  ]);
  assert.equal(output[0].length, 2);
  assert.ok(polygonArea(output) < 9600);
});

test("tangent circles, containment and circular hole reapplication remain well formed", () => {
  const a = circle(0, 0, 10),
    b = circle(20, 0, 10);
  assert.deepEqual(booleanPolygons("intersection", [a, b]), []);
  const output = booleanPolygons("difference", [
    rectangle(-20, -20, 40, 40),
    circle(0, 0, 10),
  ]);
  near(polygonArea(booleanPolygons("union", [region(output), a])), 1600);
  assert.deepEqual(booleanPolygons("difference", [a, circle(0, 0, 20)]), []);
});

test("the kernel clones inputs and removes repeated closing vertices", () => {
  const entity = rectangle(0, 0, 10, 10, "polyline");
  entity.points.push(point(0, 0));
  const before = JSON.stringify(entity),
    output = toPolygons(entity);
  assert.equal(output[0][0].length, 4);
  output[0][0][0].x = 123;
  assert.equal(JSON.stringify(entity), before);
  booleanPolygons("union", [entity, rectangle(5, 5, 10, 10)]);
  assert.equal(JSON.stringify(entity), before);
});

test("invalid or self-crossing contours fail before clipping", () => {
  for (const points of [
    [point(0, 0), point(10, 10), point(0, 10), point(10, 0)],
    [point(0, 0), point(20, 0), point(10, 0), point(10, 10), point(0, 10)],
    [point(0, 0), point(10, 0), point(20, 0)],
    [point(0, 0), point(10, 0)],
    [point(0, 0), point(Infinity, 0), point(10, 10)],
  ])
    assert.throws(
      () => toPolygons({ type: "polyline", points, closed: true }),
      /contour|Contour|coordinates/,
    );
  assert.throws(() => toPolygons(circle(0, 0, -1)), /finite and positive/);
  assert.throws(() => toPolygons(circle(0, 0, NaN)), /finite and positive/);
  assert.throws(
    () => toPolygons({ type: "slot", points: [point(0, 0)], width: 10 }),
    /two centerline/,
  );
});

test("holes outside their outer ring, overlapping holes, and nested holes are rejected", () => {
  const outer = rectangle(0, 0, 100, 100).points;
  for (const holes of [
    [rectangle(90, 90, 20, 20).points],
    [rectangle(10, 10, 40, 40).points, rectangle(30, 30, 40, 40).points],
    [rectangle(10, 10, 70, 70).points, rectangle(20, 20, 10, 10).points],
    [rectangle(10, 10, 70, 70).points, rectangle(10, 10, 70, 70).points],
    [outer],
  ])
    assert.throws(() => toPolygons(region([[outer, ...holes]])), /hole|Hole/);
});

test("complexity, coordinate, operation and tolerance limits produce actionable errors", () => {
  assert.throws(
    () => booleanPolygons("subtract", []),
    /Unknown Boolean operation/,
  );
  assert.throws(
    () =>
      booleanPolygons(
        "union",
        Array.from({ length: LIMITS.operands + 1 }, () =>
          rectangle(0, 0, 10, 10),
        ),
      ),
    /selected shapes/,
  );
  assert.throws(
    () => toPolygons(rectangle(LIMITS.coordinate, 0, 10, 10)),
    /coordinates/,
  );
  assert.throws(
    () => toPolygons(circle(0, 0, 1e8), { tolerance: 0.00001 }),
    /too large/,
  );
  for (const tolerance of [0, -1, NaN, Infinity, 100])
    assert.throws(
      () => toPolygons(circle(0, 0, 10), { tolerance }),
      /tolerance/,
    );
});

test("linear outlines retain tiny manufacturing features independent of curve tolerance", () => {
  const output = booleanPolygons(
    "difference",
    [rectangle(0, 0, 10, 10), rectangle(4, -1, 0.001, 12)],
    { tolerance: 1 },
  );
  assert.equal(output.length, 2);
  near(polygonArea(output), 99.99);
});

test("an outer boundary tangent to a circular hole can be used in later operations", () => {
  const output = booleanPolygons("difference", [
    rectangle(0, 0, 100, 100),
    circle(50, 25, 25),
  ]);
  near(polygonArea(toPolygons(region(output))), polygonArea(output));
  near(
    polygonArea(booleanPolygons("union", [region(output), circle(50, 25, 25)])),
    10000,
  );
});

test("concave closed polylines remain concave during booleans", () => {
  const lShape = {
    type: "polyline",
    closed: true,
    points: [
      point(0, 0),
      point(100, 0),
      point(100, 25),
      point(25, 25),
      point(25, 100),
      point(0, 100),
    ],
  };
  near(polygonArea(toPolygons(lShape)), 4375);
  near(
    polygonArea(
      booleanPolygons("intersection", [lShape, rectangle(10, 10, 50, 50)]),
    ),
    1275,
  );
  near(
    polygonArea(booleanPolygons("union", [lShape, rectangle(25, 25, 75, 75)])),
    10000,
  );
});

test("polygonArea sums separate polygons and subtracts each of their holes", () => {
  const polygons = [
    [
      rectangle(0, 0, 100, 100).points,
      rectangle(10, 10, 10, 10).points,
      rectangle(30, 30, 20, 20).points,
    ],
    [rectangle(200, 0, 100, 50).points, rectangle(210, 10, 10, 10).points],
  ];
  near(polygonArea(polygons), 14400);
  near(polygonArea(toPolygons(region(polygons))), 14400);
});
