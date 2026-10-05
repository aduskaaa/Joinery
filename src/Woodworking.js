/** Woodworking: plain-script module. Loaded in dependency order by index.html. */
(function (Joinery) {
  "use strict";
  const {
    add,
    sub,
    mul,
    unit,
    bounds,
    vertices,
    arcPoints,
    normalizeAngle,
    distance,
    TAU,
  } = Joinery.Geometry;
  const { panelSize, isInCutlist, uid, emptyProject, validateProject } = Joinery.Model;
  const {
    primitives,
    fontSize,
    draftingScene,
    sceneBounds,
    preferredScales,
    measure,
  } = Joinery.Scene;
  const escapeHTML = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  function cutList(project) {
    const cadRows = (project.entities || [])
      .filter((e) => isInCutlist(e))
      .map((e, i) => {
        // These are declared blank sizes, not an estimate of material consumption.
        const part = e.type === "panel" ? e : (e.part || e),
          { width, height } = panelSize(
            e.type === "panel"
              ? e
              : e.stockPoints
                ? { points: e.stockPoints }
                : e,
          ),
          banding = part.banding || [0, 0, 0, 0];
        return {
          id: e.id,
          partId: `P${String(i + 1).padStart(3, "0")}`,
          name: e.name || (e.type === "panel" ? "Panel" : "Dílec"),
          length: round(Math.max(width, height)),
          width: round(Math.min(width, height)),
          thickness: part.thickness ?? 18,
          quantity: part.quantity || 1,
          material: part.material || "Unspecified",
          materialClass: part.materialClass || "",
          materialKind: part.materialKind || "",
          materialStandard:
            Joinery.Materials.get(part.materialClass)?.standard || "",
          materialCSN: Joinery.Materials.get(part.materialClass)?.csn || "",
          materialGrade: Joinery.Materials.get(part.materialClass)?.grade || "",
          materialUse: Joinery.Materials.get(part.materialClass)?.use || "",
          banding: {
            bottom: banding[0],
            right: banding[1],
            top: banding[2],
            left: banding[3],
          },
          edgeBanding:
            banding
              .map((n, j) => (n ? `${["B", "R", "T", "L"][j]}:${n}mm` : ""))
              .filter(Boolean)
              .join(" ") || "—",
        };
      });
    const customRows = (project.customCutlist || []).map((c, i) => {
      const banding = Array.isArray(c.banding) ? c.banding : [0, 0, 0, 0];
      const len = round(Number(c.length) || 0);
      const wid = round(Number(c.width) || 0);
      return {
        id: c.id || `custom-${i + 1}`,
        partId: `K${String(i + 1).padStart(3, "0")}`,
        name: c.name || "Dílec",
        length: round(Math.max(len, wid)),
        width: round(Math.min(len, wid)),
        thickness: round(Number(c.thickness) || 18),
        quantity: round(Number(c.quantity) || 1),
        material: c.material || "Neuvedeno",
        materialClass: c.materialClass || "",
        materialKind: c.materialKind || "",
        materialStandard:
          Joinery.Materials.get(c.materialClass)?.standard || "",
        materialCSN: Joinery.Materials.get(c.materialClass)?.csn || "",
        materialGrade: Joinery.Materials.get(c.materialClass)?.grade || "",
        materialUse: Joinery.Materials.get(c.materialClass)?.use || "",
        banding: {
          bottom: banding[0] || 0,
          right: banding[1] || 0,
          top: banding[2] || 0,
          left: banding[3] || 0,
        },
        edgeBanding:
          c.edgeBanding ||
          (banding.some(Boolean)
            ? banding
                .map((n, j) => (n ? `${["B", "R", "T", "L"][j]}:${n}mm` : ""))
                .filter(Boolean)
                .join(" ")
            : "—"),
        custom: true,
      };
    });
    return [...cadRows, ...customRows];
  }
  const round = (n) => Number(n.toFixed(4));
  function bomSummary(project) {
    const rows = cutList(project);
    return {
      parts: rows.length,
      quantity: rows.reduce((s, r) => s + r.quantity, 0),
      materials: new Set(
        rows.map((r) =>
          JSON.stringify([r.material, r.materialClass, r.materialKind]),
        ),
      ).size,
    };
  }
  function materialConsumption(project, customSheet = null) {
    const rows = cutList(project);
    const sheetWidth = Number(customSheet?.sheetWidth || project.settings?.sheetWidth || 2800);
    const sheetHeight = Number(customSheet?.sheetHeight || project.settings?.sheetHeight || 2070);
    const sheetArea = (sheetWidth * sheetHeight) / 1000000;
    const wasteFactor = Number(project.settings?.wasteFactor ?? 10);
    let totalNetArea = 0;
    let totalPieces = 0;
    const items = rows.map((r) => {
      const pieceNet = (r.length * r.width) / 1000000;
      const rowNet = pieceNet * r.quantity;
      const pieceShare = sheetArea > 0 ? (pieceNet / sheetArea) * 100 : 0;
      totalNetArea += rowNet;
      totalPieces += r.quantity;
      return {
        ...r,
        pieceNet: Number(pieceNet.toFixed(4)),
        pieceShare: Number(pieceShare.toFixed(2)),
        rowNet: Number(rowNet.toFixed(4)),
      };
    });
    const totalGrossArea = totalNetArea * (1 + wasteFactor / 100);
    const sheetsRequired = sheetArea > 0 ? totalGrossArea / sheetArea : 0;
    const sheetsCount = Math.ceil(sheetsRequired);
    const byMaterial = {};
    for (const item of items) {
      const k = item.material || "Neuvedeno";
      if (!byMaterial[k]) {
        byMaterial[k] = {
          material: k,
          materialKind: item.materialKind,
          totalPieces: 0,
          netArea: 0,
        };
      }
      byMaterial[k].totalPieces += item.quantity;
      byMaterial[k].netArea += item.rowNet;
    }
    const materialSummary = Object.values(byMaterial).map((m) => {
      const gross = m.netArea * (1 + wasteFactor / 100);
      const sheets = sheetArea > 0 ? Math.ceil(gross / sheetArea) : 0;
      return {
        ...m,
        netArea: Number(m.netArea.toFixed(3)),
        grossArea: Number(gross.toFixed(3)),
        sheetsCount: sheets,
      };
    });
    return {
      sheetWidth,
      sheetHeight,
      sheetArea: Number(sheetArea.toFixed(3)),
      wasteFactor,
      totalNetArea: Number(totalNetArea.toFixed(3)),
      totalGrossArea: Number(totalGrossArea.toFixed(3)),
      sheetsRequired: Number(sheetsRequired.toFixed(2)),
      sheetsCount,
      totalPieces,
      items,
      materialSummary,
    };
  }
  function exportCSV(project) {
    const cell = (value) => {
      let s = String(value ?? "");
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
      return '"' + s.replace(/"/g, '""') + '"';
    };
    const header = [
      "ID dílce",
      "Název",
      "Délka (mm)",
      "Šířka (mm)",
      "Tloušťka (mm)",
      "Počet",
      "Materiál",
      "Dolní hrana (mm)",
      "Pravá hrana (mm)",
      "Horní hrana (mm)",
      "Levá hrana (mm)",
      "Norma materiálu",
      "Třída materiálu",
      "Česká norma",
      "Použití materiálu",
      "Druh materiálu",
    ];
    const rows = cutList(project).map((r) => [
      r.partId,
      r.name,
      r.length,
      r.width,
      r.thickness,
      r.quantity,
      r.material,
      r.banding.bottom,
      r.banding.right,
      r.banding.top,
      r.banding.left,
      r.materialStandard,
      r.materialGrade,
      r.materialCSN,
      r.materialUse,
      Joinery.Materials.kind(r.materialKind)?.name || "",
    ]);
    return (
      "\uFEFF" +
      [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n")
    );
  }
  function jointGeometry(
    part,
    kind,
    { width = 18, length = 80, depth = 8, position = 100 } = {},
  ) {
    const [a, b, , d] = part.points,
      { width: pw, height: ph } = panelSize(part),
      x = unit(sub(b, a)),
      y = unit(sub(d, a)),
      world = (u, v) => add(a, add(mul(x, u), mul(y, v)));
    let u, v, w, h;
    if (kind === "dado") {
      u = 0;
      v = position;
      w = pw;
      h = width;
    } else if (kind === "groove") {
      u = position;
      v = 0;
      w = width;
      h = ph;
    } else if (kind === "tenon") {
      u = (pw - length) / 2;
      v = ph;
      w = length;
      h = width;
    } else if (kind === "miter") {
      if (width > pw || width > ph)
        throw new Error("Miter exceeds panel dimensions.");
      return {
        id: uid(),
        type: "cutout",
        layer: part?.layer || "panels",
        name: "45° miter corner",
        points: [world(pw - width, ph), world(pw, ph - width), world(pw, ph)],
        closed: true,
        depth: part.thickness,
      };
    } else {
      u = (pw - width) / 2;
      v = position;
      w = width;
      h = length;
    }
    if (
      ![width, length, depth].every((n) => Number.isFinite(n) && n > 0) ||
      position < 0 ||
      depth > part.thickness
    )
      throw new Error(
        "Use positive dimensions and a depth no greater than panel thickness.",
      );
    if (
      kind !== "tenon" &&
      (u < 0 || v < 0 || u + w > pw + 0.001 || v + h > ph + 0.001)
    )
      throw new Error("This joint does not fit inside the panel.");
    if (kind === "tenon" && (u < 0 || w > pw))
      throw new Error("Tenon exceeds the panel width.");
    return {
      id: uid(),
      type: "cutout",
      layer: part?.layer || "panels",
      name: `${kind[0].toUpperCase() + kind.slice(1)} · ${depth} mm deep`,
      points: [
        world(u, v),
        world(u + w, v),
        world(u + w, v + h),
        world(u, v + h),
      ],
      closed: true,
      depth,
    };
  }
  const visibleEntities = (project) =>
    project.entities.filter(
      (e) => project.layers.find((l) => l.id === e.layer)?.visible !== false,
    );
  function exportSVG(project) {
    const entities = visibleEntities(project),
      scene = draftingScene(entities, project.settings.units, {
        textHeight: project.settings.dimensionTextHeight || 2.5,
        termination: project.settings.dimensionTermination,
      }),
      b = sceneBounds(entities, scene),
      pad = 40,
      w = Math.max(1, b.width + pad * 2),
      h = Math.max(1, b.height + pad * 2),
      x = (p) => round(p.x - b.min.x + pad),
      y = (p) => round(b.max.y - p.y + pad),
      pieces = [];
    for (const { items } of scene) {
      const color = "#000000";
      for (const p of items) {
        const common = `stroke="${color}" stroke-width="${p.banding ? 0.7 : p.thin ? 0.25 : 0.5}" fill="${p.fill === "solid" ? color : "none"}"${p.dash ? ' stroke-dasharray="5 3"' : ""}`;
        if (p.kind === "region") {
          const d = p.polygons
            .flatMap((polygon) => polygon)
            .map(
              (ring) =>
                ring
                  .map((q, i) => `${i ? "L" : "M"}${x(q)} ${y(q)}`)
                  .join(" ") + " Z",
            )
            .join(" ");
          pieces.push(
            `<path d="${d}" stroke="${color}" stroke-width="0.5" fill="${color}" fill-opacity="0.08" fill-rule="evenodd"/>`,
          );
        }
        if (p.kind === "path")
          pieces.push(
            `<path d="${p.points.map((q, i) => `${i ? "L" : "M"}${x(q)} ${y(q)}`).join(" ")}${p.closed ? " Z" : ""}" ${common}/>`,
          );
        if (p.kind === "circle")
          pieces.push(
            `<circle cx="${x(p.center)}" cy="${y(p.center)}" r="${round(p.radius)}" ${common}/>`,
          );
        if (p.kind === "arc") {
          const pts = arcPoints(p, 160);
          pieces.push(
            `<path d="${pts.map((q, i) => `${i ? "L" : "M"}${x(q)} ${y(q)}`).join(" ")}" ${common}/>`,
          );
        }
        if (p.kind === "text") {
          const px = x(p.p), py = y(p.p);
          const rot = p.orientation === "vertical" ? ` transform="rotate(-90 ${px} ${py})"` : "";
          pieces.push(
            `<text x="${px}" y="${py}"${rot} font-family="Arial,sans-serif" font-size="${fontSize(p)}" text-anchor="${p.anchor || "middle"}" fill="${color}">${escapeHTML(p.text)}</text>`,
          );
        }
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${round(w)}mm" height="${round(h)}mm" viewBox="0 0 ${round(w)} ${round(h)}"><title>${escapeHTML(project.name)}</title><desc>Joinery manufacturing drawing. Geometry in millimeters. Dimension labels in ${project.settings.units}.</desc><rect width="100%" height="100%" fill="white"/>${pieces.join("\n")}</svg>`;
  }
  /** ASCII DXF AC1015, with registered XDATA preserving Joinery part metadata. */
  function exportDXF(project) {
    const out = [],
      annotations = new Map(
        draftingScene(project.entities, project.settings.units, {
          textHeight: project.settings.dimensionTextHeight || 2.5,
          termination: project.settings.dimensionTermination,
        }).map(({ entity, items }) => [entity.id, items]),
      ),
      pair = (code, value) => out.push(String(code), String(value)),
      pairs = (items) => items.forEach(([c, v]) => pair(c, v));
    pairs([
      [0, "SECTION"],
      [2, "HEADER"],
      [9, "$ACADVER"],
      [1, "AC1015"],
      [9, "$INSUNITS"],
      [70, 4],
      [9, "$MEASUREMENT"],
      [70, 1],
      [0, "ENDSEC"],
      [0, "SECTION"],
      [2, "TABLES"],
      [0, "TABLE"],
      [2, "APPID"],
      [70, 1],
      [0, "APPID"],
      [2, "JOINERY"],
      [70, 0],
      [0, "ENDTAB"],
      [0, "TABLE"],
      [2, "LAYER"],
      [70, project.layers.length],
    ]);
    for (const l of project.layers)
      pairs([
        [0, "LAYER"],
        [2, ascii(l.name)],
        [70, l.locked ? 4 : 0],
        [62, l.visible === false ? -7 : 7],
        [420, 0x808080],
        [6, "CONTINUOUS"],
      ]);
    pairs([
      [0, "ENDTAB"],
      [0, "ENDSEC"],
      [0, "SECTION"],
      [2, "ENTITIES"],
    ]);
    const meta = (e, skip = false) => {
      pair(1001, "JOINERY");
      const s = skip ? "SKIP" : encodeURIComponent(JSON.stringify(e));
      for (let i = 0; i < s.length; i += 240) pair(1000, s.slice(i, i + 240));
    };
    const start = (type, e) => {
      pair(0, type);
      pair(8, ascii(project.layers.find((l) => l.id === e.layer)?.name || "0"));
    };
    for (const e of project.entities) {
      if (e.type === "region") {
        let first = true;
        for (const polygon of e.polygons)
          for (const ring of polygon) {
            start("LWPOLYLINE", e);
            pairs([
              [90, ring.length],
              [70, 1],
            ]);
            ring.forEach((p) =>
              pairs([
                [10, round(p.x)],
                [20, round(p.y)],
              ]),
            );
            // Foreign CAD sees each contour; Joinery also restores the exact
            // compound topology and stock metadata from the first contour.
            meta(e, !first);
            first = false;
          }
        continue;
      }
      if (["circle", "drill", "arc"].includes(e.type)) {
        start(e.type === "arc" ? "ARC" : "CIRCLE", e);
        pairs([
          [10, round(e.center.x)],
          [20, round(e.center.y)],
          [30, 0],
          [40, round(e.radius)],
        ]);
        if (e.type === "arc")
          pairs([
            [50, round((normalizeAngle(e.start) * 180) / Math.PI)],
            [51, round((normalizeAngle(e.end) * 180) / Math.PI)],
          ]);
        meta(e);
        continue;
      }
      if (e.type === "line") {
        start("LINE", e);
        pairs([
          [10, round(e.points[0].x)],
          [20, round(e.points[0].y)],
          [30, 0],
          [11, round(e.points[1].x)],
          [21, round(e.points[1].y)],
          [31, 0],
        ]);
        meta(e);
        continue;
      }
      if (e.type === "text") {
        start("TEXT", e);
        const textPairs = [
          [10, round(e.points[0].x)],
          [20, round(e.points[0].y)],
          [30, 0],
          [40, e.size],
          [1, ascii(e.text)],
        ];
        if (e.orientation === "vertical") textPairs.push([50, 90]);
        pairs(textPairs);
        meta(e);
        continue;
      }
      if (
        ["panel", "rectangle", "polyline", "cutout", "slot"].includes(e.type)
      ) {
        const pts = vertices(e);
        start("LWPOLYLINE", e);
        pairs([
          [90, pts.length],
          [
            70,
            e.closed ||
            ["panel", "rectangle", "cutout", "slot"].includes(e.type)
              ? 1
              : 0,
          ],
        ]);
        pts.forEach((p) =>
          pairs([
            [10, round(p.x)],
            [20, round(p.y)],
          ]),
        );
        meta(e);
        continue;
      }
      let first = true;
      for (const p of annotations.get(e.id)) {
        if (p.kind === "text") {
          start("TEXT", e);
          pairs([
            [10, round(p.p.x)],
            [20, round(p.p.y)],
            [40, p.size],
            [1, ascii(p.text)],
            ...(p.orientation === "vertical" ? [[50, 90]] : []),
            [72, p.anchor ? 0 : 1],
            [11, round(p.p.x)],
            [21, round(p.p.y)],
          ]);
          meta(e, !first);
          first = false;
        } else if (p.fill === "solid") {
          start("SOLID", e);
          [...p.points, p.points[2]].forEach((q, i) =>
            pairs([
              [10 + i, round(q.x)],
              [20 + i, round(q.y)],
            ]),
          );
          meta(e, !first);
          first = false;
        } else {
          const pts = p.kind === "arc" ? arcPoints(p, 160) : p.points;
          for (let i = 1; i < pts.length; i++) {
            start("LINE", e);
            pairs([
              [10, round(pts[i - 1].x)],
              [20, round(pts[i - 1].y)],
              [11, round(pts[i].x)],
              [21, round(pts[i].y)],
            ]);
            meta(e, !first);
            first = false;
          }
        }
      }
    }
    pairs([
      [0, "ENDSEC"],
      [0, "EOF"],
    ]);
    return out.join("\n") + "\n";
  }
  const ascii = (s) =>
    String(s)
      .replace(/Ø/g, "dia ")
      .replace(/°/g, " deg")
      .replace(/[–—]/g, "-")
      .normalize("NFKD")
      .replace(/[^\x20-\x7E]/g, "");
  function importDXF(source) {
    if (source.includes("AutoCAD Binary DXF"))
      throw new Error("Binary DXF is not supported. Save as ASCII DXF.");
    const lines = source.replace(/^\uFEFF/, "").split(/\r?\n/);
    while (lines.length && lines.at(-1).trim() === "") lines.pop();
    if (lines.length % 2) throw new Error("Malformed DXF group pairs.");
    const pairs = [];
    for (let i = 0; i < lines.length; i += 2) {
      const c = Number(lines[i].trim());
      if (!Number.isInteger(c)) throw new Error("Invalid DXF group code.");
      pairs.push([c, lines[i + 1].trim()]);
    }
    const p = emptyProject();
    p.name = "Imported DXF";
    p.layers = [];
    let unitCode = 4;
    for (let i = 0; i < pairs.length; i++)
      if (pairs[i][0] === 9 && pairs[i][1] === "$INSUNITS")
        unitCode = Number(pairs[i + 1]?.[1] || 4);
    const factor = {
      0: 1,
      1: 25.4,
      2: 304.8,
      4: 1,
      5: 10,
      6: 1000,
      7: 1e6,
      8: 0.0000254,
      9: 0.0254,
      10: 914.4,
      13: 0.001,
      14: 100,
      15: 10000,
    }[unitCode];
    if (!factor)
      throw new Error(
        `Unsupported DXF unit code ${unitCode}. Convert the file to millimeters.`,
      );
    const layers = new Map();
    const layer = (name) => {
      if (!layers.has(name)) {
        const l = {
          id: uid(),
          name,
          color: "#cccccc",
          visible: true,
          locked: false,
        };
        layers.set(name, l);
        p.layers.push(l);
      }
      return layers.get(name).id;
    };
    // Read layer records for color, visibility and locks.
    for (let i = 0; i < pairs.length; i++)
      if (pairs[i][0] === 0 && pairs[i][1] === "LAYER") {
        let j = i + 1;
        const rec = [];
        while (j < pairs.length && pairs[j][0] !== 0) rec.push(pairs[j++]);
        const value = (c) => rec.find((r) => r[0] === c)?.[1];
        const name = value(2) || "0";
        layer(name);
        const l = layers.get(name),
          color = Number(value(420));
        if (Number.isFinite(color) && value(420))
          l.color = "#" + color.toString(16).padStart(6, "0");
        l.visible = Number(value(62) || 7) >= 0;
        l.locked = !!(Number(value(70) || 0) & 4);
      }
    let section = "",
      records = [],
      record = null;
    for (let i = 0; i < pairs.length; i++) {
      const [c, v] = pairs[i];
      if (c === 0 && v === "SECTION") {
        section = pairs[i + 1]?.[1] || "";
        continue;
      }
      if (c === 0 && v === "ENDSEC") {
        if (record) {
          records.push(record);
          record = null;
        }
        section = "";
        continue;
      }
      if (section !== "ENTITIES") continue;
      if (c === 0) {
        if (record) records.push(record);
        record = { type: v, pairs: [] };
      } else if (record) record.pairs.push([c, v]);
    }
    let skipped = 0,
      poly = null;
    for (const rec of records) {
      const get = (c) => rec.pairs.find((r) => r[0] === c)?.[1],
        num = (c, fallback = 0) => Number(get(c) ?? fallback),
        pt = (x = 10, y = 20) => ({ x: num(x) * factor, y: num(y) * factor }),
        id = uid(),
        layerId = layer(get(8) || "0");
      const appIndex = rec.pairs.findIndex(
        ([c, v]) => c === 1001 && v === "JOINERY",
      );
      if (appIndex >= 0) {
        const chunks = [];
        for (let i = appIndex + 1; i < rec.pairs.length; i++) {
          if (rec.pairs[i][0] === 1001) break;
          if (rec.pairs[i][0] === 1000) chunks.push(rec.pairs[i][1]);
        }
        const s = chunks.join("");
        if (s === "SKIP") continue;
        try {
          const e = JSON.parse(decodeURIComponent(s));
          e.id = id;
          e.layer = layerId;
          p.entities.push(e);
          continue;
        } catch {
          throw new Error("Invalid Joinery DXF metadata.");
        }
      }
      let e = { id, layer: layerId };
      if (rec.type === "LINE")
        Object.assign(e, { type: "line", points: [pt(), pt(11, 21)] });
      else if (rec.type === "CIRCLE")
        Object.assign(e, {
          type: "circle",
          center: pt(),
          radius: num(40) * factor,
        });
      else if (rec.type === "ARC")
        Object.assign(e, {
          type: "arc",
          center: pt(),
          radius: num(40) * factor,
          start: (num(50) * Math.PI) / 180,
          end: (num(51) * Math.PI) / 180,
        });
      else if (rec.type === "TEXT" || rec.type === "MTEXT") {
        const txt = rec.pairs
          .filter(([c]) => c === 1 || c === 3)
          .map(([, v]) => v)
          .join("")
          .replace(/\\P/g, " ");
        const rot = num(50);
        Object.assign(e, {
          type: "text",
          points: [pt()],
          text: txt,
          size: num(40, 14) * factor,
          orientation: Math.abs(rot - 90) < 1e-2 ? "vertical" : "horizontal",
        });
      } else if (rec.type === "LWPOLYLINE") {
        const vs = [];
        for (const [c, v] of rec.pairs) {
          if (c === 10) vs.push({ x: Number(v) * factor, y: 0, bulge: 0 });
          else if (c === 20 && vs.length) vs.at(-1).y = Number(v) * factor;
          else if (c === 42 && vs.length) vs.at(-1).bulge = Number(v);
        }
        Object.assign(e, {
          type: "polyline",
          points: expandBulges(vs, !!(num(70) & 1)),
          closed: !!(num(70) & 1),
        });
      } else if (rec.type === "POLYLINE") {
        poly = { ...e, type: "polyline", points: [], closed: !!(num(70) & 1) };
        continue;
      } else if (rec.type === "VERTEX" && poly) {
        poly.points.push({ ...pt(), bulge: num(42) });
        continue;
      } else if (rec.type === "SEQEND" && poly) {
        poly.points = expandBulges(poly.points, poly.closed);
        p.entities.push(poly);
        poly = null;
        continue;
      } else {
        skipped++;
        continue;
      }
      p.entities.push(e);
    }
    if (!p.layers.length) layer("0");
    if (!p.entities.length)
      throw new Error("No supported 2D geometry found in this DXF.");
    return { project: validateProject(p), skipped, unitCode };
  }
  function expandBulges(vs, closed) {
    const pts = [];
    for (let i = 0; i < vs.length; i++) {
      const a = vs[i],
        b = vs[(i + 1) % vs.length];
      pts.push({ x: a.x, y: a.y });
      if ((i === vs.length - 1 && !closed) || !a.bulge || distance(a, b) < 1e-8)
        continue;
      const chord = sub(b, a),
        len = distance(a, b),
        theta = 4 * Math.atan(a.bulge),
        center = add(
          mul(add(a, b), 0.5),
          mul(
            { x: -chord.y / len, y: chord.x / len },
            (len * (1 - a.bulge * a.bulge)) / (4 * a.bulge),
          ),
        ),
        r = distance(center, a),
        start = Math.atan2(a.y - center.y, a.x - center.x),
        n = Math.max(8, Math.ceil((Math.abs(theta) / TAU) * 96));
      for (let j = 1; j < n; j++) {
        const t = start + (theta * j) / n;
        pts.push(add(center, { x: r * Math.cos(t), y: r * Math.sin(t) }));
      }
    }
    return pts;
  }
  /** Vector PDF: strokes/text stay crisp at any DPI; ISO landscape A3 or A4. */
  function exportPDF(
    project,
    { paper = "A3", scale = "fit", preview = false } = {},
  ) {
    const mm = 72 / 25.4,
      [width, height] =
        paper === "A4" ? [297 * mm, 210 * mm] : [420 * mm, 297 * mm],
      margin = 15 * mm,
      footer = 48 * mm,
      entities = visibleEntities(project);
    const availableW = width - margin * 2 - 8 * mm,
      availableH = height - margin * 2 - footer - 8 * mm;
    let ratio, scene, b, denominator;
    const scales = scale === "fit" ? preferredScales : [Number(scale)];
    for (const candidate of scales) {
      denominator = candidate;
      ratio = mm / candidate;
      if (!Number.isFinite(ratio) || ratio <= 0)
        throw new Error("Invalid PDF scale.");
      scene = draftingScene(entities, project.settings.units, {
        paperScale: candidate,
        textHeight: project.settings.dimensionTextHeight || 2.5,
        termination: project.settings.dimensionTermination,
      });
      b = sceneBounds(entities, scene);
      if (b.width * ratio <= availableW && b.height * ratio <= availableH)
        break;
    }
    if (b.width * ratio > availableW || b.height * ratio > availableH)
      throw new Error(
        "Drawing exceeds the chosen sheet at this scale. Use Fit or a smaller scale.",
      );
    const ox =
        margin + 4 * mm + (availableW - b.width * ratio) / 2 - b.min.x * ratio,
      oy =
        margin +
        4 * mm +
        footer +
        (availableH - b.height * ratio) / 2 -
        b.min.y * ratio,
      x = (p) => round(p.x * ratio + ox),
      y = (p) => round(p.y * ratio + oy),
      commands = ["0 J 0 j", "0 G"];
    const font = Joinery.PdfFont.context();
    const pdfText = (value, px, py, size, center = false, vertical = false) => {
      const w = font.width(value, size);
      if (vertical) {
        const ty = center ? py - w / 2 : py;
        commands.push(
          `BT 0 1 -1 0 ${round(px)} ${round(ty)} Tm /F1 ${round(size)} Tf ${font.encode(value)} Tj ET`,
        );
      } else {
        const tx = center ? px - w / 2 : px;
        commands.push(
          `BT /F1 ${round(size)} Tf ${round(tx)} ${round(py)} Td ${font.encode(value)} Tj ET`,
        );
      }
    };
    for (const { items } of scene)
      for (const p of items) {
        commands.push(
          `${round((p.banding ? 0.7 : p.thin ? 0.25 : 0.5) * mm)} w`,
          p.dash ? "[3 2] 0 d" : "[] 0 d",
        );
        if (p.kind === "text") {
          commands.push("0 g");
          pdfText(
            p.text,
            x(p.p),
            y(p.p),
            p.annotation
              ? (p.size * ratio) / font.capHeight
              : Math.max(4, p.size * ratio),
            !p.anchor,
            p.orientation === "vertical",
          );
          continue;
        }
        if (p.kind === "region") {
          const compound = p.polygons
            .flatMap((polygon) => polygon)
            .map(
              (ring) =>
                ring
                  .map((q, i) => `${x(q)} ${y(q)} ${i ? "l" : "m"}`)
                  .join(" ") + " h",
            )
            .join(" ");
          commands.push("0.97 g", compound + " B*");
          continue;
        }
        if (p.kind === "circle") {
          const cx = x(p.center),
            cy = y(p.center),
            r = p.radius * ratio,
            k = 0.5522847498 * r;
          commands.push(
            `${round(cx + r)} ${cy} m ${round(cx + r)} ${round(cy + k)} ${round(cx + k)} ${round(cy + r)} ${cx} ${round(cy + r)} c ${round(cx - k)} ${round(cy + r)} ${round(cx - r)} ${round(cy + k)} ${round(cx - r)} ${cy} c ${round(cx - r)} ${round(cy - k)} ${round(cx - k)} ${round(cy - r)} ${cx} ${round(cy - r)} c ${round(cx + k)} ${round(cy - r)} ${round(cx + r)} ${round(cy - k)} ${round(cx + r)} ${cy} c S`,
          );
          continue;
        }
        if (p.fill === "solid") commands.push("0 g");
        const pts = p.kind === "arc" ? arcPoints(p, 256) : p.points;
        if (!pts?.length) continue;
        commands.push(
          pts.map((q, i) => `${x(q)} ${y(q)} ${i ? "l" : "m"}`).join(" ") +
            (p.closed ? " h" : "") +
            (p.fill === "solid" ? " B" : " S"),
        );
      }
    commands.push("[] 0 d", "0 G", "0 g", `${round(0.25 * mm)} w`);
    const stamp = project.settings.titleBlock || {},
      sx = width - margin - 180 * mm,
      sy = margin;
    const materialNames = [
      ...new Set(
        entities
          .map((e) => Joinery.Materials.kind((e.part || e).materialKind)?.name)
          .filter(Boolean),
      ),
    ];
    function cell(dx, dy, w, label, value) {
      const px = sx + dx * mm,
        py = sy + dy * mm;
      commands.push(
        `${round(px)} ${round(py)} ${round(w * mm)} ${round(10 * mm)} re S`,
      );
      pdfText(label, px + 2 * mm, py + 7.5 * mm, (1.8 * mm) / font.capHeight);
      const text = String(value || "—"),
        maximum = (w - 4) * mm;
      let size = Math.max(
        (2.5 * mm) / font.capHeight,
        Math.min(
          (3.5 * mm) / font.capHeight,
          maximum / Math.max(1, font.width(text, 1)),
        ),
      );
      if (font.width(text, size) <= maximum)
        pdfText(text, px + 2 * mm, py + 2 * mm, size);
      else {
        size = (2.5 * mm) / font.capHeight;
        const lines = [];
        let remaining = text;
        while (remaining.length) {
          let end = remaining.length;
          while (font.width(remaining.slice(0, end), size) > maximum && end > 0)
            end--;
          if (!end)
            throw new Error(`Pole „${label}“ je příliš dlouhé pro razítko.`);
          if (
            end < remaining.length &&
            remaining.slice(0, end).lastIndexOf(" ") > 0
          )
            end = remaining.slice(0, end).lastIndexOf(" ");
          lines.push(remaining.slice(0, end).trim());
          remaining = remaining.slice(end).trim();
          if (lines.length > 2)
            throw new Error(
              `Pole „${label}“ je příliš dlouhé pro razítko. Zkraťte text.`,
            );
        }
        lines.forEach((line, i) =>
          pdfText(line, px + 2 * mm, py + (4.5 - i * 3) * mm, size),
        );
      }
    }
    cell(0, 30, 90, "Organizace", stamp.company);
    cell(90, 30, 90, "Materiál", stamp.material || materialNames.join(", "));
    cell(0, 20, 120, "Název výkresu", stamp.title || project.name);
    cell(120, 20, 30, "Měřítko", `1:${denominator}`);
    cell(150, 20, 30, "Jednotky", project.settings.units);
    cell(0, 10, 60, "Kreslil", stamp.author);
    cell(60, 10, 60, "Kontroloval", stamp.checked);
    cell(
      120,
      10,
      60,
      "Datum",
      stamp.date || new Date().toLocaleDateString("cs-CZ"),
    );
    cell(0, 0, 110, "Číslo výkresu", stamp.number);
    cell(110, 0, 20, "Revize", stamp.revision || "0");
    cell(130, 0, 20, "List", stamp.sheet || "1 / 1");
    cell(150, 0, 30, "Formát", paper);
    // Legend explicitly distinguishes board materials sharing a section hatch.
    const kinds = [
      ...new Set(
        entities
          .map((e) => (e.part || e).materialKind)
          .filter((id) => Joinery.Materials.kind(id)),
      ),
    ];
    pdfText("Tisk 100 %", margin, sy + 41 * mm, (2 * mm) / font.capHeight);
    for (let i = 0; i < kinds.length; i++) {
      const material = Joinery.Materials.kind(kinds[i]),
        baseline = sy + (34 - i * 5) * mm;
      pdfText(
        `${material.code}: ${material.name}`,
        margin,
        baseline,
        (1.8 * mm) / font.capHeight,
      );
    }

    // --- Page 2: Kusovník a spotřeba materiálu ---
    const consumption = materialConsumption(project);
    const p2Commands = ["0 J 0 j", "0 G"];
    const p2PdfText = (value, px, py, size, center = false) => {
      const str = String(value ?? "");
      const w = font.width(str, size);
      const tx = center ? px - w / 2 : px;
      p2Commands.push(
        `BT /F1 ${round(size)} Tf ${round(tx)} ${round(py)} Td ${font.encode(str)} Tj ET`,
      );
    };

    // Page 2 outer border
    p2Commands.push("0.5 w [] 0 d 0.2 G");
    p2Commands.push(
      `${round(margin)} ${round(margin)} ${round(width - 2 * margin)} ${round(height - 2 * margin)} re S`,
    );

    // Page 2 Header Box
    const p2HeaderY = height - margin - 17 * mm;
    const p2ContentW = width - 2 * margin;
    p2Commands.push("0.5 w 0.2 G 0.95 g");
    p2Commands.push(
      `${round(margin)} ${round(p2HeaderY)} ${round(p2ContentW)} ${round(17 * mm)} re B`,
    );
    p2Commands.push("0 g");
    p2PdfText(
      "KUSOVNÍK A SPOTŘEBA MATERIÁLU",
      margin + 5 * mm,
      p2HeaderY + 10 * mm,
      (3.6 * mm) / font.capHeight,
    );
    p2PdfText(
      `Projekt: ${project.name}`,
      margin + 5 * mm,
      p2HeaderY + 4 * mm,
      (2.2 * mm) / font.capHeight,
    );
    p2PdfText(
      `Datum: ${stamp.date || new Date().toLocaleDateString("cs-CZ")}`,
      width - margin - 45 * mm,
      p2HeaderY + 10 * mm,
      (2.0 * mm) / font.capHeight,
    );
    p2PdfText(
      `List: 2 / 2`,
      width - margin - 45 * mm,
      p2HeaderY + 4 * mm,
      (2.0 * mm) / font.capHeight,
    );

    // Page 2 Material Consumption Summary Box
    const p2SumY = p2HeaderY - 18 * mm;
    p2Commands.push("0.3 w 0.3 G 0.98 g");
    p2Commands.push(
      `${round(margin)} ${round(p2SumY)} ${round(p2ContentW)} ${round(16 * mm)} re B`,
    );
    p2Commands.push("0 g");
    p2PdfText(
      `Formát desky: ${consumption.sheetWidth} × ${consumption.sheetHeight} mm (${consumption.sheetArea} m²)`,
      margin + 4 * mm,
      p2SumY + 10.5 * mm,
      (1.9 * mm) / font.capHeight,
    );
    p2PdfText(
      `Čistá plocha dílců: ${consumption.totalNetArea} m²`,
      margin + 80 * mm,
      p2SumY + 10.5 * mm,
      (1.9 * mm) / font.capHeight,
    );
    p2PdfText(
      `Spotřeba s prořezem (${consumption.wasteFactor} %): ${consumption.totalGrossArea} m²`,
      margin + 155 * mm,
      p2SumY + 10.5 * mm,
      (1.9 * mm) / font.capHeight,
    );
    p2PdfText(
      `Potřebný počet desek: ${consumption.sheetsCount} ks (${consumption.sheetsRequired} desky)`,
      margin + 4 * mm,
      p2SumY + 4.5 * mm,
      (1.9 * mm) / font.capHeight,
    );
    p2PdfText(
      `Celkem kusů: ${consumption.totalPieces} ks (${consumption.items.length} položek)`,
      margin + 80 * mm,
      p2SumY + 4.5 * mm,
      (1.9 * mm) / font.capHeight,
    );
    const matSummaryText = consumption.materialSummary
      .map((m) => `${m.material}: ${m.netArea} m² (${m.sheetsCount} des.)`)
      .join(" · ");
    p2PdfText(
      `Materiály: ${matSummaryText || "neuvedeno"}`,
      margin + 155 * mm,
      p2SumY + 4.5 * mm,
      (1.8 * mm) / font.capHeight,
    );

    // Page 2 Table
    const tableTop = p2SumY - 4 * mm;
    const colDefs = [
      { id: "partId", title: "Poz.", w: 14 * mm, align: "center" },
      { id: "name", title: "Název dílce", w: 42 * mm, align: "left" },
      { id: "length", title: "Délka (mm)", w: 22 * mm, align: "right" },
      { id: "width", title: "Šířka (mm)", w: 22 * mm, align: "right" },
      { id: "thickness", title: "Tl. (mm)", w: 16 * mm, align: "right" },
      { id: "quantity", title: "Ks", w: 12 * mm, align: "center" },
      { id: "material", title: "Materiál", w: 46 * mm, align: "left" },
      { id: "edgeBanding", title: "Ohranění", w: 32 * mm, align: "left" },
      { id: "pieceNet", title: "Plocha/ks", w: 30 * mm, align: "right" },
      { id: "rowNet", title: "Celkem (m²)", w: 25 * mm, align: "right" },
    ];
    const sumColW = colDefs.reduce((s, c) => s + c.w, 0);
    const colScale = p2ContentW / sumColW;
    colDefs.forEach((c) => (c.w *= colScale));

    const thH = 7 * mm;
    p2Commands.push("0.4 w 0.2 G 0.9 g");
    p2Commands.push(
      `${round(margin)} ${round(tableTop - thH)} ${round(p2ContentW)} ${round(thH)} re B`,
    );
    p2Commands.push("0 g");
    let curX = margin;
    for (const col of colDefs) {
      const textX =
        col.align === "center"
          ? curX + col.w / 2
          : col.align === "right"
            ? curX + col.w - 2 * mm
            : curX + 2 * mm;
      p2PdfText(
        col.title,
        textX,
        tableTop - thH + 2.2 * mm,
        (1.9 * mm) / font.capHeight,
        col.align === "center",
      );
      curX += col.w;
    }

    const rowH = 6 * mm;
    let rowY = tableTop - thH;
    const maxRows = Math.floor((rowY - margin - 8 * mm) / rowH);
    const itemsToDraw = consumption.items.slice(0, maxRows);
    if (!itemsToDraw.length) {
      p2Commands.push("0.3 w 0.4 G 1 g");
      p2Commands.push(
        `${round(margin)} ${round(rowY - rowH)} ${round(p2ContentW)} ${round(rowH)} re B`,
      );
      p2Commands.push("0 g");
      p2PdfText(
        "Kusovník je prázdný. Přidejte dílce do projektu nebo zadejte položky v kusovníku.",
        margin + p2ContentW / 2,
        rowY - rowH + 2 * mm,
        (2.0 * mm) / font.capHeight,
        true,
      );
      rowY -= rowH;
    } else {
      itemsToDraw.forEach((item, idx) => {
        const bg = idx % 2 === 0 ? "1 g" : "0.97 g";
        p2Commands.push(`0.2 w 0.4 G ${bg}`);
        p2Commands.push(
          `${round(margin)} ${round(rowY - rowH)} ${round(p2ContentW)} ${round(rowH)} re B`,
        );
        p2Commands.push("0 g");
        let cellX = margin;
        for (const col of colDefs) {
          let val = "";
          if (col.id === "pieceNet")
            val = `${item.pieceNet} (${item.pieceShare}%)`;
          else if (col.id === "rowNet") val = `${item.rowNet}`;
          else val = String(item[col.id] ?? "");
          const textX =
            col.align === "center"
              ? cellX + col.w / 2
              : col.align === "right"
                ? cellX + col.w - 2 * mm
                : cellX + 2 * mm;
          p2PdfText(
            val,
            textX,
            rowY - rowH + 2 * mm,
            (1.8 * mm) / font.capHeight,
            col.align === "center",
          );
          cellX += col.w;
        }
        rowY -= rowH;
      });
    }
    p2Commands.push("0 g");
    p2PdfText(
      "Spotřeba na kus uvádí čistou plochu a procento z formátu desky. Celková spotřeba zahrnuje prořez materiálu.",
      margin + 2 * mm,
      margin + 2.5 * mm,
      (1.7 * mm) / font.capHeight,
    );

    const stream = commands.join("\n"),
      stream2 = p2Commands.join("\n"),
      objects = [
        `<< /Type /Catalog /Pages 2 0 R >>`,
        `<< /Type /Pages /Kids [3 0 R 10 0 R] /Count 2 >>`,
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${round(width)} ${round(height)}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
        `<< /Type /Font /Subtype /Type0 /BaseFont /LiberationSans /Encoding /Identity-H /DescendantFonts [6 0 R] /ToUnicode 9 0 R >>`,
        `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
      ];
    objects.push(...font.objects());
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${round(width)} ${round(height)}] /Resources << /Font << /F1 4 0 R >> >> /Contents 11 0 R >>`,
      `<< /Length ${stream2.length} >>\nstream\n${stream2}\nendstream`,
    );
    const encoder = new TextEncoder(),
      chunks = [encoder.encode("%PDF-1.4\n")],
      offsets = [0];
    let length = chunks[0].length;
    const append = (chunk) => {
      const bytes = typeof chunk === "string" ? encoder.encode(chunk) : chunk;
      chunks.push(bytes);
      length += bytes.length;
    };
    objects.forEach((o, i) => {
      offsets.push(length);
      append(`${i + 1} 0 obj\n`);
      for (const chunk of Array.isArray(o) ? o : [o]) append(chunk);
      append("\nendobj\n");
    });
    const xref = length;
    append(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
        offsets
          .slice(1)
          .map((n) => `${String(n).padStart(10, "0")} 00000 n \n`)
          .join("") +
        `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
    );
    const pdf = new Uint8Array(length);
    let at = 0;
    for (const chunk of chunks) {
      pdf.set(chunk, at);
      at += chunk.length;
    }
    const svg1 = Joinery.PdfPreview.render(commands, width, height, font);
    const svg2 = Joinery.PdfPreview.render(p2Commands, width, height, font);
    return preview
      ? {
          bytes: pdf,
          svg: svg1,
          pages: [svg1, svg2],
        }
      : pdf;
  }
  function download(data, filename, type) {
    const blob = new Blob([data], { type }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  }

  Joinery.Woodworking = {
    bomSummary,
    cutList,
    isInCutlist,
    materialConsumption,
    download,
    escapeHTML,
    exportCSV,
    exportDXF,
    exportPDF,
    exportSVG,
    importDXF,
    jointGeometry,
    visibleEntities,
  };
})((globalThis.Joinery = globalThis.Joinery || {}));
