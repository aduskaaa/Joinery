/**
 * Offline 2D Boolean geometry. Requires vendor/polygon-clipping.umd.js.
 * A Point[][][] contains polygons; each polygon is [outerRing, ...holeRings].
 * Curved boundaries become polygon edges with at most tolerance mm chord error.
 * This is a planar outline operation; it does not model machining depth.
 */
(function (Joinery) {
  "use strict";
  const TAU = Math.PI * 2;
  const DEFAULT_TOLERANCE = 0.01;
  const LIMITS = Object.freeze({
    coordinate: 1e8,
    operands: 200,
    ringVertices: 4096,
    totalVertices: 32768,
    validationComparisons: 2000000,
    minTolerance: 0.00001,
    maxTolerance: 10,
  });
  const OPERATIONS = Object.freeze([
    "union",
    "difference",
    "intersection",
    "xor",
  ]);
  const SIMPLE_TYPES = new Set(["rectangle", "panel", "cutout", "polygon"]);
  const CURVE_TYPES = new Set(["circle", "drill", "slot"]);
  const POINT_EPSILON = 1e-9;
  const normalizeAngle = (a) => ((a % TAU) + TAU) % TAU;

  function isClosedPolyline(entity) {
    if (!entity || entity.type !== "polyline") return false;
    if (entity.closed === true || entity.closed === 1) return true;
    if (
      Array.isArray(entity.points) &&
      entity.points.length >= 4 &&
      samePoint(entity.points[0], entity.points[entity.points.length - 1])
    )
      return true;
    return false;
  }

  function isClosedArc(entity) {
    if (!entity || entity.type !== "arc") return false;
    if (
      entity.closed === true ||
      entity.closed === "sector" ||
      entity.closed === "chord" ||
      entity.sector === true
    )
      return true;
    if (Number.isFinite(entity.start) && Number.isFinite(entity.end)) {
      const sweep = normalizeAngle(entity.end - entity.start);
      if (
        Math.abs(sweep - TAU) < 1e-6 ||
        Math.abs(entity.end - entity.start) >= TAU - 1e-6
      )
        return true;
      if (sweep < 1e-6 && entity.start !== entity.end) return true;
    }
    if (Number.isFinite(entity.sweep) && Math.abs(entity.sweep) >= TAU - 1e-6)
      return true;
    return false;
  }

  function isBooleanShape(entity) {
    if (!entity || typeof entity !== "object") return false;
    if (
      entity.type === "region" ||
      Array.isArray(entity.polygons)
    )
      return true;
    if (
      SIMPLE_TYPES.has(entity.type) ||
      CURVE_TYPES.has(entity.type)
    )
      return true;
    if (isClosedPolyline(entity)) return true;
    if (isClosedArc(entity)) return true;
    if (entity.closed === true) {
      if (Array.isArray(entity.points) && entity.points.length >= 3) return true;
      if (
        entity.center &&
        Number.isFinite(entity.radius) &&
        entity.radius > 0
      )
        return true;
    }
    return false;
  }

  function toleranceValue(options) {
    const value = options?.tolerance ?? DEFAULT_TOLERANCE;
    if (
      !Number.isFinite(value) ||
      value < LIMITS.minTolerance ||
      value > LIMITS.maxTolerance
    )
      throw new Error(
        `Curve tolerance must be ${LIMITS.minTolerance}–${LIMITS.maxTolerance} mm.`,
      );
    return value;
  }

  function point(value) {
    if (
      !value ||
      !Number.isFinite(value.x) ||
      !Number.isFinite(value.y) ||
      Math.abs(value.x) > LIMITS.coordinate ||
      Math.abs(value.y) > LIMITS.coordinate
    )
      throw new Error(
        `Boolean coordinates must be finite and within ±${LIMITS.coordinate} mm.`,
      );
    return { x: value.x === 0 ? 0 : value.x, y: value.y === 0 ? 0 : value.y };
  }
  const samePoint = (a, b) =>
    Math.abs(a.x - b.x) <= POINT_EPSILON &&
    Math.abs(a.y - b.y) <= POINT_EPSILON;
  const cross = (a, b, c) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

  /** Subtracting the first vertex avoids cancellation for work far from origin. */
  function signedRingArea(ring) {
    if (!Array.isArray(ring) || ring.length < 3) return 0;
    const base = ring[0];
    let area = 0;
    for (let i = 1; i + 1 < ring.length; i++)
      area += cross(base, ring[i], ring[i + 1]);
    return area / 2;
  }

  function cleanRing(values) {
    if (!Array.isArray(values) || values.length > LIMITS.ringVertices + 1)
      throw new Error(
        `A Boolean contour supports at most ${LIMITS.ringVertices} vertices.`,
      );
    const ring = [];
    for (const value of values) {
      const p = point(value);
      if (!ring.length || !samePoint(p, ring.at(-1))) ring.push(p);
    }
    if (ring.length > 1 && samePoint(ring[0], ring.at(-1))) ring.pop();
    if (ring.length > LIMITS.ringVertices)
      throw new Error(
        `A Boolean contour supports at most ${LIMITS.ringVertices} vertices.`,
      );
    if (ring.length < 3)
      throw new Error(
        "A closed contour needs at least three distinct vertices.",
      );
    return ring;
  }

  function edges(ring) {
    return ring.map((a, index) => {
      const b = ring[(index + 1) % ring.length];
      return {
        a,
        b,
        index,
        minX: Math.min(a.x, b.x),
        maxX: Math.max(a.x, b.x),
        minY: Math.min(a.y, b.y),
        maxY: Math.max(a.y, b.y),
      };
    });
  }
  const boxesOverlap = (a, b) =>
    a.minX <= b.maxX &&
    b.minX <= a.maxX &&
    a.minY <= b.maxY &&
    b.minY <= a.maxY;
  const onSegment = (p, a, b) =>
    cross(a, b, p) === 0 &&
    p.x >= Math.min(a.x, b.x) &&
    p.x <= Math.max(a.x, b.x) &&
    p.y >= Math.min(a.y, b.y) &&
    p.y <= Math.max(a.y, b.y);

  /** Returns proper crossing / contact / none. Exact signs avoid erasing tiny features. */
  function edgeContact(a, b) {
    if (!boxesOverlap(a, b)) return 0;
    const aa = cross(a.a, a.b, b.a),
      ab = cross(a.a, a.b, b.b),
      ba = cross(b.a, b.b, a.a),
      bb = cross(b.a, b.b, a.b);
    if (
      ((aa > 0 && ab < 0) || (aa < 0 && ab > 0)) &&
      ((ba > 0 && bb < 0) || (ba < 0 && bb > 0))
    )
      return 2;
    return onSegment(b.a, a.a, a.b) ||
      onSegment(b.b, a.a, a.b) ||
      onSegment(a.a, b.a, b.b) ||
      onSegment(a.b, b.a, b.b)
      ? 1
      : 0;
  }

  function countComparison(budget) {
    if (++budget.comparisons > LIMITS.validationComparisons)
      throw new Error(
        "Boolean contours are too complex; simplify them before combining.",
      );
  }

  function validateRing(ring, budget) {
    const sorted = edges(ring).sort((a, b) => a.minX - b.minX);
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      for (let j = i + 1; j < sorted.length && sorted[j].minX <= a.maxX; j++) {
        const b = sorted[j];
        countComparison(budget);
        if (!boxesOverlap(a, b)) continue;
        const adjacent =
          Math.abs(a.index - b.index) === 1 ||
          Math.abs(a.index - b.index) === ring.length - 1;
        if (adjacent) {
          // A reversing adjacent segment retraces an edge, rather than forming a contour.
          const otherA = samePoint(a.a, b.a) || samePoint(a.a, b.b) ? a.b : a.a;
          const otherB = samePoint(b.a, a.a) || samePoint(b.a, a.b) ? b.b : b.a;
          if (
            (onSegment(otherA, b.a, b.b) && !samePoint(otherA, otherB)) ||
            (onSegment(otherB, a.a, a.b) && !samePoint(otherA, otherB))
          )
            throw new Error(
              "Contour retraces an edge. Repair it before applying a Boolean operation.",
            );
          continue;
        }
        if (edgeContact(a, b))
          throw new Error(
            "Contour crosses or touches itself. Repair it before applying a Boolean operation.",
          );
      }
    }
    if (Math.abs(signedRingArea(ring)) <= 1e-12)
      throw new Error(
        "Contour has zero area. Boolean tools need closed shapes with area.",
      );
  }

  /** -1 outside, 0 boundary, 1 inside. */
  function pointInRing(p, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j],
        b = ring[i];
      if (onSegment(p, a, b)) return 0;
      if (
        a.y > p.y !== b.y > p.y &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
    return inside ? 1 : -1;
  }

  function ringsCross(a, b, budget) {
    const sorted = [
      ...edges(a).map((edge) => ({ ...edge, owner: 0 })),
      ...edges(b).map((edge) => ({ ...edge, owner: 1 })),
    ].sort((aa, bb) => aa.minX - bb.minX);
    for (let i = 0; i < sorted.length; i++) {
      const aa = sorted[i];
      for (let j = i + 1; j < sorted.length && sorted[j].minX <= aa.maxX; j++) {
        const bb = sorted[j];
        if (aa.owner === bb.owner) continue;
        countComparison(budget);
        if (edgeContact(aa, bb) === 2) return true;
      }
    }
    return false;
  }

  function sameBoundary(a, b) {
    return (
      Math.abs(Math.abs(signedRingArea(a)) - Math.abs(signedRingArea(b))) <
        1e-12 &&
      a.every((p) => pointInRing(p, b) === 0) &&
      b.every((p) => pointInRing(p, a) === 0)
    );
  }

  function validatePolygons(values, budget) {
    if (!Array.isArray(values))
      throw new Error(
        "Region polygons must be an array of polygons and rings.",
      );
    const polygons = [];
    for (const polygon of values) {
      if (!Array.isArray(polygon) || !polygon.length)
        throw new Error("Each polygon needs an outer contour.");
      const rings = polygon.map(cleanRing);
      for (const ring of rings) {
        budget.vertices += ring.length;
        if (budget.vertices > LIMITS.totalVertices)
          throw new Error(
            `Boolean input exceeds ${LIMITS.totalVertices} total vertices; simplify it first.`,
          );
        validateRing(ring, budget);
      }
      for (let i = 1; i < rings.length; i++) {
        if (
          sameBoundary(rings[i], rings[0]) ||
          rings[i].some((p) => pointInRing(p, rings[0]) < 0) ||
          ringsCross(rings[0], rings[i], budget)
        )
          throw new Error(
            "A hole contour must remain inside its outer contour.",
          );
        for (let j = 1; j < i; j++) {
          if (
            sameBoundary(rings[i], rings[j]) ||
            ringsCross(rings[i], rings[j], budget) ||
            rings[i].some((p) => pointInRing(p, rings[j]) > 0) ||
            rings[j].some((p) => pointInRing(p, rings[i]) > 0)
          )
            throw new Error(
              "Hole contours may touch but cannot overlap or nest.",
            );
        }
      }
      polygons.push(
        rings.map((ring, i) =>
          signedRingArea(ring) > 0 === (i === 0) ? ring : ring.reverse(),
        ),
      );
    }
    return polygons;
  }

  function arcSegments(radius, sweep, tolerance) {
    if (!Number.isFinite(radius) || radius <= 0 || radius > LIMITS.coordinate)
      throw new Error(
        "Circle radius and slot width must be finite and positive.",
      );
    // asin form is stable when tolerance is tiny compared with the radius.
    const step =
      4 * Math.asin(Math.sqrt(Math.min(1, tolerance / (2 * radius))));
    const minimum = Math.max(sweep === TAU ? 12 : 6, Math.ceil(sweep / step));
    // Quadrant points preserve exact circle extrema and axis-aligned tangencies.
    const n =
      sweep === TAU ? Math.ceil(minimum / 4) * 4 : Math.ceil(minimum / 2) * 2;
    if (
      n > LIMITS.ringVertices ||
      (sweep === Math.PI && 2 * (n + 1) > LIMITS.ringVertices)
    )
      throw new Error(
        "Curve is too large for this tolerance; increase the Boolean curve tolerance.",
      );
    return n;
  }

  function circleRing(center, radius, tolerance) {
    const c = point(center),
      n = arcSegments(radius, TAU, tolerance);
    return Array.from({ length: n }, (_, i) => {
      if (i === 0) return { x: c.x + radius, y: c.y };
      if (i === n / 4) return { x: c.x, y: c.y + radius };
      if (i === n / 2) return { x: c.x - radius, y: c.y };
      if (i === (3 * n) / 4) return { x: c.x, y: c.y - radius };
      const angle = (i * TAU) / n;
      return {
        x: c.x + radius * Math.cos(angle),
        y: c.y + radius * Math.sin(angle),
      };
    });
  }

  function slotRing(entity, tolerance) {
    if (!Array.isArray(entity.points) || entity.points.length !== 2)
      throw new Error("A slot needs two centerline endpoints.");
    const a = point(entity.points[0]),
      b = point(entity.points[1]),
      radius = entity.width / 2;
    if (samePoint(a, b)) return circleRing(a, radius, tolerance);
    const n = arcSegments(radius, Math.PI, tolerance),
      theta = Math.atan2(b.y - a.y, b.x - a.x),
      ring = [];
    for (let i = 0; i <= n; i++) {
      const angle = theta - Math.PI / 2 + (i * Math.PI) / n;
      ring.push({
        x: b.x + radius * Math.cos(angle),
        y: b.y + radius * Math.sin(angle),
      });
    }
    for (let i = 0; i <= n; i++) {
      const angle = theta + Math.PI / 2 + (i * Math.PI) / n;
      ring.push({
        x: a.x + radius * Math.cos(angle),
        y: a.y + radius * Math.sin(angle),
      });
    }
    return ring;
  }

  function arcRing(entity, tolerance) {
    if (
      !entity.center ||
      !Number.isFinite(entity.radius) ||
      entity.radius <= 0 ||
      entity.radius > LIMITS.coordinate
    )
      throw new Error(
        "Circle radius and slot width must be finite and positive.",
      );
    const c = point(entity.center);
    const radius = entity.radius;
    let sweep = Number.isFinite(entity.sweep)
      ? Math.abs(entity.sweep)
      : Number.isFinite(entity.start) && Number.isFinite(entity.end)
        ? normalizeAngle(entity.end - entity.start) || TAU
        : TAU;
    if (sweep >= TAU - 1e-6) {
      return circleRing(c, radius, tolerance);
    }
    const start = Number.isFinite(entity.start) ? entity.start : 0;
    const n = arcSegments(radius, sweep, tolerance);
    const ring = [];
    for (let i = 0; i <= n; i++) {
      const a = start + (sweep * i) / n;
      ring.push({
        x: c.x + radius * Math.cos(a),
        y: c.y + radius * Math.sin(a),
      });
    }
    if (entity.closed === "sector" || entity.sector === true) {
      ring.push(c);
    }
    return ring;
  }

  function expandBulges(points, bulges, closed, tolerance) {
    if (!Array.isArray(points)) return [];
    if (!Array.isArray(bulges) || !bulges.some(Boolean)) {
      return points;
    }
    const out = [];
    const count = closed ? points.length : points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      const bulge = bulges[i] || 0;
      if (Math.abs(bulge) < 1e-9) {
        out.push(a);
      } else {
        const chord = Math.hypot(b.x - a.x, b.y - a.y);
        if (chord < 1e-9) {
          out.push(a);
        } else {
          const sweep = 4 * Math.atan(bulge);
          const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
          const n = arcSegments(radius, Math.abs(sweep), tolerance);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const dx = b.x - a.x,
            dy = b.y - a.y;
          const sagitta = (chord * (1 - bulge * bulge)) / (4 * bulge);
          const center = {
            x: mid.x - (dy / chord) * sagitta,
            y: mid.y + (dx / chord) * sagitta,
          };
          const startAngle = Math.atan2(a.y - center.y, a.x - center.x);
          for (let j = 0; j < n; j++) {
            const ang = startAngle + (sweep * j) / n;
            out.push({
              x: center.x + radius * Math.cos(ang),
              y: center.y + radius * Math.sin(ang),
            });
          }
        }
      }
    }
    if (!closed && points.length) {
      out.push(points.at(-1));
    }
    return out;
  }

  function entityPolygons(entity, tolerance, budget) {
    if (!isBooleanShape(entity))
      throw new Error(
        "Boolean tools accept panels, rectangles, closed polylines, closed arcs, cutouts, circles, drill holes, slots, and regions.",
      );
    let polygons;
    if (
      entity.type === "region" ||
      Array.isArray(entity.polygons)
    )
      polygons = entity.polygons || [];
    else if (entity.type === "circle" || entity.type === "drill")
      polygons = [[circleRing(entity.center, entity.radius, tolerance)]];
    else if (entity.type === "arc")
      polygons = [[arcRing(entity, tolerance)]];
    else if (entity.type === "slot")
      polygons = [[slotRing(entity, tolerance)]];
    else if (
      entity.center &&
      Number.isFinite(entity.radius) &&
      entity.radius > 0 &&
      !Array.isArray(entity.points)
    )
      polygons = [[circleRing(entity.center, entity.radius, tolerance)]];
    else {
      let rawPts = entity.points || [];
      if (
        rawPts.length > 2 &&
        samePoint(rawPts[0], rawPts[rawPts.length - 1])
      ) {
        rawPts = rawPts.slice(0, -1);
      }
      const pts = expandBulges(rawPts, entity.bulges, true, tolerance);
      polygons = [[pts]];
    }
    return validatePolygons(polygons, budget);
  }

  function toPolygons(entity, options = {}) {
    return entityPolygons(entity, toleranceValue(options), {
      vertices: 0,
      comparisons: 0,
    });
  }

  /** Area of the complete normalized Point[][][] schema, subtracting holes. */
  function polygonArea(polygons) {
    return polygons.reduce(
      (sum, polygon) =>
        sum +
        polygon.reduce(
          (area, ring, i) =>
            area + (i === 0 ? 1 : -1) * Math.abs(signedRingArea(ring)),
          0,
        ),
      0,
    );
  }

  function booleanPolygons(operation, entities, options = {}) {
    if (!OPERATIONS.includes(operation))
      throw new Error(`Unknown Boolean operation: ${operation}.`);
    if (!Array.isArray(entities) || entities.length > LIMITS.operands)
      throw new Error(
        `A Boolean operation supports at most ${LIMITS.operands} selected shapes.`,
      );
    const tolerance = toleranceValue(options),
      budget = { vertices: 0, comparisons: 0 };
    if (!entities.length) return [];
    const inputs = entities.map((entity) =>
      entityPolygons(entity, tolerance, budget),
    );
    const kernel = globalThis.polygonClipping;
    if (!kernel?.[operation])
      throw new Error(
        "The local polygon clipping library has not loaded. Reload the page.",
      );
    const arrays = inputs.map((polygons) =>
      polygons.map((polygon) =>
        polygon.map((ring) => ring.map((p) => [p.x, p.y])),
      ),
    );
    let output;
    try {
      // polygon-clipping implements first operand minus all remaining operands.
      output = kernel[operation](...arrays);
    } catch (error) {
      throw new Error(
        `Boolean geometry could not be resolved: ${error.message}`,
      );
    }
    let vertexCount = 0;
    return output.map((polygon) =>
      polygon.map((ring, index) => {
        const points = ring.slice(0, -1).map(([x, y]) => point({ x, y }));
        vertexCount += points.length;
        if (
          points.length > LIMITS.ringVertices ||
          vertexCount > LIMITS.totalVertices
        )
          throw new Error(
            "Boolean result is too complex; simplify the operands or increase the curve tolerance.",
          );
        return signedRingArea(points) > 0 === (index === 0)
          ? points
          : points.reverse();
      }),
    );
  }

  Joinery.Boolean = {
    DEFAULT_TOLERANCE,
    LIMITS,
    OPERATIONS,
    isBooleanShape,
    toPolygons,
    booleanPolygons,
    polygonArea,
    signedRingArea,
  };
})((globalThis.Joinery = globalThis.Joinery || {}));
