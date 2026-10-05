/** Quantities describe physical blanks, never projected drawing area. */
(function (J) {
  class BOMManager {
    static edgeEligible(kind) {
      return ["laminate", "particleboard", "mdf"].includes(kind);
    }
    static rows(project) {
      return J.Woodworking.cutList(project).map((row) => {
        const source = row.custom
            ? project.customCutlist?.find((e) => e.id === row.id)
            : project.entities.find((e) => e.id === row.id),
          spec = source?.part || source || {};
        const size =
          source && !row.custom
            ? J.Model.panelSize(source)
            : { width: row.width, height: row.length };
        const length = Math.max(size.width, size.height),
          width = Math.min(size.width, size.height),
          thickness = Number(row.thickness),
          quantity = Number(row.quantity);
        const unit = row.materialKind.startsWith("solid-")
          ? "m³"
          : J.Materials.kind(row.materialKind)
            ? "m²"
            : "";
        const piece =
          unit === "m³"
            ? (thickness * width * length) / 1e9
            : unit === "m²"
              ? (width * length) / 1e6
              : null;
        const edges = [];
        if (this.edgeEligible(row.materialKind)) {
          const sides = [size.width, size.height, size.width, size.height];
          (
            spec.banding ||
            ["B", "R", "T", "L"].map(
              (side) =>
                Number(
                  (spec.edgeBanding || "").match(
                    new RegExp(side + ":([0-9.]+)mm"),
                  )?.[1],
                ) || 0,
            )
          ).forEach((v, i) => {
            if (v)
              edges.push({
                type: spec.edgeTypes?.[i] || `ABS ${v} mm`,
                meters: (sides[i] * quantity) / 1000,
              });
          });
        }
        return {
          ...row,
          length,
          width,
          thickness,
          quantity,
          piece,
          total: piece == null ? null : piece * quantity,
          unit,
          edges,
        };
      });
    }
    static summary(rows) {
      const out = {
        volume: 0,
        area: 0,
        banding: 0,
        quantity: 0,
        edges: {},
        unclassified: 0,
      };
      for (const r of rows) {
        out.quantity += r.quantity;
        if (r.unit === "m³") out.volume += r.total;
        else if (r.unit === "m²") out.area += r.total;
        else out.unclassified++;
        for (const e of r.edges) {
          out.edges[e.type] = (out.edges[e.type] || 0) + e.meters;
          out.banding += e.meters;
        }
      }
      return out;
    }
    static format(value, unit = "") {
      return value == null
        ? "Neuvedeno"
        : `${Number(value.toFixed(6)).toLocaleString("cs-CZ", { maximumFractionDigits: 6 })}${unit ? " " + unit : ""}`;
    }
    static columns = [
      "Název kusu",
      "Počet [ks]",
      "V [mm]",
      "Š [mm]",
      "D [mm]",
      "Spotřeba na kus",
      "Spotřeba na výrobek",
    ];
    static csv(project) {
      const quote = (v) => '"' + String(v ?? "").replaceAll('"', '""') + '"';
      return (
        "\ufeff" +
        [
          this.columns,
          ...this.rows(project).map((r) => [
            r.name,
            r.quantity,
            r.thickness,
            r.width,
            r.length,
            this.format(r.piece, r.unit),
            this.format(r.total, r.unit),
          ]),
        ]
          .map((r) => r.map(quote).join(";"))
          .join("\r\n")
      );
    }
    static render(app) {
      const rows = this.rows(app.project),
        s = this.summary(rows),
        esc = J.Woodworking.escapeHTML,
        F = this.format;
      document.querySelector("#cutlist-view thead").innerHTML =
        "<tr>" + this.columns.map((c) => `<th>${c}</th>`).join("") + "</tr>";
      document.getElementById("cutlist-summary").innerHTML =
        `<div><span>Kusů</span><strong>${s.quantity}</strong></div><div><span>Masiv</span><strong>${F(s.volume, "m³")}</strong></div><div><span>Plošný materiál</span><strong>${F(s.area, "m²")}</strong></div><div><span>Hrany</span><strong>${F(s.banding, "m")}</strong></div>`;
      document.getElementById("cutlist-table").innerHTML =
        rows
          .map(
            (r) =>
              `<tr><td><button class="part-link" data-part="${esc(r.id)}">${esc(r.name)}</button><small>${esc(r.partId)} · ${esc(J.Materials.kind(r.materialKind)?.name || "Neurčený materiál")}<button class="remove-part" data-id="${esc(r.id)}" data-custom="${r.custom || false}" aria-label="Odebrat položku">×</button></small></td><td>${r.quantity}</td><td>${F(r.thickness)}</td><td>${F(r.width)}</td><td>${F(r.length)}</td><td>${F(r.piece, r.unit)}</td><td>${F(r.total, r.unit)}</td></tr>`,
          )
          .join("") ||
        '<tr><td colspan="7">Žádné výrobní dílce. Přidejte dílec nebo ruční položku.</td></tr>';
      let footer = document.getElementById("bom-totals");
      if (!footer) {
        footer = document.createElement("div");
        footer.id = "bom-totals";
        document.getElementById("cutlist-view").append(footer);
      }
      footer.textContent = `Celková spotřeba masivu: ${F(s.volume, "m³")} · Celková spotřeba plošného materiálu: ${F(s.area, "m²")} · Celková spotřeba hran: ${F(s.banding, "m")} ${Object.entries(
        s.edges,
      )
        .map(([t, v]) => ` | ${t}: ${F(v, "m")}`)
        .join(
          "",
        )}${s.unclassified ? " · U neklasifikovaných dílců spotřebu nelze určit." : ""}`;
      document.querySelectorAll("[data-part]").forEach(
        (b) =>
          (b.onclick = () => {
            const r = rows.find((r) => r.id === b.dataset.part);
            if (r.custom) app.editCustomCutlistItem(r.id);
            else {
              app.setTab("design");
              app.select(r.id);
            }
          }),
      );
      document
        .querySelectorAll(".remove-part")
        .forEach(
          (b) =>
            (b.onclick = () =>
              app.removeCutlistItem(b.dataset.id, b.dataset.custom === "true")),
        );
    }
  }
  J.BOMManager = { BOMManager };
})((globalThis.Joinery = globalThis.Joinery || {}));
