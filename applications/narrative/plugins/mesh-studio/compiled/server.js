// mesh-studio/vendor/src/server/local-projects.ts
import { execFile as execFile2 } from "node:child_process";
import { randomUUID } from "node:crypto";
import { homedir as homedir2 } from "node:os";
import { readFile as readFile2, readdir as readdir2, realpath as realpath2, stat, writeFile as writeFile2, rename as rename2, unlink, mkdir as mkdir2, cp, lstat as lstat2, rm as rm2 } from "node:fs/promises";
import { resolve as resolve2, relative as relative2, extname, sep, isAbsolute, dirname as dirname2 } from "node:path";

// mesh-studio/vendor/packages/runtime/src/engine/cloth-grid.js
function sampleLine(line2, fraction) {
  const lengths = [0];
  for (let i2 = 1; i2 < line2.length; i2++) lengths.push(lengths.at(-1) + Math.hypot(line2[i2][0] - line2[i2 - 1][0], line2[i2][1] - line2[i2 - 1][1]));
  const distance = Math.max(0, Math.min(1, fraction)) * lengths.at(-1);
  let i = 1;
  while (i < line2.length - 1 && lengths[i] < distance) i++;
  const t = (distance - lengths[i - 1]) / Math.max(1e-9, lengths[i] - lengths[i - 1]);
  return line2[i - 1].map((v, axis) => v + (line2[i][axis] - v) * t);
}
var lineLength = (line2) => line2.slice(1).reduce((s, p, i) => s + Math.hypot(p[0] - line2[i][0], p[1] - line2[i][1]), 0);
function crossingFraction(seam, tier) {
  let walked = 0;
  const total = lineLength(seam), hits = [];
  for (let i = 1; i < seam.length; i++) {
    const a = seam[i - 1], b = seam[i], dx = b[0] - a[0], dy = b[1] - a[1], length = Math.hypot(dx, dy);
    for (let j = 1; j < tier.length; j++) {
      const c = tier[j - 1], d = tier[j], ex = d[0] - c[0], ey = d[1] - c[1], det = dx * ey - dy * ex;
      if (Math.abs(det) < 1e-9) continue;
      const u = ((c[0] - a[0]) * ey - (c[1] - a[1]) * ex) / det;
      const v = ((c[0] - a[0]) * dy - (c[1] - a[1]) * dx) / det;
      if (u >= -1e-8 && u <= 1 + 1e-8 && v >= -1e-8 && v <= 1 + 1e-8) hits.push((walked + u * length) / total);
    }
    walked += length;
  }
  const unique = hits.filter((v, i) => hits.findIndex((w) => Math.abs(v - w) < 1e-7) === i);
  if (unique.length !== 1) throw new RangeError("Each tier must cross every column exactly once");
  return unique[0];
}
function clothGrid(c) {
  const custom = !!(c.seams?.length || c.tiers?.length);
  const cols = c.seams?.length || (c.columns ?? 8);
  const seams = c.seams?.length ? c.seams : Array.from({ length: cols }, (_, k) => [sampleLine(c.waist, k / (cols - 1)), sampleLine(c.hem, k / (cols - 1))]);
  if (custom && seams.some((s) => lineLength(s) < 1)) throw new RangeError("Columns must have nonzero source length");
  const joints = seams.map((line2) => [0, ...c.tiers?.length ? c.tiers.map((t) => crossingFraction(line2, t)) : [0.5], 1]);
  for (const js of joints) if (js.some((v, i) => i > 0 && v - js[i - 1] < 1e-3)) throw new RangeError("Tier intersections must be ordered from waist to hem, with nonzero links");
  const n = joints[0].length - 1;
  const subdivisions = custom ? Math.max(2, Math.ceil(((c.rows ?? 5) - 1) / n)) : 0;
  const rows = custom ? n * subdivisions + 1 : c.rows ?? 5;
  const rest = new Float64Array(rows * cols * 2), fractions = [];
  for (let k = 0; k < cols; k++) {
    fractions[k] = [];
    for (let r = 0; r < rows; r++) {
      const segment = custom ? Math.min(n - 1, Math.floor(r / subdivisions)) : 0;
      const u = custom ? (r - segment * subdivisions) / subdivisions : r / (rows - 1);
      const v = custom ? joints[k][segment] + (joints[k][segment + 1] - joints[k][segment]) * u : u;
      fractions[k].push(v);
      rest.set(sampleLine(seams[k], v), (r * cols + k) * 2);
    }
  }
  if (custom) for (let r = 0; r < rows - 1; r++) for (let k = 0; k < cols - 1; k++) {
    const a = (r * cols + k) * 2, b = a + 2, d = a + cols * 2, c2 = d + 2;
    const cross = (i, j, l) => (rest[j] - rest[i]) * (rest[l + 1] - rest[i + 1]) - (rest[j + 1] - rest[i + 1]) * (rest[l] - rest[i]);
    if (cross(a, b, c2) <= 1e-6 || cross(a, c2, d) <= 1e-6) throw new RangeError("Columns must be ordered left to right without crossing");
  }
  return { custom, cols, rows, rest, seams, joints, fractions, lengths: seams.map(lineLength), top: seams.map((s) => s[0]) };
}

