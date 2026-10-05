/** CanvasManager: plain-script module. Loaded in dependency order by index.html. */
(function (Joinery) {
  "use strict";
  const {
    add,
    sub,
    mul,
    adaptiveSpacing,
    bounds,
    normalizeAngle,
    arcPoints,
    hitDistance,
    distance,
    projectPoint,
    pointInPolygon,
    pointInRegion,
    vertices,
  } = Joinery.Geometry;
  const { primitives, measure, draftingScene, fontSize, monochrome } =
    Joinery.Scene;
  // Below this zoom the drawing is an overview. Keeping every annotation at
  // constant screen size creates huge model-space labels and expensive routing.
  // Shrink annotations with geometry instead; export still uses its paper scale.
  const MIN_ANNOTATION_ZOOM = 0.125;
  class PickChoice extends Error {
    constructor(candidates, point) {
      super("Vyberte objekt");
      this.candidates = candidates;
      this.point = point;
    }
  }
  class CanvasManager {
    constructor(canvas, getProject, callbacks = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.getProject = getProject;
      this.callbacks = callbacks;
      this.zoom = 0.65;
      this.origin = { x: 120, y: 600 };
      this.width = 1;
      this.height = 1;
      this.selected = new Set();
      this.preview = [];
      this.snap = null;
      this.cursor = null;
      this.space = false;
      this.panning = null;
      this.dirty = true;
      this.pointers = new Map();
      this.pinch = null;
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
      this.resize();
      this.bind();
    }
    resize() {
      const rect = this.canvas.getBoundingClientRect(),
        oldW = this.width,
        oldH = this.height;
      if (rect.width <= 0 || rect.height <= 0) return;
      this.width = rect.width;
      this.height = rect.height;
      this.dpr = window.devicePixelRatio || 1;
      this.canvas.width = Math.round(this.width * this.dpr);
      this.canvas.height = Math.round(this.height * this.dpr);
      if (oldW > 1)
        this.origin = add(this.origin, {
          x: (this.width - oldW) / 2,
          y: (this.height - oldH) / 2,
        });
      this.invalidate();
    }
    toScreen(p) {
      return {
        x: this.origin.x + p.x * this.zoom,
        y: this.origin.y - p.y * this.zoom,
      };
    }
    toWorld(p) {
      return {
        x: (p.x - this.origin.x) / this.zoom,
        y: (this.origin.y - p.y) / this.zoom,
      };
    }
    eventPoint(e) {
      const r = this.canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }
    bind() {
      // Delete belongs to the drawing surface; editing a HUD or property field
      // must keep normal text-editing semantics (especially Backspace).
      window.addEventListener("keydown", (e) => {
        if (
          !["Delete", "Backspace"].includes(e.key) ||
          e.defaultPrevented ||
          e.target.closest?.(
            "input,textarea,select,[contenteditable],dialog",
          ) ||
          document.querySelector("dialog[open]") ||
          this.canvas.getClientRects().length === 0
        )
          return;
        if (this.callbacks.deleteSelection?.()) e.preventDefault();
      });
      this.canvas.addEventListener("contextmenu", (e) => {
        e.preventDefault();
      });
      this.canvas.addEventListener(
        "wheel",
        (e) => {
          e.preventDefault();
          this.zoomAt(
            this.eventPoint(e),
            Math.exp(-Math.max(-100, Math.min(100, e.deltaY)) * 0.0025),
          );
        },
        { passive: false },
      );
      this.canvas.addEventListener("pointerdown", (e) => {
        this.canvas.focus();
        const p = this.eventPoint(e);
        this.pointers.set(e.pointerId, p);
        this.canvas.setPointerCapture(e.pointerId);
        if (this.pointers.size === 2) {
          this.callbacks.cancelGesture?.();
          this.dragStart = null;
          const pts = [...this.pointers.values()];
          this.pinch = {
            distance: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y),
            zoom: this.zoom,
            world: this.toWorld(mul(add(pts[0], pts[1]), 0.5)),
          };
          this.panning = null;
          return;
        }
        if (e.button === 1 || this.space) {
          e.preventDefault();
          this.panning = { start: p, origin: { ...this.origin } };
          this.canvas.style.cursor = "grabbing";
          return;
        }
        if (e.button === 0) {
          this.dragStart = p;
          this.hasDragged = false;
          this.callbacks.click?.(this.toWorld(p), e);
        }
      });
      this.canvas.addEventListener("pointermove", (e) => {
        const p = this.eventPoint(e);
        if (this.pointers.has(e.pointerId)) this.pointers.set(e.pointerId, p);
        if (this.dragStart && e.buttons & 1) {
          if (Math.hypot(p.x - this.dragStart.x, p.y - this.dragStart.y) > 5) {
            this.hasDragged = true;
          }
        }
        if (this.pinch && this.pointers.size === 2) {
          const pts = [...this.pointers.values()],
            mid = mul(add(pts[0], pts[1]), 0.5);
          this.zoom = Math.max(
            0.01,
            Math.min(
              20,
              (this.pinch.zoom *
                Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y)) /
                this.pinch.distance,
            ),
          );
          this.origin = {
            x: mid.x - this.pinch.world.x * this.zoom,
            y: mid.y + this.pinch.world.y * this.zoom,
          };
          this.changed();
          return;
        }
        if (this.panning) {
          this.origin = add(this.panning.origin, sub(p, this.panning.start));
          this.changed();
          return;
        }
        this.cursor = this.toWorld(p);
        this.callbacks.move?.(this.cursor, e);
        this.invalidate();
      });
      const end = (e) => {
        const drawing = !!this.dragStart && !this.panning && !this.pinch;
        this.pointers.delete(e.pointerId);
        this.pinch = null;
        if (this.panning) this.callbacks.viewChanged?.();
        this.panning = null;
        this.canvas.style.cursor = this.space ? "grab" : "crosshair";
        if (
          drawing &&
          e.type !== "pointercancel" &&
          e.button === 0 &&
          this.hasDragged
        ) {
          const pt = this.eventPoint(e);
          this.callbacks.dragEnd?.(this.toWorld(pt), e);
        }
        if (drawing && (e.button === 0 || e.type === "pointercancel"))
          this.callbacks.end?.(this.toWorld(this.eventPoint(e)), e);
        this.dragStart = null;
        this.hasDragged = false;
      };
      this.canvas.addEventListener("pointerup", end);
      this.canvas.addEventListener("pointercancel", end);
      this.canvas.addEventListener("pointerleave", () => {
        if (!this.panning) {
          this.cursor = null;
          this.snap = null;
          this.eraseHover = [];
          this.invalidate();
        }
      });
      window.addEventListener("blur", () => {
        this.callbacks.cancelGesture?.();
        this.dragStart = null;
        this.hasDragged = false;
        this.pointers.clear();
        this.pinch = null;
        this.space = false;
        this.panning = null;
        this.canvas.style.cursor = "crosshair";
      });
    }
    zoomAt(p, factor) {
      const world = this.toWorld(p);
      this.zoom = Math.max(0.01, Math.min(20, this.zoom * factor));
      this.origin = {
        x: p.x - world.x * this.zoom,
        y: p.y + world.y * this.zoom,
      };
      this.changed();
    }
    changed() {
      this.invalidate();
      this.callbacks.viewChanged?.();
    }
    fit(entities = this.visibleEntities()) {
      const b = bounds(entities),
        w = Math.max(120, this.width - 135),
        h = Math.max(100, this.height - 170);
      this.zoom = Math.max(
        0.01,
        Math.min(8, w / Math.max(b.width, 50), h / Math.max(b.height, 50)),
      );
      this.origin = {
        x: this.width / 2 - ((b.min.x + b.max.x) / 2) * this.zoom,
        y: this.height / 2 + ((b.min.y + b.max.y) / 2) * this.zoom + 10,
      };
      this.changed();
    }
    view() {
      return { zoom: this.zoom, origin: { ...this.origin } };
    }
    restore(v) {
      if (v) {
        this.zoom = v.zoom;
        this.origin = { ...v.origin };
        this.changed();
      } else this.fit();
    }
    visibleEntities() {
      const p = this.getProject(),
        visibility = p.layers
          .map((l) => `${l.id}:${l.visible !== false}`)
          .join("|"),
        cached = this.visibleCache;
      if (
        cached?.project === p &&
        cached.entities === p.entities &&
        cached.count === p.entities.length &&
        cached.visibility === visibility
      )
        return cached.visible;
      const layers = new Map(p.layers.map((l) => [l.id, l]));
      const visible = p.entities.filter(
        (e) => layers.get(e.layer)?.visible !== false,
      );
      const result = visible.filter((e) =>
        Joinery.GeometryEngine.GeometryEngine.annotationVisible(e, visible),
      );
      this.visibleCache = {
        project: p,
        entities: p.entities,
        count: p.entities.length,
        visibility,
        visible: result,
      };
      return result;
    }
    invalidateScene() {
      this.visibleCache = null;
      this.sceneCache = null;
      this.renderedScene = null;
      this.invalidate();
    }
    annotationPaperScale() {
      return 96 / 25.4 / Math.max(MIN_ANNOTATION_ZOOM, this.zoom);
    }
    /** Cursor, selection, pan and theme changes reuse the expensive layout. */
    getScene() {
      const project = this.getProject(),
        settings = project.settings,
        visible = this.visibleEntities(),
        paperScale = this.annotationPaperScale(),
        key = `${paperScale}|${settings.units}|${settings.dimensionTextHeight || 2.5}|${settings.dimensionTermination || "slash"}`;
      if (this.sceneCache?.visible === visible && this.sceneCache.key === key)
        return this.sceneCache.scene;
      const scene = draftingScene(visible, settings.units, {
        paperScale,
        textHeight: settings.dimensionTextHeight || 2.5,
        termination: settings.dimensionTermination,
      });
      this.sceneCache = { visible, key, scene };
      this.renderedScene = new Map(
        scene.map(({ entity, items }) => [entity.id, items]),
      );
      return scene;
    }
    requestPick(candidates, p) {
      const override = this.pickOverride;
      if (override && !override.used && distance(p, override.point) < 1e-6) {
        override.used = true;
        return override.entity;
      }
      if (this.pickInteractive && candidates.length > 1)
        throw new PickChoice(candidates, p);
      return candidates[0] || null;
    }
    pick(p, options = {}) {
      return this.requestPick(this.pickCandidates(p, options), p);
    }
    pickCandidates(p, { locked = false } = {}) {
      this.getScene?.();
      const layers = new Map(this.getProject().layers.map((l) => [l.id, l])),
        entities = this.visibleEntities().filter(
          (e) => locked || !layers.get(e.layer)?.locked,
        ),
        tolerance = 8 / this.zoom;
      const hits = [];
      for (const e of entities) {
        let h = hitDistance(e, p);
        if (
          (["dimension", "leader", "radius"].includes(e.type) ||
            e.symbolType) &&
          this.renderedScene?.has(e.id)
        ) {
          h = Infinity;
          for (const primitive of this.renderedScene.get(e.id)) {
            if (primitive.kind === "text") {
              const box = Joinery.Scene.textBox(primitive);
              if (
                p.x >= box.minX &&
                p.x <= box.maxX &&
                p.y >= box.minY &&
                p.y <= box.maxY
              )
                h = 0;
            }
            if (primitive.kind === "path")
              for (let i = 1; i < primitive.points.length; i++)
                h = Math.min(
                  h,
                  distance(
                    p,
                    projectPoint(
                      p,
                      primitive.points[i - 1],
                      primitive.points[i],
                    ),
                  ),
                );
          }
        }
        if (e.type === "text") {
          const a = this.toScreen(e.points[0]),
            q = this.toScreen(p),
            font = Math.max(10, Math.min(18, (e.size || 14) * this.zoom));
          if (
            q.x >= a.x - 5 &&
            q.x <= a.x + e.text.length * font * 0.64 &&
            q.y >= a.y - font - 5 &&
            q.y <= a.y + 6
          )
            h = 0;
        }
        if (h <= tolerance) hits.push({ entity: e, d: h });
      }
      const found = new Set(hits.map((h) => h.entity));
      for (const e of [...entities].reverse()) {
        if (
          !found.has(e) &&
          (e.type === "detail"
            ? distance(p, e.points[0]) <= e.radius * e.factor
            : e.type === "region"
              ? pointInRegion(p, e.polygons)
              : [
                  "panel",
                  "rectangle",
                  "cutout",
                  "slot",
                  "polyline",
                  "circle",
                  "drill",
                ].includes(e.type) &&
                (e.type !== "polyline" || e.closed) &&
                pointInPolygon(p, vertices(e)))
        )
          hits.push({ entity: e, d: Infinity });
      }
      return hits.sort((a, b) => a.d - b.d).map((h) => h.entity);
    }
    /** Left-to-right contains; right-to-left crosses visible geometry. */
    pickBox(a, b) {
      this.getScene?.();
      const G = Joinery.Geometry,
        crossing = b.x < a.x,
        lo = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
        hi = { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
        inside = (q) =>
          q.x >= lo.x && q.x <= hi.x && q.y >= lo.y && q.y <= hi.y,
        corners = [lo, { x: hi.x, y: lo.y }, hi, { x: lo.x, y: hi.y }],
        edges = corners.map((q, i) => [q, corners[(i + 1) % 4]]);
      return this.visibleEntities().filter((e) => {
        if (this.getProject().layers.find((l) => l.id === e.layer)?.locked)
          return false;
        // Automatic centre marks are drawing aids, not extra geometry that
        // should prevent a window from containing a hole or a circle.
        if (["circle", "drill"].includes(e.type)) {
          const c = e.center,
            r = e.radius;
          if (!crossing)
            return (
              inside({ x: c.x - r, y: c.y - r }) &&
              inside({ x: c.x + r, y: c.y + r })
            );
          const near = {
            x: Math.max(lo.x, Math.min(hi.x, c.x)),
            y: Math.max(lo.y, Math.min(hi.y, c.y)),
          };
          return (
            distance(c, near) <= r &&
            Math.max(...corners.map((q) => distance(c, q))) >= r
          );
        }
        const items =
          this.renderedScene?.get(e.id) ||
          primitives(e, this.getProject().settings.units, {
            paperScale: this.annotationPaperScale(),
          });
        let allInside = true,
          touches = false;
        for (const item of items) {
          if (item.kind === "circle") {
            const c = item.center,
              r = item.radius;
            allInside &&=
              inside({ x: c.x - r, y: c.y - r }) &&
              inside({ x: c.x + r, y: c.y + r });
            const near = {
              x: Math.max(lo.x, Math.min(hi.x, c.x)),
              y: Math.max(lo.y, Math.min(hi.y, c.y)),
            };
            touches ||=
              distance(c, near) <= r &&
              Math.max(...corners.map((q) => distance(c, q))) >= r;
            continue;
          }
          let paths;
          if (item.kind === "text") {
            const box = Joinery.Scene.textBox(item);
            paths = [
              [
                { x: box.minX, y: box.minY },
                { x: box.maxX, y: box.minY },
                { x: box.maxX, y: box.maxY },
                { x: box.minX, y: box.maxY },
              ],
            ];
          } else if (item.kind === "region") paths = item.polygons.flat();
          else
            paths = [item.kind === "arc" ? arcPoints(item) : item.points || []];
          for (const pts of paths) {
            allInside &&= pts.every(inside);
            touches ||= pts.some(inside);
            const closed =
              item.closed || item.kind === "text" || item.kind === "region";
            for (let i = 1; i < pts.length + (closed ? 1 : 0); i++)
              touches ||= edges.some(([c, d]) =>
                G.intersection(pts[i - 1], pts[i % pts.length], c, d),
              );
          }
        }
        return items.length > 0 && (crossing ? touches : allInside);
      });
    }
    invalidate() {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = null;
        this.render();
      });
    }
    colors() {
      const s = getComputedStyle(document.documentElement);
      return Object.fromEntries(
        [
          "canvas",
          "grid",
          "grid-major",
          "text",
          "muted",
          "accent",
          "border",
        ].map((k) => [k, s.getPropertyValue(`--${k}`).trim()]),
      );
    }
    render() {
      const ctx = this.ctx,
        c = this.colors();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      ctx.clearRect(0, 0, this.width, this.height);
      ctx.fillStyle = c.canvas;
      ctx.fillRect(0, 0, this.width, this.height);
      const p = this.getProject(),
        spacing = adaptiveSpacing(this.zoom, 36, p.settings.gridSize);
      this.callbacks.gridChanged?.(spacing);
      if (p.settings.grid) this.grid(spacing, c);
      const layers = new Map(p.layers.map((l) => [l.id, l]));
      const scene = this.getScene();
      for (const { entity: e, items } of scene) {
        ctx.globalAlpha = this.booleanOperands?.has(e.id) ? 0.22 : 1;
        this.drawEntity(
          e,
          layers.get(e.layer)?.color || c.accent,
          this.selected.has(e.id) && !this.booleanOperands,
          c,
          false,
          items,
        );
      }
      ctx.globalAlpha = 0.65;
      for (const e of this.preview)
        this.drawEntity(e, c.accent, false, c, true);
      ctx.globalAlpha = 1;
      if (this.eraseHover?.length) {
        ctx.save();
        for (const id of this.eraseHover)
          for (const primitive of this.renderedScene.get(id) || [])
            this.drawPrimitive(
              primitive,
              "#ff3333",
              c,
              false,
              document.documentElement.dataset.theme === "light",
            );
        ctx.restore();
      }
      if (this.pickHover) {
        const entity = this.pickHover;
        const items = this.sceneCache.scene.find(
          (record) => record.entity === entity,
        )?.items;
        this.drawEntity(entity, c.accent, true, c, false, items);
      }
      if (this.selectionBox) {
        const box = this.selectionBox,
          a = this.toScreen(box.a),
          b = this.toScreen(box.b);
        ctx.save();
        ctx.strokeStyle = box.erase ? "#ff3333" : c.accent;
        ctx.fillStyle = box.erase
          ? "rgba(255,51,51,.08)"
          : "rgba(127,127,127,.12)";
        ctx.lineWidth = 1;
        ctx.setLineDash(box.b.x < box.a.x ? [5, 3] : []);
        ctx.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
        ctx.restore();
      }
      if (this.toolVector) {
        const a = this.toScreen(this.toolVector.a),
          b = this.toScreen(this.toolVector.b);
        ctx.save();
        ctx.strokeStyle = c.accent;
        ctx.lineWidth = 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const q of [a, b]) {
          ctx.beginPath();
          ctx.arc(q.x, q.y, 3, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }
      if (this.snap?.point && this.snap.kind && this.snap.kind !== "Ortho") {
        const q = this.toScreen(this.snap.point);
        ctx.strokeStyle = c.accent;
        ctx.lineWidth = 1;
        ctx.fillStyle = c.canvas;
        ctx.fillRect(q.x - 4, q.y - 4, 8, 8);
        if (this.snap.kind === "Center") {
          ctx.beginPath();
          ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
          ctx.stroke();
        } else if (this.snap.kind === "Midpoint") {
          ctx.beginPath();
          ctx.moveTo(q.x, q.y - 5);
          ctx.lineTo(q.x + 5, q.y + 4);
          ctx.lineTo(q.x - 5, q.y + 4);
          ctx.closePath();
          ctx.stroke();
        } else ctx.strokeRect(q.x - 4, q.y - 4, 8, 8);
        ctx.font = "10px Inter, sans-serif";
        ctx.fillStyle = c.accent;
        ctx.fillText(
          {
            Endpoint: "Koncový bod",
            Grid: "Mřížka",
            Midpoint: "Střed úsečky",
            Center: "Střed",
            Intersection: "Průsečík",
            Perpendicular: "Kolmice",
            Parallel: "Rovnoběžka",
            Length: "Délka",
          }[this.snap.kind] || this.snap.kind,
          q.x + 12,
          q.y - 10,
        );
      }
      if (this.diagnostics) {
        ctx.save();
        ctx.strokeStyle = "#ff3333";
        ctx.fillStyle = "#ff3333";
        ctx.lineWidth = 1.5;
        for (const marker of this.diagnostics) {
          const q = this.toScreen(marker.point);
          ctx.beginPath();
          ctx.arc(q.x, q.y, 5, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillRect(q.x - 1, q.y - 1, 2, 2);
        }
        ctx.restore();
      }
      if (this.cursor && !this.space && !this.panning) {
        const q = this.toScreen(this.snap?.point || this.cursor);
        ctx.strokeStyle = c.muted;
        ctx.globalAlpha = 0.45;
        ctx.lineWidth = 0.7;
        ctx.beginPath();
        ctx.moveTo(q.x - 12, q.y);
        ctx.lineTo(q.x - 4, q.y);
        ctx.moveTo(q.x + 4, q.y);
        ctx.lineTo(q.x + 12, q.y);
        ctx.moveTo(q.x, q.y - 12);
        ctx.lineTo(q.x, q.y - 4);
        ctx.moveTo(q.x, q.y + 4);
        ctx.lineTo(q.x, q.y + 12);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    grid(step, c) {
      const ctx = this.ctx,
        lo = this.toWorld({ x: 0, y: this.height }),
        hi = this.toWorld({ x: this.width, y: 0 });
      ctx.lineWidth = 1;
      const majorEvery = Math.round(
        10 ** (Math.floor(Math.log10(step)) + 1) / step,
      );
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? c["grid-major"] : c.grid;
        ctx.lineWidth = pass ? 1.25 : 0.7;
        ctx.beginPath();
        for (let x = Math.ceil(lo.x / step); x <= hi.x / step; x++) {
          if ((x % majorEvery === 0) !== !!pass) continue;
          const s = Math.round(this.toScreen({ x: x * step, y: 0 }).x) + 0.5;
          ctx.moveTo(s, 0);
          ctx.lineTo(s, this.height);
        }
        for (let y = Math.ceil(lo.y / step); y <= hi.y / step; y++) {
          if ((y % majorEvery === 0) !== !!pass) continue;
          const s = Math.round(this.toScreen({ x: 0, y: y * step }).y) + 0.5;
          ctx.moveTo(0, s);
          ctx.lineTo(this.width, s);
        }
        ctx.stroke();
      }
      const o = this.toScreen({ x: 0, y: 0 });
      ctx.strokeStyle = c.muted;
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.moveTo(o.x - 5, o.y);
      ctx.lineTo(o.x + 5, o.y);
      ctx.moveTo(o.x, o.y - 5);
      ctx.lineTo(o.x, o.y + 5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    drawEntity(e, color, selected, c, preview = false, items = null) {
      const ctx = this.ctx,
        light = document.documentElement.dataset.theme === "light",
        stroke = selected
          ? c.accent
          : monochrome(color.startsWith("#") ? color : "#cccccc", light);
      for (const primitive of items ||
        primitives(e, this.getProject().settings.units, {
          paperScale: this.annotationPaperScale(),
          textHeight: this.getProject().settings.dimensionTextHeight || 2.5,
          termination: this.getProject().settings.dimensionTermination,
        }))
        this.drawPrimitive(
          primitive,
          selected ? stroke : primitive.stroke || stroke,
          c,
          preview,
          light,
        );
      if (selected) {
        ctx.fillStyle = c.canvas;
        ctx.strokeStyle = c.accent;
        ctx.lineWidth = 1;
        const handles =
          e.type === "region"
            ? e.stockPoints || e.polygons.map((polygon) => polygon[0][0])
            : e.points || [e.center];
        for (const p of handles) {
          if (!p) continue;
          const s = this.toScreen(p);
          ctx.fillRect(s.x - 3, s.y - 3, 6, 6);
          ctx.strokeRect(s.x - 3, s.y - 3, 6, 6);
        }
      }
    }
    drawPrimitive(p, color, c, preview, light) {
      const ctx = this.ctx;
      ctx.strokeStyle = color;
      ctx.globalAlpha = p.opacity ?? 1;
      ctx.lineWidth = p.banding
        ? 3
        : p.lineWeight
          ? (p.lineWeight * 96) / 25.4
          : p.thin
            ? 0.8
            : 1.3;
      ctx.setLineDash(
        preview
          ? [5, 4]
          : p.lineStyle === "dashdot"
            ? [10, 4, 2, 4]
            : p.lineStyle === "dashed" || p.dash
              ? [5, 4]
              : [],
      );
      if (p.kind === "text") {
        const s = this.toScreen(p.p),
          size = p.annotation
            ? fontSize(p) * this.zoom
            : Math.max(10, Math.min(18, p.size * this.zoom));
        ctx.save();
        ctx.font = `${p.size > 16 ? "500" : "400"} ${size}px Arial, sans-serif`;
        ctx.textAlign = p.anchor || "center";
        ctx.textBaseline = "bottom";
        const width = ctx.measureText(p.text).width,
          padX = 4,
          padY = 2;
        if (p.rotation != null || p.orientation === "vertical") {
          ctx.translate(s.x, s.y);
          ctx.rotate(-(p.rotation ?? Math.PI / 2));
          ctx.fillStyle = c.canvas;
          if (p.anchor === "start") {
            ctx.fillRect(
              -padX,
              -size - padY,
              width + padX * 2,
              size + padY * 2,
            );
          } else {
            ctx.fillRect(
              -(p.anchor === "end" ? width : width / 2) - padX,
              -size - padY,
              width + padX * 2,
              size + padY * 2,
            );
          }
          ctx.fillStyle = color;
          ctx.fillText(p.text, 0, 0);
        } else {
          ctx.fillStyle = c.canvas;
          if (p.anchor === "start") {
            ctx.fillRect(
              s.x - padX,
              s.y - size - padY,
              width + padX * 2,
              size + padY * 2,
            );
          } else {
            ctx.fillRect(
              s.x - (p.anchor === "end" ? width : width / 2) - padX,
              s.y - size - padY,
              width + padX * 2,
              size + padY * 2,
            );
          }
          ctx.fillStyle = color;
          ctx.fillText(p.text, s.x, s.y);
        }
        ctx.restore();
        ctx.setLineDash([]);
        return;
      }
      ctx.beginPath();
      if (p.kind === "region") {
        for (const polygon of p.polygons)
          for (const ring of polygon) {
            ring.forEach((q, i) => {
              const s = this.toScreen(q);
              i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y);
            });
            ctx.closePath();
          }
      }
      if (p.kind === "path") {
        p.points.forEach((q, i) => {
          const s = this.toScreen(q);
          i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y);
        });
        if (p.closed) ctx.closePath();
      }
      if (p.kind === "circle") {
        const s = this.toScreen(p.center);
        ctx.arc(s.x, s.y, p.radius * this.zoom, 0, Math.PI * 2);
      }
      if (p.kind === "arc") {
        const s = this.toScreen(p.center),
          sweep = normalizeAngle(p.end - p.start) || Math.PI * 2;
        ctx.arc(
          s.x,
          s.y,
          p.radius * this.zoom,
          -p.start,
          -(p.start + sweep),
          true,
        );
      }
      if (p.fill) {
        ctx.save();
        ctx.globalAlpha *=
          p.fill === "solid"
            ? 1
            : p.fill === "panel"
              ? light
                ? 0.045
                : 0.05
              : 0.13;
        ctx.fillStyle = color;
        ctx.fill(p.kind === "region" ? "evenodd" : "nonzero");
        ctx.restore();
      }
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.setLineDash([]);
    }
  }
  Joinery.CanvasManager = { CanvasManager, MIN_ANNOTATION_ZOOM, PickChoice };
})((globalThis.Joinery = globalThis.Joinery || {}));
