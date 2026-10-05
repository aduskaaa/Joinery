/** Materials: declared EN / ČSN product classes; no automatic grading of stock. */
(function (Joinery) {
  "use strict";
  const catalogue = [];
  function family(name, standard, classes) {
    for (const [id, grade, use] of classes)
      catalogue.push(
        Object.freeze({
          id,
          name,
          standard,
          csn: standard ? `ČSN ${standard}` : "",
          grade,
          use,
        }),
      );
  }
  family("Particleboard", "EN 312", [
    ["pb-p1", "P1", "General purpose · dry"],
    ["pb-p2", "P2", "Interior furniture · dry"],
    ["pb-p3", "P3", "Non-load-bearing · humid"],
    ["pb-p4", "P4", "Load-bearing · dry"],
    ["pb-p5", "P5", "Load-bearing · humid"],
    ["pb-p6", "P6", "Heavy-duty load-bearing · dry"],
    ["pb-p7", "P7", "Heavy-duty load-bearing · humid"],
  ]);
  family("MDF", "EN 622-5", [
    ["mdf", "MDF", "General purpose · dry"],
    ["mdf-h", "MDF.H", "General purpose · humid"],
    ["mdf-la", "MDF.LA", "Load-bearing · dry"],
    ["mdf-hls", "MDF.HLS", "Load-bearing · humid · short-duration loading"],
  ]);
  family("OSB", "EN 300", [
    ["osb-1", "OSB/1", "General purpose / interior furniture · dry"],
    ["osb-2", "OSB/2", "Load-bearing · dry"],
    ["osb-3", "OSB/3", "Load-bearing · humid"],
    ["osb-4", "OSB/4", "Heavy-duty load-bearing · humid"],
  ]);
  family("Plywood", "EN 636", [
    ["ply-1-ns", "636-1 NS", "Non-structural · dry"],
    ["ply-2-ns", "636-2 NS", "Non-structural · humid"],
    ["ply-3-ns", "636-3 NS", "Non-structural · exterior"],
    ["ply-1-s", "636-1 S", "Structural · dry"],
    ["ply-2-s", "636-2 S", "Structural · humid"],
    ["ply-3-s", "636-3 S", "Structural · exterior"],
  ]);
  family("Solid wood panel", "EN 13353", [
    ["swp-1-ns", "SWP/1 NS", "Non-structural · dry"],
    ["swp-2-ns", "SWP/2 NS", "Non-structural · humid"],
    ["swp-3-ns", "SWP/3 NS", "Non-structural · exterior"],
    ["swp-1-s", "SWP/1 S", "Structural · dry"],
    ["swp-2-s", "SWP/2 S", "Structural · humid"],
    ["swp-3-s", "SWP/3 S", "Structural · exterior"],
  ]);
  family("Graded solid timber", "EN 338", [
    ["timber-c16", "C16", "Declared strength class"],
    ["timber-c24", "C24", "Declared strength class"],
    ["timber-d30", "D30", "Declared strength class"],
    ["timber-d40", "D40", "Declared strength class"],
  ]);
  const byId = new Map(catalogue.map((p) => [p.id, p]));
  const get = (id) => byId.get(id) || null;
  const designation = (id) => {
    const p = get(id);
    return p ? `${p.standard} · ${p.grade}` : "Unclassified";
  };
  // Material symbols describe a section, not a strength grade or a surface texture.
  const savedKinds = Object.freeze([
    {
      id: "plywood",
      name: "Překližka",
      code: "PDP",
      pattern: "board",
      note: "Vrstvená deska; specifikace dle EN 636.",
    },
    {
      id: "mdf",
      name: "MDF",
      code: "DVD-SC",
      pattern: "board",
      note: "Dřevovláknitá deska; specifikace dle EN 622-5.",
    },
    {
      id: "solid-cross",
      name: "Masiv – příčný řez",
      code: "",
      pattern: "diagonal",
      note: "Tenké rovnoběžné šrafy pod úhlem 45°. Dřevinu uveďte v popisu.",
    },
    {
      id: "solid-long",
      name: "Masiv – podélný řez",
      code: "",
      pattern: "longitudinal",
      note: "Tenké čáry ve směru délky dílce.",
    },
    {
      id: "particleboard",
      name: "DTD",
      code: "DTD",
      pattern: "board",
      note: "Konstrukční deska: čáry kolmo k ploše desky, doplněné označením DTD.",
    },
    {
      id: "hardboard",
      name: "Sololit",
      code: "DVD",
      pattern: "board",
      note: "Dřevovláknitá deska vyráběná mokrou cestou: DVD podle předlohy.",
    },
    {
      id: "laminate",
      name: "Lamino",
      code: "DTD",
      pattern: "laminate",
      note: "Laminovaná DTD: značení desky a velmi tlustá plná čára krycí fólie na obou lících.",
    },
    {
      id: "glass",
      name: "Sklo",
      code: "SKLO",
      pattern: "glass",
      note: "Dvojice tenkých šraf pod 30° podle předlohy; druh a rozměr skla se doplní textem.",
    },
    ...[
      ["plywood-waterproof", "Vodovzdorná překližka", "PDP-H"],
      ["blockboard", "Laťovka – rostlé dřevo", "PDJ-L"],
      ["blockboard-glued", "Laťovka – lepený střed", "PDJ-LR"],
      ["blockboard-rope", "Laťovka – motouzový střed", "PDJ-LM"],
      ["blockboard-heart", "Laťovka – středové řezivo", "PDJ-LS"],
      ["blockboard-veneer", "Laťovka – klížené dýhové pásky", "PDJ-LT"],
      ["composite", "Složená deska", "PDS"],
      ["honeycomb", "Voštinová deska", "PDS-V"],
      ["honeycomb-paper", "Deska s papírovými voštinami", "PDS-VP"],
      ["composite-fibre", "Deska s dřevovláknitým středem", "PDS-VD"],
      ["likus", "Likus", "PDS-L"],
      ["fibre-dry-hard", "Suchá dřevovláknitá – tvrdá", "DVD-SC-T"],
      ["fibre-dry-medium", "Suchá dřevovláknitá – středně tvrdá", "DVD-SC-PT"],
      ["fibre-dry-soft", "Suchá dřevovláknitá – měkká", "DVD-SC-M"],
      ["particle-extruded", "Výtlačně lisovaná DTD – plná", "DTD-VLP"],
      ["particle-hollow", "Výtlačně lisovaná DTD – vylehčená", "DTD-VLV"],
      ["fibre-particle", "Vláknitotřísková deska", "VTD"],
      ["sawdust", "Pilinová deska", "PID"],
      ["shive-sanded", "Pazdeřová deska – broušená", "PAD-B"],
      ["shive-unsanded", "Pazdeřová deska – nebroušená", "PAD-N"],
    ].map(([id, name, code]) => ({
      id,
      name,
      code,
      pattern: "board",
      note: "Tenké šrafy kolmo k líci; značka podle tabulky 2 poslané předlohy.",
    })),
    {
      id: "solid-panel",
      name: "Spárovka",
      code: "SP",
      pattern: "longitudinal",
      note: "Spárovka se podle předlohy označuje SP.",
    },
    ...[
      ["metal", "Kovy", "diagonal"],
      ["plastic", "Plasty", "plastic"],
      ["rubber", "Pryž", "rubber"],
      ["stone", "Kámen", "stone"],
      ["putty", "Tmely", "putty"],
      ["insulation", "Izolace", "insulation"],
    ].map(([id, name, pattern]) => ({
      id,
      name,
      pattern,
      code: "",
      note: "Grafické označení podle tabulky 4 poslané předlohy.",
    })),
  ]);
  // Show only the basic workshop materials; retain saved designations for imports.
  const kind = (id) => savedKinds.find((k) => k.id === id) || null;
  const kinds = Object.freeze(
    [
      "solid-cross",
      "solid-long",
      "particleboard",
      "hardboard",
      "laminate",
      "glass",
    ].map(kind),
  );
  const choices = (current = "") => {
    const saved = kind(current);
    return saved && !kinds.some((k) => k.id === current)
      ? [...kinds, { ...saved, name: `${saved.name} (uložený materiál)` }]
      : kinds;
  };
  const species = Object.freeze(
    [
      ["SM", "Smrk"],
      ["JD", "Jedle"],
      ["DG", "Douglaska"],
      ["BO", "Borovice"],
      ["VJ", "Vejmutovka"],
      ["MD", "Modřín"],
      ["DB", "Dub"],
      ["CER", "Dub cer"],
      ["BK", "Buk"],
      ["JS", "Jasan"],
      ["JV", "Javor"],
      ["AK", "Akát"],
      ["HB", "Habr"],
      ["JL", "Jilm"],
      ["OR", "Ořešák vlašský"],
      ["BR", "Bříza"],
      ["SV", "Švestka"],
      ["TR", "Třešeň"],
      ["LP", "Lípa"],
      ["OL", "Olše"],
      ["TP", "Topol"],
      ["KS", "Jírovec"],
      ["ABA", "Abachi"],
      ["ANI", "Aningeri"],
      ["AVO", "Avodire"],
      ["BUB", "Bubinga"],
      ["DIB", "Dibetou"],
      ["EBE", "Eben"],
      ["KTO", "Koto"],
      ["LMB", "Limba"],
      ["MAH", "Mahagon"],
      ["MAC", "Makore"],
      ["MAN", "Mansonia"],
      ["OKU", "Okoume"],
      ["OVE", "Ovengol"],
      ["PAL", "Paldao"],
      ["PLR", "Palisandr"],
      ["TEK", "Teak"],
      ["ZIN", "Zingana"],
    ].map(([id, name]) => Object.freeze({ id, name: `${name} (${id})` })),
  );
  const markingKeys = Object.freeze([
    "woodSpecies",
    "markSize",
    "showMaterialLabel",
    "hatchReverse",
    "hatchSpacing",
    "faceLayer",
    "faceDirection",
    "coreDirection",
  ]);
  const mark = (spec) => {
    const material = kind(spec.materialKind);
    if (!material) return "";
    const code =
      material.id.startsWith("solid-") && material.id !== "solid-panel"
        ? spec.woodSpecies || ""
        : material.code || material.name;
    const size = String(spec.markSize || "")
      .trim()
      .replace(/(\d)\.(\d)/g, "$1,$2")
      .replace(/\s*[x×]\s*/g, " × ");
    return [code, size].filter(Boolean).join(" ");
  };
  const marking = (spec) =>
    Object.fromEntries(
      markingKeys
        .filter((k) => spec?.[k] !== undefined)
        .map((k) => [k, spec[k]]),
    );
  Joinery.Materials = {
    catalogue: Object.freeze(catalogue),
    get,
    designation,
    kinds,
    choices,
    kind,
    species,
    markingKeys,
    mark,
    marking,
  };
})((globalThis.Joinery = globalThis.Joinery || {}));
