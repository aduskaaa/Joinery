import { pdfText } from "./support.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  emptyProject,
  panel,
  validateProject,
  exportPDF,
  exportSVG,
  exportDXF,
  importDXF,
  cutList,
  bomSummary,
  transformEntity,
} from "./support.js";
const { draftingScene, fontSize, monochrome, sceneBounds } =
  globalThis.Joinery.Scene;
const { regroupCopies, groupMembers } = globalThis.Joinery.Model;
const dimension = (a, b) => ({
  id: `dim-${a}-${b}`,
  type: "dimension",
  layer: "panels",
  mode: "horizontal",
  points: [
    { x: a, y: 40 },
    { x: b, y: 40 },
    { x: a, y: 50 },
  ],
});

test("paper dimension lettering is scale-independent and has the selected capital height", () => {
  const project = emptyProject();
  project.entities = [panel(0, 0, 40, 150), dimension(0, 13)];
  project.settings.dimensionTextHeight = 3.5;
  assert.equal(validateProject(project).settings.dimensionTextHeight, 3.5);
  const expected = Number(
    (((3.5 / Joinery.PdfFont.load().capHeight) * 72) / 25.4).toFixed(4),
  );
  for (const scale of ["2", "5", "10"]) {
    const pdf = new TextDecoder().decode(
      exportPDF(project, { paper: "A4", scale }),
    );
    assert.ok(pdf.includes(`/F1 ${expected} Tf`));
  }
  assert.ok(exportSVG(project).includes(`font-size="${3.5 / 0.718}"`));
});

test("compact 13/14/13 dimension labels receive separate readable positions", () => {
  const entities = [dimension(0, 13), dimension(13, 27), dimension(27, 40)];
  const scene = draftingScene(entities, "mm", {
    paperScale: 5,
    textHeight: 2.5,
  });
  const texts = scene.map((s) => s.items.find((p) => p.annotation));
  const boxes = texts.map((p) => ({
    left: p.p.x - (p.text.length * fontSize(p) * 0.62) / 2,
    right: p.p.x + (p.text.length * fontSize(p) * 0.62) / 2,
    bottom: p.p.y - p.size * 0.22,
    top: p.p.y + p.size,
  }));
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i],
        b = boxes[j];
      assert.equal(
        a.left < b.right &&
          a.right > b.left &&
          a.bottom < b.top &&
          a.top > b.bottom,
        false,
      );
    }
  assert.equal(texts[0].text, "13");
  assert.equal(texts[1].text, "14");
  const bounds = sceneBounds(entities, scene);
  assert.ok(bounds.max.y >= Math.max(...boxes.map((b) => b.top)));
});

test("automatic PDF fit uses a preferred scale and grayscale printing", () => {
  const project = emptyProject();
  project.entities = [
    panel(0, 0, 40, 250),
    dimension(0, 13),
    dimension(13, 27),
    dimension(27, 40),
  ];
  const pdf = new TextDecoder().decode(exportPDF(project, { paper: "A4" }));
  assert.match(pdfText(exportPDF(project, { paper: "A4" })), /1:5/);
  assert.doesNotMatch(pdf, /\bRG\b|\brg\b/);
  assert.match(pdf, /0\.7087 w/);
  assert.match(pdf, /1\.4173 w/);
  assert.ok(exportSVG(project).includes('stroke="#000000"'));
  for (const theme of [false, true])
    for (const hex of ["#a2d9b3", "#d4b17b", "#808080"]) {
      const rgb = monochrome(hex, theme).match(/\d+/g);
      assert.equal(rgb[0], rgb[1]);
      assert.equal(rgb[1], rgb[2]);
    }
});

test("projected views are excluded from all cut-list exports and usage is never inferred", () => {
  const project = emptyProject();
  project.entities = [panel(0, 0, 40, 250), panel(60, 0, 40, 250)];
  project.entities[0].cutListEnabled = false;
  assert.equal(cutList(project).length, 1);
  assert.deepEqual(bomSummary(project), {
    parts: 1,
    quantity: 1,
    materials: 1,
  });
  assert.equal("area" in cutList(project)[0], false);
  project.entities[1].cutListEnabled = false;
  assert.equal(cutList(validateProject(project)).length, 0);
});

test("group copies and array instances stay independent and survive JSON/DXF round trips", () => {
  const project = emptyProject();
  project.entities = [panel(0, 0, 40, 250), panel(60, 0, 40, 250)];
  for (const e of project.entities)
    Object.assign(e, {
      groupId: "views",
      groupName: "Leg views",
      cutListEnabled: false,
    });
  const copies = regroupCopies(
    project.entities.map((e) =>
      transformEntity(e, (p) => ({ x: p.x + 100, y: p.y })),
    ),
  );
  assert.equal(copies[0].groupId, copies[1].groupId);
  assert.notEqual(copies[0].groupId, "views");
  const second = regroupCopies(structuredClone(project.entities));
  assert.notEqual(second[0].groupId, copies[0].groupId);
  assert.equal(groupMembers(project, project.entities[0].id).length, 2);
  assert.deepEqual(
    validateProject(JSON.parse(JSON.stringify(project))).entities,
    project.entities,
  );
  const restored = importDXF(exportDXF(project)).project;
  assert.equal(restored.entities[0].groupId, restored.entities[1].groupId);
  assert.equal(restored.entities[0].groupName, "Leg views");
  assert.equal(cutList(restored).length, 0);
  project.entities[0].groupId = { unsafe: true };
  assert.throws(() => validateProject(project), /group/);
});

test("vertical and below-object labels stay outside their dimension lines", () => {
  const project = emptyProject();
  const vertical = {
    id: "v",
    type: "dimension",
    layer: "panels",
    mode: "vertical",
    points: [
      { x: 100, y: 0 },
      { x: 100, y: 250 },
      { x: 110, y: 0 },
    ],
  };
  const below = dimension(0, 40);
  below.points[2].y = 20;
  const [v, h] = draftingScene([vertical, below], "mm", {
    paperScale: 5,
    textHeight: 2.5,
  }).map((s) => s.items.find((p) => p.annotation));
  assert.ok(v.p.x - Joinery.Scene.textWidth(v) / 2 > 110);
  assert.ok(h.p.y + h.size < 20);
});
