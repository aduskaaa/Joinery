/** Model: plain-script module. Loaded in dependency order by index.html. */
(function (Joinery) {
  "use strict";
  const { add, distance } = Joinery.Geometry;
  const uid = () =>
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const TYPES = [
    "line",
    "polyline",
    "rectangle",
    "panel",
    "circle",
    "arc",
    "slot",
    "drill",
    "cutout",
    "dimension",
    "angle",
    "radius",
    "text",
    "region",
    "leader",
    "detail",
    "crop",
  ];
  function panel(
    x,
    y,
    width,
    height,
    thickness = 18,
    name = "Panel",
    material = "Oak plywood",
    layer = "panels",
  ) {
    return {
      id: uid(),
      type: "panel",
      layer,
      name,
      points: [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ],
      closed: true,
      thickness,
      material,
      quantity: 1,
      banding: [0, 0, 0, 0],
    };
  }
  const panelSize = (e) => {
    if (e.stockPoints && e.stockPoints.length >= 4) {
      return {
        width: distance(e.stockPoints[0], e.stockPoints[1]),
        height: distance(e.stockPoints[1], e.stockPoints[2]),
      };
    }
    if (e.type === "panel" && e.points && e.points.length >= 4) {
      return {
        width: distance(e.points[0], e.points[1]),
        height: distance(e.points[1], e.points[2]),
      };
    }
    const b = Joinery.Geometry.bounds([e]);
    return {
      width: b.width,
      height: b.height,
    };
  };
  const isPart = (e) =>
    e.type === "panel" ||
    (e.type === "region" && !!e.part && !!e.stockPoints) ||
    (e.type === "polyline" && e.closed && (e.thickness != null || !!e.part)) ||
    (e.cutListEnabled === true &&
      ["rectangle", "polyline", "panel", "region"].includes(e.type));
  const isInCutlist = (e) => {
    if (!e) return false;
    if (e.cutListEnabled === false) return false;
    if (e.cutListEnabled === true)
      return ["panel", "rectangle", "polyline", "region"].includes(e.type);
    if (e.type === "panel") return true;
    if (e.type === "region" && !!e.part && !!e.stockPoints) return true;
    if (e.type === "polyline" && e.closed && (e.thickness != null || !!e.part))
      return true;
    return false;
  };
  const partSpec = (e) => (e.type === "region" ? e.part || e : e);
  function emptyProject() {
    return {
      version: 1,
      name: "Nový projekt",
      entities: [],
      customCutlist: [],
      layers: [
        {
          id: "panels",
          name: "Vrstva 1",
          color: "#cccccc",
          visible: true,
          locked: false,
        },
      ],
      view: null,
      settings: {
        units: "mm",
        grid: true,
        object: true,
        ortho: false,
        gridSize: 10,
        sheetWidth: 2800,
        sheetHeight: 2070,
        wasteFactor: 10,
      },
    };
  }
  function demoProject() {
    const p = emptyProject();
    p.name = "Ukázková skříň";
    const side = panel(0, 0, 420, 720, 18, "Bočnice"),
      shelf = panel(560, 355, 600, 320, 18, "Police"),
      rail = panel(560, 40, 600, 160, 18, "Horní příčka");
    side.quantity = 2;
    side.banding = [0, 2, 0, 0];
    shelf.quantity = 3;
    shelf.banding = [2, 0, 0, 0];
    rail.banding = [0, 0, 2, 0];
    p.entities.push(side, shelf, rail);
    const text = (x, y, text, size = 14) => ({
      id: uid(),
      type: "text",
      layer: "panels",
      points: [{ x, y }],
      text,
      size,
    });
    p.entities.push(
      text(0, 778, "01  /  BOČNICE", 17),
      text(560, 735, "02  /  POLICE", 17),
      text(560, 260, "03  /  HORNÍ PŘÍČKA", 17),
      text(165, 350, "18 mm", 17),
      text(770, 520, "18 mm", 17),
      text(770, 110, "18 mm", 17),
    );
    for (const x of [37, 383])
      for (let i = 0; i < 9; i++)
        p.entities.push({
          id: uid(),
          type: "drill",
          layer: "panels",
          center: { x, y: 130 + i * 32 },
          radius: 2.5,
          name: "Otvor pro podpěrku Ø5",
          depth: 12,
        });
    p.entities.push({
      id: uid(),
      type: "cutout",
      layer: "panels",
      name: "Drážka pro záda 6 mm",
      points: [
        { x: 12, y: 0 },
        { x: 18, y: 0 },
        { x: 18, y: 720 },
        { x: 12, y: 720 },
      ],
      closed: true,
      depth: 8,
    });
    const dim = (a, b, c, mode = "aligned") => ({
      id: uid(),
      type: "dimension",
      layer: "panels",
      points: [a, b, c],
      mode,
    });
    p.entities.push(
      dim({ x: 0, y: 0 }, { x: 420, y: 0 }, { x: 0, y: -50 }),
      dim({ x: 0, y: 0 }, { x: 0, y: 720 }, { x: -65, y: 0 }),
      dim({ x: 560, y: 355 }, { x: 1160, y: 355 }, { x: 560, y: 315 }),
      dim({ x: 1160, y: 355 }, { x: 1160, y: 675 }, { x: 1210, y: 355 }),
      dim({ x: 560, y: 40 }, { x: 1160, y: 40 }, { x: 560, y: -10 }),
    );
    return p;
  }
  function normalizeBasicLayers(project) {
    if (
      !project ||
      !Array.isArray(project.layers) ||
      project.layers.length === 0
    )
      return project;
    const basicIds = new Set(["joinery", "drilling", "dimensions"]);
    const basicNames = new Set([
      "joinery",
      "drilling",
      "dimensions",
      "vrstva 2",
      "vrstva 3",
      "vrstva 4",
    ]);
    const primaryLayer = project.layers[0];
    if (
      primaryLayer &&
      (primaryLayer.name || "").toLowerCase().trim() === "panels"
    ) {
      primaryLayer.name = "Vrstva 1";
    }
    const hasBasic = project.layers.some(
      (l, idx) =>
        idx > 0 &&
        (basicIds.has(l.id) ||
          basicNames.has((l.name || "").toLowerCase().trim())),
    );
    if (hasBasic) {
      const removedIds = new Set();
      project.layers = project.layers.filter((l, idx) => {
        if (idx === 0) return true;
        if (
          basicIds.has(l.id) ||
          basicNames.has((l.name || "").toLowerCase().trim())
        ) {
          removedIds.add(l.id);
          return false;
        }
        return true;
      });
      for (const e of project.entities || []) {
        if (removedIds.has(e.layer)) {
          e.layer = primaryLayer.id;
        }
      }
    }
    return project;
  }
  function validateProject(input) {
    if (
      !input ||
      input.version !== 1 ||
      !Array.isArray(input.entities) ||
      !Array.isArray(input.layers)
    )
      throw new Error("This is not a Joinery v1 project.");
    if (input.entities.length > 20000 || input.layers.length > 100)
      throw new Error(
        "Project exceeds the prototype limit (20,000 objects / 100 layers).",
      );
    input.customCutlist = Array.isArray(input.customCutlist)
      ? input.customCutlist
      : [];
    const finite = (n) =>
        typeof n === "number" && Number.isFinite(n) && Math.abs(n) <= 1e8,
      point = (p) => p && finite(p.x) && finite(p.y),
      layerIds = new Set(),
      ids = new Set();
    const customIds = new Set();
    for (const c of input.customCutlist) {
      if (
        !c ||
        typeof c.id !== "string" ||
        customIds.has(c.id) ||
        ![c.length, c.width, c.thickness].every((n) => finite(n) && n > 0) ||
        !Number.isInteger(c.quantity) ||
        c.quantity < 1 ||
        c.quantity > 10000 ||
        typeof c.name !== "string" ||
        c.name.length > 5000 ||
        (c.materialKind && !Joinery.Materials.kind(c.materialKind))
      )
        throw new Error("Neplatná ruční položka kusovníku.");
      customIds.add(c.id);
    }
    for (const l of input.layers) {
      if (
        !l ||
        typeof l.id !== "string" ||
        layerIds.has(l.id) ||
        typeof l.name !== "string" ||
        !/^#[0-9a-f]{6}$/i.test(l.color)
      )
        throw new Error("Invalid layer.");
      layerIds.add(l.id);
    }
    if (!input.layers.length)
      throw new Error("A project needs at least one layer.");
    for (const e of input.entities) {
      if (
        !e ||
        !TYPES.includes(e.type) ||
        typeof e.id !== "string" ||
        ids.has(e.id) ||
        !layerIds.has(e.layer)
      )
        throw new Error("Invalid object or layer reference.");
      ids.add(e.id);
      if (
        e.lineStyle &&
        !["continuous", "dashed", "dashdot"].includes(e.lineStyle)
      )
        throw new Error("Neplatný typ čáry.");
      if (
        e.lineWeight != null &&
        (!finite(e.lineWeight) || e.lineWeight <= 0 || e.lineWeight > 5)
      )
        throw new Error("Neplatná tloušťka čáry.");
      if (e.stroke != null && !/^#[0-9a-f]{6}$/i.test(e.stroke))
        throw new Error("Neplatná barva čáry.");
      if (
        e.bulges &&
        (!Array.isArray(e.bulges) ||
          e.bulges.length !== e.points?.length ||
          !e.bulges.every(finite))
      )
        throw new Error("Neplatné obloukové vrcholy.");
      if (
        e.grainVector &&
        (!Array.isArray(e.grainVector) ||
          e.grainVector.length !== 2 ||
          !e.grainVector.every(point))
      )
        throw new Error("Neplatný směr vláken.");
      if (
        e.type === "leader" &&
        (!Array.isArray(e.points) ||
          e.points.length !== 3 ||
          !e.points.every(point) ||
          typeof e.text !== "string" ||
          e.text.length > 5000)
      )
        throw new Error("Neplatná odkazová kóta.");
      if (
        e.type === "detail" &&
        (!point(e.center) ||
          !finite(e.radius) ||
          e.radius <= 0 ||
          !finite(e.factor) ||
          e.factor <= 0 ||
          e.factor > 1000 ||
          !e.points?.every(point) ||
          e.points.length !== 1 ||
          !Array.isArray(e.contents) ||
          e.contents.length > 20000 ||
          e.contents.some(
            (c) =>
              ![
                "line",
                "region",
                "arc",
                "circle",
                "drill",
                "polyline",
                "panel",
                "rectangle",
              ].includes(c.type),
          ))
      )
        throw new Error("Neplatný detail.");
      if (
        e.type === "crop" &&
        (!Array.isArray(e.points) ||
          e.points.length !== 4 ||
          !e.points.every(point) ||
          (e.mode != null && !["include", "exclude"].includes(e.mode)))
      )
        throw new Error("Neplatná oblast výkresu.");
      if (
        e.dimensionAxis != null &&
        (e.type !== "dimension" ||
          ![e.dimensionAxis.x, e.dimensionAxis.y].every(Number.isFinite) ||
          Math.hypot(e.dimensionAxis.x, e.dimensionAxis.y) < 1e-8 ||
          Math.hypot(e.dimensionAxis.x, e.dimensionAxis.y) > 1e8)
      )
        throw new Error("Neplatný směr kóty.");
      if (
        e.rotation != null &&
        (e.type !== "text" ||
          !Number.isFinite(e.rotation) ||
          Math.abs(e.rotation) > 1e10)
      )
        throw new Error("Neplatný úhel textu.");
      const materialSpec = e.part || e;
      Joinery.Markings?.validate(e);
      if (
        materialSpec?.materialKind != null &&
        materialSpec.materialKind !== "" &&
        !Joinery.Materials.kind(materialSpec.materialKind)
      )
        throw new Error("Neplatný typ materiálu.");
      if (
        e.termination != null &&
        !["slash", "open", "filled"].includes(e.termination)
      )
        throw new Error("Neplatné zakončení kóty.");
      if (
        materialSpec?.materialClass != null &&
        (typeof materialSpec.materialClass !== "string" ||
          (materialSpec.materialClass !== "" &&
            !Joinery.Materials.get(materialSpec.materialClass)))
      )
        throw new Error(
          "Unknown material class. Use a catalogue class or custom/unclassified material.",
        );
      if (
        e.groupId != null &&
        (typeof e.groupId !== "string" ||
          !e.groupId.length ||
          e.groupId.length > 200)
      )
        throw new Error("Invalid drawing group.");
      if (
        e.groupName != null &&
        (typeof e.groupName !== "string" || e.groupName.length > 120)
      )
        throw new Error("Invalid group name.");
      if (e.cutListEnabled != null && typeof e.cutListEnabled !== "boolean")
        throw new Error("Invalid physical-part flag.");
      if (e.type === "region") {
        if (
          !Array.isArray(e.polygons) ||
          !e.polygons.length ||
          e.polygons.length > 1000
        )
          throw new Error("A Boolean region needs valid closed contours.");
        let vertexCount = 0;
        for (const polygon of e.polygons) {
          if (
            !Array.isArray(polygon) ||
            !polygon.length ||
            polygon.length > 1000
          )
            throw new Error("Invalid region polygon.");
          for (const ring of polygon) {
            if (
              !Array.isArray(ring) ||
              ring.length < 3 ||
              ring.length > 20000 ||
              !ring.every(point)
            )
              throw new Error("Invalid region contour.");
            vertexCount += ring.length;
            const a = ring[0];
            const area = ring.reduce((sum, p, i) => {
              const q = ring[(i + 1) % ring.length];
              return (
                sum + (p.x - a.x) * (q.y - a.y) - (q.x - a.x) * (p.y - a.y)
              );
            }, 0);
            if (Math.abs(area) < 1e-10)
              throw new Error("Degenerate region contour.");
          }
        }
        if (vertexCount > 50000)
          throw new Error("Boolean region exceeds 50,000 vertices.");
        if (!!e.part !== !!e.stockPoints)
          throw new Error("A region part requires its stock rectangle.");
        if (e.part) {
          if (
            !Array.isArray(e.stockPoints) ||
            e.stockPoints.length !== 4 ||
            !e.stockPoints.every(point)
          )
            throw new Error("Invalid stock rectangle.");
          const spec = e.part;
          if (
            !finite(spec.thickness) ||
            spec.thickness <= 0 ||
            !Number.isInteger(spec.quantity) ||
            spec.quantity < 1 ||
            spec.quantity > 10000 ||
            typeof spec.material !== "string" ||
            !Array.isArray(spec.banding) ||
            spec.banding.length !== 4 ||
            !spec.banding.every((n) => finite(n) && n >= 0 && n <= 100)
          )
            throw new Error("Invalid region part specification.");
          const [a, b, c, d] = e.stockPoints,
            size = panelSize(e);
          if (
            size.width < 0.01 ||
            size.height < 0.01 ||
            Math.abs((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) >
              size.width * size.height * 1e-6 ||
            distance(add(a, { x: c.x - b.x, y: c.y - b.y }), d) > 1e-4
          )
            throw new Error("Stock vertices must form a rectangle.");
        }
      }
      if (
        ["circle", "drill", "arc", "radius"].includes(e.type) &&
        (!point(e.center) || !finite(e.radius) || e.radius <= 0)
      )
        throw new Error("Invalid circle geometry.");
      if (e.type === "arc" && (!finite(e.start) || !finite(e.end)))
        throw new Error("Invalid arc angles.");
      const required = {
        line: 2,
        polyline: 2,
        rectangle: 4,
        panel: 4,
        cutout: 3,
        slot: 2,
        dimension: 3,
        angle: 3,
        text: 1,
        radius: 1,
        crop: 4,
      }[e.type];
      if (
        required &&
        (!Array.isArray(e.points) ||
          e.points.length < required ||
          e.points.length > 20000 ||
          !e.points.every(point))
      )
        throw new Error("Invalid vertex geometry.");
      if (["rectangle", "panel", "crop"].includes(e.type) && e.points.length !== 4)
        throw new Error("Rectangles need exactly four vertices.");
      if (e.type === "panel") {
        const s = panelSize(e);
        if (
          !finite(e.thickness) ||
          e.thickness <= 0 ||
          s.width < 0.01 ||
          s.height < 0.01 ||
          !Number.isInteger(e.quantity) ||
          e.quantity < 1 ||
          e.quantity > 10000 ||
          typeof e.material !== "string" ||
          !Array.isArray(e.banding) ||
          e.banding.length !== 4 ||
          !e.banding.every((n) => finite(n) && n >= 0 && n <= 100)
        )
          throw new Error("Invalid panel specification.");
        const [a, b, c, d] = e.points;
        if (
          Math.abs((b.x - a.x) * (c.x - b.x) + (b.y - a.y) * (c.y - b.y)) >
            s.width * s.height * 1e-6 ||
          distance(add(a, { x: c.x - b.x, y: c.y - b.y }), d) > 1e-4
        )
          throw new Error("Panel vertices must form a rectangle.");
      }
      if (e.type === "slot" && (!finite(e.width) || e.width <= 0))
        throw new Error("Invalid slot width.");
      if (
        e.type === "text" &&
        (typeof e.text !== "string" ||
          e.text.length > 5000 ||
          !finite(e.size) ||
          e.size <= 0)
      )
        throw new Error("Invalid text annotation.");
      if (
        e.name != null &&
        (typeof e.name !== "string" || e.name.length > 5000)
      )
        throw new Error("Invalid object name.");
      if (
        e.measurementFactor != null &&
        (!finite(e.measurementFactor) ||
          e.measurementFactor <= 0 ||
          e.measurementFactor > 1000)
      )
        throw new Error("Neplatné měřítko kóty detailu.");
      if (e.target != null && !point(e.target))
        throw new Error("Neplatný bod kóty.");
      if (e.type === "detail") {
        const childIds = new Set();
        for (const c of e.contents) {
          if (childIds.has(c.id)) throw new Error("Duplicitní objekt detailu.");
          childIds.add(c.id);
        }
        validateProject({
          ...input,
          entities: e.contents.map((c) => ({
            ...c,
            layer: e.layer,
            cutListEnabled: false,
          })),
          settings: {},
          view: null,
        });
      }
      if (["polyline", "rectangle"].includes(e.type) && isInCutlist(e)) {
        if (e.thickness != null && (!finite(e.thickness) || e.thickness <= 0))
          throw new Error("Neplatná tloušťka dílce.");
        if (
          e.quantity != null &&
          (!Number.isInteger(e.quantity) ||
            e.quantity < 1 ||
            e.quantity > 10000)
        )
          throw new Error("Neplatný počet kusů.");
      }
      if (e.depth != null && (!finite(e.depth) || e.depth < 0))
        throw new Error("Invalid cut depth.");
      if (
        e.type === "dimension" &&
        !["aligned", "horizontal", "vertical"].includes(e.mode)
      )
        throw new Error("Invalid dimension mode.");
    }
    const p = structuredClone(input);
    p.name =
      typeof p.name === "string" ? p.name.slice(0, 120) : "Imported project";
    const s = p.settings || {};
    if (
      s.titleBlock != null &&
      (typeof s.titleBlock !== "object" || Array.isArray(s.titleBlock))
    )
      throw new Error("Neplatné razítko.");
    const titleBlock = Object.fromEntries(
      [
        "title",
        "number",
        "author",
        "checked",
        "date",
        "revision",
        "company",
        "material",
      ].map((key) => [
        key,
        typeof s.titleBlock?.[key] === "string"
          ? s.titleBlock[key].slice(0, 120)
          : "",
      ]),
    );
    p.settings = {
      titleBlock,
      drawingScale:
        finite(s.drawingScale) && s.drawingScale > 0 ? s.drawingScale : 10,
      defaultLineStyle: ["continuous", "dashed", "dashdot"].includes(
        s.defaultLineStyle,
      )
        ? s.defaultLineStyle
        : "continuous",
      defaultLineWeight:
        finite(s.defaultLineWeight) && s.defaultLineWeight > 0
          ? s.defaultLineWeight
          : 0.35,
      defaultMaterialKind: Joinery.Materials.kind(s.defaultMaterialKind)
        ? s.defaultMaterialKind
        : "",
      sheetLayout:
        s.sheetLayout && typeof s.sheetLayout === "object"
          ? s.sheetLayout
          : null,
      dimensionTermination: ["slash", "open", "filled"].includes(
        s.dimensionTermination,
      )
        ? s.dimensionTermination
        : "slash",
      units: ["mm", "cm", "m", "in"].includes(s.units) ? s.units : "mm",
      dimensionTextHeight: [2.5, 3.5, 5, 7].includes(s.dimensionTextHeight)
        ? s.dimensionTextHeight
        : 2.5,
      grid: s.grid !== false,
      object: s.object !== false,
      ortho: s.ortho === true,
      gridSize: finite(s.gridSize) && s.gridSize > 0 ? s.gridSize : 10,
      snapModes: Object.fromEntries(
        [
          "endpoint",
          "midpoint",
          "center",
          "intersection",
          "perpendicular",
          "parallel",
        ].map((mode) => [mode, s.snapModes?.[mode] !== false]),
      ),
    };
    if (
      !p.view ||
      !point(p.view.origin) ||
      !finite(p.view.zoom) ||
      p.view.zoom <= 0 ||
      p.view.zoom > 100
    )
      p.view = null;
    return p;
  }
  function regroupCopies(entities) {
    const mapping = new Map();
    for (const e of entities)
      if (e.groupId) {
        if (!mapping.has(e.groupId)) mapping.set(e.groupId, uid());
        e.groupId = mapping.get(e.groupId);
      }
    return entities;
  }
  function groupMembers(project, id) {
    const target = project.entities.find((e) => e.id === id);
    return target
      ? project.entities.filter(
          (e) =>
            e.id === id || (target.groupId && e.groupId === target.groupId),
        )
      : [];
  }
  class History {
    constructor() {
      this.undoStack = [];
      this.redoStack = [];
    }
    record(p) {
      this.undoStack.push(JSON.stringify(p));
      if (this.undoStack.length > 80) this.undoStack.shift();
      this.redoStack = [];
    }
    undo(p) {
      if (!this.undoStack.length) return null;
      this.redoStack.push(JSON.stringify(p));
      return JSON.parse(this.undoStack.pop());
    }
    redo(p) {
      if (!this.redoStack.length) return null;
      this.undoStack.push(JSON.stringify(p));
      return JSON.parse(this.redoStack.pop());
    }
    clear() {
      this.undoStack = [];
      this.redoStack = [];
    }
  }

  Joinery.Model = {
    History,
    regroupCopies,
    groupMembers,
    TYPES,
    demoProject,
    emptyProject,
    normalizeBasicLayers,
    panel,
    panelSize,
    isPart,
    isInCutlist,
    partSpec,
    uid,
    validateProject,
  };
})((globalThis.Joinery = globalThis.Joinery || {}));
