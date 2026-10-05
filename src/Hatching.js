/** Vector section hatches, clipped against actual outlines and Boolean holes. */
(function (J) {
  "use strict";
  const { add, sub, mul, unit, dot, perpendicular, pointInPolygon } =
    J.Geometry;
  function clip(a, b, polygons) {
    const v = sub(b, a),
      ts = [0, 1];
    for (const polygon of polygons)
      for (const ring of polygon)
        for (let i = 0; i < ring.length; i++) {
          const c = ring[i],
            w = sub(ring[(i + 1) % ring.length], c),
            d = sub(c, a),
            cross = v.x * w.y - v.y * w.x;
          if (Math.abs(cross) < 1e-9) continue;
          const t = (d.x * w.y - d.y * w.x) / cross,
            u = (d.x * v.y - d.y * v.x) / cross;
          if (t > 0 && t < 1 && u >= 0 && u <= 1) ts.push(t);
        }
    ts.sort((x, y) => x - y);
    const result = [];
    for (let i = 1; i < ts.length; i++) {
      if (ts[i] - ts[i - 1] < 1e-8) continue;
      const p = add(a, mul(v, (ts[i] + ts[i - 1]) / 2));
      if (
        polygons.some(
          (rings) =>
            pointInPolygon(p, rings[0]) &&
            !rings.slice(1).some((r) => pointInPolygon(p, r)),
        )
      )
        result.push([add(a, mul(v, ts[i - 1])), add(a, mul(v, ts[i]))]);
    }
    return result;
  }
  function primitives(e, paperScale = 1, textHoles = []) {
    const spec = e.type === "region" ? e.part : e,
      material = J.Materials.kind(spec?.materialKind);
    if (
      !material ||
      !["panel", "region", "rectangle", "polyline"].includes(e.type)
    )
      return [];
    let polygons = e.type === "region" ? e.polygons : [[e.points]],
      points = polygons.flat(2),
      stock = e.stockPoints || e.points;
    if (textHoles && textHoles.length > 0) {
      const minX = Math.min(...points.map((p) => p.x)),
        maxX = Math.max(...points.map((p) => p.x)),
        minY = Math.min(...points.map((p) => p.y)),
        maxY = Math.max(...points.map((p) => p.y));
      const relevant = textHoles.filter((ring) => {
        const rMinX = Math.min(...ring.map((p) => p.x)),
          rMaxX = Math.max(...ring.map((p) => p.x)),
          rMinY = Math.min(...ring.map((p) => p.y)),
          rMaxY = Math.max(...ring.map((p) => p.y));
        return !(rMaxX < minX || rMinX > maxX || rMaxY < minY || rMinY > maxY);
      });
      if (relevant.length > 0) {
        polygons = polygons.map((poly) => [poly[0], ...poly.slice(1), ...relevant]);
      }
    }
    let direction =
      stock?.length >= 4 ? unit(sub(stock[1], stock[0])) : { x: 1, y: 0 };
    if (
      material.pattern === "longitudinal" &&
      stock?.length >= 4 &&
      J.Geometry.distance(stock[0], stock[1]) <
        J.Geometry.distance(stock[1], stock[2])
    )
      direction = perpendicular(direction);
    if (["diagonal", "glass"].includes(material.pattern))
      direction = unit(add(direction, perpendicular(direction)));
    else if (["board", "laminate"].includes(material.pattern))
      direction = perpendicular(direction);
    const n = perpendicular(direction),
      along = points.map((p) => dot(p, direction)),
      across = points.map((p) => dot(p, n)),
      lo = Math.min(...across),
      hi = Math.max(...across),
      u0 = Math.min(...along) - 1,
      u1 = Math.max(...along) + 1;
    // Bound tessellation during far zoom-out and on large imported geometry.
    const spacing = Math.max(
        paperScale * (material.pattern === "glass" ? 8 : 3),
        (hi - lo) / 400,
      ),
      lines = [];
    function line(t) {
      const a = add(mul(direction, u0), mul(n, t)),
        b = add(mul(direction, u1), mul(n, t));
      for (const segment of clip(a, b, polygons))
        if (lines.length < 1600)
          lines.push({
            kind: "path",
            points: segment,
            thin: true,
            hatch: true,
          });
    }
    for (let t = Math.ceil(lo / spacing) * spacing; t < hi; t += spacing) {
      line(t);
      if (material.pattern === "glass") {
        line(t + paperScale * 0.7);
        line(t + paperScale * 1.4);
      }
    }
    if (material.pattern === "laminate" && stock?.length >= 4) {
      const x = unit(sub(stock[1], stock[0])),
        y = unit(sub(stock[3], stock[0])),
        width = J.Geometry.distance(stock[0], stock[1]),
        height = J.Geometry.distance(stock[0], stock[3]),
        inset = Math.min(paperScale, width / 4, height / 4);
      for (const t of [inset, height - inset]) {
        const a = add(stock[0], add(mul(x, inset), mul(y, t))),
          b = add(a, mul(x, width - 2 * inset));
        for (const segment of clip(a, b, polygons))
          lines.push({
            kind: "path",
            points: segment,
            thin: true,
            hatch: true,
          });
      }
    }
    return lines;
  }
  J.Hatching = { primitives, clip };
})((globalThis.Joinery = globalThis.Joinery || {}));
