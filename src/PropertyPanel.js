(function (J) {
  const G = J.Geometry,
    esc = (s) => J.Woodworking.escapeHTML(s),
    kinds = () => [{ id: "", name: "Neurčeno" }, ...J.Materials.kinds];
  class PropertyPanel {
    constructor(app) {
      this.app = app;
      this.root = document.getElementById("object-properties");
    }
    render() {
      const a = this.app,
        list = a.editableSelection(),
        s = a.project.settings,
        e = list[0],
        spec = e?.part || e;
      document.getElementById("selection-badge").textContent = list.length
        ? `${list.length} vybráno`
        : "Bez výběru";
      const input = (key, label, value, type = "number", extra = "") =>
        `<label>${label}<input data-property="${key}" type="${type}" value="${esc(value ?? "")}" ${type === "number" ? 'step="any"' : ""} ${extra}></label>`;
      const select = (key, label, value, options) =>
        `<label>${label}<select data-property="${key}">${options.map((o) => `<option value="${esc(o.id)}" ${o.id === value ? "selected" : ""}>${esc(o.name)}</option>`).join("")}</select></label>`;
      const category = (label, body) =>
        `<details class="property-category" open><summary>${label}</summary><div class="property-fields">${body}</div></details>`;
      const layers = a.project.layers.map((l) => ({ id: l.id, name: l.name }));
      let html = "";
      if (!list.length) {
        html =
          category(
            "Výkres",
            select("activeLayer", "Aktivní vrstva", a.activeLayer, layers) +
              input("drawingScale", "Měřítko 1:", s.drawingScale || 10) +
              input("gridSize", "Rozteč přichycení [mm]", s.gridSize) +
              select(
                "dimensionTextHeight",
                "Výška kót na papíře [mm]",
                s.dimensionTextHeight || 2.5,
                [2.5, 3.5, 5, 7].map((id) => ({ id, name: String(id) })),
              ) +
              select(
                "dimensionTermination",
                "Zakončení kót",
                s.dimensionTermination || "slash",
                [
                  { id: "slash", name: "Šikmé úsečky" },
                  { id: "open", name: "Otevřené šipky" },
                  { id: "filled", name: "Plné šipky" },
                ],
              ) +
              select(
                "units",
                "Jednotky",
                s.units,
                ["mm", "cm", "m", "in"].map((id) => ({ id, name: id })),
              ),
          ) +
          category(
            "Výchozí objekty",
            select(
              "defaultLineStyle",
              "Typ čáry",
              s.defaultLineStyle || "continuous",
              PropertyPanel.styles,
            ) +
              input(
                "defaultLineWeight",
                "Tloušťka čáry [mm]",
                s.defaultLineWeight || 0.35,
              ) +
              select(
                "defaultMaterialKind",
                "Materiál",
                s.defaultMaterialKind || "",
                kinds(),
              ),
          );
      } else {
        const shared = (key) =>
          list.every((x) => (x.part || x)[key] === (spec || {})[key])
            ? spec[key]
            : "";
        html = `<p class="inspector-count">${list.length === 1 ? esc(e.name || PropertyPanel.names[e.type] || e.type) : `${list.length} vybraných objektů`}</p>`;
        html += category(
          "Obecné",
          select(
            "layer",
            "Vrstva",
            list.every((x) => x.layer === e.layer) ? e.layer : "",
            layers,
          ) +
            input(
              "stroke",
              "Barva čáry",
              e.stroke ||
                (document.documentElement.dataset.theme === "light"
                  ? "#000000"
                  : "#ffffff"),
              "color",
            ) +
            select(
              "lineStyle",
              "Typ čáry",
              e.lineStyle || "continuous",
              PropertyPanel.styles,
            ) +
            input("lineWeight", "Tloušťka čáry [mm]", e.lineWeight || 0.35),
        );
        if (list.length === 1) {
          let geo = "";
          if (
            e.points &&
            [
              "line",
              "polyline",
              "rectangle",
              "panel",
              "leader",
              "text",
            ].includes(e.type)
          ) {
            geo +=
              input("x0", "X začátku [mm]", e.points[0].x) +
              input("y0", "Y začátku [mm]", e.points[0].y);
            if (e.type === "line")
              geo +=
                input("x1", "X konce [mm]", e.points[1].x) +
                input("y1", "Y konce [mm]", e.points[1].y) +
                input("length", "Délka [mm]", G.distance(...e.points)) +
                input(
                  "angle",
                  "Úhel [°]",
                  (G.angle(...e.points) * 180) / Math.PI,
                );
          }
          if (e.type === "detail")
            geo +=
              input("vx", "X pohledu [mm]", e.points[0].x) +
              input("vy", "Y pohledu [mm]", e.points[0].y) +
              input("detailScale", "Měřítko detailu 1 :", e.detailScale || 1);
          if (e.center)
            geo +=
              input(
                "cx",
                e.type === "detail" ? "X oblasti [mm]" : "X středu [mm]",
                e.center.x,
              ) +
              input(
                "cy",
                e.type === "detail" ? "Y oblasti [mm]" : "Y středu [mm]",
                e.center.y,
              ) +
              input("radius", "Poloměr [mm]", e.radius);
          if (["panel", "rectangle", "region", "polyline"].includes(e.type)) {
            const size = J.Model.panelSize(e);
            geo +=
              input("width", "Šířka polotovaru [mm]", size.width) +
              input("height", "Délka polotovaru [mm]", size.height);
          }
          if (e.type === "dimension")
            geo += select(
              "termination",
              "Zakončení kóty",
              e.termination || s.dimensionTermination || "slash",
              [
                { id: "slash", name: "Šikmá úsečka" },
                { id: "open", name: "Otevřená šipka" },
                { id: "filled", name: "Plná šipka" },
              ],
            );
          if (["text", "leader"].includes(e.type))
            geo += input("text", "Text", e.text, "text");
          if (geo) html += category("Geometrie", geo);
        }
        const manufacturable = list.every((x) =>
          ["panel", "rectangle", "polyline", "region"].includes(x.type),
        );
        let wood = select(
          "materialKind",
          "Značení materiálu",
          shared("materialKind") || "",
          kinds(),
        );
        if (manufacturable) {
          wood +=
            input("name", "Název", e.name || "", "text") +
            select("grain", "Směr vláken", spec.grain || "", [
              { id: "", name: "Není určeno" },
              { id: "long", name: "Podélně" },
              { id: "cross", name: "Napříč" },
            ]);
          if (J.BOMManager.BOMManager.edgeEligible(shared("materialKind")))
            wood += ["Spodní", "Pravá", "Horní", "Levá"]
              .map((name, i) =>
                select(
                  "edge" + i,
                  name + " hrana",
                  spec.edgeTypes?.[i] ||
                    (spec.banding?.[i] ? `ABS ${spec.banding[i]} mm` : ""),
                  [
                    { id: "", name: "Bez hrany" },
                    { id: "ABS 1 mm", name: "ABS 1 mm" },
                    { id: "ABS 2 mm", name: "ABS 2 mm" },
                    { id: "Dýha", name: "Dýha" },
                  ],
                ),
              )
              .join("");
        }
        html += category("Materiál a hrany", wood);
        if (list.length > 1)
          html +=
            '<div class="inspector-actions"><button data-inspector="group">Seskupit</button><button data-inspector="ungroup">Rozdělit skupinu</button></div>';
      }
      this.root.innerHTML = html;
      this.root.querySelectorAll("[data-property]").forEach((el) => {
        el.oninput = () => {
          if (el.type === "number" && (el.value === "" || !el.validity.valid))
            return;
          this.update(
            el.dataset.property,
            el.type === "checkbox"
              ? el.checked
              : el.type === "number"
                ? Number(el.value)
                : el.value,
          );
        };
      });
      this.root
        .querySelector('[data-inspector="group"]')
        ?.addEventListener("click", () => a.groupSelection());
      this.root
        .querySelector('[data-inspector="ungroup"]')
        ?.addEventListener("click", () => a.ungroupSelection());
    }
    update(key, value) {
      const a = this.app,
        focus = document.activeElement,
        selection = focus?.selectionStart,
        field = focus?.dataset.property;
      const defaultKeys = [
        "drawingScale",
        "gridSize",
        "units",
        "defaultLineWeight",
        "defaultLineStyle",
        "defaultMaterialKind",
        "dimensionTextHeight",
        "dimensionTermination",
      ];
      if (key === "activeLayer") {
        a.activeLayer = value;
        a.renderLayers();
        a.scheduleSave();
        return;
      }
      if (key === "dimensionTextHeight") value = Number(value);
      if (defaultKeys.includes(key)) {
        if (
          ["drawingScale", "gridSize", "defaultLineWeight"].includes(key) &&
          (!(value > 0) || value > 1e8)
        )
          return;
        a.commit(() => (a.project.settings[key] = value));
        a.renderSnap();
      } else
        a.commit(() => {
          for (const e of a.editableSelection()) {
            const spec = e.part || e;
            if (
              e.type === "detail" &&
              ["cx", "cy", "vx", "vy", "radius", "detailScale"].includes(key)
            ) {
              const GE = J.GeometryEngine.GeometryEngine;
              if (["radius", "detailScale"].includes(key)) {
                if (!(value > 0)) throw new Error("Hodnota musí být kladná.");
                const old = structuredClone(e);
                e[key] = value;
                if (key === "detailScale")
                  e.factor = a.project.settings.drawingScale / value;
                else
                  e.contents = GE.crop(
                    a.canvas.visibleEntities(),
                    e.center,
                    e.radius,
                  );
                GE.relocateDetailDimensions(e, old, a.project.entities);
              } else {
                const source = key[0] === "c",
                  axis = key[1],
                  base = source ? e.center : e.points[0];
                const delta = { x: 0, y: 0 };
                delta[axis] = value - base[axis];
                GE.moveDetail(e, delta, source ? "source" : "view", a.project);
              }
            } else if (["x0", "y0", "cx", "cy"].includes(key)) {
              const base = key[0] === "c" ? e.center : e.points[0],
                axis = key.includes("x") ? "x" : "y",
                delta = { x: 0, y: 0 };
              delta[axis] = value - base[axis];
              Object.assign(
                e,
                G.transformEntity(e, (p) => G.add(p, delta)),
              );
            } else if (key === "x1" || key === "y1")
              e.points[1][key[0]] = value;
            else if (key === "length" || key === "angle") {
              if (key === "length" && value <= 0)
                throw new Error("Délka musí být kladná.");
              const theta =
                  key === "angle"
                    ? (value * Math.PI) / 180
                    : G.angle(...e.points),
                length = key === "length" ? value : G.distance(...e.points);
              e.points[1] = G.add(e.points[0], {
                x: Math.cos(theta) * length,
                y: Math.sin(theta) * length,
              });
            } else if (key === "width" || key === "height") {
              if (value <= 0) throw new Error("Rozměr musí být kladný.");
              const pts = e.stockPoints || e.points;
              if (!pts?.length || pts.length < 4)
                throw new Error("Nejprve přiřaďte polotovar.");
              const base = pts[0],
                u = G.unit(G.sub(pts[1], base)),
                v = G.unit(G.sub(pts[3], base)),
                old =
                  key === "width"
                    ? G.distance(base, pts[1])
                    : G.distance(base, pts[3]),
                f = value / old;
              Object.assign(
                e,
                G.transformEntity(e, (p) => {
                  const d = G.sub(p, base),
                    x = G.dot(d, u),
                    y = G.dot(d, v);
                  return G.add(
                    base,
                    G.add(
                      G.mul(u, x * (key === "width" ? f : 1)),
                      G.mul(v, y * (key === "height" ? f : 1)),
                    ),
                  );
                }),
              );
            } else if (key.startsWith("edge")) {
              const i = Number(key.slice(4));
              spec.banding ||= [0, 0, 0, 0];
              spec.edgeTypes ||= ["", "", "", ""];
              spec.edgeTypes[i] = value;
              spec.banding[i] = value === "ABS 2 mm" ? 2 : value ? 1 : 0;
            } else if (key === "materialKind") {
              spec.materialKind = value;
              if (!J.BOMManager.BOMManager.edgeEligible(value)) {
                spec.banding = [0, 0, 0, 0];
                spec.edgeTypes = ["", "", "", ""];
              }
            } else if (key === "cutListEnabled") {
              if (value && e.type === "region" && !e.part) {
                const b = G.bounds([e]);
                e.stockPoints = [
                  b.min,
                  { x: b.max.x, y: b.min.y },
                  b.max,
                  { x: b.min.x, y: b.max.y },
                ];
                e.part = {
                  thickness: e.thickness || 18,
                  quantity: e.quantity || 1,
                  material: e.material || "Neuvedeno",
                  materialKind: e.materialKind || "",
                  materialClass: e.materialClass || "",
                  banding: [0, 0, 0, 0],
                };
              }
              e.cutListEnabled = value;
            } else if (["thickness", "quantity"].includes(key)) {
              if (
                value <= 0 ||
                (key === "quantity" && !Number.isInteger(value))
              )
                throw new Error("Zadejte kladný rozměr nebo celý počet.");
              spec[key] = value;
            } else if (key === "grain") {
              spec.grain = value;
              if (!value) delete e.grainVector;
              else {
                const pts = e.stockPoints || e.points;
                if (pts?.length >= 4) {
                  const size = J.Model.panelSize(e),
                    axis =
                      size.width >= size.height
                        ? G.unit(G.sub(pts[1], pts[0]))
                        : G.unit(G.sub(pts[3], pts[0])),
                    dir = value === "long" ? axis : G.perpendicular(axis),
                    center = G.midpoint(pts[0], pts[2]),
                    span = Math.min(size.width, size.height) * 0.3;
                  e.grainVector = [
                    G.add(center, G.mul(dir, -span)),
                    G.add(center, G.mul(dir, span)),
                  ];
                }
              }
            } else if (["material", "materialClass"].includes(key))
              spec[key] = value;
            else e[key] = value;
          }
        });
      const next = this.root.querySelector(`[data-property="${field}"]`);
      if (next) {
        next.focus();
        if (
          selection != null &&
          next.type !== "number" &&
          next.type !== "color"
        )
          try {
            next.setSelectionRange(selection, selection);
          } catch {}
      }
    }
    static styles = [
      { id: "continuous", name: "Plná čára" },
      { id: "dashed", name: "Přerušovaná čára" },
      { id: "dashdot", name: "Čerchovaná čára" },
    ];
    static names = {
      panel: "Dílec",
      line: "Úsečka",
      polyline: "Lomená čára",
      rectangle: "Obdélník",
      circle: "Kružnice",
      arc: "Oblouk",
      region: "Obrys",
      dimension: "Kóta",
      leader: "Odkazová kóta",
      detail: "Detail",
    };
  }
  J.PropertyPanel = { PropertyPanel };
})((globalThis.Joinery = globalThis.Joinery || {}));
