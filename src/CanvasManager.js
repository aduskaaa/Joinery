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
      this.canvas.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        this.callbacks.cancel?.();
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
        if (this.dragStart && (e.buttons & 1)) {
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
        this.pointers.delete(e.pointerId);
        this.pinch = null;
        if (this.panning) this.callbacks.viewChanged?.();
        this.panning = null;
        this.canvas.style.cursor = this.space ? "grab" : "crosshair";
        if (e.button === 0 && this.hasDragged) {
          const pt = this.eventPoint(e);
          this.callbacks.dragEnd?.(this.toWorld(pt), e);
        }
        this.dragStart = null;
        this.hasDragged = false;
      };
      this.canvas.addEventListener("pointerup", end);
      this.canvas.addEventListener("pointercancel", end);
      this.canvas.addEventListener("pointerleave", () => {
        if (!this.panning) {
          this.cursor = null;
          this.snap = null;
          this.invalidate();
        }
      });
      window.addEventListener("blur", () => {
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
        layers = new Map(p.layers.map((l) => [l.id, l]));
      return p.entities.filter((e) => layers.get(e.layer)?.visible !== false);
    }
    pick(p, { locked = false } = {}) {
      const layers = new Map(this.getProject().layers.map((l) => [l.id, l])),
        entities = this.visibleEntities().filter(
          (e) => locked || !layers.get(e.layer)?.locked,
        ),
        tolerance = 8 / this.zoom;
      let nearest = null,
        d = Infinity;
      for (const e of entities) {
        let h = hitDistance(e, p);
        if (e.type === "dimension" && this.renderedScene?.has(e.id)) {
          h = Infinity;
          for (const primitive of this.renderedScene.get(e.id)) {
            if (
              primitive.kind === "text" &&
              Math.abs(p.x - primitive.p.x) <=
                Joinery.Scene.textWidth(primitive) / 2 &&
              p.y >= primitive.p.y - primitive.size * 0.22 &&
              p.y <= primitive.p.y + primitive.size
            )
              h = 0;
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
        if (h <= tolerance && h < d) {
          d = h;
          nearest = e;
        }
      }
      if (nearest) return nearest;
      return (
        [...entities]
          .reverse()
          .find((e) =>
            e.type === "region"
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
                pointInPolygon(p, vertices(e)),
          ) || null
      );
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
        spacing = adaptiveSpacing(this.zoom);
      this.callbacks.gridChanged?.(spacing);
      if (p.settings.grid) this.grid(spacing, c);
      const layers = new Map(p.layers.map((l) => [l.id, l]));
      const scene = draftingScene(this.visibleEntities(), p.settings.units, {
        paperScale: 96 / 25.4 / this.zoom,
        textHeight: p.settings.dimensionTextHeight || 2.5,
        termination: p.settings.dimensionTermination,
      });
      this.renderedScene = new Map(
        scene.map(({ entity, items }) => [entity.id, items]),
      );
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
      if (
        this.snap?.point &&
        this.snap.kind &&
        this.snap.kind !== "Grid" &&
        this.snap.kind !== "Ortho"
      ) {
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
      for (let pass = 0; pass < 2; pass++) {
        ctx.strokeStyle = pass ? c["grid-major"] : c.grid;
        ctx.beginPath();
        for (let x = Math.ceil(lo.x / step); x <= hi.x / step; x++) {
          if ((x % 5 === 0) !== !!pass) continue;
          const s = Math.round(this.toScreen({ x: x * step, y: 0 }).x) + 0.5;
          ctx.moveTo(s, 0);
          ctx.lineTo(s, this.height);
        }
        for (let y = Math.ceil(lo.y / step); y <= hi.y / step; y++) {
          if ((y % 5 === 0) !== !!pass) continue;
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
          paperScale: 96 / 25.4 / this.zoom,
          textHeight: this.getProject().settings.dimensionTextHeight || 2.5,
          termination: this.getProject().settings.dimensionTermination,
        }))
        this.drawPrimitive(primitive, stroke, c, preview, light);
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
      ctx.lineWidth = p.banding ? 3 : p.thin ? 0.8 : 1.3;
      ctx.setLineDash(preview ? [5, 4] : p.dash ? [5, 4] : []);
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
        if (p.orientation === "vertical") {
          ctx.translate(s.x, s.y);
          ctx.rotate(-Math.PI / 2);
          ctx.fillStyle = c.canvas;
          if (p.anchor === "start") {
            ctx.fillRect(-padX, -size - padY, width + padX * 2, size + padY * 2);
          } else {
            ctx.fillRect(-width / 2 - padX, -size - padY, width + padX * 2, size + padY * 2);
          }
          ctx.fillStyle = color;
          ctx.fillText(p.text, 0, 0);
        } else {
          ctx.fillStyle = c.canvas;
          if (p.anchor === "start") {
            ctx.fillRect(s.x - padX, s.y - size - padY, width + padX * 2, size + padY * 2);
          } else {
            ctx.fillRect(s.x - width / 2 - padX, s.y - size - padY, width + padX * 2, size + padY * 2);
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
      ctx.setLineDash([]);
    }
  }
  Joinery.CanvasManager = { CanvasManager };
})((globalThis.Joinery = globalThis.Joinery || {}));
