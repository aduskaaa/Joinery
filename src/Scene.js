/** Scene: plain-script module. Loaded in dependency order by index.html. */
(function (Joinery) {
  "use strict";
  const {
    add,
    mul,
    sub,
    unit,
    distance,
    angle,
    normalizeAngle,
    dimensionGeometry,
    vertices,
    midpoint,
  } = Joinery.Geometry;
  const unitFactor = (u) => ({ mm: 1, cm: 10, m: 1000, in: 25.4 })[u] || 1;
  function measure(n, u = "mm") {
    const value = n / unitFactor(u);
    return Number(value.toFixed(u === "m" || u === "in" ? 3 : 2)).toString();
  }
  const path = (points, closed = false, extra = {}) => ({
    kind: "path",
    points,
    closed,
    ...extra,
  });
  const text = (p, value, size = 14, extra = {}) => ({
    kind: "text",
    p,
    text: value,
    size,
    ...extra,
  });
  /** Shared geometry drives the viewport, SVG, DXF annotations and vector PDF. */
  function primitives(
    e,
    units = "mm",
    { paperScale = 1, textHeight = 2.5, termination = "slash", textHoles = [] } = {},
  ) {
    const size = textHeight * paperScale;
    const annotation = (p, value) => text(p, value, size, { annotation: true });
    // One compound primitive keeps islands and holes together for even-odd filling.
    if (e.type === "region")
      return [
        { kind: "region", polygons: e.polygons, fill: "region" },
        ...(Joinery.Hatching?.primitives(e, paperScale, textHoles) || []),
      ];
    if (["circle", "drill"].includes(e.type)) {
      const list = [{ kind: "circle", center: e.center, radius: e.radius }];
      if (e.type === "drill") {
        const s = Math.max(e.radius * 1.45, 5);
        list.push(
          path(
            [add(e.center, { x: -s, y: 0 }), add(e.center, { x: s, y: 0 })],
            false,
            { thin: true, dash: true },
          ),
          path(
            [add(e.center, { x: 0, y: -s }), add(e.center, { x: 0, y: s })],
            false,
            { thin: true, dash: true },
          ),
        );
      }
      return list;
    }
    if (e.type === "arc") return [{ kind: "arc", ...e }];
    if (e.type === "text")
      return [
        text(e.points[0], e.text, e.size || 14, {
          anchor: "start",
          orientation: e.orientation || "horizontal",
        }),
      ];
    if (e.type === "dimension") {
      const g = dimensionGeometry(e, { paperScale, termination }),
        center = midpoint(...g.points),
        label = annotation(center, measure(g.value, units));
      let normal = unit(sub(g.label, center));
      label.outward = normal;
      // Unidirectional lettering: reserve half its width beside vertical lines,
      // and its capital height when placed below an inclined dimension line.
      const clearance =
        paperScale * 2.75 +
        (Math.abs(normal.x) * textWidth(label)) / 2 +
        Math.max(0, -normal.y) * size;
      label.p = add(center, mul(normal, clearance));
      return [
        ...g.segments.map((s) => path(s, false, { thin: true })),
        ...g.symbols.map((s) => path(s, true, { fill: "solid", thin: true })),
        label,
      ];
    }

    if (e.type === "radius")
      return [
        path([e.center, e.points[0]], false, { thin: true }),
        annotation(
          add(midpoint(e.center, e.points[0]), { x: 0, y: paperScale * 1.5 }),
          `R ${measure(e.radius, units)}`,
        ),
      ];
    if (e.type === "angle") {
      const [c, a, b] = e.points,
        start = angle(c, a),
        end = angle(c, b),
        sweep = normalizeAngle(end - start),
        r = e.offset || Math.min(distance(c, a), distance(c, b)) * 0.38;
      const label = add(c, {
        x: Math.cos(start + sweep / 2) * (r + paperScale * (textHeight + 1.5)),
        y: Math.sin(start + sweep / 2) * (r + paperScale * (textHeight + 1.5)),
      });
      return [
        path([a, c, b], false, { thin: true }),
        { kind: "arc", center: c, radius: r, start, end, thin: true },
        annotation(label, `${Number(((sweep * 180) / Math.PI).toFixed(2))}°`),
      ];
    }
    const list = [
      path(
        vertices(e),
        e.closed || ["panel", "rectangle", "slot", "cutout"].includes(e.type),
        {
          fill:
            e.type === "panel"
              ? "panel"
              : e.type === "cutout"
                ? "cutout"
                : null,
          dash: e.type === "cutout",
        },
      ),
    ];
    if (e.type === "panel" && e.banding) {
      e.banding.forEach((v, i) => {
        if (v)
          list.push(
            path([e.points[i], e.points[(i + 1) % 4]], false, {
              banding: true,
            }),
          );
      });
    }
    list.push(...(Joinery.Hatching?.primitives(e, paperScale, textHoles) || []));
    return list;
  }

  // Helvetica/Arial digits have an advance of 0.556 em. A conservative width
  // estimate also leaves room for prefixes, decimal separators and degree marks.
  // ISO lettering height refers to the capital height, not the font em box.
  // Helvetica has CapHeight 718/1000; Arial is the matching browser fallback.
  function fontSize(p) {
    return p.annotation ? p.size / 0.718 : p.size;
  }
  function textWidth(p) {
    return p.text.length * fontSize(p) * 0.62;
  }
  function textBox(p, padding = 0) {
    const width = textWidth(p);
    if (p.orientation === "vertical") {
      const left = p.anchor === "start" ? p.p.x : p.p.x - p.size / 2;
      return {
        minX: left - padding,
        maxX: left + p.size + padding,
        minY: p.p.y - padding,
        maxY: p.p.y + width + padding,
      };
    }
    const left = p.anchor === "start" ? p.p.x : p.p.x - width / 2;
    return {
      minX: left - padding,
      maxX: left + width + padding,
      minY: p.p.y - p.size * 0.22 - padding,
      maxY: p.p.y + p.size + padding,
    };
  }
  function draftingScene(entities, units = "mm", options = {}) {
    const paperScale = options.paperScale || 1,
      placed = [];
    const textHoles = (options.textHoles || []).concat(
      entities
        .filter((e) => e.type === "text" && e.text)
        .map((e) => {
          const p = {
            kind: "text",
            p: e.points[0],
            text: e.text,
            size: e.size || 14,
            anchor: "start",
            orientation: e.orientation || "horizontal",
          };
          const box = textBox(p, Math.max(4, (e.size || 14) * 0.28));
          return [
            { x: box.minX, y: box.minY },
            { x: box.maxX, y: box.minY },
            { x: box.maxX, y: box.maxY },
            { x: box.minX, y: box.maxY },
          ];
        }),
    );
    const sceneOptions = { ...options, textHoles };
    return entities.map((entity) => {
      let drawn = entity,
        items = primitives(drawn, units, sceneOptions),
        label = items.find((p) => p.annotation && !p.materialTag);
      if (label) {
        const original = { ...label.p },
          direction = label.outward || { x: 0, y: 1 };
        for (let i = 0; i < 100; i++) {
          const box = textBox(label, paperScale * 0.5);
          if (
            !placed.some(
              (b) =>
                box.minX < b.maxX &&
                box.maxX > b.minX &&
                box.minY < b.maxY &&
                box.maxY > b.minY,
            )
          )
            break;
          const displacement = mul(direction, label.size * 1.6);
          if (entity.type === "dimension") {
            // Stagger the entire dimension, not just its number. Its witness
            // lines still reach and overrun their associated dimension line.
            drawn = {
              ...drawn,
              points: [
                drawn.points[0],
                drawn.points[1],
                add(drawn.points[2], displacement),
              ],
            };
            items = primitives(drawn, units, options);
            label = items.find((p) => p.annotation && !p.materialTag);
          } else label.p = add(label.p, displacement);
        }
        placed.push(textBox(label, paperScale * 0.5));
        if (entity.type !== "dimension" && distance(label.p, original) > 1e-6)
          items.push(path([original, label.p], false, { thin: true }));
      }
      return { entity, items };
    });
  }
  function sceneBounds(entities, scene) {
    const b = Joinery.Geometry.bounds(entities);
    for (const { items } of scene)
      for (const p of items) {
        // All rendered vertices count, including extension/tick/leader endpoints.
        if (p.kind === "path")
          for (const q of p.points) {
            b.min.x = Math.min(b.min.x, q.x);
            b.max.x = Math.max(b.max.x, q.x);
            b.min.y = Math.min(b.min.y, q.y);
            b.max.y = Math.max(b.max.y, q.y);
          }
        if (p.kind === "arc") {
          b.min.x = Math.min(b.min.x, p.center.x - p.radius);
          b.max.x = Math.max(b.max.x, p.center.x + p.radius);
          b.min.y = Math.min(b.min.y, p.center.y - p.radius);
          b.max.y = Math.max(b.max.y, p.center.y + p.radius);
        }
        if (p.kind !== "text") continue;
        const box = textBox(p);
        b.min.x = Math.min(b.min.x, box.minX);
        b.max.x = Math.max(b.max.x, box.maxX);
        b.min.y = Math.min(b.min.y, box.minY);
        b.max.y = Math.max(b.max.y, box.maxY);
      }
    b.width = b.max.x - b.min.x;
    b.height = b.max.y - b.min.y;
    return b;
  }
  const preferredScales = [
    1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000,
    100000, 200000, 500000, 1000000, 2000000, 5000000, 10000000, 20000000,
    50000000, 100000000,
  ];
  function monochrome(hex, light = false) {
    const rgb = hex
      .slice(1)
      .match(/../g)
      .map((v) => parseInt(v, 16));
    const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
    const v = Math.round(
      light
        ? Math.max(0, Math.min(110, (255 - luminance) * 0.7))
        : Math.max(160, Math.min(245, luminance)),
    );
    return `rgb(${v},${v},${v})`;
  }
  Joinery.Scene = {
    fontSize,
    monochrome,
    measure,
    path,
    primitives,
    text,
    unitFactor,
    textWidth,
    draftingScene,
    sceneBounds,
    preferredScales,
  };
})((globalThis.Joinery = globalThis.Joinery || {}));
