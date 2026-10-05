/** A workspace, not a blocking modal. Paper coordinates and hit testing use mm. */
(function (J) {
  const PDF = J.PDFExporter.PDFExporter,
    esc = J.Woodworking.escapeHTML;
  class SheetComposer {
    constructor(app) {
      this.app = app;
      this.root = document.createElement("section");
      this.root.id = "sheet-composer";
      this.root.hidden = true;
      document.querySelector("main").append(this.root);
      this.pageIndex = 0;
      this.zoom = 2;
      this.selected = null;
      this.version = 0;
      this.boundResize = () => {
        if (!this.root.hidden) this.renderCanvas();
      };
      window.addEventListener("resize", this.boundResize);
    }
    async open() {
      document.getElementById("app-dialog").close();
      this.app.closeExportMenu();
      this.app.toolSystem.closeMenus();
      document.body.classList.add("print-preview");
      this.layout = structuredClone(
        this.app.project.settings.sheetLayout ||
          PDF.defaultLayout(this.app.project),
      );
      try {
        PDF.validateLayout(this.layout);
      } catch {
        this.layout = PDF.defaultLayout(this.app.project);
      }
      this.pageIndex = Math.min(this.pageIndex, this.layout.pages.length - 1);
      document.getElementById("design-view").hidden = true;
      document.getElementById("cutlist-view").hidden = true;
      document.querySelector(".inspector-sidebar").hidden = true;
      this.root.hidden = false;
      if (!this.fontLoaded) {
        try {
          const font = new FontFace(
            "Blueprint",
            `url(data:font/ttf;base64,${J.PdfFontData})`,
          );
          await font.load();
          document.fonts.add(font);
          this.fontLoaded = true;
        } catch {}
      }
      this.render();
    }
    close() {
      document.body.classList.remove("print-preview");
      this.save();
      this.root.hidden = true;
      document.querySelector(".inspector-sidebar").hidden = false;
      this.app.setTab("design");
    }
    save() {
      this.app.project.settings.sheetLayout = structuredClone(this.layout);
      this.app.scheduleSave();
    }
    page() {
      return this.layout.pages[this.pageIndex];
    }
    render() {
      this.root.innerHTML = `<div class="composer-bar"><strong>Tiskové listy</strong><select id="composer-pages" aria-label="Aktivní tiskový list">${this.layout.pages.map((p, i) => `<option value="${i}" ${i === this.pageIndex ? "selected" : ""}>${i + 1}. ${p.kind === "bom" ? "Kusovník" : "Výkres"} · ${p.format}</option>`).join("")}</select><button id="add-drawing-sheet">+ Výkres</button><button id="add-bom-sheet">+ Kusovník</button><button id="remove-sheet">Odebrat list</button><label>Zvětšení <input id="composer-zoom" type="number" min="0.5" max="5" step="0.25" value="${this.zoom}"></label><button id="composer-download" class="primary-button">Stáhnout PDF</button><button id="composer-close">Zpět do výkresu</button></div><div class="composer-workspace"><aside id="composer-settings"></aside><div class="composer-scroll"><canvas id="sheet-canvas" aria-label="Náhled listu; tažením přesuňte pohled nebo razítko"></canvas></div></div>`;
      const el = (id) => document.getElementById(id);
      el("composer-pages").onchange = (e) => {
        this.pageIndex = +e.target.value;
        this.selected = null;
        this.render();
      };
      el("composer-close").onclick = () => this.close();
      el("composer-zoom").oninput = (e) => {
        if (+e.target.value >= 0.5 && +e.target.value <= 5) {
          this.zoom = +e.target.value;
          this.renderCanvas();
        }
      };
      el("add-drawing-sheet").onclick = () => {
        this.layout.pages.push(PDF.defaultLayout(this.app.project).pages[0]);
        this.pageIndex = this.layout.pages.length - 1;
        this.render();
      };
      el("add-bom-sheet").onclick = () => {
        this.layout.pages.push({
          id: J.Model.uid(),
          kind: "bom",
          format: "A5-L",
          views: [],
          stamp: null,
        });
        this.pageIndex = this.layout.pages.length - 1;
        this.render();
      };
      el("remove-sheet").disabled = this.layout.pages.length === 1;
      el("remove-sheet").onclick = () => {
        this.layout.pages.splice(this.pageIndex, 1);
        this.pageIndex = Math.max(0, this.pageIndex - 1);
        this.render();
      };
      el("composer-download").onclick = () => {
        try {
          const bytes = PDF.build(this.app.project, this.layout);
          J.Woodworking.download(
            bytes,
            (this.app.project.name || "vykres") + ".pdf",
            "application/pdf",
          );
          this.save();
          this.app.toast(
            "PDF staženo. Tiskněte ve skutečné velikosti (100 %).",
          );
        } catch (error) {
          this.app.toast(error.message);
        }
      };
      this.canvas = el("sheet-canvas");
      this.canvas.onpointerdown = (e) => this.pointerDown(e);
      this.canvas.onpointermove = (e) => this.pointerMove(e);
      this.canvas.onpointerup = (e) => this.pointerUp(e);
      this.canvas.onpointercancel = (e) => this.pointerUp(e);
      this.renderSettings();
      this.renderCanvas();
      this.save();
    }
    renderSettings() {
      const p = this.page(),
        s = this.selected,
        formats =
          p.kind === "bom" ? ["A5-L", "A4-P"] : ["A3-L", "A4-L", "A4-P"],
        names = {
          "A3-L": "A3 na šířku",
          "A4-L": "A4 na šířku",
          "A4-P": "A4 na výšku",
          "A5-L": "A5 na šířku",
        };
      let html = `<label>Formát listu<select id="sheet-format">${formats.map((id) => `<option value="${id}" ${p.format === id ? "selected" : ""}>${names[id]}</option>`).join("")}</select></label>`;
      if (p.kind === "drawing") {
        html +=
          '<p>Tažením přesuňte pohled, detail nebo razítko. Kliknutím zobrazíte jejich rozměry.</p><button id="add-viewport">+ Hlavní pohled</button>';
        const details = this.app.project.entities.filter(
          (e) => e.type === "detail",
        );
        if (details.length)
          html += `<label>Detail<select id="detail-to-place">${details.map((d) => `<option value="${esc(d.id)}">${esc(d.name || "Detail")}</option>`).join("")}</select></label><button id="add-detail-view">+ Umístit detail</button>`;
        if (s) {
          html +=
            `<h3>${s === p.stamp ? "Razítko" : s.type === "detail" ? "Detail" : "Pohled"}</h3>` +
            ["x", "y", "w", "h", ...(s.scale != null ? ["scale"] : [])]
              .map(
                (key) =>
                  `<label>${{ x: "X [mm]", y: "Y [mm]", w: "Šířka [mm]", h: "Výška [mm]", scale: "Měřítko 1:" }[key]}<input data-sheet-prop="${key}" type="number" step="any" value="${s[key]}"></label>`,
              )
              .join("");
          if (s !== p.stamp)
            html += '<button id="delete-viewport">Odebrat pohled</button>';
        }
        const t = this.app.project.settings.titleBlock || {};
        html +=
          "<details open><summary>Výkresové razítko</summary>" +
          [
            ["title", "Název výrobku", this.app.project.name],
            ["author", "Autor", ""],
            ["date", "Datum", new Date().toLocaleDateString("cs-CZ")],
            ["number", "Číslo výkresu", "001"],
            ["material", "Materiál", ""],
          ]
            .map(
              ([key, label, value]) =>
                `<label>${label}<input data-stamp="${key}" value="${esc(t[key] || value)}"></label>`,
            )
            .join("") +
          "<small>Měřítko se vyplní podle pohledů.</small></details>";
      } else
        html +=
          "<p>Kusovník má vlastní formát. Delší tabulka automaticky pokračuje na dalších listech stejného formátu.</p>";
      document.getElementById("composer-settings").innerHTML = html;
      document.getElementById("sheet-format").onchange = (e) => {
        p.format = e.target.value;
        const [w, h] = PDF.formats[p.format];
        for (const v of [...p.views, ...(p.stamp ? [p.stamp] : [])]) {
          v.w = Math.min(v.w, w - 20);
          v.h = Math.min(v.h, h - 20);
          v.x = Math.max(10, Math.min(v.x, w - 10 - v.w));
          v.y = Math.max(10, Math.min(v.y, h - 10 - v.h));
        }
        this.renderCanvas();
        this.renderSettings();
        this.save();
      };
      document.querySelectorAll("[data-sheet-prop]").forEach(
        (el) =>
          (el.oninput = () => {
            const n = Number(el.value),
              key = el.dataset.sheetProp;
            if (
              el.value === "" ||
              !Number.isFinite(n) ||
              (["w", "h", "scale"].includes(key) && n <= 0)
            )
              return;
            const old = s[key];
            s[key] = n;
            try {
              PDF.validateLayout(this.layout);
            } catch {
              s[key] = old;
              el.setAttribute("aria-invalid", "true");
              return;
            }
            el.setAttribute("aria-invalid", "false");
            this.renderCanvas();
            this.save();
          }),
      );
      document.querySelectorAll("[data-stamp]").forEach(
        (el) =>
          (el.oninput = () => {
            this.app.project.settings.titleBlock ||= {};
            this.app.project.settings.titleBlock[el.dataset.stamp] = el.value;
            this.renderCanvas();
            this.save();
          }),
      );
      document.getElementById("add-viewport")?.addEventListener("click", () => {
        const [w, h] = PDF.formats[p.format];
        p.views.push({
          id: J.Model.uid(),
          type: "drawing",
          x: 15,
          y: 15,
          w: w - 30,
          h: h - 80,
          scale: 10,
        });
        this.selected = p.views.at(-1);
        this.renderSettings();
        this.renderCanvas();
        this.save();
      });
      document
        .getElementById("add-detail-view")
        ?.addEventListener("click", () => {
          const id = document.getElementById("detail-to-place").value,
            d = this.app.project.entities.find((e) => e.id === id),
            size = Math.min(100, (2 * d.radius) / (d.detailScale || 1) + 12);
          p.views.push({
            id: J.Model.uid(),
            type: "detail",
            entityId: id,
            x: 15,
            y: 15,
            w: size,
            h: size + 8,
            scale: d.detailScale || 1,
          });
          this.selected = p.views.at(-1);
          this.renderSettings();
          this.renderCanvas();
          this.save();
        });
      document
        .getElementById("delete-viewport")
        ?.addEventListener("click", () => {
          p.views = p.views.filter((v) => v !== s);
          this.selected = null;
          this.renderSettings();
          this.renderCanvas();
          this.save();
        });
    }
    renderCanvas() {
      if (!this.canvas) return;
      try {
        const font = J.PdfFont.context(),
          page = this.page(),
          [w, h] = PDF.formats[page.format],
          commands = PDF.commands(this.app.project, page, font);
        PDF.renderCanvas(this.canvas, commands, w, h, font, this.zoom);
        const ctx = this.canvas.getContext("2d"),
          ratio = devicePixelRatio || 1;
        ctx.setTransform(this.zoom * ratio, 0, 0, this.zoom * ratio, 0, 0);
        ctx.setLineDash([2, 2]);
        ctx.lineWidth = 0.3;
        ctx.strokeStyle = "#777";
        if (page.kind === "drawing")
          for (const v of [
            ...page.views,
            ...(page.stamp ? [page.stamp] : []),
          ]) {
            ctx.strokeRect(v.x, v.y, v.w, v.h);
            if (v === this.selected) {
              ctx.setLineDash([]);
              ctx.strokeStyle = "#000";
              ctx.lineWidth = 0.6;
              ctx.strokeRect(v.x, v.y, v.w, v.h);
              ctx.strokeStyle = "#777";
              ctx.lineWidth = 0.3;
              ctx.setLineDash([2, 2]);
            }
          }
      } catch (error) {
        this.app.toast(error.message);
      }
    }
    pointer(e) {
      const r = this.canvas.getBoundingClientRect();
      return {
        x: (e.clientX - r.left) / this.zoom,
        y: (e.clientY - r.top) / this.zoom,
      };
    }
    pointerDown(e) {
      if (this.page().kind !== "drawing") return;
      const p = this.pointer(e),
        page = this.page();
      this.selected =
        [...page.views, ...(page.stamp ? [page.stamp] : [])]
          .reverse()
          .find(
            (v) =>
              p.x >= v.x && p.x <= v.x + v.w && p.y >= v.y && p.y <= v.y + v.h,
          ) || null;
      this.drag = this.selected
        ? { point: p, x: this.selected.x, y: this.selected.y }
        : null;
      this.canvas.setPointerCapture(e.pointerId);
      this.renderSettings();
      this.renderCanvas();
    }
    pointerMove(e) {
      if (!this.drag || !this.selected) return;
      const p = this.pointer(e),
        [w, h] = PDF.formats[this.page().format],
        s = this.selected;
      s.x = Math.max(
        0,
        Math.min(w - s.w, this.drag.x + p.x - this.drag.point.x),
      );
      s.y = Math.max(
        0,
        Math.min(h - s.h, this.drag.y + p.y - this.drag.point.y),
      );
      this.renderCanvas();
    }
    pointerUp() {
      if (this.drag) {
        this.drag = null;
        this.renderSettings();
        this.save();
      }
    }
  }
  J.SheetComposer = { SheetComposer };
})((globalThis.Joinery = globalThis.Joinery || {}));
