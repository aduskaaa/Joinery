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
  function rawPrimitives(
    e,
    units = "mm",
    {
      paperScale = 1,
      textHeight = 2.5,
      termination = "slash",
      textHoles = [],
    } = {},
  ) {
    const size = textHeight * paperScale;
    const annotation = (p, value) => text(p, value, size, { annotation: true });
    if (e.symbolType)
      return Joinery.Markings.primitives(e, { paperScale, textHeight });
    const materialLabel = Joinery.Markings?.materialLabel(
      e,
      paperScale,
      textHeight,
    );
    if (materialLabel) {
      const box = textBox(materialLabel, paperScale);
      textHoles = [
        ...textHoles,
        [
          { x: box.minX, y: box.minY },
          { x: box.maxX, y: box.minY },
          { x: box.maxX, y: box.maxY },
          { x: box.minX, y: box.maxY },
        ],
      ];
    }
    // Keep islands and holes together as unfilled manufacturing contours.
    if (e.type === "region")
      return [
        { kind: "region", polygons: e.polygons },
        ...(Joinery.Hatching?.primitives(e, paperScale, textHoles) || []),
        ...(materialLabel ? [materialLabel] : []),
      ];
    if (["circle", "drill"].includes(e.type)) {
      const list = [{ kind: "circle", center: e.center, radius: e.radius }];
      if (e.type === "drill") {
        const s = Math.max(e.radius * 1.45, 5);
        list.push(
          path(
            [add(e.center, { x: -s, y: 0 }), add(e.center, { x: s, y: 0 })],
            false,
            { thin: true, lineStyle: "dashdot" },
          ),
          path(
            [add(e.center, { x: 0, y: -s }), add(e.center, { x: 0, y: s })],
            false,
            { thin: true, lineStyle: "dashdot" },
          ),
        );
      }
      list.push(
        ...(Joinery.Hatching?.primitives(e, paperScale, textHoles) || []),
        ...(materialLabel ? [materialLabel] : []),
      );
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
      const vertical = Math.abs(g.points[1].x - g.points[0].x) < 1e-7;
      if (vertical) label.orientation = "vertical";
      // Vertical lettering reads from the right, with its full capital height
      // reserved to the left of the rotated baseline.
      const clearance = vertical
        ? paperScale * 1.5 + size * (normal.x > 0 ? 1 : 0.22)
        : paperScale * 2.75 +
          (Math.abs(normal.x) * textWidth(label)) / 2 +
          Math.max(0, -normal.y) * size;
      label.p = add(center, mul(normal, clearance));
      const extras = [];
      if (e.externalLabel) {
        const side = e.externalLabel;
        const tip = [...g.points].sort((a, b) =>
          vertical ? a.y - b.y : a.x - b.x,
        )[side > 0 ? 1 : 0];
        const sign = vertical ? (normal.x < 0 ? -1 : 1) : side;
        const elbow = add(tip, {
          x: sign * paperScale * 6,
          y: vertical ? side * paperScale * 6 : normal.y * paperScale * 6,
        });
        label.anchor = (vertical ? side : sign) < 0 ? "end" : "start";
        label.p = vertical
          ? add(elbow, {
              x: normal.x * paperScale * 1.25 + (normal.x > 0 ? size : 0),
              y: side * paperScale,
            })
          : add(elbow, { x: sign * paperScale, y: paperScale * 1.25 });
        extras.push(
          path(
            [
              tip,
              elbow,
              add(elbow, {
                x: vertical ? 0 : sign * (textWidth(label) + paperScale * 2),
                y: vertical ? side * (textWidth(label) + paperScale * 2) : 0,
              }),
            ],
            false,
            { thin: true },
          ),
        );
      }
      return [
        ...g.segments.map((s) => path(s, false, { thin: true })),
        ...g.symbols.map((s) => path(s, true, { fill: "solid", thin: true })),
        ...extras,
        label,
      ];
    }

    if (e.type === "radius") {
      const radial = unit(sub(e.points[0], e.center));
      const target = e.target || add(e.center, mul(radial, e.radius));
      return primitives(
        {
          ...e,
          type: "leader",
          points: [
            target,
            e.points[0],
            add(e.points[0], { x: paperScale * 15, y: 0 }),
          ],
          text: `R${measure(e.radius / (e.measurementFactor || 1), units)}`,
        },
        units,
        { paperScale, textHeight },
      );
    }
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
    if (materialLabel) list.push(materialLabel);
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
    list.push(
      ...(Joinery.Hatching?.primitives(e, paperScale, textHoles) || []),
    );
    return list;
  }

  function primitives(e, units = "mm", options = {}) {
    const scale = options.paperScale || 1,
      spec = e.part || e;
    let result;
    if (e.type === "leader") {
      const [a, b, c] = e.points,
        dir = unit(sub(b, a)),
        normal = { x: -dir.y, y: dir.x },
        arrowLength = e.layoutArrowLength || scale * 3,
        arrowWidth = Math.min(scale * 0.5, arrowLength / 6),
        tip = add(a, mul(dir, arrowLength));
      const sign = c.x < b.x ? -1 : 1;
      const label = text(
        add(b, { x: sign * scale, y: scale }),
        e.text,
        (options.textHeight || 2.5) * scale,
        { annotation: true, anchor: sign < 0 ? "end" : "start" },
      );
      const end = add(b, {
        x: sign * Math.max(Math.abs(c.x - b.x), textWidth(label) + scale * 2),
        y: 0,
      });
      result = [
        path([a, b, end], false, { thin: true }),
        path(
          [
            a,
            add(tip, mul(normal, arrowWidth)),
            add(tip, mul(normal, -arrowWidth)),
          ],
          true,
          { fill: "solid", thin: true },
        ),
        label,
      ];
    } else if (e.type === "detail") {
      const dest = e.points[0],
        transform = (p) => add(dest, mul(sub(p, e.center), e.factor));
      result = [
        {
          kind: "circle",
          center: e.center,
          radius: e.radius,
          thin: true,
          lineStyle: "dashdot",
        },
        {
          kind: "circle",
          center: dest,
          radius: e.radius * e.factor,
          thin: true,
        },
        text(
          add(dest, { x: 0, y: e.radius * e.factor + scale * 5 }),
          `${e.name || "Detail"} 1:${e.detailScale || 1}`,
          scale * 2.5,
          { annotation: true },
        ),
      ];
      for (const child of e.contents || [])
        result.push(
          ...primitives(
            {
              ...Joinery.Geometry.transformEntity(child, transform),
              ...(child.radius != null
                ? { radius: child.radius * e.factor }
                : {}),
            },
            units,
            { ...options, paperScale: scale },
          ),
        );
    } else if (e.bulges?.some(Boolean)) {
      result = Joinery.GeometryEngine.GeometryEngine.explode(e).flatMap(
        (child) => rawPrimitives(child, units, options),
      );
      const label = Joinery.Markings?.materialLabel(
          e,
          scale,
          options.textHeight || 2.5,
        ),
        box = label && textBox(label, scale),
        holes = box
          ? [
              ...(options.textHoles || []),
              [
                { x: box.minX, y: box.minY },
                { x: box.maxX, y: box.minY },
                { x: box.maxX, y: box.maxY },
                { x: box.minX, y: box.maxY },
              ],
            ]
          : options.textHoles;
      result.push(
        ...(Joinery.Hatching?.primitives(e, scale, holes) || []),
        ...(label ? [label] : []),
      );
    } else result = rawPrimitives(e, units, options);
    if (spec.banding && e.type !== "panel" && e.type !== "region") {
      const pts = e.stockPoints || e.points;
      if (pts?.length >= 4)
        spec.banding.forEach((v, i) => {
          if (v)
            result.push(
              path([pts[i], pts[(i + 1) % 4]], false, { banding: true }),
            );
        });
    }
    if (e.grainVector) {
      const [a, b] = e.grainVector,
        u = unit(sub(a, b)),
        n = { x: -u.y, y: u.x };
      result.push(
        path([a, b], false, { thin: true, lineStyle: "dashdot" }),
        path(
          [
            add(b, add(mul(u, scale * 3), mul(n, scale))),
            b,
            add(b, sub(mul(u, scale * 3), mul(n, scale))),
          ],
          false,
          { thin: true },
        ),
      );
    }
    return result.map((p) => ({
      ...p,
      stroke: e.stroke,
      lineWeight: p.hatch ? 0.13 : (p.lineWeight ?? e.lineWeight),
      ...(p.hatch ? { opacity: 1 } : {}),
      lineStyle:
        p.lineStyle || e.lineStyle || (p.dash ? "dashed" : "continuous"),
    }));
  }

  // Helvetica/Arial digits have an advance of 0.556 em. A conservative width
  // estimate also leaves room for prefixes, decimal separators and degree marks.
  // ISO lettering height refers to the capital height, not the font em box.
  // Helvetica has CapHeight 718/1000; Arial is the matching browser fallback.
  function fontSize(p) {
    return p.annotation ? p.size / 0.718 : p.size;
  }
  function textWidth(p) {
    if (Joinery.PdfFont) {
      const m = Joinery.PdfFont.load();
      return [...String(p.text)].reduce(
        (sum, ch) =>
          sum +
          (m.advance(m.glyph(ch.codePointAt(0))) *
            (p.annotation ? p.size / m.capHeight : fontSize(p))) /
            1000,
        0,
      );
    }
    return p.text.length * fontSize(p) * 0.62;
  }
  function textBox(p, padding = 0) {
    const width = textWidth(p);
    if (p.rotation != null) {
      const offset =
          p.anchor === "start" ? 0 : p.anchor === "end" ? width : width / 2,
        c = Math.cos(p.rotation),
        s = Math.sin(p.rotation),
        corners = [
          [-offset, -p.size * 0.22],
          [width - offset, -p.size * 0.22],
          [width - offset, p.size],
          [-offset, p.size],
        ].map(([x, y]) => ({
          x: p.p.x + x * c - y * s,
          y: p.p.y + x * s + y * c,
        }));
      return {
        minX: Math.min(...corners.map((q) => q.x)) - padding,
        maxX: Math.max(...corners.map((q) => q.x)) + padding,
        minY: Math.min(...corners.map((q) => q.y)) - padding,
        maxY: Math.max(...corners.map((q) => q.y)) + padding,
      };
    }
    if (p.orientation === "vertical") {
      const offset =
        p.anchor === "start" ? 0 : p.anchor === "end" ? width : width / 2;
      return {
        minX: p.p.x - p.size - padding,
        maxX: p.p.x + p.size * 0.22 + padding,
        minY: p.p.y - offset - padding,
        maxY: p.p.y + width - offset + padding,
      };
    }
    const left =
      p.anchor === "start"
        ? p.p.x
        : p.anchor === "end"
          ? p.p.x - width
          : p.p.x - width / 2;
    return {
      minX: left - padding,
      maxX: left + width + padding,
      minY: p.p.y - p.size * 0.22 - padding,
      maxY: p.p.y + p.size + padding,
    };
  }
  // Broad-phase bins keep crowded annotation layout local even on large drawings.
  class LayoutIndex {
    constructor(cell) {
      this.cell = cell;
      this.bins = new Map();
      this.large = [];
    }
    keys(box) {
      const loX = Math.floor(box.minX / this.cell),
        hiX = Math.floor(box.maxX / this.cell),
        loY = Math.floor(box.minY / this.cell),
        hiY = Math.floor(box.maxY / this.cell);
      if ((hiX - loX + 1) * (hiY - loY + 1) > 512) return null;
      const keys = [];
      for (let x = loX; x <= hiX; x++)
        for (let y = loY; y <= hiY; y++) keys.push(x + ":" + y);
      return keys;
    }
    add(item) {
      const keys = this.keys(item.box);
      if (!keys) {
        this.large.push(item);
        return;
      }
      for (const key of keys) {
        if (!this.bins.has(key)) this.bins.set(key, []);
        this.bins.get(key).push(item);
      }
    }
    query(box) {
      const keys = this.keys(box),
        out = new Set(this.large);
      if (keys)
        for (const key of keys)
          for (const item of this.bins.get(key) || []) out.add(item);
      else
        for (const bin of this.bins.values())
          for (const item of bin) out.add(item);
      return [...out].filter((item) => overlaps(box, item.box));
    }
  }
  const overlaps = (a, b) =>
    a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
  const edgeBox = ([a, b]) => ({
    minX: Math.min(a.x, b.x),
    maxX: Math.max(a.x, b.x),
    minY: Math.min(a.y, b.y),
    maxY: Math.max(a.y, b.y),
  });
  const expanded = (box, gap) => ({
    minX: box.minX - gap,
    maxX: box.maxX + gap,
    minY: box.minY - gap,
    maxY: box.maxY + gap,
  });
  function pathsClash(a, b, gap, sharedTarget) {
    const hit = Joinery.Geometry.intersection(...a, ...b);
    if (hit) return !(sharedTarget && distance(hit, sharedTarget) < 1e-6);
    const separation = Math.min(
      ...a.map((p) => distance(p, Joinery.Geometry.projectPoint(p, ...b))),
      ...b.map((p) => distance(p, Joinery.Geometry.projectPoint(p, ...a))),
    );
    if (separation >= gap) return false;
    if (
      sharedTarget &&
      a.some((p) => distance(p, sharedTarget) < 1e-6) &&
      b.some((p) => distance(p, sharedTarget) < 1e-6)
    )
      return false;
    return true;
  }
  function trianglesOverlap(a, b) {
    // Separating-axis test ignores contact at a shared target but rejects any
    // positive overlap of the filled arrowhead bodies.
    for (const triangle of [a, b])
      for (let i = 0; i < triangle.length; i++) {
        const edge = sub(triangle[(i + 1) % triangle.length], triangle[i]),
          axis = { x: -edge.y, y: edge.x };
        const pa = a.map((p) => Joinery.Geometry.dot(p, axis)),
          pb = b.map((p) => Joinery.Geometry.dot(p, axis));
        if (
          Math.min(Math.max(...pa), Math.max(...pb)) -
            Math.max(Math.min(...pa), Math.min(...pb)) <=
          1e-8
        )
          return false;
      }
    return true;
  }
  function crossesBox(edge, box) {
    const [a, b] = edge;
    if (
      !overlaps(
        {
          ...edgeBox(edge),
          minX: Math.min(a.x, b.x) - 1e-8,
          maxX: Math.max(a.x, b.x) + 1e-8,
          minY: Math.min(a.y, b.y) - 1e-8,
          maxY: Math.max(a.y, b.y) + 1e-8,
        },
        box,
      )
    )
      return false;
    const contains = (p) =>
      p.x >= box.minX && p.x <= box.maxX && p.y >= box.minY && p.y <= box.maxY;
    if (contains(a) || contains(b)) return true;
    const corners = [
      { x: box.minX, y: box.minY },
      { x: box.maxX, y: box.minY },
      { x: box.maxX, y: box.maxY },
      { x: box.minX, y: box.maxY },
    ];
    return corners.some((p, i) =>
      Joinery.Geometry.intersection(a, b, p, corners[(i + 1) % 4]),
    );
  }
  function itemEdges(items) {
    const edges = [];
    for (const p of items) {
      if (p.hatch || p.kind === "text") continue;
      const rings =
        p.kind === "region"
          ? p.polygons.flat()
          : p.kind === "path"
            ? [p.points]
            : [
                Joinery.Geometry.arcPoints({
                  center: p.center,
                  radius: p.radius,
                  start: p.kind === "circle" ? 0 : p.start,
                  end: p.kind === "circle" ? Math.PI * 2 - 1e-6 : p.end,
                }),
              ];
      for (const ring of rings) {
        for (let i = 1; i < ring.length; i++)
          edges.push([ring[i - 1], ring[i]]);
        if (p.closed || p.kind === "region" || p.kind === "circle")
          edges.push([ring.at(-1), ring[0]]);
      }
    }
    return edges;
  }
  function draftingScene(entities, units = "mm", options = {}) {
    const visible = entities;
    entities = entities.filter((e) =>
      Joinery.GeometryEngine.GeometryEngine.annotationVisible(e, visible),
    );
    const paperScale = options.paperScale || 1,
      step = paperScale * ((options.textHeight || 2.5) + 3),
      boxes = new LayoutIndex(paperScale * 16),
      geometry = new LayoutIndex(paperScale * 16),
      annotationLines = new LayoutIndex(paperScale * 16),
      leaderLines = new LayoutIndex(paperScale * 16),
      arrowBodies = new LayoutIndex(paperScale * 16),
      laneLines = new LayoutIndex(paperScale * 16);
    const textHoles = (options.textHoles || []).concat(
      entities
        .filter((e) => e.type === "text" && e.text)
        .map((e) => {
          const box = textBox(
            {
              p: e.points[0],
              text: e.text,
              size: e.size || 14,
              anchor: "start",
              orientation: e.orientation || "horizontal",
            },
            Math.max(4, (e.size || 14) * 0.28),
          );
          return [
            { x: box.minX, y: box.minY },
            { x: box.maxX, y: box.minY },
            { x: box.maxX, y: box.maxY },
            { x: box.minX, y: box.maxY },
          ];
        }),
    );
    for (const e of entities.filter((e) => e.symbolType)) {
      for (const label of Joinery.Markings.primitives(e, {
        paperScale,
        textHeight: options.textHeight || 2.5,
      }).filter((p) => p.kind === "text")) {
        const box = textBox(label, paperScale * 0.6);
        textHoles.push([
          { x: box.minX, y: box.minY },
          { x: box.maxX, y: box.minY },
          { x: box.maxX, y: box.maxY },
          { x: box.minX, y: box.maxY },
        ]);
      }
    }
    const sceneOptions = { ...options, textHoles };
    const records = entities.map((entity, index) => ({
      entity,
      index,
      items: primitives(entity, units, sceneOptions),
    }));
    const annotation = (e) =>
      ["dimension", "leader", "radius", "angle"].includes(e.type);
    const isLeader = (e) => ["leader", "radius"].includes(e.type);
    for (const record of records.filter((r) => isLeader(r.entity))) {
      record.target = record.items.find(
        (p) => p.kind === "path" && !p.closed,
      ).points[0];
    }
    for (const record of records.filter((r) => !annotation(r.entity))) {
      for (const edge of itemEdges(record.items))
        geometry.add({ edge, box: edgeBox(edge), entity: record.entity });
      for (const t of record.items.filter((p) => p.kind === "text"))
        boxes.add({ box: textBox(t, paperScale * 0.8) });
    }
    const ordered = records
      .filter((r) => annotation(r.entity))
      .sort((a, b) => {
        const span = (e) =>
          e.type === "dimension"
            ? Joinery.Geometry.distance(
                ...Joinery.Geometry.dimensionGeometry(e).points,
              )
            : Infinity;
        return (
          span(a.entity) - span(b.entity) ||
          (isLeader(a.entity) && isLeader(b.entity)
            ? b.target.y - a.target.y
            : 0) ||
          a.index - b.index
        );
      });
    for (const record of ordered) {
      const entity = record.entity,
        initialLabel = record.items.find((p) => p.annotation && !p.materialTag);
      if (!initialLabel) continue;
      const initialDimension =
        entity.type === "dimension"
          ? Joinery.Geometry.dimensionGeometry(entity, {
              paperScale,
              termination: options.termination,
            })
          : null;
      const direction =
        initialLabel.outward ||
        (entity.type === "radius"
          ? unit(sub(entity.points[0], entity.target || entity.center))
          : { x: 0, y: 1 });
      const routed = isLeader(entity);
      const initialLeader = routed
        ? record.items.find((p) => p.kind === "path" && !p.closed)
        : null;
      const side =
        routed && initialLeader.points[2].x < initialLeader.points[1].x
          ? -1
          : 1;
      const arrowLength = paperScale * 3;
      const targetGeometry = new Set(
        routed
          ? records
              .filter(
                (r) =>
                  !annotation(r.entity) &&
                  r.items.some((p) =>
                    p.kind === "region"
                      ? Joinery.Geometry.pointInRegion(
                          record.target,
                          p.polygons,
                        )
                      : p.kind === "circle"
                        ? distance(record.target, p.center) <= p.radius + 1e-6
                        : p.kind === "path" &&
                          p.closed &&
                          Joinery.Geometry.pointInPolygon(
                            record.target,
                            p.points,
                          ),
                  ),
              )
              .map((r) => r.entity)
          : [],
      );
      const short =
        initialDimension &&
        distance(...initialDimension.points) <
          textWidth(initialLabel) + paperScale * 4;
      let best = null;
      for (let lane = 0; lane < 48; lane++) {
        const variants = routed
          ? [0, 1, 2, 4].map((x) => ({ external: 0, x: side * x * step }))
          : (entity.type === "dimension" && (short || lane >= 8)
              ? [1, -1]
              : [0]
            ).map((external) => ({ external, x: 0 }));
        for (const { external, x } of variants) {
          const laneDistance = routed
            ? Math.ceil(lane / 2) * (lane % 2 ? 1 : -1) * step
            : lane * step;
          const displacement = add(mul(direction, laneDistance), { x, y: 0 });
          const movement = distance(displacement, { x: 0, y: 0 }) / step;
          let drawn = { ...entity };
          if (entity.type === "dimension")
            drawn = {
              ...drawn,
              externalLabel: external,
              points: [
                entity.points[0],
                entity.points[1],
                add(entity.points[2], displacement),
              ],
            };
          else if (routed)
            drawn = {
              ...drawn,
              type: "leader",
              text: initialLabel.text,
              layoutArrowLength: arrowLength,
              points: initialLeader.points.map((p, i) =>
                i === 0 ? p : add(p, displacement),
              ),
            };
          else if (entity.type === "angle")
            drawn.offset =
              (entity.offset ||
                Math.min(
                  distance(entity.points[0], entity.points[1]),
                  distance(entity.points[0], entity.points[2]),
                ) * 0.38) +
              lane * step;
          const items =
              lane === 0 && !external && !routed
                ? record.items
                : primitives(drawn, units, sceneOptions),
            label = items.find((p) => p.annotation && !p.materialTag);
          const box = textBox(label, paperScale * 0.7),
            edges = itemEdges(items);
          const heads = items.filter(
            (p) => p.kind === "path" && p.fill === "solid",
          );
          const routingCost = routed
            ? edges.reduce((cost, edge) => {
                const search = expanded(edgeBox(edge), paperScale * 0.25);
                return (
                  cost +
                  leaderLines
                    .query(search)
                    .filter((item) =>
                      pathsClash(
                        edge,
                        item.edge,
                        paperScale * 0.18,
                        record.target,
                      ),
                    ).length *
                    80 +
                  geometry
                    .query(search)
                    .filter(
                      (item) =>
                        !targetGeometry.has(item.entity) &&
                        pathsClash(
                          edge,
                          item.edge,
                          paperScale * 0.18,
                          record.target,
                        ),
                    ).length *
                    20
                );
              }, 0)
            : 0;
          const headCost = heads.reduce(
            (cost, head) =>
              cost +
              arrowBodies
                .query(
                  expanded(
                    edgeBox([head.points[0], head.points[0]]),
                    paperScale * 6,
                  ),
                )
                .filter((item) => trianglesOverlap(head.points, item.points))
                .length *
                250,
            0,
          );
          const primary = entity.type === "dimension" ? items[2].points : null;
          const laneCost = primary
            ? laneLines
                .query({
                  minX: Math.min(...primary.map((p) => p.x)) - step,
                  maxX: Math.max(...primary.map((p) => p.x)) + step,
                  minY: Math.min(...primary.map((p) => p.y)) - step,
                  maxY: Math.max(...primary.map((p) => p.y)) + step,
                })
                .filter((item) => {
                  const u = unit(sub(primary[1], primary[0])),
                    v = unit(sub(item.edge[1], item.edge[0]));
                  const coordinates = item.edge.map((p) =>
                    Joinery.Geometry.dot(sub(p, primary[0]), u),
                  );
                  return (
                    Math.abs(Joinery.Geometry.cross(u, v)) < 1e-5 &&
                    Math.abs(
                      Joinery.Geometry.cross(sub(item.edge[0], primary[0]), u),
                    ) <
                      step - 1e-6 &&
                    Math.min(distance(...primary), Math.max(...coordinates)) -
                      Math.max(0, Math.min(...coordinates)) >
                      paperScale * 0.2
                  );
                }).length * 65
            : 0;
          const score =
            laneCost +
            routingCost +
            headCost +
            boxes.query(box).length * 100 +
            geometry.query(box).filter((item) => crossesBox(item.edge, box))
              .length *
              30 +
            annotationLines
              .query(box)
              .filter((item) => crossesBox(item.edge, box)).length *
              35 +
            edges.reduce(
              (sum, edge) =>
                sum +
                boxes
                  .query({
                    ...edgeBox(edge),
                    minX: edgeBox(edge).minX - 1e-8,
                    maxX: edgeBox(edge).maxX + 1e-8,
                    minY: edgeBox(edge).minY - 1e-8,
                    maxY: edgeBox(edge).maxY + 1e-8,
                  })
                  .filter((item) => crossesBox(edge, item.box)).length *
                  25,
              0,
            );
          if (
            !best ||
            headCost < best.headCost ||
            (headCost === best.headCost &&
              (score < best.score ||
                (score === best.score && movement < best.movement)))
          )
            best = { items, box, edges, score, headCost, movement };
          if (score === 0) break;
        }
        if (
          best.score === 0 &&
          (!routed || Math.ceil(lane / 2) >= best.movement)
        )
          break;
      }
      record.items = best.items;
      if (entity.type === "dimension")
        laneLines.add({
          edge: best.items[2].points,
          box: edgeBox(best.items[2].points),
        });
      boxes.add({ box: best.box });
      for (const edge of best.edges)
        annotationLines.add({ edge, box: edgeBox(edge) });
      if (routed)
        for (const edge of best.edges)
          leaderLines.add({ edge, box: edgeBox(edge) });
      for (const head of best.items.filter(
        (p) => p.kind === "path" && p.fill === "solid",
      )) {
        const xs = head.points.map((p) => p.x),
          ys = head.points.map((p) => p.y);
        arrowBodies.add({
          points: head.points,
          box: {
            minX: Math.min(...xs),
            maxX: Math.max(...xs),
            minY: Math.min(...ys),
            maxY: Math.max(...ys),
          },
        });
      }
    }
    return records.map(({ entity, items }) => ({ entity, items }));
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
    textBox,
    draftingScene,
    sceneBounds,
    preferredScales,
  };
})((globalThis.Joinery = globalThis.Joinery || {}));
