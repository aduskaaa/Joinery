/** App: plain-script module. Loaded in dependency order by index.html. */
(function (Joinery) {
  "use strict";
  const { CanvasManager } = Joinery.CanvasManager;
  const { Tools, DRAW_TOOLS, EDIT_TOOLS } = Joinery.Tools;
  const {
    uid,
    groupMembers,
    regroupCopies,
    demoProject,
    emptyProject,
    normalizeBasicLayers,
    validateProject,
    panelSize,
    isPart,
    isInCutlist,
    partSpec,
    History,
  } = Joinery.Model;
  const {
    add,
    sub,
    mul,
    unit,
    perpendicular,
    distance,
    entityCenter,
    rotatePoint,
    transformEntity,
    offsetEntity,
    dimensionGeometry,
    angle,
    bounds,
  } = Joinery.Geometry;
  const { isBooleanShape, booleanPolygons, polygonArea } = Joinery.Boolean;
  const { measure, unitFactor, monochrome } = Joinery.Scene;
  const {
    escapeHTML: esc,
    cutList,
    bomSummary,
    materialConsumption,
    exportCSV,
    exportDXF,
    importDXF,
    exportSVG,
    exportPDF,
    download,
    jointGeometry,
  } = Joinery.Woodworking;
  function materialOptions(value = "") {
    return (
      `<option value="" ${!value ? "selected" : ""}>Bez značení</option>` +
      Joinery.Materials.kinds
        .map(
          (p) =>
            `<option value="${p.id}" ${p.id === value ? "selected" : ""}>${esc(p.name)}</option>`,
        )
        .join("")
    );
  }
  const terminationOptions = (value) =>
    [
      { id: "slash", name: "Šikmé úsečky" },
      { id: "filled", name: "Plné šipky" },
      { id: "open", name: "Otevřené šipky" },
    ]
      .map(
        (p) =>
          `<option value="${p.id}" ${p.id === value ? "selected" : ""}>${p.name}</option>`,
      )
      .join("");
  const $ = (id) => document.getElementById(id),
    icon = (name) => `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`,
    STORAGE = "joinery-project-v1";
  class App {
    constructor() {
      this.project = emptyProject();
      this.selection = new Set();
      this.history = new History();
      this.activeLayer = this.project.layers[0].id;
      this.timer = null;
      this.tab = "design";
      this.booleanOptions = { keepCutters: false, tolerance: 0.01 };
      this.booleanPending = null;
      let loadMessage = "";
      try {
        const saved = localStorage.getItem(STORAGE);
        if (saved)
          this.project = normalizeBasicLayers(
            validateProject(JSON.parse(saved)),
          );
        document.documentElement.dataset.theme =
          localStorage.getItem("joinery-theme") || "dark";
      } catch {
        loadMessage =
          "Uložený projekt nelze načíst. Obnovte jej ze zálohy projektu.";
      }
      this.canvas = new CanvasManager($("cad-canvas"), () => this.project, {
        click: (p, e) => this.tools.click(p, e),
        move: (p, e) => this.tools.move(p, e),
        dragEnd: (p, e) => this.tools.dragEnd?.(p, e),
        cancel: () => this.tools.cancel(),
        viewChanged: () => {
          this.updateZoom();
          this.scheduleSave();
        },
        gridChanged: (n) => {
          $("grid-spacing").textContent =
            `Mřížka ${measure(n, this.project.settings.units)} ${this.project.settings.units}`;
        },
      });
      this.tools = new Tools(this);
      this.bind();
      Joinery.Tooltips.install();
      this.render();
      this.canvas.restore(this.project.view);
      this.updateToolUI();
      if (loadMessage) setTimeout(() => this.toast(loadMessage), 300);
      // A narrow debugging surface makes automation possible without introducing globals in modules.
      window.joinery = this;
    }
    panels() {
      return this.project.entities.filter((e) => isInCutlist(e));
    }
    editableSelection() {
      // Never transform only the unlocked/visible fragment of a group.
      const blocked = new Set(
        this.project.entities
          .filter((e) => {
            const l = this.project.layers.find((l) => l.id === e.layer);
            return l?.locked || l?.visible === false;
          })
          .map((e) => e.groupId)
          .filter(Boolean),
      );
      const entities = new Map(this.project.entities.map((e) => [e.id, e]));
      return [...this.selection]
        .map((id) => entities.get(id))
        .filter(
          (e) =>
            e &&
            !blocked.has(e.groupId) &&
            !this.project.layers.find((l) => l.id === e.layer)?.locked &&
            this.project.layers.find((l) => l.id === e.layer)?.visible !==
              false,
        );
    }
    select(id, append = false, individual = false) {
      if (!append) this.selection.clear();
      if (id) {
        const members = individual
          ? this.project.entities.filter((e) => e.id === id)
          : groupMembers(this.project, id);
        const remove = append && this.selection.has(id);
        for (const member of members)
          remove
            ? this.selection.delete(member.id)
            : this.selection.add(member.id);
      }
      this.canvas.selected = this.selection;
      this.renderProperties();
      this.renderParts();
      if (this.tools.active.startsWith("boolean-")) this.updateToolUI();
      this.canvas.invalidate();
    }
    commit(fn) {
      const before = structuredClone(this.project);
      try {
        fn();
        if (this.project.entities.length > 20000)
          throw new Error("Výkres může obsahovat nejvýše 20 000 objektů.");
        this.project = validateProject(this.project);
        this.history.record(before);
        this.selection = new Set(
          [...this.selection].filter((id) =>
            this.project.entities.some((e) => e.id === id),
          ),
        );
        this.canvas.selected = this.selection;
        this.render();
        this.scheduleSave();
        this.canvas.invalidate();
        return true;
      } catch (error) {
        this.project = before;
        this.render();
        this.canvas.invalidate();
        this.toast(error.message);
        return false;
      }
    }
    add(entities) {
      const normalized = entities.map((e) => ({
        id: uid(),
        layer: this.activeLayer,
        ...e,
      }));
      for (const e of normalized) {
        const layer = this.project.layers.find((l) => l.id === e.layer);
        if (!layer || layer.locked || layer.visible === false) {
          this.toast("Před kreslením vyberte viditelnou a odemčenou vrstvu.");
          return false;
        }
      }
      return this.commit(() => {
        this.project.entities.push(...normalized);
      });
    }
    scheduleSave() {
      clearTimeout(this.timer);
      this.timer = setTimeout(() => this.save(), 350);
    }
    save() {
      this.project.view = this.canvas.view();
      try {
        localStorage.setItem(STORAGE, JSON.stringify(this.project));
        $("save-status").innerHTML = '<span class="status-dot"></span>Uloženo';
      } catch {
        $("save-status").textContent =
          "Úložiště není dostupné · uložte projekt";
      }
    }
    toast(message) {
      $("toast").textContent = Joinery.Errors.message(message);
      $("toast").classList.add("show");
      clearTimeout(this.toastTimer);
      this.toastTimer = setTimeout(
        () => $("toast").classList.remove("show"),
        4200,
      );
    }
    coordinates(p) {
      const u = this.project.settings.units,
        f = unitFactor(u);
      $("cursor-x").textContent = (p.x / f).toFixed(u === "m" ? 3 : 2);
      $("cursor-y").textContent = (p.y / f).toFixed(u === "m" ? 3 : 2);
      $("status-unit").textContent = u;
    }
    updateZoom() {
      if (!this.canvas) return;
      $("zoom-value").textContent = `${Math.round(this.canvas.zoom * 100)}%`;
    }
    bind() {
      for (const [id, name, key] of [...DRAW_TOOLS, ...EDIT_TOOLS]) {
        const b = document.createElement("button");
        b.className = "tool-button";
        b.dataset.tool = id;
        b.dataset.tooltip = `${name}${key ? ` (${key})` : ""}`;
        b.setAttribute("aria-label", b.dataset.tooltip);
        b.innerHTML = icon(id);
        b.onclick = () => this.chooseTool(id);
        $(
          EDIT_TOOLS.some((t) => t[0] === id)
            ? "editing-tools"
            : "drawing-tools",
        ).append(b);
      }
      document
        .querySelectorAll("[data-tab]")
        .forEach((b) => (b.onclick = () => this.setTab(b.dataset.tab)));
      $("view-cutlist").onclick = () => this.setTab("cutlist");
      $("theme").onclick = () => {
        const next =
          document.documentElement.dataset.theme === "dark" ? "light" : "dark";
        document.documentElement.dataset.theme = next;
        try {
          localStorage.setItem("joinery-theme", next);
        } catch {}
        document.querySelector('meta[name="theme-color"]').content =
          next === "dark" ? "#000000" : "#ffffff";
        this.renderLayers();
        this.canvas.invalidate();
      };
      $("fit").onclick = $("zoom-value").onclick = () => this.canvas.fit();
      $("zoom-in").onclick = () =>
        this.canvas.zoomAt(
          { x: this.canvas.width / 2, y: this.canvas.height / 2 },
          1.25,
        );
      $("zoom-out").onclick = () =>
        this.canvas.zoomAt(
          { x: this.canvas.width / 2, y: this.canvas.height / 2 },
          0.8,
        );
      $("units").onchange = (e) => {
        this.project.settings.units = e.target.value;
        this.coordinates(this.tools.pointer);
        this.canvas.invalidate();
        this.renderProperties();
        this.scheduleSave();
      };
      $("active-layer").onchange = (e) => {
        this.activeLayer = e.target.value;
        this.renderLayers();
      };
      for (const [id, key] of [
        ["snap-grid", "grid"],
        ["snap-object", "object"],
        ["snap-ortho", "ortho"],
      ])
        $(id).onclick = () => this.toggleSnap(key);
      const snapSpacing = $("grid-snap-spacing");
      snapSpacing.oninput = () => this.setGridSpacing(snapSpacing.value);
      snapSpacing.onchange = () => {
        if (!this.setGridSpacing(snapSpacing.value, true)) {
          snapSpacing.value = this.project.settings.gridSize;
          snapSpacing.removeAttribute("aria-invalid");
        }
      };
      snapSpacing.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          snapSpacing.blur();
        }
        if (e.key === "Escape") {
          snapSpacing.value = this.project.settings.gridSize;
          snapSpacing.removeAttribute("aria-invalid");
          snapSpacing.blur();
        }
      };
      $("snap-grid").oncontextmenu = (e) => {
        e.preventDefault();
        this.snapSettings();
      };
      $("snap-object").oncontextmenu = (e) => {
        e.preventDefault();
        this.snapSettings();
      };
      $("undo").onclick = () => this.undo();
      $("redo").onclick = () => this.undo(true);
      $("drafting-settings").onclick = () => this.draftingSettings();
      $("help").onclick = () => this.help();
      $("export").onclick = () => this.exportDialog();
      $("cutlist-csv").onclick = () => this.exportFile("csv");
      if ($("add-cutlist-item"))
        $("add-cutlist-item").onclick = () => this.addCustomCutlistItem();
      if ($("add-drawing-to-cutlist"))
        $("add-drawing-to-cutlist").onclick = () => this.addDrawingToCutlistDialog();
      $("project-title").ondblclick = (e) => {
        e.preventDefault();
        this.editProjectName();
      };
      $("project-title").onkeydown = (e) => {
        if (e.key === "Enter" || e.key === "F2") {
          e.preventDefault();
          this.editProjectName();
        }
      };
      $("add-layer").onclick = () =>
        this.formDialog(
          "Přidat vrstvu",
          [
            {
              name: "name",
              label: "Název vrstvy",
              value: "Nová vrstva",
              type: "text",
            },
            {
              name: "color",
              label: "Odstín šedé",
              value: "#cccccc",
              type: "select",
              options: ["#666666", "#999999", "#cccccc", "#eeeeee"],
            },
          ],
          (v) => {
            if (this.project.layers.length >= 100) {
              this.toast("Nejvýše 100 vrstev.");
              return;
            }
            this.commit(() => {
              const l = {
                id: uid(),
                name: v.name.trim() || "Nová vrstva",
                color: v.color,
                visible: true,
                locked: false,
              };
              this.project.layers.push(l);
              this.activeLayer = l.id;
            });
          },
          "Přidat vrstvu",
        );
      $("new-project").onclick = () =>
        this.dialog(
          "Nový výkres",
          `<p class="dialog-note" style="border:0;padding:0;margin:0">Projekt se ukládá v prohlížeči. Pro samostatnou zálohu zvolte Uložit projekt. Změnu lze vrátit.</p><div class="export-options" style="margin-top:20px"><button type="button" class="export-option" data-new="empty"><strong>Prázdný výkres</strong><span>Prázdný výkres s jednou vlastní vrstvou.</span></button><button type="button" class="export-option" data-new="demo"><strong>Ukázková skříň</strong><span>Dílce, otvory, drážka a kóty.</span></button></div>`,
          () => {
            document.querySelectorAll("[data-new]").forEach(
              (b) =>
                (b.onclick = () => {
                  this.commit(() => {
                    this.project = normalizeBasicLayers(
                      b.dataset.new === "demo" ? demoProject() : emptyProject(),
                    );
                    this.selection.clear();
                    this.activeLayer = this.project.layers[0].id;
                  });
                  this.tools.cancel();
                  this.canvas.fit();
                  $("app-dialog").close();
                }),
            );
          },
        );
      $("import").onclick = () => $("file-input").click();
      $("file-input").onchange = (e) => this.importFile(e.target.files[0]);
      $("dialog-close").onclick = () => $("app-dialog").close();
      $("app-dialog").addEventListener("close", () => this.releasePreview());
      $("app-dialog").addEventListener("click", (e) => {
        if (e.target === $("app-dialog")) {
          const r = $("app-dialog").getBoundingClientRect();
          if (
            e.clientX < r.left ||
            e.clientX > r.right ||
            e.clientY < r.top ||
            e.clientY > r.bottom
          )
            $("app-dialog").close();
        }
      });
      window.addEventListener("keydown", (e) => this.keydown(e));
      window.addEventListener("keyup", (e) => {
        if (e.code === "Space") {
          this.canvas.space = false;
          this.canvas.canvas.style.cursor = "crosshair";
        }
        if (e.key === "Shift")
          this.tools.move(this.tools.pointer, { shiftKey: false });
      });
      window.addEventListener("pagehide", () => this.save());
    }
    chooseTool(id) {
      this.setTab("design");
      if (id === "boolean") {
        this.booleanMenu();
        return;
      }
      this.tools.target = null;
      this.tools.set(id);
      this.renderLayers();
      $("active-layer").value = this.activeLayer;
      this.canvas.canvas.focus();
    }
    toggleSnap(key) {
      this.project.settings[key] = !this.project.settings[key];
      this.renderSnap();
      this.tools.move(this.tools.pointer, this.tools.lastEvent);
      this.scheduleSave();
    }
    setGridSpacing(value, reportError = false) {
      const n = Number(value);
      const valid =
        String(value).trim() !== "" &&
        Number.isFinite(n) &&
        n >= 0.01 &&
        n <= 100000000;
      $("grid-snap-spacing").setAttribute("aria-invalid", String(!valid));
      if (!valid) {
        if (reportError)
          this.toast("Rozteč musí být v rozsahu 0,01 až 100 000 000 mm.");
        return false;
      }
      this.project.settings.gridSize = n;
      this.tools.move(this.tools.pointer, this.tools.lastEvent);
      this.canvas.invalidate();
      this.scheduleSave();
      return true;
    }
    renderSnap() {
      $("grid-snap-spacing").value = this.project.settings.gridSize;
      $("grid-snap-spacing").removeAttribute("aria-invalid");
      for (const [id, key] of [
        ["snap-grid", "grid"],
        ["snap-object", "object"],
        ["snap-ortho", "ortho"],
      ]) {
        $(id).classList.toggle("active", this.project.settings[key]);
        $(id).setAttribute("aria-pressed", this.project.settings[key]);
      }
    }
    editProjectName() {
      const container = $("project-title");
      if (!container || container.querySelector("input")) return;
      const currentName = this.project.name;
      const input = document.createElement("input");
      input.type = "text";
      input.className = "project-title-input";
      input.value = currentName;
      input.maxLength = 120;
      input.setAttribute("aria-label", "Název projektu");

      container.replaceChildren(input);
      input.focus();
      input.select();

      let finished = false;
      const finish = (save) => {
        if (finished) return;
        finished = true;
        const trimmed = input.value.trim();
        const nextName = save && trimmed ? trimmed : currentName;
        container.textContent = nextName;
        if (save && trimmed && trimmed !== currentName) {
          this.commit(() => {
            this.project.name = trimmed;
          });
        }
      };

      input.onkeydown = (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          finish(true);
        } else if (e.key === "Escape") {
          e.preventDefault();
          finish(false);
        }
      };
      input.onblur = () => finish(true);
    }
    renderProjectTitle() {
      const container = $("project-title");
      if (!container || container.querySelector("input")) return;
      container.textContent = this.project.name;
    }
    render() {
      this.renderProjectTitle();

      $("units").value = this.project.settings.units;
      if (!this.project.layers.some((l) => l.id === this.activeLayer))
        this.activeLayer = this.project.layers[0].id;
      this.renderSnap();
      this.renderLayers();
      this.renderProperties();
      this.renderParts();
      this.renderCutlist();
      this.updateZoom();
      $("undo").disabled = !this.history.undoStack.length;
      $("redo").disabled = !this.history.redoStack.length;
      if (this.tools?.active.startsWith("boolean-")) this.updateToolUI();
    }
    renderLayers() {
      $("active-layer").innerHTML = this.project.layers
        .map(
          (l) =>
            `<option value="${esc(l.id)}">${esc(l.name)}${l.locked ? " 🔒" : ""}</option>`,
        )
        .join("");
      $("active-layer").value = this.activeLayer;
      $("layer-list").innerHTML = this.project.layers
        .map(
          (l) =>
            `<div class="layer-row"><span class="layer-swatch" style="background:${monochrome(l.color, document.documentElement.dataset.theme === "light")}"></span><button class="layer-name ${this.activeLayer === l.id ? "active" : ""}" data-layer="${esc(l.id)}">${esc(l.name)}</button><span class="layer-count">${this.project.entities.filter((e) => e.layer === l.id).length}</span><button class="small-icon" data-rename="${esc(l.id)}" title="Přejmenovat vrstvu" aria-label="Přejmenovat vrstvu ${esc(l.name)}">${icon("edit")}</button><button class="small-icon ${l.visible === false ? "off" : ""}" data-visible="${esc(l.id)}" title="${l.visible === false ? "Zobrazit" : "Skrýt"} ${esc(l.name)}" aria-label="Viditelnost vrstvy ${esc(l.name)}">${icon("eye")}</button><button class="small-icon ${l.locked ? "locked" : "off"}" data-lock="${esc(l.id)}" title="${l.locked ? "Odemknout" : "Zamknout"} ${esc(l.name)}" aria-label="Zámek vrstvy ${esc(l.name)}">${icon("lock")}</button></div>`,
        )
        .join("");
      document.querySelectorAll("[data-layer]").forEach(
        (b) =>
          (b.onclick = () => {
            this.activeLayer = b.dataset.layer;
            $("active-layer").value = this.activeLayer;
            this.renderLayers();
          }),
      );
      document.querySelectorAll("[data-layer]").forEach((b) => {
        b.dataset.tooltip = "Dvojklikem přejmenujete vrstvu";
        b.ondblclick = () => {
          const layer = this.project.layers.find(
            (l) => l.id === b.dataset.layer,
          );
          this.formDialog(
            "Přejmenovat vrstvu",
            [
              {
                name: "name",
                label: "Název vrstvy",
                value: layer.name,
                type: "text",
              },
            ],
            (v) =>
              this.commit(() => {
                layer.name = v.name.trim().slice(0, 120) || "Vrstva";
              }),
            "Přejmenovat",
          );
        };
      });
      document
        .querySelectorAll("[data-rename]")
        .forEach(
          (b) =>
            (b.onclick = () =>
              document
                .querySelector(`[data-layer="${CSS.escape(b.dataset.rename)}"]`)
                .ondblclick()),
        );
      document.querySelectorAll("[data-visible]").forEach(
        (b) =>
          (b.onclick = () =>
            this.commit(() => {
              const l = this.project.layers.find(
                (l) => l.id === b.dataset.visible,
              );
              l.visible = !l.visible;
              if (!l.visible)
                this.project.entities
                  .filter((e) => e.layer === l.id)
                  .forEach((e) => this.selection.delete(e.id));
            })),
      );
      document.querySelectorAll("[data-lock]").forEach(
        (b) =>
          (b.onclick = () =>
            this.commit(() => {
              const l = this.project.layers.find(
                (l) => l.id === b.dataset.lock,
              );
              l.locked = !l.locked;
            })),
      );
    }
    renderParts() {
      const parts = this.panels();
      $("part-count").textContent = parts.length;
      $("sidebar-part-count").textContent = parts.length;
      $("parts-list").innerHTML = parts.length
        ? parts
            .map((e, i) => {
              const { width, height } = panelSize(e),
                spec = partSpec(e);
              return `<button class="part-row ${this.selection.has(e.id) ? "active" : ""}" data-part="${esc(e.id)}"><span class="part-thumbnail">${icon("panel")}</span><span><strong>${esc(e.name)}</strong><small>${measure(height)} × ${measure(width)} × ${spec.thickness} mm</small></span><span class="part-quantity">×${spec.quantity}</span></button>`;
            })
            .join("")
        : '<p class="muted">Kusovník je prázdný. Pohledy na stejný dílec nemusí být výrobní dílce.</p>';
      document.querySelectorAll("[data-part]").forEach(
        (b) =>
          (b.onclick = () => {
            this.select(b.dataset.part);
            this.setTab("design");
          }),
      );
    }
    renderCutlist() {
      const consumption = materialConsumption(this.project);
      const s = bomSummary(this.project);
      const matBadges = consumption.materialSummary
        .map(
          (m) =>
            `<span class="material-chip"><strong>${esc(m.material)}</strong>: ${m.netArea} m² (${m.sheetsCount} ${m.sheetsCount === 1 ? "deska" : m.sheetsCount < 5 ? "desky" : "desek"})</span>`,
        )
        .join("");
      $("cutlist-summary").innerHTML = `
        <div><span>Celkový počet kusů</span><strong>${s.quantity}</strong></div>
        <div><span>Počet položek</span><strong>${s.parts}</strong></div>
        <div><span>Čistá plocha dílců</span><strong>${consumption.totalNetArea} m²</strong></div>
        <div><span>Spotřeba (prořez ${consumption.wasteFactor} %)</span><strong>${consumption.totalGrossArea} m²</strong></div>
        <div><span>Potřebné desky (${consumption.sheetWidth}×${consumption.sheetHeight})</span><strong>${consumption.sheetsCount} ks (${consumption.sheetsRequired})</strong></div>
        ${matBadges ? `<div class="material-breakdown-card"><span>Materiály</span><div class="material-chips">${matBadges}</div></div>` : ""}
      `;
      $("cutlist-table").innerHTML =
        consumption.items
          .map(
            (r) =>
              `<tr>
                <td>${esc(r.name)}<small>${r.partId}</small></td>
                <td>${r.length}</td>
                <td>${r.width}</td>
                <td>${r.thickness}</td>
                <td>${r.quantity}</td>
                <td>${esc(r.material)}</td>
                <td>${esc(Joinery.Materials.kind(r.materialKind)?.name || "—")}</td>
                <td>${esc(r.edgeBanding)}</td>
                <td>${r.pieceNet} m² <small>(${r.pieceShare} %)</small></td>
                <td><strong>${r.rowNet} m²</strong></td>
                <td>
                  <div class="row-actions">
                    ${
                      r.custom
                        ? `<button type="button" class="table-action-btn edit-custom" data-id="${esc(r.id)}" title="Upravit">✎</button>`
                        : `<button type="button" class="table-action-btn show-in-drawing" data-id="${esc(r.id)}" title="Zobrazit ve výkresu">👁</button>`
                    }
                    <button type="button" class="table-action-btn delete-cutlist-item" data-id="${esc(r.id)}" data-custom="${r.custom ? "true" : "false"}" title="Odebrat z kusovníku">🗑</button>
                  </div>
                </td>
              </tr>`,
          )
          .join("") ||
        '<tr><td colspan="11" class="muted">Kusovník je prázdný. Klikněte na „+ Ruční položka“ nebo „+ Přidat z výkresu“.</td></tr>';

      document.querySelectorAll(".edit-custom").forEach((btn) => {
        btn.onclick = () => this.editCustomCutlistItem(btn.dataset.id);
      });
      document.querySelectorAll(".show-in-drawing").forEach((btn) => {
        btn.onclick = () => {
          this.setTab("design");
          this.select(btn.dataset.id);
          this.canvas?.invalidate();
        };
      });
      document.querySelectorAll(".delete-cutlist-item").forEach((btn) => {
        btn.onclick = () => {
          this.removeCutlistItem(btn.dataset.id, btn.dataset.custom === "true");
        };
      });
    }
    removeCutlistItem(id, isCustom) {
      this.commit(() => {
        if (isCustom) {
          this.project.customCutlist = (this.project.customCutlist || []).filter(
            (c) => c.id !== id,
          );
        } else {
          const e = this.project.entities.find((q) => q.id === id);
          if (e) {
            e.cutListEnabled = false;
          }
        }
      });
      this.toast("Položka byla odebrána z kusovníku.");
      this.renderCutlist();
      this.renderParts();
      this.renderProperties();
    }
    addDrawingToCutlistDialog() {
      const eligible = (this.project.entities || []).filter(
        (e) =>
          ["panel", "rectangle", "polyline", "region"].includes(e.type) &&
          (e.closed || e.type === "panel" || e.type === "rectangle" || e.type === "region") &&
          !isInCutlist(e),
      );
      if (!eligible.length) {
        this.dialog(
          "Přidat z výkresu do kusovníku",
          '<p class="dialog-note">Ve výkresu nejsou žádné další nezařazené objekty. Všechny vhodné plochy již v kusovníku jsou, nebo můžete přidat ruční položku tlačítkem „+ Ruční položka“.</p>',
          () => {},
          '<button type="button" class="primary-button" onclick="document.getElementById(\'app-dialog\').close()">Rozumím</button>',
        );
        return;
      }
      const html = `
        <p class="dialog-note">Vyberte objekt z výkresu pro zařazení do kusovníku výrobních dílců:</p>
        <div class="drawing-candidates-list">
          ${eligible
            .map((e) => {
              const s = panelSize(e);
              const layer = this.project.layers.find((l) => l.id === e.layer)?.name || "Vrstva";
              return `
                <div class="candidate-row">
                  <div class="candidate-info">
                    <strong>${esc(e.name || (e.type === "panel" ? "Dílec" : "Objekt"))}</strong>
                    <small>${measure(s.width)} × ${measure(s.height)} mm · ${esc(layer)}</small>
                  </div>
                  <button type="button" class="primary-button small candidate-add-btn" data-id="${esc(e.id)}">+ Přidat</button>
                </div>
              `;
            })
            .join("")}
        </div>
      `;
      this.dialog("Přidat z výkresu do kusovníku", html, () => {
        document.querySelectorAll(".candidate-add-btn").forEach((btn) => {
          btn.onclick = () => {
            const id = btn.dataset.id;
            const entity = this.project.entities.find((q) => q.id === id);
            if (entity) {
              this.commit(() => {
                entity.cutListEnabled = true;
                if (!entity.thickness && !entity.part?.thickness) entity.thickness = 18;
                if (!entity.quantity && !entity.part?.quantity) entity.quantity = 1;
                if (!entity.material && !entity.part?.material) entity.material = "Lamino";
                if (!entity.banding && !entity.part?.banding) entity.banding = [0, 0, 0, 0];
                if (!entity.name) entity.name = "Dílec";
              });
              this.toast(`Dílec „${entity.name}“ byl zařazen do kusovníku.`);
              $("app-dialog").close();
              this.renderCutlist();
              this.renderParts();
              this.renderProperties();
            }
          };
        });
      });
    }
    addCustomCutlistItem() {
      this.formDialog(
        "Přidat dílec do kusovníku",
        [
          { name: "name", label: "Název dílce", value: "Dílec", type: "text" },
          { name: "length", label: "Délka (mm)", value: 600 },
          { name: "width", label: "Šířka (mm)", value: 400 },
          { name: "thickness", label: "Tloušťka (mm)", value: 18 },
          { name: "quantity", label: "Počet kusů", value: 1 },
          { name: "material", label: "Popis materiálu / dekor", value: "Lamino", type: "text" },
          {
            name: "materialKind",
            label: "Druh materiálu",
            value: "laminate",
            type: "select",
            options: [
              { value: "", label: "Bez značení" },
              ...Joinery.Materials.kinds.map((k) => ({ value: k.id, label: k.name })),
            ],
          },
          { name: "edgeBanding", label: "Ohranění (např. B:2mm T:2mm)", value: "", type: "text" },
        ],
        (values) =>
          this.commit(() => {
            this.project.customCutlist = this.project.customCutlist || [];
            this.project.customCutlist.push({
              id: uid(),
              name: values.name.trim() || "Dílec",
              length: Number(values.length) || 0,
              width: Number(values.width) || 0,
              thickness: Number(values.thickness) || 18,
              quantity: Number(values.quantity) || 1,
              material: values.material.trim() || "Neuvedeno",
              materialKind: values.materialKind || "",
              edgeBanding: values.edgeBanding.trim() || "—",
            });
            this.renderCutlist();
          }),
        "Přidat do kusovníku",
      );
    }
    editCustomCutlistItem(id) {
      const item = (this.project.customCutlist || []).find((c) => c.id === id);
      if (!item) return;
      this.formDialog(
        "Upravit položku kusovníku",
        [
          { name: "name", label: "Název dílce", value: item.name, type: "text" },
          { name: "length", label: "Délka (mm)", value: item.length },
          { name: "width", label: "Šířka (mm)", value: item.width },
          { name: "thickness", label: "Tloušťka (mm)", value: item.thickness },
          { name: "quantity", label: "Počet kusů", value: item.quantity },
          { name: "material", label: "Popis materiálu / dekor", value: item.material, type: "text" },
          {
            name: "materialKind",
            label: "Druh materiálu",
            value: item.materialKind || "",
            type: "select",
            options: [
              { value: "", label: "Bez značení" },
              ...Joinery.Materials.kinds.map((k) => ({ value: k.id, label: k.name })),
            ],
          },
          { name: "edgeBanding", label: "Ohranění (např. B:2mm T:2mm)", value: item.edgeBanding === "—" ? "" : item.edgeBanding, type: "text" },
        ],
        (values) =>
          this.commit(() => {
            Object.assign(item, {
              name: values.name.trim() || "Dílec",
              length: Number(values.length) || 0,
              width: Number(values.width) || 0,
              thickness: Number(values.thickness) || 18,
              quantity: Number(values.quantity) || 1,
              material: values.material.trim() || "Neuvedeno",
              materialKind: values.materialKind || "",
              edgeBanding: values.edgeBanding.trim() || "—",
            });
            this.renderCutlist();
          }),
        "Uložit změny",
      );
    }
    deleteCustomCutlistItem(id) {
      this.commit(() => {
        this.project.customCutlist = (this.project.customCutlist || []).filter(
          (c) => c.id !== id,
        );
        this.renderCutlist();
      });
    }
    renderProperties() {
      const entities = this.project.entities.filter((e) =>
        this.selection.has(e.id),
      );
      $("selection-badge").textContent = entities.length
        ? `${entities.length} vybráno`
        : "Bez výběru";
      if (!entities.length) {
        $("object-properties").innerHTML =
          `<div class="empty-properties">${icon("select")}<p>Vyberte objekt pro úpravu<br>rozměrů a materiálu.</p></div>`;
        return;
      }
      if (entities.length > 1) {
        $("object-properties").innerHTML =
          `<p class="muted">${entities.length} vybraných objektů. Lze přesunout, kopírovat, otočit, zrcadlit nebo vytvořit pole.</p>
          <div class="multi-cutlist-actions">
            <button type="button" id="multi-add-cutlist" class="secondary-button small">+ Přidat vybrané do kusovníku</button>
            <button type="button" id="multi-remove-cutlist" class="secondary-button small">✕ Odebrat vybrané z kusovníku</button>
          </div>
          <div class="inspector-actions"><button id="group-selected">Seskupit</button><button id="ungroup-selected">Rozdělit skupinu</button><button id="multi-edit">${icon("edit")}Upravit</button><button id="delete-selected">${icon("trash")}Smazat</button></div>`;
        const groupIds = new Set(entities.map((e) => e.groupId));
        const grouped = groupIds.size === 1 && !!entities[0].groupId;
        if (grouped)
          $("object-properties").insertAdjacentHTML(
            "afterbegin",
            `<p><strong>Skupina: ${esc(entities[0].groupName || "Skupina objektů")}</strong></p>`,
          );
        $("multi-add-cutlist").onclick = () => {
          this.commit(() => {
            for (const e of entities) {
              if (["panel", "rectangle", "polyline", "region"].includes(e.type)) {
                e.cutListEnabled = true;
                if (!e.thickness && !e.part?.thickness) e.thickness = 18;
                if (!e.quantity && !e.part?.quantity) e.quantity = 1;
                if (!e.material && !e.part?.material) e.material = "Lamino";
                if (!e.banding && !e.part?.banding) e.banding = [0, 0, 0, 0];
              }
            }
          });
          this.toast("Vybrané objekty byly zařazeny do kusovníku.");
          this.renderParts();
          this.renderCutlist();
        };
        $("multi-remove-cutlist").onclick = () => {
          this.commit(() => {
            for (const e of entities) {
              e.cutListEnabled = false;
            }
          });
          this.toast("Vybrané objekty byly odebrány z kusovníku.");
          this.renderParts();
          this.renderCutlist();
        };
        $("group-selected").onclick = () => this.groupSelection();
        $("ungroup-selected").disabled = !entities.some((e) => e.groupId);
        $("ungroup-selected").onclick = () => this.ungroupSelection();
        $("multi-edit").onclick = () => this.operations();
        $("delete-selected").onclick = () => this.deleteSelection();
        const eligible = entities.length >= 2 && entities.every(isBooleanShape);
        if (eligible) {
          $("object-properties").insertAdjacentHTML(
            "beforeend",
            `<div class="boolean-quick-actions"><button data-quick-boolean="union">Sjednotit</button><button data-quick-boolean="difference">Odečíst</button><button data-quick-boolean="intersection">Průnik</button></div><p class="muted">První vybraný objekt je základ odečítání. Operace zobrazí náhled.</p>`,
          );
          document
            .querySelectorAll("[data-quick-boolean]")
            .forEach(
              (b) =>
                (b.onclick = () =>
                  this.chooseTool(booleanToolName(b.dataset.quickBoolean))),
            );
        }
        return;
      }
      const e = entities[0],
        locked = this.project.layers.find((l) => l.id === e.layer)?.locked,
        type = e.type,
        canBeCutlist =
          ["panel", "rectangle", "polyline", "region"].includes(type) &&
          (e.closed || type === "panel" || type === "rectangle" || type === "region"),
        inCutlist = canBeCutlist && isInCutlist(e),
        part = inCutlist || isPart(e),
        spec = part ? partSpec(e) : null,
        anchor =
          e.center ||
          e.stockPoints?.[0] ||
          e.points?.[0] ||
          e.polygons?.[0]?.[0]?.[0],
        label = (name, value, field, kind = "number", suffix = "") =>
          `<label>${name}${suffix}<input data-prop="${field}" type="${kind}" value="${esc(value)}" ${kind === "number" ? 'step="0.01"' : ""} ${locked ? "disabled" : ""}></label>`;
      let html = `<div class="part-type">${icon(["panel", "rectangle", "circle", "arc", "drill", "slot", "line", "dimension", "angle", "text"].includes(type) ? type : "polyline")}<div><strong>${esc(e.name || { region: "Plocha", cutout: "Výřez", radius: "Poloměrová kóta" }[type] || [...DRAW_TOOLS].find((t) => t[0] === type)?.[1] || "Objekt")}</strong><span>${locked ? "ZAMČENÁ VRSTVA · " : ""}${inCutlist ? "VÝROBNÍ DÍLEC V KUSOVNÍKU" : "VÝKRESOVÝ OBJEKT"} · mm</span></div></div><div class="property-form">`;
      if (canBeCutlist) {
        html += `
          <div class="cutlist-toggle-card">
            <div class="cutlist-badge ${inCutlist ? "badge-in" : "badge-out"}">
              <span class="status-dot"></span>
              <span>${inCutlist ? "Zařazeno v kusovníku" : "Není v kusovníku"}</span>
            </div>
            <button type="button" id="toggle-cutlist-action" class="${inCutlist ? "table-action-btn danger" : "primary-button small"}" ${locked ? "disabled" : ""}>
              ${inCutlist ? "✕ Odebrat z kusovníku" : "+ Přidat do kusovníku"}
            </button>
          </div>
        `;
      }
      html += label("Název", e.name || "", "name", "text");
      if (part) {
        const s = panelSize(e);
        html += `<div class="form-grid">${label(type === "region" ? "Šířka polotovaru" : "Šířka", measure(s.width), "width")}${label(type === "region" ? "Výška polotovaru" : "Výška", measure(s.height), "height")}</div><div class="form-grid">${label("Tloušťka", spec?.thickness ?? e.thickness ?? 18, "thickness")}${label("Počet", spec?.quantity ?? e.quantity ?? 1, "quantity")}</div>${label("Popis materiálu / dřevina / dekor", spec?.material || e.material || "", "material", "text")}<label>Druh materiálu / značení řezu<select data-prop="materialKind" ${locked ? "disabled" : ""}>${materialOptions(spec?.materialKind || e.materialKind)}</select></label>${(spec?.materialKind || e.materialKind) ? `<p class="material-class-note muted">${esc(Joinery.Materials.kind(spec?.materialKind || e.materialKind).note)}</p>` : ""}`;
      } else if (type === "rectangle" || (type === "polyline" && e.closed)) {
        const s =
          e.points && e.points.length === 4
            ? panelSize(e)
            : { width: bounds([e]).width, height: bounds([e]).height };
        html += `<div class="form-grid">${label("Šířka", measure(s.width), "width")}${label("Výška", measure(s.height), "height")}</div>`;
        html += `${label("Popis materiálu / dřevina / dekor", e.material || "", "material", "text")}<label>Druh materiálu / značení řezu<select data-prop="materialKind" ${locked ? "disabled" : ""}>${materialOptions(e.materialKind)}</select></label>${e.materialKind ? `<p class="material-class-note muted">${esc(Joinery.Materials.kind(e.materialKind).note)}</p>` : ""}`;
      }
      if (type === "region") {
        const holes = e.polygons.reduce(
          (count, polygon) => count + polygon.length - 1,
          0,
        );
        html += `<div class="region-metrics"><span>Plochy: ${e.polygons.length} · otvory: ${holes}</span><strong>${measure(polygonArea(e.polygons))} mm²</strong></div>`;
      }
      if (["circle", "drill", "arc"].includes(type))
        html += `<div class="form-grid">${label("Průměr", measure(e.radius * 2), "diameter")}${type === "drill" ? label("Hloubka", e.depth || 0, "depth") : label("Poloměr", measure(e.radius), "radius")}</div>`;
      if (type === "slot") html += label("Šířka drážky", e.width, "slotWidth");
      if (type === "cutout")
        html += label("Hloubka obrábění", e.depth || 0, "depth");
      if (type === "text")
        html +=
          label("Text", e.text, "text", "text") +
          label("Výška textu", e.size, "size") +
          `<label>Orientace textu<select data-prop="orientation" ${locked ? "disabled" : ""}><option value="horizontal" ${e.orientation !== "vertical" ? "selected" : ""}>Vodorovně (normálně)</option><option value="vertical" ${e.orientation === "vertical" ? "selected" : ""}>Svisle</option></select></label>`;
      if (type === "line")
        html += `<div class="form-grid">${label("Délka", measure(distance(...e.points)), "length")}${label("Úhel (°)", Number(((angle(...e.points) * 180) / Math.PI).toFixed(2)), "angle")}</div>`;
      if (type === "dimension") {
        const g = dimensionGeometry(e),
          dir = dimensionDirection(e),
          offset =
            (e.points[2].x - e.points[0].x) * -dir.y +
            (e.points[2].y - e.points[0].y) * dir.x;
        html += `<div class="form-grid">${label("Naměřená délka", measure(g.value), "readOnly")}${label("Odsazení", measure(offset), "dimensionOffset")}</div><label>Zakončení<select data-prop="termination">${terminationOptions(e.termination || this.project.settings.dimensionTermination || "slash")}</select></label>`;
      }
      html += `<div class="form-grid">${label("Poloha X", measure(anchor.x), "x")}${label("Poloha Y", measure(anchor.y), "y")}</div><label>Vrstva<select data-prop="layer" ${locked ? "disabled" : ""}>${this.project.layers.map((l) => `<option value="${esc(l.id)}" ${l.id === e.layer ? "selected" : ""} ${l.locked ? "disabled" : ""}>${esc(l.name)}</option>`).join("")}</select></label>`;
      if (e.groupId)
        html += `<p class="muted">Člen skupiny ${esc(e.groupName || "Skupina objektů")} · Alt + kliknutí vybere jeden člen.</p><button id="ungroup-member" class="text-button">Rozdělit skupinu</button>`;
      if (part && (spec?.banding || inCutlist)) {
        const banding = spec?.banding || e.banding || [0, 0, 0, 0];
        html += `<div><div class="edge-heading">Ohranění · kliknutí přepíná 0 / 1 / 2 mm</div><div class="edge-buttons">${["Dolní", "Pravá", "Horní", "Levá"].map((name, i) => `<button type="button" data-edge="${i}" class="${banding[i] ? "active" : ""}" ${locked ? "disabled" : ""}>${name}${banding[i] ? ` · ${banding[i]}` : ""}</button>`).join("")}</div></div>`;
      }
      html += `<div class="inspector-actions"><button id="inspect-edit" ${locked ? "disabled" : ""}>${icon("edit")}Úpravy</button><button id="delete-selected" ${locked ? "disabled" : ""}>${icon("trash")}Smazat</button></div>`;
      if (type === "region" && !part)
        html += `<button id="assign-region-part" class="text-button" ${locked ? "disabled" : ""}>Přiřadit polotovar <span>↗</span></button>`;
      html += "</div>";
      $("object-properties").innerHTML = html;
      document
        .querySelector('[data-prop="readOnly"]')
        ?.setAttribute("disabled", "");
      document
        .querySelectorAll("[data-prop]")
        .forEach(
          (input) =>
            (input.onchange = () =>
              this.changeProperty(e.id, input.dataset.prop, input.value)),
        );
      if ($("toggle-cutlist-action")) {
        $("toggle-cutlist-action").onclick = () => {
          this.commit(() => {
            if (inCutlist) {
              e.cutListEnabled = false;
            } else {
              e.cutListEnabled = true;
              if (!e.thickness && !e.part?.thickness) e.thickness = 18;
              if (!e.quantity && !e.part?.quantity) e.quantity = 1;
              if (!e.material && !e.part?.material) e.material = "Lamino";
              if (!e.banding && !e.part?.banding) e.banding = [0, 0, 0, 0];
              if (!e.name) e.name = "Dílec";
            }
          });
          this.toast(inCutlist ? "Objekt odebrán z kusovníku." : "Objekt zařazen do kusovníku.");
          this.renderProperties();
          this.renderParts();
          this.renderCutlist();
        };
      }
      document.querySelectorAll("[data-edge]").forEach(
        (b) =>
          (b.onclick = () =>
            this.commit(() => {
              const target = this.project.entities.find((q) => q.id === e.id),
                i = +b.dataset.edge;
              if (target.part) {
                target.part.banding = target.part.banding || [0, 0, 0, 0];
                target.part.banding[i] = { 0: 1, 1: 2, 2: 0 }[target.part.banding[i]] ?? 0;
              } else {
                target.banding = target.banding || [0, 0, 0, 0];
                target.banding[i] = { 0: 1, 1: 2, 2: 0 }[target.banding[i]] ?? 0;
              }
            })),
      );
      if ($("assign-region-part"))
        $("assign-region-part").onclick = () => this.assignRegionPart(e.id);
      if ($("ungroup-member"))
        $("ungroup-member").onclick = () => this.ungroupSelection();
      $("inspect-edit").onclick = () => this.operations();
      $("delete-selected").onclick = () => this.deleteSelection();
      if ($("convert-panel"))
        $("convert-panel").onclick = () =>
          this.commit(() => {
            if (type === "rectangle" || (type === "polyline" && e.points.length === 4)) {
              Object.assign(e, {
                type: "panel",
                name: e.name || "Převedený dílec",
                thickness: e.thickness || 18,
                material: e.material || "Dubová překližka",
                quantity: e.quantity || 1,
                banding: e.banding || [0, 0, 0, 0],
                closed: true,
              });
            } else {
              const b = bounds([e]);
              Object.assign(e, {
                type: "region",
                name: e.name || "Převedený dílec",
                polygons: [[e.points]],
                stockPoints: [
                  { x: b.min.x, y: b.min.y },
                  { x: b.max.x, y: b.min.y },
                  { x: b.max.x, y: b.max.y },
                  { x: b.min.x, y: b.max.y },
                ],
                part: {
                  thickness: e.thickness || 18,
                  material: e.material || "Dubová překližka",
                  ...(e.materialKind ? { materialKind: e.materialKind } : {}),
                  quantity: e.quantity || 1,
                  banding: [0, 0, 0, 0],
                },
              });
            }
          });
    }
    changeProperty(id, key, value) {
      const e = this.project.entities.find((q) => q.id === id);
      if (!e || this.project.layers.find((l) => l.id === e.layer)?.locked)
        return;
      const numeric = ![
          "name",
          "material",
          "materialClass",
          "materialKind",
          "termination",
          "text",
          "orientation",
          "layer",
        ].includes(key),
        n = Number(value);
      if (numeric && (!Number.isFinite(n) || Math.abs(n) > 1e7)) {
        this.toast("Zadejte platný rozměr.");
        this.renderProperties();
        return;
      }
      if (
        [
          "width",
          "height",
          "thickness",
          "quantity",
          "diameter",
          "radius",
          "slotWidth",
          "size",
          "length",
        ].includes(key) &&
        n <= 0
      ) {
        this.toast("Rozměr musí být větší než nula.");
        this.renderProperties();
        return;
      }
      if (key === "quantity" && !Number.isInteger(n)) {
        this.toast("Počet musí být celé číslo.");
        this.renderProperties();
        return;
      }
      this.commit(() => {
        if (key === "materialKind") {
          const spec = partSpec(e),
            previous = Joinery.Materials.kind(spec.materialKind)?.name;
          if (
            ["Oak plywood", "Dubová překližka", "Neuvedeno", previous].includes(
              spec.material,
            )
          )
            spec.material = Joinery.Materials.kind(value)?.name || "Neuvedeno";
        }
        if (key === "x" || key === "y") {
          const p =
              e.center ||
              e.stockPoints?.[0] ||
              e.points?.[0] ||
              e.polygons[0][0][0],
            delta = { x: 0, y: 0 };
          delta[key] = n - p[key];
          Object.assign(
            e,
            transformEntity(e, (q) => add(q, delta)),
          );
        } else if (key === "width" || key === "height") {
          const s = panelSize(e);
          if (e.type === "polyline" && e.points && e.points.length !== 4) {
            const bBox = bounds([e]);
            const curW = bBox.width || 1;
            const curH = bBox.height || 1;
            const w = key === "width" ? n : curW;
            const h = key === "height" ? n : curH;
            const scaleX = w / curW;
            const scaleY = h / curH;
            e.points = e.points.map((p) => ({
              x: bBox.min.x + (p.x - bBox.min.x) * scaleX,
              y: bBox.min.y + (p.y - bBox.min.y) * scaleY,
            }));
          } else if (e.type === "region") {
            const [a, b, , d] = e.stockPoints || e.points,
              w = key === "width" ? n : s.width,
              h = key === "height" ? n : s.height,
              x = unit(sub(b, a)),
              y = unit(sub(d, a));
            Object.assign(
              e,
              transformEntity(e, (q) => {
                const v = sub(q, a),
                  u = v.x * x.x + v.y * x.y,
                  t = v.x * y.x + v.y * y.y;
                return add(
                  a,
                  add(mul(x, (u * w) / s.width), mul(y, (t * h) / s.height)),
                );
              }),
            );
          } else {
            const [a, b, , d] = e.stockPoints || e.points,
              w = key === "width" ? n : s.width,
              h = key === "height" ? n : s.height,
              x = unit(sub(b, a)),
              y = unit(sub(d, a));
            e.points = [
              a,
              add(a, mul(x, w)),
              add(a, add(mul(x, w), mul(y, h))),
              add(a, mul(y, h)),
            ];
          }
        } else if (key === "diameter") e.radius = n / 2;
        else if (key === "slotWidth") e.width = n;
        else if (key === "length" || key === "angle") {
          const len = key === "length" ? n : distance(...e.points),
            ang = key === "angle" ? (n * Math.PI) / 180 : angle(...e.points);
          e.points[1] = add(e.points[0], {
            x: len * Math.cos(ang),
            y: len * Math.sin(ang),
          });
        } else if (key === "dimensionOffset")
          e.points[2] = add(
            e.points[0],
            mul(perpendicular(dimensionDirection(e)), n),
          );
        else if (
          e.type === "region" &&
          e.part &&
          [
            "thickness",
            "quantity",
            "material",
            "materialClass",
            "materialKind",
          ].includes(key)
        )
          e.part[key] = numeric ? n : value;
        else e[key] = numeric ? n : value;
      });
    }
    booleanOperation() {
      return {
        "boolean-union": "union",
        "boolean-subtract": "difference",
        "boolean-intersect": "intersection",
        "boolean-xor": "xor",
      }[this.tools.active];
    }
    booleanMenu() {
      const notes = {
        union: "Sloučí uzavřené plochy do jednoho obrysu.",
        difference: "Odečte ostatní vybrané plochy od prvního objektu.",
        intersection: "Zachová společnou plochu všech vybraných objektů.",
        xor: "Zachová nepřekrývající se plochy.",
      };
      this.dialog(
        "Booleovské operace",
        `<div class="boolean-menu">${Object.entries(BOOLEAN_LABELS)
          .map(
            ([operation, label]) =>
              `<button type="button" data-boolean-tool="${operation}">${icon("boolean")}<span><strong>${label}</strong><small>${notes[operation]}</small></span><span>↗</span></button>`,
          )
          .join(
            "",
          )}</div><p class="dialog-note">Vyberte operaci a klikáním označte uzavřené obrysy. Při odečítání vyberte nejprve základ. Zkontrolujte náhled a potvrďte tlačítkem Použít nebo Enter. Esc operaci zruší.</p>`,
        () => {
          document.querySelectorAll("[data-boolean-tool]").forEach(
            (button) =>
              (button.onclick = () => {
                $("app-dialog").close();
                this.chooseTool(booleanToolName(button.dataset.booleanTool));
              }),
          );
        },
      );
    }
    booleanOperands() {
      const entities = new Map(this.project.entities.map((e) => [e.id, e]));
      return [...this.selection].map((id) => entities.get(id)).filter(Boolean);
    }
    refreshBooleanPreview() {
      this.booleanPending = null;
      this.booleanError = "";
      const operands = this.booleanOperands();
      this.canvas.preview = [];
      this.canvas.booleanOperands = null;
      if (operands.length < 2) {
        this.booleanError = "Vyberte nejméně dva uzavřené obrysy.";
        return;
      }
      try {
        if (operands.some((e) => !isBooleanShape(e)))
          throw new Error(
            "Použijte uzavřené dílce, mnohoúhelníky, kružnice, otvory, drážky nebo plochy.",
          );
        if (
          operands.some((e) => {
            const l = this.project.layers.find((l) => l.id === e.layer);
            return l?.locked || l?.visible === false;
          })
        )
          throw new Error(
            "Všechny vybrané obrysy musí být viditelné a odemčené.",
          );
        const polygons = booleanPolygons(this.booleanOperation(), operands, {
          tolerance: this.booleanOptions.tolerance,
        });
        if (!polygons.length)
          throw new Error("Výsledek je prázdný. Původní obrysy zůstávají.");
        this.booleanPending = {
          polygons,
          operands: operands.map((e) => e.id),
          area: polygonArea(polygons),
        };
        this.canvas.preview = [
          { type: "region", polygons, layer: operands[0].layer },
        ];
        this.canvas.booleanOperands = new Set(operands.map((e) => e.id));
      } catch (error) {
        this.booleanError = Joinery.Errors.message(error.message);
      }
      this.canvas.invalidate();
    }
    renderBooleanControls() {
      this.refreshBooleanPreview();
      const operation = this.booleanOperation(),
        operands = this.booleanOperands(),
        pending = this.booleanPending;
      const holes =
        pending?.polygons.reduce((n, polygon) => n + polygon.length - 1, 0) ||
        0;
      $("tool-options").innerHTML =
        `<label>Operace<select id="boolean-operation">${Object.entries(
          BOOLEAN_LABELS,
        )
          .map(
            ([key, label]) =>
              `<option value="${key}" ${operation === key ? "selected" : ""}>${label}</option>`,
          )
          .join(
            "",
          )}</select></label>${operation === "difference" ? `<label>Základ<select id="boolean-base" aria-label="Základ odečítání">${operands.map((e, i) => `<option value="${esc(e.id)}" ${i === 0 ? "selected" : ""}>${esc(e.name || `${e.type} ${i + 1}`)}</option>`).join("")}</select></label><label class="boolean-keep-label"><input type="checkbox" id="boolean-keep" ${this.booleanOptions.keepCutters ? "checked" : ""}>Zachovat odečítané obrysy</label>` : ""}<label title="Největší odchylka aproximace oblouku. Přímé hrany zůstávají přesné.">Tolerance<input id="boolean-tolerance" type="number" min="0.001" max="0.1" step="0.001" value="${this.booleanOptions.tolerance}"></label><span class="unit-tag">mm</span><button id="boolean-apply" class="primary-button compact-button" ${pending ? "" : "disabled"}>Použít <span>↵</span></button><button id="boolean-clear" class="quiet-button compact-button" title="Zrušit výběr obrysů">Zrušit výběr</button><button id="boolean-cancel" class="quiet-button compact-button">Zrušit</button>`;
      $("tool-hint").textContent = pending
        ? `${operands.length} obrysů → ${pending.polygons.length} ploch, ${holes} otvorů · Enter potvrdí`
        : this.booleanError;
      $("boolean-operation").onchange = (e) =>
        this.chooseTool(booleanToolName(e.target.value));
      if ($("boolean-base"))
        $("boolean-base").onchange = (e) => {
          this.selection = new Set([
            e.target.value,
            ...[...this.selection].filter((id) => id !== e.target.value),
          ]);
          this.canvas.selected = this.selection;
          this.updateToolUI();
        };
      if ($("boolean-keep"))
        $("boolean-keep").onchange = (e) => {
          this.booleanOptions.keepCutters = e.target.checked;
        };
      $("boolean-tolerance").onchange = (e) => {
        const n = Number(e.target.value);
        if (!Number.isFinite(n) || n < 0.001 || n > 0.1) {
          this.toast("Zadejte toleranci oblouků 0,001 až 0,1 mm.");
          this.updateToolUI();
          return;
        }
        this.booleanOptions.tolerance = n;
        this.updateToolUI();
      };
      $("boolean-apply").onclick = () => this.applyBoolean();
      $("boolean-clear").onclick = () => this.select(null);
      $("boolean-cancel").onclick = () => this.tools.cancel();
      this.canvas.invalidate();
    }
    applyBoolean() {
      this.refreshBooleanPreview();
      if (!this.booleanPending) {
        this.toast(this.booleanError);
        return false;
      }
      const operation = this.booleanOperation(),
        operands = this.booleanOperands(),
        base = operands[0];
      const region = {
        id: operation === "difference" ? base.id : uid(),
        type: "region",
        layer: base.layer,
        name:
          operation === "difference"
            ? base.name || "Obrobený dílec"
            : `${BOOLEAN_LABELS[operation]} – výsledek`,
        closed: true,
        polygons: this.booleanPending.polygons,
        booleanOperation: operation,
        curveTolerance: this.booleanOptions.tolerance,
      };
      if (operation === "difference") {
        for (const key of ["cutListEnabled", "groupId", "groupName"])
          if (base[key] !== undefined) region[key] = base[key];
      }
      if (operation === "difference" && isPart(base)) {
        region.stockPoints = structuredClone(base.stockPoints || base.points);
        const spec = partSpec(base);
        region.part = {
          thickness: spec.thickness,
          material: spec.material,
          quantity: spec.quantity,
          banding: structuredClone(spec.banding),
          ...(spec.materialClass ? { materialClass: spec.materialClass } : {}),
          ...(spec.materialKind ? { materialKind: spec.materialKind } : {}),
        };
      }
      const consumed = new Set(
        operation === "difference" && this.booleanOptions.keepCutters
          ? [base.id]
          : operands.map((e) => e.id),
      );
      const ok = this.commit(() => {
        this.project.entities = this.project.entities.filter(
          (e) => !consumed.has(e.id),
        );
        this.project.entities.push(region);
        this.selection = new Set([region.id]);
      });
      if (ok) {
        this.tools.points = [];
        this.updateToolUI();
        this.toast(
          `${BOOLEAN_LABELS[operation]} dokončeno. Počet ploch: ${region.polygons.length}. Z vrátí změnu.`,
        );
      }
      return ok;
    }
    assignRegionPart(id) {
      const e = this.project.entities.find((e) => e.id === id);
      this.formDialog(
        "Polotovar dílce",
        [
          { name: "thickness", label: "Tloušťka polotovaru (mm)", value: 18 },
          {
            name: "material",
            label: "Materiál",
            value: "Neuvedeno",
            type: "text",
          },
          {
            name: "materialKind",
            label: "Druh materiálu",
            value: "",
            type: "select",
            options: [
              { value: "", label: "Bez značení" },
              ...Joinery.Materials.kinds.map((p) => ({
                value: p.id,
                label: p.name,
              })),
            ],
          },
          { name: "quantity", label: "Počet", value: 1 },
        ],
        (values) =>
          this.commit(() => {
            const b = bounds([e]);
            e.cutListEnabled = true;
            e.stockPoints = [
              { x: b.min.x, y: b.min.y },
              { x: b.max.x, y: b.min.y },
              { x: b.max.x, y: b.max.y },
              { x: b.min.x, y: b.max.y },
            ];
            e.part = {
              thickness: Number(values.thickness),
              material: values.material,
              ...(values.materialKind
                ? { materialKind: values.materialKind }
                : {}),
              quantity: Number(values.quantity),
              banding: [0, 0, 0, 0],
            };
          }),
        "Přiřadit polotovar",
        "Obálka obrysu určí rozměry polotovaru. Otvory a oddělené obrysy zůstanou zachovány.",
      );
    }
    updateToolUI() {
      const t = this.tools.active,
        descriptor = [...DRAW_TOOLS, ...EDIT_TOOLS].find((d) => d[0] === t) || [
          t,
          t[0].toUpperCase() + t.slice(1),
          "",
        ];
      const booleanMode = t.startsWith("boolean-");
      if (booleanMode) {
        descriptor[1] = BOOLEAN_LABELS[this.booleanOperation()];
        descriptor[2] = "B";
      }
      if ($("active-tool-name"))
        $("active-tool-name").textContent = descriptor[1];
      if ($("active-tool-key")) $("active-tool-key").textContent = descriptor[2];
      if ($("active-tool-icon"))
        $("active-tool-icon").innerHTML =
          `<use href="#i-${booleanMode ? "boolean" : ["mirror", "trim", "extend", "radius"].includes(t) ? "edit" : t}"/>`;
      document.querySelectorAll("[data-tool]").forEach((b) => {
        b.classList.toggle(
          "active",
          b.dataset.tool === t || (booleanMode && b.dataset.tool === "boolean"),
        );
        b.setAttribute(
          "aria-pressed",
          b.dataset.tool === t || (booleanMode && b.dataset.tool === "boolean"),
        );
      });
      if ($("tool-hint")) $("tool-hint").textContent = this.tools.hint();
      if ($("status-tool"))
        $("status-tool").textContent =
          t === "select" ? "Připraveno" : descriptor[1];
      if (booleanMode) {
        this.renderBooleanControls();
        return;
      }
      const o = this.tools.options,
        field = (name, label, type = "number", placeholder = "") =>
          `<label>${label} <input data-option="${name}" type="${type}" value="${esc(o[name])}" placeholder="${esc(placeholder)}" ${type === "number" ? 'step="0.01" min="0"' : ""} class="${type === "text" ? "text-option" : "compact-input"}">${type === "number" && name !== "dimensionMode" ? '<span class="unit-tag">mm</span>' : ""}</label>`;
      let html = "";
      if (t === "panel")
        html =
          field("width", "Š") +
          field("height", "V") +
          field("thickness", "T") +
          field("material", "Materiál", "text") +
          `<label>Druh <select data-option="materialKind" aria-label="Druh materiálu">${materialOptions(o.materialKind)}</select></label>`;
      else if (t === "rectangle")
        html =
          `<span class="option-label">Vlastní rozměr:</span>` +
          field("rectWidth", "Š", "number", "Auto") +
          field("rectHeight", "V", "number", "Auto");
      else if (t === "line" || t === "polyline")
        html =
          field("length", "Délka", "number", "Auto") +
          '<span class="select-hint">Shift = pravoúhle</span>';
      else if (t === "circle")
        html = field("radius", "Poloměr", "number", "Auto");
      else if (t === "drill")
        html =
          `<label>Průměr <select data-option="diameter">${[3, 5, 8, 15, 35].map((n) => `<option value="${n}" ${+o.diameter === n ? "selected" : ""}>Ø ${n} mm</option>`).join("")}</select></label>` +
          field("depth", "Hloubka");
      else if (t === "slot")
        html =
          field("slotWidth", "Šířka") +
          '<span class="select-hint">Středy konců</span>';
      else if (t === "text")
        html =
          field("text", "Text", "text") +
          field("textSize", "Velikost") +
          `<label>Orientace <select data-option="textOrientation"><option value="horizontal" ${o.textOrientation !== "vertical" ? "selected" : ""}>Vodorovně</option><option value="vertical" ${o.textOrientation === "vertical" ? "selected" : ""}>Svisle</option></select></label>`;
      else if (t === "dimension")
        html = `<label>Typ <select data-option="dimensionMode">${["aligned", "horizontal", "vertical"].map((mode) => `<option value="${mode}" ${o.dimensionMode === mode ? "selected" : ""}>${{ aligned: "Zarovnaná", horizontal: "Vodorovná", vertical: "Svislá" }[mode]}</option>`).join("")}</select></label>`;
      else if (t === "select")
        html = "";
      else html = `<span class="select-hint">${esc(this.tools.hint())}</span>`;
      $("tool-options").innerHTML = html;
      document.querySelectorAll("[data-option]").forEach((input) => {
        const handler = () => {
          if (input.dataset.option === "materialKind") {
            const previous = Joinery.Materials.kind(o.materialKind)?.name;
            if (["Neuvedeno", previous].includes(o.material)) {
              o.material =
                Joinery.Materials.kind(input.value)?.name || "Neuvedeno";
              document.querySelector('[data-option="material"]').value =
                o.material;
            }
          }
          o[input.dataset.option] = input.value;
          this.tools.preview();
        };
        input.oninput = handler;
        input.onchange = handler;
        input.onkeydown = (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (this.tools.active === "rectangle" && Number(o.rectWidth) > 0 && Number(o.rectHeight) > 0) {
              const p = this.tools.points[0] || this.tools.pointer || { x: 0, y: 0 };
              const w = +o.rectWidth,
                h = +o.rectHeight;
              const pts = [
                p,
                { x: p.x + w, y: p.y },
                { x: p.x + w, y: p.y + h },
                { x: p.x, y: p.y + h },
              ];
              this.add([{ type: "rectangle", points: pts, closed: true, cutListEnabled: false }]);
              this.tools.points = [];
              this.updateToolUI();
              this.canvas.canvas.focus();
            } else if (this.tools.points.length) {
              this.tools.finish();
              this.canvas.canvas.focus();
            } else {
              this.canvas.canvas.focus();
            }
          }
        };
      });
      if ($("active-layer")) $("active-layer").value = this.activeLayer;
    }
    setTab(tab) {
      this.tab = tab;
      $("design-view").hidden = tab !== "design";
      $("cutlist-view").hidden = tab !== "cutlist";
      document.querySelectorAll("[data-tab]").forEach((b) => {
        b.classList.toggle("active", b.dataset.tab === tab);
        b.setAttribute("aria-selected", b.dataset.tab === tab);
      });
      if (tab === "design") this.canvas?.resize();
    }
    undo(redo = false) {
      const next = redo
        ? this.history.redo(this.project)
        : this.history.undo(this.project);
      if (!next) {
        this.toast(redo ? "Není co znovu provést." : "Není co vrátit.");
        return;
      }
      this.project = next;
      this.selection.clear();
      this.tools.points = [];
      this.canvas.preview = [];
      this.canvas.booleanOperands = null;
      this.canvas.selected = this.selection;
      this.render();
      this.canvas.invalidate();
      this.scheduleSave();
    }
    deleteSelection() {
      if (!this.editableSelection().length) return;
      this.commit(() => {
        const ids = new Set(this.editableSelection().map((e) => e.id));
        this.project.entities = this.project.entities.filter(
          (e) => !ids.has(e.id),
        );
        this.selection.clear();
      });
    }
    keydown(e) {
      const input = e.target.closest("input,textarea,select,[contenteditable]");
      if ($("app-dialog").open) return;
      if (input) return;
      if (e.code === "Space") {
        e.preventDefault();
        this.canvas.space = true;
        this.canvas.canvas.style.cursor = "grab";
        return;
      }
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === "g") {
        e.preventDefault();
        e.shiftKey ? this.ungroupSelection() : this.groupSelection();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "s") {
        e.preventDefault();
        this.exportFile("json");
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "a") {
        e.preventDefault();
        this.selection = new Set(
          this.canvas
            .visibleEntities()
            .filter(
              (q) => !this.project.layers.find((l) => l.id === q.layer)?.locked,
            )
            .map((q) => q.id),
        );
        this.canvas.selected = this.selection;
        this.renderProperties();
        if (this.tools.active.startsWith("boolean-")) this.updateToolUI();
        this.canvas.invalidate();
        return;
      }
      if (key === "z" && !e.altKey) {
        e.preventDefault();
        this.undo(e.shiftKey);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === "y") {
        e.preventDefault();
        this.undo(true);
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === "Escape") {
        this.tools.cancel();
        return;
      }
      if (e.key === "Smazat" || e.key === "Backspace") {
        e.preventDefault();
        if (this.tools.points.length && this.tools.options.length) {
          this.tools.options.length = this.tools.options.length.slice(0, -1);
          this.updateToolUI();
          this.tools.preview();
        } else this.deleteSelection();
        return;
      }
      if (e.key === "Enter") {
        this.tools.finish();
        return;
      }
      if (e.key === "Shift") {
        this.tools.move(this.tools.pointer, { shiftKey: true });
        return;
      }
      if (key === "k" && this.tools.active === "polyline") {
        this.tools.finish(true);
        return;
      }
      if (
        /^[\d.]$/.test(key) &&
        this.tools.points.length &&
        ["line", "polyline", "circle"].includes(this.tools.active)
      ) {
        e.preventDefault();
        const prop = this.tools.active === "circle" ? "radius" : "length",
          str = String(this.tools.options[prop]);
        if (key === "." && str.includes(".")) return;
        this.tools.options[prop] = str + key;
        this.updateToolUI();
        this.tools.preview();
        return;
      }
      if (key === "f") {
        this.setTab("design");
        this.canvas.fit();
        return;
      }
      if (key === "g") {
        this.toggleSnap("grid");
        return;
      }
      if (key === "n") {
        this.toggleSnap("object");
        return;
      }
      if (e.key === "?") {
        this.help();
        return;
      }
      const tool = [...DRAW_TOOLS, ...EDIT_TOOLS].find(
        (t) => t[2].toLowerCase() === key,
      );
      if (tool) this.chooseTool(tool[0]);
    }
    dialog(title, html, setup = () => {}, actions = "") {
      this.releasePreview();
      $("dialog-title").textContent = title;
      $("dialog-body").innerHTML = html;
      $("dialog-actions").innerHTML = actions;
      $("dialog-form").onsubmit = (e) => e.preventDefault();
      if (!$("app-dialog").open) $("app-dialog").showModal();
      setup();
    }
    formDialog(title, fields, onSubmit, button = "Použít", note = "") {
      const html = `<div class="dialog-form-fields">${fields.map((f) => `<label>${esc(f.label)}${f.type === "select" ? `<select name="${f.name}">${f.options.map((o) => `<option value="${esc(o.value ?? o)}" ${(o.value ?? o) == f.value ? "selected" : ""}>${esc(o.label ?? o)}</option>`).join("")}</select>` : `<input name="${f.name}" type="${f.type || "number"}" value="${esc(f.value ?? "")}" ${!f.type || f.type === "number" ? 'step="any"' : ""} required>`}</label>`).join("")}${note ? `<p>${esc(note)}</p>` : ""}</div>`;
      this.dialog(
        title,
        html,
        () => {
          $("dialog-form").onsubmit = (e) => {
            e.preventDefault();
            const values = Object.fromEntries(new FormData(e.target));
            try {
              const result = onSubmit(values);
              if (result !== false) $("app-dialog").close();
            } catch (error) {
              this.toast(error.message);
            }
          };
        },
        `<button type="button" id="form-cancel" class="quiet-button">Zrušit</button><button type="submit" class="primary-button">${esc(button)}</button>`,
      );
      $("form-cancel").onclick = () => $("app-dialog").close();
    }
    groupSelection() {
      const list = this.editableSelection();
      if (list.length < 2 || list.length !== this.selection.size) {
        this.toast(
          "Vyberte nejméně dva objekty ve viditelných a odemčených vrstvách.",
        );
        return;
      }
      this.formDialog(
        "Seskupit objekty",
        [
          {
            name: "name",
            label: "Název skupiny",
            value: "Skupina objektů",
            type: "text",
          },
          {
            name: "parts",
            label: "Jak zobrazit objekty v kusovníku?",
            type: "select",
            value: "exclude",
            options: [
              {
                value: "exclude",
                label: "Pohledy na jeden dílec – vyřadit z kusovníku",
              },
              {
                value: "keep",
                label: "Samostatné dílce – zachovat kusovník",
              },
            ],
          },
        ],
        (values) =>
          this.commit(() => {
            const groupId = uid();
            for (const entity of list) {
              entity.groupId = groupId;
              entity.groupName =
                values.name.trim().slice(0, 120) || "Skupina objektů";
              if (values.parts === "exclude" && isPart(entity))
                entity.cutListEnabled = false;
            }
          }),
        "Seskupit",
        "Kliknutí vybere celou skupinu, Alt + kliknutí jeden člen. Seskupení zachová jednotlivé obrysy a kóty.",
      );
    }
    ungroupSelection() {
      const ids = new Set(
        this.editableSelection()
          .map((e) => e.groupId)
          .filter(Boolean),
      );
      if (!ids.size) {
        this.toast("Vyberte skupinu ve viditelných a odemčených vrstvách.");
        return;
      }
      this.commit(() => {
        for (const e of this.project.entities)
          if (ids.has(e.groupId)) {
            delete e.groupId;
            delete e.groupName;
          }
      });
    }
    draftingSettings() {
      this.formDialog(
        "Nastavení kótování",
        [
          {
            name: "textHeight",
            label: "Výška textu kót (mm na papíře)",
            type: "select",
            value: this.project.settings.dimensionTextHeight || 2.5,
            options: [2.5, 3.5, 5, 7],
          },
          {
            name: "termination",
            label: "Zakončení kót",
            type: "select",
            value: this.project.settings.dimensionTermination || "slash",
            options: [
              { value: "slash", label: "Šikmé úsečky" },
              { value: "filled", label: "Plné šipky" },
              { value: "open", label: "Otevřené šipky" },
            ],
          },
        ],
        (values) =>
          this.commit(() => {
            this.project.settings.dimensionTextHeight = +values.textHeight;
            this.project.settings.dimensionTermination = values.termination;
          }),
        "Použít",
        "Výška textu na papíře je stejná při každém měřítku PDF. Nastavení vychází z ISO 129-1, ISO 3098-1, ISO 128-2 a ISO 5455 a jejich převzetí EN / ČSN.",
      );
    }
    operations() {
      if (!this.editableSelection().length) {
        this.toast("Nejprve vyberte objekt v odemčené vrstvě.");
        return;
      }
      const ops = [
        ["group", "Seskupit objekty"],
        ["ungroup", "Zrušit skupinu"],
        ["move", "Přesunout"],
        ["copy", "Kopírovat"],
        ["rotate", "Otočit"],
        ["mirror", "Zrcadlit"],
        ["offset", "Odsazení"],
        ["array", "Obdélníkové / lineární pole"],
        ["trim", "Oříznout úsečku"],
        ["extend", "Prodloužit úsečku"],
        ["radius", "Poloměrová kóta"],
        ["joint", "Spoj / výřez"],
        ["boolean", "Booleovské operace"],
      ];
      this.dialog(
        "Úpravy objektů",
        `<div class="operation-grid">${ops.map(([key, name]) => `<button type="button" data-operation="${key}">${name} <span style="float:right;color:var(--muted)">↗</span></button>`).join("")}</div><p class="dialog-note">Úpravy se použijí na výběr v odemčených vrstvách. Spoje pracují v místních souřadnicích jednoho dílce.</p>`,
        () => {
          document.querySelectorAll("[data-operation]").forEach(
            (b) =>
              (b.onclick = () => {
                const op = b.dataset.operation;
                $("app-dialog").close();
                if (
                  [
                    "move",
                    "copy",
                    "mirror",
                    "trim",
                    "extend",
                    "radius",
                  ].includes(op)
                ) {
                  this.chooseTool(op);
                  return;
                }
                this.operationForm(op);
              }),
          );
        },
      );
    }
    operationForm(op) {
      if (op === "group") {
        this.groupSelection();
        return;
      }
      if (op === "ungroup") {
        this.ungroupSelection();
        return;
      }
      if (op === "boolean") {
        this.booleanMenu();
        return;
      }
      if (op === "rotate")
        this.formDialog(
          "Otočit výběr",
          [
            {
              name: "degrees",
              label: "Úhel proti směru hodinových ručiček (°)",
              value: 90,
            },
          ],
          (v) => {
            const list = this.editableSelection(),
              box = bounds(list),
              c = {
                x: (box.min.x + box.max.x) / 2,
                y: (box.min.y + box.max.y) / 2,
              },
              n = +v.degrees;
            if (!Number.isFinite(n)) throw new Error("Zadejte platný úhel.");
            return this.commit(() =>
              list.forEach((e) =>
                Object.assign(
                  e,
                  transformEntity(e, (p) =>
                    rotatePoint(p, c, (n * Math.PI) / 180),
                  ),
                ),
              ),
            );
          },
          "Otočit",
          "Střed otáčení leží ve středu obálky výběru. Kóty se otáčejí s geometrií.",
        );
      if (op === "offset")
        this.formDialog(
          "Odsazení obrysu",
          [
            {
              name: "distance",
              label: "Vzdálenost (mm) · kladná = vně uzavřeného obrysu",
              value: 10,
            },
          ],
          (v) => {
            const n = +v.distance;
            if (!Number.isFinite(n) || n === 0)
              throw new Error("Zadejte nenulové odsazení.");
            const copies = this.editableSelection().map((e) =>
              offsetEntity(e, n),
            );
            if (copies.some((e) => !e))
              throw new Error(
                "Odsazení podporuje úsečky, kružnice a uzavřené mnohoúhelníky. Vnitřní odsazení se musí vejít.",
              );
            copies.forEach((e) => {
              e.id = uid();
              delete e.groupId;
              delete e.groupName;
              e.name = e.name ? e.name + " offset" : "";
            });
            return this.add(copies);
          },
          "Vytvořit odsazení",
          "Odsazení dílce vytváří pomocný obrys. Kladné odsazení úsečky směřuje vlevo od jejího směru.",
        );
      if (op === "array")
        this.formDialog(
          "Vytvořit pole",
          [
            { name: "columns", label: "Sloupce (včetně originálu)", value: 5 },
            { name: "rows", label: "Řádky (včetně originálu)", value: 1 },
            { name: "dx", label: "Rozteč sloupců X (mm)", value: 32 },
            { name: "dy", label: "Rozteč řádků Y (mm)", value: 32 },
          ],
          (v) => {
            const cols = +v.columns,
              rows = +v.rows,
              dx = +v.dx,
              dy = +v.dy;
            if (
              !Number.isInteger(cols) ||
              !Number.isInteger(rows) ||
              cols < 1 ||
              rows < 1 ||
              cols * rows > 500 ||
              ![dx, dy].every(Number.isFinite)
            )
              throw new Error(
                "Zadejte celé počty s nejvýše 500 kopiemi a platnou rozteč.",
              );
            const copies = [];
            for (let y = 0; y < rows; y++)
              for (let x = 0; x < cols; x++) {
                if (!x && !y) continue;
                const instance = [];
                for (const e of this.editableSelection()) {
                  const next = transformEntity(e, (p) =>
                    add(p, { x: x * dx, y: y * dy }),
                  );
                  next.id = uid();
                  instance.push(next);
                }
                copies.push(...regroupCopies(instance));
              }
            return this.add(copies);
          },
          "Vytvořit pole",
          "Pro systém 32 mm: 1 sloupec, 9 řádků a rozteč řádků 32 mm.",
        );
      if (op === "joint") {
        const list = this.editableSelection();
        if (list.length !== 1 || list[0].type !== "panel") {
          this.toast("Pro vytvoření spoje vyberte jeden dílec.");
          return;
        }
        const part = list[0];
        this.formDialog(
          "Truhlářský spoj",
          [
            {
              name: "kind",
              label: "Typ spoje",
              type: "select",
              value: "dado",
              options: [
                { value: "dado", label: "Příčná drážka" },
                { value: "groove", label: "Podélná drážka" },
                { value: "mortise", label: "Dlab" },
                { value: "tenon", label: "Čep" },
                { value: "miter", label: "Pokos 45°" },
              ],
            },
            {
              name: "width",
              label: "Šířka drážky / velikost pokosu (mm)",
              value: 18,
            },
            {
              name: "length",
              label: "Délka dlabu / šířka čepu (mm)",
              value: 80,
            },
            { name: "depth", label: "Hloubka obrábění (mm)", value: 8 },
            {
              name: "position",
              label: "Poloha od dolní nebo levé hrany (mm)",
              value: 100,
            },
          ],
          (v) => {
            const geometry = jointGeometry(part, v.kind, {
              width: +v.width,
              length: +v.length,
              depth: +v.depth,
              position: +v.position,
            });
            geometry.layer = this.activeLayer;
            return this.add([geometry]);
          },
          "Vytvořit spoj",
          "Spoje jsou obráběcí obrysy s hloubkou. Rozměry polotovaru v kusovníku upravte samostatně.",
        );
      }
    }
    snapSettings() {
      const s = this.project.settings,
        m = s.snapModes || {};
      this.dialog(
        "Přichycení",
        `<div class="dialog-form-fields"><label>Rozteč přichycení (mm)<input id="snap-spacing" type="number" min="0.01" max="100000000" step="any" value="${s.gridSize}"></label>${["endpoint", "midpoint", "center", "intersection", "perpendicular", "parallel"].map((k) => `<label style="flex-direction:row;align-items:center"><input type="checkbox" data-snap-mode="${k}" ${m[k] !== false ? "checked" : ""}>${{ endpoint: "Koncový bod", midpoint: "Střed úsečky", center: "Střed", intersection: "Průsečík", perpendicular: "Kolmice", parallel: "Rovnoběžka" }[k]}</label>`).join("")}</div><p class="dialog-note">Rozteč lze změnit i dole v liště. Zobrazená mřížka se přizpůsobuje přiblížení; rozteč přichycení zůstává pevná.</p>`,
        () => {
          $("dialog-form").onsubmit = (e) => {
            e.preventDefault();
            const n = +$("snap-spacing").value;
            if (!this.setGridSpacing(n, true)) return;
            s.snapModes = Object.fromEntries(
              [...document.querySelectorAll("[data-snap-mode]")].map((i) => [
                i.dataset.snapMode,
                i.checked,
              ]),
            );
            this.scheduleSave();
            this.renderSnap();
            this.tools.move(this.tools.pointer, this.tools.lastEvent);
            $("app-dialog").close();
            this.canvas.invalidate();
          };
        },
        '<button type="submit" class="primary-button">Uložit přichycení</button>',
      );
    }
    help() {
      const rows = [
        ["Výběr", "V"],
        ["Úsečka / lomená čára", "L / W"],
        ["Obdélník / dílec", "R / P"],
        ["Kružnice / oblouk", "O / A"],
        ["Otvor / drážka", "H / S"],
        ["Kóta / text", "D / T"],
        ["Přesunout / kopírovat", "M / C"],
        ["Seskupit / rozdělit", "Ctrl G / Ctrl Shift G"],
        ["Vybrat člen skupiny", "Alt + kliknutí"],
        ["Úpravy", "E"],
        ["Booleovské operace", "B"],
        ["Zpět / znovu", "Z / Shift Z"],
        ["Zobrazit celý výkres", "F"],
        ["Mřížka / přichycení", "G / N"],
        ["Posun pohledu", "Mezerník + tažení"],
        ["Pravoúhlé kreslení", "Shift"],
        ["Dokončit / uzavřít", "Enter / K"],
        ["Zrušit / smazat", "Esc / Del"],
        ["Uložit projekt", "Ctrl / Cmd S"],
      ];
      this.dialog(
        "Nápověda a zkratky",
        `<div class="help-grid">${rows.map(([name, key]) => `<p>${name}<kbd>${key}</kbd></p>`).join("")}</div><p class="dialog-note">Rozměry nástrojů zadávejte v mm. Přesnou úsečku vytvoříte určením začátku, směru a zadáním délky + Enter. Shift + kliknutí přidá objekt do výběru.</p><p class="dialog-note">Pohled posouvejte prostředním tlačítkem nebo mezerníkem s tažením. Kolečko přibližuje v místě kurzoru. Pravé tlačítko na MŘÍŽKA nebo OSNAP otevře nastavení přichycení. Vrstva se přejmenuje dvojklikem na její název.</p><button id="help-snaps" class="text-button">Nastavit přichycení</button>`,
        () => {
          $("help-snaps").onclick = () => this.snapSettings();
        },
      );
    }
    releasePreview() {
      if (this.previewURL) URL.revokeObjectURL(this.previewURL);
      this.previewURL = null;
      $("app-dialog")?.classList.remove("pdf-preview-dialog");
    }
    titleBlockDialog(after = null) {
      const stamp = this.project.settings.titleBlock || {};
      const labels = {
        title: "Název výkresu",
        number: "Číslo výkresu",
        author: "Kreslil",
        checked: "Kontroloval",
        date: "Datum",
        revision: "Revize",
        company: "Organizace",
        material: "Materiál",
      };
      this.dialog(
        "Výkresové razítko",
        `<div class="dialog-form-fields">${Object.entries(labels)
          .map(
            ([key, label]) =>
              `<label>${label}<input type="text" name="${key}" maxlength="120" value="${esc(stamp[key] || "")}" placeholder="${key === "title" ? esc(this.project.name) : key === "date" ? new Date().toLocaleDateString("cs-CZ") : key === "revision" ? "0" : key === "material" ? "Automaticky podle dílců" : "Nevyplněno"}"></label>`,
          )
          .join(
            "",
          )}</div><p class="dialog-note">Prázdný název, datum a materiál se doplní automaticky. Měřítko, formát a číslo listu určí export.</p>`,
        () => {
          $("dialog-form").onsubmit = (e) => {
            e.preventDefault();
            const values = Object.fromEntries(new FormData(e.target));
            this.commit(() => {
              this.project.settings.titleBlock = values;
            });
            if (after) after();
            else $("app-dialog").close();
          };
        },
        `<button type="button" id="stamp-cancel" class="quiet-button">Zrušit</button><button type="submit" class="primary-button">Uložit razítko</button>`,
      );
      $("stamp-cancel").onclick = () =>
        after ? after() : $("app-dialog").close();
    }
    pdfSettings(options = { paper: "A3", scale: "fit" }) {
      this.formDialog(
        "Náhled PDF – nastavení",
        [
          {
            name: "paper",
            label: "Formát",
            type: "select",
            value: options.paper,
            options: [
              { value: "A3", label: "A3 na šířku · 420 × 297 mm" },
              { value: "A4", label: "A4 na šířku · 297 × 210 mm" },
            ],
          },
          {
            name: "scale",
            label: "Měřítko",
            type: "select",
            value: options.scale,
            options: [
              { value: "fit", label: "Automaticky (1:1, 1:2, 1:5…)" },
              ...[1, 2, 5, 10, 20, 50, 100].map((n) => ({
                value: String(n),
                label: `1:${n}`,
              })),
            ],
          },
        ],
        (v) => {
          this.previewPDF(v);
          return false;
        },
        "Zobrazit náhled",
        "Pro zachování měřítka tiskněte ve skutečné velikosti (100 %). Soubor se stáhne až tlačítkem v náhledu.",
      );
      $("dialog-actions").insertAdjacentHTML(
        "afterbegin",
        '<button type="button" id="pdf-stamp" class="quiet-button">Upravit razítko</button>',
      );
      $("pdf-stamp").onclick = () => {
        const chosen = Object.fromEntries(new FormData($("dialog-form")));
        this.titleBlockDialog(() => this.pdfSettings(chosen));
      };
    }
    previewPDF(options) {
      const { bytes, svg, pages } = exportPDF(this.project, {
          ...options,
          preview: true,
        }),
        pageList = pages && pages.length ? pages : [svg];
      let activePageIndex = 0;
      let zoom = 1.0;

      const renderPage = () => {
        const content = $("pdf-preview-content");
        if (!content) return;
        content.innerHTML = pageList[activePageIndex] || pageList[0];
        document.querySelectorAll(".pdf-page-btn").forEach((btn, idx) => {
          btn.classList.toggle("active", idx === activePageIndex);
        });
        applyZoom();
      };

      const applyZoom = () => {
        const scaler = $("pdf-preview-scaler");
        const level = $("pdf-zoom-level");
        if (scaler) {
          scaler.style.transform = `scale(${zoom})`;
          scaler.style.transformOrigin = "top center";
        }
        if (level) {
          level.textContent = `${Math.round(zoom * 100)} %`;
        }
      };

      const setZoom = (nextZoom) => {
        zoom = Math.max(0.2, Math.min(5.0, Number(nextZoom.toFixed(2))));
        applyZoom();
      };

      const fitZoom = () => {
        const container = $("pdf-preview-container");
        const content = $("pdf-preview-content");
        if (!container || !content) return;
        const svgEl = content.querySelector("svg");
        if (svgEl) {
          const svgRect = svgEl.getBoundingClientRect();
          const w = svgRect.width / (zoom || 1);
          if (w > 0) {
            const availW = container.clientWidth - 48;
            const fit = Math.max(0.2, Math.min(2.0, availW / w));
            setZoom(fit);
            return;
          }
        }
        setZoom(0.85);
      };

      const modalHtml = `
        <div class="pdf-preview-toolbar">
          <div class="pdf-page-switcher">
            <button type="button" class="pdf-page-btn active" data-page="0">1. Výkres</button>
            <button type="button" class="pdf-page-btn" data-page="1">2. Kusovník</button>
          </div>
          <div class="pdf-zoom-controls">
            <button type="button" class="pdf-zoom-btn" id="pdf-zoom-out" title="Oddálit">−</button>
            <span id="pdf-zoom-level">100 %</span>
            <button type="button" class="pdf-zoom-btn" id="pdf-zoom-in" title="Přiblížit">+</button>
            <button type="button" class="pdf-zoom-btn text-btn" id="pdf-zoom-100">100 %</button>
            <button type="button" class="pdf-zoom-btn text-btn" id="pdf-zoom-fit">Přizpůsobit</button>
          </div>
        </div>
        <div id="pdf-preview-container" class="pdf-preview-container">
          <div id="pdf-preview-scaler" class="pdf-preview-scaler">
            <div id="pdf-preview-content"></div>
          </div>
        </div>
      `;

      this.dialog(
        "Náhled PDF výkresu a kusovníku",
        modalHtml,
        () => {
          $("app-dialog").classList.add("pdf-preview-dialog");
          renderPage();

          document.querySelectorAll(".pdf-page-btn").forEach((btn) => {
            btn.onclick = () => {
              activePageIndex = Number(btn.dataset.page) || 0;
              renderPage();
            };
          });

          $("pdf-zoom-in").onclick = () => setZoom(zoom * 1.25);
          $("pdf-zoom-out").onclick = () => setZoom(zoom / 1.25);
          $("pdf-zoom-100").onclick = () => setZoom(1.0);
          $("pdf-zoom-fit").onclick = () => fitZoom();

          const container = $("pdf-preview-container");
          if (container) {
            container.onwheel = (e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const factor = e.deltaY < 0 ? 1.15 : 0.87;
                setZoom(zoom * factor);
              }
            };
          }

          setTimeout(() => fitZoom(), 50);
        },
        '<button type="button" id="preview-settings" class="quiet-button">Zpět k nastavení</button><button type="button" id="preview-download" class="primary-button">Stáhnout PDF</button>',
      );
      $("preview-settings").onclick = () => this.pdfSettings(options);
      $("preview-download").onclick = () =>
        download(
          bytes,
          `${this.project.name.replace(/[^a-zA-Z0-9_-]/g, "_") || "vykres"}.pdf`,
          "application/pdf",
        );
    }
    exportDialog() {
      const formats = [
        ["jcad", "Projekt Joinery CAD (.jcad)", "Nativní formát projektu pro pozdější úpravy"],
        ["pdf", "Výkres PDF", "Náhled, razítko a měřítko před stažením"],
        ["dxf", "Výkres DXF", "Obrysy pro další práci v CAD / CAM"],
        ["json", "Záloha JSON", "Záložní datový export projektu"],
      ];
      this.dialog(
        "Uložit / exportovat",
        `<div class="export-options">${formats.map(([format, title, note]) => `<button type="button" class="export-option" data-format="${format}"><strong>${title}</strong><span>${note}</span></button>`).join("")}</div>`,
        () => {
          document.querySelectorAll("[data-format]").forEach(
            (b) =>
              (b.onclick = () => {
                if (b.dataset.format === "pdf") this.pdfSettings();
                else {
                  this.exportFile(b.dataset.format);
                  $("app-dialog").close();
                }
              }),
          );
        },
      );
    }
    exportFile(format, options = {}) {
      const name =
        this.project.name.replace(/[^a-z0-9-_]+/gi, "-") || "joinery-project";
      let data,
        type,
        extension = format;
      if (format === "jcad" || format === "json") {
        this.project.view = this.canvas.view();
        data = JSON.stringify(this.project, null, 2);
        type = "application/json";
        extension = format === "jcad" ? "jcad" : "json";
      }
      if (format === "bom") {
        data = JSON.stringify(
          {
            project: this.project.name,
            units: "mm",
            parts: cutList(this.project),
            summary: bomSummary(this.project),
          },
          null,
          2,
        );
        type = "application/json";
        extension = "cutlist.json";
      }
      if (format === "csv") {
        data = exportCSV(this.project);
        type = "text/csv;charset=utf-8";
        extension = "cutlist.csv";
      }
      if (format === "dxf") {
        data = exportDXF(this.project);
        type = "application/dxf";
      }
      if (format === "svg") {
        data = exportSVG(this.project);
        type = "image/svg+xml";
      }
      if (format === "pdf") {
        data = exportPDF(this.project, options);
        type = "application/pdf";
      }
      download(data, `${name}.${extension}`, type);
      this.toast(`${format.toUpperCase()} uloženo.`);
      return true;
    }
    async importFile(file) {
      if (!file) return;
      try {
        if (file.size > 10 * 1024 * 1024)
          throw new Error("Soubor musí být menší než 10 MB.");
        const source = await file.text();
        let next,
          skipped = 0;
        if (file.name.toLowerCase().endsWith(".dxf")) {
          const result = importDXF(source);
          next = normalizeBasicLayers(result.project);
          skipped = result.skipped;
          next.name = file.name.replace(/\.dxf$/i, "");
        } else {
          next = normalizeBasicLayers(validateProject(JSON.parse(source)));
          next.name = next.name || file.name.replace(/\.(jcad|joinery|json)$/i, "");
        }
        const ok = this.commit(() => {
          this.project = next;
          this.selection.clear();
          this.activeLayer = this.project.layers[0].id;
        });
        if (ok) {
          this.tools.cancel();
          this.setTab("design");
          this.canvas.fit();
          this.toast(
            `Otevřeno ${file.name}${skipped ? ` · ${skipped} nepodporovaných záznamů DXF vynecháno` : ""}. Zpět obnoví předchozí výkres.`,
          );
        }
      } catch (error) {
        this.toast(
          `Soubor nelze otevřít: ${Joinery.Errors.message(error.message)}`,
        );
      } finally {
        $("file-input").value = "";
      }
    }
  }
  const BOOLEAN_LABELS = {
    union: "Sjednotit",
    difference: "Odečíst",
    intersection: "Průnik",
    xor: "Vyloučený průnik",
  };
  const booleanToolName = (operation) =>
    ({
      union: "boolean-union",
      difference: "boolean-subtract",
      intersection: "boolean-intersect",
      xor: "boolean-xor",
    })[operation];
  function dimensionDirection(e) {
    return e.mode === "horizontal"
      ? { x: 1, y: 0 }
      : e.mode === "vertical"
        ? { x: 0, y: 1 }
        : unit(sub(e.points[1], e.points[0]));
  }
  new App();

  Joinery.App = { App };
})((globalThis.Joinery = globalThis.Joinery || {}));
