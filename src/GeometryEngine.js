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
    /** Join connected edges exactly; merge closed areas into one editable region. */
    static join(entities, tolerance = 0.1, { close = false } = {}) {
      if (!Number.isFinite(tolerance) || tolerance < 0 || tolerance > 10)
        throw new Error("Tolerance spojení musí být 0 až 10 mm.");
      if (!entities.length)
        throw new Error("Vyberte objekty, které chcete spojit.");
      const closedShapes = [],
        edges = [],
        nodes = [],
        buckets = new Map(),
        cell = Math.max(tolerance, 1e-8);
      // Spatial buckets keep endpoint matching bounded even for long imported paths.
      const nodeAt = (p) => {
        if (![p?.x, p?.y].every(Number.isFinite))
          throw new Error("Obrys obsahuje neplatný bod.");
        const x = Math.floor(p.x / cell),
          y = Math.floor(p.y / cell);
        let best = null,
          bestDistance = Infinity;
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (const n of buckets.get(`${x + dx}:${y + dy}`) || []) {
              const d = distance(n.point, p);
              if (d <= tolerance && d < bestDistance) {
                best = n;
                bestDistance = d;
              }
            }
        if (best) return best;
        const n = { point: { ...p }, edges: [] };
        nodes.push(n);
        const key = `${x}:${y}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(n);
        return n;
      };
      const addEdge = (a, b, bulge = 0) => {
        if (edges.length >= 20000)
          throw new Error("Spojujte nejvýše 20 000 hran najednou.");
        const first = nodeAt(a),
          last = nodeAt(b);
        if (first === last)
          throw new Error(
            "Hrana je kratší než tolerance. Snižte toleranci spojení.",
          );
        const edge = { first, last, bulge };
        edges.push(edge);
        first.edges.push(edge);
        last.edges.push(edge);
      };
      for (const e of entities) {
        if (
          e.symbolType ||
          !(
            ["line", "polyline", "arc"].includes(e.type) ||
            J.Boolean.isBooleanShape(e)
          )
        )
          throw new Error(
            "Spojit lze geometrické obrysy. Pro texty a kóty použijte Seskupit.",
          );
        if (J.Boolean.isBooleanShape(e)) {
          closedShapes.push(e);
        } else if (e.type === "arc") {
          const sweep = G.normalizeAngle(e.end - e.start) || G.TAU;
          if (sweep >= G.TAU - 1e-6) {
            closedShapes.push({ ...e, type: "circle" });
          } else {
            const at = (t) =>
              add(e.center, {
                x: e.radius * Math.cos(t),
                y: e.radius * Math.sin(t),
              });
            addEdge(at(e.start), at(e.end), Math.tan(sweep / 4));
          }
        } else {
          for (let i = 0; i < e.points.length - 1; i++)
            addEdge(e.points[i], e.points[i + 1], e.bulges?.[i] || 0);
        }
      }
      if (nodes.some((n) => n.edges.length > 2))
        throw new Error(
          "Obrys se větví. Vyberte pouze hrany jednoho navazujícího obrysu.",
        );
      const remaining = new Set(edges),
        paths = [];
      while (remaining.size) {
        const seed = remaining.values().next().value,
          component = new Set(),
          pending = [seed.first];
        while (pending.length) {
          const n = pending.pop();
          if (component.has(n)) continue;
          component.add(n);
          for (const e of n.edges)
            pending.push(e.first === n ? e.last : e.first);
        }
        const start =
          [...component].find((n) => n.edges.length === 1) || seed.first;
        let current = start;
        const points = [{ ...start.point }],
          bulges = [];
        while (true) {
          const edge = current.edges.find((e) => remaining.has(e));
          if (!edge) break;
          remaining.delete(edge);
          const forward = edge.first === current;
          current = forward ? edge.last : edge.first;
          bulges.push(forward ? edge.bulge : -edge.bulge);
          points.push({ ...current.point });
        }
        const closed = current === start;
        if (closed) points.pop();
        else bulges.push(0);
        paths.push({ type: "polyline", points, bulges, closed });
      }
      const open = paths.filter((p) => !p.closed);
      if (open.length > 1)
        throw new Error(
          "Hrany nenavazují. Spojte jejich konce nebo upravte toleranci.",
        );
      if (close && open.length) open[0].closed = true;
      if (
        paths.some((p) => !p.closed) &&
        (closedShapes.length || paths.length > 1)
      )
        throw new Error(
          "Pro spojení s uzavřenými tvary nejprve uzavřete otevřený obrys.",
        );
      const shapes = [...closedShapes, ...paths];
      // Validate before replacing sources; retain analytic bulges for a single path.
      for (const e of shapes.filter((e) => J.Boolean.isBooleanShape(e))) {
        try {
          J.Boolean.toPolygons(e);
        } catch {
          throw new Error(
            "Obrys nelze uzavřít. Zkontrolujte křížení hran, zdvojené hrany a nulové úsečky.",
          );
        }
      }
      let result;
      if (shapes.length === 1) result = structuredClone(shapes[0]);
      else
        result = {
          type: "region",
          polygons: J.Boolean.booleanPolygons("union", shapes),
        };
      result.id = J.Model.uid();
      result.layer = entities[0].layer;
      delete result.groupId;
      delete result.groupName;
      if (entities.length > 1 || paths.length) {
        result.cutListEnabled = false;
        for (const key of ["lineStyle", "lineWeight", "stroke"])
          if (entities[0][key] !== undefined) result[key] = entities[0][key];
        for (const key of ["materialKind", ...(J.Materials?.markingKeys || [])])
          if (
            entities[0][key] !== undefined &&
            entities.every((e) => e[key] === entities[0][key])
          )
            result[key] = entities[0][key];
      }
      return result;
    }
    static lineIntersections(a, b, entity) {
      return G.curveEdges(entity).flatMap((edge) =>
        G.edgeIntersections({ points: [a, b] }, edge, true),
      );
    }
    /** Remove the clicked interval, preserving exact circular arcs and bulges. */
    static trimEntity(entity, boundaries, point) {
      if (
        entity.symbolType ||
        !["line", "polyline", "arc", "circle"].includes(entity.type)
      )
        throw new Error(
          "Oříznout lze úsečku, lomenou čáru, oblouk nebo kružnici.",
        );
      const epsilon = 1e-6,
        edges = G.curveEdges(entity),
        cutters = boundaries
          .filter((e) => e !== entity && (!entity.id || e.id !== entity.id))
          .flatMap((e) => G.curveEdges(e));
      let total = 0;
      const path = edges.map((edge) => {
        const len = edge.center
            ? Math.abs(edge.sweep) * edge.radius
            : distance(...edge.points),
          offset = total;
        total += len;
        return { edge, len, offset };
      });
      if (total <= epsilon) throw new Error("Objekt nemá oříznutelnou délku.");
      const closed =
        entity.closed ||
        entity.type === "circle" ||
        (entity.type === "arc" && Math.abs(edges[0].sweep) >= G.TAU - G.EPS);
      const values = [],
        nearest = path
          .map((segment) => {
            const q = G.edgeClosest(segment.edge, point);
            return {
              d: distance(point, q),
              t:
                segment.offset +
                Math.max(0, Math.min(1, G.edgeParameter(segment.edge, q))) *
                  segment.len,
            };
          })
          .sort((a, b) => a.d - b.d)[0];
      for (const { edge, len, offset } of path)
        for (const boundary of cutters)
          for (const q of G.edgeIntersections(edge, boundary)) {
            let value =
              offset + Math.max(0, Math.min(1, G.edgeParameter(edge, q))) * len;
            if (closed && total - value < epsilon) value = 0;
            if (closed || (value > epsilon && value < total - epsilon))
              values.push(value);
          }
      values.sort((a, b) => a - b);
      const cuts = values.filter((v, i) => !i || v - values[i - 1] > epsilon);
      if (!cuts.length || (closed && cuts.length < 2))
        throw new Error(
          "Průsečík nebyl nalezen. Čára musí protínat ořezávací hranici.",
        );
      const at = closed && total - nearest.t < epsilon ? 0 : nearest.t;
      if (cuts.some((c) => Math.abs(c - at) < epsilon))
        throw new Error(
          "Klikněte dovnitř úseku, který chcete odstranit, mimo průsečík.",
        );
      const before = cuts.filter((c) => c < at),
        after = cuts.filter((c) => c > at);
      const lo = before.at(-1) ?? (closed ? cuts.at(-1) - total : 0),
        hi = after[0] ?? (closed ? cuts[0] + total : total);
      const ranges = closed
        ? [[hi, lo + total]]
        : [
            [0, lo],
            [hi, total],
          ].filter(([a, b]) => b - a > epsilon);
      const slice = (from, to, index) => {
        const result = structuredClone(entity);
        result.id = index === 0 ? entity.id || J.Model.uid() : J.Model.uid();
        result.closed = false;
        if (closed) result.cutListEnabled = false;
        if (["arc", "circle"].includes(entity.type)) {
          const edge = edges[0];
          result.type = "arc";
          result.start = edge.start + (from / total) * edge.sweep;
          result.end = edge.start + (to / total) * edge.sweep;
          return result;
        }
        const points = [],
          bulges = [],
          firstCycle = closed ? Math.floor(from / total) : 0,
          lastCycle = closed ? Math.floor(to / total) : 0;
        for (let cycle = firstCycle; cycle <= lastCycle; cycle++)
          for (const { edge, len, offset } of path) {
            const start = offset + cycle * total,
              a = Math.max(from, start),
              b = Math.min(to, start + len);
            if (b - a <= epsilon) continue;
            const t0 = (a - start) / len,
              t1 = (b - start) / len;
            if (!points.length) points.push(G.edgePoint(edge, t0));
            points.push(G.edgePoint(edge, t1));
            bulges.push(
              edge.center ? Math.tan((edge.sweep * (t1 - t0)) / 4) : 0,
            );
          }
        result.points = points;
        if (entity.type === "polyline") result.bulges = [...bulges, 0];
        return result;
      };
      return ranges.map(([from, to], i) => slice(from, to, i));
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
        if (e.symbolType) continue;
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
