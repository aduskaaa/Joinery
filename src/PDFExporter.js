/** Vector PDF, independent page formats, one embedded Unicode font, no server. */
(function (J) {
  const mm = 72 / 25.4,
    F = (n) => Number(n.toFixed(5)),
    G = J.Geometry;
  class PDFExporter {
    static printLineWeight(p) {
      const weight = p.banding ? 0.7 : p.lineWeight || (p.thin ? 0.18 : 0.35);
      const series = [
        [0.13, 0.09],
        [0.18, 0.13],
        [0.25, 0.18],
        [0.35, 0.25],
        [0.5, 0.35],
        [0.7, 0.5],
      ];
      return (
        series.find(([source]) => Math.abs(source - weight) < 1e-6)?.[1] ||
        Math.max(0.03, weight * 0.7)
      );
    }
    static formats = {
      "A3-L": [420, 297],
      "A4-L": [297, 210],
      "A4-P": [210, 297],
      "A5-L": [210, 148],
    };
    static fitScale(entities, width, height, settings) {
      for (const scale of J.Scene.preferredScales) {
        const scene = J.Scene.draftingScene(entities, settings.units, {
            paperScale: scale,
            textHeight: settings.dimensionTextHeight || 2.5,
            termination: settings.dimensionTermination,
          }),
          b = J.Scene.sceneBounds(entities, scene);
        if (b.width / scale <= width && b.height / scale <= height)
          return scale;
      }
      return 100;
    }
    static defaultLayout(project) {
      const format = "A3-L",
        entities = J.Woodworking.visibleEntities(project).filter(
          (e) => e.type !== "detail" && !e.detailId,
        ),
        scale = Math.max(
          project.settings.drawingScale || 10,
          this.fitScale(entities, 380, 215, project.settings),
        );
      return {
        pages: [
          {
            id: J.Model.uid(),
            kind: "drawing",
            format,
            views: [
              {
                id: J.Model.uid(),
                type: "drawing",
                x: 15,
                y: 15,
                w: 390,
                h: 215,
                scale,
              },
              ...project.entities
                .filter((e) => e.type === "detail")
                .map((d, i) => ({
                  id: J.Model.uid(),
                  type: "detail",
                  entityId: d.id,
                  x: 15 + (i % 3) * 115,
                  y: 130,
                  w: 110,
                  h: 105,
                  scale: d.detailScale || 1,
                })),
            ],
            stamp: { x: 230, y: 247, w: 180, h: 40 },
          },
          {
            id: J.Model.uid(),
            kind: "bom",
            format: "A5-L",
            views: [],
            stamp: null,
          },
        ],
      };
    }
    static validateLayout(layout) {
      if (
        !layout ||
        !Array.isArray(layout.pages) ||
        !layout.pages.length ||
        layout.pages.length > 100
      )
        throw new Error("Neplatné tiskové listy.");
      for (const p of layout.pages) {
        if (
          !this.formats[p.format] ||
          !["drawing", "bom"].includes(p.kind) ||
          (p.kind === "bom" && !["A5-L", "A4-P"].includes(p.format))
        )
          throw new Error("Neplatný formát listu.");
        const [w, h] = this.formats[p.format];
        for (const v of [...(p.views || []), ...(p.stamp ? [p.stamp] : [])])
          if (
            !["x", "y", "w", "h"].every((k) => Number.isFinite(v[k])) ||
            v.w <= 0 ||
            v.h <= 0 ||
            v.x < 0 ||
            v.y < 0 ||
            v.x + v.w > w + 0.01 ||
            v.y + v.h > h + 0.01 ||
            (v.scale != null && (!Number.isFinite(v.scale) || v.scale <= 0))
          )
            throw new Error("Pohled nebo razítko přesahuje list.");
      }
      return layout;
    }
    static commands(project, page, font) {
      const [width, height] = this.formats[page.format],
        commands = ["0 J 0 j", "0 G", "0 g"],
        x = (v) => F(v * mm),
        y = (v) => F((height - v) * mm);
      const line = (a, b, weight = 0.18) =>
        commands.push(
          `${x(weight)} w ${x(a.x)} ${y(a.y)} m ${x(b.x)} ${y(b.y)} l S`,
        );
      const rect = (a, b, w, h) =>
        commands.push(`${x(a)} ${y(b + h)} ${x(w)} ${x(h)} re S`);
      const label = (str, a, b, size = 2.5, anchor = "start") => {
        const fs = (size * mm) / font.capHeight,
          tx =
            a * mm -
            (anchor === "center"
              ? font.width(str, fs) / 2
              : anchor === "end"
                ? font.width(str, fs)
                : 0);
        commands.push(
          `BT /F1 ${F(fs)} Tf ${F(tx)} ${y(b)} Td ${font.encode(str)} Tj ET`,
        );
      };
      commands.push(`${x(0.18)} w`);
      rect(10, 10, width - 20, height - 20);
      if (page.kind === "bom") {
        this.bomCommands(project, page, font, {
          commands,
          label,
          line,
          rect,
          width,
          height,
          x,
          y,
        });
        return commands;
      }
      const base = J.Woodworking.visibleEntities(project).filter(
        (e) => e.type !== "detail" && !e.detailId,
      );
      for (const view of page.views) {
        let entities = [
            ...base,
            ...project.entities
              .filter((e) => e.type === "detail")
              .flatMap((d) => [
                {
                  id: d.id + "-source",
                  layer: d.layer,
                  type: "circle",
                  center: d.center,
                  radius: d.radius,
                  lineStyle: "dashdot",
                  lineWeight: 0.18,
                },
                {
                  id: d.id + "-label",
                  layer: d.layer,
                  type: "text",
                  points: [
                    G.add(d.center, {
                      x: d.radius + view.scale * 2,
                      y: d.radius,
                    }),
                  ],
                  text: d.name || "Detail",
                  size: (2.5 * view.scale) / font.capHeight,
                },
              ]),
          ],
          sourceCenter = null;
        if (view.type === "detail") {
          const detail = project.entities.find(
            (e) => e.id === view.entityId && e.type === "detail",
          );
          if (!detail) continue;
          entities = [
            ...detail.contents,
            ...J.GeometryEngine.GeometryEngine.detailAnnotations(
              detail,
              J.Woodworking.visibleEntities(project),
            ),
          ];
          sourceCenter = detail.center;
        }
        const drafting = J.Scene.draftingScene(
            entities,
            project.settings.units,
            {
              paperScale: view.scale,
              textHeight: project.settings.dimensionTextHeight || 2.5,
              termination: project.settings.dimensionTermination,
            },
          ),
          scene = new Map(
            drafting.map(({ entity, items }) => [entity.id, items]),
          ),
          bounds = J.Scene.sceneBounds(entities, drafting),
          center = sourceCenter || {
            x: (bounds.min.x + bounds.max.x) / 2,
            y: (bounds.min.y + bounds.max.y) / 2,
          },
          tx = (p) => ({
            x: view.x + view.w / 2 + (p.x - center.x) / view.scale,
            y: view.y + view.h / 2 - (p.y - center.y) / view.scale,
          });
        commands.push(
          "q",
          `${x(view.x)} ${y(view.y + view.h)} ${x(view.w)} ${x(view.h)} re W n`,
        );
        for (const e of entities) {
          const clipGeometry =
            sourceCenter &&
            !["dimension", "radius", "leader", "angle", "text"].includes(
              e.type,
            );
          if (clipGeometry) {
            const d = project.entities.find((e) => e.id === view.entityId);
            commands.push(
              "q",
              this.arcPath(
                {
                  x: (view.x + view.w / 2) * mm,
                  y: (height - view.y - view.h / 2) * mm,
                },
                (d.radius / view.scale) * mm,
                0,
                Math.PI * 2,
              ),
              "W n",
            );
          }
          for (const p of scene.get(e.id) ||
            J.Scene.primitives(e, project.settings.units, {
              paperScale: view.scale,
            })) {
            const shade = p.hatch ? 1 - (p.opacity || 0.28) : 0;
            commands.push(
              `${F(shade)} G ${F(shade)} g`,
              `${x(this.printLineWeight(p))} w`,
              `${p.lineStyle === "dashdot" ? "[12 4 2 4]" : p.lineStyle === "dashed" || p.dash ? "[8 4]" : "[]"} 0 d`,
            );
            if (p.kind === "text") {
              const q = tx(p.p),
                size = p.annotation
                  ? p.size / view.scale
                  : (p.size / view.scale) * font.capHeight;
              if (p.rotation != null || p.orientation === "vertical") {
                const rotation = p.rotation ?? Math.PI / 2,
                  c = Math.cos(rotation),
                  sn = Math.sin(rotation),
                  fs = (size * mm) / font.capHeight,
                  offset =
                    p.anchor === "start"
                      ? 0
                      : font.width(p.text, fs) * (p.anchor === "end" ? 1 : 0.5),
                  px = q.x * mm - c * offset,
                  py = (height - q.y) * mm - sn * offset;
                commands.push(
                  `BT ${F(c)} ${F(sn)} ${F(-sn)} ${F(c)} ${F(px)} ${F(py)} Tm /F1 ${F(fs)} Tf ${font.encode(p.text)} Tj ET`,
                );
              } else label(p.text, q.x, q.y, size, p.anchor || "center");
              continue;
            }
            if (p.kind === "circle" || p.kind === "arc") {
              const q = tx(p.center);
              commands.push(
                this.arcPath(
                  { x: q.x * mm, y: (height - q.y) * mm },
                  (p.radius / view.scale) * mm,
                  p.kind === "circle" ? 0 : p.start,
                  p.kind === "circle"
                    ? Math.PI * 2
                    : G.normalizeAngle(p.end - p.start) || Math.PI * 2,
                ),
                p.fill === "solid" ? "B" : "S",
              );
            } else {
              const rings =
                p.kind === "region" ? p.polygons.flat() : [p.points];
              for (const ring of rings) {
                ring.forEach((q, i) => {
                  const a = tx(q);
                  commands.push(`${x(a.x)} ${y(a.y)} ${i ? "l" : "m"}`);
                });
                if (p.kind === "region" || p.closed) commands.push("h");
              }
              commands.push(p.fill === "solid" ? "B" : "S");
            }
          }
          if (clipGeometry) commands.push("Q");
        }
        commands.push("Q");
        if (sourceCenter) {
          const d = project.entities.find((e) => e.id === view.entityId);
          commands.push(
            "q",
            `${x(view.x)} ${y(view.y + view.h)} ${x(view.w)} ${x(view.h)} re W n`,
            "0 G [] 0 d",
            `${x(0.18)} w`,
            this.arcPath(
              {
                x: (view.x + view.w / 2) * mm,
                y: (height - view.y - view.h / 2) * mm,
              },
              (d.radius / view.scale) * mm,
              0,
              Math.PI * 2,
            ),
            "S",
            "Q",
          );
        }
        if (view.type === "detail")
          label(
            `${project.entities.find((e) => e.id === view.entityId)?.name || "Detail"} · 1:${view.scale}`,
            view.x + view.w / 2,
            Math.min(
              view.y + view.h - 2,
              view.y +
                view.h / 2 +
                Math.max(
                  project.entities.find((e) => e.id === view.entityId)
                    ?.radius || 0,
                  (sourceCenter?.y || 0) - bounds.min.y,
                ) /
                  view.scale +
                5,
            ),
            2.5,
            "center",
          );
      }
      if (page.stamp) {
        const s = page.stamp,
          t = project.settings.titleBlock || {},
          scale =
            page.views
              .filter((v) => v.type === "drawing")
              .map((v) => "1:" + v.scale)
              .join(", ") || "—";
        commands.push("0 G 0 g [] 0 d");
        rect(s.x, s.y, s.w, s.h);
        line({ x: s.x, y: s.y + 16 }, { x: s.x + s.w, y: s.y + 16 });
        line({ x: s.x, y: s.y + 28 }, { x: s.x + s.w, y: s.y + 28 });
        line({ x: s.x + 90, y: s.y + 16 }, { x: s.x + 90, y: s.y + s.h });
        line({ x: s.x + 135, y: s.y + 28 }, { x: s.x + 135, y: s.y + s.h });
        const cell = (caption, value, a, b, w, size = 2.5) => {
          label(caption, a + 2, b + 4, 1.7);
          const fs = (size * mm) / font.capHeight,
            available = (w - 4) * mm,
            n = font.width(String(value), fs);
          label(
            String(value),
            a + 2,
            b + size + 7,
            n > available ? (size * available) / n : size,
          );
        };
        cell("Název výrobku", t.title || project.name, s.x, s.y, s.w, 3.5);
        cell("Autor", t.author || "", s.x, s.y + 16, 90);
        cell(
          "Materiál",
          t.material ||
            [
              ...new Set(
                J.BOMManager.BOMManager.rows(project).map((r) =>
                  r.material &&
                  !["Unspecified", "Neuvedeno"].includes(r.material)
                    ? r.material
                    : J.Materials.kind(r.materialKind)?.name || "",
                ),
              ),
            ]
              .filter(Boolean)
              .join(" / "),
          s.x + 90,
          s.y + 16,
          90,
        );
        cell("Číslo výkresu", t.number || "001", s.x, s.y + 28, 90);
        cell(
          "Datum",
          t.date || new Date().toLocaleDateString("cs-CZ"),
          s.x + 90,
          s.y + 28,
          45,
        );
        cell("Měřítko", scale, s.x + 135, s.y + 28, 45);
      }
      return commands;
    }
    static arcPath(c, r, start, sweep) {
      const parts = [],
        count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2))),
        step = sweep / count;
      const point = (a) => ({
          x: c.x + r * Math.cos(a),
          y: c.y + r * Math.sin(a),
        }),
        a = point(start);
      parts.push(`${F(a.x)} ${F(a.y)} m`);
      for (let i = 0; i < count; i++) {
        const t = start + i * step,
          u = t + step,
          k = (4 / 3) * Math.tan(step / 4),
          a = point(t),
          b = point(u);
        parts.push(
          `${F(a.x - k * r * Math.sin(t))} ${F(a.y + k * r * Math.cos(t))} ${F(b.x + k * r * Math.sin(u))} ${F(b.y - k * r * Math.cos(u))} ${F(b.x)} ${F(b.y)} c`,
        );
      }
      return parts.join(" ");
    }
    static bomCommands(
      project,
      page,
      font,
      { commands, label, line, rect, width, height },
    ) {
      const B = J.BOMManager.BOMManager,
        rows = B.rows(project),
        capacity = this.bomCapacity(page.format),
        start = page.offset || 0,
        chunk = rows.slice(start, start + capacity),
        columns = [0.25, 0.07, 0.08, 0.08, 0.08, 0.17, 0.17],
        available = width - 20;
      label(project.name + " – kusovník", 12, 17, 3.5);
      let cx = 10;
      const head = [
        "Název kusu",
        "Počet",
        "V",
        "Š",
        "D",
        "Spotřeba na kus",
        "Spotřeba na výrobek",
      ];
      for (let i = 0; i < 7; i++) {
        const w = columns[i] * available;
        if (i >= 5) {
          label("Spotřeba na", cx + 2, 24, 2);
          label(i === 5 ? "kus" : "výrobek", cx + 2, 28, 2);
        } else label(head[i], cx + 2, 26, 2);
        cx += w;
      }
      line({ x: 10, y: 32 }, { x: width - 10, y: 32 });
      chunk.forEach((r, j) => {
        let a = 10;
        const b = 40 + j * 8,
          cells = [
            r.name,
            r.quantity,
            r.thickness,
            r.width,
            r.length,
            B.format(r.piece, r.unit),
            B.format(r.total, r.unit),
          ];
        for (let i = 0; i < 7; i++) {
          const w = columns[i] * available,
            str = String(cells[i]),
            fs = (2.1 * mm) / font.capHeight,
            n = font.width(str, fs),
            max = (w - 3) * mm;
          label(str, a + 1.5, b, n > max ? (2.1 * max) / n : 2.1);
          a += w;
        }
        line({ x: 10, y: b + 2 }, { x: width - 10, y: b + 2 }, 0.13);
      });
      const s = B.summary(rows),
        y = height - 28;
      label(
        `Masiv: ${B.format(s.volume, "m³")}  ·  Plošný materiál: ${B.format(s.area, "m²")}`,
        12,
        y,
        2.1,
      );
      label(
        `Hrany: ${B.format(s.banding, "m")} ${Object.entries(s.edges)
          .map(([t, v]) => `${t}: ${B.format(v, "m")}`)
          .join(" · ")}`,
        12,
        y + 6,
        1.9,
      );
      label(
        `Kusovník ${Math.floor(start / capacity) + 1}/${Math.max(1, Math.ceil(rows.length / capacity))} · Rozměry V × Š × D v mm`,
        12,
        height - 14,
        1.8,
      );
    }
    static bomCapacity(format) {
      return Math.floor((this.formats[format][1] - 70) / 8);
    }
    static build(project, layout, { preview = false } = {}) {
      this.validateLayout(layout);
      const font = J.PdfFont.context(),
        pages = [];
      for (const page of layout.pages) {
        const count =
          page.kind === "bom"
            ? Math.max(
                1,
                Math.ceil(
                  J.BOMManager.BOMManager.rows(project).length /
                    this.bomCapacity(page.format),
                ),
              )
            : 1;
        for (let i = 0; i < count; i++)
          pages.push({ ...page, offset: i * this.bomCapacity(page.format) });
      }
      const rendered = pages.map((page) => ({
          page,
          commands: this.commands(project, page, font),
        })),
        objects = [
          `<< /Type /Catalog /Pages 2 0 R >>`,
          "",
          `<< /Type /Font /Subtype /Type0 /BaseFont /LiberationSans /Encoding /Identity-H /DescendantFonts [4 0 R] /ToUnicode 7 0 R >>`,
          ...font.objects(4),
        ];
      const kids = [];
      for (const { page, commands } of rendered) {
        const [w, h] = this.formats[page.format],
          pageId = objects.length + 1,
          stream = commands.join("\n");
        kids.push(`${pageId} 0 R`);
        objects.push(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${F(w * mm)} ${F(h * mm)}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`,
          `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`,
        );
      }
      objects[1] = `<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pages.length} >>`;
      const bytes = this.serialize(objects);
      return preview ? { bytes, pages: rendered, font } : bytes;
    }
    static serialize(objects) {
      const enc = new TextEncoder(),
        chunks = [],
        offsets = [0];
      let length = 0;
      const append = (s) => {
        const b = typeof s === "string" ? enc.encode(s) : s;
        chunks.push(b);
        length += b.length;
      };
      append("%PDF-1.4\n");
      objects.forEach((o, i) => {
        offsets.push(length);
        append(`${i + 1} 0 obj\n`);
        for (const part of Array.isArray(o) ? o : [o]) append(part);
        append("\nendobj\n");
      });
      const xref = length;
      append(
        `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` +
          offsets
            .slice(1)
            .map((n) => String(n).padStart(10, "0") + " 00000 n \n")
            .join("") +
          `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`,
      );
      const bytes = new Uint8Array(length);
      let i = 0;
      for (const b of chunks) {
        bytes.set(b, i);
        i += b.length;
      }
      return bytes;
    }
    static renderCanvas(canvas, commands, width, height, font, scale = 1) {
      const ctx = canvas.getContext("2d"),
        factor = scale / mm,
        ratio = devicePixelRatio || 1;
      canvas.width = Math.round(width * scale * ratio);
      canvas.height = Math.round(height * scale * ratio);
      canvas.style.width = width * scale + "px";
      canvas.style.height = height * scale + "px";
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(
        factor * ratio,
        0,
        0,
        -factor * ratio,
        0,
        height * scale * ratio,
      );
      ctx.strokeStyle = "#000";
      ctx.fillStyle = "#000";
      ctx.lineCap = "butt";
      ctx.lineJoin = "miter";
      let stack = [];
      ctx.beginPath();
      for (const command of commands) {
        if (command.startsWith("BT")) {
          let m = command.match(
              /\/F1 ([\d.]+) Tf ([\d.-]+) ([\d.-]+) Td <([0-9a-f]*)>/,
            ),
            rotation = 0;
          if (!m) {
            const v = command.match(
              /BT ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) ([\d.-]+) Tm \/F1 ([\d.]+) Tf <([0-9a-f]*)>/,
            );
            if (v) {
              m = [null, v[7], v[5], v[6], v[8]];
              rotation = Math.atan2(+v[2], +v[1]);
            }
          }
          if (m) {
            ctx.save();
            ctx.translate(+m[2], +m[3]);
            if (rotation) ctx.rotate(rotation);
            ctx.scale(1, -1);
            ctx.font = `${m[1]}px Blueprint, Arial`;
            ctx.fillText(font.decode(m[4]), 0, 0);
            ctx.restore();
          }
          continue;
        }
        const tokens =
          command.match(/\[[^\]]*\]|[-+]?\d*\.?\d+|B\*|[A-Za-z*]+/g) || [];
        for (const token of tokens) {
          if (/^[-+\d.]/.test(token) || token[0] === "[") {
            stack.push(token);
            continue;
          }
          const n = stack.map(Number);
          switch (token) {
            case "q":
              ctx.save();
              break;
            case "Q":
              ctx.restore();
              break;
            case "w":
              ctx.lineWidth = n[0];
              break;
            case "G":
            case "g": {
              const v = Math.round(n[0] * 255),
                color = `rgb(${v},${v},${v})`;
              if (token === "G") ctx.strokeStyle = color;
              else ctx.fillStyle = color;
              break;
            }
            case "d":
              ctx.setLineDash(
                stack[0].slice(1, -1).split(/\s+/).filter(Boolean).map(Number),
              );
              break;
            case "m":
              ctx.moveTo(...n);
              break;
            case "l":
              ctx.lineTo(...n);
              break;
            case "c":
              ctx.bezierCurveTo(...n);
              break;
            case "h":
              ctx.closePath();
              break;
            case "re":
              ctx.rect(...n);
              break;
            case "W":
              ctx.clip();
              break;
            case "W*":
              ctx.clip("evenodd");
              break;
            case "n":
              ctx.beginPath();
              break;
            case "S":
              ctx.stroke();
              ctx.beginPath();
              break;
            case "B":
            case "B*":
              ctx.fill(token === "B*" ? "evenodd" : "nonzero");
              ctx.stroke();
              ctx.beginPath();
              break;
          }
          stack = [];
        }
      }
    }
  }
  J.PDFExporter = { PDFExporter };
})((globalThis.Joinery = globalThis.Joinery || {}));
