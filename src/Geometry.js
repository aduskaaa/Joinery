/** Geometry: plain-script module. Loaded in dependency order by index.html. */
(function (Joinery) {
  "use strict";
  /** Model coordinates are millimeters in a Cartesian, Y-up plane. */
  const EPS = 1e-8,
    TAU = Math.PI * 2;
  const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
  const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
  const dot = (a, b) => a.x * b.x + a.y * b.y;
  const cross = (a, b) => a.x * b.y - a.y * b.x;
  const length = (a) => Math.hypot(a.x, a.y);
  const distance = (a, b) => length(sub(a, b));
  const unit = (a) =>
    length(a) < EPS ? { x: 1, y: 0 } : mul(a, 1 / length(a));
  const perpendicular = (a) => ({ x: -a.y, y: a.x });
  const midpoint = (a, b) => mul(add(a, b), 0.5);
  const angle = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);
  const normalizeAngle = (a) => ((a % TAU) + TAU) % TAU;
  function rotatePoint(p, c, a) {
    const v = sub(p, c),
      cs = Math.cos(a),
      sn = Math.sin(a);
    return add(c, { x: v.x * cs - v.y * sn, y: v.x * sn + v.y * cs });
  }
  function projectPoint(p, a, b, clamp = true) {
    const d = sub(b, a),
      t = dot(sub(p, a), d) / (dot(d, d) || 1);
    return add(a, mul(d, clamp ? Math.max(0, Math.min(1, t)) : t));
  }
  function intersection(a, b, c, d, infiniteA = false, infiniteB = false) {
    const r = sub(b, a),
      s = sub(d, c),
      den = cross(r, s);
    if (Math.abs(den) < EPS) return null;
    const t = cross(sub(c, a), s) / den,
      u = cross(sub(c, a), r) / den;
    if (
      (!infiniteA && (t < -EPS || t > 1 + EPS)) ||
      (!infiniteB && (u < -EPS || u > 1 + EPS))
    )
      return null;
    return add(a, mul(r, t));
  }
  /** Analytic intersections avoid zoom-dependent tessellation errors. */
  function lineCircleIntersections(a, b, c, r, infinite = false) {
    const d = sub(b, a),
      f = sub(a, c),
      aa = dot(d, d);
    if (aa < EPS) return [];
    const bb = 2 * dot(f, d),
      cc = dot(f, f) - r * r,
      disc = bb * bb - 4 * aa * cc;
    if (disc < -EPS) return [];
    const root = Math.sqrt(Math.max(0, disc)),
      ts = [(-bb - root) / (2 * aa), (-bb + root) / (2 * aa)];
    return ts
      .filter(
        (t, i) =>
          (infinite || (t >= -EPS && t <= 1 + EPS)) &&
          (i === 0 || Math.abs(t - ts[0]) > EPS),
      )
      .map((t) => add(a, mul(d, t)));
  }
  function circleIntersections(a, ra, b, rb) {
    const d = distance(a, b);
    if (d < EPS || d > ra + rb + EPS || d < Math.abs(ra - rb) - EPS) return [];
    const along = (ra * ra - rb * rb + d * d) / (2 * d),
      h = Math.sqrt(Math.max(0, ra * ra - along * along)),
      dir = unit(sub(b, a)),
      foot = add(a, mul(dir, along)),
      normal = mul(perpendicular(dir), h);
    return h < EPS ? [foot] : [add(foot, normal), sub(foot, normal)];
  }
  function onArc(e, p) {
    return (
      e.type !== "arc" ||
      normalizeAngle(angle(e.center, p) - e.start) <=
        (normalizeAngle(e.end - e.start) || TAU) + EPS
    );
  }
  function circleThrough(a, b, c) {
    const u = sub(b, a),
      v = sub(c, a),
      d = 2 * cross(u, v);
    if (Math.abs(d) < EPS) return null;
    const uu = dot(u, u),
      vv = dot(v, v),
      center = add(a, {
        x: (v.y * uu - u.y * vv) / d,
        y: (u.x * vv - v.x * uu) / d,
      });
    let start = angle(center, a),
      end = angle(center, c);
    if (normalizeAngle(angle(center, b) - start) > normalizeAngle(end - start))
      [start, end] = [end, start];
    return { center, radius: distance(center, a), start, end };
  }
  function arcPoints(e, steps = 72) {
    const sweep = normalizeAngle(e.end - e.start) || TAU,
      n = Math.max(8, Math.ceil((steps * sweep) / TAU));
    return Array.from({ length: n + 1 }, (_, i) =>
      add(e.center, {
        x: Math.cos(e.start + (sweep * i) / n) * e.radius,
        y: Math.sin(e.start + (sweep * i) / n) * e.radius,
      }),
    );
  }
  function slotPoints(a, b, width) {
    const r = width / 2,
      theta = angle(a, b),
      pts = [];
    for (let i = 0; i <= 24; i++) {
      const t = theta - Math.PI / 2 + (Math.PI * i) / 24;
      pts.push(add(b, { x: r * Math.cos(t), y: r * Math.sin(t) }));
    }
    for (let i = 0; i <= 24; i++) {
      const t = theta + Math.PI / 2 + (Math.PI * i) / 24;
      pts.push(add(a, { x: r * Math.cos(t), y: r * Math.sin(t) }));
    }
    return pts;
  }
  function vertices(e) {
    if (e.type === "detail")
      return [
        ...vertices({ type: "circle", center: e.center, radius: e.radius }),
        ...vertices({
          type: "circle",
          center: e.points[0],
          radius: e.radius * e.factor,
        }),
      ];
    if (e.bulges?.some(Boolean) && Joinery.GeometryEngine) {
      const out = [],
        n = e.closed ? e.points.length : e.points.length - 1;
      for (let i = 0; i < n; i++)
        out.push(
          ...Joinery.GeometryEngine.GeometryEngine.bulgePoints(
            e.points[i],
            e.points[(i + 1) % e.points.length],
            e.bulges[i] || 0,
          ).slice(0, -1),
        );
      if (!e.closed) out.push(e.points.at(-1));
      return out;
    }
    if (e.type === "region") return e.polygons.flat(2);
    if (e.type === "slot") return slotPoints(e.points[0], e.points[1], e.width);
    if (e.type === "arc") return arcPoints(e);
    if (e.type === "circle" || e.type === "drill")
      return Array.from({ length: 96 }, (_, i) =>
        add(e.center, {
          x: e.radius * Math.cos((i * TAU) / 96),
          y: e.radius * Math.sin((i * TAU) / 96),
        }),
      );
    return e.points || (e.center ? [e.center] : []);
  }
  function segments(e) {
    if (e.type === "region")
      return e.polygons.flatMap((polygon) =>
        polygon.flatMap((ring) =>
          ring.map((p, i) => [p, ring[(i + 1) % ring.length]]),
        ),
      );
    if (
      ![
        "line",
        "polyline",
        "rectangle",
        "panel",
        "cutout",
        "slot",
        "arc",
        "leader",
      ].includes(e.type)
    )
      return [];
    const pts = vertices(e),
      out = [];
    for (let i = 1; i < pts.length; i++) out.push([pts[i - 1], pts[i]]);
    if (e.closed || ["panel", "rectangle", "cutout", "slot"].includes(e.type))
      out.push([pts.at(-1), pts[0]]);
    return out;
  }
  /** Exact boundary edges for picking, snapping and trimming (no display tessellation). */
  function curveEdges(e) {
    if (e.symbolType) return [];
    const line = (a, b) => ({ points: [a, b] });
    const arc = (center, radius, start, sweep) => ({
      center,
      radius,
      start,
      sweep,
    });
    if (e.type === "region" || (e.type === "panel" && e.polygons))
      return e.polygons.flatMap((polygon) =>
        polygon.flatMap((ring) =>
          ring.map((a, i) => line(a, ring[(i + 1) % ring.length])),
        ),
      );
    if (["circle", "drill", "arc"].includes(e.type)) {
      const sweep =
        e.type === "arc" ? normalizeAngle(e.end - e.start) || TAU : TAU;
      const arcEdge = arc(e.center, e.radius, e.start || 0, sweep);
      if (e.type === "arc" && e.closed && sweep < TAU - 1e-6) {
        const pStart = add(e.center, {
          x: e.radius * Math.cos(e.start || 0),
          y: e.radius * Math.sin(e.start || 0),
        });
        const pEnd = add(e.center, {
          x: e.radius * Math.cos((e.start || 0) + sweep),
          y: e.radius * Math.sin((e.start || 0) + sweep),
        });
        if (e.closed === "sector" || e.sector === true) {
          return [arcEdge, line(pEnd, e.center), line(e.center, pStart)];
        }
        return [arcEdge, line(pEnd, pStart)];
      }
      return [arcEdge];
    }
    if (e.type === "slot") {
      const [a, b] = e.points,
        r = e.width / 2,
        theta = angle(a, b),
        n = mul(perpendicular(unit(sub(b, a))), r);
      if (distance(a, b) < EPS) return [arc(a, r, 0, TAU)];
      return [
        line(sub(a, n), sub(b, n)),
        arc(b, r, theta - Math.PI / 2, Math.PI),
        line(add(b, n), add(a, n)),
        arc(a, r, theta + Math.PI / 2, Math.PI),
      ];
    }
    if (!["line", "polyline", "rectangle", "panel", "cutout"].includes(e.type))
      return [];
    const edges = [],
      count =
        e.closed || ["rectangle", "panel", "cutout"].includes(e.type)
          ? e.points.length
          : e.points.length - 1;
    for (let i = 0; i < count; i++) {
      const a = e.points[i],
        b = e.points[(i + 1) % e.points.length],
        bulge = e.bulges?.[i] || 0,
        chord = distance(a, b);
      if (chord < EPS) continue;
      if (Math.abs(bulge) < EPS) edges.push(line(a, b));
      else {
        const center = add(
          midpoint(a, b),
          mul(
            perpendicular(unit(sub(b, a))),
            (chord * (1 - bulge * bulge)) / (4 * bulge),
          ),
        );
        edges.push(
          arc(
            center,
            distance(center, a),
            angle(center, a),
            4 * Math.atan(bulge),
          ),
        );
      }
    }
    return edges;
  }
  function edgePoint(e, t) {
    return e.center
      ? add(e.center, {
          x: e.radius * Math.cos(e.start + t * e.sweep),
          y: e.radius * Math.sin(e.start + t * e.sweep),
        })
      : add(e.points[0], mul(sub(e.points[1], e.points[0]), t));
  }
  function edgeParameter(e, p) {
    if (!e.center) {
      const d = sub(e.points[1], e.points[0]);
      return dot(sub(p, e.points[0]), d) / (dot(d, d) || 1);
    }
    if (distance(edgePoint(e, 0), p) < EPS) return 0;
    if (Math.abs(e.sweep) < TAU - EPS && distance(edgePoint(e, 1), p) < EPS)
      return 1;
    return (
      normalizeAngle((angle(e.center, p) - e.start) * Math.sign(e.sweep)) /
      Math.abs(e.sweep)
    );
  }
  function edgeClosest(e, p) {
    if (!e.center) return projectPoint(p, ...e.points);
    const q = add(e.center, mul(unit(sub(p, e.center)), e.radius));
    if (edgeParameter(e, q) <= 1 + EPS) return q;
    const a = edgePoint(e, 0),
      b = edgePoint(e, 1);
    return distance(p, a) <= distance(p, b) ? a : b;
  }
  function edgeIntersections(a, b, infiniteA = false) {
    let points;
    if (a.center && b.center)
      points = circleIntersections(a.center, a.radius, b.center, b.radius);
    else if (a.center)
      points = lineCircleIntersections(...b.points, a.center, a.radius);
    else if (b.center)
      points = lineCircleIntersections(
        ...a.points,
        b.center,
        b.radius,
        infiniteA,
      );
    else {
      const p = intersection(...a.points, ...b.points, infiniteA);
      if (p) return [p];
      // Collinear overlaps have meaningful trim boundaries at their endpoints.
      return b.points.filter(
        (p) => distance(p, projectPoint(p, ...a.points, !infiniteA)) < EPS,
      );
    }
    return points.filter((p) =>
      [a, b].every(
        (e, i) =>
          (infiniteA && i === 0 && !e.center) ||
          (edgeParameter(e, p) >= -EPS && edgeParameter(e, p) <= 1 + EPS),
      ),
    );
  }
  function bounds(entities) {
    const pts = entities
      .flatMap((e) => {
        if (e.type === "dimension") {
          const g = dimensionGeometry(e);
          return [...e.points, ...g.points, g.label];
        }
        if (e.type === "text")
          return [
            e.points[0],
            add(e.points[0], {
              x: (e.text || "").length * (e.size || 14) * 0.65,
              y: e.size || 14,
            }),
          ];
        if (e.type === "radius")
          return [...vertices({ ...e, type: "circle" }), ...e.points];
        if (e.type === "angle") return e.points;
        return vertices(e);
      })
      .filter(Boolean);
    if (!pts.length)
      return {
        min: { x: 0, y: 0 },
        max: { x: 1000, y: 800 },
        width: 1000,
        height: 800,
      };
    const min = { x: Infinity, y: Infinity },
      max = { x: -Infinity, y: -Infinity };
    for (const p of pts) {
      min.x = Math.min(min.x, p.x);
      min.y = Math.min(min.y, p.y);
      max.x = Math.max(max.x, p.x);
      max.y = Math.max(max.y, p.y);
    }
    return { min, max, width: max.x - min.x, height: max.y - min.y };
  }
  function entityCenter(e) {
    if (e.center) return e.center;
    if (e.type === "region") {
      const b = bounds([e]);
      return midpoint(b.min, b.max);
    }
    const pts = e.points || [];
    return mul(
      pts.reduce((s, p) => add(s, p), { x: 0, y: 0 }),
      1 / (pts.length || 1),
    );
  }
  function pointInPolygon(p, pts) {
    let inside = false;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const a = pts[i],
        b = pts[j];
      if (
        a.y > p.y !== b.y > p.y &&
        p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
      )
        inside = !inside;
    }
    return inside;
  }
  function pointInRegion(p, polygons) {
    return polygons.some(
      (polygon) =>
        pointInPolygon(p, polygon[0]) &&
        !polygon.slice(1).some((hole) => pointInPolygon(p, hole)),
    );
  }
  function hitDistance(e, p) {
    if (e.type === "detail")
      return Math.min(
        Math.abs(distance(p, e.center) - e.radius),
        Math.abs(distance(p, e.points[0]) - e.radius * e.factor),
        ...Joinery.GeometryEngine.GeometryEngine.detailEntities(e)
          .filter((c) => !c.detailFill)
          .map((c) => hitDistance(c, p)),
      );
    if (["circle", "drill", "arc"].includes(e.type))
      return distance(p, edgeClosest(curveEdges(e)[0], p));
    if (e.type === "text") return distance(p, e.points[0]);
    if (e.type === "dimension") {
      const g = dimensionGeometry(e);
      return Math.min(
        ...g.segments.map(([a, b]) => distance(p, projectPoint(p, a, b))),
      );
    }
    if (e.type === "angle")
      return Math.min(...e.points.map((q) => distance(p, q)));
    if (e.type === "radius")
      return distance(p, projectPoint(p, e.center, e.points[0]));
    const curves = curveEdges(e);
    if (curves.length)
      return Math.min(
        ...curves.map((edge) => distance(p, edgeClosest(edge, p))),
      );
    const edges = segments(e);
    return edges.length
      ? Math.min(...edges.map(([a, b]) => distance(p, projectPoint(p, a, b))))
      : Infinity;
  }
  function transformEntity(e, fn) {
    const copy = structuredClone(e);
    if (copy.points) copy.points = copy.points.map(fn);
    if (copy.grainVector) copy.grainVector = copy.grainVector.map(fn);
    if (copy.bulges) {
      const a = fn({ x: 0, y: 0 }),
        b = fn({ x: 1, y: 0 }),
        c = fn({ x: 0, y: 1 });
      if (cross(sub(b, a), sub(c, a)) < 0)
        copy.bulges = copy.bulges.map((v) => -v);
    }
    if (copy.target) copy.target = fn(copy.target);
    if (copy.type === "detail") {
      copy.contents = copy.contents.map((e) => transformEntity(e, fn));
    }
    if (copy.polygons)
      copy.polygons = copy.polygons.map((polygon) =>
        polygon.map((ring) => ring.map(fn)),
      );
    if (copy.stockPoints) copy.stockPoints = copy.stockPoints.map(fn);
    if (copy.center) {
      if (copy.type === "arc") {
        const a = fn(
            add(copy.center, {
              x: copy.radius * Math.cos(copy.start),
              y: copy.radius * Math.sin(copy.start),
            }),
          ),
          b = fn(
            add(copy.center, {
              x: copy.radius * Math.cos(copy.end),
              y: copy.radius * Math.sin(copy.end),
            }),
          );
        const ori = [
          fn(copy.center),
          fn(add(copy.center, { x: 1, y: 0 })),
          fn(add(copy.center, { x: 0, y: 1 })),
        ];
        copy.center = fn(copy.center);
        copy.start = angle(copy.center, a);
        copy.end = angle(copy.center, b);
        if (cross(sub(ori[1], ori[0]), sub(ori[2], ori[0])) < 0)
          [copy.start, copy.end] = [copy.end, copy.start];
      } else copy.center = fn(copy.center);
    }
    return copy;
  }
  function dimensionGeometry(
    e,
    { paperScale = 1, termination = "slash" } = {},
  ) {
    const [a, b, placement = midpoint(a, b)] = e.points;
    let dir = e.dimensionAxis ? unit(e.dimensionAxis) : unit(sub(b, a));
    if (!e.dimensionAxis && e.mode === "horizontal") dir = { x: 1, y: 0 };
    if (!e.dimensionAxis && e.mode === "vertical") dir = { x: 0, y: 1 };
    // Canonical direction keeps slash terminations consistent when endpoints
    // are picked in reverse order. Projection is independent of its sign.
    if (dir.x < -EPS || (Math.abs(dir.x) < EPS && dir.y < 0))
      dir = mul(dir, -1);
    const n = perpendicular(dir),
      pa = add(a, mul(n, dot(sub(placement, a), n))),
      pb = add(b, mul(n, dot(sub(placement, b), n))),
      signed = dot(sub(pb, pa), dir),
      outward = dot(sub(pa, a), n) < 0 ? mul(n, -1) : n,
      tick = unit(add(dir, n)),
      tickHalf = paperScale * 1.25,
      // Thin lines are 0.25 mm on paper; eight widths give a 2 mm overrun.
      overrun = paperScale * 2;
    const extension = (origin, end) => {
      const delta = sub(end, origin),
        span = length(delta),
        direction = span > EPS ? unit(delta) : outward;
      // Keep a small feature gap, but never let it erase a short extension.
      return [
        add(origin, mul(direction, Math.min(paperScale, span / 4))),
        add(end, mul(direction, overrun)),
      ];
    };
    const segments = [extension(a, pa), extension(b, pb), [pa, pb]],
      symbols = [];
    const style = e.termination || termination;
    if (style === "slash")
      segments.push(
        [sub(pa, mul(tick, tickHalf)), add(pa, mul(tick, tickHalf))],
        [sub(pb, mul(tick, tickHalf)), add(pb, mul(tick, tickHalf))],
      );
    else {
      const axis = unit(sub(pb, pa)),
        short = distance(pa, pb) < paperScale * 8;
      for (const [tip, inward] of [
        [pa, axis],
        [pb, mul(axis, -1)],
      ]) {
        const base = add(tip, mul(inward, paperScale * 3 * (short ? -1 : 1))),
          half = mul(perpendicular(inward), paperScale * 0.5),
          triangle = [add(base, half), tip, sub(base, half)];
        if (style === "filled") symbols.push(triangle);
        else segments.push(triangle);
        if (short) segments.push([tip, add(tip, mul(inward, -paperScale * 4))]);
      }
    }
    return {
      segments,
      symbols,
      points: [pa, pb],
      label: add(midpoint(pa, pb), mul(outward, paperScale * 4)),
      value: Math.abs(signed) / (e.measurementFactor || 1),
    };
  }
  function offsetEntity(e, amount) {
    if (!Number.isFinite(amount) || e.bulges?.some(Boolean)) return null;
    if (["circle", "drill"].includes(e.type))
      return e.radius + amount > EPS
        ? { ...structuredClone(e), radius: e.radius + amount }
        : null;
    const edges = segments(e);
    if (e.type === "line") {
      if (distance(e.points[0], e.points[1]) <= EPS) return null;
      const n = mul(perpendicular(unit(sub(e.points[1], e.points[0]))), amount);
      return transformEntity(e, (p) => add(p, n));
    }
    if (e.type === "polyline" && !e.closed) {
      if (!edges.length || edges.some(([a, b]) => distance(a, b) <= EPS))
        return null;
      const shifted = edges.map(([a, b]) => {
        const n = mul(perpendicular(unit(sub(b, a))), amount);
        return [add(a, n), add(b, n)];
      });
      const next = [shifted[0][0]];
      for (let i = 1; i < shifted.length; i++) {
        const previous = shifted[i - 1],
          current = shifted[i];
        const p = intersection(...previous, ...current, true, true);
        // Collinear segments share a shifted vertex; a reversal has no
        // well-defined miter and is rejected rather than fabricating a path.
        if (p) next.push(p);
        else if (distance(previous[1], current[0]) <= EPS)
          next.push(current[0]);
        else return null;
      }
      next.push(shifted.at(-1)[1]);
      if (next.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))
        return null;
      return { ...structuredClone(e), points: next, closed: false };
    }
    if (
      !["panel", "rectangle", "cutout", "polyline"].includes(e.type) ||
      (!e.closed && !["panel", "rectangle", "cutout"].includes(e.type))
    )
      return null;
    const pts = e.points,
      area = pts.reduce(
        (s, p, i) => s + cross(p, pts[(i + 1) % pts.length]),
        0,
      );
    const shifted = edges.map(([a, b]) => {
      const n = mul(
        perpendicular(unit(sub(b, a))),
        area > 0 ? -amount : amount,
      );
      return [add(a, n), add(b, n)];
    });
    const next = shifted.map((edge, i) =>
      intersection(
        ...shifted[(i + shifted.length - 1) % shifted.length],
        ...edge,
        true,
        true,
      ),
    );
    if (
      next.some((p) => !p) ||
      next.some(
        (p, i) =>
          dot(
            sub(next[(i + 1) % next.length], p),
            sub(pts[(i + 1) % pts.length], pts[i]),
          ) <= EPS,
      )
    )
      return null;
    return {
      ...structuredClone(e),
      type: "polyline",
      points: next,
      closed: true,
    };
  }
  function adaptiveSpacing(zoom, targetPixels = 36, gridSize = 1) {
    const raw = Math.max(1, targetPixels / (zoom * gridSize)),
      base = 10 ** Math.floor(Math.log10(raw));
    return gridSize * [1, 2, 5, 10].map((n) => n * base).find((n) => n >= raw);
  }
  /** OSNAP pick tolerance comes from screen pixels; grid snap spacing is explicit. */
  function snapPoint(p, entities, options = {}) {
    const {
      tolerance = 10,
      grid = false,
      gridSize = 10,
      gridOrigin = { x: 0, y: 0 },
      gridPriority = false,
      object = true,
      base = null,
      ortho = false,
      modes = {},
    } = options;
    let constrained = p;
    if (ortho && base)
      constrained =
        Math.abs(p.x - base.x) >= Math.abs(p.y - base.y)
          ? { x: p.x, y: base.y }
          : { x: base.x, y: p.y };
    const gridPoint = {
      x:
        gridOrigin.x +
        Math.round((constrained.x - gridOrigin.x) / gridSize) * gridSize,
      y:
        gridOrigin.y +
        Math.round((constrained.y - gridOrigin.y) / gridSize) * gridSize,
    };
    const snapGrid = () => {
      let point = gridPoint;
      if (ortho && base)
        point =
          Math.abs(p.x - base.x) >= Math.abs(p.y - base.y)
            ? { x: point.x, y: base.y }
            : { x: base.x, y: point.y };
      return { point, kind: "Grid", distance: distance(constrained, point) };
    };
    // Move/copy uses a grid anchored at the base point. Drawing leaves OSNAP
    // enabled before the grid fallback, allowing exact off-grid connections.
    if (grid && gridPriority) return snapGrid();
    const candidates = [],
      allEdges = [];
    const push = (point, kind, priority = 0) => {
      const d = distance(constrained, point);
      if (
        d <= tolerance &&
        (!ortho ||
          !base ||
          Math.abs(point.x - base.x) < EPS ||
          Math.abs(point.y - base.y) < EPS)
      )
        candidates.push({ point, kind, distance: d, priority });
    };
    if (object) {
      for (const e of entities) {
        const edges = curveEdges(e);
        allEdges.push(...edges);
        if (modes.endpoint !== false) {
          const pts =
            e.type === "arc"
              ? edges.flatMap((edge) =>
                  Math.abs(edge.sweep) < TAU - EPS
                    ? [edgePoint(edge, 0), edgePoint(edge, 1)]
                    : [],
                )
              : e.type === "region"
                ? vertices(e)
                : e.points || [];
          pts.forEach((q) => push(q, "Endpoint", 5));
        }
        if (modes.midpoint !== false)
          for (const edge of edges) {
            if (edge.center && Math.abs(edge.sweep) >= TAU - EPS)
              for (let i = 0; i < 4; i++)
                push(edgePoint(edge, i / 4), "Quadrant", 2);
            else push(edgePoint(edge, 0.5), "Midpoint", 2);
          }
        if (
          modes.center !== false &&
          (e.center ||
            ["panel", "rectangle", "slot", "region"].includes(e.type))
        )
          push(entityCenter(e), "Center", 2);
        if (base && modes.perpendicular !== false)
          for (const edge of edges) {
            if (edge.center) {
              if (distance(base, edge.center) < EPS) continue;
              const radial = unit(sub(base, edge.center));
              for (const sign of [1, -1]) {
                const q = add(edge.center, mul(radial, edge.radius * sign));
                if (edgeParameter(edge, q) <= 1 + EPS)
                  push(q, "Perpendicular", 1);
              }
            } else {
              const [a, b] = edge.points,
                q = projectPoint(base, a, b);
              if (distance(q, a) > EPS && distance(q, b) > EPS)
                push(q, "Perpendicular", 1);
            }
          }
        if (base && !ortho && modes.parallel !== false)
          for (const edge of edges.filter((edge) => !edge.center))
            push(
              projectPoint(
                grid ? gridPoint : constrained,
                base,
                add(base, sub(edge.points[1], edge.points[0])),
                false,
              ),
              "Parallel",
              -1,
            );
      }
      if (modes.intersection !== false) {
        const near = allEdges
          .filter(
            (edge) =>
              distance(constrained, edgeClosest(edge, constrained)) <=
              tolerance,
          )
          .slice(0, 100);
        for (let i = 0; i < near.length; i++)
          for (let j = i + 1; j < near.length; j++)
            for (const q of edgeIntersections(near[i], near[j]))
              push(q, "Intersection", 4);
      }
    }
    candidates.sort(
      (a, b) =>
        a.distance -
        a.priority * tolerance * 0.08 -
        (b.distance - b.priority * tolerance * 0.08),
    );
    if (candidates.length) return candidates[0];
    if (grid) return snapGrid();
    return {
      point: constrained,
      kind: ortho && base ? "Ortho" : "",
      distance: 0,
    };
  }

  Joinery.Geometry = {
    EPS,
    TAU,
    adaptiveSpacing,
    add,
    angle,
    arcPoints,
    bounds,
    circleIntersections,
    circleThrough,
    cross,
    dimensionGeometry,
    distance,
    dot,
    entityCenter,
    curveEdges,
    edgePoint,
    edgeParameter,
    edgeClosest,
    edgeIntersections,
    hitDistance,
    intersection,
    length,
    lineCircleIntersections,
    midpoint,
    mul,
    normalizeAngle,
    offsetEntity,
    onArc,
    perpendicular,
    pointInPolygon,
    pointInRegion,
    projectPoint,
    rotatePoint,
    segments,
    slotPoints,
    snapPoint,
    sub,
    transformEntity,
    unit,
    vertices,
  };
})((globalThis.Joinery = globalThis.Joinery || {}));
