/** Interactive tools share model-space snapping and commit/undo transactions. */
(function (J) {
  const G = J.Geometry,
    GE = J.GeometryEngine.GeometryEngine,
    uid = J.Model.uid;
  class CADTool {
    constructor(app, system) {
      this.app = app;
      this.system = system;
      this.points = [];
      this.options = {};
      this.interactive = true;
    }
    activate() {
      this.points = [];
      this.first = null;
      this.target = null;
      this.pending = false;
    }
    hit(raw) {
      const hit = this.app.canvas.pick(raw);
      if (
        !hit ||
        this.app.project.layers.find((l) => l.id === hit.layer)?.locked
      )
        return null;
      return hit;
    }
    reset() {
      this.points = [];
      this.first = null;
      this.target = null;
      this.app.canvas.preview = [];
      this.app.canvas.invalidate();
    }
    replace(old, items) {
      this.app.commit(() => {
        this.app.project.entities = this.app.project.entities.filter(
          (e) => !old.includes(e.id),
        );
        for (const item of items)
          this.app.project.entities.push({
            ...item,
            id: item.id || uid(),
            layer: item.layer || this.app.activeLayer,
          });
      });
      this.reset();
    }
    move() {}
  }
  class LegacyCADTool extends CADTool {
    constructor(a, s, id) {
      super(a, s);
      this.id = id;
      this.interactive = false;
    }
    click(p, event, raw) {
      this.app.tools.legacyClick(raw, event);
    }
    move(p, event, raw) {
      this.app.tools.legacyMove(raw, event);
    }
  }
  class CornerTool extends CADTool {
    constructor(a, s, mode) {
      super(a, s);
      this.mode = mode;
      this.options =
        mode === "fillet"
          ? { radius: 10, dimension: true }
          : { a: 10, b: 10, dimension: true };
    }
    fields() {
      return this.mode === "fillet"
        ? [
            ["radius", "Poloměr [mm]", 10],
            ["dimension", "Okótovat", true, "checkbox"],
          ]
        : [
            ["a", "Vzdálenost A [mm]", 10],
            ["b", "Vzdálenost B [mm]", 10],
            ["dimension", "Okótovat", true, "checkbox"],
          ];
    }
    candidate(raw) {
      const hit = this.hit(raw);
      if (!hit) return null;
      const options = { ...this.options, mode: this.mode };
      if (hit.type === "line") {
        if (this.first && hit.id !== this.first.id) {
          const c = GE.modifyLines(this.first, hit, options);
          return {
            ids: [this.first.id, hit.id],
            items: [
              c.a,
              c.b,
              c.connector,
              ...(this.options.dimension
                ? GE.cornerDimensions(
                    c.corner,
                    c.vertex,
                    c.previous,
                    c.next,
                    this.mode,
                    this.app.project.settings.drawingScale,
                  )
                : []),
            ],
          };
        }
        return { line: hit };
      }
      if (hit.points?.length >= 3) {
        const indices = hit.points
          .map((p, i) => ({ i, d: G.distance(raw, p) }))
          .sort((a, b) => a.d - b.d);
        if (indices[0].d > 18 / this.app.canvas.zoom) return null;
        const i = indices[0].i,
          n = hit.points.length;
        const previous = hit.points[(i + n - 1) % n],
          vertex = hit.points[i],
          next = hit.points[(i + 1) % n];
        const c = GE.corner(previous, vertex, next, options);
        return {
          ids: [hit.id],
          items: [
            GE.modifyCorner(hit, i, options),
            ...(this.options.dimension
              ? GE.cornerDimensions(
                  c,
                  vertex,
                  previous,
                  next,
                  this.mode,
                  this.app.project.settings.drawingScale,
                )
              : []),
          ],
        };
      }
      return null;
    }
    click(p, event, raw) {
      const c = this.candidate(raw);
      if (c?.line) {
        this.first = c.line;
        this.app.select(c.line.id);
        this.app.toast("Vyberte druhou úsečku.");
      } else if (c) this.replace(c.ids, c.items);
      else this.app.toast("Klikněte na roh obrysu nebo vyberte dvě úsečky.");
    }
    move(p, event, raw) {
      try {
        const c = this.candidate(raw);
        this.app.canvas.preview = c?.items || [];
      } catch {
        this.app.canvas.preview = [];
      }
    }
  }
  class FilletTool extends CornerTool {
    constructor(a, s) {
      super(a, s, "fillet");
    }
  }
  class ChamferTool extends CornerTool {
    constructor(a, s) {
      super(a, s, "chamfer");
    }
  }
  class LineModifierTool extends CADTool {
    constructor(a, s, mode) {
      super(a, s);
      this.mode = mode;
    }
    click(p, event, raw) {
      const hit = this.target || this.hit(raw);
      if (hit?.type !== "line") {
        this.app.toast("Vyberte úsečku.");
        return;
      }
      if (this.mode === "meet") {
        if (!this.first) {
          this.first = hit;
          this.app.select(hit.id);
          return;
        }
        if (this.first.id !== hit.id)
          this.replace([this.first.id, hit.id], GE.meetLines(this.first, hit));
      } else if (this.mode === "split")
        this.replace([hit.id], GE.splitLine(hit, p));
      else {
        if (!this.target) {
          this.target = hit;
          this.points = [G.projectPoint(p, ...hit.points)];
          this.app.select(hit.id);
        } else this.replace([hit.id], GE.breakLine(hit, this.points[0], p));
      }
    }
  }
  class HandleArcTool extends CADTool {
    hint() {
      return this.points.length === 0
        ? "Vyberte začáteční bod oblouku."
        : this.points.length === 1
          ? "Vyberte koncový bod oblouku."
          : "Vytáhněte oblouk ze středu úsečky a potvrďte kliknutím nebo Enter.";
    }
    reset() {
      super.reset();
      this.pending = false;
      this.app.canvas.toolVector = null;
    }
    handle(p) {
      const mid = G.midpoint(...this.points),
        n = G.perpendicular(G.unit(G.sub(this.points[1], this.points[0])));
      return G.add(mid, G.mul(n, G.dot(G.sub(p, mid), n)));
    }
    click(p) {
      if (this.points.length === 1 && G.distance(this.points[0], p) < 1e-6) {
        this.app.toast("Konec oblouku musí být jiný než začátek.");
        return;
      }
      if (this.points.length < 2) this.points.push(p);
      else this.pending = true;
      this.move(p);
    }
    pointerEnd(p) {
      if (!this.pending) return;
      const e = this.entity(p);
      if (!e) throw new Error("Úchyt nesmí ležet na přímce.");
      this.app.add([e]);
      this.pending = false;
      this.reset();
    }
    entity(p) {
      if (this.points.length < 2) return null;
      const arc = G.circleThrough(
        this.points[0],
        this.handle(p),
        this.points[1],
      );
      return arc ? { type: "arc", ...arc } : null;
    }
    move(p) {
      this.app.canvas.preview =
        this.points.length >= 2
          ? [this.entity(p) || { type: "line", points: this.points }]
          : this.points.length
            ? [{ type: "line", points: [this.points[0], p] }]
            : [];
      this.app.canvas.toolVector =
        this.points.length === 2
          ? { a: G.midpoint(...this.points), b: this.handle(p) }
          : null;
    }
    finish(event = {}) {
      if (this.points.length === 2) {
        this.pending = true;
        this.pointerEnd(
          this.app.tools.snap(this.app.tools.pointer, event).point,
        );
      }
    }
  }
  class LeaderTool extends CADTool {
    constructor(a, s) {
      super(a, s);
      this.options = { text: "Popis" };
    }
    fields() {
      return [["text", "Text", "Popis", "text"]];
    }
    entity(p) {
      const end = { x: p.x, y: this.points[1].y };
      return {
        type: "leader",
        points: [...this.points.slice(0, 2), end],
        text: this.options.text,
      };
    }
    click(p) {
      if (this.points.length < 2) this.points.push(p);
      else this.pending = true;
    }
    pointerEnd(p) {
      if (this.pending) {
        this.app.add([this.entity(p)]);
        this.pending = false;
        this.reset();
      }
    }
    move(p) {
      this.app.canvas.preview =
        this.points.length === 2
          ? [this.entity(p)]
          : this.points.length
            ? [{ type: "line", points: [this.points[0], p] }]
            : [];
    }
  }
  class GrainTool extends CADTool {
    click(p, event, raw) {
      if (!this.target) {
        this.target = this.hit(raw);
        if (!this.target) return;
        this.points = [p];
        this.app.select(this.target.id);
      } else {
        const target = this.app.project.entities.find(
          (e) => e.id === this.target.id,
        );
        this.app.commit(() => {
          target.grainVector = [this.points[0], p];
          (target.part || target).grain = "long";
        });
        this.reset();
      }
    }
    move(p) {
      this.app.canvas.preview = this.points.length
        ? [{ type: "line", points: [this.points[0], p], lineStyle: "dashdot" }]
        : [];
    }
  }
  class GapCheckerTool extends CADTool {
    constructor(a, s) {
      super(a, s);
      this.options = { tolerance: 0.2 };
    }
    fields() {
      return [["tolerance", "Tolerance [mm]", 0.2]];
    }
    activate() {
      super.activate();
      this.scan();
    }
    scan() {
      const all = this.app.canvas.visibleEntities(),
        targets = this.app.editableSelection();
      this.app.canvas.diagnostics = GE.gaps(
        targets.length ? targets : all,
        all,
        Math.max(0.1, Math.min(0.5, this.options.tolerance)),
      );
      this.app.canvas.invalidate();
      this.app.toast(
        `Otevřené konce: ${this.app.canvas.diagnostics.length}. Geometrie nebyla změněna.`,
      );
    }
    click() {
      this.scan();
    }
  }
  class DetailTool extends CADTool {
    constructor(a, s) {
      super(a, s);
      this.options = { detailScale: 1, name: "A" };
    }
    fields() {
      return [
        ["detailScale", "Měřítko detailu 1:", 1],
        ["name", "Označení", "A", "text"],
      ];
    }
    entity(p) {
      const radius = G.distance(this.points[0], this.points[1] || p),
        factor =
          (this.app.project.settings.drawingScale || 10) /
          this.options.detailScale;
      return {
        type: "detail",
        center: this.points[0],
        radius,
        points: [p],
        factor,
        detailScale: this.options.detailScale,
        name: this.options.name,
        contents: GE.crop(
          this.app.canvas.visibleEntities(),
          this.points[0],
          radius,
        ),
        cutListEnabled: false,
      };
    }
    click(p) {
      if (this.points.length < 2) {
        this.points.push(p);
        return;
      }
      if (this.options.detailScale <= 0)
        throw new Error("Měřítko musí být kladné.");
      const e = this.entity(p);
      if (e.radius <= 0.01)
        throw new Error("Detail musí mít nenulový poloměr.");
      this.app.add([e]);
      this.reset();
    }
    move(p) {
      this.app.canvas.preview =
        this.points.length === 1
          ? [
              {
                type: "circle",
                center: this.points[0],
                radius: G.distance(this.points[0], p),
              },
            ]
          : this.points.length === 2
            ? [this.entity(p)]
            : [];
    }
  }
  class SelectionTool extends CADTool {
    constructor(a, s, mode) {
      super(a, s);
      this.mode = mode;
      this.options = {
        columns: 5,
        rows: 1,
        dx: 32,
        dy: 32,
        name: "Skupina objektů",
        parts: "keep",
      };
    }
    fields() {
      if (this.mode === "array")
        return [
          ["columns", "Sloupce", 5],
          ["rows", "Řádky", 1],
          ["dx", "Rozteč X [mm]", 32],
          ["dy", "Rozteč Y [mm]", 32],
        ];
      return [
        ["name", "Název", "Skupina objektů", "text"],
        [
          "parts",
          "Kusovník",
          "keep",
          "select",
          [
            ["keep", "Zachovat dílce"],
            ["exclude", "Pohledy jednoho dílce"],
          ],
        ],
      ];
    }
    click(p, event, raw) {
      if (this.mode === "group" || !this.app.selection.size) {
        const hit = this.hit(raw);
        if (hit) this.app.select(hit.id, event.shiftKey);
        return;
      }
      this.apply(p);
    }
    apply(p) {
      const a = this.app,
        rows = a.editableSelection(),
        o = this.options;
      if (!rows.length) throw new Error("Nejprve vyberte objekty.");
      if (this.mode === "group") {
        if (rows.length < 2)
          throw new Error("Pro skupinu vyberte alespoň dva objekty.");
        a.commit(() => {
          const id = uid();
          for (const e of rows) {
            e.groupId = id;
            e.groupName = o.name || "Skupina objektů";
            if (o.parts === "exclude" && J.Model.isPart(e))
              e.cutListEnabled = false;
          }
        });
      } else {
        if (
          ![o.columns, o.rows].every((n) => Number.isInteger(n) && n > 0) ||
          o.columns * o.rows * rows.length > 20000
        )
          throw new Error(
            "Zadejte celé počty; pole může mít nejvýše 20 000 objektů.",
          );
        if (![o.dx, o.dy].every(Number.isFinite))
          throw new Error("Zadejte platnou rozteč.");
        const copies = [];
        for (let y = 0; y < o.rows; y++)
          for (let x = 0; x < o.columns; x++)
            if (x || y) {
              const map = new Map(rows.map((e) => [e.id, uid()]));
              const group = rows.map((e) => {
                const c = G.transformEntity(e, (q) =>
                  G.add(q, { x: x * o.dx, y: y * o.dy }),
                );
                c.id = map.get(e.id);
                if (map.has(c.detailId)) c.detailId = map.get(c.detailId);
                return c;
              });
              copies.push(...J.Model.regroupCopies(group));
            }
        a.add(copies);
      }
      this.reset();
    }
  }
  class ToolSystem {
    constructor(app) {
      this.app = app;
      this.registry = {
        select: new J.Tools.SelectionTool(app, this),
        move: new J.Tools.TransformTool(app, this, "move"),
        copy: new J.Tools.TransformTool(app, this, "copy"),
        eraser: new J.Tools.EraserTool(app, this),
        measure: new J.Tools.MeasureTool(app, this),
        array: new SelectionTool(app, this, "array"),
        group: new SelectionTool(app, this, "group"),
        fillet: new FilletTool(app, this),
        chamfer: new ChamferTool(app, this),
        meet: new LineModifierTool(app, this, "meet"),
        split: new LineModifierTool(app, this, "split"),
        break: new LineModifierTool(app, this, "break"),
        "handle-arc": new HandleArcTool(app, this),
        arc: new HandleArcTool(app, this),
        leader: new LeaderTool(app, this),
        grain: new GrainTool(app, this),
        gaps: new GapCheckerTool(app, this),
        detail: new DetailTool(app, this),
        offset: new J.Tools.OffsetTool(app, this),
      };
      for (const id of new Set([
        ...ToolSystem.groups.flatMap((g) => g[1]),
        ...J.Tools.DRAW_TOOLS.map((t) => t[0]),
        ...J.Tools.EDIT_TOOLS.map((t) => t[0]),
      ]))
        if (!this.registry[id])
          this.registry[id] = new LegacyCADTool(app, this, id);
      this.buildToolbar();
      this.installPickMenu();
      this.app.canvas.callbacks.cancelGesture = () => {
        this.current?.reset();
        this.updateFloatingHUD();
      };
      this.app.canvas.callbacks.end = (p, e) => {
        if (this.current?.interactive) {
          if (e.type === "pointercancel") {
            this.current.reset();
            this.updateFloatingHUD();
          } else this.dispatch("pointerEnd", p, e);
        }
      };
      this.current = this.registry.select;
      this.current.activate();
    }
    activate(id) {
      this.cancelPick?.();
      this.closeMenus();
      this.current?.reset();
      this.current = this.registry[id];
      this.floatingHUD?.remove();
      this.floatingHUD = null;
      this.current?.activate();
      this.app.canvas.diagnostics =
        id === "gaps" ? this.app.canvas.diagnostics : null;
      this.renderHUD();
    }
    dispatch(method, raw, event) {
      const tool = this.current;
      if (!tool) return false;
      if (tool.interactive) this.app.tools.points = tool.points;
      const snap = tool.noSnap
        ? { point: raw, kind: "" }
        : this.app.tools.snap(raw, event);
      this.app.tools.pointer = raw;
      this.app.tools.lastEvent = event || {};
      if (tool.interactive) this.app.tools.points = tool.points;
      this.app.canvas.snap = snap;
      this.app.coordinates(snap.point);
      const picking =
        method === "pointerEnd" ||
        (method === "click" &&
          !["select", "eraser"].includes(this.app.tools.active));
      this.resolvePicking(
        () => tool[method]?.(snap.point, event, raw),
        event,
        picking,
      );
      if (tool.interactive) this.app.tools.points = tool.points;
      this.updateFloatingHUD();
      if (tool.hint) {
        const hint = document.querySelector("#tool-options .select-hint");
        if (hint && hint.textContent !== tool.hint())
          hint.textContent = tool.hint();
      }
      this.app.canvas.invalidate();
      return true;
    }
    resolvePicking(callback, event, picking = true) {
      const canvas = this.app.canvas,
        previous = canvas.pickInteractive;
      canvas.pickInteractive = picking;
      try {
        callback();
      } catch (error) {
        if (error instanceof J.CanvasManager.PickChoice)
          this.showPickMenu(error, callback, event);
        else this.app.toast(error.message);
      } finally {
        canvas.pickInteractive = previous;
      }
    }
    cancelPick() {
      if (this.pendingPick && this.pendingPick.tool === this.current)
        this.current.gesture = null;
      this.pendingPick = null;
      if (this.pickMenu) this.pickMenu.hidden = true;
      this.app.canvas.pickHover = null;
      this.app.canvas.invalidate();
    }
    installPickMenu() {
      const menu = document.createElement("div");
      menu.className = "cad-pick-menu";
      menu.hidden = true;
      menu.setAttribute("role", "menu");
      menu.setAttribute("aria-label", "Objekty pod kurzorem");
      document.body.append(menu);
      this.pickMenu = menu;
      document.addEventListener(
        "pointerdown",
        (e) => {
          if (this.pendingPick && !menu.contains(e.target)) this.cancelPick();
        },
        true,
      );
      window.addEventListener("resize", () => this.cancelPick());
      window.addEventListener("blur", () => this.cancelPick());
      menu.onkeydown = (e) => {
        e.stopPropagation();
        if (e.key === "Tab") {
          e.preventDefault();
          const all = [...menu.querySelectorAll("button")],
            i = all.indexOf(document.activeElement);
          all[(i + (e.shiftKey ? -1 : 1) + all.length) % all.length]?.focus();
          return;
        }
        const buttons = [...menu.querySelectorAll("[data-pick-index]")],
          i = buttons.indexOf(document.activeElement);
        if (["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          const next =
            e.key === "Home"
              ? 0
              : e.key === "End"
                ? buttons.length - 1
                : (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                  buttons.length;
          buttons[next]?.focus();
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          this.cancelPick();
          this.app.canvas.canvas.focus();
        }
      };
    }
    showPickMenu(choice, callback, event) {
      this.closeMenus();
      const menu = this.pickMenu,
        canvas = this.app.canvas;
      this.pendingPick = { project: this.app.project, tool: this.current };
      const pending = this.pendingPick;
      menu.replaceChildren();
      const label = document.createElement("strong");
      label.textContent = `Vyberte objekt (${choice.candidates.length})`;
      menu.append(label);
      const types = {
        line: "Úsečka",
        polyline: "Lomená čára",
        rectangle: "Obdélník",
        panel: "Obdélník",
        region: "Booleovský obrys",
        circle: "Kružnice",
        drill: "Otvor",
        arc: "Oblouk",
        slot: "Drážka",
        cutout: "Výřez",
        text: "Text",
        dimension: "Kóta",
        angle: "Úhlová kóta",
        radius: "Poloměrová kóta",
        leader: "Odkaz",
        detail: "Detail",
      };
      choice.candidates.forEach((entity, i) => {
        const button = document.createElement("button");
        button.type = "button";
        button.role = "menuitem";
        button.dataset.pickIndex = i;
        const name = document.createElement("span"),
          detail = document.createElement("small");
        name.textContent = `${i + 1}. ${entity.name || entity.text || types[entity.type] || "Objekt"}`;
        const layer = this.app.project.layers.find(
          (l) => l.id === entity.layer,
        );
        detail.textContent = `${types[entity.type] || entity.type} · ${layer?.name || "Vrstva"}${entity.lineStyle === "dashed" ? " · čárkovaná" : ""}${entity.id ? " · " + entity.id.slice(-8) : ""}`;
        button.append(name, detail);
        const highlight = () => {
          canvas.pickHover = entity;
          canvas.invalidate();
        };
        button.onpointerenter = button.onfocus = highlight;
        button.onclick = () => {
          if (this.pendingPick !== pending) return;
          this.pendingPick = null;
          menu.hidden = true;
          canvas.pickHover = null;
          if (
            pending.project !== this.app.project ||
            pending.tool !== this.current
          )
            return;
          canvas.pickOverride = { entity, point: choice.point, used: false };
          try {
            this.resolvePicking(callback, event);
          } finally {
            canvas.pickOverride = null;
          }
          if (this.current.interactive)
            this.app.tools.points = this.current.points;
          this.updateFloatingHUD();
          canvas.invalidate();
          if (!this.pendingPick) canvas.canvas.focus();
        };
        menu.append(button);
      });
      const cancel = document.createElement("button");
      cancel.textContent = "Zrušit · Esc";
      cancel.className = "pick-cancel";
      cancel.onclick = () => {
        this.cancelPick();
        canvas.canvas.focus();
      };
      menu.append(cancel);
      menu.hidden = false;
      const p = canvas.toScreen(choice.point),
        r = canvas.canvas.getBoundingClientRect(),
        x = event?.clientX ?? r.left + p.x,
        y = event?.clientY ?? r.top + p.y;
      menu.style.left = `${Math.max(8, Math.min(x + 8, innerWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(y + 8, innerHeight - menu.offsetHeight - 8))}px`;
      menu.querySelector("[data-pick-index]")?.focus();
    }
    renderHUD() {
      const bar = document.getElementById("tool-options");
      const tool = this.current;
      this.updateFloatingHUD();
      if (!tool?.interactive) return;
      bar.replaceChildren();
      bar.hidden = false;
      const label = document.createElement("strong");
      label.textContent = ToolSystem.names[this.app.tools.active];
      bar.append(label);
      for (const [
        name,
        text,
        value,
        type = "number",
        options,
      ] of tool.fields?.() || []) {
        const l = document.createElement("label");
        l.textContent = text;
        const input = document.createElement(
          type === "select" ? "select" : "input",
        );
        input.dataset.hud = name;
        if (name === "detailMove") input.dataset.option = name;
        if (type === "select")
          for (const v of options) {
            const o = new Option(
              Array.isArray(v) ? v[1] : v,
              Array.isArray(v) ? v[0] : v,
            );
            input.add(o);
          }
        else {
          input.type = type;
          input.step = "any";
        }
        input.value = tool.options[name] ?? value;
        if (type === "checkbox") input.checked = tool.options[name] ?? value;
        input.oninput = () => {
          if (
            type === "number" &&
            (input.value === "" || !Number.isFinite(+input.value))
          )
            return;
          tool.options[name] =
            type === "checkbox"
              ? input.checked
              : type === "number"
                ? +input.value
                : input.value;
          if (name === "detailMove")
            this.app.tools.options.detailMove = input.value;
          if (name === "arcConstruction") {
            this.app.chooseTool(input.value);
            return;
          }
          if (tool instanceof GapCheckerTool) tool.scan();
          else
            this.dispatch(
              "move",
              this.app.tools.pointer,
              this.app.tools.lastEvent || {},
            );
        };
        l.append(input);
        bar.append(l);
      }
      if (tool.apply) {
        const apply = document.createElement("button");
        apply.className = "compact-button";
        apply.textContent = "Použít";
        apply.dataset.toolApply = "";
        apply.onclick = () => {
          try {
            tool.apply();
            this.app.canvas.canvas.focus();
          } catch (error) {
            this.app.toast(error.message);
          }
        };
        bar.append(apply);
      }
      const hint = document.createElement("span");
      hint.className = "select-hint";
      hint.textContent =
        tool.hint?.() ||
        ToolSystem.hints[this.app.tools.active] ||
        "Kliknutím vyberte objekt.";
      bar.append(hint);
      const close = document.createElement("button");
      close.textContent = "×";
      close.setAttribute("aria-label", "Zrušit nástroj");
      close.onclick = () => this.app.tools.cancel();
      bar.append(close);
    }
    validFloating() {
      return (
        !this.floatingHUD ||
        [...this.floatingHUD.querySelectorAll("input")].every(
          (i) => i.getAttribute("aria-invalid") !== "true",
        )
      );
    }
    updateFloatingHUD() {
      const tool = this.current;
      if (!tool?.floating) {
        if (this.floatingHUD) this.floatingHUD.hidden = true;
        return;
      }
      if (!this.floatingHUD) {
        const root = document.createElement("div");
        root.className = "cad-floating-hud";
        root.setAttribute("role", "group");
        root.setAttribute("aria-label", "Číselné zadání nástroje");
        root.innerHTML =
          '<strong data-hud-title></strong><div class="hud-metrics"></div><div class="hud-fields"></div><p data-hud-hint></p>';
        const fields = root.querySelector(".hud-fields");
        for (const [name, label] of tool.hudFields?.() || []) {
          const l = document.createElement("label"),
            input = document.createElement("input");
          l.textContent = label;
          input.type = "text";
          input.inputMode = "decimal";
          input.autocomplete = "off";
          input.dataset.delta = name;
          input.setAttribute("aria-label", label);
          input.onfocus = () => {
            if (tool.hudReady?.()) tool.numeric = true;
            input.select();
          };
          input.oninput = () => {
            const raw = input.value.trim().replace(",", "."),
              n = Number(raw),
              valid =
                raw !== "" &&
                Number.isFinite(n) &&
                Math.abs(n) <= 1e7 &&
                (name !== "distance" || n > 0);
            input.setAttribute("aria-invalid", String(!valid));
            if (!valid) {
              if (name === "distance") {
                this.app.canvas.preview = [];
                this.app.canvas.invalidate();
              }
              return;
            }
            tool.options[name] = n;
            tool.numeric = true;
            this.dispatch(
              "move",
              this.app.tools.pointer,
              this.app.tools.lastEvent,
            );
          };
          l.append(input);
          fields.append(l);
        }
        root.onkeydown = (e) => {
          if (this.handleKeydown(e)) {
            e.preventDefault();
            e.stopPropagation();
          }
        };
        document.getElementById("design-view").append(root);
        this.floatingHUD = root;
      }
      const root = this.floatingHUD,
        hud = tool.hud();
      root.hidden =
        document.body.classList.contains("print-preview") ||
        this.app.tab !== "design";
      root.querySelector("[data-hud-title]").textContent = hud.title;
      root.querySelector("[data-hud-hint]").textContent = hud.hint;
      const fmt = (n) =>
        Number.isFinite(n)
          ? Number(n.toFixed(3)).toLocaleString("cs-CZ", {
              maximumFractionDigits: 3,
            })
          : "—";
      const values = [
        hud.d === undefined ? "" : `d ${fmt(hud.d)} mm`,
        hud.angle === undefined ? "" : `α ${fmt(hud.angle)}°`,
        hud.dx === undefined ? "" : `ΔX ${fmt(hud.dx)} mm`,
        hud.dy === undefined ? "" : `ΔY ${fmt(hud.dy)} mm`,
      ].filter(Boolean);
      const metrics = root.querySelector(".hud-metrics");
      if (metrics.children.length !== values.length)
        metrics.replaceChildren(
          ...values.map(() => document.createElement("span")),
        );
      values.forEach((value, i) => {
        metrics.children[i].textContent = value;
      });
      for (const input of root.querySelectorAll("input")) {
        input.disabled = !tool.hudReady?.();
        if (document.activeElement !== input && !tool.numeric) {
          input.value = String(tool.options[input.dataset.delta] ?? 0);
          input.setAttribute("aria-invalid", "false");
        }
      }
      // Keep the panel stationary while typing so Tab and mouse focus are stable.
      if (!root.contains(document.activeElement)) {
        const canvas = this.app.canvas,
          r = canvas.canvas.getBoundingClientRect(),
          q = canvas.toScreen(this.app.tools.pointer);
        const x = r.left + q.x,
          y = r.top + q.y;
        root.style.left = `${Math.max(r.left + 8, Math.min(x + 20, r.right - root.offsetWidth - 8))}px`;
        root.style.top = `${Math.max(r.top + 8, Math.min(y + 20, r.bottom - root.offsetHeight - 8))}px`;
      }
    }
    handleKeydown(e) {
      const tool = this.current,
        root = this.floatingHUD;
      if (!root || root.hidden) return false;
      const inputs = [...root.querySelectorAll("input:not(:disabled)")],
        focused = root.contains(document.activeElement);
      if (e.key === "Escape" && focused) {
        this.app.tools.cancel();
        this.app.canvas.canvas.focus();
        return true;
      }
      if (
        e.key === "Tab" &&
        inputs.length &&
        (focused || e.target === this.app.canvas.canvas)
      ) {
        const i = inputs.indexOf(document.activeElement);
        inputs[
          i < 0
            ? e.shiftKey
              ? inputs.length - 1
              : 0
            : (i + (e.shiftKey ? -1 : 1) + inputs.length) % inputs.length
        ].focus();
        return true;
      }
      if (
        e.key === "Enter" &&
        (focused || e.target === this.app.canvas.canvas)
      ) {
        if (this.validFloating()) {
          tool.finish?.(e);
          this.updateFloatingHUD();
        }
        return true;
      }
      return false;
    }
    run(id) {
      this.closeMenus();
      if (id === "linear-dim" || id === "aligned-dim") {
        this.app.tools.options.dimensionMode =
          id === "linear-dim" ? "horizontal" : "aligned";
        this.app.chooseTool("dimension");
        return;
      }
      if (id === "ungroup") {
        this.app.ungroupSelection();
        return;
      }
      if (id === "join") {
        try {
          const selection = this.app.editableSelection(),
            out = GE.join(selection);
          this.app.commit(() => {
            this.app.project.entities = this.app.project.entities.filter(
              (e) => !selection.some((s) => s.id === e.id),
            );
            this.app.project.entities.push(out);
            this.app.selection = new Set([out.id]);
          });
        } catch (e) {
          this.app.toast(e.message);
        }
        return;
      }
      if (id === "explode") {
        try {
          const selection = this.app.editableSelection(),
            out = selection.flatMap((e) => GE.explode(e));
          if (!out.length) throw new Error("Nejprve vyberte obrys.");
          this.app.commit(() => {
            this.app.project.entities = this.app.project.entities.filter(
              (e) => !selection.some((s) => s.id === e.id),
            );
            this.app.project.entities.push(
              ...out.map((e) => ({ ...e, id: uid() })),
            );
          });
        } catch (e) {
          this.app.toast(e.message);
        }
        return;
      }
      this.app.chooseTool(id);
    }
    static icon(id) {
      const aliases = {
        "handle-arc": "arc",
        "linear-dim": "dimension",
        "aligned-dim": "dimension",
      };
      return `<svg aria-hidden="true"><use href="#i-${aliases[id] || id}"/></svg>`;
    }
    closeMenus() {
      document
        .querySelectorAll(".tool-flyout")
        .forEach((f) => (f.hidden = true));
      document
        .querySelectorAll(".tool-group-arrow")
        .forEach((b) => b.setAttribute("aria-expanded", "false"));
    }
    buildToolbar() {
      const root = document.getElementById("drawing-tools");
      root.replaceChildren();
      document.getElementById("editing-tools").replaceChildren();
      for (const [name, tools] of ToolSystem.groups) {
        const group = document.createElement("div");
        group.className = "tool-group";
        const primary = document.createElement("button");
        primary.className = "tool-group-primary";
        const updatePrimary = (id) => {
          primary.dataset.tool = id;
          primary.dataset.tooltip = ToolSystem.names[id] || id;
          primary.setAttribute("aria-label", primary.dataset.tooltip);
          primary.innerHTML = ToolSystem.icon(id);
        };
        updatePrimary(tools[0]);
        primary.onclick = () => this.run(primary.dataset.tool);
        const arrow = document.createElement("button");
        arrow.className = "tool-group-arrow";
        arrow.innerHTML =
          '<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path d="m3 5.5 5 5 5-5"/></svg>';
        arrow.setAttribute("aria-label", `Nástroje: ${name}`);
        arrow.setAttribute("aria-haspopup", "menu");
        arrow.setAttribute("aria-expanded", "false");
        const fly = document.createElement("div");
        fly.className = "tool-flyout";
        fly.role = "menu";
        fly.setAttribute("aria-label", name);
        fly.hidden = true;
        for (const id of tools) {
          const b = document.createElement("button");
          b.dataset.tool = id;
          b.dataset.tooltip = ToolSystem.names[id] || id;
          b.role = "menuitem";
          b.innerHTML = ToolSystem.icon(id);
          const label = document.createElement("span");
          label.textContent = b.dataset.tooltip;
          b.append(label);
          b.onclick = () => {
            updatePrimary(id);
            this.closeMenus();
            this.run(id);
          };
          fly.append(b);
        }
        const show = () => {
          this.closeMenus();
          fly.hidden = false;
          arrow.setAttribute("aria-expanded", "true");
          const r = group.getBoundingClientRect();
          fly.style.maxHeight = `${Math.max(80, innerHeight - r.bottom - 48)}px`;
          fly.style.left = `${Math.max(4, Math.min(r.left, innerWidth - fly.offsetWidth - 4))}px`;
          fly.style.top = `${r.bottom + 2}px`;
        };
        arrow.dataset.tooltip = `Nástroje: ${name}`;
        arrow.onclick = () => {
          if (fly.hidden) show();
          else this.closeMenus();
        };
        arrow.onkeydown = (e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            show();
            fly.firstElementChild.focus();
          }
        };
        fly.onkeydown = (e) => {
          const buttons = [...fly.children],
            i = buttons.indexOf(document.activeElement);
          if (["ArrowDown", "ArrowUp"].includes(e.key)) {
            e.preventDefault();
            buttons[
              (i + (e.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                buttons.length
            ].focus();
          }
          if (e.key === "Escape") {
            this.closeMenus();
            arrow.focus();
          }
        };
        group.append(primary, arrow, fly);
        root.append(group);
      }
      for (const id of ["eraser", "measure"]) {
        const button = document.createElement("button");
        button.className = "standalone-tool";
        button.dataset.tool = id;
        button.dataset.tooltip = ToolSystem.names[id];
        button.setAttribute("aria-label", ToolSystem.names[id]);
        button.innerHTML = ToolSystem.icon(id);
        button.onclick = () => this.run(id);
        root.append(button);
      }
      document.addEventListener("pointerdown", (e) => {
        if (!e.target.closest(".tool-group")) this.closeMenus();
      });
      document.addEventListener("keydown", (e) => {
        if (e.key === "Escape") this.closeMenus();
      });
      window.addEventListener("resize", () => this.closeMenus());
    }
    static groups = [
      [
        "Kreslení",
        ["line", "polyline", "rectangle", "circle", "arc", "drill", "slot"],
      ],
      ["Úsečky", ["trim", "extend", "split", "break"]],
      ["Rohy a hrany", ["offset", "fillet", "chamfer", "join", "explode"]],
      [
        "Kóty a popisy",
        ["dimension", "angle", "radius", "leader", "detail", "text"],
      ],
      [
        "Booleovské",
        ["boolean-union", "boolean-subtract", "boolean-intersect"],
      ],
      [
        "Výběr a kontrola",
        [
          "select",
          "move",
          "copy",
          "eraser",
          "measure",
          "array",
          "group",
          "ungroup",
          "gaps",
        ],
      ],
    ];
    static names = {
      ...Object.fromEntries(
        [...J.Tools.DRAW_TOOLS, ...J.Tools.EDIT_TOOLS].map((t) => [t[0], t[1]]),
      ),
      fillet: "Zaoblení",
      chamfer: "Sražení",
      meet: "Napojit dvě úsečky",
      split: "Rozdělit úsečku",
      break: "Přerušit úsečku",
      "handle-arc": "Oblouk",
      leader: "Odkazová kóta",
      grain: "Směr vláken",
      gaps: "Kontrola mezer",
      detail: "Detail",
      offset: "Paralela",
      join: "Spojit do lomené čáry",
      explode: "Rozložit",
      trim: "Oříznout",
      extend: "Prodloužit",
      "linear-dim": "Lineární kóta",
      "aligned-dim": "Zarovnaná kóta",
      radius: "Poloměrová kóta",
      "boolean-union": "Sjednotit",
      "boolean-subtract": "Odečíst",
      "boolean-intersect": "Průnik",
      array: "Pole",
      group: "Seskupit",
      ungroup: "Rozdělit skupinu",
    };
    static hints = {
      select:
        "Kliknutí: výběr · Shift: přidat · Rámeček zleva: uvnitř, zprava: křížení · Alt: jednotlivý objekt",
      move: "Základní bod → cílový bod · Tab: ΔX / ΔY · Ctrl: kopie",
      copy: "Základní bod → cílový bod · Tab: ΔX / ΔY",
      eraser: "Kliknutí nebo rámeček: smazat · Escape: výběr · Z: vrátit změnu",
      offset: "Najeďte na obrys, zvolte stranu a klikněte · Tab: vzdálenost",
      measure: "Dva body nebo kliknutí na hranu · Escape: zrušit měření",
      array: "Vyberte objekty, zadejte počty a rozteče a potvrďte Použít.",
      group: "Shift + klik přidá objekt. Nastavte název a potvrďte Použít.",
      fillet: "Roh obrysu nebo dvě úsečky.",
      chamfer: "Roh obrysu nebo dvě úsečky.",
      leader: "Cíl → zalomení → vodorovný praporek.",
      "handle-arc": "Začátek → konec → úchyt.",
      arc: "Začátek → konec → vytáhnout oblouk ze středu · Enter: potvrdit",
      detail: "Střed → poloměr oblasti → umístění detailu.",
      grain: "Dílec a začátek šipky → konec šipky.",
      break: "Úsečka a začátek mezery → konec mezery.",
      gaps: "Kliknutím obnovíte kontrolu. Červené značky nejsou exportované.",
    };
  }
  J.ToolSystem = {
    ToolSystem,
    CADTool,
    LegacyCADTool,
    FilletTool,
    ChamferTool,
    GapCheckerTool,
    DetailTool,
    LeaderTool,
    GrainTool,
    HandleArcTool,
    TransformTool: J.Tools.TransformTool,
    EraserTool: J.Tools.EraserTool,
    OffsetTool: J.Tools.OffsetTool,
    MeasureTool: J.Tools.MeasureTool,
  };
})((globalThis.Joinery = globalThis.Joinery || {}));
