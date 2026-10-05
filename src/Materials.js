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
  const kinds = Object.freeze([
    {
      id: "solid-cross",
      name: "Masiv – příčný řez",
      code: "MAS",
      pattern: "diagonal",
      note: "Tenké rovnoběžné šrafy pod úhlem 45°. Dřevinu uveďte v popisu.",
    },
    {
      id: "solid-long",
      name: "Masiv – podélný řez",
      code: "MAS",
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
      code: "DVD-T",
      pattern: "board",
      note: "Tvrdá dřevovláknitá deska. Značení řezu je doplněno označením DVD-T.",
    },
    {
      id: "laminate",
      name: "Lamino",
      code: "DTD-L",
      pattern: "laminate",
      note: "Laminovaná DTD: značení desky a tenké čáry krycí vrstvy uvnitř obrysu.",
    },
    {
      id: "glass",
      name: "Sklo",
      code: "SKLO",
      pattern: "glass",
      note: "Skupiny tří šikmých čar. Druh a tloušťku skla uveďte v popisu.",
    },
  ]);
  const kind = (id) => kinds.find((k) => k.id === id) || null;
  Joinery.Materials = {
    catalogue: Object.freeze(catalogue),
    get,
    designation,
    kinds,
    kind,
  };
})((globalThis.Joinery = globalThis.Joinery || {}));
