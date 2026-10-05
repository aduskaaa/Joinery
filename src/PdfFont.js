/** Offline TrueType metrics and Unicode PDF text. No network or font service. */
(function (J) {
  "use strict";
  let metrics;
  function load() {
    if (metrics) return metrics;
    const bytes = Uint8Array.from(atob(J.PdfFontData), (c) => c.charCodeAt(0)),
      d = new DataView(bytes.buffer),
      u16 = (n) => d.getUint16(n),
      i16 = (n) => d.getInt16(n),
      u32 = (n) => d.getUint32(n),
      tables = {};
    for (let i = 0; i < u16(4); i++) {
      const a = 12 + i * 16;
      tables[String.fromCharCode(...bytes.slice(a, a + 4))] = u32(a + 8);
    }
    const upem = u16(tables.head + 18),
      count = u16(tables.hhea + 34),
      cmap = tables.cmap;
    let subtable;
    for (let i = 0; i < u16(cmap + 2); i++) {
      const record = cmap + 4 + i * 8,
        at = cmap + u32(record + 4);
      if (u16(at) === 4) {
        subtable = at;
        if (u16(record) === 3 && u16(record + 2) === 1) break;
      }
    }
    if (subtable == null)
      throw new Error("Písmo neobsahuje podporovanou tabulku Unicode.");
    const segments = u16(subtable + 6) / 2,
      end = subtable + 14,
      start = end + 2 * segments + 2,
      delta = start + 2 * segments,
      range = delta + 2 * segments;
    function glyph(cp) {
      // The technical diameter sign is drawn with the embedded slashed-O glyph.
      // Keep its original Unicode identity in the PDF's separate CID mapping.
      if (cp === 0x2300) cp = 0x00d8;
      for (let i = 0; i < segments; i++)
        if (cp <= u16(end + 2 * i)) {
          if (cp < u16(start + 2 * i)) return 0;
          const offset = u16(range + 2 * i),
            diff = i16(delta + 2 * i);
          if (!offset) return (cp + diff) & 65535;
          const g = u16(range + 2 * i + offset + 2 * (cp - u16(start + 2 * i)));
          return g ? (g + diff) & 65535 : 0;
        }
      return 0;
    }
    const advance = (gid) =>
      (u16(tables.hmtx + Math.min(gid, count - 1) * 4) / upem) * 1000;
    const os = tables["OS/2"],
      capHeight = os && u16(os) >= 2 ? i16(os + 88) / upem : 0.688;
    metrics = {
      bytes,
      glyph,
      advance,
      capHeight,
      ascent: (i16(tables.hhea + 4) / upem) * 1000,
      descent: (i16(tables.hhea + 6) / upem) * 1000,
      bbox: [36, 38, 40, 42].map((n) => (i16(tables.head + n) / upem) * 1000),
    };
    return metrics;
  }
  function context() {
    const m = load(),
      used = new Map(),
      characters = new Map();
    function encode(text) {
      let hex = "";
      for (const ch of String(text)) {
        const cp = ch.codePointAt(0),
          gid = m.glyph(cp);
        if (!used.has(cp)) {
          const cid = used.size + 1;
          used.set(cp, { cid, gid });
          characters.set(cid, cp);
        }
        hex += used.get(cp).cid.toString(16).padStart(4, "0");
      }
      return `<${hex}>`;
    }
    const width = (text, size) =>
      [...String(text)].reduce(
        (sum, ch) =>
          sum + (m.advance(m.glyph(ch.codePointAt(0))) * size) / 1000,
        0,
      );
    function objects(base = 6) {
      const pairs = [...used.entries()].map(([cp, { cid, gid }]) => ({
          cp,
          cid,
          gid,
        })),
        hex = (n) => n.toString(16).padStart(4, "0");
      const map = [
        "/CIDInit /ProcSet findresource begin",
        "12 dict begin begincmap",
        "/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def",
        "/CMapName /Unicode def /CMapType 2 def",
        "1 begincodespacerange <0000> <FFFF> endcodespacerange",
      ];
      for (let i = 0; i < pairs.length; i += 100) {
        const chunk = pairs.slice(i, i + 100);
        map.push(
          `${chunk.length} beginbfchar`,
          ...chunk.map(
            ({ cid, cp }) =>
              `<${hex(cid)}> <${cp <= 65535 ? hex(cp) : hex(0xd800 + ((cp - 0x10000) >> 10)) + hex(0xdc00 + ((cp - 0x10000) & 1023))}>`,
          ),
          "endbfchar",
        );
      }
      map.push("endcmap CMapName currentdict /CMap defineresource pop end end");
      const cm = map.join("\n");
      const cidMap = new Uint8Array((pairs.length + 1) * 2);
      for (const { cid, gid } of pairs) {
        cidMap[cid * 2] = gid >> 8;
        cidMap[cid * 2 + 1] = gid & 255;
      }
      return [
        `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /LiberationSans /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor ${base + 1} 0 R /CIDToGIDMap ${base + 4} 0 R /W [${pairs.map(({ cid, gid }) => `${cid} [${Math.round(m.advance(gid))}]`).join(" ")}] >>`,
        `<< /Type /FontDescriptor /FontName /LiberationSans /Flags 32 /FontBBox [${m.bbox.map(Math.round).join(" ")}] /ItalicAngle 0 /Ascent ${Math.round(m.ascent)} /Descent ${Math.round(m.descent)} /CapHeight ${Math.round(m.capHeight * 1000)} /StemV 80 /FontFile2 ${base + 2} 0 R >>`,
        [
          new TextEncoder().encode(
            `<< /Length ${m.bytes.length} /Length1 ${m.bytes.length} >>\nstream\n`,
          ),
          m.bytes,
          new TextEncoder().encode("\nendstream"),
        ],
        `<< /Length ${cm.length} >>\nstream\n${cm}\nendstream`,
        [
          new TextEncoder().encode(`<< /Length ${cidMap.length} >>\nstream\n`),
          cidMap,
          new TextEncoder().encode("\nendstream"),
        ],
      ];
    }
    const decode = (hex) =>
      (hex.match(/.{4}/g) || [])
        .map((g) => {
          const cp = characters.get(parseInt(g, 16)) || 0xfffd;
          return String.fromCodePoint(cp === 0x2300 ? 0x00d8 : cp);
        })
        .join("");
    return { ...m, encode, decode, width, objects };
  }
  J.PdfFont = { context, load };
})((globalThis.Joinery = globalThis.Joinery || {}));