// mesh-studio/vendor/packages/runtime/src/rig/validate.ts
var number = (v, p, e) => {
  if (typeof v !== "number" || !Number.isFinite(v)) e.push(`${p}: expected a finite number`);
};
var positive = (v, p, e) => {
  number(v, p, e);
  if (typeof v === "number" && v <= 0) e.push(`${p}: must be positive`);
};
var nonnegative = (v, p, e) => {
  number(v, p, e);
  if (typeof v === "number" && v < 0) e.push(`${p}: must be nonnegative`);
};
var cohesion = (v, p, e) => {
  nonnegative(v, p, e);
  if (typeof v === "number" && (!Number.isInteger(v) || v > 8)) e.push(`${p}: expected an integer from 0 to 8`);
};
var integer = (v, p, e) => {
  positive(v, p, e);
  if (typeof v === "number" && !Number.isInteger(v)) e.push(`${p}: expected an integer`);
};
var wholeNumber = (v, p, e) => {
  number(v, p, e);
  if (typeof v === "number" && !Number.isInteger(v)) e.push(`${p}: expected an integer`);
};
var string = (v, p, e) => {
  if (typeof v !== "string" || !v.trim()) e.push(`${p}: expected a non-empty string`);
};
var array = (item, min = 0, max = Infinity) => (v, p, e) => {
  if (!Array.isArray(v)) {
    e.push(`${p}: expected an array`);
    return;
  }
  if (v.length < min || v.length > max) e.push(`${p}: expected ${min}..${max} items`);
  v.forEach((x, i) => item(x, `${p}[${i}]`, e));
};
var point = array(number, 2, 2);
var band = (v, p, e) => {
  point(v, p, e);
  if (Array.isArray(v) && v.length === 2 && v[0] >= v[1]) e.push(`${p}: start must be less than end`);
};
var object = (fields, optional = []) => (v, p, e) => {
  if (!v || typeof v !== "object" || Array.isArray(v)) {
    e.push(`${p}: expected an object`);
    return;
  }
  const record = v;
  for (const [key, check] of Object.entries(fields)) {
    if (record[key] === void 0 && optional.includes(key)) continue;
    check(record[key], `${p}.${key}`, e);
  }
};
var ellipseFields = { cx: number, cy: number, rx: positive, ry: positive };
var ellipse = object(ellipseFields);
var polygon = array(point, 3);
var line = array(point, 2);
var unit = (v, p, e) => {
  number(v, p, e);
  if (typeof v === "number" && (v < 0 || v > 1)) e.push(`${p}: must be between 0 and 1`);
};
var schema = (draft) => object({
  version: (v, p, e) => {
    if (v !== 1) e.push(`${p}: only version 1 is supported`);
  },
  image: object({ width: integer, height: integer }),
  head: object({
    ...ellipseFields,
    shiftX: number,
    shiftY: number,
    pivotX: number,
    pivotY: number,
    maxRoll: number,
    weightBand: band,
    turnBand: band
  }),
  body: object({
    pivotX: number,
    pivotY: number,
    maxRoll: number,
    breathBand: band,
    rollBand: band,
    chest: ellipse,
    shoulders: array(ellipse),
    hip: object({ shift: number, band })
  }, ["hip"]),
  face: object({
    nose: ellipse,
    mouth: ellipse,
    eyeA: ellipse,
    eyeB: ellipse,
    earL: ellipse,
    earR: ellipse,
    brow: object({ ...ellipseFields, band }),
    jaw: object({ ...ellipseFields, band })
  }),
  buns: object({ bunL: ellipse, bunR: ellipse }, ["bunL", "bunR"]),
  eyes: array(object({
    opening: polygon,
    roi: polygon,
    x0: number,
    x1: number,
    top: array(number, 24, 24),
    bot: array(number, 24, 24)
  }, draft ? ["x0", "x1", "top", "bot"] : []), 2, 2),
  mouth: object({
    cx: number,
    cy: number,
    angle: number,
    halfLen: positive,
    bow: number,
    area: object({ ...ellipseFields, angle: number })
  }),
  cheeks: array(point, 2, 2),
  strands: array(object({ name: string, nodes: line, sigma: positive, k: positive, max: positive })),
  accessories: array(object({
    name: string,
    pivot: point,
    tip: point,
    split: unit,
    box: array(wholeNumber, 4, 4),
    color: object({ redness: unit, minRed: number })
  })),
  hand: object({
    outline: polygon,
    jaw: line,
    jawRange: band,
    background: polygon,
    elbow: point,
    wrist: point,
    knuckle: point,
    contact: point,
    forearmShare: unit,
    armBand: band,
    wristBand: band,
    handBand: band,
    fingerXBand: band,
    fingerYBand: band,
    pinBand: band
  }),
  cloth: array(object({
    name: string,
    outline: polygon,
    waist: line,
    hem: line,
    columns: integer,
    rows: integer,
    stiffness: positive,
    damping: positive,
    max: positive,
    tierGain: positive,
    highModeDamping: positive,
    responseGain: positive,
    swing: positive,
    follow: unit,
    cohesion,
    wind: nonnegative,
    behind: (v, p, e) => {
      if (typeof v !== "boolean") e.push(`${p}: expected a boolean`);
    },
    parent: string,
    scale: positive,
    seams: array(line, 0, 64),
    tiers: array(line, 0, 8)
  }, ["tierGain", "highModeDamping", "seams", "tiers", "responseGain", "columns", "rows", "stiffness", "damping", "max", "swing", "follow", "cohesion", "wind", "behind", "parent", "scale"])),
  legs: object({
    spine: unit,
    bob: nonnegative,
    twist: nonnegative,
    pelvis: point,
    shift: nonnegative,
    tilt: nonnegative,
    bend: nonnegative,
    band,
    split: line,
    left: object({ hip: point, knee: point, ankle: point }),
    right: object({ hip: point, knee: point, ankle: point })
  }, ["spine", "bob", "twist"]),
  arms: object({
    swing: nonnegative,
    bend: nonnegative,
    inward: unit,
    left: object({ shoulder: point, elbow: point, wrist: point, split: line }),
    right: object({ shoulder: point, elbow: point, wrist: point, split: line })
  }, ["swing", "bend", "inward"]),
  mesh: object({
    baseCell: integer,
    fine: object({
      x0: wholeNumber,
      x1: wholeNumber,
      y0: wholeNumber,
      y1: wholeNumber,
      cell: integer
    }),
    handCell: integer,
    tasselCell: integer,
    eyeBallCell: integer,
    eyeCell: integer,
    spriteCell: integer,
    clothCell: integer
  }, ["clothCell"]),
  view: object({ padTop: number, padSide: number, gazeCenter: point, irisTravel: positive }, ["gazeCenter", "irisTravel"])
}, ["buns", "strands", "accessories", "hand", "cloth", "legs", "arms"]);
function validateRig(value, options = {}) {
  const errors = [];
  schema(options.draft ?? false)(value, "rig", errors);
  if (errors.length) return errors;
  const rig = value;
  rig.eyes.forEach((eye, i) => {
    const curves = ["x0", "x1", "top", "bot"];
    if (options.draft && curves.every((key) => eye[key] === void 0)) return;
    if (curves.some((key) => eye[key] === void 0)) {
      errors.push(`rig.eyes[${i}]: supply all x0/x1/top/bot fields or omit all in a draft`);
      return;
    }
    if (eye.x0 >= eye.x1) errors.push(`rig.eyes[${i}].x1: must exceed x0`);
    if (eye.top.some((y, k) => y > eye.bot[k])) errors.push(`rig.eyes[${i}].top: must not exceed bottom curve`);
  });
  if (rig.mesh.fine.x0 >= rig.mesh.fine.x1 || rig.mesh.fine.y0 >= rig.mesh.fine.y1)
    errors.push("rig.mesh.fine: rectangle must have positive area");
  if (rig.view.padTop <= -1 || rig.view.padTop >= 1 || rig.view.padSide <= -0.5)
    errors.push("rig.view: margins must leave a positive viewport");
  for (const [i, strand] of (rig.strands ?? []).entries()) {
    if (strand.nodes.some((p, j) => j > 0 && p[0] === strand.nodes[j - 1][0] && p[1] === strand.nodes[j - 1][1]))
      errors.push(`rig.strands[${i}].nodes: consecutive nodes must differ`);
  }
  for (const [i, accessory] of (rig.accessories ?? []).entries()) {
    if (accessory.box[0] < 0 || accessory.box[1] < 0 || accessory.box[2] > rig.image.width || accessory.box[3] > rig.image.height)
      errors.push(`rig.accessories[${i}].box: rectangle must stay inside the image`);
    if (accessory.split <= 0 || accessory.split >= 1) errors.push(`rig.accessories[${i}].split: must be strictly between 0 and 1`);
    if (accessory.pivot.every((n, k) => n === accessory.tip[k])) errors.push(`rig.accessories[${i}].tip: must differ from pivot`);
    if (accessory.box[0] >= accessory.box[2] || accessory.box[1] >= accessory.box[3]) errors.push(`rig.accessories[${i}].box: rectangle must have positive area`);
  }
  const clothNames = /* @__PURE__ */ new Set();
  if (rig.legs) {
    if ((rig.legs.twist ?? 0) > 15) errors.push("rig.legs.twist: must be between 0 and 15 degrees");
    const legs = rig.legs;
    for (const side of ["left", "right"]) {
      const b = legs[side];
      if (!(legs.band[0] < b.hip[1] && b.hip[1] < b.knee[1] && b.knee[1] < b.ankle[1]))
        errors.push(`rig.legs.${side}: require band start < hip y < knee y < ankle y`);
    }
    if (legs.split.some((p, i) => i > 0 && p[1] <= legs.split[i - 1][1]))
      errors.push("rig.legs.split: y coordinates must increase");
  }
  if (rig.arms) {
    if ((rig.arms.swing ?? 4) > 10) errors.push("rig.arms.swing: must be between 0 and 10 degrees");
    if ((rig.arms.bend ?? 6) > 12) errors.push("rig.arms.bend: must be between 0 and 12 degrees");
    for (const side of ["left", "right"]) {
      const arm = rig.arms[side], path = `rig.arms.${side}`;
      if (!(arm.shoulder[1] < arm.elbow[1] && arm.elbow[1] < arm.wrist[1]))
        errors.push(`${path}: require shoulder y < elbow y < wrist y`);
      for (const [key, points] of Object.entries({ shoulder: [arm.shoulder], elbow: [arm.elbow], wrist: [arm.wrist], split: arm.split })) {
        if (points.some(([x, y]) => x < 0 || y < 0 || x >= rig.image.width || y >= rig.image.height))
          errors.push(`${path}.${key}: points must stay inside the image`);
      }
      if (arm.split.some((p, i) => i > 0 && p[1] <= arm.split[i - 1][1])) {
        errors.push(`${path}.split: y coordinates must increase`);
      } else {
        const splitX = (y) => {
          let i = 0;
          while (i < arm.split.length - 2 && y > arm.split[i + 1][1]) i++;
          const a = arm.split[i], b = arm.split[i + 1];
          const t = Math.max(0, Math.min(1, (y - a[1]) / (b[1] - a[1])));
          return a[0] + (b[0] - a[0]) * t;
        };
        if ([arm.elbow, arm.wrist].some(([x, y]) => side === "left" ? splitX(y) <= x : splitX(y) >= x))
          errors.push(`${path}.split: must lie on the body side of elbow and wrist`);
      }
    }
  }
  for (const [i, cloth] of (rig.cloth ?? []).entries()) {
    if (!/^[A-Za-z0-9_-]+$/.test(cloth.name) || clothNames.has(cloth.name))
      errors.push(`rig.cloth[${i}].name: must be a unique layer-safe name`);
    if (cloth.parent !== void 0 && !clothNames.has(cloth.parent))
      errors.push(`rig.cloth[${i}].parent: must name an earlier cloth entry`);
    if ((cloth.columns ?? 2) < 2 || (cloth.rows ?? 2) < 2)
      errors.push(`rig.cloth[${i}]: columns and rows must be at least 2`);
    if (cloth.seams?.length === 1) errors.push(`rig.cloth[${i}].seams: at least two columns required`);
    if (cloth.seams?.length || cloth.tiers?.length) {
      if (cloth.seams?.some((s) => s.some((p, j) => j > 0 && p[1] <= s[j - 1][1]))) errors.push(`rig.cloth[${i}].seams: y must increase from waist to hem`);
      try {
        clothGrid(cloth);
      } catch (error) {
        errors.push(`rig.cloth[${i}]: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    clothNames.add(cloth.name);
  }
  return errors;
}

// mesh-studio/vendor/packages/runtime/src/engine/legs.js
var LEG_DEFAULTS = Object.freeze({ spine: 0.7, bob: 2, twist: 0 });

// mesh-studio/vendor/packages/runtime/src/engine/arms.js
var ARM_DEFAULTS = Object.freeze({ swing: 4, bend: 6, inward: 0.4 });

// mesh-studio/vendor/packages/runtime/src/engine/rig.js
var PARAMS = [
  { id: "angleX", label: "Face angle X", min: -30, max: 30, def: 0, group: "Head and body" },
  { id: "angleY", label: "Face angle Y", min: -30, max: 30, def: 0, group: "Head and body" },
  { id: "angleZ", label: "Face roll", min: -30, max: 30, def: 0, group: "Head and body" },
  { id: "bodyAngleX", label: "Body angle X", min: -10, max: 10, def: 0, group: "Head and body" },
  { id: "bodyAngleZ", label: "Body roll", min: -10, max: 10, def: 0, group: "Head and body" },
  { id: "breath", label: "Breath", min: 0, max: 1, def: 0, group: "Head and body" },
  { id: "eyeLOpen", label: "Left eye open", min: 0, max: 1.25, def: 1, group: "Eyes and brows" },
  { id: "eyeROpen", label: "Right eye open", min: 0, max: 1.25, def: 1, group: "Eyes and brows" },
  { id: "eyeSmile", label: "Eye smile", min: 0, max: 1, def: 0, group: "Eyes and brows" },
  { id: "gazeX", label: "Gaze X", min: -1, max: 1, def: 0, group: "Eyes and brows" },
  { id: "gazeY", label: "Gaze Y", min: -1, max: 1, def: 0, group: "Eyes and brows" },
  { id: "browY", label: "Brow Y", min: -1, max: 1, def: 0, group: "Eyes and brows" },
  { id: "browAngle", label: "Brow angle", min: -1, max: 1, def: 0, group: "Eyes and brows" },
  { id: "mouthOpen", label: "Mouth open", min: 0, max: 1, def: 0, group: "Mouth and cheeks" },
  { id: "mouthForm", label: "Mouth form (i to o)", min: -1, max: 1, def: 0, group: "Mouth and cheeks" },
  { id: "blush", label: "Blush", min: 0, max: 1, def: 0, group: "Mouth and cheeks" },
  { id: "armAngle", label: "Arm angle", min: -10, max: 10, def: 0, group: "Hand" },
  { id: "handAngle", label: "Wrist angle", min: -10, max: 10, def: 0, group: "Hand" },
  { id: "fingerTap", label: "Finger tap", min: 0, max: 1, def: 0, group: "Hand" },
  { id: "weightShift", label: "Weight shift", min: -1, max: 1, def: 0, group: "Legs" },
  ...["L", "R"].flatMap((side) => [
    { id: `armSwing${side}`, label: `Arm swing ${side}`, min: -1, max: 1, def: 0, group: "Arms" },
    { id: `elbowBend${side}`, label: `Elbow bend ${side}`, min: 0, max: 1, def: 0, group: "Arms" }
  ])
];

// mesh-studio/vendor/packages/runtime/src/lighting/settings.ts
var DEFAULT_LIGHTING = Object.freeze({
  enabled: false,
  x: 0.2,
  y: 0.2,
  z: 0.45,
  color: 16777215,
  strength: 0.8,
  intensity: 0.8,
  ambient: 0.4,
  mode: "soft",
  shadow: false,
  reach: 1.2,
  ambientColor: 15659256,
  softness: 0.45,
  specular: 0.12,
  rim: 0.3,
  detail: 0.4
});

// mesh-studio/vendor/packages/runtime/src/engine/cloth-tuning.js
var CLOTH_DEFAULTS = Object.freeze({
  responseGain: 1,
  swing: 1,
  stiffness: 1,
  damping: 1,
  follow: 0.85,
  cohesion: 3,
  wind: 0.05,
  max: 20
});
var CLOTH_OPTIONAL_DEFAULTS = Object.freeze({ tierGain: 1, highModeDamping: 1 });

// mesh-studio/vendor/packages/runtime/src/engine/lip-sync.ts
function parseLipSyncSettings(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new TypeError("lipSync: expected an object");
  const raw = input, settings = {};
  for (const key of ["granularity", "openness", "closeSpeed"]) {
    const value = raw[key];
    if (value === void 0) continue;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
      throw new RangeError(`lipSync.${key}: expected 0\u20131`);
    settings[key] = value;
  }
  if (raw.preset !== void 0) {
    if (!["calm", "default", "lively", "subtle", "big", "custom"].includes(raw.preset))
      throw new RangeError("lipSync.preset: expected calm, default, lively, subtle, big or custom");
    settings.preset = raw.preset;
  }
  return settings;
}

// mesh-studio/vendor/packages/runtime/src/engine/motions.js
var MOTIONS = {
  nod: {
    label: "Nod",
    dur: 1.7,
    tracks: {
      angleY: [[0, 0], [0.32, -13], [0.62, 2], [0.95, -9], [1.3, 1], [1.7, 0]],
      angleZ: [[0, 0], [0.4, -2], [1, -1], [1.7, 0]],
      bodyAngleX: [[0, 0], [0.5, -1.5], [1.7, 0]],
      eyeSmile: [[0, 0], [0.3, 0.45], [1.3, 0.45], [1.7, 0]],
      eyeOpen: [[0, 1], [0.3, 0.72], [1.3, 0.72], [1.7, 1]],
      mouthOpen: [[0, 0], [0.3, 0.12], [1.3, 0.12], [1.7, 0]],
      mouthForm: [[0, 0], [0.3, -0.6], [1.7, -0.3]]
    }
  },
  tilt: {
    label: "Head tilt",
    dur: 2.6,
    tracks: {
      angleZ: [[0, 0], [0.55, 17], [2, 15], [2.6, 0]],
      angleX: [[0, 0], [0.6, 8], [2, 7], [2.6, 0]],
      angleY: [[0, 0], [0.6, 4], [2.6, 0]],
      bodyAngleZ: [[0, 0], [0.8, 3], [2, 3], [2.6, 0]],
      gazeX: [[0, 0], [0.4, 0.5], [2.1, 0.4], [2.6, 0]],
      gazeY: [[0, 0], [0.4, 0.35], [2.1, 0.3], [2.6, 0]],
      browAngle: [[0, 0], [0.5, -0.7], [2.1, -0.6], [2.6, 0]],
      browY: [[0, 0], [0.5, 0.35], [2.1, 0.3], [2.6, 0]]
      // closed mouth: a barely open round mouth read as a squashed blob
    }
  },
  think: {
    label: "Thinking",
    dur: 3.6,
    tracks: {
      angleX: [[0, 0], [0.7, -11], [3, -9], [3.6, 0]],
      angleY: [[0, 0], [0.7, 9], [3, 8], [3.6, 0]],
      angleZ: [[0, 0], [0.8, 6], [3, 5], [3.6, 0]],
      gazeX: [[0, 0], [0.35, -0.8], [3.1, -0.7], [3.6, 0]],
      gazeY: [[0, 0], [0.35, 0.7], [3.1, 0.6], [3.6, 0]],
      handAngle: [[0, 0], [0.6, 3], [3, 3], [3.6, 0]],
      fingerTap: [
        [0, 0],
        [0.9, 0],
        [1.05, 1],
        [1.2, 0],
        [1.4, 1],
        [1.55, 0],
        [1.75, 1],
        [1.9, 0],
        [2.3, 0],
        [2.45, 1],
        [2.6, 0],
        [3.6, 0]
      ],
      browY: [[0, 0], [0.6, 0.25], [3, 0.2], [3.6, 0]],
      browAngle: [[0, 0], [0.6, -0.3], [3, -0.3], [3.6, 0]],
      mouthForm: [[0, 0], [0.6, 0.4], [3.6, 0]]
    }
  },
  giggle: {
    label: "Chuckle",
    dur: 2.2,
    tracks: {
      eyeOpen: [[0, 1], [0.2, 0], [1.8, 0], [2.2, 1]],
      eyeSmile: [[0, 0], [0.2, 1], [1.8, 1], [2.2, 0]],
      mouthOpen: [[0, 0], [0.2, 0.5], [0.45, 0.32], [0.7, 0.55], [0.95, 0.34], [1.2, 0.5], [1.8, 0.3], [2.1, 0]],
      mouthForm: [[0, 0], [0.2, -0.8], [2.2, -0.2]],
      blush: [[0, 0], [0.3, 0.7], [1.8, 0.7], [2.2, 0.1]],
      angleY: [[0, 0], [0.2, -5], [0.45, -1], [0.7, -6], [0.95, -2], [1.2, -5], [1.6, -2], [2.2, 0]],
      angleZ: [[0, 0], [0.3, -6], [1.8, -5], [2.2, 0]],
      bodyAngleZ: [[0, 0], [0.25, 2], [0.5, -1], [0.75, 2], [1, -1], [1.3, 1.5], [2.2, 0]],
      browY: [[0, 0], [0.3, 0.3], [1.8, 0.3], [2.2, 0]]
    }
  },
  surprise: {
    label: "Surprise",
    dur: 2,
    tracks: {
      angleY: [[0, 0], [0.12, 10], [0.5, 6], [1.5, 5], [2, 0]],
      angleX: [[0, 0], [0.12, -4], [2, 0]],
      bodyAngleX: [[0, 0], [0.15, -4], [1.5, -3], [2, 0]],
      eyeOpen: [[0, 1], [0.1, 1.25], [1.5, 1.2], [2, 1]],
      browY: [[0, 0], [0.1, 1], [1.5, 0.9], [2, 0]],
      mouthOpen: [[0, 0], [0.12, 0.6], [1.4, 0.45], [2, 0]],
      mouthForm: [[0, 0], [0.12, 0.6], [1.5, 0.55], [2, 0]],
      // o
      armAngle: [[0, 0], [0.15, -4], [1.5, -3], [2, 0]]
    }
  },
  shy: {
    label: "Shy",
    dur: 3.2,
    tracks: {
      angleX: [[0, 0], [0.6, 14], [2.6, 12], [3.2, 0]],
      angleY: [[0, 0], [0.6, -9], [2.6, -8], [3.2, 0]],
      angleZ: [[0, 0], [0.7, -8], [2.6, -7], [3.2, 0]],
      gazeX: [[0, 0], [0.3, 0.8], [1.6, 0.8], [1.9, -0.3], [2.2, 0.8], [2.8, 0.6], [3.2, 0]],
      gazeY: [[0, 0], [0.3, -0.5], [2.8, -0.4], [3.2, 0]],
      eyeOpen: [[0, 1], [0.5, 0.75], [2.7, 0.75], [3.2, 1]],
      eyeSmile: [[0, 0], [0.5, 0.5], [2.7, 0.5], [3.2, 0]],
      blush: [[0, 0], [0.8, 1], [2.7, 1], [3.2, 0]],
      browAngle: [[0, 0], [0.5, -0.6], [2.7, -0.5], [3.2, 0]],
      mouthForm: [[0, 0], [0.5, -0.4], [3.2, 0]],
      handAngle: [[0, 0], [0.8, 4], [2.6, 4], [3.2, 0]]
    }
  },
  no: {
    label: "Shake head",
    dur: 1.9,
    tracks: {
      angleX: [[0, 0], [0.2, 13], [0.45, -13], [0.7, 12], [0.95, -10], [1.2, 5], [1.5, 0]],
      angleY: [[0, 0], [0.2, -3], [1.3, -3], [1.9, 0]],
      bodyAngleX: [[0, 0], [0.3, 1.5], [0.6, -1.5], [0.9, 1], [1.3, 0]],
      eyeOpen: [[0, 1], [0.15, 0], [1.4, 0], [1.9, 1]],
      eyeSmile: [[0, 0], [0.15, 1], [1.4, 1], [1.9, 0]],
      // closed mouth while shaking the head
      browAngle: [[0, 0], [0.2, -0.5], [1.4, -0.5], [1.9, 0]]
    }
  },
  wink: {
    label: "Wink",
    dur: 2,
    tracks: {
      angleZ: [[0, 0], [0.35, -13], [1.5, -12], [2, 0]],
      angleX: [[0, 0], [0.35, 9], [1.5, 8], [2, 0]],
      bodyAngleZ: [[0, 0], [0.5, -2], [1.5, -2], [2, 0]],
      eyeOpenL: [[0, 1], [0.25, 1], [0.4, 0], [1.4, 0], [1.6, 1]],
      eyeSmileL: [[0, 0], [0.3, 1], [1.5, 1], [1.7, 0]],
      mouthOpen: [[0, 0], [2, 0]],
      // wink with a closed smile
      mouthForm: [[0, 0], [0.35, -0.8], [2, 0]],
      blush: [[0, 0], [0.4, 0.5], [1.6, 0.5], [2, 0]]
    }
  },
  greet: {
    label: "Greeting",
    dur: 2.6,
    tracks: {
      angleY: [[0, 0], [0.7, -18], [1.2, -17], [1.9, 2], [2.6, 0]],
      bodyAngleX: [[0, 0], [0.8, 2], [1.8, 0]],
      bodyAngleZ: [[0, 0], [0.8, 1.5], [2, 0]],
      armAngle: [[0, 0], [0.8, 3], [2, 0]],
      eyeOpen: [[0, 1], [0.5, 0], [1.4, 0], [1.8, 1]],
      eyeSmile: [[0, 0], [0.5, 1], [1.6, 1], [2.3, 0.4], [2.6, 0]],
      mouthOpen: [[0, 0], [1.6, 0], [1.8, 0.3], [2.3, 0.2], [2.6, 0]],
      mouthForm: [[0, 0], [1.6, -0.8], [2.6, -0.3]],
      blush: [[0, 0], [1.6, 0.3], [2.6, 0]]
    }
  }
};
var IDLE_MOTIONS = {
  lookAround: {
    label: "Look around",
    dur: 5.2,
    idle: true,
    tracks: {
      gazeX: [[0, 0], [0.25, -0.85], [1.5, -0.8], [1.8, 0.1], [2.1, 0.85], [3.4, 0.8], [3.7, 0], [5.2, 0]],
      gazeY: [[0, 0], [0.25, 0.15], [1.8, 0.25], [2.1, 0.1], [3.7, 0], [5.2, 0]],
      angleX: [[0, 0], [0.7, -20], [1.6, -18], [2.5, 19], [3.5, 17], [4.4, 0], [5.2, 0]],
      angleY: [[0, 0], [0.7, 3], [1.8, 5], [2.5, 3], [4.4, 0]],
      angleZ: [[0, 0], [0.8, 4], [1.8, 0], [2.6, -4], [4.4, 0]],
      bodyAngleX: [[0, 0], [1, -4], [2.8, 4], [4.6, 0]],
      bodyAngleZ: [[0, 0], [1, 1.5], [2.8, -1.5], [4.6, 0]],
      handAngle: [[0, 0], [1, -2], [2.8, 2], [4.6, 0]],
      browY: [[0, 0], [0.5, 0.35], [3.6, 0.3], [4.4, 0]],
      // curious: a quick inhale, held while looking, let out at the end
      breath: [[0, 0.2], [0.6, 0.85], [3.6, 0.7], [4.6, 0], [5.2, 0.1]]
    }
  },
  glance: {
    label: "Side glance",
    dur: 4.6,
    idle: true,
    tracks: {
      gazeX: [[0, 0], [0.18, 0.9], [2.6, 0.85], [2.9, 0.15], [3.2, 0], [4.6, 0]],
      gazeY: [[0, 0], [0.18, 0.4], [2.6, 0.35], [3.2, 0]],
      angleX: [[0, 0], [0.6, 13], [2.6, 11], [3.6, 0]],
      angleY: [[0, 0], [0.6, 6], [2.6, 5], [3.6, 0]],
      angleZ: [[0, 0], [0.7, -5], [2.6, -4], [3.6, 0]],
      bodyAngleX: [[0, 0], [1, 2.5], [2.8, 2], [4, 0]],
      eyeOpen: [[0, 1], [0.3, 1.06], [2.5, 1.05], [2.8, 0.85], [3.4, 1]],
      browY: [[0, 0], [0.4, 0.4], [2.5, 0.35], [3.4, 0]],
      browAngle: [[0, 0], [0.4, -0.2], [2.5, -0.2], [3.4, 0]],
      breath: [[0, 0], [0.5, 0.6], [2.6, 0.55], [3.8, 0], [4.6, 0.3]]
    }
  },
  sway: {
    label: "Sway",
    dur: 7,
    idle: true,
    tracks: {
      bodyAngleZ: [[0, 0], [1.6, 6], [3.4, -6], [5.2, 5], [7, 0]],
      bodyAngleX: [[0, 0], [1.6, 3], [3.4, -3], [5.2, 2.5], [7, 0]],
      angleZ: [[0, 0], [1.8, -10], [3.6, 10], [5.4, -8], [7, 0]],
      angleX: [[0, 0], [1.8, 6], [3.6, -6], [5.4, 5], [7, 0]],
      angleY: [[0, 0], [0.9, 3], [1.8, 0], [2.7, 3], [3.6, 0], [4.5, 3], [5.4, 0], [7, 0]],
      armAngle: [[0, 0], [1.6, 3], [3.4, -3], [5.2, 2], [7, 0]],
      handAngle: [[0, 0], [1.8, -4], [3.6, 4], [5.4, -3], [7, 0]],
      gazeX: [[0, 0], [1.8, -0.3], [3.6, 0.3], [5.4, -0.2], [7, 0]],
      eyeOpen: [[0, 1], [0.8, 0.82], [6.2, 0.82], [7, 1]],
      eyeSmile: [[0, 0], [0.8, 0.35], [6.2, 0.35], [7, 0]],
      // slow, even breaths in time with the sway
      breath: [[0, 0], [0.9, 1], [1.8, 0], [2.7, 1], [3.6, 0], [4.5, 1], [5.4, 0], [6.3, 0.8], [7, 0]]
    }
  },
  sigh: {
    label: "Sigh",
    dur: 5.6,
    idle: true,
    tracks: {
      breath: [[0, 0], [1.3, 1.25], [1.9, 1.25], [3.6, 0], [5.6, 0]],
      angleY: [[0, 0], [1.3, 9], [1.9, 9], [3.3, -9], [4.6, -6], [5.6, 0]],
      angleZ: [[0, 0], [1.3, -3], [3.3, 5], [5.6, 0]],
      bodyAngleX: [[0, 0], [1.3, -2.5], [3.3, 2.5], [5.6, 0]],
      bodyAngleZ: [[0, 0], [1.9, 1], [3.3, -1.5], [5.6, 0]],
      armAngle: [[0, 0], [1.3, -2.5], [3.3, 2], [5.6, 0]],
      gazeY: [[0, 0], [1.2, 0.4], [2, 0.3], [3.2, -0.4], [4.8, -0.2], [5.6, 0]],
      eyeOpen: [[0, 1], [1, 0.95], [1.9, 0.6], [3.4, 0.6], [4.6, 0.78], [5.6, 1]],
      browY: [[0, 0], [1.3, 0.35], [3.2, -0.2], [5.6, 0]],
      browAngle: [[0, 0], [1.9, -0.4], [4.6, -0.35], [5.6, 0]]
    }
  },
  doze: {
    label: "Drowsy",
    dur: 7.2,
    idle: true,
    tracks: {
      eyeOpen: [[0, 1], [1.8, 0.78], [3.2, 0.62], [4.5, 0.55], [4.75, 1.1], [5.6, 1.05], [7.2, 1]],
      angleY: [[0, 0], [1.8, -6], [3.2, -9], [4.5, -17], [4.75, 5], [5.6, 2], [7.2, 0]],
      angleZ: [[0, 0], [2, 4], [4.5, 10], [4.75, -2], [7.2, 0]],
      angleX: [[0, 0], [4.5, -4], [4.75, 3], [5.4, -6], [6.2, 5], [7.2, 0]],
      bodyAngleZ: [[0, 0], [4.5, 3], [4.8, -2], [7.2, 0]],
      bodyAngleX: [[0, 0], [4.5, 2], [4.8, -1.5], [7.2, 0]],
      armAngle: [[0, 0], [4.5, 3], [4.8, -2], [7.2, 0]],
      handAngle: [[0, 0], [4.5, 5], [4.8, -1], [7.2, 0]],
      gazeY: [[0, 0], [4.5, -0.4], [4.75, 0.2], [7.2, 0]],
      gazeX: [[0, 0], [4.8, 0], [5.3, -0.6], [6.1, 0.6], [6.8, 0]],
      browY: [[0, 0], [4.5, -0.35], [4.75, 0.8], [5.8, 0.3], [7.2, 0]],
      // long, slow, deepening breaths; a sharp inhale on waking
      breath: [[0, 0], [1.1, 0.7], [2.6, 0], [3.8, 0.6], [4.5, 0.2], [4.8, 1.1], [6, 0.2], [7.2, 0]]
    }
  },
  stretch: {
    label: "Stretch",
    dur: 6.2,
    idle: true,
    tracks: {
      angleZ: [[0, 0], [1.3, -22], [2.3, -21], [3.8, 20], [4.8, 19], [6.2, 0]],
      angleY: [[0, 0], [1.3, 5], [2.3, 7], [3.1, -3], [3.8, 5], [4.8, 6], [6.2, 0]],
      angleX: [[0, 0], [1.3, -5], [3.8, 5], [6.2, 0]],
      bodyAngleZ: [[0, 0], [1.3, 4], [3.8, -4], [6.2, 0]],
      bodyAngleX: [[0, 0], [1.3, -2], [3.8, 2], [6.2, 0]],
      armAngle: [[0, 0], [1.3, 2], [3.8, -2], [6.2, 0]],
      eyeOpen: [[0, 1], [0.8, 0.62], [4.9, 0.62], [5.6, 1]],
      browAngle: [[0, 0], [1, -0.3], [4.9, -0.3], [5.8, 0]],
      breath: [[0, 0], [1.3, 1.1], [2.3, 0.9], [3.1, 0.2], [3.8, 1.1], [4.8, 0.9], [6.2, 0]]
    }
  },
  lean: {
    label: "Peek",
    dur: 4.8,
    idle: true,
    tracks: {
      bodyAngleX: [[0, 0], [0.9, 6], [3.4, 6], [4.4, 0]],
      bodyAngleZ: [[0, 0], [0.9, -3], [3.4, -3], [4.4, 0]],
      angleX: [[0, 0], [0.9, 9], [2, 7], [2.6, 10], [3.4, 8], [4.4, 0]],
      angleY: [[0, 0], [0.9, -6], [3.4, -5], [4.4, 0]],
      angleZ: [[0, 0], [0.9, 10], [2.2, 12], [3.4, 9], [4.4, 0]],
      armAngle: [[0, 0], [0.9, -3], [3.4, -3], [4.4, 0]],
      handAngle: [[0, 0], [0.9, 3], [3.4, 3], [4.4, 0]],
      gazeY: [[0, 0], [0.6, 0.45], [3.4, 0.4], [4.2, 0]],
      gazeX: [[0, 0], [1.5, 0], [1.8, -0.3], [2.3, 0.2], [2.8, 0], [4.2, 0]],
      eyeOpen: [[0, 1], [0.6, 1.1], [3.4, 1.08], [4.2, 1]],
      browY: [[0, 0], [0.6, 0.45], [3.4, 0.4], [4.2, 0]],
      browAngle: [[0, 0], [0.6, -0.3], [3.4, -0.3], [4.2, 0]],
      blush: [[0, 0], [1.2, 0.25], [3.4, 0.25], [4.4, 0]],
      breath: [[0, 0], [0.8, 0.8], [3.4, 0.6], [4.4, 0], [4.8, 0.2]]
    }
  },
  hum: {
    label: "Listen",
    dur: 5.6,
    idle: true,
    tracks: {
      angleY: [[0, 0], [0.45, -5], [0.9, 2], [1.35, -5], [1.8, 2], [2.25, -5], [2.7, 2], [3.15, -5], [3.6, 2], [4.05, -4], [4.8, 0]],
      angleZ: [[0, 0], [0.9, 8], [1.8, -8], [2.7, 8], [3.6, -8], [4.6, 0]],
      angleX: [[0, 0], [0.9, 4], [1.8, -4], [2.7, 4], [3.6, -4], [4.6, 0]],
      bodyAngleZ: [[0, 0], [0.9, -3], [1.8, 3], [2.7, -3], [3.6, 3], [4.6, 0]],
      bodyAngleX: [[0, 0], [1.8, 2], [3.6, -2], [4.8, 0]],
      handAngle: [[0, 0], [0.9, 3], [1.8, -3], [2.7, 3], [3.6, -3], [4.6, 0]],
      fingerTap: [[0, 0], [0.45, 1], [0.9, 0], [1.35, 1], [1.8, 0], [2.25, 1], [2.7, 0], [3.15, 1], [3.6, 0], [5.6, 0]],
      gazeX: [[0, 0], [0.9, 0.3], [1.8, -0.3], [2.7, 0.3], [3.6, -0.3], [4.6, 0]],
      eyeOpen: [[0, 1], [0.4, 0.72], [4.6, 0.72], [5.3, 1]],
      eyeSmile: [[0, 0], [0.4, 0.55], [4.6, 0.55], [5.3, 0]],
      blush: [[0, 0], [0.8, 0.3], [4.6, 0.3], [5.6, 0]],
      browY: [[0, 0], [0.5, 0.25], [4.6, 0.25], [5.4, 0]],
      breath: [[0, 0], [0.9, 0.9], [1.8, 0.2], [2.7, 0.9], [3.6, 0.2], [4.6, 0.8], [5.6, 0]]
    }
  },
  tap: {
    label: "Tap",
    dur: 5,
    idle: true,
    tracks: {
      gazeX: [[0, 0], [0.3, -0.6], [2.2, -0.5], [2.5, -0.1], [2.8, -0.6], [4.2, -0.5], [4.7, 0]],
      gazeY: [[0, 0], [0.3, 0.55], [4.2, 0.5], [4.7, 0]],
      angleX: [[0, 0], [0.8, -11], [2.4, -9], [3, -12], [4.2, -10], [5, 0]],
      angleY: [[0, 0], [0.8, 8], [4.2, 7], [5, 0]],
      angleZ: [[0, 0], [0.8, 6], [2.4, 4], [3, 7], [4.2, 5], [5, 0]],
      bodyAngleX: [[0, 0], [1, -2], [4.2, -2], [5, 0]],
      handAngle: [[0, 0], [0.8, 3], [4.2, 3], [5, 0]],
      fingerTap: [
        [0, 0],
        [0.9, 0],
        [1.05, 1],
        [1.2, 0],
        [1.4, 1],
        [1.55, 0],
        [1.75, 1],
        [1.9, 0],
        [2.6, 0],
        [2.75, 1],
        [2.9, 0],
        [3.1, 1],
        [3.25, 0],
        [5, 0]
      ],
      browY: [[0, 0], [0.6, 0.3], [4.2, 0.25], [5, 0]],
      browAngle: [[0, 0], [0.6, -0.35], [4.2, -0.3], [5, 0]],
      eyeOpen: [[0, 1], [0.6, 0.9], [4.2, 0.9], [5, 1]],
      breath: [[0, 0], [0.8, 0.7], [2.2, 0.4], [3.2, 0.8], [4.4, 0], [5, 0.2]]
    }
  },
  readNote: {
    label: "Read script",
    dur: 2.6,
    idle: true,
    tracks: {
      // a quick look down at the notes on the desk and back to the camera
      gazeY: [[0, 0], [0.2, -0.85], [1.5, -0.8], [1.75, 0], [2.6, 0]],
      gazeX: [[0, 0], [0.2, -0.15], [1.5, -0.1], [1.75, 0]],
      angleY: [[0, 0], [0.45, -9], [1.5, -8], [2, 1], [2.6, 0]],
      angleZ: [[0, 0], [0.5, 2], [1.6, 2], [2.6, 0]],
      eyeOpen: [[0, 1], [0.3, 0.78], [1.5, 0.78], [1.75, 1]],
      breath: [[0, 0.3], [0.8, 0.5], [1.8, 0.2], [2.6, 0.4]]
    }
  },
  waiting: {
    label: "Fidget",
    dur: 6.4,
    idle: true,
    tracks: {
      // shifts her weight, checks the viewer, looks away, shifts back
      bodyAngleZ: [[0, 0], [0.9, 5], [2.4, 4], [3.3, -5], [5.2, -4], [6.4, 0]],
      bodyAngleX: [[0, 0], [0.9, 3], [3.3, -3], [5.2, -2], [6.4, 0]],
      angleZ: [[0, 0], [1, -6], [2.4, -4], [3.4, 6], [5.2, 5], [6.4, 0]],
      angleX: [[0, 0], [1.2, -8], [2.2, 2], [3.6, 12], [5, 10], [6.2, 0]],
      angleY: [[0, 0], [1.2, -3], [2.2, 2], [3.6, -2], [6.2, 0]],
      armAngle: [[0, 0], [0.9, 3], [3.3, -3], [5.2, -2], [6.4, 0]],
      handAngle: [[0, 0], [1.2, 3], [3.4, -3], [6.4, 0]],
      fingerTap: [[0, 0], [4.2, 0], [4.35, 1], [4.5, 0], [4.7, 1], [4.85, 0], [6.4, 0]],
      gazeX: [[0, 0], [0.9, -0.7], [1.9, -0.6], [2.1, 0], [2.7, 0], [2.9, 0.8], [5, 0.7], [5.4, 0], [6.4, 0]],
      gazeY: [[0, 0], [0.9, -0.2], [2.1, 0], [2.9, 0.3], [5.4, 0]],
      eyeOpen: [[0, 1], [2, 1], [2.2, 1.06], [2.8, 1.05], [3.1, 0.85], [5.4, 0.85], [6.2, 1]],
      browAngle: [[0, 0], [0.9, -0.35], [2, -0.35], [2.3, 0], [3.1, -0.4], [5.4, -0.35], [6.4, 0]],
      browY: [[0, 0], [2.2, 0.4], [2.8, 0.35], [3.2, 0], [6.4, 0]],
      breath: [[0, 0.3], [0.9, 0.8], [2, 0.3], [2.6, 0.9], [3.4, 0.2], [4.4, 0.8], [5.6, 0], [6.4, 0.2]]
    }
  },
  spaceOut: {
    label: "Daydream",
    dur: 7.4,
    idle: true,
    tracks: {
      // gaze drifts up and away, breaths get slow and long, one slow blink
      gazeX: [[0, 0], [1.4, -0.55], [4.8, -0.6], [5.6, 0.1], [7, 0]],
      gazeY: [[0, 0], [1.4, 0.6], [4.8, 0.55], [5.6, 0], [7, 0]],
      angleX: [[0, 0], [2, -9], [4.8, -10], [6, 2], [7.4, 0]],
      angleY: [[0, 0], [2, 7], [4.8, 8], [6, -2], [7.4, 0]],
      angleZ: [[0, 0], [2, 9], [4.8, 11], [6, 2], [7.4, 0]],
      bodyAngleZ: [[0, 0], [2.2, 3], [4.8, 3.5], [6.4, 0]],
      bodyAngleX: [[0, 0], [2.2, -2], [4.8, -2], [6.4, 0]],
      handAngle: [[0, 0], [2.2, 4], [4.8, 5], [6.4, 0]],
      armAngle: [[0, 0], [2.2, 2], [4.8, 2], [6.4, 0]],
      eyeOpen: [[0, 1], [1.4, 0.8], [3, 0.8], [3.35, 0.56], [3.8, 0.8], [4.8, 0.8], [5.6, 1.04], [6.4, 1]],
      browY: [[0, 0], [1.6, 0.15], [4.8, 0.15], [5.6, 0.35], [6.6, 0]],
      breath: [[0, 0], [1.6, 0.9], [3.4, 0], [5, 0.9], [6.2, 0.1], [7.4, 0]]
    }
  }
};

// mesh-studio/vendor/packages/runtime/src/engine/kana.js
var ROWS = {
  a: "\u3042\u304B\u3055\u305F\u306A\u306F\u307E\u3084\u3089\u308F\u304C\u3056\u3060\u3070\u3071\u3041",
  i: "\u3044\u304D\u3057\u3061\u306B\u3072\u307F\u308A\u304E\u3058\u3062\u3073\u3074\u3043",
  u: "\u3046\u304F\u3059\u3064\u306C\u3075\u3080\u3086\u308B\u3050\u305A\u3065\u3076\u3077\u3045\u3094",
  e: "\u3048\u3051\u305B\u3066\u306D\u3078\u3081\u308C\u3052\u305C\u3067\u3079\u307A\u3047",
  o: "\u304A\u3053\u305D\u3068\u306E\u307B\u3082\u3088\u308D\u3092\u3054\u305E\u3069\u307C\u307D\u3049"
};
var VOWEL_OF = {};
for (const [v, chars] of Object.entries(ROWS)) for (const c of chars) VOWEL_OF[c] = v;
var LIPS_CLOSE = /* @__PURE__ */ new Set([..."\u307E\u307F\u3080\u3081\u3082\u3070\u3073\u3076\u3079\u307C\u3071\u3074\u3077\u307A\u307D"]);
var PLAIN_VOWEL = /* @__PURE__ */ new Set([..."\u3042\u3044\u3046\u3048\u304A\u3041\u3043\u3045\u3047\u3049"]);
var PAUSE = /* @__PURE__ */ new Set([..."\u3001\u3002\uFF0C\uFF0E,.\uFF01\uFF1F!? \u3000\u2026"]);

// mesh-studio/vendor/packages/runtime/src/engine/motion.js
var ALL_MOTIONS = { ...MOTIONS, ...IDLE_MOTIONS };

// mesh-studio/vendor/packages/runtime/src/engine/expression-overlay.js
var OVERLAY_EXPRESSIONS = {
  neutral: "normal",
  smile: "smile",
  shy: "shy",
  surprise: "surprise",
  halfLidded: "jito",
  angry: "angryTalk",
  sad: "sadTalk",
  wink: "wink"
};
var NEUTRAL = Object.freeze({ eyeOpen: 1, eyeOpenL: 1, eyeSmile: 0, eyeSmileL: 0, blush: 0, browY: 0, browAngle: 0, mouthOpen: 0, mouthForm: 0, gx: 0, gy: 0, pitch: 0 });

// mesh-studio/vendor/packages/runtime/src/engine/expression-settings.ts
var isObject = (value) => !!value && typeof value === "object" && !Array.isArray(value);
function parseExpressionSettings(input) {
  if (!isObject(input)) throw new TypeError("expressions: expected an object");
  const settings = {};
  for (const [name, entry] of Object.entries(input)) {
    if (name === "neutral" || !Object.hasOwn(OVERLAY_EXPRESSIONS, name)) continue;
    if (!isObject(entry)) throw new TypeError(`expressions.${name}: expected an object`);
    const parsed = {}, value = entry.mouthOpen;
    if (value !== void 0) {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1)
        throw new RangeError(`expressions.${name}.mouthOpen: expected 0\u20131`);
      parsed.mouthOpen = value;
    }
    settings[name] = parsed;
  }
  return settings;
}

// mesh-studio/vendor/packages/runtime/src/engine/index.ts
var LIVE_EXPRESSIONS = Object.keys(OVERLAY_EXPRESSIONS);

// mesh-studio/vendor/packages/runtime/src/format/manifest.ts
function parseManifest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("avatar.json: expected an object");
  }
  const value = input, errors = [];
  if (value.format !== "mesh-avatar") errors.push('avatar.json.format: expected "mesh-avatar"');
  if (value.version !== 1) errors.push(`avatar.json.version: unsupported version ${JSON.stringify(value.version) ?? "missing"} (expected 1)`);
  if (typeof value.name !== "string" || !value.name.trim()) errors.push("avatar.json.name: expected a non-empty string");
  const manifest = { format: "mesh-avatar", version: 1, name: value.name };
  for (const key of ["author", "license", "thumbnail", "source"]) {
    if (value[key] === void 0) continue;
    if (typeof value[key] !== "string") errors.push(`avatar.json.${key}: expected a string`);
    else manifest[key] = value[key];
  }
  if (value.studio !== void 0) {
    const studio = value.studio;
    if (!studio || typeof studio !== "object" || Array.isArray(studio) || !("version" in studio) || typeof studio.version !== "string" || !studio.version.trim()) {
      errors.push("avatar.json.studio.version: expected a non-empty string");
    } else manifest.studio = { version: studio.version };
  }
  if (value.lipSync !== void 0) {
    try {
      manifest.lipSync = parseLipSyncSettings(value.lipSync);
    } catch (error) {
      errors.push(`avatar.json.lipSync: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (value.expressions !== void 0) {
    try {
      manifest.expressions = parseExpressionSettings(value.expressions);
    } catch (error) {
      errors.push(`avatar.json.expressions: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return manifest;
}
function defaultManifest(name) {
  return parseManifest({ format: "mesh-avatar", version: 1, name });
}

// mesh-studio/vendor/packages/runtime/src/format/validate.ts
var object2 = (value) => !!value && typeof value === "object" && !Array.isArray(value);
var numbers = (value, length) => Array.isArray(value) && value.length === length && value.every((n) => typeof n === "number" && Number.isFinite(n));
var own = (value, key) => Object.hasOwn(value, key);
function validateAvatarFiles(files) {
  const errors = [];
  function json(path, required = true) {
    if (!own(files, path)) {
      if (required) errors.push(`${path}: missing file`);
      return;
    }
    const data = files[path];
    if (!(data instanceof Uint8Array)) {
      errors.push(`${path}: JSON bytes are required`);
      return;
    }
    let value;
    try {
      value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(data));
    } catch {
      errors.push(`${path}: invalid UTF-8 JSON`);
      return;
    }
    if (!object2(value)) {
      errors.push(`${path}: expected an object`);
      return;
    }
    return value;
  }
  function version(value, path, legacy = true) {
    if (value.version === 1 || legacy && value.version === void 0) return true;
    errors.push(`${path}.version: unsupported version ${JSON.stringify(value.version) ?? "missing"} (expected 1)`);
    return false;
  }
  function image(path) {
    if (!own(files, path)) {
      errors.push(`${path}: missing file`);
      return;
    }
    const data = files[path], size = data instanceof Uint8Array ? data.byteLength : data?.size;
    if (!Number.isSafeInteger(size) || size <= 0) errors.push(`${path}: expected a non-empty file`);
  }
  function layers(value, path, directory, size) {
    if (!object2(value)) {
      errors.push(`${path}.layers: expected a layer rectangle map`);
      return;
    }
    for (const [name, rect] of Object.entries(value)) {
      const field = `${path}.layers.${name}`;
      if (!/^[A-Za-z0-9_-]+$/.test(name)) {
        errors.push(`${field}: expected a safe layer name (letters, digits, hyphens or underscores)`);
        continue;
      }
      if (!numbers(rect, 4) || !rect.every(Number.isInteger) || rect[0] < 0 || rect[1] < 0 || rect[2] <= 0 || rect[3] <= 0) {
        errors.push(`${field}: expected [x, y, width, height] with non-negative integer origins and positive integer dimensions`);
      } else if (size && (rect[0] + rect[2] > size[0] || rect[1] + rect[3] > size[1])) {
        errors.push(`${field}: rectangle must stay inside the image`);
      }
      image(`${directory}/${name}.png`);
    }
    return value;
  }
  function build(value, path) {
    if (typeof value.build !== "string" || !value.build.trim()) errors.push(`${path}.build: expected a non-empty string`);
  }
  const manifest = json("avatar.json", false);
  if (manifest) {
    try {
      parseManifest(manifest);
    } catch (error) {
      errors.push(error.message);
    }
  }
  const rawRig = json("rig.json");
  let rig;
  if (rawRig && version(rawRig, "rig.json", false)) {
    const problems = validateRig(rawRig);
    errors.push(...problems.map((error) => `rig.json: ${error}`));
    if (!problems.length) rig = rawRig;
  }
  image("built/base.png");
  image("built/hairmask.png");
  if (rig?.cloth?.length) image("built/base_cloth.png");
  const meta = json("built/layers.json");
  if (meta && version(meta, "built/layers.json")) {
    build(meta, "built/layers.json");
    let size;
    if (!numbers(meta.size, 2) || !meta.size.every((n) => Number.isInteger(n) && n > 0)) {
      errors.push("built/layers.json.size: expected [width, height] with positive integer dimensions");
    } else {
      size = meta.size;
      if (rig && (size[0] !== rig.image.width || size[1] !== rig.image.height)) errors.push("built/layers.json.size: must match rig.json.image");
    }
    const rectangles = layers(meta.layers, "built/layers.json", "built", size);
    if (rig && rectangles) {
      const required = [
        ...rig.eyes.flatMap((_, i) => ["ball", "low", "crease", "lash"].map((part) => `eye${i}_${part}`)),
        ...rig.hand ? ["hand"] : [],
        ...(rig.accessories ?? []).map((part) => part.name),
        ...(rig.cloth ?? []).map((part) => `cloth_${part.name}`)
      ];
      for (const name of required) if (!own(rectangles, name)) errors.push(`built/layers.json.layers.${name}: missing required layer`);
    }
    if (!Array.isArray(meta.eyes) || meta.eyes.length !== 2) {
      errors.push("built/layers.json.eyes: expected two eye curves");
    } else meta.eyes.forEach((eye, i) => {
      const path = `built/layers.json.eyes[${i}]`;
      if (!object2(eye)) {
        errors.push(`${path}: expected an object`);
        return;
      }
      const span = numbers([eye.x0, eye.x1], 2) && eye.x0 < eye.x1;
      if (!span) errors.push(`${path}: expected finite x0 < x1`);
      for (const key of ["top", "bot"]) {
        if (!numbers(eye[key], 24)) errors.push(`${path}.${key}: expected 24 finite numbers`);
      }
      if (numbers(eye.top, 24) && numbers(eye.bot, 24) && eye.top.some((y, k) => y > eye.bot[k])) {
        errors.push(`${path}.top: must not exceed bottom curve`);
      }
      if (rig) for (const key of ["x0", "x1", "top", "bot"]) {
        const a = eye[key], b = rig.eyes[i][key];
        const same = Array.isArray(b) ? numbers(a, b.length) && a.every((n, k) => n === b[k]) : a === b;
        if (!same) errors.push(`${path}.${key}: must match rig.json.eyes[${i}].${key}`);
      }
    });
  }
  const sprites = json("built/sprites/sprites.json", false);
  if (sprites && version(sprites, "built/sprites/sprites.json")) {
    build(sprites, "built/sprites/sprites.json");
    layers(sprites.layers, "built/sprites/sprites.json", "built/sprites", rig ? [rig.image.width, rig.image.height] : void 0);
  }
  const overlays = json("built/overlays/overlays.json", false);
  if (overlays && version(overlays, "built/overlays/overlays.json")) {
    if (!Array.isArray(overlays.overlays)) errors.push("built/overlays/overlays.json.overlays: expected an array");
    else {
      const seen = /* @__PURE__ */ new Set();
      for (const [i, item] of overlays.overlays.entries()) {
        const path = `built/overlays/overlays.json.overlays[${i}]`;
        if (!object2(item) || typeof item.name !== "string" || !/^[A-Za-z0-9_-]+$/.test(item.name) || typeof item.file !== "string" || !/^[A-Za-z0-9_-]+\.png$/.test(item.file)) {
          errors.push(`${path}: expected { name, file } with safe names`);
          continue;
        }
        if (seen.has(item.name)) errors.push(`${path}.name: duplicate overlay name`);
        seen.add(item.name);
        image(`built/overlays/${item.file}`);
      }
    }
  }
  return errors;
}

// mesh-studio/vendor/packages/runtime/src/format/zip.ts
import { zipSync, unzipSync } from "fflate";
var MAX_ENTRIES = 200;
var MAX_SIZE = 64 * 1024 * 1024;
var decoder = new TextDecoder("utf-8", { fatal: true });
function checkEntryName(name) {
  if (!name || name.startsWith("/") || /^[A-Za-z]:/.test(name) || name.includes("\\") || name.includes("\0") || name.split("/").includes("..")) {
    throw new Error(`ZIP entry ${JSON.stringify(name)}: path must be relative, without .. or backslashes`);
  }
}
function entries(data) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const invalid = (name = "(archive)") => {
    throw new Error(`ZIP entry ${JSON.stringify(name)}: invalid or truncated ZIP`);
  };
  const u16 = (offset) => offset >= 0 && offset + 2 <= data.length ? view.getUint16(offset, true) : invalid();
  const u32 = (offset) => offset >= 0 && offset + 4 <= data.length ? view.getUint32(offset, true) : invalid();
  let end = data.length - 22;
  for (; end >= Math.max(0, data.length - 65557); end--) {
    if (u32(end) === 101010256 && end + 22 + u16(end + 20) === data.length) break;
  }
  if (end < 0 || end < data.length - 65557) invalid();
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== u16(end + 10)) invalid();
  const count = u16(end + 10), directory = u32(end + 16), directoryEnd = directory + u32(end + 12);
  if (directoryEnd !== end) invalid();
  const result = [];
  const seen = /* @__PURE__ */ new Set();
  let position = directory;
  for (let i = 0; i < count; i++) {
    if (position + 46 > directoryEnd || u32(position) !== 33639248) invalid();
    const length = u16(position + 28), next = position + 46 + length + u16(position + 30) + u16(position + 32);
    if (next > directoryEnd) invalid();
    let name;
    try {
      name = decoder.decode(data.subarray(position + 46, position + 46 + length));
    } catch {
      throw new Error("ZIP entry (invalid UTF-8 name): invalid filename");
    }
    checkEntryName(name);
    if (i >= MAX_ENTRIES) throw new Error(`ZIP entry ${JSON.stringify(name)}: more than ${MAX_ENTRIES} entries`);
    if (seen.has(name)) throw new Error(`ZIP entry ${JSON.stringify(name)}: duplicate entry`);
    seen.add(name);
    const size = u32(position + 24), compressed = u32(position + 20), offset = u32(position + 42);
    if (size > MAX_SIZE || compressed > MAX_SIZE) throw new Error(`ZIP entry ${JSON.stringify(name)}: exceeds 64 MB`);
    if (u16(position + 10) !== 0) throw new Error(`ZIP entry ${JSON.stringify(name)}: expected stored compression (method 0)`);
    if (u16(position + 8) & 1) throw new Error(`ZIP entry ${JSON.stringify(name)}: encrypted entries are not supported`);
    if (compressed !== size || offset + 30 > directory || u32(offset) !== 67324752) invalid(name);
    const start = offset + 30 + u16(offset + 26) + u16(offset + 28);
    if (start + size > directory || u16(offset + 8) !== 0 || u16(offset + 6) !== u16(position + 8)) invalid(name);
    let localName;
    try {
      localName = decoder.decode(data.subarray(offset + 30, offset + 30 + u16(offset + 26)));
    } catch {
      invalid(name);
    }
    if (localName !== name) invalid(name);
    result.push({ name, offset, start, size, central: position });
    position = next;
  }
  if (position !== directoryEnd) invalid();
  return { files: result };
}
function unpackAvatar(input) {
  const data = input instanceof Uint8Array ? input : new Uint8Array(input);
  const directory = entries(data);
  const extracted = unzipSync(data, { filter: (entry) => entry.name !== "__proto__" });
  const files = /* @__PURE__ */ Object.create(null);
  for (const entry of directory.files) {
    const bytes = entry.name === "__proto__" ? data.slice(entry.start, entry.start + entry.size) : extracted[entry.name];
    if (!(bytes instanceof Uint8Array) || bytes.length !== entry.size) throw new Error(`ZIP entry ${JSON.stringify(entry.name)}: invalid size`);
    files[entry.name] = bytes;
  }
  return files;
}
function packAvatar(files, options = {}) {
  const existing = Object.hasOwn(files, "avatar.json") ? files["avatar.json"] : void 0;
  const manifest = existing ? parseManifest(JSON.parse(decoder.decode(existing))) : defaultManifest("Avatar");
  const bytes = existing && !options.manifest ? existing : new TextEncoder().encode(JSON.stringify(parseManifest({ ...manifest, ...options.manifest }), null, 2) + "\n");
  const packed = /* @__PURE__ */ Object.create(null);
  packed["avatar.json"] = bytes;
  for (const [name, data] of Object.entries(files)) if (name !== "avatar.json") packed[name] = data;
  for (const [i, [name, data]] of Object.entries(packed).entries()) {
    checkEntryName(name);
    if (i >= MAX_ENTRIES) throw new Error(`ZIP entry ${JSON.stringify(name)}: more than ${MAX_ENTRIES} entries`);
    if (data.byteLength > MAX_SIZE) throw new Error(`ZIP entry ${JSON.stringify(name)}: exceeds 64 MB`);
  }
  const errors = validateAvatarFiles(packed);
  if (errors.length) throw new Error(errors.join("\n"));
  let alias = "proto0000";
  for (let i = 0; Object.hasOwn(packed, alias); i++) alias = `proto${String(i + 1).padStart(4, "0")}`;
  const input = Object.fromEntries(Object.entries(packed).map(([name, data]) => [name === "__proto__" ? alias : name, data]));
  const archive = zipSync(input, { level: 0 });
  if (Object.hasOwn(packed, "__proto__")) {
    const entry = entries(archive).files.find((entry2) => entry2.name === alias);
    const name = new TextEncoder().encode("__proto__");
    archive.set(name, entry.offset + 30);
    archive.set(name, entry.central + 46);
  }
  const directory = entries(archive);
  const first = directory.files.find((entry) => entry.name === "avatar.json");
  if (first.offset !== 0) {
    const length = first.start + first.size - first.offset;
    const reordered = new Uint8Array(archive.length);
    reordered.set(archive.subarray(first.offset, first.offset + length));
    reordered.set(archive.subarray(0, first.offset), length);
    reordered.set(archive.subarray(first.offset + length), first.offset + length);
    const view = new DataView(reordered.buffer);
    for (const entry of directory.files) view.setUint32(entry.central + 42, entry === first ? 0 : entry.offset < first.offset ? entry.offset + length : entry.offset, true);
    return reordered;
  }
  return archive;
}

// mesh-studio/vendor/packages/runtime/src/format/project-archive.ts
async function packProjectAvatar(read, { name, includeSource = true, lipSync }) {
  const wanted = /* @__PURE__ */ new Set(["avatar.json", "rig.json", "built/layers.json", "built/sprites/sprites.json", "built/overlays/overlays.json"]);
  const metadata = await read(wanted);
  const json = (path) => {
    try {
      return JSON.parse(new TextDecoder().decode(metadata[path]));
    } catch {
      throw new Error(`${path}: invalid JSON`);
    }
  };
  const manifest = metadata["avatar.json"] ? parseManifest(json("avatar.json")) : void 0;
  const source = manifest?.source ?? "source.png", thumbnail = manifest?.thumbnail ?? "thumbnail.png";
  checkEntryName(source);
  checkEntryName(thumbnail);
  wanted.add("built/base.png");
  wanted.add("built/hairmask.png");
  wanted.add(thumbnail);
  if (json("rig.json").cloth?.length) wanted.add("built/base_cloth.png");
  if (includeSource) wanted.add(source);
  for (const [path, prefix] of [["built/layers.json", "built/"], ["built/sprites/sprites.json", "built/sprites/"]]) {
    if (!metadata[path]) continue;
    for (const layer of Object.keys(json(path)?.layers ?? {})) {
      if (!/^[A-Za-z0-9_-]+$/.test(layer)) throw new Error(`${path}.layers.${layer}: invalid layer name`);
      wanted.add(`${prefix}${layer}.png`);
    }
  }
  if (metadata["built/overlays/overlays.json"]) {
    const overlays = json("built/overlays/overlays.json")?.overlays;
    for (const item of Array.isArray(overlays) ? overlays : []) {
      if (typeof item?.file !== "string" || !/^[A-Za-z0-9_-]+\.png$/.test(item.file)) throw new Error("built/overlays/overlays.json: invalid overlay file name");
      wanted.add(`built/overlays/${item.file}`);
    }
  }
  const files = await read(wanted);
  let override = manifest ? void 0 : { name };
  if (!includeSource && manifest?.source) override = { ...manifest, source: void 0 };
  if (lipSync !== void 0) override = { ...manifest, ...override, lipSync };
  return packAvatar(files, { manifest: override });
}

// mesh-studio/vendor/src/server/project-jobs.ts
import { homedir } from "node:os";
import { execFile } from "node:child_process";
import { copyFile, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join, resolve, relative, dirname } from "node:path";
var VARIANTS = ["eyes_closed", "eyes_half", "eyes_smile", "eyes_sad", "eyes_surprise", "mouth_a", "mouth_a_half", "mouth_i", "mouth_o", "mouth_angry", "mouth_sad"];
var JobError = class extends Error {
  constructor(code, log) {
    super(code);
    this.code = code;
    this.log = log;
  }
  code;
  log;
};
var PYTHON_SPEC = ">=3.10,<3.14";
var runTool = (root, project, tool) => new Promise((done, reject) => {
  const args = ["run", "--no-project", "--no-python-downloads", "--python", PYTHON_SPEC, "--with", "numpy", "--with", "pillow", "--with", "opencv-python-headless", resolve(root, `tools/${tool}.py`), project];
  execFile("uv", args, { cwd: root, timeout: 12e4, maxBuffer: 2 * 1024 * 1024 }, (error, stdout, stderr) => {
    const log = `${stdout}
${stderr}`.replaceAll(root, "<repo>").replaceAll(homedir(), "~").trim().slice(-12e3);
    if (!error) {
      done(log);
      return;
    }
    const missing = error.code === "ENOENT" || /No interpreter found|No Python installation|Python interpreter not found/i.test(log);
    reject(new JobError(missing ? "dependencies" : "toolFailed", log || (missing ? "uv is not installed." : "The local tool did not finish.")));
  });
});
async function copyTree(source, target) {
  const info = await lstat(source);
  if (info.isSymbolicLink()) throw new JobError("unsafeFiles", "Project files must not be symbolic links.");
  if (info.isDirectory()) {
    await mkdir(target, { recursive: true });
    for (const entry of await readdir(source)) await copyTree(join(source, entry), join(target, entry));
  } else if (info.isFile()) await copyFile(source, target);
  else throw new JobError("unsafeFiles", "Unsupported project file.");
}
async function exists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function safeTree(path) {
  const info = await lstat(path);
  if (info.isSymbolicLink()) throw new JobError("unsafeFiles", "Project files must not be symbolic links.");
  if (info.isDirectory()) for (const entry of await readdir(path)) await safeTree(join(path, entry));
}
function wait(ms) {
  return new Promise((resolve3) => setTimeout(resolve3, ms));
}
async function removeResilient(path) {
  for (let attempt = 1; ; attempt++) {
    try {
      await rm(path, { recursive: true, force: true });
      return;
    } catch (error) {
      const code = error.code;
      if (code !== "EPERM" && code !== "EBUSY" || attempt >= 5) throw error;
      await wait(attempt * 20);
    }
  }
}
async function renameResilient(from, to) {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = error.code;
      if (code !== "EPERM" && code !== "EBUSY") throw error;
      if (attempt >= 5) {
        try {
          await copyTree(from, to);
        } catch (copyError) {
          await removeResilient(to).catch(() => void 0);
          throw copyError;
        }
        await removeResilient(from);
        return;
      }
      await wait(attempt * 20);
    }
  }
}
async function publish(project, stage, names) {
  for (const name of names) if (await exists(join(project, name))) await safeTree(join(project, name));
  const moved = [];
  try {
    for (const name of names) {
      const target = join(project, name), previous = join(stage, `previous-${name}`);
      const item = { name, hadPrevious: await exists(target), installed: false };
      moved.push(item);
      if (item.hadPrevious) await renameResilient(target, previous);
      await renameResilient(join(stage, name), target);
      item.installed = true;
    }
  } catch (error) {
    let rollbackError;
    for (const item of moved.reverse()) {
      const target = join(project, item.name), previous = join(stage, `previous-${item.name}`);
      try {
        if (item.hadPrevious && await exists(previous)) {
          await removeResilient(target);
          await renameResilient(previous, target);
        } else if (item.installed) await removeResilient(target);
      } catch (error2) {
        rollbackError = error2;
      }
    }
    if (rollbackError) {
      console.error(`Rolling back a failed publish to ${project} also failed. Old files are kept at ${stage} for manual recovery.`, rollbackError);
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { keepStage: true });
    }
    throw error;
  }
}
function decodeVariants(value) {
  const files = value?.files;
  if (!Array.isArray(files) || !files.length || files.length > VARIANTS.length) throw new Error(`Choose one to ${VARIANTS.length} named PNG files.`);
  const names = /* @__PURE__ */ new Set();
  return files.map((file) => {
    if (!file || !VARIANTS.some((name) => file.name === `${name}.png`) || names.has(file.name) || typeof file.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.data)) throw new Error("Use the variant filenames and PNG images.");
    names.add(file.name);
    const bytes = Buffer.from(file.data, "base64");
    if (bytes.length > 24 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error("Use PNG images smaller than 24 MB each.");
    return { name: file.name, bytes };
  });
}
async function variantState(project) {
  let layers = {};
  try {
    layers = JSON.parse(await readFile(join(project, "built/sprites/sprites.json"), "utf8")).layers ?? {};
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return VARIANTS.map((name) => ({ name, present: name.startsWith("eyes_") ? `${name}_0` in layers && `${name}_1` in layers : name in layers }));
}
async function projectJob(root, project, tool, files = [], runner = runTool) {
  const checkFolder = async () => {
    const base = resolve(root, "projects");
    if (dirname(project) !== base || await realpath(base) !== base || await realpath(project) !== project) throw new JobError("unsafeFiles", "The project must be a regular folder inside projects/.");
  };
  await checkFolder();
  const stage = await mkdtemp(join(resolve(root, "projects"), ".studio-job-"));
  try {
    for (const name of ["source.png", "rig.json", "built", "variants", "variant-requests", "variant-masks"]) {
      const source = join(project, name);
      if (await exists(source)) await copyTree(source, join(stage, name));
    }
    if (files.length) {
      await mkdir(join(stage, "variants"), { recursive: true });
      for (const file of files) await writeFile(join(stage, "variants", file.name), file.bytes);
    }
    const log = await runner(root, stage, tool);
    await checkFolder();
    if (tool === "build-layers") await publish(project, stage, ["built", "rig.json"]);
    if (tool === "variant-requests") await publish(project, stage, ["variant-requests"]);
    if (tool === "build-sprites") await publish(project, stage, ["variants", "built"]);
    await rm(stage, { recursive: true, force: true });
    return { log, path: relative(root, project).split("\\").join("/") };
  } catch (error) {
    if (!error?.keepStage) await rm(stage, { recursive: true, force: true });
    throw error;
  }
}

// mesh-studio/vendor/src/server/local-projects.ts
var SAMPLE = "sample-miko-qipao";
var displayPath = (path) => path === homedir2() ? "~" : path.startsWith(`${homedir2()}${sep}`) ? `~${path.slice(homedir2().length)}` : path;
var safeName = /^[A-Za-z0-9._-]+$/;
var projectName = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
var HttpError = class extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
  status;
};
var inside = (base, path) => {
  const rel = relative2(base, path);
  return rel === "" || !rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel);
};
function fileSystemError(root, error, fallback = "projects") {
  const failure = error;
  if (!failure?.code || !/^E[A-Z0-9]+$/.test(failure.code)) return;
  const code = failure.code;
  const path = typeof failure.path === "string" && isAbsolute(failure.path) && inside(root, failure.path) ? relative2(root, failure.path).split(sep).join("/") || "." : fallback;
  const status = ["EPERM", "EACCES", "EROFS"].includes(code) ? 403 : code === "EBUSY" ? 409 : ["ENOENT", "ENOTDIR"].includes(code) ? 404 : 500;
  const reason = status === 403 ? "Permission denied" : status === 409 ? "File or folder is in use" : status === 404 ? "Project or file not found" : "Local project operation failed";
  return { status, body: { error: `${reason} (${code}): ${path}`, code, path } };
}
async function exists2(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
async function checked(base, path) {
  if (!inside(base, resolve2(path)) || !inside(base, await realpath2(path))) throw new HttpError(400, "Path must stay inside the project.");
  return path;
}
function revealFolder(path) {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  return new Promise((done, reject) => execFile2(command, [path], (error) => error ? reject(error) : done()));
}
function localProjectMiddleware(root, reveal = revealFolder, runner = runTool) {
  root = resolve2(root);
  const base = resolve2(root, "projects"), sample = resolve2(root, "samples/miko-qipao");
  const saving = /* @__PURE__ */ new Set();
  async function readBytes(req, limit) {
    if (Number(req.headers["content-length"]) > limit) throw new HttpError(413, "Request is too large.");
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > limit) throw new HttpError(413, "Request is too large.");
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  }
  async function readBody(req, limit = 1024 * 1024) {
    if (req.headers["content-type"]?.split(";")[0] !== "application/json") throw new HttpError(400, "Send application/json.");
    const bytes = await readBytes(req, limit);
    try {
      return JSON.parse(bytes.toString("utf8"));
    } catch {
      throw new HttpError(400, "Invalid JSON.");
    }
  }
  async function readSelected(path, names) {
    for (const name of await readdir2(path)) if (/[.](md|txt)$/i.test(name)) names.add(name);
    const files = /* @__PURE__ */ Object.create(null);
    for (const name of names) {
      checkEntryName(name);
      const file = resolve2(path, name);
      if (!inside(path, file)) throw new HttpError(400, "Path must stay inside the project.");
      try {
        await checked(path, file);
        if (!(await stat(file)).isFile()) throw new HttpError(400, `${name}: expected a regular file`);
        files[name] = await readFile2(file);
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    return files;
  }
  async function sourceFile(path) {
    const metadata = await readSelected(path, /* @__PURE__ */ new Set(["avatar.json"]));
    let name = "source.png";
    if (metadata["avatar.json"]) {
      try {
        name = parseManifest(JSON.parse(new TextDecoder().decode(metadata["avatar.json"]))).source ?? name;
        checkEntryName(name);
      } catch (error) {
        throw new HttpError(400, error.message);
      }
    }
    const file = resolve2(path, name);
    if (!inside(path, file)) throw new HttpError(400, "Path must stay inside the project.");
    if (!await exists2(file)) return null;
    await checked(path, file);
    return (await stat(file)).isFile() ? file : null;
  }
  async function importArchive(bytes) {
    let files, title;
    try {
      files = unpackAvatar(bytes);
      const errors = validateAvatarFiles(files);
      if (!files["avatar.json"]) errors.unshift("avatar.json: required in a .mavatar archive");
      if (errors.length) throw new Error(errors.join("\n"));
      const metadata = JSON.parse(new TextDecoder().decode(files["avatar.json"]));
      const manifest = parseManifest(metadata);
      title = manifest.name;
      const paths = /* @__PURE__ */ new Map();
      for (const name2 of Object.keys(files)) {
        const parts = name2.replace(/\/$/, "").split("/");
        if (parts.some((part) => !part || part === "." || /[:<>"|?*]/.test(part) || [...part].some((char) => char.charCodeAt(0) < 32) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error(`ZIP entry ${JSON.stringify(name2)}: invalid filesystem path`);
        const normalized = parts.join("/").normalize("NFC").toLowerCase();
        if (paths.has(normalized)) throw new Error(`ZIP entry ${JSON.stringify(name2)}: conflicting filesystem path`);
        paths.set(normalized, name2.endsWith("/"));
      }
      for (const name2 of paths.keys()) {
        const parts = name2.split("/");
        for (let i = 1; i < parts.length; i++) if (paths.get(parts.slice(0, i).join("/")) === false) throw new Error(`ZIP entry ${JSON.stringify(name2)}: parent is a file`);
      }
      if (manifest.source) {
        checkEntryName(manifest.source);
        const source = manifest.source.split("/").filter((part) => part && part !== ".").join("/");
        if (files[source] && manifest.source !== "source.png") {
          files["source.png"] = files[source];
          if (source !== "source.png" && !source.startsWith("built/")) delete files[source];
          metadata.source = "source.png";
          if (metadata.thumbnail === manifest.source) metadata.thumbnail = "source.png";
          files["avatar.json"] = new TextEncoder().encode(JSON.stringify(metadata, null, 2) + "\n");
          const normalizedErrors = validateAvatarFiles(files);
          if (normalizedErrors.length) throw new Error(normalizedErrors.join("\n"));
        }
      }
    } catch (error) {
      throw new HttpError(400, error.message);
    }
    await mkdir2(base, { recursive: true });
    if (await realpath2(base) !== base) throw new HttpError(400, "Project root cannot redirect elsewhere.");
    let stem = title.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+|[. -]+$/g, "").slice(0, 80) || "avatar";
    if (stem === SAMPLE || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `avatar-${stem}`;
    let name = stem, path = resolve2(base, name);
    for (let index = 1; ; index++) {
      try {
        await mkdir2(path);
        break;
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
        name = `${stem}-${index}`;
        path = resolve2(base, name);
      }
    }
    try {
      const names = Object.keys(files).filter((name2) => !name2.endsWith("/")).sort((a, b) => Number(a === "rig.json") - Number(b === "rig.json"));
      for (const name2 of names) {
        const file = resolve2(path, name2);
        if (!inside(path, file)) throw new HttpError(400, "Path must stay inside the project.");
        await mkdir2(dirname2(file), { recursive: true });
        await checked(base, path);
        await checked(path, dirname2(file));
        await writeFile2(file, files[name2], { flag: "wx" });
      }
      return await info(name);
    } catch (error) {
      await checked(base, path);
      await rm2(path, { recursive: true, force: true });
      throw error;
    }
  }
  async function saveRig(path, rig) {
    const errors = validateRig(rig);
    if (errors.length) throw new HttpError(400, `Invalid rig: ${errors.join(", ")}`);
    const target = resolve2(path, "rig.json"), temporary = resolve2(path, `.rig-${randomUUID()}.tmp`), backup = `${temporary}.bak`;
    try {
      if (await exists2(target)) {
        const previous = await readFile2(await checked(path, target));
        await writeFile2(backup, previous, { flag: "wx" });
        await rename2(backup, `${target}.bak`);
      }
      await writeFile2(temporary, JSON.stringify(rig, null, 2) + "\n", { flag: "wx" });
      await rename2(temporary, target);
    } finally {
      await Promise.all([temporary, backup].map((file) => unlink(file).catch(() => void 0)));
    }
  }
  async function requests(path, name) {
    const items = [];
    for (const variant of VARIANTS) {
      const prompt = resolve2(path, "variant-requests", variant, "prompt.md");
      if (await exists2(prompt)) {
        await checked(path, resolve2(path, "variant-requests", variant, "mask.png"));
        items.push({
          name: variant,
          prompt: await readFile2(await checked(path, prompt), "utf8"),
          maskUrl: `./__studio/projects/${encodeURIComponent(name)}/variant-requests/${variant}/mask.png?v=${Date.now()}`
        });
      }
    }
    return items;
  }
  async function folder(name) {
    if (!safeName.test(name) || name === "." || name === ".." || name.startsWith(".studio-job-")) throw new HttpError(400, "Invalid project name.");
    const parent = name === SAMPLE ? sample : base;
    const path = name === SAMPLE ? sample : resolve2(base, name);
    if (await realpath2(parent) !== parent) throw new HttpError(400, "Project root cannot redirect elsewhere.");
    await checked(parent, path);
    if (!(await stat(path)).isDirectory()) throw new HttpError(404, "Project not found.");
    return path;
  }
  async function info(name) {
    const path = await folder(name), rigPath = resolve2(path, "rig.json");
    const draft = resolve2(path, "rig.draft.json");
    if (!await exists2(rigPath) && !(await exists2(draft) && await exists2(resolve2(path, "built")))) return null;
    const file = await checked(path, await exists2(rigPath) ? rigPath : draft);
    return {
      name,
      relativePath: relative2(root, path).split(sep).join("/"),
      absolutePath: path,
      displayPath: displayPath(path),
      rigFile: await exists2(rigPath) ? "rig.json" : "rig.draft.json",
      updatedAt: (await stat(file)).mtime.toISOString(),
      hasSprites: await exists2(resolve2(path, "built/sprites/sprites.json")),
      hasVariants: await exists2(resolve2(path, "variants")),
      hasSource: !!await sourceFile(path),
      readOnly: name === SAMPLE
    };
  }
  return async (req, res, next) => {
    if (!req.url?.startsWith("/__studio/")) {
      next();
      return;
    }
    const json = (status, value) => {
      res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(JSON.stringify(value));
    };
    let errorPath = "projects";
    try {
      if (req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) throw new HttpError(403, "Use the local studio origin.");
      const host = req.headers.host?.split(":")[0];
      if (host !== "127.0.0.1" && host !== "localhost") throw new HttpError(403, "Local requests only.");
      const raw = req.url.split("?")[0].slice("/__studio/".length).split("/");
      const parts = raw.map((part) => {
        let value;
        try {
          value = decodeURIComponent(part);
        } catch {
          throw new HttpError(400, "Invalid path encoding.");
        }
        if (!safeName.test(value) || value === "." || value === "..") throw new HttpError(400, "Invalid path segment.");
        return value;
      });
      if (parts.length === 1 && parts[0] === "context" && req.method === "GET") {
        json(200, { rootPath: root, displayRootPath: displayPath(root) });
        return;
      }
      if (parts.length === 1 && parts[0] === "reveal" && req.method === "POST") {
        await reveal(root);
        json(200, { path: root });
        return;
      }
      if (parts.length === 1 && parts[0] === "export" && req.method === "POST") {
        const body = await readBody(req);
        if (!body || typeof body.project !== "string" || body.includeSource !== void 0 && typeof body.includeSource !== "boolean") throw new HttpError(400, "Expected project and includeSource.");
        const path2 = await folder(body.project);
        if (saving.has(path2)) throw new HttpError(409, "A project operation is already in progress.");
        saving.add(path2);
        try {
          let bytes2;
          try {
            bytes2 = await packProjectAvatar((names) => readSelected(path2, names), { name: body.project, includeSource: body.includeSource ?? true, lipSync: body.lipSync });
          } catch (error) {
            if (error instanceof HttpError || error.code) throw error;
            throw new HttpError(400, error.message);
          }
          res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${body.project}.mavatar"`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
          res.end(Buffer.from(bytes2));
        } finally {
          saving.delete(path2);
        }
        return;
      }
      if (parts.length === 1 && parts[0] === "import" && req.method === "POST") {
        if (req.headers["content-type"]?.split(";")[0] !== "application/octet-stream") throw new HttpError(400, "Send application/octet-stream.");
        json(200, await importArchive(await readBytes(req, 128 * 1024 * 1024)));
        return;
      }
      if (parts.length === 1 && parts[0] === "copy-sample" && req.method === "POST") {
        const rig = await readBody(req), errors = validateRig(rig);
        if (errors.length) throw new HttpError(400, `Invalid rig: ${errors.join(", ")}`);
        await folder(SAMPLE);
        await mkdir2(base, { recursive: true });
        if (await realpath2(base) !== base) throw new HttpError(400, "Project root cannot redirect elsewhere.");
        let name2 = "miko-qipao-copy", path2 = resolve2(base, name2);
        for (let index = 1; ; index++) {
          try {
            await mkdir2(path2);
            break;
          } catch (error) {
            if (error.code !== "EEXIST") throw error;
            name2 = `miko-qipao-copy-${index}`;
            path2 = resolve2(base, name2);
          }
        }
        try {
          await cp(sample, path2, { recursive: true, force: false, filter: async (source) => {
            if ((await lstat2(source)).isSymbolicLink()) throw new HttpError(400, "Sample contains redirected files.");
            return true;
          } });
          await saveRig(path2, rig);
          json(200, await info(name2));
        } catch (error) {
          await rm2(path2, { recursive: true, force: true });
          throw error;
        }
        return;
      }
      if (parts[0] !== "projects") throw new HttpError(404, "Not found.");
      if (parts.length === 1 && req.method === "GET") {
        if (await exists2(base) && await realpath2(base) !== base) throw new HttpError(400, "Project root cannot redirect elsewhere.");
        const entries2 = await exists2(base) ? await readdir2(base, { withFileTypes: true }) : [];
        const list = [];
        const add = async (name2, isSample = false) => {
          try {
            if (isSample && (!await exists2(resolve2(sample, "source.png")) || !await exists2(resolve2(sample, "built/base.png")))) return;
            const value = await info(name2);
            if (value) list.push(value);
          } catch (error) {
            if (error instanceof HttpError) return;
            const relativePath = isSample ? "samples/miko-qipao" : `projects/${name2}`;
            const failure = fileSystemError(root, error, relativePath);
            if (!failure) throw error;
            if (failure.body.code === "ENOENT") return;
            list.push({ name: name2, relativePath, readOnly: isSample, error: { code: failure.body.code, path: failure.body.path } });
          }
        };
        for (const entry of entries2) if (entry.isDirectory() && !entry.name.startsWith(".") && safeName.test(entry.name) && entry.name !== SAMPLE) {
          await add(entry.name);
        }
        await add(SAMPLE, true);
        list.sort((a, b) => (b.error ? "" : b.updatedAt).localeCompare(a.error ? "" : a.updatedAt));
        json(200, list);
        return;
      }
      if (parts.length === 2 && parts[0] === "projects" && parts[1].endsWith(".mavatar") && req.method === "GET") {
        errorPath = `projects/${parts[1]}`;
        if (await realpath2(base) !== base) throw new HttpError(400, "Project root cannot redirect elsewhere.");
        const file2 = await checked(base, resolve2(base, parts[1]));
        if (!(await stat(file2)).isFile()) throw new HttpError(404, "Archive not found.");
        const bytes2 = await readFile2(file2);
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
        res.end(bytes2);
        return;
      }
      if (parts.length < 3) throw new HttpError(404, "Not found.");
      errorPath = parts[1] === SAMPLE ? "samples/miko-qipao" : `projects/${parts[1]}`;
      const name = parts[1], path = await folder(name), tail = parts.slice(2);
      if (req.method === "POST" && tail.length === 1 && tail[0] === "reveal") {
        await reveal(path);
        json(200, { path });
        return;
      }
      if (req.method === "POST" && tail.length === 1 && tail[0] === "rename") {
        if (name === SAMPLE) throw new HttpError(403, "The sample is read-only.");
        const body = await readBody(req), next2 = body?.name;
        if (typeof next2 !== "string" || !projectName.test(next2) || next2 === SAMPLE) throw new HttpError(400, "Use letters, digits, hyphens or underscores, starting with a letter or digit.");
        if (next2 === name) {
          json(200, await info(name));
          return;
        }
        const target = resolve2(base, next2);
        if (await exists2(target) && await realpath2(target) !== path) throw new HttpError(409, "A project with this name already exists.");
        if (saving.has(path)) throw new HttpError(409, "A project operation is already in progress.");
        saving.add(path);
        try {
          await renameResilient(path, target);
          const manifest = resolve2(target, "avatar.json");
          if (await exists2(manifest)) {
            const raw2 = JSON.parse(await readFile2(await checked(target, manifest), "utf8"));
            if (raw2 && typeof raw2 === "object" && !Array.isArray(raw2) && raw2.name === name) {
              const temporary = resolve2(target, `.avatar-${randomUUID()}.tmp`);
              try {
                await writeFile2(temporary, JSON.stringify({ ...raw2, name: next2 }, null, 2) + "\n", { flag: "wx" });
                await rename2(temporary, manifest);
              } finally {
                await unlink(temporary).catch(() => void 0);
              }
            }
          }
          json(200, await info(next2));
        } finally {
          saving.delete(path);
        }
        return;
      }
      if (req.method === "GET" && tail.length === 1 && tail[0] === "variants") {
        const manifest = resolve2(path, "built/sprites/sprites.json");
        if (await exists2(manifest)) await checked(path, manifest);
        json(200, { variants: await variantState(path), requests: await requests(path, name) });
        return;
      }
      if (req.method === "POST" && tail.length === 1 && ["rig", "lip-sync", "rebuild", "variant-requests", "import-variants"].includes(tail[0])) {
        if (name === SAMPLE) throw new HttpError(403, "The sample is read-only.");
        if (!await sourceFile(path)) throw new HttpError(403, "Source image is missing. This avatar is playback-only.");
        const action = tail[0], body = await readBody(req, action === "import-variants" ? 36 * 1024 * 1024 : 1024 * 1024);
        let files = [];
        if (action === "import-variants") {
          try {
            files = decodeVariants(body);
          } catch (error) {
            throw new HttpError(400, error.message);
          }
        }
        if (saving.has(path)) throw new HttpError(409, "A project operation is already in progress.");
        saving.add(path);
        try {
          if (action === "lip-sync") {
            const target = resolve2(path, "avatar.json"), temporary = resolve2(path, `.avatar-${randomUUID()}.tmp`);
            let raw2 = { format: "mesh-avatar", version: 1, name };
            if (await exists2(target)) raw2 = JSON.parse(await readFile2(await checked(path, target), "utf8"));
            const manifest = { ...raw2, lipSync: body };
            try {
              manifest.lipSync = parseManifest(manifest).lipSync;
            } catch (error) {
              throw new HttpError(400, error.message);
            }
            try {
              await writeFile2(temporary, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
              await rename2(temporary, target);
            } finally {
              await unlink(temporary).catch(() => void 0);
            }
            json(200, { path: relative2(root, target).split(sep).join("/") });
          } else if (action === "rig") {
            await saveRig(path, body);
            json(200, { path: relative2(root, resolve2(path, "rig.json")).split(sep).join("/") });
          } else {
            if (action === "rebuild" || action === "variant-requests") await saveRig(path, body?.rig);
            const result = await projectJob(root, path, action === "rebuild" ? "build-layers" : action === "variant-requests" ? "variant-requests" : "build-sprites", files, runner);
            json(200, { ...result, ...action === "variant-requests" ? { requests: await requests(path, name) } : {} });
          }
        } finally {
          saving.delete(path);
        }
        return;
      }
      if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
      const fileName = tail.join("/");
      if (!(["avatar.json", "rig.json", "rig.draft.json", "source.png"].includes(fileName) || ["built", "variants"].includes(tail[0]) || tail.length === 3 && tail[0] === "variant-requests" && VARIANTS.includes(tail[1]) && tail[2] === "mask.png")) throw new HttpError(404, "File not available.");
      const mime = { ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
      const contentType = mime[extname(fileName)];
      if (!contentType) throw new HttpError(404, "File not available.");
      const file = fileName === "source.png" ? await sourceFile(path) : await checked(path, resolve2(path, ...tail));
      if (!file) throw new HttpError(404, "Source image is missing.");
      const bytes = await readFile2(file);
      res.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
      res.end(bytes);
    } catch (error) {
      if (error instanceof JobError) {
        json(422, { error: error.code, code: error.code, log: error.log });
        return;
      }
      const failure = fileSystemError(root, error, errorPath);
      if (failure) {
        json(failure.status, failure.body);
        return;
      }
      const status = error instanceof HttpError ? error.status : error.code === "ENOENT" ? 404 : 500;
      json(status, { error: error instanceof HttpError ? error.message : status === 404 ? "Project or file not found." : "Local project operation failed." });
    }
  };
}
export {
  JobError,
  localProjectMiddleware,
  packProjectAvatar,
  revealFolder
};
