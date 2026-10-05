import "../src/Geometry.js";
import "../src/vendor/polygon-clipping.umd.js";
import "../src/Boolean.js";
import "../src/Materials.js";
import "../src/Model.js";
import "../src/Hatching.js";
import "../src/vendor/LiberationSansData.js";
import "../src/PdfFont.js";
import "../src/PdfPreview.js";
import "../src/Scene.js";
import "../src/Woodworking.js";
import "../src/CanvasManager.js";
import "../src/Tools.js";
export const {
  EPS,
  TAU,
  adaptiveSpacing,
  add,
  angle,
  arcPoints,
  bounds,
  circleIntersections,
  circleThrough,
  cross,
  dimensionGeometry,
  distance,
  dot,
  entityCenter,
  hitDistance,
  intersection,
  length,
  lineCircleIntersections,
  midpoint,
  mul,
  normalizeAngle,
  offsetEntity,
  onArc,
  perpendicular,
  pointInPolygon,
  pointInRegion,
  projectPoint,
  rotatePoint,
  segments,
  slotPoints,
  snapPoint,
  sub,
  transformEntity,
  unit,
  vertices,
} = globalThis.Joinery.Geometry;
export const {
  History,
  TYPES,
  demoProject,
  emptyProject,
  normalizeBasicLayers,
  panel,
  panelSize,
  isPart,
  partSpec,
  uid,
  validateProject,
} = globalThis.Joinery.Model;
export const { measure, path, primitives, text, unitFactor } =
  globalThis.Joinery.Scene;
export const {
  bomSummary,
  cutList,
  download,
  escapeHTML,
  exportCSV,
  exportDXF,
  exportPDF,
  exportSVG,
  importDXF,
  jointGeometry,
  materialConsumption,
  visibleEntities,
} = globalThis.Joinery.Woodworking;
export const { CanvasManager } = globalThis.Joinery.CanvasManager;
export const { DRAW_TOOLS, EDIT_TOOLS, Tools } = globalThis.Joinery.Tools;

export const { booleanPolygons, toPolygons, polygonArea, isBooleanShape } =
  globalThis.Joinery.Boolean;

export function pdfText(bytes) {
  const s = Buffer.from(bytes).toString("latin1"),
    map = new Map();
  for (const section of s.matchAll(/beginbfchar([\s\S]*?)endbfchar/g))
    for (const m of section[1].matchAll(/<([0-9a-f]+)> <([0-9a-f]+)>/g))
      map.set(m[1], String.fromCodePoint(parseInt(m[2], 16)));
  return [...s.matchAll(/<([0-9a-f]+)> Tj/g)]
    .map((m) =>
      m[1]
        .match(/.{4}/g)
        .map((g) => map.get(g) || "?")
        .join(""),
    )
    .join("\n");
}
