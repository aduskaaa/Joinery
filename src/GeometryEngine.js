/** CAD modifiers operate on model coordinates; screen pixels never enter the math. */
(function (J) {
  "use strict";
  const G = J.Geometry,
    {
      add,
      sub,
      mul,
      unit,
      dot,
      cross,
      distance,
      angle,
      midpoint,
      intersection,
      projectPoint,
    } = G;
  class GeometryEngine {
    static bulgeArc(a, b, bulge) {
      const chord = distance(a, b);
      if (chord < 1e-9 || Math.abs(bulge) < 1e-9) return null;
      const center = add(
        midpoint(a, b),
        mul(
          G.perpendicular(unit(sub(b, a))),
          (chord * (1 - bulge * bulge)) / (4 * bulge),
        ),
      );
      return {
        center,
        radius: distance(center, a),
        start: angle(center, a),
        sweep: 4 * Math.atan(bulge),
      };
    }
    static bulgePoints(a, b, bulge, tolerance = 0.01) {
      const arc = this.bulgeArc(a, b, bulge);
      if (!arc) return [a, b];
      const step =
          2 * Math.acos(Math.max(-1, Math.min(1, 1 - tolerance / arc.radius))),
        count = Math.max(
          2,
          Math.min(
            2048,
            Math.ceil(Math.abs(arc.sweep) / Math.max(step, 0.001)),
          ),
        );
      return Array.from({ length: count + 1 }, (_, i) =>
        i === 0
          ? a
          : i === count
            ? b
            : add(arc.center, {
                x: Math.cos(arc.start + (arc.sweep * i) / count) * arc.radius,
                y: Math.sin(arc.start + (arc.sweep * i) / count) * arc.radius,
              }),
      );
    }
    static corner(
      previous,
      vertex,
      next,
      { radius = 10, a = 10, b = 10, mode = "fillet" } = {},
    ) {
      const u = unit(sub(previous, vertex)),
        v = unit(sub(next, vertex)),
        theta = Math.acos(Math.max(-1, Math.min(1, dot(u, v))));
      if (theta < 1e-5 || Math.PI - theta < 1e-5)
        throw new Error("Roh musí tvořit dvě nerovnoběžné hrany.");
      const da = mode === "fillet" ? radius / Math.tan(theta / 2) : a,
        db = mode === "fillet" ? da : b;
      if (
        ![da, db].every((n) => Number.isFinite(n) && n > 0) ||
        da >= distance(previous, vertex) - 1e-7 ||
        db >= distance(next, vertex) - 1e-7
      )
        throw new Error("Zaoblení nebo sražení se nevejde do sousedních hran.");
      const first = add(vertex, mul(u, da)),
        second = add(vertex, mul(v, db));
      if (mode !== "fillet") return { first, second, bulge: 0 };
      const center = add(
          vertex,
          mul(unit(add(u, v)), radius / Math.sin(theta / 2)),
        ),
        sign = cross(mul(u, -1), v) > 0 ? 1 : -1;
      return {
        first,
        second,
        center,
        radius,
        bulge: sign * Math.tan((Math.PI - theta) / 4),
        start: angle(center, sign > 0 ? first : second),
        end: angle(center, sign > 0 ? second : first),
      };
    }
    static modifyCorner(entity, index, options) {
      const e = structuredClone(entity),
        n = e.points?.length;
      if (
        !n ||
        n < 3 ||
        (!e.closed &&
          !["panel", "rectangle"].includes(e.type) &&
          (index === 0 || index === n - 1))
      )
        throw new Error(
          "Vyberte vnitřní vrchol lomené čáry nebo roh uzavřeného obrysu.",
        );
      const prev = (index + n - 1) % n,
        next = (index + 1) % n;
      if (e.bulges?.[prev] || e.bulges?.[index])
        throw new Error(
          "Tento roh už sousedí s obloukem. Nejprve jej rozložte.",
        );
      const c = this.corner(
          e.points[prev],
          e.points[index],
          e.points[next],
          options,
        ),
        oldBulges = e.bulges || Array(n).fill(0);
      if (J.Model.isPart(e) && !e.stockPoints)
        e.stockPoints = structuredClone(e.points);
      if (["panel", "rectangle"].includes(e.type)) {
        e.type = "polyline";
        e.closed = true;
      }
      e.points.splice(index, 1, c.first, c.second);
      e.bulges = [
        ...oldBulges.slice(0, index),
        c.bulge,
        oldBulges[index] || 0,
        ...oldBulges.slice(index + 1),
      ];
      return e;
    }
    static modifyLines(first, second, options) {
      const vertex = intersection(
        ...first.points,
        ...second.points,
        true,
        true,
      );
      if (!vertex) throw new Error("Vybrané úsečky jsou rovnoběžné.");
      const far = (e) =>
          distance(e.points[0], vertex) > distance(e.points[1], vertex) ? 0 : 1,
        ia = far(first),
        ib = far(second),
        c = this.corner(first.points[ia], vertex, second.points[ib], options);
      const a = structuredClone(first),
        b = structuredClone(second);
      a.points[1 - ia] = c.first;
      b.points[1 - ib] = c.second;
      const connector =
        options.mode === "fillet"
          ? {
              type: "arc",
              center: c.center,
              radius: c.radius,
              start: c.start,
              end: c.end,
            }
          : { type: "line", points: [c.first, c.second] };
      return {
        a,
        b,
        corner: c,
        vertex,
        previous: first.points[ia],
        next: second.points[ib],
        connector: {
          ...connector,
          layer: first.layer,
          stroke: first.stroke,
          lineWeight: first.lineWeight,
          lineStyle: first.lineStyle,
        },
      };
    }
    static meetLines(first, second) {
      const p = intersection(...first.points, ...second.points, true, true);
      if (!p) throw new Error("Vybrané úsečky jsou rovnoběžné.");
      return [first, second].map((e) => {
        const result = structuredClone(e),
          i = distance(p, e.points[0]) < distance(p, e.points[1]) ? 0 : 1;
        result.points[i] = p;
        return result;
      });
    }
    static splitLine(entity, point) {
      const p = projectPoint(point, ...entity.points),
        len = distance(...entity.points);
      if (
        distance(p, entity.points[0]) < 1e-6 ||
        distance(p, entity.points[1]) < 1e-6 ||
        !len
      )
        throw new Error("Bod rozdělení musí ležet uvnitř úsečky.");
      return [
        { ...structuredClone(entity), points: [entity.points[0], p] },
        {
          ...structuredClone(entity),
          id: J.Model.uid(),
          points: [p, entity.points[1]],
        },
      ];
    }
    static breakLine(entity, a, b) {
      const u = unit(sub(entity.points[1], entity.points[0])),
        t = (p) =>
          dot(sub(projectPoint(p, ...entity.points), entity.points[0]), u),
        lo = Math.min(t(a), t(b)),
        hi = Math.max(t(a), t(b)),
        len = distance(...entity.points);
      if (hi - lo < 1e-6) throw new Error("Určete dva různé body přerušení.");
      const rows = [];
      if (lo > 1e-6)
        rows.push({
          ...structuredClone(entity),
          points: [entity.points[0], add(entity.points[0], mul(u, lo))],
        });
      if (hi < len - 1e-6)
        rows.push({
          ...structuredClone(entity),
          id: rows.length ? J.Model.uid() : entity.id,
          points: [add(entity.points[0], mul(u, hi)), entity.points[1]],
        });
      return rows;
    }
    static join(entities, tolerance = 0.1) {
      if (
        !entities.length ||
        !entities.every(
          (e) => ["line", "polyline", "arc"].includes(e.type) && !e.closed,
        )
      )
        throw new Error("Vyberte otevřené úsečky, oblouky nebo lomené čáry.");
      const paths = entities.map((e) => {
        if (e.type !== "arc")
          return {
            points: structuredClone(e.points),
            bulges: [...(e.bulges || Array(e.points.length).fill(0))].slice(
              0,
              e.points.length - 1,
            ),
          };
        const sweep = G.normalizeAngle(e.end - e.start) || G.TAU;
        if (sweep >= G.TAU - 1e-6)
          throw new Error("Plný kruh nelze spojit jako otevřený oblouk.");
        return {
          points: [
            add(e.center, {
              x: e.radius * Math.cos(e.start),
              y: e.radius * Math.sin(e.start),
            }),
            add(e.center, {
              x: e.radius * Math.cos(e.end),
              y: e.radius * Math.sin(e.end),
            }),
          ],
          bulges: [Math.tan(sweep / 4)],
        };
      });
      const reverse = (p) => ({
        points: [...p.points].reverse(),
        bulges: [...p.bulges].reverse().map((b) => -b),
      });
      let current = paths.shift();
      while (paths.length) {
        let found = false;
        for (let i = 0; i < paths.length; i++) {
          let path = paths[i],
            prepend = false;
          if (distance(current.points.at(-1), path.points[0]) <= tolerance) {
          } else if (
            distance(current.points.at(-1), path.points.at(-1)) <= tolerance
          )
            path = reverse(path);
          else if (distance(current.points[0], path.points.at(-1)) <= tolerance)
            prepend = true;
          else if (distance(current.points[0], path.points[0]) <= tolerance) {
            path = reverse(path);
            prepend = true;
          } else continue;
          current = prepend
            ? {
                points: [...path.points.slice(0, -1), ...current.points],
                bulges: [...path.bulges, ...current.bulges],
              }
            : {
                points: [...current.points, ...path.points.slice(1)],
                bulges: [...current.bulges, ...path.bulges],
              };
          paths.splice(i, 1);
          found = true;
          break;
        }
        if (!found)
          throw new Error(
            "Výběr netvoří navazující řetězec. Zkontrolujte mezery nebo větvení.",
          );
      }
      const closed =
        distance(current.points[0], current.points.at(-1)) <= tolerance;
      if (closed) current.points.pop();
      else current.bulges.push(0);
      return {
        id: J.Model.uid(),
        type: "polyline",
        layer: entities[0].layer,
        points: current.points,
        bulges: current.bulges,
        closed,
        cutListEnabled: false,
        lineStyle: entities[0].lineStyle,
        lineWeight: entities[0].lineWeight,
        stroke: entities[0].stroke,
      };
    }
    static lineIntersections(a, b, entity) {
      if (["circle", "drill", "arc"].includes(entity.type)) {
        const delta = sub(b, a),
          f = sub(a, entity.center),
          aa = dot(delta, delta),
          bb = 2 * dot(f, delta),
          cc = dot(f, f) - entity.radius * entity.radius,
          disc = bb * bb - 4 * aa * cc;
        if (aa < 1e-12 || disc < 0) return [];
        return [
          (-bb - Math.sqrt(disc)) / (2 * aa),
          (-bb + Math.sqrt(disc)) / (2 * aa),
        ]
          .map((t) => add(a, mul(delta, t)))
          .filter((p) => entity.type !== "arc" || G.onArc(entity, p));
      }
      if (entity.bulges?.some(Boolean))
        return this.explode(entity).flatMap((e) =>
          this.lineIntersections(a, b, e),
        );
      return G.segments(entity)
        .map((s) => intersection(a, b, ...s, true, false))
        .filter(Boolean);
    }
    static explode(entity) {
      if (entity.type === "region")
        return G.segments(entity).map((points) => ({
          type: "line",
          points,
          layer: entity.layer,
        }));
      if (!entity.points || entity.points.length < 2)
        throw new Error("Tento objekt nelze rozložit.");
      const count =
        entity.closed || ["panel", "rectangle"].includes(entity.type)
          ? entity.points.length
          : entity.points.length - 1;
      return Array.from({ length: count }, (_, i) => {
        const a = entity.points[i],
          b = entity.points[(i + 1) % entity.points.length],
          arc = this.bulgeArc(a, b, entity.bulges?.[i] || 0);
        return {
          ...(arc
            ? {
                type: "arc",
                center: arc.center,
                radius: arc.radius,
                start: arc.sweep > 0 ? arc.start : arc.start + arc.sweep,
                end: arc.sweep > 0 ? arc.start + arc.sweep : arc.start,
              }
            : { type: "line", points: [a, b] }),
          layer: entity.layer,
          lineStyle: entity.lineStyle,
          lineWeight: entity.lineWeight,
          stroke: entity.stroke,
        };
      });
    }
    static gaps(targets, neighbors = targets, tolerance = 0.2) {
      const edges = neighbors
          .filter(
            (e) =>
              ![
                "dimension",
                "angle",
                "radius",
                "text",
                "leader",
                "detail",
              ].includes(e.type) && e.lineStyle !== "dashdot",
          )
          .flatMap((e) =>
            G.segments(e).map((segment) => ({ id: e.id, segment })),
          ),
        b = G.bounds(neighbors),
        cell = Math.max(1, b.width / 32, b.height / 32),
        buckets = new Map();
      for (const edge of edges) {
        const [a, c] = edge.segment;
        for (
          let x = Math.floor(Math.min(a.x, c.x) / cell);
          x <= Math.floor(Math.max(a.x, c.x) / cell);
          x++
        )
          for (
            let y = Math.floor(Math.min(a.y, c.y) / cell);
            y <= Math.floor(Math.max(a.y, c.y) / cell);
            y++
          ) {
            const k = `${x}:${y}`;
            if (!buckets.has(k)) buckets.set(k, []);
            buckets.get(k).push(edge);
          }
      }
      const curves = neighbors
        .flatMap((e) => (e.bulges?.some(Boolean) ? this.explode(e) : [e]))
        .filter((e) => ["arc", "circle", "drill"].includes(e.type));
      const markers = [];
      for (const e of targets) {
        if (
          !["line", "polyline", "arc"].includes(e.type) ||
          e.closed ||
          e.lineStyle === "dashdot"
        )
          continue;
        const pts = G.vertices(e);
        if (distance(pts[0], pts.at(-1)) <= 1e-6) continue;
        for (const p of [pts[0], pts.at(-1)]) {
          let best = Infinity;
          const seen = new Set(),
            cx = Math.floor(p.x / cell),
            cy = Math.floor(p.y / cell),
            reach = Math.max(1, Math.ceil(tolerance / cell));
          for (let x = cx - reach; x <= cx + reach; x++)
            for (let y = cy - reach; y <= cy + reach; y++)
              for (const other of buckets.get(`${x}:${y}`) || []) {
                if (other.id === e.id || seen.has(other)) continue;
                seen.add(other);
                best = Math.min(
                  best,
                  distance(p, projectPoint(p, ...other.segment)),
                );
              }
          for (const curve of curves) {
            const direction = unit(sub(p, curve.center)),
              q = add(curve.center, mul(direction, curve.radius));
            if (
              curve.id !== e.id &&
              (curve.type !== "arc" || G.onArc(curve, q))
            )
              best = Math.min(best, distance(p, q));
          }
          if (best > 1e-6)
            markers.push({
              point: p,
              id: e.id,
              kind: best <= tolerance ? "near-gap" : "open",
              distance: Number.isFinite(best) ? best : null,
            });
        }
      }
      return markers;
    }
    // A detail is a projected view; coordinates stay in model millimeters.
    static detailEntities(detail) {
      const fn = (p) =>
        add(detail.points[0], mul(sub(p, detail.center), detail.factor));
      return (detail.contents || []).map((child) => {
        const out = G.transformEntity(child, fn);
        if (out.radius != null) out.radius *= detail.factor;
        if (out.width != null) out.width *= detail.factor;
        out.detailId = detail.id;
        out.measurementFactor = detail.factor;
        return out;
      });
    }
    static annotationVisible(e, entities) {
      if (!e.detailId) return true;
      const d = entities.find(
        (d) => d.id === e.detailId && d.type === "detail",
      );
      if (!d) return false;
      const pts =
        e.type === "dimension"
          ? e.points.slice(0, 2)
          : e.type === "angle"
            ? e.points
            : e.type === "radius"
              ? [
                  e.target ||
                    add(
                      e.center,
                      mul(unit(sub(e.points[0], e.center)), e.radius),
                    ),
                ]
              : [e.points[0]];
      return pts.every(
        (p) => distance(p, d.points[0]) <= d.radius * d.factor + 1e-6,
      );
    }
    static detailAnnotations(detail, entities) {
      const fn = (p) =>
        add(detail.center, mul(sub(p, detail.points[0]), 1 / detail.factor));
      return entities
        .filter(
          (e) =>
            e.detailId === detail.id && this.annotationVisible(e, entities),
        )
        .map((e) => {
          const out = G.transformEntity(e, fn);
          delete out.detailId;
          out.measurementFactor = 1;
          if (out.radius != null) out.radius /= detail.factor;
          return out;
        });
    }
    static detailAt(entities, p) {
      return [...entities]
        .reverse()
        .find(
          (e) =>
            e.type === "detail" &&
            distance(p, e.points[0]) <= e.radius * e.factor + 1e-7,
        );
    }
    static moveDetail(detail, delta, mode, project) {
      const old = structuredClone(detail);
      if (mode === "source" || mode === "whole") {
        detail.center = add(detail.center, delta);
        detail.contents = this.crop(
          project.entities.filter(
            (e) =>
              project.layers?.find((l) => l.id === e.layer)?.visible !== false,
          ),
          detail.center,
          detail.radius,
        );
      }
      if (mode === "view" || mode === "whole")
        detail.points[0] = add(detail.points[0], delta);
      this.relocateDetailDimensions(detail, old, project.entities);
      return detail;
    }
    static relocateDetailDimensions(detail, old, entities) {
      for (const e of entities.filter((e) => e.detailId === detail.id)) {
        const remap = (p) =>
          add(
            detail.points[0],
            mul(
              sub(
                add(old.center, mul(sub(p, old.points[0]), 1 / old.factor)),
                detail.center,
              ),
              detail.factor,
            ),
          );
        Object.assign(e, G.transformEntity(e, remap));
        if (e.radius != null) e.radius *= detail.factor / old.factor;
        e.measurementFactor = detail.factor;
      }
    }
    static cornerDimensions(c, vertex, previous, next, mode, scale = 1) {
      const outward = unit(sub(vertex, midpoint(c.first, c.second)));
      const clearance = scale * 10;
      if (mode === "fillet") {
        const radial = unit(sub(vertex, c.center));
        return [
          {
            type: "radius",
            center: c.center,
            radius: c.radius,
            target: add(c.center, mul(radial, c.radius)),
            points: [add(c.center, mul(radial, c.radius + clearance))],
            lineWeight: 0.18,
            cutListEnabled: false,
          },
        ];
      }
      const a = distance(vertex, c.first),
        b = distance(vertex, c.second);
      const right =
        Math.abs(dot(unit(sub(previous, vertex)), unit(sub(next, vertex)))) <
        1e-7;
      if (right && Math.abs(a - b) < 1e-7) {
        const elbow = add(midpoint(c.first, c.second), mul(outward, clearance));
        return [
          {
            type: "leader",
            points: [
              midpoint(c.first, c.second),
              elbow,
              add(elbow, { x: clearance * 2, y: 0 }),
            ],
            text: `${Number(a.toFixed(4))} × 45°`,
            lineWeight: 0.18,
            cutListEnabled: false,
          },
        ];
      }
      return [c.first, c.second].map((end) => ({
        type: "dimension",
        mode: "aligned",
        points: [
          vertex,
          end,
          add(midpoint(vertex, end), mul(outward, clearance)),
        ],
        lineWeight: 0.18,
        cutListEnabled: false,
      }));
    }
    static crop(entities, center, radius) {
      const out = [],
        circle = { type: "circle", center, radius };
      const emit = (e) =>
        out.push({ ...e, id: J.Model.uid(), cutListEnabled: false });
      const clipCurve = (e) => {
        if (["circle", "drill", "arc"].includes(e.type)) {
          const full = e.type !== "arc",
            sweep = full ? G.TAU : G.normalizeAngle(e.end - e.start);
          const start = full ? 0 : e.start;
          const hits = G.circleIntersections(e.center, e.radius, center, radius)
            .filter((p) => full || G.onArc(e, p))
            .map((p) => G.normalizeAngle(angle(e.center, p) - start));
          const cuts = [
            0,
            ...hits.filter((t) => t > 1e-8 && t < sweep - 1e-8),
            sweep,
          ].sort((a, b) => a - b);
          if (
            full &&
            cuts.length === 2 &&
            distance(e.center, center) + e.radius <= radius + 1e-7
          ) {
            emit(structuredClone(e));
            return;
          }
          for (let i = 1; i < cuts.length; i++) {
            const mid = start + (cuts[i - 1] + cuts[i]) / 2;
            if (
              distance(
                add(e.center, {
                  x: Math.cos(mid) * e.radius,
                  y: Math.sin(mid) * e.radius,
                }),
                center,
              ) <=
              radius + 1e-7
            )
              emit({
                ...e,
                type: "arc",
                start: start + cuts[i - 1],
                end: start + cuts[i],
              });
          }
        } else
          for (const [a, b] of G.segments(e)) {
            const hits = G.lineCircleIntersections(a, b, center, radius).filter(
              (p) => distance(p, projectPoint(p, a, b)) < 1e-6,
            );
            const points = [a, ...hits, b].sort(
              (p, q) => distance(a, p) - distance(a, q),
            );
            for (let i = 1; i < points.length; i++)
              if (
                distance(points[i - 1], points[i]) > 1e-7 &&
                distance(midpoint(points[i - 1], points[i]), center) <=
                  radius + 1e-7
              )
                emit({
                  type: "line",
                  points: [points[i - 1], points[i]],
                  layer: e.layer,
                  lineWeight: e.lineWeight,
                  lineStyle: e.lineStyle,
                });
          }
      };
      for (const e of entities) {
        if (
          e.type === "detail" ||
          ![
            "line",
            "polyline",
            "arc",
            "circle",
            "drill",
            "rectangle",
            "panel",
            "region",
            "slot",
            "cutout",
          ].includes(e.type)
        )
          continue;
        if (J.Boolean.isBooleanShape(e)) {
          const polygons = J.Boolean.booleanPolygons(
            "intersection",
            [e, circle],
            { tolerance: 0.01 },
          );
          if (polygons.length)
            emit({
              type: "region",
              polygons,
              closed: true,
              detailFill: true,
              layer: e.layer,
              materialKind: (e.part || e).materialKind || "",
              ...J.Materials.marking(e.part || e),
              lineWeight: e.lineWeight,
              lineStyle: e.lineStyle,
            });
        }
        if (e.bulges?.some(Boolean) || ["rectangle", "panel"].includes(e.type))
          this.explode(e).forEach(clipCurve);
        else clipCurve(e);
      }
      return out;
    }
  }
  J.GeometryEngine = { GeometryEngine };
})((globalThis.Joinery = globalThis.Joinery || {}));
