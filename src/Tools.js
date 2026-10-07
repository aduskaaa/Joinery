/** Tools: plain-script module. Loaded in dependency order by index.html. */
(function (Joinery) {
  "use strict";
  const {
    add,
    sub,
    mul,
    unit,
    distance,
    angle,
    snapPoint,
    circleThrough,
    transformEntity,
    projectPoint,
    intersection,
    segments,
    midpoint,
  } = Joinery.Geometry;
  const { panel, uid } = Joinery.Model;
  const { measure } = Joinery.Scene;
  const DRAW_TOOLS = [
    ["select", "Výběr", "V"],
    ["line", "Úsečka", "L"],
    ["polyline", "Lomená čára", "W"],
    ["rectangle", "Obdélník", "R"],
    ["circle", "Kružnice", "O"],
    ["arc", "Oblouk", "A"],
    ["slot", "Drážka", "S"],
    ["drill", "Otvor", "H"],
    ["dimension", "Kóta", "D"],
    ["angle", "Úhlová kóta", ""],
    ["text", "Text / popis", "T"],
  ];
  const EDIT_TOOLS = [
    ["move", "Přesunout", "M"],
    ["copy", "Kopírovat", "C"],
    ["boolean", "Booleovské operace", "B"],
    ["edit", "Úpravy a spoje", "E"],
    ["eraser", "Mazat", ""],
    ["measure", "Měření", "Q"],
  ];
  /** Transient interaction state lives here, never in the project or cut list. */
  class WorkflowTool {
    constructor(app, system) {
      this.app = app;
      this.system = system;
      this.interactive = true;
      this.points = [];
      this.options = {};
    }
    activate() {
      this.reset();
    }
    reset() {
      this.points = [];
      this.gesture = null;
      this.numeric = false;
      this.app.canvas.preview = [];
      this.app.canvas.selectionBox = null;
      this.app.canvas.eraseHover = [];
      this.app.canvas.toolVector = null;
      this.app.canvas.invalidate();
    }
    expanded(hits) {
      return [
        ...new Set(
          hits.flatMap((e) =>
            Joinery.Model.groupMembers(this.app.project, e.id).map((m) => m.id),
          ),
        ),
      ];
    }
    editableIds(ids) {
      const original = this.app.selection;
      this.app.selection = new Set(ids);
      const editable = this.app.editableSelection().map((e) => e.id);
      this.app.selection = original;
      return editable;
    }
  }
  class SelectionTool extends WorkflowTool {
    constructor(a, s) {
      super(a, s);
      this.noSnap = true;
    }
    click(p, e, raw = p) {
      this.gesture = {
        start: raw,
        hit: this.app.canvas.pick(raw),
        shift: e.shiftKey,
        individual: e.altKey,
      };
    }
    move(p, e, raw = p) {
      if (this.gesture && this.app.canvas.hasDragged)
        this.app.canvas.selectionBox = { a: this.gesture.start, b: raw };
    }
    pointerEnd(p, e, raw = p) {
      if (!this.gesture) return;
      const a = this.app,
        g = this.gesture;
      if (a.canvas.hasDragged) {
        const hits = a.canvas.pickBox(g.start, raw);
        const ids = g.individual ? hits.map((h) => h.id) : this.expanded(hits);
        a.selection = new Set([...(g.shift ? a.selection : []), ...ids]);
        a.canvas.selected = a.selection;
        a.renderProperties();
      } else a.select(a.canvas.pick(g.start)?.id, g.shift, g.individual);
      this.reset();
    }
  }
  class TransformTool extends WorkflowTool {
    constructor(a, s, mode = "move") {
      super(a, s);
      this.mode = mode;
      this.options = { dx: 0, dy: 0 };
      this.floating = true;
    }
    reset() {
      super.reset();
      this.numeric = false;
      this.copyModifier = false;
      this.options.dx = this.options.dy = 0;
    }
    fields() {
      return this.app.editableSelection().some((e) => e.type === "detail") &&
        this.mode === "move"
        ? [
            [
              "detailMove",
              "Přesun detailu",
              this.app.tools.options.detailMove || "view",
              "select",
              [
                ["view", "Pohled detailu"],
                ["source", "Oblast výřezu"],
                ["whole", "Pohled i oblast výřezu"],
              ],
            ],
          ]
        : [];
    }
    hudFields() {
      return [
        ["dx", "ΔX [mm]"],
        ["dy", "ΔY [mm]"],
      ];
    }
    hudReady() {
      return this.points.length === 1;
    }
    hud() {
      const { dx, dy } = this.options;
      return {
        title:
          this.mode === "copy" || this.copyModifier ? "Kopírovat" : "Přesunout",
        hint: this.points.length
          ? "Cílový bod · Tab: ΔX / ΔY · Enter: potvrdit · Ctrl: kopie"
          : "Vyberte objekty a určete základní bod.",
        d: Math.hypot(dx, dy),
        angle: (Math.atan2(dy, dx) * 180) / Math.PI,
      };
    }
    click(p, e, raw = p) {
      if (!this.app.editableSelection().length) {
        const hit = this.app.canvas.pick(raw);
        if (hit) this.app.select(hit.id, e.shiftKey, e.altKey);
        this.system.renderHUD();
        return;
      }
      if (!this.points.length) {
        this.points = [{ ...p }];
        this.move(p, e);
      } else {
        this.move(p, e);
        this.finish(e);
      }
    }
    move(p, e = {}) {
      this.copyModifier = !!(e.ctrlKey || e.metaKey);
      if (!this.points.length) return;
      if (!this.numeric) {
        const delta = sub(p, this.points[0]);
        if (this.app.project.settings.grid) {
          const step = this.app.project.settings.gridSize;
          delta.x = Math.round(delta.x / step) * step || 0;
          delta.y = Math.round(delta.y / step) * step || 0;
        }
        this.options.dx = delta.x;
        this.options.dy = delta.y;
      }
      const delta = { x: this.options.dx, y: this.options.dy };
      if (!Number.isFinite(delta.x) || !Number.isFinite(delta.y)) return;
      const selected = this.app.editableSelection(),
        movedDetails = new Set(
          selected.filter((e) => e.type === "detail").map((e) => e.id),
        ),
        temp =
          movedDetails.size && this.mode === "move" && !this.copyModifier
            ? structuredClone(this.app.project)
            : null,
        preview = [];
      for (const entity of selected) {
        if (entity.detailId && movedDetails.has(entity.detailId)) continue;
        if (
          entity.type === "detail" &&
          this.mode === "move" &&
          !this.copyModifier
        ) {
          const detail = temp.entities.find((e) => e.id === entity.id);
          Joinery.GeometryEngine.GeometryEngine.moveDetail(
            detail,
            delta,
            this.options.detailMove ||
              this.app.tools.options.detailMove ||
              "view",
            temp,
          );
          preview.push(
            detail,
            ...temp.entities.filter((e) => e.detailId === entity.id),
          );
        } else preview.push(transformEntity(entity, (q) => add(q, delta)));
      }
      this.app.canvas.preview = preview;
      this.app.canvas.toolVector = {
        a: this.points[0],
        b: add(this.points[0], delta),
      };
    }
    pointerEnd(p, e) {
      if (this.points.length && this.app.canvas.hasDragged) {
        this.move(p, e);
        this.finish(e);
      }
    }
    finish(e = {}) {
      if (!this.points.length || this.system.validFloating?.() === false)
        return;
      const delta = { x: this.options.dx, y: this.options.dy },
        copy = this.mode === "copy" || !!(e.ctrlKey || e.metaKey),
        a = this.app,
        selected = a.editableSelection();
      if (
        ![delta.x, delta.y].every(
          (n) => Number.isFinite(n) && Math.abs(n) <= 1e7,
        ) ||
        !selected.length
      )
        return;
      if (!copy && Math.hypot(delta.x, delta.y) < 1e-9) {
        this.reset();
        return;
      }
      a.commit(() => {
        if (copy) {
          const idMap = new Map(selected.map((entity) => [entity.id, uid()]));
          const copies = selected.map((entity) => {
            const item = transformEntity(entity, (q) => add(q, delta));
            item.id = idMap.get(entity.id);
            if (idMap.has(item.detailId))
              item.detailId = idMap.get(item.detailId);
            return item;
          });
          a.project.entities.push(...Joinery.Model.regroupCopies(copies));
          a.selection = new Set(copies.map((item) => item.id));
        } else {
          const details = new Set(
            selected
              .filter((entity) => entity.type === "detail")
              .map((entity) => entity.id),
          );
          for (const entity of selected) {
            if (entity.detailId && details.has(entity.detailId)) continue;
            if (entity.type === "detail")
              Joinery.GeometryEngine.GeometryEngine.moveDetail(
                entity,
                delta,
                this.options.detailMove || a.tools.options.detailMove || "view",
                a.project,
              );
            else
              Object.assign(
                entity,
                transformEntity(entity, (q) => add(q, delta)),
              );
          }
        }
      });
      this.reset();
      this.system.renderHUD();
      a.canvas.canvas.focus();
    }
  }
  /** Rotation shares one pivot and one rigid transform across the whole selection. */
  class JoinTool extends WorkflowTool {
    constructor(app, system) {
      super(app, system);
      this.options = { tolerance: 0.1, close: false };
      this.footerKeys = this.noSnap = true;
      this.invalidMessage = "Zadejte platnou toleranci spojení v mm.";
    }
    reset() {
      super.reset();
      this.cache = this.result = null;
      this.message = "Vyberte obrysy · Shift + klik přidává do výběru";
    }
    activate() {
      super.activate();
      this.showPreview();
    }
    fields() {
      return [
        ["tolerance", "Tolerance [mm]", 0.1],
        ["close", "Uzavřít obrys", false, "checkbox"],
      ];
    }
    hint() {
      return this.message;
    }
    optionsChanged() {
      this.showPreview();
    }
    click(p, e = {}, raw = p) {
      const hit = this.app.canvas.pick(raw);
      this.app.select(hit?.id || null, e.shiftKey, e.altKey);
      this.showPreview();
    }
    move() {
      this.showPreview();
    }
    showPreview() {
      const a = this.app,
        key = JSON.stringify([[...a.selection], this.options]);
      if (
        this.cache?.project === a.project &&
        this.cache.entities === a.project.entities &&
        this.cache.key === key
      )
        return;
      this.cache = { project: a.project, entities: a.project.entities, key };
      this.result = null;
      a.canvas.preview = [];
      if (!a.selection.size) {
        this.message = "Vyberte obrysy · Shift + klik přidává do výběru";
        return;
      }
      try {
        const selected = a.editableSelection();
        if (selected.length !== a.selection.size)
          throw new Error("Vybrané objekty musí být viditelné a odemčené.");
        this.result = Joinery.GeometryEngine.GeometryEngine.join(
          selected,
          this.options.tolerance,
          this.options,
        );
        a.canvas.preview = [this.result];
        this.message = `${selected.length} objektů → ${this.result.closed || Joinery.Boolean.isBooleanShape(this.result) ? "uzavřený obrys" : "otevřený obrys"} · Použít / Enter`;
      } catch (error) {
        this.message = error.message;
      }
      a.canvas.invalidate();
    }
    apply() {
      this.showPreview();
      const a = this.app,
        result = this.result;
      if (!result) {
        a.toast(this.message);
        return;
      }
      const ids = new Set(a.editableSelection().map((e) => e.id));
      const committed = a.commit(() => {
        a.project.entities = a.project.entities.filter((e) => !ids.has(e.id));
        a.project.entities.push(result);
        a.selection = new Set([result.id]);
      });
      if (committed !== false) {
        this.reset();
        this.system.renderHUD();
      }
    }
    finish() {
      this.apply();
    }
  }
  class MirrorTool extends WorkflowTool {
    constructor(app, system) {
      super(app, system);
      this.options = { x1: 0, y1: 0, x2: 0, y2: 100, copy: true };
      this.footerKeys = this.liveFields = true;
      this.invalidMessage = "Zadejte dva různé platné body osy zrcadlení.";
    }
    reset() {
      super.reset();
      this.numeric = true;
    }
    activate() {
      super.activate();
      this.options.copy = true;
      this.initialAxis();
    }
    initialAxis() {
      const selected = this.app.editableSelection();
      if (selected.length) {
        const b = Joinery.Geometry.bounds(selected),
          c = midpoint(b.min, b.max);
        Object.assign(this.options, {
          x1: c.x,
          y1: c.y,
          x2: c.x,
          y2: c.y + 100,
        });
      }
      this.showPreview();
    }
    fields() {
      return [
        ["x1", "Osa A X [mm]", 0],
        ["y1", "Y [mm]", 0],
        ["x2", "Osa B X [mm]", 0],
        ["y2", "Y [mm]", 100],
        ["copy", "Ponechat původní", true, "checkbox"],
      ];
    }
    axis() {
      return [
        { x: this.options.x1, y: this.options.y1 },
        { x: this.options.x2, y: this.options.y2 },
      ];
    }
    valid() {
      return (
        this.axis().every((p) =>
          [p.x, p.y].every((n) => Number.isFinite(n) && Math.abs(n) <= 1e8),
        ) && distance(...this.axis()) > 1e-8
      );
    }
    hint() {
      if (!this.app.editableSelection().length)
        return "Vyberte objekty nebo skupinu ke zrcadlení.";
      return this.points.length && !this.numeric
        ? "Zvolte druhý bod osy · Shift: vodorovná / svislá osa"
        : "Zvolte první a druhý bod osy · Nebo zadejte body dole a potvrďte Použít / Enter";
    }
    optionsChanged(key) {
      if (key !== "copy") {
        this.numeric = true;
        this.points = [];
      }
    }
    mirrored(entity) {
      const G = Joinery.Geometry,
        [a, b] = this.axis(),
        u = unit(sub(b, a));
      const vector = (v) => sub(mul(u, 2 * G.dot(v, u)), v);
      const out = G.transformEntity(entity, (p) => add(a, vector(sub(p, a))));
      const annotations = (original, copy) => {
        if (
          original.type === "dimension" &&
          (original.dimensionAxis ||
            ["horizontal", "vertical"].includes(original.mode))
        )
          copy.dimensionAxis = vector(
            original.dimensionAxis ||
              (original.mode === "vertical" ? { x: 0, y: 1 } : { x: 1, y: 0 }),
          );
        if (original.type === "angle")
          [copy.points[1], copy.points[2]] = [copy.points[2], copy.points[1]];
        if (original.type === "text") {
          const theta =
              original.rotation ??
              (original.orientation === "vertical" ? Math.PI / 2 : 0),
            direction = vector({ x: Math.cos(theta), y: Math.sin(theta) });
          let rotation = Math.atan2(direction.y, direction.x);
          // CAD labels stay readable instead of reversing the glyph shapes.
          if (rotation > Math.PI / 2) rotation -= Math.PI;
          if (rotation < -Math.PI / 2) rotation += Math.PI;
          copy.rotation = rotation;
        }
        original.contents?.forEach((child, i) =>
          annotations(child, copy.contents[i]),
        );
      };
      annotations(entity, out);
      return out;
    }
    showPreview() {
      const selected = this.app.editableSelection();
      this.app.canvas.preview =
        this.valid() && selected.length
          ? selected.map((e) => this.mirrored(e))
          : [];
      this.app.canvas.toolVector =
        this.valid() && selected.length
          ? { a: this.axis()[0], b: this.axis()[1] }
          : null;
      this.app.canvas.invalidate();
    }
    click(p, e = {}, raw = p) {
      if (!this.app.editableSelection().length) {
        const hit = this.app.canvas.pick(raw);
        if (hit) {
          this.app.select(hit.id, e.shiftKey, e.altKey);
          this.initialAxis();
          this.system.renderHUD();
        }
        return;
      }
      if (!this.points.length) {
        this.points = [{ ...p }];
        this.numeric = false;
        Object.assign(this.options, { x1: p.x, y1: p.y, x2: p.x, y2: p.y });
        this.showPreview();
        this.system?.renderHUD();
      } else {
        this.move(p);
        this.finish();
      }
    }
    move(p) {
      if (this.points.length && !this.numeric) {
        this.options.x2 = p.x;
        this.options.y2 = p.y;
      }
      this.showPreview();
    }
    apply() {
      this.finish();
    }
    finish() {
      const a = this.app;
      if (!this.valid()) {
        a.toast(this.invalidMessage);
        return;
      }
      const selected = a.editableSelection();
      if (!selected.length || selected.length !== a.selection.size) {
        a.toast("Vyberte viditelné a odemčené objekty nebo skupinu.");
        return;
      }
      const items = selected.map((e) => this.mirrored(e));
      if (this.options.copy) {
        for (const e of items) e.id = uid();
        Joinery.Model.regroupCopies(items);
      }
      const committed = a.commit(() => {
        if (this.options.copy) a.project.entities.push(...items);
        else
          for (let i = 0; i < selected.length; i++)
            Object.assign(selected[i], items[i]);
        a.selection = new Set(items.map((e) => e.id));
      });
      if (committed !== false) {
        this.reset();
        this.system.renderHUD();
        a.canvas.canvas.focus();
      }
    }
  }
  class RotateTool extends WorkflowTool {
    constructor(app, system) {
      super(app, system);
      this.options = { degrees: 90, cx: 0, cy: 0 };
      this.footerKeys = this.liveFields = true;
    }
    activate() {
      super.activate();
      this.centerSelection();
    }
    reset() {
      super.reset();
      this.numeric = true;
    }
    centerSelection() {
      const selected = this.app.editableSelection();
      this.numeric = true;
      if (selected.length) {
        const b = Joinery.Geometry.bounds(selected),
          c = midpoint(b.min, b.max);
        this.options.cx = c.x;
        this.options.cy = c.y;
      }
      this.showPreview();
    }
    fields() {
      return [
        ["degrees", "Úhel [°]", 90],
        ["cx", "Střed X [mm]", 0],
        ["cy", "Střed Y [mm]", 0],
      ];
    }
    hint() {
      if (!this.app.editableSelection().length)
        return "Vyberte dílec nebo skupinu objektů.";
      if (this.numeric)
        return "Úhel a střed → Použít / Enter · Nebo klikněte na nový střed otáčení";
      return this.points.length < 2
        ? "Zvolte výchozí směr od středu"
        : "Zvolte cílový směr · Shift: krok 15° · Enter: potvrdit";
    }
    optionsChanged(key) {
      this.numeric = true;
      if (key === "cx" || key === "cy") this.points = [];
    }
    pivot() {
      return { x: this.options.cx, y: this.options.cy };
    }
    valid() {
      return (
        [this.options.degrees, this.options.cx, this.options.cy].every(
          Number.isFinite,
        ) &&
        Math.abs(this.options.degrees) <= 1e9 &&
        Math.abs(this.options.cx) <= 1e8 &&
        Math.abs(this.options.cy) <= 1e8
      );
    }
    rotated(entity) {
      const G = Joinery.Geometry,
        radians = ((this.options.degrees % 360) * Math.PI) / 180,
        out = G.transformEntity(entity, (p) =>
          G.rotatePoint(p, this.pivot(), radians),
        );
      const annotations = (original, copy) => {
        if (
          original.type === "dimension" &&
          (original.dimensionAxis ||
            ["horizontal", "vertical"].includes(original.mode))
        ) {
          const axis =
            original.dimensionAxis ||
            (original.mode === "vertical" ? { x: 0, y: 1 } : { x: 1, y: 0 });
          copy.dimensionAxis = G.rotatePoint(axis, { x: 0, y: 0 }, radians);
        }
        if (original.type === "text")
          copy.rotation =
            (original.rotation ??
              (original.orientation === "vertical" ? Math.PI / 2 : 0)) +
            radians;
        original.contents?.forEach((child, i) =>
          annotations(child, copy.contents[i]),
        );
      };
      annotations(entity, out);
      return out;
    }
    showPreview() {
      this.app.canvas.preview = this.valid()
        ? this.app.editableSelection().map((e) => this.rotated(e))
        : [];
      this.app.canvas.invalidate();
    }
    click(p, e = {}, raw = p) {
      if (!this.app.editableSelection().length) {
        const hit = this.app.canvas.pick(raw);
        if (hit) {
          this.app.select(hit.id, e.shiftKey, e.altKey);
          this.centerSelection();
          this.system.renderHUD();
        }
        return;
      }
      if (!this.points.length) {
        this.options.cx = p.x;
        this.options.cy = p.y;
        this.options.degrees = 0;
        this.points = [{ ...p }];
        this.numeric = false;
        this.showPreview();
      } else if (this.numeric) this.finish();
      else if (this.points.length === 1) {
        if (distance(p, this.pivot()) < 1e-8) return;
        this.points.push({ ...p });
        this.move(p, e);
      } else if (distance(p, this.pivot()) >= 1e-8) {
        this.move(p, e);
        this.finish();
      }
    }
    move(p, e = {}) {
      if (
        !this.numeric &&
        this.points.length === 2 &&
        distance(p, this.pivot()) > 1e-8
      ) {
        const delta =
          angle(this.pivot(), p) - angle(this.pivot(), this.points[1]);
        let degrees =
          (Math.atan2(Math.sin(delta), Math.cos(delta)) * 180) / Math.PI;
        if (e.shiftKey) degrees = Math.round(degrees / 15) * 15;
        this.options.degrees = degrees;
      }
      this.showPreview();
      this.app.canvas.toolVector = this.points.length
        ? { a: this.pivot(), b: p }
        : null;
    }
    apply() {
      this.finish();
    }
    finish() {
      const a = this.app;
      if (!this.valid()) {
        a.toast("Zadejte platný úhel a souřadnice středu.");
        return;
      }
      const selected = a.editableSelection();
      if (!selected.length) {
        a.toast("Vyberte odemčený dílec nebo skupinu.");
        return;
      }
      if (!this.numeric && this.points.length < 2) {
        a.toast("Zvolte výchozí a cílový směr nebo zadejte úhel.");
        return;
      }
      if (Math.abs(this.options.degrees % 360) < 1e-9) {
        this.reset();
        return;
      }
      // Preview and commit use exactly the same geometry, including holes and stock.
      a.commit(() => {
        for (const e of selected) Object.assign(e, this.rotated(e));
      });
      this.reset();
      this.numeric = true;
      this.system.renderHUD();
      a.canvas.canvas.focus();
    }
  }
  class EraserTool extends WorkflowTool {
    constructor(a, s) {
      super(a, s);
      this.noSnap = true;
    }
    click(p, e, raw = p) {
      this.gesture = {
        start: raw,
        hit: this.app.canvas.pick(raw),
        individual: e.altKey,
      };
    }
    move(p, e, raw = p) {
      const c = this.app.canvas;
      const hits =
        this.gesture && c.hasDragged
          ? c.pickBox(this.gesture.start, raw)
          : [c.pick(raw)].filter(Boolean);
      c.eraseHover = this.editableIds(
        this.gesture?.individual ? hits.map((h) => h.id) : this.expanded(hits),
      );
      c.selectionBox =
        this.gesture && c.hasDragged
          ? { a: this.gesture.start, b: raw, erase: true }
          : null;
    }
    pointerEnd(p, e, raw = p) {
      if (!this.gesture) return;
      const g = this.gesture,
        c = this.app.canvas,
        hits = c.hasDragged
          ? c.pickBox(g.start, raw)
          : [c.pick(g.start)].filter(Boolean),
        ids = g.individual ? hits.map((h) => h.id) : this.expanded(hits);
      this.app.deleteSelection(ids);
      this.reset();
    }
  }
  class OffsetTool extends WorkflowTool {
    constructor(a, s) {
      super(a, s);
      this.options = { distance: 18 };
      this.floating = true;
      this.noSnap = true;
    }
    reset() {
      super.reset();
      this.target = null;
      this.result = null;
      this.problem = "";
    }
    hudFields() {
      return [["distance", "Vzdálenost [mm]"]];
    }
    hudReady() {
      return true;
    }
    hud() {
      return {
        title: "Ekvidistanta / paralela",
        hint:
          this.problem ||
          (this.target
            ? "Zvolte stranu náhledu a klikněte · Tab: vzdálenost"
            : "Najeďte na úsečku nebo lomenou čáru · Tab: vzdálenost"),
      };
    }
    activate() {
      super.activate();
      const selected = this.app
        .editableSelection()
        .filter((e) => this.supports(e));
      if (selected.length === 1) this.target = selected[0];
    }
    supports(e) {
      return (
        [
          "line",
          "polyline",
          "rectangle",
          "panel",
          "circle",
          "drill",
          "cutout",
        ].includes(e.type) &&
        !e.symbolType &&
        !e.bulges?.some(Boolean)
      );
    }
    move(p, e, raw = p) {
      const G = Joinery.Geometry,
        a = this.app;
      let hit = a.canvas.pick(raw);
      if (!hit && a.canvas.pickInteractive) {
        const nearby = a.canvas
          .visibleEntities()
          .filter(
            (entity) =>
              this.supports(entity) &&
              !a.project.layers.find((layer) => layer.id === entity.layer)
                ?.locked,
          )
          .map((entity) => ({ entity, d: G.hitDistance(entity, raw) }))
          .filter((candidate) => candidate.d <= 48 / a.canvas.zoom)
          .sort((a, b) => a.d - b.d)
          .map((candidate) => candidate.entity);
        hit = a.canvas.requestPick?.(nearby, raw) || nearby[0];
      }
      if (hit && !this.supports(hit) && a.canvas.pickOverride?.used) {
        this.target = this.result = null;
        this.problem = "Z tohoto objektu nelze vytvořit paralelu.";
        a.canvas.preview = [];
        return;
      }
      if (hit?.bulges?.some(Boolean)) {
        this.target = this.result = null;
        this.problem = "Paralela zakřivené lomené čáry není podporována.";
        a.canvas.preview = [];
        return;
      }
      if (
        hit &&
        this.supports(hit) &&
        (G.hitDistance(hit, raw) < 12 / a.canvas.zoom ||
          a.canvas.pickInteractive ||
          a.canvas.pickOverride?.used)
      )
        this.target = hit;
      if (!this.target) {
        this.target =
          a.canvas
            .visibleEntities()
            .filter(
              (entity) =>
                this.supports(entity) &&
                !a.project.layers.find((layer) => layer.id === entity.layer)
                  ?.locked,
            )
            .map((entity) => ({ entity, d: G.hitDistance(entity, raw) }))
            .sort((a, b) => a.d - b.d)
            .find((candidate) => candidate.d <= 48 / a.canvas.zoom)?.entity ||
          null;
      }
      if (this.target)
        this.target =
          a.canvas
            .visibleEntities()
            .find(
              (e) =>
                e.id === this.target.id &&
                !a.project.layers.find((l) => l.id === e.layer)?.locked,
            ) || null;
      this.problem = "";
      this.result = null;
      a.canvas.preview = [];
      if (!this.target) return;
      const n = Number(this.options.distance),
        t = this.target;
      if (!(n > 0 && n <= 1e7)) {
        this.problem = "Zadejte kladnou vzdálenost.";
        return;
      }
      let sign;
      if (t.center) sign = distance(raw, t.center) < t.radius ? -1 : 1;
      else if (t.closed || ["panel", "rectangle", "cutout"].includes(t.type))
        sign = G.pointInPolygon(raw, t.points) ? -1 : 1;
      else {
        const nearest = G.segments(t)
          .map(([a, b]) => ({
            a,
            b,
            d: distance(raw, G.projectPoint(raw, a, b)),
          }))
          .sort((a, b) => a.d - b.d)[0];
        if (!nearest) return;
        sign =
          G.cross(sub(nearest.b, nearest.a), sub(raw, nearest.a)) < 0 ? -1 : 1;
      }
      this.result = G.offsetEntity(t, n * sign);
      if (!this.result) {
        this.problem = "Paralela se při této vzdálenosti nedá vytvořit.";
        return;
      }
      this.result.cutListEnabled = false;
      delete this.result.groupId;
      delete this.result.groupName;
      a.canvas.preview = [this.result];
    }
    click(p, e, raw = p) {
      this.move(p, e, raw);
      if (!this.result || this.system.validFloating?.() === false) return;
      const item = structuredClone(this.result);
      item.id = uid();
      this.app.add([item]);
    }
    finish() {
      this.app.canvas.canvas.focus();
    }
  }
  class MeasureTool extends WorkflowTool {
    constructor(a, s) {
      super(a, s);
      this.floating = true;
    }
    reset() {
      super.reset();
      this.end = null;
      this.complete = false;
      this.factor = 1;
      this.detailId = null;
    }
    hud() {
      const delta =
        this.points.length && this.end
          ? mul(sub(this.end, this.points[0]), 1 / this.factor)
          : { x: 0, y: 0 };
      return {
        title: "Měření",
        hint: this.complete
          ? "Nové měření: klikněte · Escape: zavřít"
          : this.points.length
            ? "Určete druhý bod · Escape: zrušit"
            : "Určete první bod nebo klikněte na hranu.",
        dx: delta.x,
        dy: delta.y,
        d: Math.hypot(delta.x, delta.y),
        angle: (Math.atan2(delta.y, delta.x) * 180) / Math.PI,
      };
    }
    move(p) {
      if (this.points.length && !this.complete) this.end = p;
      this.app.canvas.toolVector =
        this.points.length && this.end
          ? { a: this.points[0], b: this.end }
          : null;
    }
    click(p, e, raw = p) {
      const G = Joinery.Geometry,
        GE = Joinery.GeometryEngine.GeometryEngine;
      if (this.complete) this.reset();
      const detail = GE.detailAt(this.app.canvas.visibleEntities(), raw),
        factor = detail?.factor || 1;
      if (!this.points.length) {
        const candidates = detail
          ? GE.detailEntities(detail)
          : this.app.canvas.visibleEntities();
        const edges = candidates
          .filter(
            (t) =>
              ["line", "polyline", "rectangle", "panel", "cutout"].includes(
                t.type,
              ) &&
              !t.symbolType &&
              !t.bulges?.some(Boolean),
          )
          .map((entity) => ({
            ...entity,
            measureEdge: G.segments(entity)
              .map(([a, b]) => ({
                a,
                b,
                d: distance(raw, G.projectPoint(raw, a, b)),
              }))
              .sort((a, b) => a.d - b.d)[0],
          }))
          .filter(
            (entity) =>
              entity.measureEdge &&
              entity.measureEdge.d <= 6 / this.app.canvas.zoom &&
              Math.min(
                distance(raw, entity.measureEdge.a),
                distance(raw, entity.measureEdge.b),
              ) >
                9 / this.app.canvas.zoom,
          )
          .sort((a, b) => a.measureEdge.d - b.measureEdge.d);
        const chosen = this.app.canvas.requestPick?.(edges, raw) || edges[0],
          edge = chosen?.measureEdge;
        this.factor = factor;
        this.detailId = detail?.id;
        if (
          edge &&
          edge.d <= 6 / this.app.canvas.zoom &&
          Math.min(distance(raw, edge.a), distance(raw, edge.b)) >
            9 / this.app.canvas.zoom
        ) {
          this.points = [edge.a];
          this.end = edge.b;
          this.complete = true;
        } else {
          this.points = [p];
          this.end = p;
        }
      } else {
        if ((detail?.id || null) !== (this.detailId || null)) {
          this.app.toast("Oba body měřte ve stejném pohledu.");
          return;
        }
        this.end = p;
        this.complete = true;
      }
      this.move(p);
    }
  }
  class Tools {
    constructor(app) {
      this.app = app;
      this.active = "select";
      this.points = [];
      this.pointer = { x: 0, y: 0 };
      this.lastEvent = {};
      this.options = {
        width: 420,
        height: 720,
        thickness: 18,
        material: "Neuvedeno",
        materialClass: "",
        materialKind: "",
        length: "",
        radius: "",
        diameter: 5,
        depth: 12,
        slotWidth: 20,
        text: "Popis dílce",
        textSize: 16,
        textOrientation: "horizontal",
        dimensionMode: "aligned",
        rectWidth: "",
        rectHeight: "",
      };
    }
    set(name) {
      if (name === "edit") {
        this.app.operations();
        return;
      }
      this.app.canvas.booleanOperands = null;
      this.active = name;
      if (name === "panel" && !this.options.materialKind)
        this.options.materialKind =
          this.app.project.settings.defaultMaterialKind || "";
      this.points = [];
      this.app.canvas.preview = [];
      this.app.canvas.snap = null;
      this.dimensionRefs = [];
      this.angleRefs = [];
      this.app.toolSystem?.activate(name);
      this.app.updateToolUI();
      this.preview();
    }
    cancel() {
      this.points = [];
      this.options.length = "";
      this.app.canvas.preview = [];
      this.app.canvas.snap = null;
      this.set("select");
    }
    snap(p, e = {}) {
      const visible = this.app.canvas.visibleEntities();
      const GE = Joinery.GeometryEngine.GeometryEngine;
      const detail = GE.detailAt(visible, p);
      const projected =
        detail &&
        ["dimension", "radius", "angle", "leader"].includes(this.active);
      if (this.snapCache?.visible !== visible) {
        const details = new Map(
          visible
            .filter((e) => e.type === "detail")
            .map((e) => [
              e.id,
              GE.detailEntities(e).filter((e) => !e.detailFill),
            ]),
        );
        this.snapCache = {
          visible,
          details,
          entities: visible
            .flatMap((e) => (e.type === "detail" ? details.get(e.id) : [e]))
            .filter((e) => !e.detailFill),
        };
      }
      const entities = projected
        ? this.snapCache.details.get(detail.id)
        : this.snapCache.entities;
      const s = this.app.project.settings,
        base = this.points.at(-1),
        moving = ["move", "copy"].includes(this.active),
        result = snapPoint(p, entities, {
          tolerance: 9 / this.app.canvas.zoom,
          grid: s.grid,
          gridSize: s.gridSize,
          gridOrigin: moving && base ? base : { x: 0, y: 0 },
          gridPriority: moving && !!base,
          object: s.object,
          base,
          ortho:
            (s.ortho || e.shiftKey) &&
            ["line", "polyline", "move", "copy", "slot", "mirror"].includes(
              this.active,
            ),
          modes: {
            ...s.snapModes,
            parallel:
              s.snapModes?.parallel !== false &&
              ["line", "polyline", "move", "copy", "slot"].includes(
                this.active,
              ),
          },
        });
      if (
        base &&
        ["line", "polyline"].includes(this.active) &&
        Number(this.options.length) > 0
      ) {
        result.point = add(
          base,
          mul(unit(sub(result.point, base)), Number(this.options.length)),
        );
        result.kind = "Length";
      }
      if (detail) {
        result.detailId = detail.id;
        result.measurementFactor = detail.factor;
      }
      return result;
    }
    move(p, e = {}) {
      if (this.app.toolSystem?.dispatch("move", p, e)) return;
      this.legacyMove(p, e);
    }
    legacyMove(p, e = {}) {
      this.pointer = p;
      this.lastEvent = e;
      if (this.active.startsWith("boolean-")) {
        this.app.canvas.snap = null;
        this.app.coordinates(p);
        this.app.canvas.invalidate();
        return;
      }
      const result =
        this.active === "select" ? { point: p, kind: "" } : this.snap(p, e);
      this.app.canvas.snap = result;
      this.app.coordinates(result.point);
      this.preview(result.point);
    }
    click(raw, e = {}) {
      if (this.app.toolSystem?.dispatch("click", raw, e)) return;
      this.legacyClick(raw, e);
    }
    legacyClick(raw, e = {}) {
      const a = this.app,
        canvas = a.canvas;
      if (this.active.startsWith("boolean-")) {
        const hit = canvas.pick(raw);
        if (!hit) return;
        if (!Joinery.Boolean.isBooleanShape(hit)) {
          a.toast("Booleovské operace vyžadují uzavřený obrys.");
          return;
        }
        a.select(hit.id, true);
        return;
      }
      if (this.active === "select") {
        const hit = canvas.pick(raw);
        a.select(hit?.id, e.shiftKey, e.altKey);
        return;
      }
      if (["trim", "extend"].includes(this.active)) {
        this.trimExtend(raw, this.active, raw);
        return;
      }
      if (["move", "copy"].includes(this.active) && !a.selection.size) {
        const hit = canvas.pick(raw);
        if (hit) {
          a.select(hit.id);
          a.toast("Objekt vybrán. Určete základní bod.");
        } else a.toast("Vyberte objekt k úpravě.");
        return;
      }
      const p = this.snap(raw, e).point,
        base = this.points[0],
        o = this.options;
      if (this.active === "panel") {
        if (!positive(o.width, o.height, o.thickness)) {
          a.toast("Rozměry dílce musí být větší než nula.");
          return;
        }
        const part = panel(
          p.x,
          p.y,
          +o.width,
          +o.height,
          +o.thickness,
          `Dílec ${a.panels().length + 1}`,
          o.material,
          a.activeLayer,
        );
        if (o.materialClass) part.materialClass = o.materialClass;
        if (o.materialKind) part.materialKind = o.materialKind;
        a.add([part]);
        return;
      }
      if (this.active === "drill") {
        if (!positive(o.diameter) || !nonnegative(o.depth)) {
          a.toast("Zadejte kladný průměr a platnou hloubku.");
          return;
        }
        a.add([
          {
            type: "drill",
            center: p,
            radius: +o.diameter / 2,
            depth: +o.depth,
            name: `Otvor Ø${o.diameter}`,
          },
        ]);
        return;
      }
      if (this.active === "text") {
        if (!o.text.trim() || !positive(o.textSize)) {
          a.toast("Zadejte text a kladnou velikost písma.");
          return;
        }
        a.add([
          {
            type: "text",
            points: [p],
            text: o.text,
            size: +o.textSize,
            orientation: o.textOrientation || "horizontal",
          },
        ]);
        return;
      }
      if (this.active === "radius") {
        if (!this.target) {
          const GE = Joinery.GeometryEngine.GeometryEngine;
          const detail = GE.detailAt(canvas.visibleEntities(), raw);
          const curves = (
            detail ? GE.detailEntities(detail) : canvas.visibleEntities()
          )
            .flatMap((entity) => {
              if (entity.bulges?.some(Boolean))
                return GE.explode(entity).map((child) => ({
                  ...child,
                  detailId: entity.detailId,
                  measurementFactor: entity.measurementFactor,
                }));
              return [entity];
            })
            .filter((entity) =>
              ["circle", "drill", "arc"].includes(entity.type),
            );
          const nearby = curves
            .map((entity) => ({
              entity,
              d: Joinery.Geometry.hitDistance(entity, raw),
            }))
            .sort((a, b) => a.d - b.d)
            .filter((item) => item.d < 12 / canvas.zoom)
            .map((item) => item.entity);
          const hit = canvas.requestPick?.(nearby, raw) || nearby[0];
          if (!hit) {
            a.toast("Vyberte kružnici, otvor nebo oblouk.");
            return;
          }
          this.target = hit;
          const radial = add(
            hit.center,
            mul(unit(sub(raw, hit.center)), hit.radius),
          );
          this.radiusTarget = Joinery.Geometry.onArc(hit, radial)
            ? radial
            : [
                Joinery.Geometry.arcPoints(hit)[0],
                Joinery.Geometry.arcPoints(hit).at(-1),
              ].sort((a, b) => distance(a, raw) - distance(b, raw))[0];
          this.points = [hit.center];
          a.updateToolUI();
          return;
        }
        a.add([
          {
            type: "radius",
            center: this.target.center,
            radius: this.target.radius,
            target: this.radiusTarget,
            detailId: this.target.detailId,
            measurementFactor: this.target.measurementFactor || 1,
            points: [p],
          },
        ]);
        this.points = [];
        this.target = null;
        return;
      }
      if (this.active === "line" || this.active === "polyline") {
        if (!base) {
          this.points.push(p);
          this.app.updateToolUI();
          return;
        }
        if (this.active === "polyline" && this.points.length >= 2) {
          const startPt = this.points[0];
          const dist = distance(p, startPt);
          const snapPt = this.snap(raw, e).point;
          const snapDist = snapPt ? distance(snapPt, startPt) : Infinity;
          const threshold = Math.max(14 / (this.app.canvas?.zoom || 1), 12);
          if (dist <= threshold || snapDist < 0.001) {
            this.finish(true);
            return;
          }
        }
        const prev = this.points.at(-1);
        if (distance(prev, p) < 0.001) return;
        if (this.active === "line") {
          a.add([{ type: "line", points: [prev, p] }]);
          this.points = [p];
        } else this.points.push(p);
        a.updateToolUI();
        this.preview();
        return;
      }
      if (
        ["rectangle", "circle", "slot", "move", "copy"].includes(this.active)
      ) {
        if (!base) {
          if (
            this.active === "rectangle" &&
            positive(o.rectWidth, o.rectHeight)
          ) {
            const w = +o.rectWidth,
              h = +o.rectHeight;
            const pts = [
              p,
              { x: p.x + w, y: p.y },
              { x: p.x + w, y: p.y + h },
              { x: p.x, y: p.y + h },
            ];
            a.add([
              {
                type: "rectangle",
                points: pts,
                closed: true,
                cutListEnabled: false,
              },
            ]);
            this.preview();
            return;
          }
          this.points = [p];
          a.updateToolUI();
          this.preview();
          return;
        }
        if (this.active === "rectangle") {
          const pts = rectanglePoints(base, p, o, e.shiftKey);
          if (
            distance(pts[0], pts[1]) < 0.001 ||
            distance(pts[1], pts[2]) < 0.001
          )
            return;
          a.add([
            {
              type: "rectangle",
              points: pts,
              closed: true,
              cutListEnabled: false,
            },
          ]);
          this.points = [];
          a.updateToolUI();
          this.preview();
          return;
        }
        if (distance(base, p) < 0.001) return;
        if (this.active === "circle")
          a.add([
            {
              type: "circle",
              center: base,
              radius: Number(o.radius) > 0 ? +o.radius : distance(base, p),
            },
          ]);
        if (this.active === "slot") {
          if (!positive(o.slotWidth)) {
            a.toast("Šířka drážky musí být kladná.");
            return;
          }
          a.add([
            {
              type: "slot",
              points: [base, p],
              width: +o.slotWidth,
              closed: true,
            },
          ]);
        }
        if (["move", "copy"].includes(this.active)) {
          const fn = (q) => add(q, sub(p, base));
          const copy = this.active === "copy";
          a.commit(() => {
            const selected = a.editableSelection();
            if (copy) {
              const newIds = [];
              const copied = [];
              selected.forEach((entity) => {
                const next = transformEntity(entity, fn);
                next.id = uid();
                if (next.name) next.name += " copy";
                copied.push(next);
                newIds.push(next.id);
              });
              a.project.entities.push(...Joinery.Model.regroupCopies(copied));
              a.selection = new Set(newIds);
            } else {
              const movedDetails = new Set(
                selected.filter((e) => e.type === "detail").map((e) => e.id),
              );
              selected.forEach((entity) => {
                if (entity.detailId && movedDetails.has(entity.detailId))
                  return;
                if (this.active === "move" && entity.type === "detail")
                  Joinery.GeometryEngine.GeometryEngine.moveDetail(
                    entity,
                    sub(p, base),
                    this.options.detailMove || "view",
                    a.project,
                  );
                else Object.assign(entity, transformEntity(entity, fn));
              });
            }
          });
        }
        this.points = [];
        a.updateToolUI();
        this.preview();
        return;
      }
      if (this.active === "arc") {
        this.points.push(p);
        if (this.points.length === 3) {
          const circle = circleThrough(...this.points);
          if (circle) a.add([{ type: "arc", ...circle }]);
          else a.toast("Body oblouku nesmí ležet v přímce.");
          this.points = [];
          a.updateToolUI();
        }
        this.preview();
        return;
      }
      if (this.active === "dimension") {
        const reference = this.snap(raw, e);
        if (this.points.length < 2) {
          if (
            this.points.length === 1 &&
            (this.dimensionRefs[0]?.detailId || "") !==
              (reference.detailId || "")
          ) {
            a.toast(
              "Oba body kóty vyberte ve stejném pohledu detailu nebo v hlavním výkresu.",
            );
            return;
          }
          this.dimensionRefs.push(reference);
        }
        this.points.push(p);
        if (this.points.length === 3) {
          if (distance(this.points[0], this.points[1]) > 0.001)
            a.add([
              {
                type: "dimension",
                points: [...this.points],
                mode: o.dimensionMode,
                detailId: this.dimensionRefs[0]?.detailId,
                measurementFactor:
                  this.dimensionRefs[0]?.measurementFactor || 1,
              },
            ]);
          this.points = [];
          this.dimensionRefs = [];
        }
        a.updateToolUI();
        this.preview();
        return;
      }
      if (this.active === "angle") {
        const reference = this.snap(raw, e);
        if (
          this.points.length &&
          (this.angleRefs[0]?.detailId || "") !== (reference.detailId || "")
        ) {
          a.toast("Body úhlové kóty vyberte ve stejném pohledu.");
          return;
        }
        this.angleRefs.push(reference);
        this.points.push(p);
        if (this.points.length === 3) {
          if (
            distance(this.points[0], this.points[1]) > 0.001 &&
            distance(this.points[0], this.points[2]) > 0.001
          )
            a.add([
              {
                type: "angle",
                points: [...this.points],
                detailId: this.angleRefs[0]?.detailId,
                measurementFactor: this.angleRefs[0]?.measurementFactor || 1,
              },
            ]);
          this.points = [];
          this.angleRefs = [];
        }
        a.updateToolUI();
        this.preview();
      }
    }
    finish(close = false) {
      if (this.app.toolSystem?.current?.interactive) {
        this.app.toolSystem.current.finish?.(this.lastEvent);
        return;
      }
      if (this.active.startsWith("boolean-")) {
        this.app.applyBoolean();
        return;
      }
      if (this.active === "polyline" && this.points.length > 1) {
        let pts = [...this.points];
        if (pts.length > 2 && distance(pts[0], pts[pts.length - 1]) < 0.001) {
          pts.pop();
          close = true;
        }
        this.app.add([
          {
            type: "polyline",
            points: pts,
            closed: close,
            ...(close
              ? {
                  thickness: 18,
                  quantity: 1,
                  banding: [0, 0, 0, 0],
                  cutListEnabled: false,
                }
              : {}),
          },
        ]);
        this.points = [];
        this.app.updateToolUI();
        this.preview();
      } else if (
        this.points.length &&
        ["line", "circle", "rectangle", "slot"].includes(this.active)
      )
        this.click(this.pointer, this.lastEvent);
    }
    dragEnd(p, e = {}) {
      if (
        this.points.length === 1 &&
        ["rectangle", "line", "circle", "slot"].includes(this.active)
      ) {
        this.click(p, e);
      }
    }
    preview(p = this.snap(this.pointer, this.lastEvent).point) {
      if (this.app.toolSystem?.current?.interactive) {
        this.app.toolSystem.dispatch("move", this.pointer, this.lastEvent);
        return;
      }
      if (this.active.startsWith("boolean-")) return;
      const o = this.options,
        base = this.points[0],
        preview = [],
        common = { layer: this.app.activeLayer },
        addPreview = (e) => preview.push({ ...common, ...e });
      if (this.active === "panel" && positive(o.width, o.height, o.thickness))
        addPreview(
          panel(
            p.x,
            p.y,
            +o.width,
            +o.height,
            +o.thickness,
            "",
            o.material,
            this.app.activeLayer,
          ),
        );
      if (
        this.active === "rectangle" &&
        positive(o.rectWidth, o.rectHeight) &&
        !base
      ) {
        const w = +o.rectWidth,
          h = +o.rectHeight;
        addPreview({
          type: "rectangle",
          points: [
            p,
            { x: p.x + w, y: p.y },
            { x: p.x + w, y: p.y + h },
            { x: p.x, y: p.y + h },
          ],
          closed: true,
        });
        addPreview({
          type: "text",
          points: [{ x: p.x + w / 2, y: p.y + h / 2 }],
          text: `${measure(w, this.app.project.settings.units)} × ${measure(h, this.app.project.settings.units)} ${this.app.project.settings.units}`,
          size: 14,
        });
      }
      if (this.active === "drill" && positive(o.diameter))
        addPreview({ type: "drill", center: p, radius: +o.diameter / 2 });
      if (this.active === "text" && positive(o.textSize))
        addPreview({
          type: "text",
          points: [p],
          text: o.text,
          size: +o.textSize,
          orientation: o.textOrientation || "horizontal",
        });
      if (base) {
        if (["line", "polyline"].includes(this.active)) {
          addPreview({ type: "polyline", points: [...this.points, p] });
          const b = this.points.at(-1);
          addPreview({
            type: "text",
            points: [
              add(midpoint(b, p), { x: 0, y: 15 / this.app.canvas.zoom }),
            ],
            text: `${measure(distance(b, p), this.app.project.settings.units)} ${this.app.project.settings.units}`,
            size: 14,
          });
        }
        if (this.active === "rectangle") {
          const pts = rectanglePoints(base, p, o, this.lastEvent?.shiftKey);
          addPreview({
            type: "rectangle",
            points: pts,
            closed: true,
          });
          const rw = Math.abs(pts[1].x - pts[0].x);
          const rh = Math.abs(pts[2].y - pts[1].y);
          if (rw > 0.01 && rh > 0.01) {
            addPreview({
              type: "text",
              points: [
                {
                  x: (pts[0].x + pts[2].x) / 2,
                  y: (pts[0].y + pts[2].y) / 2,
                },
              ],
              text: `${measure(rw, this.app.project.settings.units)} × ${measure(rh, this.app.project.settings.units)} ${this.app.project.settings.units}`,
              size: 14,
            });
          }
        }
        if (this.active === "circle")
          addPreview({
            type: "circle",
            center: base,
            radius: +o.radius > 0 ? +o.radius : distance(base, p),
          });
        if (this.active === "slot" && positive(o.slotWidth))
          addPreview({ type: "slot", points: [base, p], width: +o.slotWidth });
        if (this.active === "arc") {
          if (this.points.length === 2) {
            const arc = circleThrough(base, this.points[1], p);
            if (arc) addPreview({ type: "arc", ...arc });
          } else addPreview({ type: "line", points: [base, p] });
        }
        if (this.active === "dimension") {
          if (this.points.length === 2)
            addPreview({
              type: "dimension",
              points: [...this.points, p],
              mode: o.dimensionMode,
              detailId: this.dimensionRefs?.[0]?.detailId,
              measurementFactor:
                this.dimensionRefs?.[0]?.measurementFactor || 1,
            });
          else addPreview({ type: "line", points: [base, p] });
        }
        if (this.active === "angle") {
          if (this.points.length === 2)
            addPreview({
              type: "angle",
              points: [...this.points, p],
              detailId: this.angleRefs?.[0]?.detailId,
              measurementFactor: this.angleRefs?.[0]?.measurementFactor || 1,
            });
          else addPreview({ type: "line", points: [base, p] });
        }
        if (this.active === "radius" && this.target)
          addPreview({
            type: "radius",
            center: this.target.center,
            radius: this.target.radius,
            target: this.radiusTarget,
            detailId: this.target.detailId,
            measurementFactor: this.target.measurementFactor || 1,
            points: [p],
          });
        if (["move", "copy"].includes(this.active)) {
          const fn = (q) => add(q, sub(p, base));
          for (const entity of this.app.editableSelection()) {
            if (this.active === "move" && entity.type === "detail") {
              const temp = structuredClone(this.app.project),
                d = temp.entities.find((e) => e.id === entity.id);
              Joinery.GeometryEngine.GeometryEngine.moveDetail(
                d,
                sub(p, base),
                o.detailMove || "view",
                temp,
              );
              preview.push(
                d,
                ...temp.entities.filter((e) => e.detailId === d.id),
              );
            } else preview.push(transformEntity(entity, fn));
          }
          addPreview({ type: "line", points: [base, p] });
        }
      }
      this.app.canvas.preview = preview;
      this.app.canvas.invalidate();
    }
    trimExtend(p, mode, raw = p) {
      const a = this.app,
        e = a.canvas.pick(raw);
      if (!e) return;
      const blocked = Joinery.Model.groupMembers(a.project, e.id).some(
        (member) => {
          const layer = a.project.layers.find((l) => l.id === member.layer);
          return layer?.locked || layer?.visible === false;
        },
      );
      if (blocked) {
        a.toast("Objekt nebo jeho skupina je v zamčené či skryté vrstvě.");
        return;
      }
      if (mode === "trim") {
        try {
          const result = Joinery.GeometryEngine.GeometryEngine.trimEntity(
            e,
            a.canvas.visibleEntities(),
            raw,
          );
          const committed = a.commit(() => {
            const index = a.project.entities.findIndex(
              (source) => source.id === e.id,
            );
            a.project.entities.splice(index, 1, ...result);
            a.selection = new Set(result.map((item) => item.id));
          });
          if (committed !== false) {
            a.canvas.selected = a.selection;
            a.renderProperties();
          }
        } catch (error) {
          a.toast(error.message);
        }
        return;
      }
      if (e.type !== "line") {
        a.toast("Klikněte na úsečku poblíž prodlužovaného konce.");
        return;
      }
      const [start, end] = e.points,
        index = distance(p, start) < distance(p, end) ? 0 : 1,
        origin = e.points[1 - index],
        target = e.points[index],
        d = sub(target, origin),
        len = distance(origin, target),
        u = unit(d);
      const intersections = a.canvas
        .visibleEntities()
        .filter((other) => other.id !== e.id)
        .flatMap((other) =>
          Joinery.GeometryEngine.GeometryEngine.lineIntersections(
            origin,
            target,
            other,
          ),
        );
      const hits = intersections
        .map((q) => ({ q, t: (q.x - origin.x) * u.x + (q.y - origin.y) * u.y }))
        .filter((h) =>
          mode === "trim"
            ? h.t > 0.001 && h.t < len - 0.001
            : h.t > len + 0.001,
        );
      hits.sort((x, y) => (mode === "trim" ? y.t - x.t : x.t - y.t));
      if (!hits.length) {
        a.toast("Průsečík nebyl nalezen. Přidejte ořezávací hranici.");
        return;
      }
      a.commit(() => {
        e.points[index] = hits[0].q;
      });
      a.select(e.id);
    }
    hint() {
      const n = this.points.length;
      return (
        {
          select: "Kliknutím vyberte · Shift přidá další objekt",
          line: n
            ? "Vyberte konec nebo zadejte délku + Enter"
            : "Vyberte počáteční bod",
          polyline: n
            ? "Další bod · Enter dokončí · K uzavře"
            : "Vyberte první vrchol",
          rectangle: n ? "Vyberte protilehlý roh" : "Vyberte první roh",
          panel: "Kliknutím umístěte dílec · rozměry v mm",
          circle: n
            ? "Vyberte poloměr nebo jej zadejte + Enter"
            : "Vyberte střed kružnice",
          arc:
            n === 0
              ? "Vyberte začátek oblouku"
              : n === 1
                ? "Vyberte konec oblouku"
                : "Vytáhněte oblouk ze středu a potvrďte",
          drill: "Kliknutím umístěte otvor",
          slot: n ? "Vyberte druhý střed drážky" : "Vyberte první střed drážky",
          text: "Kliknutím umístěte text",
          dimension:
            n === 0
              ? "Vyberte začátek kóty"
              : n === 1
                ? "Vyberte konec kóty"
                : "Určete polohu kóty",
          angle:
            n === 0
              ? "Vyberte vrchol úhlu"
              : n === 1
                ? "Vyberte první rameno"
                : "Vyberte druhé rameno",
          radius: this.target
            ? "Určete polohu popisu"
            : "Vyberte kružnici nebo oblouk",
          move: n ? "Vyberte cílový bod" : "Vyberte základní bod",
          copy: n ? "Vyberte cíl kopie" : "Vyberte základní bod",
          trim: "Klikněte na úsek čáry, který chcete odstranit",
          extend: "Vyberte úsečku u prodlužovaného konce",
        }[this.active] || "Připraveno"
      );
    }
  }
  const positive = (...ns) =>
    ns.every((n) => Number.isFinite(+n) && +n > 0 && +n <= 1e7);
  const nonnegative = (n) => Number.isFinite(+n) && +n >= 0 && +n <= 1e7;
  function rectanglePoints(a, p, o = {}, shiftKey = false) {
    let bx = p.x;
    let by = p.y;
    const hasW = Number.isFinite(+o.rectWidth) && +o.rectWidth > 0;
    const hasH = Number.isFinite(+o.rectHeight) && +o.rectHeight > 0;
    if (hasW) bx = a.x + (p.x >= a.x ? 1 : -1) * +o.rectWidth;
    if (hasH) by = a.y + (p.y >= a.y ? 1 : -1) * +o.rectHeight;
    if (shiftKey) {
      if (!hasW && !hasH) {
        const dx = Math.abs(p.x - a.x);
        const dy = Math.abs(p.y - a.y);
        const side = Math.max(dx, dy);
        bx = a.x + (p.x >= a.x ? 1 : -1) * side;
        by = a.y + (p.y >= a.y ? 1 : -1) * side;
      } else if (hasW && !hasH) {
        by = a.y + (p.y >= a.y ? 1 : -1) * +o.rectWidth;
      } else if (!hasW && hasH) {
        bx = a.x + (p.x >= a.x ? 1 : -1) * +o.rectHeight;
      }
    }
    return [a, { x: bx, y: a.y }, { x: bx, y: by }, { x: a.x, y: by }];
  }

  Joinery.Tools = {
    DRAW_TOOLS,
    EDIT_TOOLS,
    Tools,
    SelectionTool,
    TransformTool,
    RotateTool,
    MirrorTool,
    JoinTool,
    EraserTool,
    OffsetTool,
    MeasureTool,
  };
})((globalThis.Joinery = globalThis.Joinery || {}));
