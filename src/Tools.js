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
    ["panel", "Dílec", "P"],
    ["circle", "Kružnice", "O"],
    ["arc", "Oblouk třemi body", "A"],
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
  ];
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
      this.points = [];
      this.app.canvas.preview = [];
      this.app.canvas.snap = null;
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
      const s = this.app.project.settings,
        base = this.points.at(-1),
        result = snapPoint(p, this.app.canvas.visibleEntities(), {
          tolerance: 9 / this.app.canvas.zoom,
          grid: s.grid,
          gridSize: s.gridSize,
          object: s.object,
          base,
          ortho:
            (s.ortho || e.shiftKey) &&
            ["line", "polyline", "move", "copy", "slot"].includes(
              this.active,
            ),
          modes: s.snapModes || {},
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
      return result;
    }
    move(p, e = {}) {
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
        this.trimExtend(raw, this.active);
        return;
      }
      if (
        ["move", "copy", "mirror"].includes(this.active) &&
        !a.selection.size
      ) {
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
          const hit = canvas.pick(raw);
          if (!hit || !["circle", "drill", "arc"].includes(hit.type)) {
            a.toast("Vyberte kružnici, otvor nebo oblouk.");
            return;
          }
          this.target = hit;
          this.points = [hit.center];
          a.updateToolUI();
          return;
        }
        a.add([
          {
            type: "radius",
            center: this.target.center,
            radius: this.target.radius,
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
        ["rectangle", "circle", "slot", "move", "copy", "mirror"].includes(
          this.active,
        )
      ) {
        if (!base) {
          if (this.active === "rectangle" && positive(o.rectWidth, o.rectHeight)) {
            const w = +o.rectWidth,
              h = +o.rectHeight;
            const pts = [
              p,
              { x: p.x + w, y: p.y },
              { x: p.x + w, y: p.y + h },
              { x: p.x, y: p.y + h },
            ];
            a.add([{ type: "rectangle", points: pts, closed: true, cutListEnabled: false }]);
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
          a.add([{ type: "rectangle", points: pts, closed: true, cutListEnabled: false }]);
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
        if (["move", "copy", "mirror"].includes(this.active)) {
          const fn =
            this.active === "mirror"
              ? (q) => sub(mul(projectPoint(q, base, p, false), 2), q)
              : (q) => add(q, sub(p, base));
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
            } else
              selected.forEach((entity) =>
                Object.assign(entity, transformEntity(entity, fn)),
              );
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
        this.points.push(p);
        if (this.points.length === 3) {
          if (distance(this.points[0], this.points[1]) > 0.001)
            a.add([
              {
                type: "dimension",
                points: [...this.points],
                mode: o.dimensionMode,
              },
            ]);
          this.points = [];
        }
        a.updateToolUI();
        this.preview();
        return;
      }
      if (this.active === "angle") {
        this.points.push(p);
        if (this.points.length === 3) {
          if (
            distance(this.points[0], this.points[1]) > 0.001 &&
            distance(this.points[0], this.points[2]) > 0.001
          )
            a.add([{ type: "angle", points: [...this.points] }]);
          this.points = [];
        }
        a.updateToolUI();
        this.preview();
      }
    }
    finish(close = false) {
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
            ...(close ? { thickness: 18, quantity: 1, banding: [0, 0, 0, 0], cutListEnabled: false } : {}),
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
      if (this.active === "rectangle" && positive(o.rectWidth, o.rectHeight) && !base) {
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
            });
          else addPreview({ type: "line", points: [base, p] });
        }
        if (this.active === "angle") {
          if (this.points.length === 2)
            addPreview({ type: "angle", points: [...this.points, p] });
          else addPreview({ type: "line", points: [base, p] });
        }
        if (this.active === "radius" && this.target)
          addPreview({
            type: "radius",
            center: this.target.center,
            radius: this.target.radius,
            points: [p],
          });
        if (["move", "copy", "mirror"].includes(this.active)) {
          const fn =
            this.active === "mirror"
              ? (q) => sub(mul(projectPoint(q, base, p, false), 2), q)
              : (q) => add(q, sub(p, base));
          for (const entity of this.app.editableSelection())
            preview.push(transformEntity(entity, fn));
          addPreview({ type: "line", points: [base, p] });
        }
      }
      this.app.canvas.preview = preview;
      this.app.canvas.invalidate();
    }
    trimExtend(p, mode) {
      const a = this.app,
        e = a.canvas.pick(p);
      if (!e || e.type !== "line") {
        a.toast("Klikněte na úsečku poblíž upravovaného konce.");
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
        .flatMap(segments)
        .map((s) => intersection(origin, target, ...s, true, false))
        .filter(Boolean);
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
                ? "Vyberte bod na oblouku"
                : "Vyberte konec oblouku",
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
          mirror: n
            ? "Vyberte druhý bod osy zrcadlení"
            : "Vyberte první bod osy zrcadlení",
          trim: "Vyberte úsečku u ořezávaného konce",
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

  Joinery.Tools = { DRAW_TOOLS, EDIT_TOOLS, Tools };
})((globalThis.Joinery = globalThis.Joinery || {}));
