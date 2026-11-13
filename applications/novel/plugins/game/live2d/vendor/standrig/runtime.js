// StandRig d74c6aba9a02ba3cc33c34f7426c13d09b4bc6f5, Apache-2.0. See LICENSE and PROVENANCE.md.
// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/evaluationCache.ts
var EvaluationCache = class {
  buckets = /* @__PURE__ */ new Map();
  get(bucket, key, build) {
    let entries = this.buckets.get(bucket);
    if (!entries) {
      entries = /* @__PURE__ */ new WeakMap();
      this.buckets.set(bucket, entries);
    }
    if (entries.has(key)) return entries.get(key);
    const value = build();
    entries.set(key, value);
    return value;
  }
};
var active;
function withEvaluationCache(cache2, evaluate) {
  const previous = active;
  active = cache2;
  try {
    return evaluate();
  } finally {
    active = previous;
  }
}
function evaluationCache() {
  return active;
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/bindingPreparation.ts
function prepareRigBindingOrder(rig) {
  for (const part of rig.parts) {
    sortBindings(part.bindings);
    sortMultiBindings(part.multiBindings);
    sortWarpPins(part.warp?.pins);
    for (const binding of part.artMesh?.bindings ?? []) binding.keys.sort((a, b) => a.input - b.input);
    sortArtMeshMultiBindings(part.artMesh?.multiBindings);
  }
  for (const deformer of rig.deformers ?? []) {
    sortBindings(deformer.bindings);
    sortMultiBindings(deformer.multiBindings);
    sortWarpPins(deformer.warp?.pins);
  }
  return rig;
}
function sortBindings(bindings) {
  for (const binding of bindings ?? []) binding.keys.sort((a, b) => a.input - b.input);
}
function sortMultiBindings(bindings) {
  for (const binding of bindings ?? []) sortMultiKeyforms(binding);
}
function sortMultiKeyforms(binding) {
  const [x, y] = binding.parameters;
  binding.keyforms.sort((a, b) => (a.inputs[x] ?? 0) - (b.inputs[x] ?? 0) || (a.inputs[y] ?? 0) - (b.inputs[y] ?? 0));
}
function sortArtMeshMultiBindings(bindings) {
  for (const binding of bindings ?? []) binding.keyforms.sort((a, b) => {
    for (const parameter of binding.parameters) {
      const delta = (a.inputs[parameter] ?? 0) - (b.inputs[parameter] ?? 0);
      if (delta) return delta;
    }
    return 0;
  });
}
function sortWarpPins(pins) {
  for (const pin of pins ?? []) {
    for (const binding of pin.bindings ?? []) binding.keys.sort((a, b) => a.input - b.input);
    for (const binding of pin.multiBindings ?? []) {
      const [x, y] = binding.parameters;
      binding.keyforms.sort((a, b) => (a.inputs[x] ?? 0) - (b.inputs[x] ?? 0) || (a.inputs[y] ?? 0) - (b.inputs[y] ?? 0));
    }
  }
}
function sortedKeysOrCopy(keys) {
  const sorted = () => {
    for (let i = 1; i < keys.length; i++) if (keys[i - 1].input > keys[i].input) return [...keys].sort((a, b) => a.input - b.input);
    return keys;
  };
  return evaluationCache()?.get("sorted-keys", keys, sorted) ?? sorted();
}
function orderedAxis(values) {
  const axis = [...values];
  for (let i = 1; i < axis.length; i++) if (axis[i - 1] > axis[i]) return axis.sort((a, b) => a - b);
  return axis;
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/types.ts
var PARAMETER_IDS = [
  "ParamAngleX",
  "ParamAngleY",
  "ParamAngleZ",
  "ParamEyeBallX",
  "ParamEyeBallY",
  "ParamBodyAngleX",
  "ParamBodyAngleY",
  "ParamMouthOpen",
  "ParamMouthForm",
  "ParamMouthSmile",
  "ParamEyeLOpen",
  "ParamEyeROpen"
];
var TRANSFORM_PROPERTIES = ["x", "y", "rotation", "scaleX", "scaleY", "opacity"];
var WARP_BINDING_PROPERTIES = ["warp.bendX", "warp.bendY", "warp.taperX", "warp.taperY"];
var WARP_PIN_BINDING_PROPERTIES = ["offsetX", "offsetY"];
var PARAMETER_INTERPOLATIONS = ["linear", "smoothstep", "hold", "arc", "curve"];
var DEFAULT_TRANSFORM = {
  x: 0,
  y: 0,
  rotation: 0,
  scaleX: 1,
  scaleY: 1,
  pivotX: 0.5,
  pivotY: 0.5,
  opacity: 1
};

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/bindings.ts
var INTERPOLATION_SET = new Set(PARAMETER_INTERPOLATIONS);
function isParameterInterpolation(value) {
  return typeof value === "string" && INTERPOLATION_SET.has(value);
}
function normalizeParameterInterpolation(value) {
  return isParameterInterpolation(value) ? value : "linear";
}
function sampleBinding(binding, input) {
  const keys = sortedKeysOrCopy(binding.keys);
  if (keys.length === 0) {
    return 0;
  }
  if (input <= keys[0].input) {
    return keys[0].value;
  }
  const last = keys[keys.length - 1];
  if (input >= last.input) {
    return last.value;
  }
  for (let index = 0; index < keys.length - 1; index += 1) {
    const from = keys[index];
    const to = keys[index + 1];
    if (input >= from.input && input <= to.input) {
      const amount = (input - from.input) / (to.input - from.input || 1);
      const eased = applyParameterInterpolation(normalizeParameterInterpolation(binding.interpolation), amount, binding.curve);
      return from.value + (to.value - from.value) * eased;
    }
  }
  return 0;
}
function applyParameterInterpolation(interpolation, amount, curve) {
  const clamped = Math.min(1, Math.max(0, amount));
  if (interpolation === "smoothstep") return clamped * clamped * (3 - 2 * clamped);
  if (interpolation === "hold") return clamped >= 1 ? 1 : 0;
  if (interpolation === "arc") return Math.sin(clamped * Math.PI / 2);
  if (interpolation === "curve") return sampleParameterCurve(curve, clamped);
  return clamped;
}
function sampleParameterCurve(curve, amount) {
  const clamped = Math.min(1, Math.max(0, amount));
  const points = (curve?.controlPoints ?? []).filter((point) => Number.isFinite(point?.t) && Number.isFinite(point?.value)).map((point) => ({ t: Math.min(1, Math.max(0, point.t)), value: Math.min(1, Math.max(0, point.value)) })).sort((left, right) => left.t - right.t);
  if (points.length < 2) return clamped;
  if (clamped <= points[0].t) return points[0].value;
  const lastIndex = points.length - 1;
  if (clamped >= points[lastIndex].t) return points[lastIndex].value;
  for (let index = 0; index < lastIndex; index += 1) {
    const from = points[index];
    const to = points[index + 1];
    if (clamped < from.t || clamped > to.t) continue;
    const span = to.t - from.t || 1;
    const u = (clamped - from.t) / span;
    const p0 = points[Math.max(0, index - 1)].value;
    const p1 = from.value;
    const p2 = to.value;
    const p3 = points[Math.min(lastIndex, index + 2)].value;
    const u2 = u * u;
    const u3 = u2 * u;
    const value = 0.5 * (2 * p1 + (-p0 + p2) * u + (2 * p0 - 5 * p1 + 4 * p2 - p3) * u2 + (-p0 + 3 * p1 - 3 * p2 + p3) * u3);
    return Math.min(1, Math.max(0, value));
  }
  return clamped;
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/artMeshBlendShape.ts
function sampleArtMeshBlendShape(shape, input) {
  if (!Number.isFinite(input) || !Number.isFinite(shape.neutralInput) || !Number.isFinite(shape.targetInput) || shape.neutralInput === shape.targetInput) return /* @__PURE__ */ new Map();
  const weight = sampleArtMeshBlendShapeWeight(shape, input);
  const offsets = /* @__PURE__ */ new Map();
  for (const offset of shape.offsets ?? []) {
    if (offset && typeof offset.vertexId === "string" && Number.isFinite(offset.x) && Number.isFinite(offset.y)) {
      offsets.set(offset.vertexId, { x: offset.x * weight, y: offset.y * weight });
    }
  }
  return offsets;
}
function sampleArtMeshBlendShapeWeight(shape, input) {
  if (!Number.isFinite(input) || !Number.isFinite(shape.neutralInput) || !Number.isFinite(shape.targetInput) || shape.neutralInput === shape.targetInput) return 0;
  const amount = Math.min(1, Math.max(0, (input - shape.neutralInput) / (shape.targetInput - shape.neutralInput)));
  return applyParameterInterpolation(normalizeParameterInterpolation(shape.interpolation), amount, shape.curve);
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/parameterGrid.ts
function indexGrid(parameters, keys) {
  const axes = parameters.map(() => /* @__PURE__ */ new Set()), points = /* @__PURE__ */ new Map();
  for (const key of keys ?? []) {
    const coordinates = parameters.map((p) => key?.inputs?.[p]);
    if (!coordinates.every(Number.isFinite)) continue;
    coordinates.forEach((value, axis) => axes[axis].add(value));
    points.set(coordinates.join("|"), key);
  }
  return { axes: axes.map((axis) => [...axis].sort((a, b) => a - b)), points };
}
function sampleParameterGrid(parameters, keys, values, interpolation, curve) {
  if (!validGridParameters(parameters)) return [];
  const indexes = Array.isArray(keys) ? evaluationCache()?.get("parameter-grids", keys, () => /* @__PURE__ */ new WeakMap()) : void 0;
  let index = indexes?.get(parameters);
  if (!index) {
    index = indexGrid(parameters, keys);
    indexes?.set(parameters, index);
  }
  const { axes, points } = index;
  const spans = axes.map((ordered, i) => {
    if (ordered.length < 2) return void 0;
    const raw = values[parameters[i]] ?? 0;
    const value = Math.max(ordered[0], Math.min(ordered.at(-1), raw));
    let lo = 0, hi = ordered.length - 2;
    while (lo < hi) {
      const mid = lo + hi >>> 1;
      if (ordered[mid + 1] < value) lo = mid + 1;
      else hi = mid;
    }
    const low = ordered[lo], high = ordered[lo + 1];
    return { low, high, t: applyParameterInterpolation(normalizeParameterInterpolation(interpolation), (value - low) / (high - low), curve) };
  });
  if (spans.some((span) => !span)) return [];
  const result = [];
  for (let corner = 0; corner < 2 ** parameters.length; corner++) {
    let weight = 1;
    const coordinates = spans.map((span, axis) => {
      const high = Boolean(corner & 1 << axis);
      weight *= high ? span.t : 1 - span.t;
      return high ? span.high : span.low;
    });
    const key = points.get(coordinates.join("|"));
    if (!key) return [];
    result.push({ key, weight });
  }
  return result;
}
function validGridParameters(parameters) {
  return Array.isArray(parameters) && [2, 3].includes(parameters.length) && parameters.every((p) => typeof p === "string" && p.trim().length > 0) && new Set(parameters).size === parameters.length;
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/extendedBlendShape.ts
var blendWeight = (shape, values) => sampleArtMeshBlendShapeWeight(shape, values[shape.parameter] ?? shape.neutralInput);
function applyTransformShapes(pose, shapes, values) {
  for (const shape of shapes ?? []) {
    const w = blendWeight(shape, values);
    for (const [key, value] of Object.entries(shape.transform ?? {})) {
      const property = key;
      if (property === "scaleX" || property === "scaleY")
        pose[property] *= Math.pow(value, w);
      else
        pose[property] += value * w;
    }
  }
}
function resolveSharedShape(field, shapes, values) {
  if (!field || !shapes?.some((s) => s.sharedPoints?.length) && !field.controlPoints.some((p) => p.bindings?.length || p.multiBindings?.length))
    return field;
  const result = {
    ...field,
    bounds: { ...field.bounds },
    grid: { ...field.grid },
    controlPoints: field.controlPoints.map((point) => ({ ...point }))
  };
  for (const point of result.controlPoints) for (const binding of (point.bindings ?? []).slice(0, 16)) {
    const value = sampleBinding(binding, values[binding.parameter] ?? 0);
    point[binding.property] = binding.additive === false ? value : point[binding.property] + value;
  }
  for (const point of result.controlPoints) for (const binding of (point.multiBindings ?? []).slice(0, 16)) {
    const corners = sampleParameterGrid(binding.parameters, binding.keyforms, values, binding.interpolation, binding.curve);
    if (!corners.length) continue;
    const value = corners.reduce((sum, corner) => sum + corner.key.value * corner.weight, 0);
    point[binding.property] = binding.additive === false ? value : point[binding.property] + value;
  }
  const pointsById = /* @__PURE__ */ new Map();
  if (shapes?.some((shape) => shape.sharedPoints?.length)) {
    for (const point of result.controlPoints) if (!pointsById.has(point.id)) pointsById.set(point.id, point);
  }
  for (const shape of shapes ?? []) {
    if (!shape.sharedPoints?.length) continue;
    const w = blendWeight(shape, values);
    for (const delta of shape.sharedPoints ?? []) {
      const point = pointsById.get(delta.id);
      if (point) {
        point.offsetX += delta.x * w;
        point.offsetY += delta.y * w;
      }
    }
  }
  return result;
}
function validateBlendWeight(shape, rig) {
  if (!shape || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(shape.id))
    throw Error("invalid blend shape id");
  const parameter = rig.parameters.find((p) => p.id === shape.parameter);
  if (!parameter)
    throw Error("blend shape parameter not found");
  if (![shape.neutralInput, shape.targetInput].every(Number.isFinite) || shape.neutralInput === shape.targetInput)
    throw Error("blend shape inputs must be distinct finite numbers");
  if ([shape.neutralInput, shape.targetInput].some((v) => v < parameter.min || v > parameter.max))
    throw Error("blend shape input outside parameter range");
  if (shape.interpolation !== void 0 && !isParameterInterpolation(shape.interpolation))
    throw Error("invalid blend interpolation");
  if (shape.curve && (!Array.isArray(shape.curve.controlPoints) || shape.curve.controlPoints.length < 2 || shape.curve.controlPoints.some((p) => !Number.isFinite(p.t) || !Number.isFinite(p.value) || p.t < 0 || p.t > 1 || p.value < 0 || p.value > 1)))
    throw Error("invalid blend curve");
}
function validateExtendedShape(shape, rig, ownerId, editing = true) {
  validateBlendWeight(shape, rig);
  const finiteTree = (v) => {
    if (typeof v === "number" && !Number.isFinite(v))
      throw Error("nonfinite blend delta");
    if (v && typeof v === "object")
      Object.values(v).forEach(finiteTree);
  };
  finiteTree(shape);
  if ("transform" in shape && shape.transform) {
    if (Object.keys(shape.transform).some((k) => !["x", "y", "rotation", "scaleX", "scaleY", "opacity"].includes(k)) || Object.values(shape.transform).some((v) => typeof v !== "number"))
      throw Error("invalid transform delta");
    if ((shape.transform.scaleX ?? 1) <= 0 || (shape.transform.scaleY ?? 1) <= 0)
      throw Error("blend scale multipliers must be positive");
  }
  const points = (deltas, ids) => {
    if (deltas === void 0)
      return;
    if (!Array.isArray(deltas) || deltas.length > 1e4 || new Set(deltas.map((d) => d.id)).size !== deltas.length || deltas.some((d) => !ids.includes(d.id) || !Number.isFinite(d.x) || !Number.isFinite(d.y)))
      throw Error("invalid blend point references");
  };
  if (shape.kind === "part") {
    const part = rig.parts.find((p) => p.id === ownerId);
    if (!part || editing && part.locked || !shape.transform)
      throw Error("part missing or locked");
  } else if (shape.kind === "deformer") {
    const deformer = rig.deformers?.find((d) => d.id === ownerId);
    if (!deformer || editing && deformer.locked)
      throw Error("deformer missing or locked");
    if ((shape.warp || shape.pins?.length) && (deformer.kind !== "warp" || !deformer.warp?.enabled))
      throw Error("enabled warp required");
    if (shape.warp && (Object.keys(shape.warp).some((k) => !["bendX", "bendY", "taperX", "taperY"].includes(k)) || Object.values(shape.warp).some((v) => typeof v !== "number")))
      throw Error("invalid warp delta");
    points(shape.pins, (deformer.warp?.pins ?? []).filter((p) => p.enabled).map((p) => p.id));
    points(shape.sharedPoints, deformer.sharedWarp?.enabled ? deformer.sharedWarp.controlPoints.filter((p) => p.enabled !== false).map((p) => p.id) : []);
  } else if (shape.kind === "art-path") {
    const part = rig.parts.find((p) => p.id === ownerId);
    const path = part?.artPaths?.find((p) => p.id === shape.pathId);
    if (!path || editing && part?.locked)
      throw Error("ArtPath missing or part locked");
    points(shape.points, path.points.map((p) => p.id));
    if (shape.width !== void 0 && typeof shape.width !== "number" || shape.opacity !== void 0 && typeof shape.opacity !== "number")
      throw Error("invalid path delta");
  } else if (shape.kind === "glue") {
    const glue = rig.glue?.find((g) => g.id === shape.glueId);
    if (!glue || glue.id !== ownerId || !["soft-seam", "stitch"].includes(glue.mode) || !Number.isFinite(shape.strength))
      throw Error("invalid glue shape");
    if (editing && rig.parts.some((p) => (p.id === glue.partAId || p.id === glue.partBId) && p.locked))
      throw Error("glue part locked");
  } else
    throw Error("unknown blend shape kind");
}
function glueBlendStrength(glue, values = {}) {
  const base = glue.mode === "stitch" ? 1 : glue.strength;
  return Math.min(1, Math.max(0, base + (glue.blendShapes ?? []).reduce((sum, s) => sum + s.strength * blendWeight(s, values), 0)));
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/multiBindings.ts
function sampleMultiParameterBinding(binding, values) {
  if (!Array.isArray(binding.parameters) || binding.parameters.length !== 2) return void 0;
  const [xParameter, yParameter] = binding.parameters;
  if (!xParameter || !yParameter || xParameter === yParameter) return void 0;
  const points = /* @__PURE__ */ new Map();
  const xs = /* @__PURE__ */ new Set();
  const ys = /* @__PURE__ */ new Set();
  for (const keyform of binding.keyforms ?? []) {
    const x = keyform?.inputs?.[xParameter];
    const y = keyform?.inputs?.[yParameter];
    if (!finite(x) || !finite(y) || !finite(keyform.value)) continue;
    xs.add(x);
    ys.add(y);
    points.set(pointKey(x, y), keyform.value);
  }
  if (xs.size < 2 || ys.size < 2) return void 0;
  const xAxis = orderedAxis(xs);
  const yAxis = orderedAxis(ys);
  const xSpan = enclosingSpan(xAxis, values[xParameter] ?? 0);
  const ySpan = enclosingSpan(yAxis, values[yParameter] ?? 0);
  if (!xSpan || !ySpan) return void 0;
  const q00 = points.get(pointKey(xSpan.low, ySpan.low));
  const q10 = points.get(pointKey(xSpan.high, ySpan.low));
  const q01 = points.get(pointKey(xSpan.low, ySpan.high));
  const q11 = points.get(pointKey(xSpan.high, ySpan.high));
  if (![q00, q10, q01, q11].every(finite)) return void 0;
  const interpolation = normalizeParameterInterpolation(binding.interpolation);
  const tx = applyParameterInterpolation(interpolation, ratio(values[xParameter] ?? 0, xSpan.low, xSpan.high), binding.curve);
  const ty = applyParameterInterpolation(interpolation, ratio(values[yParameter] ?? 0, ySpan.low, ySpan.high), binding.curve);
  const bottom = q00 + (q10 - q00) * tx;
  const top = q01 + (q11 - q01) * tx;
  return bottom + (top - bottom) * ty;
}
function enclosingSpan(axis, input) {
  if (axis.length < 2) return void 0;
  const clamped = Math.min(axis[axis.length - 1], Math.max(axis[0], input));
  for (let index = 0; index < axis.length - 1; index += 1) {
    if (clamped >= axis[index] && clamped <= axis[index + 1]) {
      return { low: axis[index], high: axis[index + 1] };
    }
  }
  return { low: axis[axis.length - 2], high: axis[axis.length - 1] };
}
function ratio(value, low, high) {
  return Math.min(1, Math.max(0, (value - low) / (high - low || 1)));
}
function pointKey(x, y) {
  return `${x}\0${y}`;
}
function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/warp.ts
var resolvedPinScopes = /* @__PURE__ */ new WeakMap();
function defaultWarpDeformer() {
  return {
    enabled: true,
    bendX: 0,
    bendY: 0,
    taperX: 0,
    taperY: 0,
    grid: {
      columns: 4,
      rows: 4
    },
    pins: []
  };
}
function normalizeWarpDeformer(warp) {
  const fallback = defaultWarpDeformer();
  const grid = warp?.grid;
  return {
    enabled: warp?.enabled !== false,
    pinBlendMode: warp?.pinBlendMode === "normalized" ? "normalized" : "legacy",
    bendX: finiteNumber(warp?.bendX, fallback.bendX),
    bendY: finiteNumber(warp?.bendY, fallback.bendY),
    taperX: finiteNumber(warp?.taperX, fallback.taperX),
    taperY: finiteNumber(warp?.taperY, fallback.taperY),
    grid: {
      columns: clampInteger(finiteNumber(grid?.columns, fallback.grid.columns), 1, 16),
      rows: clampInteger(finiteNumber(grid?.rows, fallback.grid.rows), 1, 16)
    },
    pins: Array.isArray(warp?.pins) ? warp.pins.slice(0, 32).map((pin, index) => normalizeWarpPin(pin, index)) : []
  };
}
function normalizeWarpPin(pin, index = 0) {
  return {
    id: typeof pin?.id === "string" && pin.id.trim() ? pin.id : `pin-${index + 1}`,
    name: typeof pin?.name === "string" && pin.name.trim() ? pin.name : `Pin ${index + 1}`,
    enabled: pin?.enabled !== false,
    multiBindings: Array.isArray(pin?.multiBindings) ? structuredClone(pin.multiBindings) : [],
    u: clamp01(finiteNumber(pin?.u, 0.5)),
    v: clamp01(finiteNumber(pin?.v, 0.5)),
    offsetX: finiteNumber(pin?.offsetX, 0),
    offsetY: finiteNumber(pin?.offsetY, 0),
    radius: clamp(finiteNumber(pin?.radius, 0.28), 1e-3, 1.5),
    strength: clamp(finiteNumber(pin?.strength, 0.75), 0, 1),
    linkedMirrorId: typeof pin?.linkedMirrorId === "string" && pin.linkedMirrorId.trim() ? pin.linkedMirrorId : void 0,
    bindings: Array.isArray(pin?.bindings) ? pin.bindings.slice(0, 16).map((binding) => normalizeWarpPinBinding(binding)) : []
  };
}
function normalizeWarpPinBinding(binding) {
  const property = isWarpPinBindingProperty(binding?.property) ? binding.property : "offsetX";
  const keys = Array.isArray(binding?.keys) ? binding.keys.map((key) => ({ input: finiteNumber(key?.input, 0), value: finiteNumber(key?.value, 0) })).sort((left, right) => left.input - right.input) : [];
  return {
    parameter: typeof binding?.parameter === "string" && binding.parameter.trim() ? binding.parameter : PARAMETER_IDS[0],
    property,
    keys: keys.length ? keys : [{ input: 0, value: 0 }],
    additive: binding?.additive !== false,
    interpolation: normalizeParameterInterpolation(binding?.interpolation),
    curve: binding?.curve ? structuredClone(binding.curve) : void 0
  };
}
function isTransformBindingProperty(property) {
  return TRANSFORM_PROPERTIES.includes(property);
}
function isWarpBindingProperty(property) {
  return WARP_BINDING_PROPERTIES.includes(property);
}
function isWarpPinBindingProperty(property) {
  return typeof property === "string" && WARP_PIN_BINDING_PROPERTIES.includes(property);
}
function getWarpBindingProperty(warp, property) {
  if (property === "warp.bendX") {
    return warp.bendX;
  }
  if (property === "warp.bendY") {
    return warp.bendY;
  }
  if (property === "warp.taperX") {
    return warp.taperX;
  }
  return warp.taperY;
}
function setWarpBindingProperty(warp, property, value) {
  if (property === "warp.bendX") {
    warp.bendX = value;
  } else if (property === "warp.bendY") {
    warp.bendY = value;
  } else if (property === "warp.taperX") {
    warp.taperX = value;
  } else {
    warp.taperY = value;
  }
}
function hasWarpEffect(warp) {
  return !!warp && warp.enabled && (Math.abs(warp.bendX) > 1e-3 || Math.abs(warp.bendY) > 1e-3 || Math.abs(warp.taperX) > 1e-3 || Math.abs(warp.taperY) > 1e-3 || (warp.pins ?? []).some(
    (pin) => pin.enabled !== false && pin.strength > 1e-3 && (Math.abs(pin.offsetX) > 1e-3 || Math.abs(pin.offsetY) > 1e-3 || hasWarpPinBindingEffect(pin))
  ));
}
function resolveDeformerWarp(deformer, values, sampleBinding2) {
  if (deformer.kind !== "warp") {
    return void 0;
  }
  const warp = normalizeWarpDeformer(deformer.warp);
  for (const pin of warp.pins ?? []) {
    resolvedPinScopes.set(pin, deformer.id);
  }
  for (const binding of deformer.bindings ?? []) {
    if (!isWarpBindingProperty(binding.property)) {
      continue;
    }
    const sampled = sampleBinding2(binding, values[binding.parameter] ?? 0);
    if (binding.additive === false) {
      setWarpBindingProperty(warp, binding.property, sampled);
    } else {
      setWarpBindingProperty(warp, binding.property, getWarpBindingProperty(warp, binding.property) + sampled);
    }
  }
  for (const binding of deformer.multiBindings ?? []) {
    if (!isWarpBindingProperty(binding.property)) continue;
    const sampled = sampleMultiParameterBinding(binding, values);
    if (sampled === void 0) continue;
    if (binding.additive === false) {
      setWarpBindingProperty(warp, binding.property, sampled);
    } else {
      setWarpBindingProperty(warp, binding.property, getWarpBindingProperty(warp, binding.property) + sampled);
    }
  }
  for (const pin of warp.pins ?? []) {
    for (const binding of pin.bindings ?? []) {
      const sampled = sampleBinding2(binding, values[binding.parameter] ?? 0);
      const current = binding.property === "offsetX" ? pin.offsetX : pin.offsetY;
      const value = binding.additive === false ? sampled : current + sampled;
      if (binding.property === "offsetX") {
        pin.offsetX = value;
      } else {
        pin.offsetY = value;
      }
    }
    for (const binding of pin.multiBindings ?? []) {
      const sampled = sampleMultiParameterBinding(binding, values);
      if (sampled === void 0) continue;
      const current = binding.property === "offsetX" ? pin.offsetX : pin.offsetY;
      const value = binding.additive === false ? sampled : current + sampled;
      if (binding.property === "offsetX") {
        pin.offsetX = value;
      } else {
        pin.offsetY = value;
      }
    }
  }
  for (const shape of deformer.blendShapes ?? []) {
    const w = blendWeight(shape, values);
    for (const key of ["bendX", "bendY", "taperX", "taperY"]) warp[key] += (shape.warp?.[key] ?? 0) * w;
    for (const delta of shape.pins ?? []) {
      const pin = warp.pins?.find((p) => p.id === delta.id);
      if (pin) {
        pin.offsetX += delta.x * w;
        pin.offsetY += delta.y * w;
      }
    }
  }
  return warp.enabled ? warp : void 0;
}
function mergeResolvedWarpDeformers(parentWarp, childWarp) {
  if (!parentWarp) {
    return childWarp ? cloneResolvedWarp(childWarp) : void 0;
  }
  if (!childWarp) {
    return cloneResolvedWarp(parentWarp);
  }
  const parent = cloneResolvedWarp(parentWarp);
  const child = cloneResolvedWarp(childWarp);
  const pins = [];
  const pinsById = /* @__PURE__ */ new Map();
  const addPin = (pin) => {
    const next = cloneWarpPin(pin);
    if (next.enabled === false) {
      next.offsetX = 0;
      next.offsetY = 0;
    }
    const scope = resolvedPinScopes.get(next);
    const key = scope ? `${scope}\0${next.id}` : next.id;
    const existing = pinsById.get(key);
    if (!existing) {
      pins.push(next);
      pinsById.set(key, next);
      return;
    }
    existing.enabled = existing.enabled !== false || next.enabled !== false;
    if (next.enabled !== false) {
      existing.offsetX += next.offsetX;
      existing.offsetY += next.offsetY;
    }
    existing.radius = Math.max(existing.radius, next.radius);
    existing.strength = Math.max(existing.strength, next.strength);
    existing.name = next.name || existing.name;
    existing.bindings = [...existing.bindings ?? [], ...next.bindings ?? []];
  };
  for (const pin of parent.pins ?? []) {
    addPin(pin);
  }
  for (const pin of child.pins ?? []) {
    addPin(pin);
  }
  return {
    enabled: parent.enabled !== false || child.enabled !== false,
    pinBlendMode: child.pinBlendMode === "normalized" ? "normalized" : parent.pinBlendMode,
    bendX: parent.bendX + child.bendX,
    bendY: parent.bendY + child.bendY,
    taperX: parent.taperX + child.taperX,
    taperY: parent.taperY + child.taperY,
    grid: {
      columns: Math.max(parent.grid.columns, child.grid.columns),
      rows: Math.max(parent.grid.rows, child.grid.rows)
    },
    pins
  };
}
function cloneResolvedWarp(warp) {
  return {
    enabled: warp.enabled,
    pinBlendMode: warp.pinBlendMode,
    bendX: warp.bendX,
    bendY: warp.bendY,
    taperX: warp.taperX,
    taperY: warp.taperY,
    grid: { ...warp.grid },
    pins: (warp.pins ?? []).map(cloneWarpPin)
  };
}
function cloneWarpPin(pin) {
  const clone = {
    ...pin,
    bindings: (pin.bindings ?? []).map((binding) => ({
      ...binding,
      keys: binding.keys.map((key) => ({ ...key }))
    }))
  };
  const scope = resolvedPinScopes.get(pin);
  if (scope) {
    resolvedPinScopes.set(clone, scope);
  }
  return clone;
}
function warpPoint(x, y, bounds, warp) {
  if (!bounds.width || !bounds.height || !warp.enabled) {
    return { x, y };
  }
  const u = (x - bounds.left) / bounds.width;
  const v = (y - bounds.top) / bounds.height;
  const xNorm = u * 2 - 1;
  const yNorm = v * 2 - 1;
  const bendX = warp.bendX * (1 - yNorm * yNorm);
  const bendY = warp.bendY * (1 - xNorm * xNorm);
  const taperX = warp.taperX * xNorm * yNorm;
  const taperY = warp.taperY * yNorm * xNorm;
  let dx = bendX + taperX;
  let dy = bendY + taperY;
  if (warp.pinBlendMode === "normalized") {
    let total = 0;
    let pinX = 0;
    let pinY = 0;
    for (const pin of warp.pins ?? []) {
      if (pin.enabled === false || pin.strength <= 0) continue;
      const distance = Math.hypot(u - pin.u, v - pin.v) / Math.max(1e-3, pin.radius);
      if (distance >= 1) continue;
      const influence = smoothstep01(1 - distance) * pin.strength;
      total += influence;
      pinX += pin.offsetX * influence;
      pinY += pin.offsetY * influence;
    }
    if (total > 0) {
      const baseWeight = Math.max(0, 1 - total);
      dx = (dx * baseWeight + pinX) / (baseWeight + total);
      dy = (dy * baseWeight + pinY) / (baseWeight + total);
    }
    return { x: x + dx, y: y + dy };
  }
  for (const pin of warp.pins ?? []) {
    if (pin.enabled === false || pin.strength <= 0) {
      continue;
    }
    const distance = Math.hypot(u - pin.u, v - pin.v) / Math.max(1e-3, pin.radius);
    if (distance >= 1) {
      continue;
    }
    const influence = smoothstep01(1 - distance) * pin.strength;
    dx += (pin.offsetX - dx) * influence;
    dy += (pin.offsetY - dy) * influence;
  }
  return {
    x: x + dx,
    y: y + dy
  };
}
function hasWarpPinBindingEffect(pin) {
  return (pin.bindings ?? []).some((binding) => binding.keys.some((key) => Math.abs(key.value) > 1e-3));
}
function finiteNumber(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function clampInteger(value, min, max) {
  return Math.min(max, Math.max(min, Math.round(value)));
}
function clamp01(value) {
  return clamp(value, 0, 1);
}
function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
function smoothstep01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/sharedWarp.ts
function normalizeSharedWarpField(value) {
  const columns = integer(value?.grid?.columns, 1, 16, 1);
  const rows = integer(value?.grid?.rows, 1, 16, 1);
  const bounds = {
    left: number(value?.bounds?.left, 0),
    top: number(value?.bounds?.top, 0),
    width: Math.max(1, number(value?.bounds?.width, 1)),
    height: Math.max(1, number(value?.bounds?.height, 1))
  };
  const points = /* @__PURE__ */ new Map();
  for (const point of value?.controlPoints ?? []) {
    const column = integer(point?.column, 0, columns, 0);
    const row = integer(point?.row, 0, rows, 0);
    points.set(`${column}|${row}`, {
      id: typeof point?.id === "string" && point.id ? point.id : `p-${column}-${row}`,
      bindings: point.bindings ? structuredClone(point.bindings) : void 0,
      multiBindings: point.multiBindings ? structuredClone(point.multiBindings) : void 0,
      column,
      row,
      offsetX: number(point?.offsetX, 0),
      offsetY: number(point?.offsetY, 0),
      enabled: point?.enabled !== false
    });
  }
  return { version: 1, enabled: value?.enabled !== false, bounds, grid: { columns, rows }, controlPoints: [...points.values()] };
}
function createSharedWarpSampler(field) {
  const snapshot = { ...field, bounds: { ...field.bounds }, grid: { ...field.grid } };
  const { columns, rows } = snapshot.grid;
  if (Number.isInteger(columns) && columns >= 1 && columns <= 16 && Number.isInteger(rows) && rows >= 1 && rows <= 16) {
    const stride = columns + 1;
    const offsetsX = new Float64Array(stride * (rows + 1));
    const offsetsY = new Float64Array(offsetsX.length);
    for (const point of field.controlPoints) {
      if (!Number.isInteger(point.column) || !Number.isInteger(point.row) || point.column < 0 || point.column > columns || point.row < 0 || point.row > rows) continue;
      const index = point.row * stride + point.column;
      offsetsX[index] = point.enabled === false ? 0 : point.offsetX;
      offsetsY[index] = point.enabled === false ? 0 : point.offsetY;
    }
    return (x, y) => {
      if (!snapshot.enabled) return { x: 0, y: 0 };
      const gx = clamp2((x - snapshot.bounds.left) / snapshot.bounds.width, 0, 1) * columns;
      const gy = clamp2((y - snapshot.bounds.top) / snapshot.bounds.height, 0, 1) * rows;
      const x0 = Math.floor(gx), y0 = Math.floor(gy);
      const x1 = Math.min(columns, x0 + 1), y1 = Math.min(rows, y0 + 1);
      const tx = gx - x0, ty = gy - y0;
      const a = y0 * stride + x0, b = y0 * stride + x1;
      const c = y1 * stride + x0, d = y1 * stride + x1;
      return {
        x: bilinear(offsetsX[a], offsetsX[b], offsetsX[c], offsetsX[d], tx, ty),
        y: bilinear(offsetsY[a], offsetsY[b], offsetsY[c], offsetsY[d], tx, ty)
      };
    };
  }
  const points = new Map(field.controlPoints.map((point) => [`${point.column}|${point.row}`, { ...point }]));
  return (x, y) => sampleIndexedSharedWarpField(snapshot, points, x, y);
}
function sampleSharedWarpField(field, x, y) {
  if (!field.enabled) return { x: 0, y: 0 };
  return sampleIndexedSharedWarpField(field, new Map(field.controlPoints.map((point) => [`${point.column}|${point.row}`, point])), x, y);
}
function sampleIndexedSharedWarpField(field, points, x, y) {
  if (!field.enabled) return { x: 0, y: 0 };
  const u = clamp2((x - field.bounds.left) / field.bounds.width, 0, 1);
  const v = clamp2((y - field.bounds.top) / field.bounds.height, 0, 1);
  const gx = u * field.grid.columns;
  const gy = v * field.grid.rows;
  const x0 = Math.floor(gx), y0 = Math.floor(gy);
  const x1 = Math.min(field.grid.columns, x0 + 1), y1 = Math.min(field.grid.rows, y0 + 1);
  const tx = gx - x0, ty = gy - y0;
  const point = (column, row) => points.get(`${column}|${row}`);
  const offset = (column, row) => {
    const entry = point(column, row);
    return entry && entry.enabled !== false ? entry : { offsetX: 0, offsetY: 0 };
  };
  const q00 = offset(x0, y0), q10 = offset(x1, y0), q01 = offset(x0, y1), q11 = offset(x1, y1);
  return {
    x: bilinear(q00.offsetX, q10.offsetX, q01.offsetX, q11.offsetX, tx, ty),
    y: bilinear(q00.offsetY, q10.offsetY, q01.offsetY, q11.offsetY, tx, ty)
  };
}
function warpSharedFieldPoint(field, x, y) {
  const offset = sampleSharedWarpField(field, x, y);
  return { x: x + offset.x, y: y + offset.y };
}
function hasSharedWarpFieldEffect(field) {
  return Boolean(field?.enabled && field.controlPoints.some((point) => point.enabled !== false && (Math.abs(point.offsetX) > 1e-4 || Math.abs(point.offsetY) > 1e-4)));
}
function bilinear(q00, q10, q01, q11, tx, ty) {
  return q00 * (1 - tx) * (1 - ty) + q10 * tx * (1 - ty) + q01 * (1 - tx) * ty + q11 * tx * ty;
}
function number(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function integer(value, min, max, fallback) {
  return Math.round(clamp2(number(value, fallback), min, max));
}
function clamp2(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/deformers.ts
function deformerForPart(part, deformers) {
  if (part.deformerId) {
    return deformers.find((deformer) => deformer.id === part.deformerId);
  }
  return deformers.find((deformer) => deformer.targetPartIds?.includes(part.id));
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/parameters.ts
var RESERVED_PARAMETERS = [
  { id: "ParamBodyAngleZ", label: "Body Z", min: -10, max: 10, default: 0, step: 0.1, group: "Body" },
  { id: "ParamBreath", label: "Breath", min: 0, max: 1, default: 0, step: 0.01, group: "Body" },
  { id: "ParamCheek", label: "Cheek", min: 0, max: 1, default: 0, step: 0.01, group: "Expression" },
  { id: "ParamEyeLSmile", label: "Eye L Smile", min: 0, max: 1, default: 0, step: 0.01, group: "Expression" },
  { id: "ParamEyeRSmile", label: "Eye R Smile", min: 0, max: 1, default: 0, step: 0.01, group: "Expression" },
  { id: "ParamBrowLY", label: "Brow L Y", min: -1, max: 1, default: 0, step: 0.01, group: "Brow" },
  { id: "ParamBrowRY", label: "Brow R Y", min: -1, max: 1, default: 0, step: 0.01, group: "Brow" },
  { id: "ParamBrowLX", label: "Brow L X", min: -1, max: 1, default: 0, step: 0.01, group: "Brow" },
  { id: "ParamBrowRX", label: "Brow R X", min: -1, max: 1, default: 0, step: 0.01, group: "Brow" },
  { id: "ParamBrowLAngle", label: "Brow L Angle", min: -1, max: 1, default: 0, step: 0.01, group: "Brow" },
  { id: "ParamBrowRAngle", label: "Brow R Angle", min: -1, max: 1, default: 0, step: 0.01, group: "Brow" },
  { id: "ParamBrowLForm", label: "Brow L Form", min: -1, max: 1, default: 0, step: 0.01, group: "Brow" },
  { id: "ParamBrowRForm", label: "Brow R Form", min: -1, max: 1, default: 0, step: 0.01, group: "Brow" },
  { id: "ParamHairFront", label: "Hair Front", min: -1, max: 1, default: 0, step: 0.01, group: "Physics" },
  { id: "ParamHairSide", label: "Hair Side", min: -1, max: 1, default: 0, step: 0.01, group: "Physics" },
  { id: "ParamHairBack", label: "Hair Back", min: -1, max: 1, default: 0, step: 0.01, group: "Physics" },
  { id: "ParamSkirt", label: "Skirt", min: -1, max: 1, default: 0, step: 0.01, group: "Physics" },
  { id: "ParamRibbon", label: "Ribbon", min: -1, max: 1, default: 0, step: 0.01, group: "Physics" }
];
var DEFAULT_PARAMETERS = [
  { id: "ParamAngleX", label: "Angle X", min: -30, max: 30, default: 0, step: 1, group: "Face" },
  { id: "ParamAngleY", label: "Angle Y", min: -30, max: 30, default: 0, step: 1, group: "Face" },
  { id: "ParamAngleZ", label: "Angle Z", min: -30, max: 30, default: 0, step: 1, group: "Face" },
  { id: "ParamEyeBallX", label: "Eye Ball X", min: -1, max: 1, default: 0, step: 0.01, group: "Gaze" },
  { id: "ParamEyeBallY", label: "Eye Ball Y", min: -1, max: 1, default: 0, step: 0.01, group: "Gaze" },
  { id: "ParamBodyAngleX", label: "Body X", min: -30, max: 30, default: 0, step: 1, group: "Body" },
  { id: "ParamBodyAngleY", label: "Body Y", min: -30, max: 30, default: 0, step: 1, group: "Body" },
  { id: "ParamMouthOpen", label: "Mouth", min: 0, max: 1, default: 0, step: 0.01, group: "Expression" },
  { id: "ParamMouthForm", label: "Mouth Form", min: -1, max: 1, default: 0, step: 0.01, group: "Expression" },
  { id: "ParamMouthSmile", label: "Mouth Smile", min: -1, max: 1, default: 0, step: 0.01, group: "Expression" },
  { id: "ParamEyeLOpen", label: "Eye L", min: 0, max: 1, default: 1, step: 0.01, group: "Expression" },
  { id: "ParamEyeROpen", label: "Eye R", min: 0, max: 1, default: 1, step: 0.01, group: "Expression" },
  ...RESERVED_PARAMETERS
];
function parameterDefinitionsForRig(rig) {
  const merged = /* @__PURE__ */ new Map();
  for (const parameter of DEFAULT_PARAMETERS) {
    merged.set(parameter.id, parameter);
  }
  for (const parameter of rig.parameters ?? []) {
    merged.set(parameter.id, { ...merged.get(parameter.id), ...parameter });
  }
  return Array.from(merged.values());
}
function defaultParameterValues(rig) {
  const values = {};
  for (const parameter of parameterDefinitionsForRig(rig)) {
    values[parameter.id] = parameter.default;
  }
  return values;
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/partAffine.ts
var FIELDS = ["a", "b", "c", "d", "e", "f"];
var identity = () => ({ a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 });
function samplePartAffine(binding, values) {
  const corners = sampleParameterGrid(binding.parameters, binding.keyforms, values);
  if (!corners.length) return identity();
  const result = identity();
  for (const field of FIELDS) result[field] = corners.reduce((value, corner) => value + corner.key.matrix[field] * corner.weight, 0);
  return result;
}
function resolvePartAffine(part, values) {
  let result = identity();
  for (const binding of part.affineBindings ?? []) {
    const next = samplePartAffine(binding, values), left = result;
    result = {
      a: next.a * left.a + next.c * left.b,
      b: next.b * left.a + next.d * left.b,
      c: next.a * left.c + next.c * left.d,
      d: next.b * left.c + next.d * left.d,
      e: next.a * left.e + next.c * left.f + next.e,
      f: next.b * left.e + next.d * left.f + next.f
    };
  }
  return result;
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/evaluator.ts
var MIN_SCALE = 1e-3;
function resolveRigFrame(rig, values, baseMatrix, options = {}) {
  const physicsEnabled = options.physics !== false;
  const physics = physicsEnabled ? options.physicsState ? resolvePhysicsFrame(
    rig,
    values,
    options.physicsState,
    clampPhysicsDt(options.physicsDt),
    finiteOr(options.physicsTime, 0)
  ) : resolveDeterministicPhysicsFrame(
    rig,
    values,
    finiteOr(options.physicsTime, 0),
    options.physicsSteps ?? 18,
    clampPhysicsDt(options.physicsDt)
  ) : emptyPhysicsFrame();
  const effectiveValues = applyPhysicsParameterOffsets(values, physics.parameterOffsets);
  const deformerStates = evaluateDeformers(rig.deformers ?? [], effectiveValues, physics.deformerOffsets);
  const neutralDeformerStates = evaluateDeformerStates(rig.deformers ?? [], defaultParameterValues(rig), void 0, false);
  return {
    values: effectiveValues,
    physics,
    skinningTransforms: resolveDeformerSkinningTransforms(deformerStates, neutralDeformerStates),
    parts: evaluateRigPartsWithDeformers(rig, effectiveValues, baseMatrix, {
      physicsOffsets: physics.partOffsets,
      physicsDeformerOffsets: physics.deformerOffsets
    }, deformerStates)
  };
}
function resolveDeformerSkinningTransforms(current, neutral) {
  const transforms = /* @__PURE__ */ new Map();
  const ids = /* @__PURE__ */ new Set([...current.keys(), ...neutral.keys()]);
  for (const id of ids) {
    const currentState = current.get(id);
    const neutralState = neutral.get(id);
    if (!currentState || !neutralState) continue;
    transforms.set(id, multiplyMatrices(currentState.matrix, invertMatrix(neutralState.matrix)));
  }
  return transforms;
}
function emptyPhysicsFrame() {
  return { partOffsets: /* @__PURE__ */ new Map(), deformerOffsets: /* @__PURE__ */ new Map(), parameterOffsets: {} };
}
function finiteOr(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function clampPhysicsDt(value) {
  return Math.min(0.1, Math.max(1e-4, finiteOr(value, 1 / 60)));
}
function evaluateRigParts(rig, values, baseMatrix, options = {}) {
  return evaluateRigPartsWithDeformers(
    rig,
    values,
    baseMatrix,
    options,
    evaluateDeformers(rig.deformers ?? [], values, options.physicsDeformerOffsets)
  );
}
function evaluateRigPartsWithDeformers(rig, values, baseMatrix, options, deformerStates) {
  const byId = new Map(rig.parts.map((part) => [part.id, part]));
  const deformers = rig.deformers ?? [];
  const computed = /* @__PURE__ */ new Map();
  const visiting = /* @__PURE__ */ new Set();
  const computePart = (part) => {
    const existing = computed.get(part.id);
    if (existing) {
      return existing;
    }
    if (visiting.has(part.id)) {
      const fallback = {
        matrix: baseMatrix,
        parentMatrix: baseMatrix,
        opacity: 1,
        visible: part.visible,
        pose: zeroPose(),
        warp: void 0
      };
      computed.set(part.id, fallback);
      return fallback;
    }
    visiting.add(part.id);
    const parent = part.parentId ? byId.get(part.parentId) : void 0;
    const parentComputed = parent ? computePart(parent) : { matrix: baseMatrix, parentMatrix: baseMatrix, opacity: 1, visible: true, pose: zeroPose(), warp: void 0 };
    const deformer = deformerForPart(part, deformers);
    const deformerComputed = deformer ? deformerStates.get(deformer.id) : void 0;
    const pose = resolvePartPose(part, values, options.physicsOffsets?.get(part.id));
    const localMatrix = multiplyMatrices(
      multiplyMatrices(translateMatrix(pose.x, pose.y), rotateMatrix(pose.rotation)),
      scaleMatrix(safeScale(pose.scaleX), safeScale(pose.scaleY))
    );
    const parentMatrix = deformerComputed ? multiplyMatrices(parentComputed.matrix, deformerComputed.matrix) : parentComputed.matrix;
    const activeWarp = mergeResolvedWarpDeformers(parentComputed.warp, deformerComputed?.warp);
    const result = {
      parameterValues: values,
      matrix: multiplyMatrices(parentMatrix, part.affineBindings?.length ? multiplyMatrices(localMatrix, resolvePartAffine(part, values)) : localMatrix),
      parentMatrix,
      opacity: parentComputed.opacity * (deformerComputed?.opacity ?? 1) * pose.opacity,
      visible: parentComputed.visible && (deformerComputed?.visible ?? true) && part.visible,
      pose,
      warp: activeWarp,
      sharedWarps: mergeSharedWarpFields(parentComputed.sharedWarps, deformerComputed?.sharedWarps)
    };
    computed.set(part.id, result);
    visiting.delete(part.id);
    return result;
  };
  for (const part of rig.parts) {
    computePart(part);
  }
  return computed;
}
function evaluateDeformers(deformers, values, physicsOffsets = void 0) {
  return evaluateDeformerStates(deformers, values, physicsOffsets, true);
}
function evaluateDeformerStates(deformers, values, physicsOffsets, includeWarpFields) {
  const byId = new Map(deformers.map((deformer) => [deformer.id, deformer]));
  const computed = /* @__PURE__ */ new Map();
  const visiting = /* @__PURE__ */ new Set();
  const computeDeformer = (deformer) => {
    const existing = computed.get(deformer.id);
    if (existing) {
      return existing;
    }
    if (visiting.has(deformer.id)) {
      const fallback = { matrix: identityMatrix(), opacity: 1, visible: deformer.visible, pose: zeroPose(), warp: void 0 };
      computed.set(deformer.id, fallback);
      return fallback;
    }
    visiting.add(deformer.id);
    const parent = deformer.parentId ? byId.get(deformer.parentId) : void 0;
    const parentComputed = parent ? computeDeformer(parent) : { matrix: identityMatrix(), opacity: 1, visible: true, pose: zeroPose(), warp: void 0 };
    const pose = resolveDeformerPose(deformer, values, physicsOffsets?.get(deformer.id));
    const ownWarp = includeWarpFields ? resolveDeformerWarp(deformer, values, sampleBinding) : void 0;
    const result = {
      matrix: multiplyMatrices(parentComputed.matrix, deformerMatrix(deformer, pose)),
      opacity: parentComputed.opacity * pose.opacity,
      visible: parentComputed.visible && deformer.visible,
      pose,
      warp: mergeResolvedWarpDeformers(parentComputed.warp, ownWarp),
      sharedWarps: includeWarpFields ? mergeSharedWarpFields(parentComputed.sharedWarps, deformer.sharedWarp ? [resolveSharedShape(deformer.sharedWarp, deformer.blendShapes, values)] : void 0) : void 0
    };
    computed.set(deformer.id, result);
    visiting.delete(deformer.id);
    return result;
  };
  for (const deformer of deformers) {
    computeDeformer(deformer);
  }
  return computed;
}
function mergeSharedWarpFields(parent, own) {
  const fields = [...parent ?? [], ...own ?? []].filter((field) => field.enabled);
  return fields.length ? fields : void 0;
}
function resolvePartPose(part, values, physicsOffset) {
  const pose = { ...part.transform };
  for (const binding of part.bindings ?? []) {
    if (!isTransformBindingProperty(binding.property)) {
      continue;
    }
    const sampled = sampleBinding(binding, values[binding.parameter] ?? 0);
    applyTransformBindingSample(pose, binding.property, sampled, binding.additive, binding.composition);
  }
  for (const binding of part.multiBindings ?? []) {
    if (!isTransformBindingProperty(binding.property)) continue;
    const sampled = sampleMultiParameterBinding(binding, values);
    if (sampled === void 0) continue;
    applyTransformBindingSample(pose, binding.property, sampled, binding.additive, binding.composition);
  }
  applyTransformShapes(pose, part.blendShapes, values);
  if (physicsOffset) {
    for (const [property, value] of Object.entries(physicsOffset)) {
      pose[property] += value;
    }
  }
  pose.opacity = Math.min(1, Math.max(0, pose.opacity));
  return pose;
}
function resolveDeformerPose(deformer, values, physicsOffset = void 0) {
  const pose = { ...deformer.transform };
  for (const binding of deformer.bindings ?? []) {
    if (!isTransformBindingProperty(binding.property)) {
      continue;
    }
    const sampled = sampleBinding(binding, values[binding.parameter] ?? 0);
    applyTransformBindingSample(pose, binding.property, sampled, binding.additive, binding.composition);
  }
  for (const binding of deformer.multiBindings ?? []) {
    if (!isTransformBindingProperty(binding.property)) continue;
    const sampled = sampleMultiParameterBinding(binding, values);
    if (sampled === void 0) continue;
    applyTransformBindingSample(pose, binding.property, sampled, binding.additive, binding.composition);
  }
  applyTransformShapes(pose, deformer.blendShapes, values);
  if (physicsOffset) {
    for (const [property, value] of Object.entries(physicsOffset)) {
      pose[property] += value;
    }
  }
  pose.opacity = Math.min(1, Math.max(0, pose.opacity));
  return pose;
}
function applyTransformBindingSample(pose, property, sampled, additive, composition) {
  if (composition === "multiply" && (property === "scaleX" || property === "scaleY" || property === "opacity")) {
    pose[property] *= sampled;
  } else if (additive === false) {
    pose[property] = sampled;
  } else {
    pose[property] += sampled;
  }
}
function applyPhysicsParameterOffsets(values, offsets) {
  const resolved = { ...values };
  for (const [parameter, offset] of Object.entries(offsets)) {
    resolved[parameter] = (resolved[parameter] ?? 0) + offset;
  }
  return resolved;
}
function resolvePhysicsFrame(rig, values, state, dt, timeSeconds) {
  const partOffsets = /* @__PURE__ */ new Map();
  const deformerOffsets = /* @__PURE__ */ new Map();
  const parameterOffsets = {};
  if (!rig.physics?.enabled) return { partOffsets, deformerOffsets, parameterOffsets };
  const safeDt = Math.min(0.1, Math.max(1e-4, dt));
  for (const chain of rig.physics.chains ?? []) {
    if (!chain.enabled) continue;
    const input = chain.sourceParameters.reduce((total, source) => total + (values[source.parameter] ?? 0) * source.scale, 0);
    const wind = chain.wind ? Math.sin(timeSeconds * 1.8) * chain.wind : 0;
    const target = input + chain.gravity + wind;
    if (chain.parameterOutput) {
      const output = chain.parameterOutput;
      const key = `${chain.id}:parameter:${output.parameter}`;
      const physicsValue = resolveChainPhysicsValue(state, key, target, chain, safeDt);
      let value = physicsValue * output.scale;
      if (Number.isFinite(output.min)) value = Math.max(output.min, value);
      if (Number.isFinite(output.max)) value = Math.min(output.max, value);
      parameterOffsets[output.parameter] = (parameterOffsets[output.parameter] ?? 0) + value;
      continue;
    }
    for (const deformerId of chain.targetDeformerIds ?? []) {
      const key = `${chain.id}:deformer:${deformerId}`;
      const physicsValue = resolveChainPhysicsValue(state, key, target, chain, safeDt);
      const deformerOffset = deformerOffsets.get(deformerId) ?? {};
      deformerOffset[chain.output.property] = (deformerOffset[chain.output.property] ?? 0) + physicsValue * chain.output.scale;
      deformerOffsets.set(deformerId, deformerOffset);
    }
    for (const partId of chain.targetPartIds ?? []) {
      const key = `${chain.id}:${partId}`;
      const physicsValue = resolveChainPhysicsValue(state, key, target, chain, safeDt);
      const partOffset = partOffsets.get(partId) ?? {};
      partOffset[chain.output.property] = (partOffset[chain.output.property] ?? 0) + physicsValue * chain.output.scale;
      partOffsets.set(partId, partOffset);
    }
  }
  return { partOffsets, deformerOffsets, parameterOffsets };
}
function resolveChainPhysicsValue(state, baseKey, target, chain, dt) {
  const segments = chain.segments?.filter((segment) => segment && segment.id);
  if (!segments?.length) {
    const physics = advancePhysicsValue(state.get(baseKey), target, chain, dt);
    state.set(baseKey, physics);
    return physics.value;
  }
  const substeps = Math.max(1, Math.min(12, Math.ceil(dt / (1 / 120))));
  const subDt = dt / substeps;
  let finalValue = 0;
  for (let step = 0; step < substeps; step += 1) {
    let driver = target;
    for (const segment of segments.slice(0, 8)) {
      const key = `${baseKey}:segment:${segment.id}`;
      const current = state.get(key) ?? { value: 0, velocity: 0, target: 0 };
      const delay = clampFinite(segment.delay, 0, 2, 0.08);
      const alpha = delay <= 0 ? 1 : 1 - Math.exp(-subDt / delay);
      current.target = (current.target ?? driver) + (driver - (current.target ?? driver)) * alpha;
      const stageChain = {
        ...chain,
        mass: chain.mass * clampFinite(segment.length, 0.05, 8, 1),
        damping: chain.damping * clampFinite(segment.damping, 0, 8, 1)
      };
      const physics = advancePhysicsValue(current, current.target, stageChain, subDt);
      state.set(key, physics);
      driver = physics.value;
      finalValue = physics.value;
    }
  }
  return finalValue;
}
function clampFinite(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}
function advancePhysicsValue(current, target, chain, dt) {
  const physics = current ?? { value: 0, velocity: 0 };
  const mass = Math.max(1e-3, chain.mass);
  const acceleration = ((target - physics.value) * chain.stiffness - physics.velocity * chain.damping) / mass;
  physics.velocity += acceleration * dt;
  physics.value += physics.velocity * dt;
  return physics;
}
function resolveDeterministicPhysicsFrame(rig, values, timeSeconds, steps = 18, dt = 1 / 60) {
  const state = /* @__PURE__ */ new Map();
  let frame = { partOffsets: /* @__PURE__ */ new Map(), deformerOffsets: /* @__PURE__ */ new Map(), parameterOffsets: {} };
  const safeSteps = Math.max(0, Math.min(240, Math.round(steps)));
  for (let index = 0; index < safeSteps; index += 1) {
    frame = resolvePhysicsFrame(rig, values, state, dt, timeSeconds + index * dt);
  }
  return frame;
}
function identityMatrix() {
  return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
}
function translateMatrix(x, y) {
  return { a: 1, b: 0, c: 0, d: 1, e: x, f: y };
}
function rotateMatrix(degrees) {
  const radians = degrees * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}
function scaleMatrix(x, y) {
  return { a: x, b: 0, c: 0, d: y, e: 0, f: 0 };
}
function multiplyMatrices(left, right) {
  return {
    a: left.a * right.a + left.c * right.b,
    b: left.b * right.a + left.d * right.b,
    c: left.a * right.c + left.c * right.d,
    d: left.b * right.c + left.d * right.d,
    e: left.a * right.e + left.c * right.f + left.e,
    f: left.b * right.e + left.d * right.f + left.f
  };
}
function invertMatrix(matrix) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c || 1;
  return {
    a: matrix.d / determinant,
    b: -matrix.b / determinant,
    c: -matrix.c / determinant,
    d: matrix.a / determinant,
    e: (matrix.c * matrix.f - matrix.d * matrix.e) / determinant,
    f: (matrix.b * matrix.e - matrix.a * matrix.f) / determinant
  };
}
function transformMatrixPoint(matrix, x, y) {
  return {
    x: matrix.a * x + matrix.c * y + matrix.e,
    y: matrix.b * x + matrix.d * y + matrix.f
  };
}
function safeScale(value) {
  if (Math.abs(value) >= MIN_SCALE) return value;
  return value < 0 ? -MIN_SCALE : MIN_SCALE;
}
function zeroPose() {
  return { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0.5, pivotY: 0.5, opacity: 1 };
}
function deformerMatrix(deformer, pose) {
  return multiplyMatrices(
    multiplyMatrices(
      multiplyMatrices(translateMatrix(deformer.origin.x, deformer.origin.y), multiplyMatrices(translateMatrix(pose.x, pose.y), rotateMatrix(pose.rotation))),
      scaleMatrix(safeScale(pose.scaleX), safeScale(pose.scaleY))
    ),
    translateMatrix(-deformer.origin.x, -deformer.origin.y)
  );
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/runtime/src/webglGeometry.ts
function buildWebGLPartGeometry(options) {
  const { left, top, width, height, matrix, mesh, warp, project, sharedGrid, stitchOffsets } = options;
  const bounds = { left, top, width, height };
  const active2 = hasWarpEffect(warp);
  const vertices = [];
  const add = (x, y, u, v, id) => {
    const warped = active2 ? warpPoint(x, y, bounds, warp) : { x, y };
    const projected = project ? project(warped) : warped;
    const offset = id === void 0 ? void 0 : stitchOffsets?.get(id);
    const screen = transformMatrixPoint(matrix, projected.x + (offset?.dx ?? 0), projected.y + (offset?.dy ?? 0));
    vertices.push({ ...screen, u, v });
  };
  if (mesh) {
    for (const vertex of mesh.vertices) add(left + vertex.x, top + vertex.y, vertex.u, vertex.v, vertex.id);
    return { vertices, triangles: mesh.triangles };
  }
  const columns = Math.max(1, Math.round(warp?.grid.columns ?? 1), sharedGrid?.columns ?? 1);
  const rows = Math.max(1, Math.round(warp?.grid.rows ?? 1), sharedGrid?.rows ?? 1);
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      add(left + width * column / columns, top + height * row / rows, column / columns, row / rows);
    }
  }
  const triangles = [];
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * (columns + 1) + column, b = a + 1, d = a + columns + 1, c = d + 1;
      triangles.push(a, b, c, a, c, d);
    }
  }
  return { vertices, triangles };
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/runtime/src/physicsStepping.ts
function prepareLivePhysicsStep(rig, values, previous, state, elapsed, time) {
  const duration = Math.min(0.25, Math.max(1e-4, Number.isFinite(elapsed) ? elapsed : 1 / 60));
  const steps = Math.max(1, Math.ceil(duration / (1 / 60)));
  const dt = duration / steps;
  const end = Number.isFinite(time) ? time : 0;
  for (let i = 1; i < steps; i++) {
    const fraction = i / steps;
    const input = {};
    for (const [id, value] of Object.entries(values)) {
      const from = previous?.[id] ?? value;
      input[id] = from + (value - from) * fraction;
    }
    resolvePhysicsFrame(rig, input, state, dt, end - duration + dt * i);
  }
  return { dt, time: end, duration, steps };
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/sharedWarpProjection.ts
function projectSharedWarpPoint(point, partMatrix, baseMatrix, fields) {
  const rendered = transformMatrixPoint(partMatrix, point.x, point.y);
  if (!fields?.some(hasSharedWarpFieldEffect)) {
    return rendered;
  }
  const inverseBase = invertMatrix(baseMatrix);
  let stagePoint = transformMatrixPoint(inverseBase, rendered.x, rendered.y);
  for (const field of fields) {
    if (hasSharedWarpFieldEffect(field)) {
      stagePoint = warpSharedFieldPoint(field, stagePoint.x, stagePoint.y);
    }
  }
  return transformMatrixPoint(baseMatrix, stagePoint.x, stagePoint.y);
}
function unprojectSharedWarpPoint(renderedPoint, partMatrix, baseMatrix, fields) {
  if (!fields?.some(hasSharedWarpFieldEffect)) {
    return transformMatrixPoint(invertMatrix(partMatrix), renderedPoint.x, renderedPoint.y);
  }
  const targetStage = transformMatrixPoint(invertMatrix(baseMatrix), renderedPoint.x, renderedPoint.y);
  let stagePoint = { ...targetStage };
  for (const field of [...fields].reverse()) {
    if (!hasSharedWarpFieldEffect(field)) continue;
    const targetForField = { ...stagePoint };
    for (let iteration = 0; iteration < 8; iteration += 1) {
      const warped = warpSharedFieldPoint(field, stagePoint.x, stagePoint.y);
      stagePoint = { x: stagePoint.x + targetForField.x - warped.x, y: stagePoint.y + targetForField.y - warped.y };
    }
  }
  const unwarpedRendered = transformMatrixPoint(baseMatrix, stagePoint.x, stagePoint.y);
  return transformMatrixPoint(invertMatrix(partMatrix), unwarpedRendered.x, unwarpedRendered.y);
}
function createSharedWarpProjector(partMatrix, baseMatrix, fields) {
  const part = { ...partMatrix }, base = { ...baseMatrix };
  const samplers = (fields ?? []).filter(hasSharedWarpFieldEffect).map(createSharedWarpSampler);
  const inverseBase = samplers.length ? invertMatrix(base) : void 0;
  return (point) => {
    const rendered = transformMatrixPoint(part, point.x, point.y);
    if (!inverseBase) return rendered;
    let stage = transformMatrixPoint(inverseBase, rendered.x, rendered.y);
    for (const sample of samplers) {
      const offset = sample(stage.x, stage.y);
      stage = { x: stage.x + offset.x, y: stage.y + offset.y };
    }
    return transformMatrixPoint(base, stage.x, stage.y);
  };
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/glue.ts
function readRigGlue(rig) {
  return Array.isArray(rig.glue) ? rig.glue : [];
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/glueWarp.ts
function resolveGlueWarpForPart(rig, part, state, size, computed, sizeForPart) {
  const gluePins = gluePinsForPart(rig, part, state, size, computed, sizeForPart);
  if (!gluePins.length) {
    return state.warp;
  }
  const warp = state.warp ? cloneWarp(state.warp) : emptyGlueWarp();
  warp.enabled = true;
  warp.grid = {
    columns: Math.max(warp.grid.columns, 5),
    rows: Math.max(warp.grid.rows, 5)
  };
  warp.pins = [...warp.pins ?? [], ...gluePins];
  return warp;
}
function gluePinsForPart(rig, part, state, size, computed, sizeForPart) {
  const activeGlues = readRigGlue(rig).filter((glue) => glue.enabled && glue.status === "active" && glue.mode === "soft-seam").sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  const pins = [];
  for (const glue of activeGlues) {
    const currentSide = glue.partAId === part.id ? "A" : glue.partBId === part.id ? "B" : "";
    if (!currentSide) {
      continue;
    }
    const otherPartId = currentSide === "A" ? glue.partBId : glue.partAId;
    const otherPart = rig.parts.find((entry) => entry.id === otherPartId);
    const otherState = otherPart ? computed.get(otherPart.id) : void 0;
    const otherSize = otherPart ? sizeForPart(otherPart) : void 0;
    if (!otherPart || !otherState || !otherSize || !otherState.visible || otherState.opacity <= 0) {
      continue;
    }
    if (glue.seamPoints?.length) {
      glue.seamPoints.forEach((point, index) => {
        const pointWeight = currentSide === "A" ? point.weightA ?? glue.weightA : point.weightB ?? glue.weightB;
        const pin = gluePinForSeamPoint(glue.id, index, currentSide, point, pointWeight, glueBlendStrength(glue, state.parameterValues), state, size, otherState, otherSize);
        if (pin) {
          pins.push(pin);
        }
      });
    } else {
      const pin = gluePinForPair(
        glue.id,
        currentSide === "A" ? glue.weightA : glue.weightB,
        glueBlendStrength(glue, state.parameterValues),
        state,
        size,
        otherState,
        otherSize
      );
      if (pin) {
        pins.push(pin);
      }
    }
  }
  return pins.slice(0, 24);
}
function gluePinForSeamPoint(glueId, index, currentSide, point, weight, glueStrength, state, size, otherState, otherSize) {
  const currentUv = currentSide === "A" ? point.a : point.b;
  const otherUv = currentSide === "A" ? point.b : point.a;
  const left = -state.pose.pivotX * size.width;
  const top = -state.pose.pivotY * size.height;
  const otherLeft = -otherState.pose.pivotX * otherSize.width;
  const otherTop = -otherState.pose.pivotY * otherSize.height;
  const anchor = {
    x: left + clamp012(currentUv.u) * size.width,
    y: top + clamp012(currentUv.v) * size.height
  };
  const otherAnchorWorld = transformMatrixPoint(
    otherState.matrix,
    otherLeft + clamp012(otherUv.u) * otherSize.width,
    otherTop + clamp012(otherUv.v) * otherSize.height
  );
  const otherAnchorLocal = transformMatrixPoint(invertMatrix(state.matrix), otherAnchorWorld.x, otherAnchorWorld.y);
  const vector = { x: otherAnchorLocal.x - anchor.x, y: otherAnchorLocal.y - anchor.y };
  const length = Math.hypot(vector.x, vector.y);
  if (length < 1e-3) {
    return void 0;
  }
  const direction = { x: vector.x / length, y: vector.y / length };
  const clampedWeight = clamp012(weight);
  const clampedStrength = clamp012(point.strength ?? glueStrength);
  const maxOffset = clamp3(Math.min(size.width, size.height) * 0.06, 2, 28);
  const magnitude = Math.min(length * 0.24, maxOffset) * clampedStrength * (0.35 + clampedWeight * 0.65);
  if (magnitude < 0.05) {
    return void 0;
  }
  return {
    id: `glue-${glueId}-${index}`,
    name: `Glue ${glueId} ${index + 1}`,
    enabled: true,
    u: clamp012(currentUv.u),
    v: clamp012(currentUv.v),
    offsetX: direction.x * magnitude,
    offsetY: direction.y * magnitude,
    radius: clamp3(point.radius ?? 0.16 + clampedStrength * 0.34, 0.08, 0.7),
    strength: clamp3(0.14 + clampedStrength * (0.42 + clampedWeight * 0.28), 0.14, 0.72),
    bindings: []
  };
}
function gluePinForPair(glueId, weight, strength, state, size, otherState, otherSize) {
  const left = -state.pose.pivotX * size.width;
  const top = -state.pose.pivotY * size.height;
  const center = { x: left + size.width * 0.5, y: top + size.height * 0.5 };
  const otherCenterWorld = partCenterWorld(otherState, otherSize);
  const inverse = invertMatrix(state.matrix);
  const otherCenterLocal = transformMatrixPoint(inverse, otherCenterWorld.x, otherCenterWorld.y);
  const vector = { x: otherCenterLocal.x - center.x, y: otherCenterLocal.y - center.y };
  const length = Math.hypot(vector.x, vector.y);
  if (length < 1e-3) {
    return void 0;
  }
  const direction = { x: vector.x / length, y: vector.y / length };
  const edgeDistance = rayToRectEdgeDistance(direction, size.width, size.height);
  const anchor = {
    x: center.x + direction.x * edgeDistance,
    y: center.y + direction.y * edgeDistance
  };
  const u = clamp012((anchor.x - left) / size.width);
  const v = clamp012((anchor.y - top) / size.height);
  const clampedWeight = clamp012(weight);
  const clampedStrength = clamp012(strength);
  const maxOffset = clamp3(Math.min(size.width, size.height) * 0.045, 2, 24);
  const magnitude = maxOffset * clampedStrength * (0.35 + clampedWeight * 0.65);
  if (magnitude < 0.05) {
    return void 0;
  }
  return {
    id: `glue-${glueId}`,
    name: `Glue ${glueId}`,
    enabled: true,
    u,
    v,
    offsetX: direction.x * magnitude,
    offsetY: direction.y * magnitude,
    radius: clamp3(0.18 + clampedStrength * 0.34, 0.18, 0.52),
    strength: clamp3(0.16 + clampedStrength * (0.34 + clampedWeight * 0.32), 0.16, 0.66),
    bindings: []
  };
}
function partCenterWorld(state, size) {
  const localX = -state.pose.pivotX * size.width + size.width * 0.5;
  const localY = -state.pose.pivotY * size.height + size.height * 0.5;
  return transformMatrixPoint(state.matrix, localX, localY);
}
function rayToRectEdgeDistance(direction, width, height) {
  const halfWidth = Math.max(1e-3, width * 0.5);
  const halfHeight = Math.max(1e-3, height * 0.5);
  const tx = Math.abs(direction.x) > 1e-3 ? halfWidth / Math.abs(direction.x) : Number.POSITIVE_INFINITY;
  const ty = Math.abs(direction.y) > 1e-3 ? halfHeight / Math.abs(direction.y) : Number.POSITIVE_INFINITY;
  return Math.min(tx, ty);
}
function emptyGlueWarp() {
  return {
    enabled: true,
    bendX: 0,
    bendY: 0,
    taperX: 0,
    taperY: 0,
    grid: { columns: 5, rows: 5 },
    pins: []
  };
}
function cloneWarp(warp) {
  return {
    enabled: warp.enabled || hasWarpEffect(warp),
    bendX: warp.bendX,
    bendY: warp.bendY,
    taperX: warp.taperX,
    taperY: warp.taperY,
    grid: { ...warp.grid },
    pins: (warp.pins ?? []).map((pin) => ({
      ...pin,
      bindings: (pin.bindings ?? []).map((binding) => ({
        ...binding,
        keys: binding.keys.map((key) => ({ ...key }))
      }))
    }))
  };
}
function clamp012(value) {
  return clamp3(value, 0, 1);
}
function clamp3(value, min, max) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/artMeshSurface.ts
var GRID = 8;
var cache = /* @__PURE__ */ new WeakMap();
function applyArtMeshSurface(mesh, sampled, offsets) {
  if (!sampled.size || ![...sampled.values()].some((p) => p.x !== 0 || p.y !== 0)) return;
  let geometry;
  for (const vertex of mesh.vertices) {
    const current = offsets.get(vertex.id);
    if (!current || current.x === 0 && current.y === 0) {
      const delta = sampled.get(vertex.id);
      if (delta) offsets.set(vertex.id, { ...delta });
      continue;
    }
    geometry ??= geometryFor(mesh);
    const point = { x: vertex.x + current.x, y: vertex.y + current.y };
    const triangle = locate(geometry, point);
    if (!triangle) continue;
    const [u, v] = barycentric(triangle, point), weights = [1 - u - v, u, v];
    let x = 0, y = 0;
    for (let i = 0; i < 3; i++) {
      const delta = sampled.get(triangle.ids[i]);
      x += (delta?.x ?? 0) * weights[i];
      y += (delta?.y ?? 0) * weights[i];
    }
    offsets.set(vertex.id, { x: current.x + x, y: current.y + y });
  }
}
function geometryFor(mesh) {
  const old = cache.get(mesh);
  if (old && old.coordinates.length === mesh.vertices.length * 2 && old.indices.length === mesh.triangles.length && mesh.vertices.every((p, i) => p.id === old.ids[i] && p.x === old.coordinates[i * 2] && p.y === old.coordinates[i * 2 + 1]) && mesh.triangles.every((v, i) => v === old.indices[i])) return old;
  const xs = mesh.vertices.map((p) => p.x), ys = mesh.vertices.map((p) => p.y);
  const geometry = {
    coordinates: mesh.vertices.flatMap((p) => [p.x, p.y]),
    ids: mesh.vertices.map((p) => p.id),
    indices: [...mesh.triangles],
    triangles: [],
    left: Math.min(...xs),
    top: Math.min(...ys),
    width: Math.max(1e-9, Math.max(...xs) - Math.min(...xs)),
    height: Math.max(1e-9, Math.max(...ys) - Math.min(...ys)),
    cells: Array.from({ length: GRID * GRID }, () => [])
  };
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const [a, b, c] = mesh.triangles.slice(i, i + 3).map((j) => mesh.vertices[j]);
    const bx = b.x - a.x, by = b.y - a.y, cx = c.x - a.x, cy = c.y - a.y, determinant = bx * cy - by * cx;
    if (Math.abs(determinant) < 1e-12) continue;
    const triangle = {
      ids: [a.id, b.id, c.id],
      a: { x: a.x, y: a.y },
      bx,
      by,
      cx,
      cy,
      determinant,
      left: Math.min(a.x, b.x, c.x),
      top: Math.min(a.y, b.y, c.y),
      right: Math.max(a.x, b.x, c.x),
      bottom: Math.max(a.y, b.y, c.y)
    };
    const index = geometry.triangles.push(triangle) - 1;
    const [left, top] = cell(geometry, triangle.left, triangle.top), [right, bottom] = cell(geometry, triangle.right, triangle.bottom);
    for (let y = top; y <= bottom; y++) for (let x = left; x <= right; x++) geometry.cells[y * GRID + x].push(index);
  }
  cache.set(mesh, geometry);
  return geometry;
}
function cell(g, x, y) {
  return [
    Math.max(0, Math.min(GRID - 1, Math.floor((x - g.left) / g.width * GRID))),
    Math.max(0, Math.min(GRID - 1, Math.floor((y - g.top) / g.height * GRID)))
  ];
}
function barycentric(t, p) {
  const x = p.x - t.a.x, y = p.y - t.a.y;
  return [(x * t.cy - y * t.cx) / t.determinant, (t.bx * y - t.by * x) / t.determinant];
}
function locate(g, p) {
  const [x, y] = cell(g, p.x, p.y);
  for (const index of g.cells[y * GRID + x]) {
    const t = g.triangles[index], [u, v] = barycentric(t, p);
    if (u >= -1e-9 && v >= -1e-9 && u + v <= 1 + 1e-9) return t;
  }
  let best, distance = Infinity;
  for (const t of g.triangles) {
    const dx = Math.max(t.left - p.x, 0, p.x - t.right), dy = Math.max(t.top - p.y, 0, p.y - t.bottom);
    if (dx * dx + dy * dy > distance) continue;
    const a = t.a, b = { x: a.x + t.bx, y: a.y + t.by }, c = { x: a.x + t.cx, y: a.y + t.cy };
    const d = Math.min(segmentDistance(p, a, b), segmentDistance(p, b, c), segmentDistance(p, c, a));
    if (d < distance) {
      distance = d;
      best = t;
    }
  }
  return best;
}
function segmentDistance(p, a, b) {
  const x = b.x - a.x, y = b.y - a.y, length = x * x + y * y;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * x + (p.y - a.y) * y) / (length || 1)));
  return (p.x - a.x - t * x) ** 2 + (p.y - a.y - t * y) ** 2;
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/artMeshMulti.ts
function normalizedOffsets(raw) {
  const seen = /* @__PURE__ */ new Set();
  let unique = true;
  for (const offset of raw) {
    if (!offset || typeof offset.vertexId !== "string" || !Number.isFinite(offset.x) || !Number.isFinite(offset.y) || seen.has(offset.vertexId)) {
      unique = false;
      break;
    }
    seen.add(offset.vertexId);
  }
  if (unique) return raw;
  const last = /* @__PURE__ */ new Map();
  for (const offset of raw) if (offset && typeof offset.vertexId === "string" && Number.isFinite(offset.x) && Number.isFinite(offset.y)) last.set(offset.vertexId, offset);
  return [...last.values()];
}
function sampleMultiArtMeshBinding(binding, values) {
  const result = /* @__PURE__ */ new Map();
  for (const { key, weight } of sampleParameterGrid(binding.parameters, binding.keyforms, values, binding.interpolation, binding.curve)) {
    const build = () => normalizedOffsets(key.offsets ?? []);
    const offsets = evaluationCache()?.get("mesh-offsets", key, build) ?? build();
    for (const offset of offsets) {
      const id = offset.vertexId;
      const previous = result.get(id) ?? { x: 0, y: 0 };
      previous.x += offset.x * weight;
      previous.y += offset.y * weight;
      result.set(id, previous);
    }
  }
  return result;
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/denseOffsets.ts
function sampleDenseMulti(mesh, binding, values) {
  const cache2 = evaluationCache();
  if (!cache2) return sampleMultiArtMeshBinding(binding, values);
  const ids = cache2.get("dense-mesh-ids", mesh, () => new Map(mesh.vertices.map((v, i) => [v.id, i])));
  const keys = cache2.get("dense-mesh-keys", mesh, () => /* @__PURE__ */ new WeakMap());
  const n = mesh.vertices.length, xy = new Float64Array(n * 2), present = new Uint8Array(n);
  for (const { key, weight } of sampleParameterGrid(binding.parameters, binding.keyforms, values, binding.interpolation, binding.curve)) {
    let data = keys.get(key);
    if (!data) {
      data = { xy: new Float64Array(n * 2), present: new Uint8Array(n) };
      for (const o of key.offsets ?? []) {
        const i = ids.get(o.vertexId);
        if (i === void 0 || !Number.isFinite(o.x) || !Number.isFinite(o.y)) continue;
        data.xy[i * 2] = o.x;
        data.xy[i * 2 + 1] = o.y;
        data.present[i] = 1;
      }
      keys.set(key, data);
    }
    for (let i = 0; i < n; i++) if (data.present[i]) {
      present[i] = 1;
      xy[i * 2] += data.xy[i * 2] * weight;
      xy[i * 2 + 1] += data.xy[i * 2 + 1] * weight;
    }
  }
  const result = /* @__PURE__ */ new Map();
  mesh.vertices.forEach((v, i) => {
    if (present[i]) result.set(v.id, { x: xy[i * 2], y: xy[i * 2 + 1] });
  });
  return result;
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/artMesh.ts
function addArtMeshVertex(mesh, input) {
  if (![input.x, input.y, input.u, input.v].every(finite2)) throw new TypeError("ArtMesh vertex coordinates must be finite numbers");
  if (input.u < 0 || input.u > 1 || input.v < 0 || input.v > 1) throw new RangeError("ArtMesh vertex UVs must be within 0..1");
  const ids = new Set(mesh.vertices.map((vertex2) => vertex2.id));
  const requested = input.id?.trim() || "v-custom";
  let id = requested;
  for (let suffix = 2; ids.has(id); suffix += 1) id = `${requested}-${suffix}`;
  const vertex = { id, x: input.x, y: input.y, u: input.u, v: input.v };
  mesh.vertices.push(vertex);
  return vertex;
}
function removeArtMeshVertex(mesh, index) {
  if (mesh.vertices.length <= 3 || !Number.isInteger(index) || index < 0 || index >= mesh.vertices.length) return false;
  const vertexId = mesh.vertices[index].id;
  mesh.vertices.splice(index, 1);
  const triangles = [];
  for (let offset = 0; offset + 2 < mesh.triangles.length; offset += 3) {
    const triangle = mesh.triangles.slice(offset, offset + 3);
    if (triangle.includes(index)) continue;
    triangles.push(...triangle.map((vertexIndex) => vertexIndex > index ? vertexIndex - 1 : vertexIndex));
  }
  mesh.triangles = triangles;
  for (const binding of mesh.bindings ?? []) for (const key of binding.keys) key.offsets = key.offsets.filter((entry) => entry.vertexId !== vertexId);
  for (const binding of mesh.multiBindings ?? []) for (const keyform of binding.keyforms) keyform.offsets = keyform.offsets.filter((entry) => entry.vertexId !== vertexId);
  return true;
}
function retriangulateArtMesh(mesh) {
  const points = mesh.vertices.map((vertex, original) => ({ x: vertex.x, y: vertex.y, original })).filter((point) => finite2(point.x) && finite2(point.y)).sort((a, b) => a.x - b.x || a.y - b.y || a.original - b.original).filter((point, index, all) => index === 0 || point.x !== all[index - 1].x || point.y !== all[index - 1].y);
  if (points.length < 3) {
    mesh.triangles = [];
    return;
  }
  const minX = Math.min(...points.map((point) => point.x));
  const maxX = Math.max(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxY = Math.max(...points.map((point) => point.y));
  const span = Math.max(maxX - minX, maxY - minY);
  if (span <= 1e-9) {
    mesh.triangles = [];
    return;
  }
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const work = [
    ...points,
    { x: centerX - span * 32, y: centerY - span * 2, original: -1 },
    { x: centerX, y: centerY + span * 32, original: -2 },
    { x: centerX + span * 32, y: centerY - span * 2, original: -3 }
  ];
  const superStart = points.length;
  let triangles = [[superStart, superStart + 1, superStart + 2]];
  for (let pointIndex = 0; pointIndex < points.length; pointIndex += 1) {
    const bad = triangles.filter((triangle) => pointInCircumcircle(work[pointIndex], work[triangle[0]], work[triangle[1]], work[triangle[2]]));
    const edges = /* @__PURE__ */ new Map();
    const duplicates = /* @__PURE__ */ new Set();
    for (const triangle of bad) {
      for (const [a, b] of [[triangle[0], triangle[1]], [triangle[1], triangle[2]], [triangle[2], triangle[0]]]) {
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (edges.has(key)) duplicates.add(key);
        else edges.set(key, [a, b]);
      }
    }
    const badSet = new Set(bad);
    triangles = triangles.filter((triangle) => !badSet.has(triangle));
    for (const [key, edge] of edges) {
      if (!duplicates.has(key) && Math.abs(triangleArea(work[edge[0]], work[edge[1]], work[pointIndex])) > 1e-9) triangles.push([edge[0], edge[1], pointIndex]);
    }
  }
  const result = [];
  for (const triangle of triangles) {
    if (triangle.some((index) => index >= superStart)) continue;
    let [a, b, c] = triangle.map((index) => points[index].original);
    const area = triangleArea(mesh.vertices[a], mesh.vertices[b], mesh.vertices[c]);
    if (Math.abs(area) < 1e-4) continue;
    if (area < 0) [b, c] = [c, b];
    result.push(a, b, c);
  }
  mesh.triangles = result;
}
function pointInCircumcircle(point, a, b, c) {
  const ax = a.x - point.x, ay = a.y - point.y;
  const bx = b.x - point.x, by = b.y - point.y;
  const cx = c.x - point.x, cy = c.y - point.y;
  const determinant = (ax * ax + ay * ay) * (bx * cy - cx * by) - (bx * bx + by * by) * (ax * cy - cx * ay) + (cx * cx + cy * cy) * (ax * by - bx * ay);
  return triangleArea(a, b, c) > 0 ? determinant > 1e-9 : determinant < -1e-9;
}
function createRectArtMesh(width, height, options) {
  const columns = clampInteger2(options.columns, 1, 16);
  const rows = clampInteger2(options.rows, 1, 16);
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const vertices = [];
  const triangles = [];
  for (let row = 0; row <= rows; row += 1) {
    for (let column = 0; column <= columns; column += 1) {
      const u = column / columns;
      const v = row / rows;
      vertices.push({ id: `v-${row}-${column}`, x: safeWidth * u, y: safeHeight * v, u, v });
    }
  }
  const stride = columns + 1;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const topLeft = row * stride + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + stride;
      const bottomRight = bottomLeft + 1;
      triangles.push(topLeft, topRight, bottomRight, topLeft, bottomRight, bottomLeft);
    }
  }
  return {
    version: 1,
    enabled: true,
    generator: {
      preset: options.preset,
      columns,
      rows,
      alphaThreshold: Math.max(1, Math.min(255, Math.round(options.alphaThreshold ?? 8))),
      alphaBounds: options.alphaBounds ?? { left: 0, top: 0, width: safeWidth, height: safeHeight },
      quality: options.quality
    },
    vertices,
    triangles,
    bindings: []
  };
}
function createAlphaContourArtMesh(width, height, alphaAt, options) {
  const mesh = createRectArtMesh(width, height, options);
  mesh.generator.topology = "alpha-contour";
  const threshold = mesh.generator.alphaThreshold;
  const columns = mesh.generator.columns;
  const rows = mesh.generator.rows;
  const kept = [];
  const stride = columns + 1;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const centerX = (column + 0.5) / columns * width;
      const centerY = (row + 0.5) / rows * height;
      if (alphaAt(centerX, centerY) < threshold) continue;
      const topLeft = row * stride + column;
      const topRight = topLeft + 1;
      const bottomLeft = topLeft + stride;
      const bottomRight = bottomLeft + 1;
      kept.push(topLeft, topRight, bottomRight, topLeft, bottomRight, bottomLeft);
    }
  }
  if (kept.length >= 3) mesh.triangles = kept;
  compactArtMeshVertices(mesh);
  return mesh;
}
function compactArtMeshVertices(mesh) {
  const used = new Set(mesh.triangles);
  const indexMap = /* @__PURE__ */ new Map();
  const vertices = mesh.vertices.filter((vertex, index) => {
    if (!used.has(index)) return false;
    indexMap.set(index, indexMap.size);
    return true;
  });
  mesh.triangles = mesh.triangles.map((index) => indexMap.get(index) ?? 0);
  mesh.vertices = vertices;
  const ids = new Set(vertices.map((vertex) => vertex.id));
  const boundary = vertices.filter((vertex) => vertex.u === 0 || vertex.u === 1 || vertex.v === 0 || vertex.v === 1).map((vertex) => vertex.id);
  const quality = mesh.generator.quality ?? {};
  mesh.generator.quality = {
    ...quality,
    boundaryVertexIds: quality.boundaryVertexIds?.filter((id) => ids.has(id)) ?? boundary,
    lockedVertexIds: quality.lockedVertexIds?.filter((id) => ids.has(id)) ?? boundary,
    pinnedVertexIds: quality.pinnedVertexIds?.filter((id) => ids.has(id)) ?? boundary
  };
}
function resolveArtMesh(part, width, height, values) {
  return resolveArtMeshInternal(part, width, height, values);
}
function resolveArtMeshInternal(part, width, height, values, onStage) {
  const mesh = part.artMesh;
  if (!mesh?.enabled || !isValidArtMesh(mesh, width, height)) {
    return void 0;
  }
  const offsets = /* @__PURE__ */ new Map();
  for (const binding of mesh.bindings ?? []) {
    if (binding.composition === "surface") continue;
    applyOffsets(offsets, sampleArtMeshBinding(binding, values[binding.parameter] ?? 0), binding.additive);
  }
  for (const binding of mesh.multiBindings ?? []) {
    if (binding.composition === "surface") continue;
    applyOffsets(offsets, sampleDenseMulti(mesh, binding, values), binding.additive);
  }
  for (const shape of mesh.blendShapes ?? []) {
    applyOffsets(offsets, sampleArtMeshBlendShape(shape, values[shape.parameter] ?? shape.neutralInput), shape.additive);
  }
  const vertices = () => mesh.vertices.map((vertex) => {
    const offset = offsets.get(vertex.id);
    return { ...vertex, x: vertex.x + (offset?.x ?? 0), y: vertex.y + (offset?.y ?? 0) };
  });
  onStage?.("bindings", vertices());
  for (const binding of mesh.multiBindings ?? []) {
    if (binding.composition === "surface") {
      applyArtMeshSurface(mesh, sampleDenseMulti(mesh, binding, values), offsets);
      onStage?.("surface:" + binding.parameters.join("/"), vertices());
    }
  }
  for (const binding of mesh.bindings ?? []) if (binding.composition === "surface") {
    applyArtMeshSurface(mesh, sampleArtMeshBinding(binding, values[binding.parameter] ?? 0), offsets);
    onStage?.("surface:" + binding.parameter, vertices());
  }
  return {
    vertices: vertices(),
    triangles: [...mesh.triangles],
    topology: mesh.generator.topology === "alpha-contour" ? "alpha-contour" : "rect-grid"
  };
}
function isValidArtMesh(mesh, width, height) {
  const dimensionsValid = width === void 0 || height === void 0 || finite2(width) && finite2(height) && width > 0 && height > 0;
  if (!dimensionsValid) return false;
  if (mesh && typeof mesh === "object" && evaluationCache()) return evaluationCache().get("valid-artmesh", mesh, () => validateArtMesh(mesh));
  return validateArtMesh(mesh);
}
function validateArtMesh(mesh) {
  if (!mesh || mesh.version !== 1 || typeof mesh.enabled !== "boolean" || !Array.isArray(mesh.vertices) || mesh.vertices.length < 3 || !Array.isArray(mesh.triangles) || mesh.triangles.length < 3 || mesh.triangles.length % 3 !== 0) {
    return false;
  }
  if (!mesh.generator || !["eyelid", "eye", "mouth", "outline", "hair-root", "face-feature"].includes(mesh.generator.preset) || !Number.isInteger(mesh.generator.columns) || !Number.isInteger(mesh.generator.rows) || mesh.generator.columns < 1 || mesh.generator.columns > 16 || mesh.generator.rows < 1 || mesh.generator.rows > 16 || !Number.isInteger(mesh.generator.alphaThreshold) || mesh.generator.alphaThreshold < 1 || mesh.generator.alphaThreshold > 255 || !finite2(mesh.generator.alphaBounds?.left) || !finite2(mesh.generator.alphaBounds?.top) || !finite2(mesh.generator.alphaBounds?.width) || !finite2(mesh.generator.alphaBounds?.height) || mesh.generator.alphaBounds.width <= 0 || mesh.generator.alphaBounds.height <= 0) {
    return false;
  }
  const ids = /* @__PURE__ */ new Set();
  for (const vertex of mesh.vertices) {
    if (!vertex || !vertex.id || ids.has(vertex.id) || !finite2(vertex.x) || !finite2(vertex.y) || !finite2(vertex.u) || !finite2(vertex.v) || vertex.u < 0 || vertex.u > 1 || vertex.v < 0 || vertex.v > 1) {
      return false;
    }
    ids.add(vertex.id);
  }
  for (let index = 0; index < mesh.triangles.length; index += 3) {
    const a = mesh.triangles[index];
    const b = mesh.triangles[index + 1];
    const c = mesh.triangles[index + 2];
    if (!Number.isInteger(a) || a < 0 || a >= mesh.vertices.length || !Number.isInteger(b) || b < 0 || b >= mesh.vertices.length || !Number.isInteger(c) || c < 0 || c >= mesh.vertices.length || a === b || b === c || a === c) {
      return false;
    }
    const area = triangleArea(mesh.vertices[a], mesh.vertices[b], mesh.vertices[c]);
    if (Math.abs(area) < 1e-4) return false;
  }
  for (const binding of mesh.bindings ?? []) {
    if (binding?.composition !== void 0 && binding.composition !== "surface") return false;
    if (!binding || typeof binding.parameter !== "string" || !binding.parameter.trim() || !Array.isArray(binding.keys)) return false;
    for (const key of binding.keys) {
      if (!key || !finite2(key.input) || !Array.isArray(key.offsets)) return false;
      for (const offset of key.offsets) {
        if (!offset || !ids.has(offset.vertexId) || !finite2(offset.x) || !finite2(offset.y)) return false;
      }
    }
  }
  for (const binding of mesh.multiBindings ?? []) {
    if (binding?.composition !== void 0 && binding.composition !== "surface") return false;
    if (!binding || !validGridParameters(binding.parameters) || !Array.isArray(binding.keyforms)) return false;
    for (const keyform of binding.keyforms) {
      if (!keyform || !keyform.inputs || binding.parameters.some((parameter) => !finite2(keyform.inputs[parameter])) || !Array.isArray(keyform.offsets)) return false;
      for (const offset of keyform.offsets) {
        if (!offset || !ids.has(offset.vertexId) || !finite2(offset.x) || !finite2(offset.y)) return false;
      }
    }
  }
  for (const shape of mesh.blendShapes ?? []) {
    if (!shape || typeof shape.id !== "string" || !shape.id.trim() || typeof shape.parameter !== "string" || !shape.parameter.trim() || !finite2(shape.neutralInput) || !finite2(shape.targetInput) || shape.neutralInput === shape.targetInput || !Array.isArray(shape.offsets)) return false;
    for (const offset of shape.offsets) {
      if (!offset || !ids.has(offset.vertexId) || !finite2(offset.x) || !finite2(offset.y)) return false;
    }
  }
  if (mesh.skinning !== void 0) {
    if (mesh.skinning.version !== 1 || !Array.isArray(mesh.skinning.joints) || mesh.skinning.joints.length !== 3 || new Set(mesh.skinning.joints.map((joint) => joint.deformerId)).size !== 3 || !mesh.skinning.vertexWeights || typeof mesh.skinning.vertexWeights !== "object") return false;
    for (const vertex of mesh.vertices) {
      const weights = mesh.skinning.vertexWeights[vertex.id];
      if (!Array.isArray(weights) || !weights.length || weights.length > 3 || weights.some((entry) => !entry || typeof entry.deformerId !== "string" || !finite2(entry.weight) || entry.weight < 0)) return false;
    }
  }
  return true;
}
function sampleArtMeshBinding(binding, input) {
  const keys = sortedKeysOrCopy(binding.keys);
  if (!keys.length) return /* @__PURE__ */ new Map();
  if (input <= keys[0].input) return offsetsForKey(keys[0]);
  const last = keys[keys.length - 1];
  if (input >= last.input) return offsetsForKey(last);
  for (let index = 0; index < keys.length - 1; index += 1) {
    const from = keys[index];
    const to = keys[index + 1];
    if (input < from.input || input > to.input) continue;
    const amount = applyParameterInterpolation(normalizeParameterInterpolation(binding.interpolation), (input - from.input) / (to.input - from.input || 1), binding.curve);
    const fromOffsets = offsetsForKey(from);
    const toOffsets = offsetsForKey(to);
    const ids = /* @__PURE__ */ new Set([...fromOffsets.keys(), ...toOffsets.keys()]);
    const result = /* @__PURE__ */ new Map();
    for (const id of ids) {
      const start = fromOffsets.get(id) ?? { x: 0, y: 0 };
      const end = toOffsets.get(id) ?? { x: 0, y: 0 };
      result.set(id, { x: start.x + (end.x - start.x) * amount, y: start.y + (end.y - start.y) * amount });
    }
    return result;
  }
  return /* @__PURE__ */ new Map();
}
function offsetsForKey(key) {
  const offsets = /* @__PURE__ */ new Map();
  for (const offset of key.offsets ?? []) {
    if (offset && typeof offset.vertexId === "string" && finite2(offset.x) && finite2(offset.y)) offsets.set(offset.vertexId, { x: offset.x, y: offset.y });
  }
  return offsets;
}
function applyOffsets(target, sampled, additive) {
  for (const [vertexId, offset] of sampled) {
    const current = target.get(vertexId) ?? { x: 0, y: 0 };
    target.set(vertexId, additive === false ? offset : { x: current.x + offset.x, y: current.y + offset.y });
  }
}
function triangleArea(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}
function clampInteger2(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}
function finite2(value) {
  return typeof value === "number" && Number.isFinite(value);
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/artPath.ts
function readRigArtPaths(part) {
  return Array.isArray(part.artPaths) ? part.artPaths : [];
}
function normalizeArtPath(path, fallbackId = "art-path") {
  path.version = 1;
  path.id = typeof path.id === "string" && path.id.trim() ? path.id : fallbackId;
  path.name = typeof path.name === "string" && path.name.trim() ? path.name : path.id;
  path.enabled = path.enabled !== false;
  path.closed = path.closed === true;
  path.curve = path.curve === "smooth" ? "smooth" : "polyline";
  path.strokeColor = normalizeColor(path.strokeColor);
  path.strokeWidth = clamp4(Number(path.strokeWidth), 0.25, 64, 2);
  path.opacity = clamp4(Number(path.opacity), 0, 1, 1);
  path.points = Array.isArray(path.points) ? path.points.filter((point) => Boolean(point && typeof point.id === "string")).slice(0, 128).map((point, index) => normalizePoint(point, index)) : [];
  path.bindings = Array.isArray(path.bindings) ? path.bindings.slice(0, 32) : [];
  return path;
}
function resolveArtPath(path, values, width, height) {
  normalizeArtPath(path);
  if (!path.enabled || path.points.length < 2) return void 0;
  const pointValues = path.points.map((point) => {
    let u = point.u;
    let v = point.v;
    for (const binding of point.bindings ?? []) {
      const sampled = sampleBinding(binding, values[binding.parameter] ?? 0);
      if (binding.property === "u") u += sampled / Math.max(1, width);
      else v += sampled / Math.max(1, height);
    }
    for (const shape of path.blendShapes ?? []) {
      const delta = shape.points?.find((p) => p.id === point.id);
      if (delta) {
        const w = blendWeight(shape, values);
        u += delta.x * w;
        v += delta.y * w;
      }
    }
    return { id: point.id, u: clamp4(u, 0, 1, point.u), v: clamp4(v, 0, 1, point.v) };
  });
  let offsetX = 0;
  let offsetY = 0;
  let strokeWidth = path.strokeWidth;
  let opacity = path.opacity;
  for (const binding of path.bindings ?? []) {
    const sampled = sampleBinding(binding, values[binding.parameter] ?? 0);
    if (binding.property === "offsetX") offsetX += sampled / Math.max(1, width);
    else if (binding.property === "offsetY") offsetY += sampled / Math.max(1, height);
    else if (binding.property === "width") strokeWidth += sampled;
    else if (binding.property === "opacity") opacity += sampled;
  }
  for (const shape of path.blendShapes ?? []) {
    const w = blendWeight(shape, values);
    strokeWidth += (shape.width ?? 0) * w;
    opacity += (shape.opacity ?? 0) * w;
  }
  return {
    id: path.id,
    points: pointValues.map((point) => ({ ...point, u: clamp4(point.u + offsetX, 0, 1, point.u), v: clamp4(point.v + offsetY, 0, 1, point.v) })),
    closed: path.closed === true,
    curve: path.curve === "smooth" ? "smooth" : "polyline",
    strokeColor: parseColor(path.strokeColor, opacity),
    strokeWidth: clamp4(strokeWidth, 0.25, 64, path.strokeWidth),
    opacity: clamp4(opacity, 0, 1, path.opacity)
  };
}
function normalizePoint(point, index) {
  point.id = point.id.trim() || `point-${index + 1}`;
  point.u = clamp4(Number(point.u), 0, 1, 0);
  point.v = clamp4(Number(point.v), 0, 1, 0);
  point.bindings = Array.isArray(point.bindings) ? point.bindings.slice(0, 16) : [];
  return point;
}
function normalizeColor(value) {
  return typeof value === "string" && /^#[0-9a-f]{6,8}$/i.test(value) ? value : "#20202aff";
}
function parseColor(value, opacity) {
  const normalized = normalizeColor(value).slice(1);
  const hex = normalized.length === 6 ? normalized + "ff" : normalized;
  return [parseInt(hex.slice(0, 2), 16), parseInt(hex.slice(2, 4), 16), parseInt(hex.slice(4, 6), 16), Math.round(parseInt(hex.slice(6, 8), 16) * clamp4(opacity, 0, 1, 1))];
}
function clamp4(value, min, max, fallback) {
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/skinning.ts
function applySkinningToVertex(vertex, skinning, transforms) {
  const weights = skinning.vertexWeights[vertex.id] ?? [];
  let x = 0;
  let y = 0;
  let total = 0;
  for (const influence of weights) {
    const matrix = transforms.get(influence.deformerId);
    if (!matrix || !Number.isFinite(influence.weight)) continue;
    const point = transformMatrixPoint(matrix, vertex.x, vertex.y);
    x += point.x * influence.weight;
    y += point.y * influence.weight;
    total += influence.weight;
  }
  return total > 0 ? { x: x / total, y: y / total } : { x: vertex.x, y: vertex.y };
}
function applySkinningToVertices(vertices, skinning, transforms) {
  if (!skinning || !transforms || !transforms.size) return vertices.map((vertex) => ({ ...vertex }));
  return vertices.map((vertex) => {
    const moved = applySkinningToVertex(vertex, skinning, transforms);
    return { ...vertex, x: moved.x, y: moved.y };
  });
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/glueVertex.ts
var ZERO_OFFSET_EPSILON = 1e-6;
var DEFAULT_ITERATIONS = 16;
var DEFAULT_RELAXATION = 0.7;
function projectArtMeshVertex(vertex, context) {
  const left = -context.pose.pivotX * context.sourceWidth;
  const top = -context.pose.pivotY * context.sourceHeight;
  const local = { x: left + vertex.x, y: top + vertex.y };
  const bounds = { left, top, width: context.sourceWidth, height: context.sourceHeight };
  const warped = context.warp && hasWarpEffect(context.warp) ? warpPoint(local.x, local.y, bounds, context.warp) : local;
  return projectSharedWarpPoint(warped, context.matrix, context.baseMatrix, context.sharedWarps);
}
function isStitchGlue(glue) {
  return glue.enabled && glue.status === "active" && glue.mode === "stitch" && Boolean(glue.vertexPairs?.length);
}
function collectGlueStitchPairs(rig, values = {}) {
  const pairs = [];
  const glues = readRigGlue(rig).filter(isStitchGlue).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
  for (const glue of glues) {
    for (const pair of glue.vertexPairs ?? []) {
      pairs.push({
        glueId: glue.id,
        strength: glueBlendStrength(glue, values),
        partAId: glue.partAId,
        partBId: glue.partBId,
        aVertexId: pair.a,
        bVertexId: pair.b,
        weight: clamp013(pair.weight ?? weightFromGlue(glue)),
        restDx: Number.isFinite(pair.restDx) ? pair.restDx : 0,
        restDy: Number.isFinite(pair.restDy) ? pair.restDy : 0
      });
    }
  }
  return pairs;
}
function hasGlueStitches(rig) {
  return readRigGlue(rig).some(isStitchGlue);
}
function resolveGlueStitchOffsets(rig, input) {
  const pairs = collectGlueStitchPairs(rig, input.values).filter((p) => p.strength > 0);
  const offsets = /* @__PURE__ */ new Map();
  let resolvedPairs = 0;
  let skippedPairs = 0;
  let maxClosedDistance = 0;
  if (!pairs.length) {
    return { offsets, resolvedPairs, skippedPairs, maxClosedDistance, maxResidual: 0, iterations: 0 };
  }
  const restScale = Number.isFinite(input.restScale) && input.restScale > 0 ? input.restScale : 1;
  const iterations = Math.max(1, Math.min(64, Math.round(Number.isFinite(input.iterations) ? input.iterations : DEFAULT_ITERATIONS)));
  const relaxation = Math.min(1, Math.max(0.05, Number.isFinite(input.relaxation) ? input.relaxation : DEFAULT_RELAXATION));
  const corrected = (partId, vertexId, base) => {
    const offset = offsets.get(partId)?.get(vertexId);
    return offset ? { x: base.x + offset.dx, y: base.y + offset.dy } : base;
  };
  const setOffset = (partId, vertexId, target, base) => {
    const dx = target.x - base.x;
    const dy = target.y - base.y;
    if (Math.abs(dx) < ZERO_OFFSET_EPSILON && Math.abs(dy) < ZERO_OFFSET_EPSILON) {
      offsets.get(partId)?.delete(vertexId);
      return;
    }
    let byVertex = offsets.get(partId);
    if (!byVertex) {
      byVertex = /* @__PURE__ */ new Map();
      offsets.set(partId, byVertex);
    }
    byVertex.set(vertexId, { dx, dy });
  };
  const basePoints = /* @__PURE__ */ new Map();
  const baseFor = (partId, vertexId) => {
    const key = partId + " " + vertexId;
    if (basePoints.has(key)) {
      return basePoints.get(key);
    }
    const point = input.projectVertex(partId, vertexId);
    const usable = point && isFinitePoint(point) ? point : void 0;
    basePoints.set(key, usable);
    return usable;
  };
  const solvable = [];
  for (const pair of pairs) {
    const baseA = baseFor(pair.partAId, pair.aVertexId);
    const baseB = baseFor(pair.partBId, pair.bVertexId);
    if (!baseA || !baseB) {
      skippedPairs += 1;
      continue;
    }
    solvable.push({ ...pair, baseA, baseB });
    resolvedPairs += 1;
  }
  let maxResidual = 0;
  for (let pass = 0; pass < iterations; pass += 1) {
    maxResidual = 0;
    for (const pair of solvable) {
      const currentA = corrected(pair.partAId, pair.aVertexId, pair.baseA);
      const currentB = corrected(pair.partBId, pair.bVertexId, pair.baseB);
      const errorX = currentB.x - currentA.x - (pair.restDx * restScale * pair.strength + (pair.baseB.x - pair.baseA.x) * (1 - pair.strength));
      const errorY = currentB.y - currentA.y - (pair.restDy * restScale * pair.strength + (pair.baseB.y - pair.baseA.y) * (1 - pair.strength));
      const drift = Math.hypot(errorX, errorY);
      if (pass === 0 && drift > maxClosedDistance) {
        maxClosedDistance = drift;
      }
      if (drift > maxResidual) {
        maxResidual = drift;
      }
      const stepX = errorX * relaxation;
      const stepY = errorY * relaxation;
      const targetA = { x: currentA.x + stepX * pair.weight, y: currentA.y + stepY * pair.weight };
      const targetB = { x: currentB.x - stepX * (1 - pair.weight), y: currentB.y - stepY * (1 - pair.weight) };
      if (!isFinitePoint(targetA) || !isFinitePoint(targetB)) {
        continue;
      }
      setOffset(pair.partAId, pair.aVertexId, targetA, pair.baseA);
      setOffset(pair.partBId, pair.bVertexId, targetB, pair.baseB);
    }
    if (maxResidual < ZERO_OFFSET_EPSILON) {
      break;
    }
  }
  return { offsets, resolvedPairs, skippedPairs, maxClosedDistance, maxResidual, iterations };
}
function glueStitchRestScale(matrix) {
  const determinant = Math.abs(matrix.a * matrix.d - matrix.b * matrix.c);
  return Number.isFinite(determinant) && determinant > 0 ? Math.sqrt(determinant) : 1;
}
function glueStitchOffsetToLocal(offset, matrix) {
  const determinant = matrix.a * matrix.d - matrix.b * matrix.c;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-9) {
    return { dx: 0, dy: 0 };
  }
  return {
    dx: (offset.dx * matrix.d - offset.dy * matrix.c) / determinant,
    dy: (offset.dy * matrix.a - offset.dx * matrix.b) / determinant
  };
}
function weightFromGlue(glue) {
  const total = glue.weightA + glue.weightB;
  return total > 0 ? glue.weightB / total : 0.5;
}
function isFinitePoint(point) {
  return Number.isFinite(point.x) && Number.isFinite(point.y);
}
function clamp013(value) {
  return Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0.5));
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/mask.ts
function createPartClipResolver(rig) {
  const partsById = new Map(rig.parts.map((entry) => [entry.id, entry]));
  const cache2 = /* @__PURE__ */ new Map();
  const resolve = (part) => {
    if (cache2.has(part.id)) return cache2.get(part.id);
    const visited = /* @__PURE__ */ new Set();
    let current = part;
    let result;
    while (current && !visited.has(current.id)) {
      visited.add(current.id);
      if (cache2.has(current.id)) {
        result = cache2.get(current.id);
        break;
      }
      if (current.clip) {
        const maskPartIds = clipMaskPartIds(current.clip);
        const maskParts = maskPartIds.map((id) => partsById.get(id));
        if (maskPartIds.length && maskParts.every((maskPart) => maskPart?.kind === "image" && maskPart.assetId)) result = { owner: current, clip: current.clip, maskPartIds, maskParts };
        break;
      }
      current = current.parentId ? partsById.get(current.parentId) : void 0;
    }
    for (const id of visited) cache2.set(id, result);
    return result;
  };
  return resolve;
}
function sameResolvedPartClip(left, right) {
  return Boolean(
    left && right && left.owner.id === right.owner.id && left.clip.mode === right.clip.mode && left.clip.maskOpacity === right.clip.maskOpacity && left.maskPartIds.length === right.maskPartIds.length && left.maskPartIds.every((id, index) => id === right.maskPartIds[index])
  );
}
function clipMaskPartIds(clip) {
  const ids = Array.isArray(clip.maskPartIds) ? clip.maskPartIds : clip.maskPartId ? [clip.maskPartId] : [];
  return [...new Set(ids.filter((id) => typeof id === "string" && id.length > 0))];
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/contourShade.ts
function validateContourShade(shade) {
  return Boolean(shade && /^#[0-9a-fA-F]{6}$/.test(shade.color) && typeof shade.yawParameter === "string" && shade.yawParameter.length && typeof shade.pitchParameter === "string" && shade.pitchParameter.length && Number.isFinite(shade.maxYaw) && shade.maxYaw > 0 && Number.isFinite(shade.maxPitch) && shade.maxPitch > 0 && Number.isFinite(shade.width) && shade.width > 0 && shade.width <= 0.5 && Number.isFinite(shade.strength) && shade.strength >= 0 && shade.strength <= 1 && Number.isFinite(shade.axisStrength) && shade.axisStrength >= 0 && shade.axisStrength <= 1 && (shade.profile === void 0 || shade.profile === "cheek") && (shade.farContourFade === void 0 || Number.isFinite(shade.farContourFade) && shade.farContourFade >= 0 && shade.farContourFade <= 1) && (shade.nearContourFade === void 0 || Number.isFinite(shade.nearContourFade) && shade.nearContourFade >= 0 && shade.nearContourFade <= 1) && (shade.upContourFade === void 0 || Number.isFinite(shade.upContourFade) && shade.upContourFade >= 0 && shade.upContourFade <= 1) && (shade.upShadowStrength === void 0 || Number.isFinite(shade.upShadowStrength) && shade.upShadowStrength >= 0 && shade.upShadowStrength <= 1) && (shade.lineWidth === void 0 || Number.isFinite(shade.lineWidth) && shade.lineWidth > 0 && shade.lineWidth <= 0.1));
}
var smooth = (value) => {
  const t = Math.min(1, Math.max(0, value));
  return t * t * (3 - 2 * t);
};
var ContourShadeProcessor = class {
  constructor(source, shade) {
    this.source = source;
    this.shade = shade;
    this.left = new Float32Array(source.width * source.height);
    this.right = new Float32Array(this.left.length);
    this.color = [1, 3, 5].map((i) => parseInt(shade.color.slice(i, i + 2), 16) / 255);
    this.lastImage = source;
    if (shade.profile === "cheek") {
      this.volumeLeft = [-1, 0, 1].map(() => new Float32Array(this.left.length));
      this.volumeRight = [-1, 0, 1].map(() => new Float32Array(this.left.length));
    }
    if (shade.farContourFade || shade.nearContourFade) {
      this.fadeLeft = new Float32Array(this.left.length);
      this.fadeRight = new Float32Array(this.left.length);
      this.skinLeft = new Float32Array(source.height * 3);
      this.skinRight = new Float32Array(source.height * 3);
    }
    if (shade.nearContourFade) {
      this.nearFadeLeft = new Float32Array(this.left.length);
      this.nearFadeRight = new Float32Array(this.left.length);
    }
    const band = Math.max(1, source.width * shade.width);
    for (let y = 0; y < source.height; y++) {
      let l = source.width, r = -1;
      for (let x = 0; x < source.width; x++) if (source.data[(y * source.width + x) * 4 + 3] > 0) {
        l = Math.min(l, x);
        r = x;
      }
      if (r < l) continue;
      let surfaceL = l, surfaceR = r, runStart = -1, longest = 0;
      if (this.volumeLeft || this.fadeLeft) for (let x = l; x <= r + 1; x++) {
        if (x <= r && source.data[(y * source.width + x) * 4 + 3] >= 128) {
          if (runStart < 0) runStart = x;
        } else if (runStart >= 0) {
          if (x - runStart > longest) {
            longest = x - runStart;
            surfaceL = runStart;
            surfaceR = x - 1;
          }
          runStart = -1;
        }
      }
      const v = y / Math.max(1, source.height - 1);
      const inkBand = Math.max(1, source.width * (shade.lineWidth ?? 0.035));
      const inset = Math.min((surfaceR - surfaceL) / 2, inkBand * 2.1);
      const skinX = [Math.round(surfaceL + inset), Math.round(surfaceR - inset)];
      for (let c = 0; c < 3; c++) {
        if (this.skinLeft) this.skinLeft[y * 3 + c] = source.data[(y * source.width + skinX[0]) * 4 + c];
        if (this.skinRight) this.skinRight[y * 3 + c] = source.data[(y * source.width + skinX[1]) * 4 + c];
      }
      const cheekInk = smooth((v - 0.56) / 0.09) * (1 - smooth((v - 0.88) / 0.08));
      const nearCheekInk = smooth((v - 0.63) / 0.17) * (1 - smooth((v - 0.985) / 0.015));
      const widths = [-1, 0, 1].map((pitch) => band * (0.4 + 0.85 * Math.exp(-(((v - (0.7 + 0.055 * pitch)) / 0.17) ** 2))) * (1 - 0.6 * smooth((v - 0.87) / 0.11)));
      const cheekPlane = smooth((v - 0.4) / 0.16) * (1 - 0.75 * smooth((v - 0.94) / 0.06));
      for (let x = l; x <= r; x++) {
        const p = y * source.width + x;
        this.left[p] = Math.exp(-(((x - l) / band) ** 2));
        this.right[p] = Math.exp(-(((r - x) / band) ** 2));
        if (this.volumeLeft && this.volumeRight) for (let k = 0; k < 3; k++) {
          this.volumeLeft[k][p] = cheekPlane * (1 - smooth(((x - surfaceL) / widths[k] - 0.2) / 0.8));
          this.volumeRight[k][p] = cheekPlane * (1 - smooth(((surfaceR - x) / widths[k] - 0.2) / 0.8));
        }
        for (const [distance, field, nearField, skin] of [[x - surfaceL, this.fadeLeft, this.nearFadeLeft, this.skinLeft], [surfaceR - x, this.fadeRight, this.nearFadeRight, this.skinRight]]) {
          if (!field || !skin) continue;
          const i = p * 4;
          const contrast = (skin[y * 3] - source.data[i]) * 0.2126 + (skin[y * 3 + 1] - source.data[i + 1]) * 0.7152 + (skin[y * 3 + 2] - source.data[i + 2]) * 0.0722;
          const edgeInk = distance < -inkBand ? 0 : (1 - smooth((distance / inkBand - 0.5) / 0.5)) * smooth((contrast - 5) / 26);
          field[p] = cheekInk * edgeInk;
          if (nearField) nearField[p] = nearCheekInk * edgeInk;
        }
      }
    }
  }
  source;
  shade;
  left;
  right;
  color;
  lastKey = "";
  lastImage;
  volumeLeft;
  volumeRight;
  fadeLeft;
  fadeRight;
  nearFadeLeft;
  nearFadeRight;
  skinLeft;
  skinRight;
  jawInk;
  jawShadow;
  jawSkin;
  prepareJaw() {
    if (this.jawInk) return;
    const { width, height, data } = this.source;
    this.jawInk = new Float32Array(width * height);
    this.jawShadow = new Float32Array(width * height);
    this.jawSkin = new Float32Array(width * 3);
    const inkBand = Math.max(1, width * (this.shade.lineWidth ?? 0.035));
    const shadowBand = Math.max(1, height * 0.075);
    for (let x = 0; x < width; x++) {
      let start = -1, bottom = -1, longest = 0;
      for (let y = Math.floor(height * 0.5); y <= height; y++) {
        if (y < height && data[(y * width + x) * 4 + 3] >= 128) {
          if (start < 0) start = y;
        } else if (start >= 0) {
          if (y - start > longest) {
            longest = y - start;
            bottom = y - 1;
          }
          start = -1;
        }
      }
      if (bottom < 0) continue;
      const sampleY = Math.round(bottom - Math.min(longest / 2, inkBand * 2.1));
      for (let c = 0; c < 3; c++) this.jawSkin[x * 3 + c] = data[(sampleY * width + x) * 4 + c];
      const lateral = 1 - smooth((Math.abs(x / Math.max(1, width - 1) - 0.5) - 0.16) / 0.24);
      for (let y = Math.floor(height * 0.78); y < height; y++) {
        const p = y * width + x, i = p * 4, distance = bottom - y;
        if (distance < -inkBand || !data[i + 3]) continue;
        const lowerJaw = lateral * smooth((y / Math.max(1, height - 1) - 0.78) / 0.13);
        const contrast = (this.jawSkin[x * 3] - data[i]) * 0.2126 + (this.jawSkin[x * 3 + 1] - data[i + 1]) * 0.7152 + (this.jawSkin[x * 3 + 2] - data[i + 2]) * 0.0722;
        this.jawInk[p] = lowerJaw * (1 - smooth((distance / inkBand - 0.5) / 0.5)) * smooth((contrast - 5) / 26);
        this.jawShadow[p] = lowerJaw * Math.exp(-((Math.max(0, distance) / shadowBand) ** 2));
      }
    }
  }
  render(values) {
    const yaw = values[this.shade.yawParameter] ?? 0;
    const pitch = values[this.shade.pitchParameter] ?? 0;
    if (!Number.isFinite(yaw) || !Number.isFinite(pitch)) return this.source;
    const yawWeight = smooth(Math.abs(yaw) / this.shade.maxYaw);
    const fade2 = (this.shade.farContourFade ?? 0) * yawWeight;
    const nearFade = (this.shade.nearContourFade ?? 0) * smooth(Math.abs(yaw) / (this.shade.maxYaw * 2 / 3));
    const upWeight = smooth(-pitch / this.shade.maxPitch);
    const upFade = (this.shade.upContourFade ?? 0) * upWeight;
    const upShadow = (this.shade.upShadowStrength ?? 0) * upWeight;
    if (upFade > 0 || upShadow > 0) this.prepareJaw();
    const strength = this.shade.strength * smooth(Math.abs(yaw) / this.shade.maxYaw) * (this.shade.axisStrength + (1 - this.shade.axisStrength) * smooth(Math.abs(pitch) / this.shade.maxPitch));
    if (strength <= 0 && fade2 <= 0 && nearFade <= 0 && upFade <= 0 && upShadow <= 0) return this.source;
    const pitchWeight = Math.min(1, Math.abs(pitch) / this.shade.maxPitch);
    const key = `${yaw < 0}:${strength}:${fade2}:${nearFade}:${upFade}:${upShadow}:${this.shade.profile ? pitch : 0}`;
    if (key === this.lastKey) return this.lastImage;
    const weights = yaw < 0 ? this.right : this.left;
    const volume = yaw < 0 ? this.volumeRight : this.volumeLeft;
    const fadeWeights = yaw < 0 ? this.fadeLeft : this.fadeRight;
    const skin = yaw < 0 ? this.skinLeft : this.skinRight;
    const nearFadeWeights = yaw < 0 ? this.nearFadeRight : this.nearFadeLeft;
    const nearSkin = yaw < 0 ? this.skinRight : this.skinLeft;
    const data = new Uint8ClampedArray(this.source.data);
    for (let p = 0; p < weights.length; p++) {
      const i = p * 4;
      if (!data[i + 3]) continue;
      const weight = volume ? volume[1][p] * (1 - pitchWeight) + volume[pitch < 0 ? 0 : 2][p] * pitchWeight : weights[p];
      const a = weight * strength;
      const ink = fade2 * (fadeWeights?.[p] ?? 0);
      const nearInk = nearFade * (nearFadeWeights?.[p] ?? 0);
      const jawInk = upFade * (this.jawInk?.[p] ?? 0);
      const jawShade = upShadow * (this.jawShadow?.[p] ?? 0);
      const column = p % this.source.width * 3;
      const row = Math.floor(p / this.source.width) * 3;
      for (let c = 0; c < 3; c++) {
        const skinColor = skin?.[row + c] ?? data[i + c];
        const farSoftened = data[i + c] + ink * (skinColor - data[i + c]);
        const softened = farSoftened + nearInk * ((nearSkin?.[row + c] ?? farSoftened) - farSoftened);
        const jawSoftened = softened + jawInk * ((this.jawSkin?.[column + c] ?? softened) - softened);
        const combinedShade = jawShade > 0 ? 1 - (1 - a) * (1 - jawShade) : a;
        data[i + c] = Math.round(jawSoftened * (1 - combinedShade * (1 - this.color[c])));
      }
    }
    this.lastKey = key;
    return this.lastImage = { width: this.source.width, height: this.source.height, data };
  }
};

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/alphaReveal.ts
function validateAlphaReveal(reveal) {
  return Boolean(reveal && typeof reveal.parameter === "string" && reveal.parameter.length && Number.isFinite(reveal.closed) && Number.isFinite(reveal.open) && reveal.open > reveal.closed && Number.isFinite(reveal.exponent) && reveal.exponent > 0 && reveal.exponent <= 4 && (reveal.anchor === void 0 || Number.isFinite(reveal.anchor) && reveal.anchor >= 0 && reveal.anchor <= 1));
}
var AlphaRevealProcessor = class {
  constructor(source, reveal) {
    this.source = source;
    this.reveal = reveal;
    this.top = new Int32Array(source.width).fill(source.height);
    this.bottom = new Int32Array(source.width).fill(-1);
    this.lastImage = source;
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
      if (source.data[(y * source.width + x) * 4 + 3]) {
        this.top[x] = Math.min(this.top[x], y);
        this.bottom[x] = y;
      }
    }
  }
  source;
  reveal;
  top;
  bottom;
  lastValue = -1;
  lastImage;
  render(values) {
    const raw = values[this.reveal.parameter] ?? this.reveal.open;
    const normalized = Number.isFinite(raw) ? Math.min(1, Math.max(0, (raw - this.reveal.closed) / (this.reveal.open - this.reveal.closed))) : 1;
    if (normalized === 1) return this.source;
    if (normalized === this.lastValue) return this.lastImage;
    const fraction = normalized ** this.reveal.exponent;
    const data = new Uint8ClampedArray(this.source.data);
    for (let x = 0; x < this.source.width; x++) {
      const span = this.bottom[x] + 1 - this.top[x];
      const start = this.top[x] + span * (1 - fraction) * (this.reveal.anchor ?? 0);
      const cut = start + span * fraction;
      for (let y = 0; y < this.source.height; y++) {
        const i = (y * this.source.width + x) * 4 + 3;
        data[i] = Math.round(data[i] * Math.max(0, Math.min(y + 1, cut) - Math.max(y, start)));
      }
    }
    this.lastValue = normalized;
    return this.lastImage = { width: this.source.width, height: this.source.height, data };
  }
};

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/compositing.ts
function canvasBlendMode(mode) {
  return mode === "additive" ? "lighter" : mode === "normal" || !mode ? "source-over" : mode;
}
function blendChannel(backdrop, source, mode) {
  switch (mode) {
    case "multiply":
      return backdrop * source;
    case "screen":
      return 1 - (1 - backdrop) * (1 - source);
    case "additive":
      return Math.min(1, backdrop + source);
    case "color-dodge":
      return backdrop === 0 ? 0 : source >= 1 ? 1 : Math.min(1, backdrop / (1 - source));
    case "overlay":
      return backdrop <= 0.5 ? 2 * backdrop * source : 1 - 2 * (1 - backdrop) * (1 - source);
    case "soft-light": {
      const d = backdrop <= 0.25 ? ((16 * backdrop - 12) * backdrop + 4) * backdrop : Math.sqrt(backdrop);
      return source <= 0.5 ? backdrop - (1 - 2 * source) * backdrop * (1 - backdrop) : backdrop + (2 * source - 1) * (d - backdrop);
    }
    default:
      return source;
  }
}
function compositeRgba(target, source, mode, opacity = 1, preserveAlpha = false) {
  if (target.width !== source.width || target.height !== source.height) throw new Error("Composite dimensions must match");
  for (let i = 0; i < target.data.length; i += 4) {
    const sa = source.data[i + 3] / 255 * opacity, da = target.data[i + 3] / 255;
    if (sa <= 0 || preserveAlpha && da <= 0) continue;
    const oa = preserveAlpha ? da : sa + da * (1 - sa);
    for (let c = 0; c < 3; c++) {
      const s = source.data[i + c] / 255, d = target.data[i + c] / 255, b = blendChannel(d, s, mode);
      target.data[i + c] = Math.round(255 * (preserveAlpha ? d * (1 - sa) + b * sa : (s * sa * (1 - da) + b * sa * da + d * da * (1 - sa)) / oa));
    }
    target.data[i + 3] = Math.round(oa * 255);
  }
}
function hasLayerCompositing(rig) {
  return rig.parts.some((part) => part.compositing !== void 0 || part.clippingBaseId !== void 0 || part.rasterMaskPartId !== void 0);
}
function layerCompositingPlan(rig) {
  const nodes = new Map(rig.parts.map((part) => [part.id, { part, children: [], clipped: [] }]));
  const roots = [];
  for (const node of nodes.values()) {
    const parent = node.part.parentId ? nodes.get(node.part.parentId) : void 0;
    (parent ? parent.children : roots).push(node);
  }
  const prepare = (list) => {
    list.sort((a, b) => a.part.drawOrder - b.part.drawOrder);
    const siblings = new Map(list.map((node) => [node.part.id, node]));
    for (const node of list) node.children = prepare(node.children);
    return list.filter((node) => {
      const base = node.part.clippingBaseId ? siblings.get(node.part.clippingBaseId) : void 0;
      if (base && base !== node) {
        base.clipped.push(node);
        return false;
      }
      return true;
    });
  };
  return prepare(roots);
}
function paintLayerPlan(plan, target, painter) {
  const paint = (node, destination, scale, unclipped = false, normalOuter = false, unmasked = false) => {
    const state = painter.state(node.part);
    if (!state?.visible || state.opacity <= 0) return;
    const opacity = state.opacity * scale;
    const mode = normalOuter ? "normal" : node.part.blendMode ?? "normal";
    if (!unclipped && node.clipped.length) {
      const stack = painter.create();
      paint(node, stack, 1 / state.opacity, true, true);
      for (const overlay of node.clipped) {
        const content = painter.create();
        paint(overlay, content, scale, true, true);
        painter.compose(stack, content, overlay.part.blendMode ?? "normal", 1, true);
        painter.release(content);
      }
      painter.compose(destination, stack, mode, opacity);
      painter.release(stack);
    } else if (!unmasked && node.part.rasterMaskPartId) {
      const content = painter.create();
      paint(node, content, 1 / state.opacity, true, true, true);
      painter.mask?.(content, node.part);
      painter.compose(destination, content, mode, opacity);
      painter.release(content);
    } else if (node.part.kind === "group") {
      if (node.part.compositing === "isolate") {
        const group = painter.create();
        for (const child of node.children) paint(child, group, 1 / state.opacity);
        painter.compose(destination, group, mode, opacity);
        painter.release(group);
      } else {
        for (const child of node.children) paint(child, destination, scale);
      }
    } else painter.draw(destination, node.part, scale, mode);
  };
  for (const node of plan) paint(node, target, 1);
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/triangleCoverage.ts
var TRIANGLE_COVERAGE_OVERLAP_PX = 0.45;
function expandTriangleForCoverage(vertices, amount = TRIANGLE_COVERAGE_OVERLAP_PX) {
  if (!Number.isFinite(amount) || amount <= 0) return vertices.map((v) => ({ x: v.x, y: v.y }));
  const center = { x: (vertices[0].x + vertices[1].x + vertices[2].x) / 3, y: (vertices[0].y + vertices[1].y + vertices[2].y) / 3 };
  return vertices.map((vertex) => {
    const dx = vertex.x - center.x, dy = vertex.y - center.y, length = Math.hypot(dx, dy);
    return length > 1e-9 ? { x: vertex.x + dx / length * amount, y: vertex.y + dy / length * amount } : { x: vertex.x, y: vertex.y };
  });
}
function localCoverageOverlap(transform, pixels = TRIANGLE_COVERAGE_OVERLAP_PX) {
  const scale = Math.sqrt(Math.max(1e-8, Math.abs(transform.a * transform.d - transform.b * transform.c)));
  return pixels / scale;
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/hitTesting.ts
function triangleUvAtPoint(point, vertices) {
  const [a, b, c] = vertices;
  const denominator = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(denominator) < 1e-9) return;
  const wa = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / denominator;
  const wb = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / denominator;
  const wc = 1 - wa - wb;
  const epsilon = -1e-6;
  if (wa < epsilon || wb < epsilon || wc < epsilon) return;
  return { u: wa * a.u + wb * b.u + wc * c.u, v: wa * a.v + wb * b.v + wc * c.v };
}
function alphaMaskHit(mask, uv, threshold = 8) {
  if (!mask) return true;
  const x = Math.min(mask.width - 1, Math.max(0, Math.floor(uv.u * mask.width)));
  const y = Math.min(mask.height - 1, Math.max(0, Math.floor(uv.v * mask.height)));
  return mask.alpha[y * mask.width + x] >= threshold;
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/runtime/src/webglMesh.ts
var CONTEXT_OPTIONS = {
  alpha: true,
  premultipliedAlpha: true,
  preserveDrawingBuffer: true,
  antialias: false,
  depth: false,
  stencil: false
};
var WebGLArtMeshRenderer = class {
  canvas;
  gl;
  contextLossExtension;
  program;
  vertexBuffer;
  indexBuffer;
  disposed = false;
  textures = /* @__PURE__ */ new Set();
  vertexData = new Float32Array(0);
  indexData = new Uint32Array(0);
  vertexCapacity = 0;
  indexCapacity = 0;
  textureByImage = /* @__PURE__ */ new WeakMap();
  positionLocation;
  texCoordLocation;
  resolutionLocation;
  opacityLocation;
  statusValue = "ready";
  constructor(canvas) {
    this.canvas = canvas ?? document.createElement("canvas");
    const gl = this.canvas.getContext("webgl2", CONTEXT_OPTIONS);
    if (!gl) throw new Error("WebGL2 ArtMesh renderer is unavailable");
    this.gl = gl;
    this.contextLossExtension = gl.getExtension("WEBGL_lose_context");
    const resources = this.createResources();
    this.program = resources.program;
    this.vertexBuffer = resources.vertexBuffer;
    this.indexBuffer = resources.indexBuffer;
    this.positionLocation = resources.positionLocation;
    this.texCoordLocation = resources.texCoordLocation;
    this.resolutionLocation = resources.resolutionLocation;
    this.opacityLocation = resources.opacityLocation;
    this.canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.statusValue = "context-lost";
    });
    this.canvas.addEventListener("webglcontextrestored", () => {
      if (this.disposed) return;
      this.textures.clear();
      try {
        const restored = this.createResources();
        this.program = restored.program;
        this.vertexBuffer = restored.vertexBuffer;
        this.indexBuffer = restored.indexBuffer;
        this.positionLocation = restored.positionLocation;
        this.texCoordLocation = restored.texCoordLocation;
        this.resolutionLocation = restored.resolutionLocation;
        this.opacityLocation = restored.opacityLocation;
        this.vertexCapacity = 0;
        this.indexCapacity = 0;
        this.textureByImage = /* @__PURE__ */ new WeakMap();
        this.statusValue = "ready";
      } catch {
        this.statusValue = "restore-failed";
      }
    });
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.textures.clear();
    this.gl.deleteBuffer(this.vertexBuffer);
    this.gl.deleteBuffer(this.indexBuffer);
    this.gl.deleteProgram(this.program);
    this.textureByImage = /* @__PURE__ */ new WeakMap();
    this.vertexData = new Float32Array(0);
    this.indexData = new Uint32Array(0);
    this.contextLossExtension?.loseContext();
  }
  get status() {
    return this.statusValue;
  }
  /** Test hook used by browser regression QA; production rendering never calls this automatically. */
  simulateContextLoss() {
    const extension = this.contextLossExtension;
    if (!extension) return false;
    extension.loseContext();
    return true;
  }
  /** Test hook used by browser regression QA to request context restoration. */
  simulateContextRestore() {
    const extension = this.contextLossExtension;
    if (!extension) return false;
    extension.restoreContext();
    return true;
  }
  draw(target, image, vertices, triangles, opacity, blendMode = "source-over") {
    if (this.disposed || this.statusValue !== "ready" || this.gl.isContextLost() || vertices.length < 3 || triangles.length < 3) return false;
    const width = Math.max(1, target.canvas.width);
    const height = Math.max(1, target.canvas.height);
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    const gl = this.gl;
    const vertexLength = vertices.length * 4;
    if (this.vertexData.length < vertexLength) this.vertexData = new Float32Array(vertexLength);
    if (this.indexData.length < triangles.length) this.indexData = new Uint32Array(triangles.length);
    const interleaved = this.vertexData;
    this.indexData.set(triangles);
    for (let index = 0; index < vertices.length; index += 1) {
      const vertex = vertices[index];
      const offset = index * 4;
      interleaved[offset] = vertex.x;
      interleaved[offset + 1] = vertex.y;
      interleaved[offset + 2] = vertex.u;
      interleaved[offset + 3] = vertex.v;
    }
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.program);
    gl.uniform2f(this.resolutionLocation, width, height);
    gl.uniform1f(this.opacityLocation, Math.min(1, Math.max(0, opacity)));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    if (this.vertexCapacity < interleaved.byteLength) {
      gl.bufferData(gl.ARRAY_BUFFER, interleaved.byteLength, gl.STREAM_DRAW);
      this.vertexCapacity = interleaved.byteLength;
    }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, interleaved, 0, vertexLength);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.texCoordLocation);
    gl.vertexAttribPointer(this.texCoordLocation, 2, gl.FLOAT, false, 16, 8);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuffer);
    if (this.indexCapacity < this.indexData.byteLength) {
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, this.indexData.byteLength, gl.STREAM_DRAW);
      this.indexCapacity = this.indexData.byteLength;
    }
    gl.bufferSubData(gl.ELEMENT_ARRAY_BUFFER, 0, this.indexData, 0, triangles.length);
    const texture = this.textureFor(image);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.drawElements(gl.TRIANGLES, triangles.length, gl.UNSIGNED_INT, 0);
    target.save();
    target.setTransform(1, 0, 0, 1, 0, 0);
    target.globalAlpha = 1;
    target.globalCompositeOperation = blendMode;
    target.drawImage(this.canvas, 0, 0);
    target.restore();
    return true;
  }
  textureFor(image) {
    const existing = this.textureByImage.get(image);
    if (existing) {
      if (image instanceof HTMLCanvasElement) {
        const gl2 = this.gl;
        gl2.bindTexture(gl2.TEXTURE_2D, existing);
        gl2.pixelStorei(gl2.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
        gl2.pixelStorei(gl2.UNPACK_FLIP_Y_WEBGL, 1);
        gl2.texImage2D(gl2.TEXTURE_2D, 0, gl2.RGBA, gl2.RGBA, gl2.UNSIGNED_BYTE, image);
      }
      return existing;
    }
    const gl = this.gl;
    const texture = gl.createTexture();
    if (!texture) throw new Error("Could not create WebGL2 ArtMesh texture");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
    this.textures.add(texture);
    this.textureByImage.set(image, texture);
    return texture;
  }
  createResources() {
    const gl = this.gl;
    const vertexShader = this.compileShader(gl.VERTEX_SHADER, `#version 300 es
      precision highp float;
      in vec2 a_position;
      in vec2 a_texCoord;
      uniform vec2 u_resolution;
      out vec2 v_texCoord;
      void main() {
        vec2 zeroToOne = a_position / u_resolution;
        vec2 clip = zeroToOne * 2.0 - 1.0;
        gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
        v_texCoord = vec2(a_texCoord.x, 1.0 - a_texCoord.y);
      }`);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, `#version 300 es
      precision highp float;
      uniform sampler2D u_texture;
      uniform float u_opacity;
      in vec2 v_texCoord;
      out vec4 outColor;
      void main() {
        vec4 color = texture(u_texture, v_texCoord);
        outColor = color * u_opacity;
      }`);
    const program = gl.createProgram();
    if (!program) throw new Error("Could not create WebGL2 ArtMesh program");
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const message = gl.getProgramInfoLog(program) || "unknown link error";
      gl.deleteProgram(program);
      throw new Error(`Could not link WebGL2 ArtMesh program: ${message}`);
    }
    const vertexBuffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    const resolutionLocation = gl.getUniformLocation(program, "u_resolution");
    const opacityLocation = gl.getUniformLocation(program, "u_opacity");
    if (!vertexBuffer || !indexBuffer || !resolutionLocation || !opacityLocation) {
      gl.deleteProgram(program);
      throw new Error("Could not create WebGL2 ArtMesh buffers or uniforms");
    }
    gl.useProgram(program);
    gl.uniform1i(gl.getUniformLocation(program, "u_texture"), 0);
    return {
      program,
      vertexBuffer,
      indexBuffer,
      positionLocation: gl.getAttribLocation(program, "a_position"),
      texCoordLocation: gl.getAttribLocation(program, "a_texCoord"),
      resolutionLocation,
      opacityLocation
    };
  }
  compileShader(type, source) {
    const shader = this.gl.createShader(type);
    if (!shader) throw new Error("Could not create WebGL2 ArtMesh shader");
    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);
    if (!this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS)) {
      const message = this.gl.getShaderInfoLog(shader) || "unknown compile error";
      this.gl.deleteShader(shader);
      throw new Error(`Could not compile WebGL2 ArtMesh shader: ${message}`);
    }
    return shader;
  }
};
function comparePixelBuffers(reference, candidate, width, height, threshold = 2, options = {}) {
  const pixelCount = Math.max(0, width * height);
  let differingPixels = 0;
  let maxChannelDelta = 0;
  let totalChannelDelta = 0;
  const length = Math.min(reference.length, candidate.length);
  for (let offset = 0; offset + 3 < length; offset += 4) {
    let pixelDelta = 0;
    for (let channel2 = 0; channel2 < 4; channel2 += 1) {
      const delta = Math.abs((reference[offset + channel2] ?? 0) - (candidate[offset + channel2] ?? 0));
      pixelDelta = Math.max(pixelDelta, delta);
      maxChannelDelta = Math.max(maxChannelDelta, delta);
      totalChannelDelta += delta;
    }
    if (pixelDelta > threshold) differingPixels += 1;
  }
  const channelCount = Math.max(1, Math.floor(length / 4) * 4);
  const differingPixelRatio = pixelCount ? differingPixels / pixelCount : 0;
  const meanChannelDelta = totalChannelDelta / channelCount;
  const gate = {
    maxDifferingPixelRatio: clampParityRatio(options.maxDifferingPixelRatio ?? 0),
    maxMeanChannelDelta: clampParityMean(options.maxMeanChannelDelta ?? 255)
  };
  return { width, height, differingPixels, differingPixelRatio, maxChannelDelta, meanChannelDelta, gate, pass: differingPixelRatio <= gate.maxDifferingPixelRatio && meanChannelDelta <= gate.maxMeanChannelDelta };
}
function clampParityRatio(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
}
function clampParityMean(value) {
  return Number.isFinite(value) ? Math.max(0, Math.min(255, value)) : 0;
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/runtime/src/renderer.ts
async function waitForWebGLRendererStatus(renderer, expected, timeoutMs = 1e3) {
  if (renderer.status === expected) return true;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      renderer.canvas.removeEventListener("webglcontextlost", onChange);
      renderer.canvas.removeEventListener("webglcontextrestored", onChange);
      window.clearTimeout(timeoutId);
      resolve(value);
    };
    const onChange = () => finish(renderer.status === expected);
    const timeoutId = window.setTimeout(() => finish(renderer.status === expected), Math.max(0, timeoutMs));
    renderer.canvas.addEventListener("webglcontextlost", onChange);
    renderer.canvas.addEventListener("webglcontextrestored", onChange);
  });
}
var MIN_SCALE2 = 1e-3;
var RigRuntime = class {
  /** cacheEvaluation requires a stable owned snapshot; call setRig after any edit. */
  constructor(rig, settings = {}) {
    this.settings = settings;
    this.rig = prepareRigBindingOrder(rig);
    if (settings.cacheEvaluation) this.evaluationCache = new EvaluationCache();
  }
  settings;
  rig;
  images = /* @__PURE__ */ new Map();
  tintedImages = /* @__PURE__ */ new Map();
  revealImages = /* @__PURE__ */ new Map();
  contourImages = /* @__PURE__ */ new Map();
  alphaMasks = /* @__PURE__ */ new Map();
  physicsState = /* @__PURE__ */ new Map();
  lastFrameTime = performance.now();
  previousPhysicsInputs;
  clippingLayers = [void 0, void 0];
  clippingLayerAllocations = 0;
  compositeLayers = [];
  webglMeshRenderer;
  webglMeshError;
  evaluationCache;
  resumeClock() {
    this.lastFrameTime = performance.now();
    this.previousPhysicsInputs = void 0;
  }
  resetPhysics() {
    this.physicsState.clear();
    this.resumeClock();
  }
  dispose() {
    this.webglMeshRenderer?.dispose();
    this.webglMeshRenderer = void 0;
    this.evaluationCache = void 0;
  }
  async setRig(rig) {
    this.dispose();
    this.rig = prepareRigBindingOrder(rig);
    this.evaluationCache = this.settings.cacheEvaluation ? new EvaluationCache() : void 0;
    this.images.clear();
    this.tintedImages.clear();
    this.revealImages.clear();
    this.contourImages.clear();
    this.alphaMasks.clear();
    this.physicsState.clear();
    this.resumeClock();
    await this.loadAssets();
  }
  async loadAssets() {
    const byId = new Map(this.rig.parts.map((part) => [part.id, part]));
    const visible = (part, seen = /* @__PURE__ */ new Set()) => {
      if (!part.visible || seen.has(part.id)) return false;
      seen.add(part.id);
      const parent = part.parentId ? byId.get(part.parentId) : void 0;
      return !parent || visible(parent, seen);
    };
    const needed = new Set(this.rig.parts.filter((part) => visible(part)).map((part) => part.assetId));
    for (const part of this.rig.parts) {
      if (!visible(part)) continue;
      if (part.rasterMaskPartId) needed.add(byId.get(part.rasterMaskPartId)?.assetId);
      if (part.clip?.maskOpacity === "ignore") for (const id of [part.clip.maskPartId, ...part.clip.maskPartIds ?? []]) needed.add(id ? byId.get(id)?.assetId : void 0);
    }
    const pending = this.rig.assets.filter((asset) => needed.has(asset.id)).map((asset) => this.loadAsset(asset));
    await Promise.all(pending);
  }
  getWebGLMeshStatus() {
    const renderer = this.webglMeshRenderer;
    return { supported: Boolean(renderer), status: renderer?.status ?? "canvas-fallback", error: this.webglMeshError };
  }
  async probeWebGLContextRecovery(delayMs = 0) {
    const renderer = this.getWebGLMeshRenderer(true);
    if (!renderer) return { supported: false, statusAfterLoss: "unsupported", statusAfterRestore: "unsupported" };
    const simulated = renderer.simulateContextLoss();
    if (!simulated) return { supported: true, simulated: false, statusAfterLoss: renderer.status, statusAfterRestore: renderer.status };
    const lossObserved = await waitForWebGLRendererStatus(renderer, "context-lost");
    const statusAfterLoss = renderer.status;
    await new Promise((resolve) => window.setTimeout(resolve, Math.max(16, Math.min(2e3, delayMs))));
    const restoreRequested = renderer.simulateContextRestore();
    const restoreObserved = restoreRequested && await waitForWebGLRendererStatus(renderer, "ready");
    if (restoreObserved) await new Promise((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));
    const restored = lossObserved && restoreObserved && renderer.status === "ready";
    return { supported: true, simulated: true, restored, statusAfterLoss, statusAfterRestore: renderer.status };
  }
  renderParity(canvas, params, options = {}) {
    const context = canvas.getContext("2d");
    if (!context || canvas.width <= 0 || canvas.height <= 0) {
      return { width: canvas.width, height: canvas.height, differingPixels: 0, differingPixelRatio: 1, maxChannelDelta: 0, meanChannelDelta: 0, gate: { maxDifferingPixelRatio: options.maxDifferingPixelRatio ?? 5e-4, maxMeanChannelDelta: options.maxMeanChannelDelta ?? 0.25 }, pass: false, physics: "disabled", webglStatus: this.getWebGLMeshStatus() };
    }
    const previous = context.getImageData(0, 0, canvas.width, canvas.height);
    this.render(canvas, params, { transparent: true, fitPadding: options.fitPadding ?? 18, webglMesh: false });
    const canvasPixels = context.getImageData(0, 0, canvas.width, canvas.height);
    this.render(canvas, params, { transparent: true, fitPadding: options.fitPadding ?? 18, webglMesh: true, webglMeshPartIds: options.webglMeshPartIds });
    const webglPixels = context.getImageData(0, 0, canvas.width, canvas.height);
    const compared = comparePixelBuffers(canvasPixels.data, webglPixels.data, canvas.width, canvas.height, options.threshold ?? 2, { maxDifferingPixelRatio: options.maxDifferingPixelRatio ?? 5e-4, maxMeanChannelDelta: options.maxMeanChannelDelta ?? 0.25 });
    context.putImageData(previous, 0, 0);
    return { ...compared, physics: "disabled", webglStatus: this.getWebGLMeshStatus() };
  }
  render(canvas, params, options = {}) {
    return withEvaluationCache(this.evaluationCache, () => this.renderFrame(canvas, params, options));
  }
  renderFrame(canvas, params, options) {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    const view = this.getCanvasView(canvas, options);
    if (canvas.width !== view.pixelWidth || canvas.height !== view.pixelHeight) {
      canvas.width = view.pixelWidth;
      canvas.height = view.pixelHeight;
    }
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.clearRect(0, 0, view.cssWidth, view.cssHeight);
    if (!options.transparent) {
      drawChecker(ctx, view.cssWidth, view.cssHeight);
    }
    const now = performance.now();
    const elapsed = (now - this.lastFrameTime) / 1e3;
    this.lastFrameTime = now;
    const step = prepareLivePhysicsStep(this.rig, params, this.previousPhysicsInputs, this.physicsState, elapsed, now / 1e3);
    this.previousPhysicsInputs = { ...params };
    const frame = resolveRigFrame(this.rig, params, view.pixelBaseMatrix, { physicsState: this.physicsState, physicsTime: step.time, physicsDt: step.dt });
    const effectiveParams = frame.values;
    const computed = frame.parts;
    const skinningTransforms = frame.skinningTransforms;
    const glueStitch = hasGlueStitches(this.rig) ? resolveGlueStitchOffsets(this.rig, {
      values: frame.values,
      restScale: glueStitchRestScale(view.pixelBaseMatrix),
      projectVertex: (partId, vertexId) => this.projectGlueVertex(partId, vertexId, computed, effectiveParams, view.pixelBaseMatrix, skinningTransforms)
    }).offsets : void 0;
    const webglMeshRenderer = this.getWebGLMeshRenderer(options.webglMesh === true || options.webglWarp === true);
    const webglMeshPartIds = options.webglMeshPartIds?.length ? new Set(options.webglMeshPartIds) : void 0;
    const webglRendererForPart = (part) => webglMeshRenderer && (options.webglWarp === true || part.artMesh?.generator.topology === "alpha-contour") && (!webglMeshPartIds || webglMeshPartIds.has(part.id)) ? webglMeshRenderer : void 0;
    const renderable = [...this.rig.parts].filter((part) => part.kind === "image" && part.assetId).sort((left, right) => left.drawOrder - right.drawOrder);
    const resolveClip = createPartClipResolver(this.rig);
    if (hasLayerCompositing(this.rig)) {
      const boxes = /* @__PURE__ */ new Map();
      boxes.set(ctx, { x: 0, y: 0, width: canvas.width, height: canvas.height });
      const union = (a, b) => a ? { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x), height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y) } : b;
      const intersection = (a, b) => {
        if (!a || !b) return void 0;
        const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y), right = Math.min(a.x + a.width, b.x + b.width), bottom = Math.min(a.y + a.height, b.y + b.height);
        return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : void 0;
      };
      const create = () => {
        const layer = this.compositeLayers.pop() ?? document.createElement("canvas");
        if (layer.width !== canvas.width || layer.height !== canvas.height) {
          layer.width = canvas.width;
          layer.height = canvas.height;
        } else layer.getContext("2d").clearRect(0, 0, layer.width, layer.height);
        const surface = layer.getContext("2d", { willReadFrequently: true });
        boxes.delete(surface);
        return surface;
      };
      const release = (surface) => {
        this.compositeLayers.push(surface.canvas);
      };
      const draw = (surface, part, scale = 1, mode, ignore = false) => {
        this.drawRenderablePart(surface, part, computed, effectiveParams, view.pixelBaseMatrix, ignore, webglRendererForPart(part), skinningTransforms, glueStitch, scale, mode, (box) => {
          const clipped = intersection(box, { x: 0, y: 0, width: canvas.width, height: canvas.height });
          if (clipped) boxes.set(surface, union(boxes.get(surface), clipped));
        });
      };
      const compose = (target, source, mode, opacity, preserveAlpha = false) => {
        const sourceBox = boxes.get(source);
        if (!sourceBox) return;
        if (preserveAlpha && mode !== "normal" || mode === "additive") {
          const box = preserveAlpha ? intersection(sourceBox, boxes.get(target)) : sourceBox;
          if (!box) return;
          const { x, y, width, height } = box, destination = target.getImageData(x, y, width, height), content = source.getImageData(x, y, width, height);
          compositeRgba(destination, content, mode, opacity, preserveAlpha);
          target.putImageData(destination, x, y);
        } else {
          target.save();
          target.setTransform(1, 0, 0, 1, 0, 0);
          target.globalAlpha = opacity;
          target.globalCompositeOperation = preserveAlpha ? "source-atop" : canvasBlendMode(mode);
          target.drawImage(source.canvas, 0, 0);
          target.restore();
        }
        if (!preserveAlpha) boxes.set(target, union(boxes.get(target), sourceBox));
      };
      paintLayerPlan(layerCompositingPlan(this.rig), ctx, {
        create,
        release,
        state: (part) => computed.get(part.id),
        draw: (target, part, scale, mode) => {
          const clip = resolveClip(part);
          if (!clip && mode !== "additive") {
            draw(target, part, scale, mode);
            return;
          }
          const content = create();
          draw(content, part, scale, "normal");
          if (clip) {
            const mask = create();
            for (const source of clip.maskParts) draw(mask, source, 1, void 0, clip.clip.maskOpacity === "ignore");
            content.save();
            content.setTransform(1, 0, 0, 1, 0, 0);
            content.globalAlpha = 1;
            content.globalCompositeOperation = "destination-in";
            content.drawImage(mask.canvas, 0, 0);
            content.restore();
            release(mask);
          }
          compose(target, content, mode, 1);
          release(content);
        },
        compose,
        mask: (surface, part) => {
          const source = this.rig.parts.find((p) => p.id === part.rasterMaskPartId), mask = create();
          if (source) draw(mask, source, 1, void 0, true);
          surface.save();
          surface.setTransform(1, 0, 0, 1, 0, 0);
          surface.globalAlpha = 1;
          surface.globalCompositeOperation = "destination-in";
          surface.drawImage(mask.canvas, 0, 0);
          surface.restore();
          release(mask);
        }
      });
      if (options.showBounds) for (const part of renderable) this.drawPartDebug(ctx, part, computed, view, options);
    } else for (let index = 0; index < renderable.length; ) {
      const part = renderable[index];
      const clip = resolveClip(part);
      if (!clip) {
        this.drawRenderablePart(ctx, part, computed, effectiveParams, view.pixelBaseMatrix, false, webglRendererForPart(part), skinningTransforms, glueStitch);
        this.drawPartDebug(ctx, part, computed, view, options);
        index += 1;
        continue;
      }
      const maskedParts = [];
      while (index < renderable.length && sameResolvedPartClip(clip, resolveClip(renderable[index]))) {
        maskedParts.push(renderable[index]);
        index += 1;
      }
      const contentLayer = this.prepareClippingLayer(canvas, 0);
      const contentContext = contentLayer.getContext("2d");
      const maskLayer = this.prepareClippingLayer(canvas, 1);
      const maskContext = maskLayer.getContext("2d");
      if (!contentContext || !maskContext) {
        for (const maskedPart of maskedParts) {
          this.drawRenderablePart(ctx, maskedPart, computed, effectiveParams, view.pixelBaseMatrix, false, webglRendererForPart(maskedPart), skinningTransforms, glueStitch);
          this.drawPartDebug(ctx, maskedPart, computed, view, options);
        }
        continue;
      }
      for (const maskedPart of maskedParts) this.drawRenderablePart(contentContext, maskedPart, computed, effectiveParams, view.pixelBaseMatrix, false, webglRendererForPart(maskedPart), skinningTransforms, glueStitch);
      for (const maskPart of clip.maskParts) this.drawRenderablePart(maskContext, maskPart, computed, effectiveParams, view.pixelBaseMatrix, clip.clip.maskOpacity === "ignore", webglRendererForPart(maskPart), skinningTransforms, glueStitch);
      contentContext.save();
      contentContext.setTransform(1, 0, 0, 1, 0, 0);
      contentContext.globalAlpha = 1;
      contentContext.globalCompositeOperation = "destination-in";
      contentContext.drawImage(maskLayer, 0, 0);
      contentContext.restore();
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(contentLayer, 0, 0);
      ctx.restore();
      for (const maskedPart of maskedParts) this.drawPartDebug(ctx, maskedPart, computed, view, options);
    }
    if (options.showBounds) {
      this.drawGlueOverlay(ctx, computed, view);
    }
    if (options.selectedDeformerId) {
      this.drawWarpPinOverlay(ctx, params, view, options);
    }
    if (options.selectedPartId) {
      this.drawArtMeshOverlay(ctx, params, view, options);
    }
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  }
  hitTestPart(canvas, params, clientX, clientY, options = {}) {
    const view = this.getCanvasView(canvas, options);
    const point = this.cssPointFromClient(canvas, clientX, clientY);
    const computed = this.computePartStates(params, /* @__PURE__ */ new Map(), view.cssBaseMatrix);
    const renderable = [...this.rig.parts].filter((part) => part.kind === "image" && part.assetId).sort((left, right) => right.drawOrder - left.drawOrder);
    for (const part of renderable) {
      const size = this.partSize(part);
      const partState = computed.get(part.id);
      if (!size || !partState || !partState.visible || partState.opacity <= 0) {
        continue;
      }
      if (this.hitTestRenderablePart(point, part, partState, size, computed, params, view.cssBaseMatrix)) {
        return part.id;
      }
    }
    return void 0;
  }
  hitTestRenderablePart(point, part, partState, size, computed, params, baseMatrix) {
    const left = -partState.pose.pivotX * size.width, top = -partState.pose.pivotY * size.height;
    const bounds = { left, top, width: size.width, height: size.height };
    const warp = this.resolveRenderableWarp(part, partState, size, computed);
    const artMesh = resolveArtMesh(part, size.width, size.height, params);
    const project = (x, y, u, v) => {
      const warped = hasWarpEffect(warp) ? warpPoint(x, y, bounds, warp) : { x, y };
      const rendered = projectSharedWarpPoint(warped, partState.matrix, baseMatrix, partState.sharedWarps);
      return { x: rendered.x, y: rendered.y, u, v };
    };
    let vertices = [], triangles = [];
    if (artMesh) {
      vertices = artMesh.vertices.map((vertex) => project(left + vertex.x, top + vertex.y, vertex.u, vertex.v));
      triangles = artMesh.triangles;
    } else {
      const columns = Math.max(1, Math.round(warp?.grid.columns ?? 1), ...partState.sharedWarps?.filter(hasSharedWarpFieldEffect).map((field) => field.grid.columns) ?? []);
      const rows = Math.max(1, Math.round(warp?.grid.rows ?? 1), ...partState.sharedWarps?.filter(hasSharedWarpFieldEffect).map((field) => field.grid.rows) ?? []);
      for (let row = 0; row <= rows; row += 1) for (let column = 0; column <= columns; column += 1) {
        const u = column / columns, v = row / rows;
        vertices.push(project(left + u * size.width, top + v * size.height, u, v));
      }
      const stride = columns + 1;
      for (let row = 0; row < rows; row += 1) for (let column = 0; column < columns; column += 1) {
        const a = row * stride + column, b = a + 1, d = a + stride, c = d + 1;
        triangles.push(a, b, c, a, c, d);
      }
    }
    const mask = part.assetId ? this.alphaMasks.get(part.assetId) : void 0;
    const threshold = part.artMesh?.generator.alphaThreshold ?? 8;
    for (let index = 0; index < triangles.length; index += 3) {
      const a = vertices[triangles[index]], b = vertices[triangles[index + 1]], c = vertices[triangles[index + 2]];
      if (!a || !b || !c) continue;
      const uv = triangleUvAtPoint(point, [a, b, c]);
      if (uv && alphaMaskHit(mask, uv, threshold)) return true;
    }
    return false;
  }
  clientPointToParentSpace(canvas, params, partId, clientX, clientY, options = {}) {
    const part = this.rig.parts.find((entry) => entry.id === partId);
    if (!part) {
      return void 0;
    }
    const view = this.getCanvasView(canvas, options);
    const point = this.cssPointFromClient(canvas, clientX, clientY);
    const computed = this.computePartStates(params, /* @__PURE__ */ new Map(), view.cssBaseMatrix);
    const partState = computed.get(part.id);
    const parentMatrix = partState?.parentMatrix ?? (part.parentId ? computed.get(part.parentId)?.matrix ?? view.cssBaseMatrix : view.cssBaseMatrix);
    const parentPoint = point.matrixTransform(domMatrixFromMatrix(parentMatrix).inverse());
    return { x: parentPoint.x, y: parentPoint.y };
  }
  hitTestWarpPin(canvas, params, deformerId, clientX, clientY, options = {}) {
    const point = this.cssPointFromClient(canvas, clientX, clientY);
    const handles = this.getWarpPinHandles(canvas, params, deformerId, options);
    const useOffsetTarget = options.warpPinEditMode === "offset";
    return handles.slice().reverse().find((handle) => {
      const x = useOffsetTarget ? handle.targetX : handle.x;
      const y = useOffsetTarget ? handle.targetY : handle.y;
      return Math.hypot(x - point.x, y - point.y) <= Math.max(10, Math.min(18, handle.radiusPx * 0.4));
    });
  }
  clientPointToPartLocal(canvas, params, partId, clientX, clientY, options = {}) {
    const part = this.rig.parts.find((entry) => entry.id === partId);
    if (!part) {
      return void 0;
    }
    const view = this.getCanvasView(canvas, options);
    const point = this.cssPointFromClient(canvas, clientX, clientY);
    const computed = this.computePartStates(params, /* @__PURE__ */ new Map(), view.cssBaseMatrix);
    const partState = computed.get(part.id);
    if (!partState) {
      return void 0;
    }
    const localPoint = unprojectSharedWarpPoint({ x: point.x, y: point.y }, partState.matrix, view.cssBaseMatrix, partState.sharedWarps);
    return { x: localPoint.x, y: localPoint.y };
  }
  clientPointToWarpPinUv(canvas, params, partId, clientX, clientY, options = {}) {
    const part = this.rig.parts.find((entry) => entry.id === partId);
    const size = part ? this.partSize(part) : void 0;
    if (!part || !size) {
      return void 0;
    }
    const view = this.getCanvasView(canvas, options);
    const point = this.cssPointFromClient(canvas, clientX, clientY);
    const computed = this.computePartStates(params, /* @__PURE__ */ new Map(), view.cssBaseMatrix);
    const partState = computed.get(part.id);
    if (!partState) {
      return void 0;
    }
    const localPoint = unprojectSharedWarpPoint({ x: point.x, y: point.y }, partState.matrix, view.cssBaseMatrix, partState.sharedWarps);
    const left = -partState.pose.pivotX * size.width;
    const top = -partState.pose.pivotY * size.height;
    return {
      u: clamp014((localPoint.x - left) / Math.max(1e-3, size.width)),
      v: clamp014((localPoint.y - top) / Math.max(1e-3, size.height))
    };
  }
  clientPointToPartUv(canvas, params, partId, clientX, clientY, options = {}) {
    return this.clientPointToWarpPinUv(canvas, params, partId, clientX, clientY, options);
  }
  getWarpPinHandles(canvas, params, deformerId, options = {}) {
    const view = this.getCanvasView(canvas, options);
    return this.collectWarpPinHandles(params, deformerId, view.cssBaseMatrix, options.selectedPartId);
  }
  getArtMeshVertexHandles(canvas, params, partId, options = {}) {
    const part = this.rig.parts.find((entry) => entry.id === partId);
    const size = part ? this.partSize(part) : void 0;
    if (!part || !size) return [];
    const view = this.getCanvasView(canvas, options);
    const computed = this.computePartStates(params, /* @__PURE__ */ new Map(), view.cssBaseMatrix);
    const partState = computed.get(part.id);
    const mesh = resolveArtMesh(part, size.width, size.height, params);
    if (!partState || !partState.visible || partState.opacity <= 0 || !mesh) return [];
    const left = -partState.pose.pivotX * size.width;
    const top = -partState.pose.pivotY * size.height;
    const warp = this.resolveRenderableWarp(part, partState, size, computed);
    const bounds = { left, top, width: size.width, height: size.height };
    return mesh.vertices.map((vertex, vertexIndex) => {
      const localX = left + vertex.x;
      const localY = top + vertex.y;
      const warped = hasWarpEffect(warp) ? warpPoint(localX, localY, bounds, warp) : { x: localX, y: localY };
      const projected = projectSharedWarpPoint(warped, partState.matrix, view.cssBaseMatrix, partState.sharedWarps);
      return {
        partId: part.id,
        vertexIndex,
        vertexId: vertex.id,
        x: projected.x,
        y: projected.y,
        localX,
        localY,
        u: vertex.u,
        v: vertex.v
      };
    });
  }
  hitTestArtMeshVertex(canvas, params, partId, clientX, clientY, options = {}) {
    const point = this.cssPointFromClient(canvas, clientX, clientY);
    return this.getArtMeshVertexHandles(canvas, params, partId, options).slice().reverse().find((handle) => Math.hypot(handle.x - point.x, handle.y - point.y) <= 10);
  }
  getSharedWarpHandles(canvas, deformerId, options = {}) {
    const deformer = (this.rig.deformers ?? []).find((entry) => entry.id === deformerId);
    if (!deformer?.sharedWarp) return [];
    const field = normalizeSharedWarpField(deformer.sharedWarp);
    const view = this.getCanvasView(canvas, options);
    return field.controlPoints.map((point, pointIndex) => {
      const stageX = field.bounds.left + point.column / field.grid.columns * field.bounds.width;
      const stageY = field.bounds.top + point.row / field.grid.rows * field.bounds.height;
      const rendered = transformMatrixPoint(view.cssBaseMatrix, stageX + point.offsetX, stageY + point.offsetY);
      return { deformerId, pointIndex, pointId: point.id, x: rendered.x, y: rendered.y, offsetX: point.offsetX, offsetY: point.offsetY, enabled: field.enabled && point.enabled !== false };
    });
  }
  clientPointToStage(canvas, clientX, clientY, options = {}) {
    const view = this.getCanvasView(canvas, options);
    const point = this.cssPointFromClient(canvas, clientX, clientY);
    return transformMatrixPoint(invertMatrix(view.cssBaseMatrix), point.x, point.y);
  }
  hitTestSharedWarpHandle(canvas, deformerId, clientX, clientY, options = {}) {
    const point = this.cssPointFromClient(canvas, clientX, clientY);
    return this.getSharedWarpHandles(canvas, deformerId, options).slice().reverse().find((handle) => Math.hypot(handle.x - point.x, handle.y - point.y) <= 14);
  }
  getGlueSeamHandles(canvas, params, options = {}) {
    const view = this.getCanvasView(canvas, options);
    const computed = this.computePartStates(params, /* @__PURE__ */ new Map(), view.cssBaseMatrix);
    return this.collectGlueSeamHandles(computed);
  }
  hitTestGlueSeamPoint(canvas, params, clientX, clientY, options = {}) {
    const point = this.cssPointFromClient(canvas, clientX, clientY);
    let best;
    let bestDistance = Infinity;
    for (const handle of this.getGlueSeamHandles(canvas, params, options)) {
      const distance = Math.hypot(handle.x - point.x, handle.y - point.y);
      const hitRadius = Math.max(9, Math.min(18, handle.radiusPx * 0.28));
      if (distance <= hitRadius && distance < bestDistance) {
        best = handle;
        bestDistance = distance;
      }
    }
    return best;
  }
  drawGlueOverlay(ctx, computed, view) {
    const glues = readRigGlue(this.rig).filter((glue) => glue.enabled && glue.status !== "disabled" && glue.debugVisible !== false).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
    if (!glues.length) {
      return;
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${Math.max(10, 11 * view.dpr)}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (const glue of glues) {
      const partA = this.rig.parts.find((part) => part.id === glue.partAId);
      const partB = this.rig.parts.find((part) => part.id === glue.partBId);
      const stateA = partA ? computed.get(partA.id) : void 0;
      const stateB = partB ? computed.get(partB.id) : void 0;
      const sizeA = partA ? this.partSize(partA) : void 0;
      const sizeB = partB ? this.partSize(partB) : void 0;
      if (!partA || !partB || !stateA || !stateB || !sizeA || !sizeB || !stateA.visible || !stateB.visible) {
        continue;
      }
      const active2 = glue.status === "active";
      const alpha = Math.max(0.18, Math.min(0.82, glue.strength));
      const strokeColor = active2 ? "rgba(94, 234, 212, 0.92)" : "rgba(255, 214, 102, 0.82)";
      const fillColor = active2 ? "rgba(11, 68, 71, 0.88)" : "rgba(72, 55, 12, 0.84)";
      const labelColor = active2 ? "#9ff8ee" : "#ffe4a3";
      const seamPoints = glue.seamPoints?.length ? glue.seamPoints.map((point) => ({ a: point.a, b: point.b, radius: point.radius, strength: point.strength })) : [{ a: { u: 0.5, v: 0.5 }, b: { u: 0.5, v: 0.5 }, radius: void 0, strength: void 0 }];
      const labelPoints = [];
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = strokeColor;
      ctx.fillStyle = fillColor;
      ctx.lineWidth = Math.max(1.2, 2.1 * view.dpr);
      ctx.setLineDash(active2 ? [] : [5 * view.dpr, 4 * view.dpr]);
      seamPoints.forEach((point, index) => {
        const pointA = this.glueUvPoint(stateA, sizeA.width, sizeA.height, point.a.u, point.a.v);
        const pointB = this.glueUvPoint(stateB, sizeB.width, sizeB.height, point.b.u, point.b.v);
        labelPoints.push(pointA, pointB);
        ctx.beginPath();
        ctx.moveTo(pointA.x, pointA.y);
        ctx.lineTo(pointB.x, pointB.y);
        ctx.stroke();
        const radiusA = this.glueRadiusPx(stateA, sizeA.width, sizeA.height, point.radius, point.strength ?? glue.strength);
        const radiusB = this.glueRadiusPx(stateB, sizeB.width, sizeB.height, point.radius, point.strength ?? glue.strength);
        ctx.save();
        ctx.globalAlpha = Math.min(0.32, alpha * 0.45);
        ctx.setLineDash([]);
        ctx.beginPath();
        ctx.arc(pointA.x, pointA.y, radiusA, 0, Math.PI * 2);
        ctx.arc(pointB.x, pointB.y, radiusB, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
        const dotRadius = Math.max(4.5, 5.2 * view.dpr);
        ctx.setLineDash([]);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = fillColor;
        ctx.strokeStyle = strokeColor;
        ctx.beginPath();
        ctx.arc(pointA.x, pointA.y, dotRadius, 0, Math.PI * 2);
        ctx.arc(pointB.x, pointB.y, dotRadius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = labelColor;
        ctx.font = `${Math.max(9, 10 * view.dpr)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.fillText(String(index + 1), pointA.x, pointA.y + 0.4 * view.dpr);
        ctx.fillText(String(index + 1), pointB.x, pointB.y + 0.4 * view.dpr);
        ctx.font = `${Math.max(10, 11 * view.dpr)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = strokeColor;
        ctx.setLineDash(active2 ? [] : [5 * view.dpr, 4 * view.dpr]);
      });
      ctx.setLineDash([]);
      const labelCenter = averageDomPoints(labelPoints);
      if (!labelCenter) {
        continue;
      }
      const label = glue.region ?? glue.mode;
      const labelWidth = Math.min(170 * view.dpr, Math.max(54 * view.dpr, ctx.measureText(label).width + 16 * view.dpr));
      const labelHeight = 18 * view.dpr;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgba(14, 18, 23, 0.84)";
      ctx.strokeStyle = active2 ? "rgba(94, 234, 212, 0.7)" : "rgba(255, 214, 102, 0.66)";
      ctx.lineWidth = Math.max(1, view.dpr);
      ctx.beginPath();
      ctx.roundRect(labelCenter.x - labelWidth / 2, labelCenter.y - labelHeight / 2, labelWidth, labelHeight, 5 * view.dpr);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = labelColor;
      ctx.fillText(label, labelCenter.x, labelCenter.y + 0.5 * view.dpr, labelWidth - 10 * view.dpr);
    }
    ctx.restore();
  }
  glueUvPoint(partState, width, height, u, v) {
    const localX = -partState.pose.pivotX * width + clamp014(u) * width;
    const localY = -partState.pose.pivotY * height + clamp014(v) * height;
    return new DOMPoint(localX, localY).matrixTransform(domMatrixFromMatrix(partState.matrix));
  }
  glueRadiusPx(partState, width, height, radius, strength) {
    const scaleX = Math.hypot(partState.matrix.a, partState.matrix.b);
    const scaleY = Math.hypot(partState.matrix.c, partState.matrix.d);
    const averageScale = Math.max(1e-3, (scaleX + scaleY) * 0.5);
    const normalizedRadius = Math.max(0.04, Math.min(0.7, radius ?? 0.16 + clamp014(strength) * 0.34));
    return Math.max(8, Math.min(90, Math.min(width, height) * normalizedRadius * averageScale));
  }
  glueAnchorPoint(partState, width, height) {
    return this.glueUvPoint(partState, width, height, 0.5, 0.5);
  }
  prepareClippingLayer(canvas, index) {
    let layer = this.clippingLayers[index];
    if (!layer) {
      layer = document.createElement("canvas");
      this.clippingLayers[index] = layer;
      this.clippingLayerAllocations += 1;
    }
    if (layer.width !== canvas.width || layer.height !== canvas.height) {
      layer.width = canvas.width;
      layer.height = canvas.height;
    } else {
      const context = layer.getContext("2d");
      context?.save();
      context?.setTransform(1, 0, 0, 1, 0, 0);
      context?.clearRect(0, 0, layer.width, layer.height);
      context?.restore();
    }
    return layer;
  }
  getClippingLayerAllocationCount() {
    return this.clippingLayerAllocations;
  }
  getWebGLMeshRenderer(enabled) {
    if (!enabled) return void 0;
    if (this.webglMeshRenderer) return this.webglMeshRenderer;
    try {
      this.webglMeshRenderer = new WebGLArtMeshRenderer();
      this.webglMeshError = void 0;
      return this.webglMeshRenderer;
    } catch (error) {
      this.webglMeshError = error instanceof Error ? error.message : String(error);
      return void 0;
    }
  }
  resolveTintedImage(partId, image, tint) {
    if (!tint || tint.mode !== "multiply" && tint.mode !== "screen" || !/^#[0-9a-fA-F]{6}$/.test(tint.color) || !Number.isFinite(tint.opacity) || tint.opacity <= 0) return image;
    const opacity = Math.min(1, Math.max(0, tint.opacity));
    if (opacity <= 0) return image;
    const key = `${partId}:${tint.mode}:${tint.color.toLowerCase()}:${opacity}`;
    const cached = this.tintedImages.get(key);
    if (cached) return cached;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d");
    if (!context || canvas.width <= 0 || canvas.height <= 0) return image;
    const tintLayer = document.createElement("canvas");
    tintLayer.width = canvas.width;
    tintLayer.height = canvas.height;
    const tintContext = tintLayer.getContext("2d");
    if (!tintContext) return image;
    tintContext.drawImage(image, 0, 0);
    tintContext.globalCompositeOperation = "source-in";
    tintContext.globalAlpha = 1;
    tintContext.fillStyle = tint.color;
    tintContext.fillRect(0, 0, tintLayer.width, tintLayer.height);
    tintContext.globalCompositeOperation = "source-over";
    context.drawImage(image, 0, 0);
    context.globalCompositeOperation = tint.mode === "multiply" ? "multiply" : "screen";
    context.globalAlpha = opacity;
    context.drawImage(tintLayer, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    this.tintedImages.set(key, canvas);
    return canvas;
  }
  resolveContourImage(part, source, width, height, params) {
    if (!part.contourShade || !validateContourShade(part.contourShade)) return source;
    const yawActive = (params[part.contourShade.yawParameter] ?? 0) !== 0 && (part.contourShade.strength > 0 || part.contourShade.farContourFade || part.contourShade.nearContourFade);
    const upActive = (params[part.contourShade.pitchParameter] ?? 0) < 0 && (part.contourShade.upContourFade || part.contourShade.upShadowStrength);
    if (!yawActive && !upActive) return source;
    const key = JSON.stringify(part.contourShade);
    let entry = this.contourImages.get(part.id);
    if (!entry || entry.source !== source || entry.key !== key) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.drawImage(source, 0, 0, width, height);
      const pixels2 = context.getImageData(0, 0, width, height);
      entry = { source, key, canvas, processor: new ContourShadeProcessor(pixels2, part.contourShade) };
      this.contourImages.set(part.id, entry);
    }
    const pixels = entry.processor.render(params);
    if (pixels !== entry.last) {
      const context = entry.canvas.getContext("2d");
      const frame = context.createImageData(width, height);
      frame.data.set(pixels.data);
      context.putImageData(frame, 0, 0);
      entry.last = pixels;
    }
    return entry.canvas;
  }
  resolveRevealImage(part, source, width, height, params) {
    if (!part.alphaReveal || !validateAlphaReveal(part.alphaReveal)) return source;
    if ((params[part.alphaReveal.parameter] ?? part.alphaReveal.open) >= part.alphaReveal.open) return source;
    const key = JSON.stringify(part.alphaReveal);
    let entry = this.revealImages.get(part.id);
    if (!entry || entry.source !== source || entry.key !== key || source instanceof HTMLCanvasElement && part.contourShade) {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.drawImage(source, 0, 0, width, height);
      entry = { source, key, canvas, processor: new AlphaRevealProcessor(context.getImageData(0, 0, width, height), part.alphaReveal) };
      this.revealImages.set(part.id, entry);
    }
    const pixels = entry.processor.render(params);
    if (pixels !== entry.last) {
      const context = entry.canvas.getContext("2d");
      const frame = context.createImageData(width, height);
      frame.data.set(pixels.data);
      context.putImageData(frame, 0, 0);
      entry.last = pixels;
    }
    return entry.canvas;
  }
  drawRenderablePart(ctx, part, computed, params, baseMatrix, ignoreVisualAlpha = false, webglMeshRenderer, skinningTransforms, glueStitch, opacityScale = 1, modeOverride, onBounds) {
    const size = this.partSize(part);
    const partState = computed.get(part.id);
    if (!size || !partState || !ignoreVisualAlpha && (!partState.visible || partState.opacity <= 0)) {
      return;
    }
    ctx.save();
    ctx.setTransform(partState.matrix.a, partState.matrix.b, partState.matrix.c, partState.matrix.d, partState.matrix.e, partState.matrix.f);
    ctx.globalAlpha = ignoreVisualAlpha ? 1 : Math.min(1, Math.max(0, partState.opacity * opacityScale));
    ctx.globalCompositeOperation = ignoreVisualAlpha ? "source-over" : canvasBlendMode(modeOverride ?? part.blendMode);
    const tintedImage = this.resolveTintedImage(part.id, size.image, part.tint);
    const coloredImage = ignoreVisualAlpha ? tintedImage : this.resolveContourImage(part, tintedImage, size.width, size.height, params);
    const sourceImage = this.resolveRevealImage(part, coloredImage, size.width, size.height, params);
    const left = -partState.pose.pivotX * size.width;
    const top = -partState.pose.pivotY * size.height;
    const warp = this.resolveRenderableWarp(part, partState, size, computed);
    const baseArtMesh = resolveArtMesh(part, size.width, size.height, params);
    const artMesh = baseArtMesh && part.artMesh?.skinning ? { ...baseArtMesh, vertices: applySkinningToVertices(baseArtMesh.vertices, part.artMesh.skinning, skinningTransforms) } : baseArtMesh;
    const sharedWarps = partState.sharedWarps;
    const stitchOffsets = localStitchOffsets(glueStitch?.get(part.id), partState.matrix);
    const hasSharedWarp = Boolean(sharedWarps?.some(hasSharedWarpFieldEffect));
    const sharedProject = hasSharedWarp ? createSharedWarpProjector(partState.matrix, baseMatrix, sharedWarps) : void 0;
    const inversePartMatrix = hasSharedWarp ? invertMatrix(partState.matrix) : void 0;
    const project = hasSharedWarp ? (point) => {
      const rendered = sharedProject(point);
      return transformMatrixPoint(inversePartMatrix, rendered.x, rendered.y);
    } : void 0;
    const sharedGrid = hasSharedWarp ? {
      columns: Math.max(1, ...(sharedWarps ?? []).filter(hasSharedWarpFieldEffect).map((field) => field.grid.columns)),
      rows: Math.max(1, ...(sharedWarps ?? []).filter(hasSharedWarpFieldEffect).map((field) => field.grid.rows))
    } : void 0;
    const geometry = webglMeshRenderer || onBounds ? buildWebGLPartGeometry({ left, top, width: size.width, height: size.height, matrix: partState.matrix, mesh: artMesh, warp, project, sharedGrid, stitchOffsets }) : void 0;
    if (onBounds && geometry?.vertices.length) {
      const xs = geometry.vertices.map((p) => p.x), ys = geometry.vertices.map((p) => p.y), x = Math.floor(Math.min(...xs)) - 2, y = Math.floor(Math.min(...ys)) - 2;
      onBounds({ x, y, width: Math.ceil(Math.max(...xs)) + 2 - x, height: Math.ceil(Math.max(...ys)) + 2 - y });
    }
    if (webglMeshRenderer && geometry) {
      if (webglMeshRenderer.draw(ctx, sourceImage, geometry.vertices, geometry.triangles, ctx.globalAlpha, ctx.globalCompositeOperation)) {
        drawArtPathsCanvas(ctx, part, params, size.width, size.height, left, top, warp, project);
        ctx.restore();
        return;
      }
    }
    if (artMesh) {
      drawArtMesh(ctx, sourceImage, left, top, size.width, size.height, artMesh, warp, project, stitchOffsets);
    } else if (hasWarpEffect(warp) || hasSharedWarp) {
      drawWarpedImage(ctx, sourceImage, left, top, size.width, size.height, warp, project, sharedGrid);
    } else {
      ctx.drawImage(sourceImage, left, top, size.width, size.height);
    }
    drawArtPathsCanvas(ctx, part, params, size.width, size.height, left, top, warp, project);
    ctx.restore();
  }
  /** Screen position of one ArtMesh vertex, matching the draw path exactly. */
  projectGlueVertex(partId, vertexId, computed, params, baseMatrix, skinningTransforms) {
    const part = this.rig.parts.find((entry) => entry.id === partId);
    const partState = part ? computed.get(part.id) : void 0;
    const size = part ? this.partSize(part) : void 0;
    if (!part || !partState || !size || !partState.visible || partState.opacity <= 0) {
      return void 0;
    }
    const baseArtMesh = resolveArtMesh(part, size.width, size.height, params);
    if (!baseArtMesh) {
      return void 0;
    }
    const vertices = part.artMesh?.skinning ? applySkinningToVertices(baseArtMesh.vertices, part.artMesh.skinning, skinningTransforms) : baseArtMesh.vertices;
    const vertex = vertices.find((entry) => entry.id === vertexId);
    if (!vertex) {
      return void 0;
    }
    return projectArtMeshVertex(vertex, {
      pose: partState.pose,
      matrix: partState.matrix,
      baseMatrix,
      sharedWarps: partState.sharedWarps,
      warp: this.resolveRenderableWarp(part, partState, size, computed),
      sourceWidth: size.width,
      sourceHeight: size.height
    });
  }
  drawPartDebug(ctx, part, computed, view, options) {
    const size = this.partSize(part);
    const partState = computed.get(part.id);
    const isSelected = part.id === options.selectedPartId;
    if (!size || !partState || !options.showBounds && !isSelected) {
      return;
    }
    ctx.save();
    ctx.setTransform(partState.matrix.a, partState.matrix.b, partState.matrix.c, partState.matrix.d, partState.matrix.e, partState.matrix.f);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.lineWidth = (isSelected ? 2 : 1) / view.fittedScale;
    ctx.strokeStyle = isSelected ? "rgba(255, 202, 91, 0.96)" : "rgba(35, 190, 210, 0.88)";
    ctx.strokeRect(-partState.pose.pivotX * size.width, -partState.pose.pivotY * size.height, size.width, size.height);
    if (isSelected) {
      const radius = 4 / view.fittedScale;
      ctx.fillStyle = "rgba(255, 202, 91, 0.96)";
      ctx.beginPath();
      ctx.arc(0, 0, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
  resolveRenderableWarp(part, partState, size, computed) {
    return resolveGlueWarpForPart(this.rig, part, partState, size, computed, (entry) => {
      const partSize = this.partSize(entry);
      return partSize ? { width: partSize.width, height: partSize.height } : void 0;
    });
  }
  drawArtMeshOverlay(ctx, params, view, options) {
    if (!options.selectedPartId || options.selectedArtMeshVertexIndex === void 0) return;
    const part = this.rig.parts.find((entry) => entry.id === options.selectedPartId);
    if (!part?.artMesh?.enabled) return;
    const handles = this.getArtMeshVertexHandles(ctx.canvas, params, part.id, options);
    if (!handles.length) return;
    ctx.save();
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "rgba(56, 189, 248, 0.64)";
    ctx.lineWidth = 1;
    for (let index = 0; index < part.artMesh.triangles.length; index += 3) {
      const a = handles[part.artMesh.triangles[index]];
      const b = handles[part.artMesh.triangles[index + 1]];
      const c = handles[part.artMesh.triangles[index + 2]];
      if (!a || !b || !c) continue;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.stroke();
    }
    handles.forEach((handle) => {
      const selected = handle.vertexIndex === options.selectedArtMeshVertexIndex;
      const radius = selected ? 6 : 4;
      if (selected) {
        ctx.fillStyle = "rgba(251, 191, 36, 0.2)";
        ctx.strokeStyle = "rgba(251, 191, 36, 0.96)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, radius + 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.fillStyle = selected ? "rgba(251, 191, 36, 0.98)" : "rgba(14, 116, 144, 0.94)";
      ctx.strokeStyle = selected ? "rgba(255, 251, 235, 0.98)" : "rgba(224, 242, 254, 0.94)";
      ctx.lineWidth = selected ? 2 : 1.25;
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    });
    ctx.restore();
  }
  drawWarpPinOverlay(ctx, params, view, options) {
    if (!options.selectedDeformerId) {
      return;
    }
    const handles = this.collectWarpPinHandles(params, options.selectedDeformerId, view.cssBaseMatrix, options.selectedPartId);
    const sharedHandles = this.getSharedWarpHandles(ctx.canvas, options.selectedDeformerId, { fitPadding: 18 });
    const sharedDeformer = (this.rig.deformers ?? []).find((entry) => entry.id === options.selectedDeformerId);
    const sharedField = sharedDeformer?.sharedWarp ? normalizeSharedWarpField(sharedDeformer.sharedWarp) : void 0;
    if (!handles.length && !sharedHandles.length) {
      return;
    }
    ctx.save();
    ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    const offsetMode = options.warpPinEditMode === "offset";
    if (sharedField) {
      const origin = transformMatrixPoint(view.cssBaseMatrix, sharedField.bounds.left, sharedField.bounds.top);
      const far = transformMatrixPoint(view.cssBaseMatrix, sharedField.bounds.left + sharedField.bounds.width, sharedField.bounds.top + sharedField.bounds.height);
      ctx.save();
      ctx.globalAlpha = sharedField.enabled ? 0.7 : 0.28;
      ctx.strokeStyle = "rgba(129, 140, 248, 0.95)";
      ctx.fillStyle = "rgba(99, 102, 241, 0.07)";
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.fillRect(origin.x, origin.y, far.x - origin.x, far.y - origin.y);
      ctx.strokeRect(origin.x, origin.y, far.x - origin.x, far.y - origin.y);
      ctx.setLineDash([]);
      ctx.globalAlpha = sharedField.enabled ? 0.46 : 0.18;
      ctx.strokeStyle = "rgba(165, 180, 252, 0.9)";
      ctx.lineWidth = 1;
      for (let column = 1; column < sharedField.grid.columns; column += 1) {
        const x = origin.x + (far.x - origin.x) * column / sharedField.grid.columns;
        ctx.beginPath();
        ctx.moveTo(x, origin.y);
        ctx.lineTo(x, far.y);
        ctx.stroke();
      }
      for (let row = 1; row < sharedField.grid.rows; row += 1) {
        const y = origin.y + (far.y - origin.y) * row / sharedField.grid.rows;
        ctx.beginPath();
        ctx.moveTo(origin.x, y);
        ctx.lineTo(far.x, y);
        ctx.stroke();
      }
      ctx.restore();
    }
    for (const handle of handles) {
      const isSelected = handle.pinIndex === options.selectedWarpPinIndex;
      const radius = Math.max(7, Math.min(26, handle.radiusPx * (isSelected ? 0.34 : 0.28)));
      const fieldRadius = Math.max(radius + 2, Math.min(52, handle.radiusPx));
      const offsetLength = Math.hypot(handle.targetX - handle.x, handle.targetY - handle.y);
      ctx.globalAlpha = handle.enabled ? 1 : 0.45;
      if (offsetMode && (isSelected || offsetLength > 0.5)) {
        ctx.strokeStyle = isSelected ? "rgba(94, 234, 212, 0.88)" : "rgba(255, 214, 102, 0.54)";
        ctx.lineWidth = isSelected ? 2 : 1.2;
        ctx.beginPath();
        ctx.moveTo(handle.x, handle.y);
        ctx.lineTo(handle.targetX, handle.targetY);
        ctx.stroke();
      }
      if (isSelected) {
        const focusX = offsetMode ? handle.targetX : handle.x;
        const focusY = offsetMode ? handle.targetY : handle.y;
        ctx.fillStyle = "rgba(45, 212, 191, 0.16)";
        ctx.strokeStyle = "rgba(94, 234, 212, 0.92)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(focusX, focusY, radius + 6, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.strokeStyle = isSelected ? "rgba(94, 234, 212, 0.98)" : handle.enabled ? "rgba(255, 214, 102, 0.95)" : "rgba(150, 160, 170, 0.82)";
      ctx.fillStyle = isSelected && !offsetMode ? "rgba(12, 74, 80, 0.92)" : handle.enabled ? "rgba(24, 28, 34, 0.88)" : "rgba(24, 28, 34, 0.58)";
      ctx.lineWidth = isSelected && !offsetMode ? 2.2 : 1.5;
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, radius, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = isSelected && !offsetMode ? "#7fffea" : handle.enabled ? "#ffd666" : "#9aa4af";
      ctx.fillText(String(handle.pinIndex + 1), handle.x, handle.y + 0.5);
      if (offsetMode) {
        const targetRadius = Math.max(6, radius * (isSelected ? 0.82 : 0.68));
        ctx.globalAlpha = handle.enabled ? 1 : 0.45;
        ctx.fillStyle = isSelected ? "rgba(12, 74, 80, 0.94)" : "rgba(24, 28, 34, 0.78)";
        ctx.strokeStyle = isSelected ? "rgba(94, 234, 212, 0.98)" : "rgba(255, 214, 102, 0.7)";
        ctx.lineWidth = isSelected ? 2.2 : 1.3;
        ctx.beginPath();
        ctx.rect(handle.targetX - targetRadius, handle.targetY - targetRadius, targetRadius * 2, targetRadius * 2);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = isSelected ? "#7fffea" : "#ffd666";
        ctx.fillText("O", handle.targetX, handle.targetY + 0.5);
      }
      ctx.globalAlpha = handle.enabled ? isSelected ? 0.38 : 0.22 : 0.12;
      ctx.strokeStyle = isSelected ? "rgba(94, 234, 212, 0.72)" : handle.enabled ? "rgba(255, 214, 102, 0.95)" : "rgba(150, 160, 170, 0.82)";
      ctx.lineWidth = isSelected ? 2 : 1.5;
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, fieldRadius, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const handle of sharedHandles) {
      ctx.globalAlpha = handle.enabled ? 0.96 : 0.42;
      ctx.fillStyle = "rgba(99, 102, 241, 0.86)";
      ctx.strokeStyle = "rgba(224, 231, 255, 0.96)";
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.rect(handle.x - 6, handle.y - 6, 12, 12);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#ffffff";
      ctx.fillText(String(handle.pointIndex + 1), handle.x, handle.y + 0.5);
    }
    ctx.restore();
  }
  collectGlueSeamHandles(computed) {
    const handles = [];
    const glues = readRigGlue(this.rig).filter((glue) => glue.enabled && glue.status !== "disabled" && glue.debugVisible !== false && glue.seamPoints?.length).sort((left, right) => right.priority - left.priority || left.id.localeCompare(right.id));
    for (const glue of glues) {
      const partA = this.rig.parts.find((part) => part.id === glue.partAId);
      const partB = this.rig.parts.find((part) => part.id === glue.partBId);
      const stateA = partA ? computed.get(partA.id) : void 0;
      const stateB = partB ? computed.get(partB.id) : void 0;
      const sizeA = partA ? this.partSize(partA) : void 0;
      const sizeB = partB ? this.partSize(partB) : void 0;
      if (!partA || !partB || !stateA || !stateB || !sizeA || !sizeB || !stateA.visible || !stateB.visible) {
        continue;
      }
      glue.seamPoints?.forEach((point, seamIndex) => {
        handles.push(this.glueSeamHandleForPoint(glue, seamIndex, "a", partA, stateA, sizeA.width, sizeA.height, point.a.u, point.a.v, point.radius, point.strength));
        handles.push(this.glueSeamHandleForPoint(glue, seamIndex, "b", partB, stateB, sizeB.width, sizeB.height, point.b.u, point.b.v, point.radius, point.strength));
      });
    }
    return handles;
  }
  glueSeamHandleForPoint(glue, seamIndex, side, part, partState, width, height, u, v, radius, strength) {
    const point = this.glueUvPoint(partState, width, height, u, v);
    const handleStrength = strength ?? glue.strength;
    return {
      glueId: glue.id,
      glueName: glue.name,
      seamIndex,
      side,
      partId: part.id,
      partName: part.name,
      x: point.x,
      y: point.y,
      u,
      v,
      radiusPx: this.glueRadiusPx(partState, width, height, radius, handleStrength),
      strength: handleStrength,
      enabled: glue.enabled && glue.status !== "disabled"
    };
  }
  collectWarpPinHandles(params, deformerId, baseMatrix, selectedPartId) {
    const deformer = (this.rig.deformers ?? []).find((entry) => entry.id === deformerId);
    if (!deformer || deformer.kind !== "warp") {
      return [];
    }
    const warp = normalizeWarpDeformer(deformer.warp);
    const pins = warp.pins ?? [];
    if (!warp.enabled || !pins.length) {
      return [];
    }
    const targetParts = this.imagePartsForDeformer(deformer);
    const selectedPart = selectedPartId ? targetParts.find((part) => part.id === selectedPartId) : void 0;
    const parts = selectedPart ? [selectedPart] : targetParts.slice(0, 1);
    if (!parts.length) {
      return [];
    }
    const computed = this.computePartStates(params, /* @__PURE__ */ new Map(), baseMatrix);
    const handles = [];
    for (const part of parts) {
      const size = this.partSize(part);
      const partState = computed.get(part.id);
      if (!size || !partState || !partState.visible || partState.opacity <= 0) {
        continue;
      }
      const left = -partState.pose.pivotX * size.width;
      const top = -partState.pose.pivotY * size.height;
      const scaleX = Math.hypot(partState.matrix.a, partState.matrix.b);
      const scaleY = Math.hypot(partState.matrix.c, partState.matrix.d);
      const radiusBase = Math.max(6, Math.min(size.width * scaleX, size.height * scaleY));
      pins.forEach((pin, pinIndex) => {
        const localX = left + pin.u * size.width;
        const localY = top + pin.v * size.height;
        const point = projectSharedWarpPoint({ x: localX, y: localY }, partState.matrix, baseMatrix, partState.sharedWarps);
        const targetPoint = projectSharedWarpPoint({ x: localX + pin.offsetX, y: localY + pin.offsetY }, partState.matrix, baseMatrix, partState.sharedWarps);
        handles.push({
          deformerId,
          partId: part.id,
          pinIndex,
          pinId: pin.id,
          name: pin.name,
          x: point.x,
          y: point.y,
          radiusPx: Math.max(6, Math.min(64, pin.radius * radiusBase)),
          targetX: targetPoint.x,
          targetY: targetPoint.y,
          offsetX: pin.offsetX,
          offsetY: pin.offsetY,
          u: pin.u,
          v: pin.v,
          enabled: pin.enabled !== false
        });
      });
    }
    return handles;
  }
  imagePartsForDeformer(deformer) {
    const targetIds = new Set(deformer.targetPartIds ?? []);
    const directParts = this.rig.parts.filter((part) => part.deformerId === deformer.id || targetIds.has(part.id));
    const childrenByParent = /* @__PURE__ */ new Map();
    for (const part of this.rig.parts) {
      const children = childrenByParent.get(part.parentId) ?? [];
      children.push(part);
      childrenByParent.set(part.parentId, children);
    }
    const images = [];
    const seen = /* @__PURE__ */ new Set();
    const visit = (part) => {
      if (seen.has(part.id)) {
        return;
      }
      seen.add(part.id);
      if (part.kind === "image" && part.assetId) {
        images.push(part);
      }
      for (const child of childrenByParent.get(part.id) ?? []) {
        visit(child);
      }
    };
    directParts.forEach(visit);
    return images.sort((left, right) => left.drawOrder - right.drawOrder);
  }
  async loadAsset(asset) {
    const image = new Image();
    image.decoding = "async";
    image.src = asset.src;
    try {
      await image.decode();
    } catch {
      throw new Error(`\u753B\u50CF\u3092\u8AAD\u307F\u8FBC\u3081\u307E\u305B\u3093: ${asset.name} (${asset.id})`);
    }
    this.images.set(asset.id, image);
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (width > 0 && height > 0) {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        context?.drawImage(image, 0, 0, width, height);
        const rgba = context?.getImageData(0, 0, width, height).data;
        if (rgba) {
          const alpha = new Uint8Array(width * height);
          for (let index = 0; index < alpha.length; index += 1) alpha[index] = rgba[index * 4 + 3];
          this.alphaMasks.set(asset.id, { width, height, alpha });
        }
      } catch (_error) {
      }
    }
  }
  getCanvasView(canvas, options) {
    const rect = canvas.getBoundingClientRect();
    const cssWidth = Math.max(1, rect.width || this.rig.stage.width);
    const cssHeight = Math.max(1, rect.height || this.rig.stage.height);
    const dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 3));
    const pixelWidth = Math.round(cssWidth * dpr);
    const pixelHeight = Math.round(cssHeight * dpr);
    const padding = options.fitPadding ?? 18;
    const availableWidth = Math.max(1, cssWidth - padding * 2);
    const availableHeight = Math.max(1, cssHeight - padding * 2);
    const scale = Math.min(availableWidth / this.rig.stage.width, availableHeight / this.rig.stage.height);
    const canvasZoom = Number(canvas.dataset.codexPreviewZoom ?? Number.NaN);
    const requestedZoom = options.zoom ?? canvasZoom;
    const zoom = Number.isFinite(requestedZoom) ? Math.min(3, Math.max(0.5, requestedZoom)) : 1;
    const fittedScale = Math.max(MIN_SCALE2, scale * zoom);
    const canvasPanX = Number(canvas.dataset.codexPreviewPanX ?? Number.NaN);
    const canvasPanY = Number(canvas.dataset.codexPreviewPanY ?? Number.NaN);
    const requestedPanX = options.panX ?? canvasPanX;
    const requestedPanY = options.panY ?? canvasPanY;
    const panX = Number.isFinite(requestedPanX) ? Math.max(-cssWidth * 2, Math.min(cssWidth * 2, requestedPanX)) : 0;
    const panY = Number.isFinite(requestedPanY) ? Math.max(-cssHeight * 2, Math.min(cssHeight * 2, requestedPanY)) : 0;
    const offsetX = (cssWidth - this.rig.stage.width * fittedScale) / 2 + panX;
    const offsetY = (cssHeight - this.rig.stage.height * fittedScale) / 2 + panY;
    const cssBaseMatrix = multiplyMatrices(translateMatrix(offsetX, offsetY), scaleMatrix(fittedScale, fittedScale));
    const pixelBaseMatrix = multiplyMatrices(scaleMatrix(dpr, dpr), cssBaseMatrix);
    return {
      cssWidth,
      cssHeight,
      dpr,
      pixelWidth,
      pixelHeight,
      fittedScale,
      offsetX,
      offsetY,
      cssBaseMatrix,
      pixelBaseMatrix
    };
  }
  cssPointFromClient(canvas, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return new DOMPoint(clientX - rect.left, clientY - rect.top);
  }
  computePartStates(params, physicsOffsets, baseMatrix, physicsDeformerOffsets = /* @__PURE__ */ new Map()) {
    return evaluateRigParts(this.rig, params, baseMatrix, { physicsOffsets, physicsDeformerOffsets });
  }
  partSize(part) {
    if (!part.assetId) {
      return void 0;
    }
    const asset = this.rig.assets.find((entry) => entry.id === part.assetId);
    const image = this.images.get(part.assetId);
    if (!asset || !image) {
      return void 0;
    }
    return {
      image,
      width: asset.width ?? image.naturalWidth,
      height: asset.height ?? image.naturalHeight
    };
  }
  resolvePhysicsOffsets(params, dt, timeSeconds) {
    return resolvePhysicsFrame(this.rig, params, this.physicsState, dt, timeSeconds).partOffsets;
  }
};
function averageDomPoints(points) {
  if (!points.length) {
    return void 0;
  }
  const sum = points.reduce((total, point) => ({ x: total.x + point.x, y: total.y + point.y }), { x: 0, y: 0 });
  return new DOMPoint(sum.x / points.length, sum.y / points.length);
}
function domMatrixFromMatrix(matrix) {
  return new DOMMatrix([matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f]);
}
function drawArtPathsCanvas(ctx, part, values, width, height, left, top, warp, project) {
  const paths = readRigArtPaths(part);
  if (!paths.length) return;
  const bounds = { left, top, width, height };
  const baseAlpha = ctx.globalAlpha;
  for (const path of paths) {
    const resolved = resolveArtPath(path, values, width, height);
    if (!resolved) continue;
    const points = resolved.points.map((point) => {
      const local = { x: left + point.u * width, y: top + point.v * height };
      const warped = hasWarpEffect(warp) ? warpPoint(local.x, local.y, bounds, warp) : local;
      return project ? project(warped) : warped;
    });
    if (points.length < 2 || points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) continue;
    ctx.save();
    ctx.globalAlpha = baseAlpha * resolved.strokeColor[3] / 255;
    ctx.strokeStyle = `rgb(${resolved.strokeColor[0]} ${resolved.strokeColor[1]} ${resolved.strokeColor[2]})`;
    ctx.lineWidth = resolved.strokeWidth;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    if (resolved.curve === "smooth" && points.length > 2 && !resolved.closed) {
      for (let index = 1; index < points.length - 1; index += 1) {
        const current = points[index];
        const next = points[index + 1];
        const midpoint = { x: (current.x + next.x) / 2, y: (current.y + next.y) / 2 };
        ctx.quadraticCurveTo(current.x, current.y, midpoint.x, midpoint.y);
      }
      const last = points[points.length - 1];
      ctx.lineTo(last.x, last.y);
    } else {
      for (let index = 1; index < points.length; index += 1) ctx.lineTo(points[index].x, points[index].y);
    }
    if (resolved.closed) ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }
}
function localStitchOffsets(offsets, matrix) {
  if (!offsets?.size) {
    return void 0;
  }
  const local = /* @__PURE__ */ new Map();
  for (const [vertexId, offset] of offsets) {
    local.set(vertexId, glueStitchOffsetToLocal(offset, matrix));
  }
  return local;
}
function drawArtMesh(ctx, image, left, top, width, height, mesh, warp, project, stitchOffsets) {
  const bounds = { left, top, width, height };
  const imageWidth = image.naturalWidth || image.width || width;
  const imageHeight = image.naturalHeight || image.height || height;
  const projectedVertices = /* @__PURE__ */ new Map();
  const warpActive = hasWarpEffect(warp);
  const overlap = localCoverageOverlap(ctx.getTransform());
  for (let index = 0; index < mesh.triangles.length; index += 3) {
    const source = [mesh.vertices[mesh.triangles[index]], mesh.vertices[mesh.triangles[index + 1]], mesh.vertices[mesh.triangles[index + 2]]];
    if (source.some((vertex) => !vertex)) continue;
    const target = source.map((vertex, corner) => {
      const vertexIndex = mesh.triangles[index + corner];
      const cached = projectedVertices.get(vertexIndex);
      if (cached) return cached;
      const x = left + vertex.x;
      const y = top + vertex.y;
      const warped = warpActive ? warpPoint(x, y, bounds, warp) : { x, y };
      const projected = project ? project(warped) : warped;
      const offset = stitchOffsets?.get(vertex.id);
      const result = offset ? { x: projected.x + offset.dx, y: projected.y + offset.dy } : projected;
      projectedVertices.set(vertexIndex, result);
      return result;
    });
    const matrix = affineTriangleMatrix(
      source.map((vertex) => ({ x: vertex.u * imageWidth, y: vertex.v * imageHeight })),
      target
    );
    if (!matrix) continue;
    ctx.save();
    const coverage = expandTriangleForCoverage(target, overlap);
    ctx.beginPath();
    ctx.moveTo(coverage[0].x, coverage[0].y);
    ctx.lineTo(coverage[1].x, coverage[1].y);
    ctx.lineTo(coverage[2].x, coverage[2].y);
    ctx.closePath();
    ctx.clip();
    ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
    ctx.drawImage(image, 0, 0, imageWidth, imageHeight);
    ctx.restore();
  }
}
function affineTriangleMatrix(source, target) {
  const [s0, s1, s2] = source;
  const [t0, t1, t2] = target;
  const sx1 = s1.x - s0.x;
  const sy1 = s1.y - s0.y;
  const sx2 = s2.x - s0.x;
  const sy2 = s2.y - s0.y;
  const determinant = sx1 * sy2 - sy1 * sx2;
  if (Math.abs(determinant) < 1e-5) return void 0;
  const tx1 = t1.x - t0.x;
  const ty1 = t1.y - t0.y;
  const tx2 = t2.x - t0.x;
  const ty2 = t2.y - t0.y;
  const a = (tx1 * sy2 - tx2 * sy1) / determinant;
  const c = (sx1 * tx2 - sx2 * tx1) / determinant;
  const b = (ty1 * sy2 - ty2 * sy1) / determinant;
  const d = (sx1 * ty2 - sx2 * ty1) / determinant;
  return { a, b, c, d, e: t0.x - a * s0.x - c * s0.y, f: t0.y - b * s0.x - d * s0.y };
}
function drawWarpedImage(ctx, image, left, top, width, height, warp, project, sharedGrid) {
  const columns = Math.max(1, Math.round(warp?.grid.columns ?? 1), sharedGrid?.columns ?? 1);
  const rows = Math.max(1, Math.round(warp?.grid.rows ?? 1), sharedGrid?.rows ?? 1);
  const bounds = { left, top, width, height };
  const imageWidth = image.naturalWidth || image.width || width;
  const imageHeight = image.naturalHeight || image.height || height;
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x0 = left + width * column / columns;
      const x1 = left + width * (column + 1) / columns;
      const y0 = top + height * row / rows;
      const y1 = top + height * (row + 1) / rows;
      const p00 = project ? project(hasWarpEffect(warp) ? warpPoint(x0, y0, bounds, warp) : { x: x0, y: y0 }) : hasWarpEffect(warp) ? warpPoint(x0, y0, bounds, warp) : { x: x0, y: y0 };
      const p10 = project ? project(hasWarpEffect(warp) ? warpPoint(x1, y0, bounds, warp) : { x: x1, y: y0 }) : hasWarpEffect(warp) ? warpPoint(x1, y0, bounds, warp) : { x: x1, y: y0 };
      const p11 = project ? project(hasWarpEffect(warp) ? warpPoint(x1, y1, bounds, warp) : { x: x1, y: y1 }) : hasWarpEffect(warp) ? warpPoint(x1, y1, bounds, warp) : { x: x1, y: y1 };
      const p01 = project ? project(hasWarpEffect(warp) ? warpPoint(x0, y1, bounds, warp) : { x: x0, y: y1 }) : hasWarpEffect(warp) ? warpPoint(x0, y1, bounds, warp) : { x: x0, y: y1 };
      drawWarpedCell(ctx, image, { x0, y0, x1, y1, left, top, width, height, imageWidth, imageHeight }, p00, p10, p11, p01);
    }
  }
}
function drawWarpedCell(ctx, image, rect, p00, p10, p11, p01) {
  const sx0 = (rect.x0 - rect.left) / rect.width * rect.imageWidth;
  const sy0 = (rect.y0 - rect.top) / rect.height * rect.imageHeight;
  const sx1 = (rect.x1 - rect.left) / rect.width * rect.imageWidth;
  const sy1 = (rect.y1 - rect.top) / rect.height * rect.imageHeight;
  drawWarpedTriangle(ctx, image, rect.imageWidth, rect.imageHeight, [
    { x: sx0, y: sy0 },
    { x: sx1, y: sy0 },
    { x: sx1, y: sy1 }
  ], [p00, p10, p11]);
  drawWarpedTriangle(ctx, image, rect.imageWidth, rect.imageHeight, [
    { x: sx0, y: sy0 },
    { x: sx1, y: sy1 },
    { x: sx0, y: sy1 }
  ], [p00, p11, p01]);
}
function drawWarpedTriangle(ctx, image, imageWidth, imageHeight, source, target) {
  const matrix = affineTriangleMatrix(source, target);
  if (!matrix) return;
  ctx.save();
  const coverage = expandTriangleForCoverage(target, localCoverageOverlap(ctx.getTransform()));
  ctx.beginPath();
  ctx.moveTo(coverage[0].x, coverage[0].y);
  ctx.lineTo(coverage[1].x, coverage[1].y);
  ctx.lineTo(coverage[2].x, coverage[2].y);
  ctx.closePath();
  ctx.clip();
  ctx.transform(matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f);
  ctx.drawImage(image, 0, 0, imageWidth, imageHeight);
  ctx.restore();
}
function clamp014(value) {
  return Math.min(1, Math.max(0, value));
}
function drawChecker(ctx, width, height) {
  const size = 18;
  ctx.fillStyle = "#eef0f3";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#d8dde4";
  for (let y = 0; y < height; y += size) {
    for (let x = 0; x < width; x += size) {
      if ((x / size + y / size) % 2 === 0) {
        ctx.fillRect(x, y, size, size);
      }
    }
  }
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/modelingTarget.ts
function matchesPartTarget(part, target) {
  const hasRoles = Boolean(target.roles?.length);
  const hasIds = Boolean(target.partIds?.length);
  if (!hasRoles && !hasIds) return { matched: false };
  if (hasIds && !target.partIds.includes(part.id)) return { matched: false };
  if (hasRoles) {
    if (part.roleStatus !== "confirmed") return { matched: false, reason: part.role ? "role-not-confirmed" : "role-unassigned" };
    if (!part.role || !target.roles.includes(part.role)) return { matched: false };
  }
  return { matched: true };
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/warpKeyforms.ts
function keyformParameter(rig, parameter, input) {
  const definition = rig.parameters.find((p) => p.id === parameter);
  if (!definition || !Number.isFinite(input) || input < definition.min || input > definition.max) throw Error("invalid Warp keyform parameter/input");
  return definition;
}
function channel(point, parameter, property) {
  if ((point.bindings?.length ?? 0) > 16) throw Error("too many Warp point bindings");
  const bindings = point.bindings?.filter((b) => b.parameter === parameter && b.property === property) ?? [];
  if (bindings.length > 1 || bindings[0]?.additive === false || point.multiBindings?.some((b) => b.parameters.includes(parameter) && b.property === property)) throw Error("ambiguous/nonadditive Warp keyform");
  const binding = bindings[0];
  if (binding && (!binding.keys.length || new Set(binding.keys.map((k) => k.input)).size !== binding.keys.length || binding.keys.some((k) => !Number.isFinite(k.input) || !Number.isFinite(k.value)))) throw Error("invalid Warp keyform keys");
  return binding;
}
function sampleWarpKeyform(point, parameter, input) {
  const x = channel(point, parameter, "offsetX"), y = channel(point, parameter, "offsetY");
  return { x: x ? sampleBinding(x, input) : 0, y: y ? sampleBinding(y, input) : 0 };
}
function writeWarpKeyform(point, parameter, input, neutral, delta, previous) {
  for (const [property, axis] of [["offsetX", "x"], ["offsetY", "y"]]) {
    if (Math.abs(delta[axis] - previous[axis]) < 1e-9) continue;
    let binding = channel(point, parameter, property);
    const neutralValue = binding ? sampleBinding(binding, neutral) : 0;
    if (!binding) {
      point.bindings ??= [];
      if (point.bindings.length >= 16) throw Error("too many Warp point bindings");
      binding = { parameter, property, additive: true, keys: [] };
      point.bindings.push(binding);
    }
    if (input !== neutral && !binding.keys.some((k) => k.input === neutral)) binding.keys.push({ input: neutral, value: neutralValue });
    const key = binding.keys.find((k) => k.input === input);
    if (key) key.value = delta[axis];
    else binding.keys.push({ input, value: delta[axis] });
    binding.keys.sort((a, b) => a.input - b.input);
  }
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/deformBrush.ts
var finite3 = (v) => Number.isFinite(v);
function validateBrush(brush) {
  if (!brush || !Array.isArray(brush.center) || brush.center.length !== 2 || !brush.center.every(finite3) || !finite3(brush.radius) || brush.radius <= 0)
    throw Error("invalid brush center/radius");
  if (!Number.isInteger(brush.iterations) || brush.iterations < 1 || brush.iterations > 50 || !finite3(brush.maxDisplacement) || brush.maxDisplacement <= 0)
    throw Error("invalid brush iteration/displacement bound");
  if (!["linear", "smooth"].includes(brush.falloff))
    throw Error("invalid brush falloff");
  const effect = brush.effect;
  if (!effect || !["smooth", "relax", "inflate", "pinch", "bend", "contour-follow"].includes(effect.mode))
    throw Error("invalid brush effect");
  if ("strength" in effect && (!finite3(effect.strength) || effect.strength < 0 || effect.strength > 1))
    throw Error("brush strength must be in [0,1]");
  if (effect.mode === "inflate" && (!finite3(effect.distance) || effect.distance < 0))
    throw Error("inflate distance must be nonnegative");
  if (effect.mode === "bend" && (!finite3(effect.angle) || Math.abs(effect.angle) > 180))
    throw Error("bend angle must be within +/-180 degrees");
  if ("axis" in effect && (!Array.isArray(effect.axis) || effect.axis.length !== 2 || !effect.axis.every(finite3) || Math.hypot(...effect.axis) < 1e-8))
    throw Error("brush axis must be nonzero");
  if (effect.mode === "contour-follow" && (!Array.isArray(effect.guide) || effect.guide.length < 2 || effect.guide.length > 256 || effect.guide.some((p) => p.length !== 2 || !p.every(finite3)) || effect.vertexIds.length < 2 || new Set(effect.vertexIds).size !== effect.vertexIds.length))
    throw Error("contour-follow requires ordered unique vertices and a finite guide");
  if (!["base", "keyform", "blend-shape"].includes(brush.destination?.kind))
    throw Error("invalid brush destination");
}
function applyDeformBrush(graph, brush) {
  validateBrush(brush);
  const source = graph.points;
  if (!source.length || source.length > 1e4 || source.some((p) => ![p.x, p.y, p.referenceX, p.referenceY].every(finite3)) || new Set(source.map((p) => p.id)).size !== source.length)
    throw Error("invalid brush points");
  const ids = new Map(source.map((p, i) => [p.id, i]));
  const locked = /* @__PURE__ */ new Set([...graph.locked, ...brush.lockedIds ?? []]);
  if ([...locked].some((id) => !ids.has(id)))
    throw Error("unknown locked vertex");
  const neighbours = source.map(() => /* @__PURE__ */ new Set());
  for (const [a, b] of graph.edges) {
    if (!Number.isInteger(a) || !Number.isInteger(b) || !source[a] || !source[b] || a === b)
      throw Error("invalid brush adjacency");
    neighbours[a].add(b);
    neighbours[b].add(a);
  }
  const effect = brush.effect;
  if (effect.mode === "relax")
    for (const id of graph.boundary)
      locked.add(id);
  const contourTargets = /* @__PURE__ */ new Map();
  if (effect.mode === "contour-follow") {
    if (effect.vertexIds.some((id) => !ids.has(id) || !graph.boundary.has(id)))
      throw Error("contour vertices must belong to the boundary");
    for (let i = 1; i < effect.vertexIds.length; i++)
      if (!neighbours[ids.get(effect.vertexIds[i - 1])].has(ids.get(effect.vertexIds[i])))
        throw Error("contour vertices must follow connected edges");
    const lengths = (points2) => {
      const out = [0];
      for (let i = 1; i < points2.length; i++)
        out.push(out[i - 1] + Math.hypot(points2[i][0] - points2[i - 1][0], points2[i][1] - points2[i - 1][1]));
      return out;
    };
    const from = effect.vertexIds.map((id) => {
      const p = source[ids.get(id)];
      return [p.x, p.y];
    });
    const a = lengths(from), b = lengths(effect.guide);
    if (a.at(-1) <= 1e-8 || b.at(-1) <= 1e-8)
      throw Error("contour/guide has zero length");
    effect.vertexIds.forEach((id, i) => {
      const d = a[i] / a.at(-1) * b.at(-1);
      let k = 1;
      while (k < b.length - 1 && b[k] < d)
        k++;
      const t = (d - b[k - 1]) / (b[k] - b[k - 1] || 1);
      contourTargets.set(id, [effect.guide[k - 1][0] * (1 - t) + effect.guide[k][0] * t, effect.guide[k - 1][1] * (1 - t) + effect.guide[k][1] * t]);
    });
  }
  const weights = source.map((p) => {
    const f = Math.max(0, 1 - Math.hypot(p.x - brush.center[0], p.y - brush.center[1]) / brush.radius);
    return brush.falloff === "smooth" ? f * f * (3 - 2 * f) : f;
  });
  const clipped = /* @__PURE__ */ new Set();
  let points = source.map((p) => ({ ...p }));
  for (let pass = 0; pass < brush.iterations; pass++)
    points = points.map((p, i) => {
      const w = weights[i];
      if (!w || locked.has(p.id))
        return p;
      let dx = 0, dy = 0;
      if (effect.mode === "smooth" || effect.mode === "relax") {
        const adjacent = [...neighbours[i]];
        if (!adjacent.length)
          throw Error("brush requires connected neighbours");
        if (effect.mode === "smooth") {
          dx = adjacent.reduce((s, j) => s + points[j].x - points[j].referenceX, 0) / adjacent.length - (p.x - p.referenceX);
          dy = adjacent.reduce((s, j) => s + points[j].y - points[j].referenceY, 0) / adjacent.length - (p.y - p.referenceY);
        } else {
          dx = adjacent.reduce((s, j) => s + points[j].x, 0) / adjacent.length - p.x;
          dy = adjacent.reduce((s, j) => s + points[j].y, 0) / adjacent.length - p.y;
        }
        dx *= effect.strength;
        dy *= effect.strength;
      } else if (effect.mode === "inflate") {
        const x2 = p.x - brush.center[0], y2 = p.y - brush.center[1], n = Math.hypot(x2, y2);
        if (n > 1e-8) {
          dx = x2 / n * effect.distance / brush.iterations;
          dy = y2 / n * effect.distance / brush.iterations;
        }
      } else if (effect.mode === "pinch" || effect.mode === "bend") {
        const n = Math.hypot(...effect.axis), ax = effect.axis[0] / n, ay = effect.axis[1] / n;
        const x2 = p.x - brush.center[0], y2 = p.y - brush.center[1], along = x2 * ax + y2 * ay, across = -x2 * ay + y2 * ax;
        if (effect.mode === "pinch") {
          dx = ay * across * effect.strength / brush.iterations;
          dy = -ax * across * effect.strength / brush.iterations;
        } else {
          const angle = effect.angle * Math.PI / 180 / brush.iterations;
          if (Math.abs(angle) > 1e-8) {
            const radius = brush.radius / angle, t = along / radius;
            const a = Math.sin(t) * (radius - across), b = radius - Math.cos(t) * (radius - across);
            dx = (a - along) * ax - (b - across) * ay;
            dy = (a - along) * ay + (b - across) * ax;
          }
        }
      } else {
        const target = contourTargets.get(p.id);
        if (!target)
          return p;
        dx = (target[0] - p.x) * effect.strength;
        dy = (target[1] - p.y) * effect.strength;
      }
      let x = p.x + dx * w, y = p.y + dy * w;
      const distance = Math.hypot(x - source[i].x, y - source[i].y);
      if (distance > brush.maxDisplacement) {
        const ratio2 = brush.maxDisplacement / distance;
        x = source[i].x + (x - source[i].x) * ratio2;
        y = source[i].y + (y - source[i].y) * ratio2;
        clipped.add(p.id);
      }
      if (!finite3(x) || !finite3(y))
        throw Error("nonfinite brush result");
      return { ...p, x, y };
    });
  const area = (p, a, b, c) => (p[b].x - p[a].x) * (p[c].y - p[a].y) - (p[b].y - p[a].y) * (p[c].x - p[a].x);
  let minAreaRatio = Infinity;
  for (let i = 0; i < (graph.triangles?.length ?? 0); i += 3) {
    const [a, b, c] = graph.triangles.slice(i, i + 3);
    const before = area(source, a, b, c), after = area(points, a, b, c);
    if (Math.abs(before) < 1e-8 || before * after <= 0 || Math.abs(after) < 1e-8)
      throw Error("brush would produce degenerate or inverted triangles");
    minAreaRatio = Math.min(minAreaRatio, Math.abs(after / before));
  }
  const changed = points.filter((p, i) => Math.hypot(p.x - source[i].x, p.y - source[i].y) > 1e-9);
  return { points, report: { changedPointCount: changed.length, maxDisplacement: Math.max(0, ...points.map((p, i) => Math.hypot(p.x - source[i].x, p.y - source[i].y))), clippedPointCount: clipped.size, minAreaRatio: Number.isFinite(minAreaRatio) ? minAreaRatio : null, lockedPointCount: locked.size } };
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/deformOperations.ts
function upsert(list, shape) {
  const index = list.findIndex((s) => s.id === shape.id);
  if (index < 0) {
    if (list.length >= 128)
      throw Error("too many blend shapes");
    list.push(structuredClone(shape));
  } else
    list[index] = structuredClone(shape);
}
function selectedParts(rig, operation) {
  const parts = rig.parts.filter((p) => matchesPartTarget(p, operation.target).matched);
  if (operation.target.partIds?.some((id) => !rig.parts.some((p) => p.id === id)))
    throw Error("target part not found");
  if (operation.target.roles?.some((role) => !rig.parts.some((p) => p.role === role && p.roleStatus === "confirmed")))
    throw Error("confirmed role not found");
  if (parts.some((p) => p.locked))
    throw Error("target part locked");
  return parts;
}
function selectedDeformers(rig, operation) {
  const ids = operation.target.deformerIds ?? [];
  if (!ids.length)
    throw Error("explicit deformerIds required");
  return [...new Set(ids)].map((id) => {
    const d = rig.deformers?.find((d2) => d2.id === id);
    if (!d || d.locked)
      throw Error("target deformer missing or locked");
    return d;
  });
}
function writeShape(rig, op, shape) {
  if (shape.kind === "deformer")
    return selectedDeformers(rig, op).map((d) => {
      validateExtendedShape(shape, rig, d.id);
      upsert(d.blendShapes ??= [], shape);
      return d.id;
    });
  const parts = selectedParts(rig, op);
  if (!parts.length)
    throw Error("explicit part targets required");
  if (shape.kind === "glue") {
    const glue = rig.glue?.find((g) => g.id === shape.glueId);
    if (!glue || ![glue.partAId, glue.partBId].every((id) => parts.some((p) => p.id === id)))
      throw Error("both glue parts must be targeted");
    validateExtendedShape(shape, rig, glue.id);
    upsert(glue.blendShapes ??= [], shape);
    return [glue.partAId, glue.partBId];
  }
  return parts.map((p) => {
    validateExtendedShape(shape, rig, p.id);
    if (shape.kind === "part")
      upsert(p.blendShapes ??= [], shape);
    else
      upsert(p.artPaths.find((a) => a.id === shape.pathId).blendShapes ??= [], shape);
    return p.id;
  });
}
function meshBrush(rig, part, brush) {
  const mesh = part.artMesh, asset = rig.assets.find((a) => a.id === part.assetId);
  if (!mesh?.enabled || !asset || !asset.width || !asset.height)
    throw Error("enabled ArtMesh and asset required");
  const width = asset.width, height = asset.height;
  const destination = brush.destination;
  let offsets = [];
  if (destination.kind === "blend-shape") {
    validateBlendWeight(destination.shape, rig);
    const existing = mesh.blendShapes?.find((s) => s.id === destination.shape.id);
    if (existing?.additive === false)
      throw Error("brush requires additive blend shape");
    offsets = existing?.offsets ?? [];
  } else if (destination.kind === "keyform") {
    const parameter = rig.parameters.find((p) => p.id === destination.parameter);
    if (!parameter || !Number.isFinite(destination.input) || destination.input < parameter.min || destination.input > parameter.max)
      throw Error("invalid keyform parameter/input");
    const bindings = mesh.bindings?.filter((b) => b.parameter === destination.parameter) ?? [];
    if (bindings.length > 1 || bindings[0]?.additive === false)
      throw Error("ambiguous/nonadditive keyform");
    offsets = bindings[0]?.keys.find((k) => k.input === destination.input)?.offsets ?? [];
  }
  const graph = { points: mesh.vertices.map((v) => {
    const d = offsets.find((d2) => d2.vertexId === v.id);
    return { id: v.id, x: v.x + (d?.x ?? 0), y: v.y + (d?.y ?? 0), referenceX: destination.kind === "base" ? v.u * width : v.x, referenceY: destination.kind === "base" ? v.v * height : v.y };
  }), edges: [], boundary: /* @__PURE__ */ new Set(), locked: /* @__PURE__ */ new Set(), triangles: mesh.triangles };
  const edges = /* @__PURE__ */ new Map();
  for (let i = 0; i < mesh.triangles.length; i += 3) {
    const tri = mesh.triangles.slice(i, i + 3);
    for (let j = 0; j < 3; j++) {
      const a = Math.min(tri[j], tri[(j + 1) % 3]), b = Math.max(tri[j], tri[(j + 1) % 3]), key = a + ":" + b;
      const e = edges.get(key);
      if (e)
        e.count++;
      else
        edges.set(key, { a, b, count: 1 });
    }
  }
  for (const { a, b, count } of edges.values()) {
    graph.edges.push([a, b]);
    if (count === 1) {
      graph.boundary.add(mesh.vertices[a].id);
      graph.boundary.add(mesh.vertices[b].id);
    }
  }
  for (const id of [...mesh.generator.quality?.lockedVertexIds ?? [], ...mesh.generator.quality?.pinnedVertexIds ?? [], ...rig.symmetry?.protectedVertexIds?.[part.id] ?? []])
    graph.locked.add(id);
  if (rig.symmetry?.protectedPartIds.includes(part.id))
    throw Error("part protected by symmetry contract");
  const result = applyDeformBrush(graph, brush);
  const next = result.points.map((p, i) => ({ vertexId: p.id, x: p.x - mesh.vertices[i].x, y: p.y - mesh.vertices[i].y })).filter((d) => Math.abs(d.x) + Math.abs(d.y) > 1e-12);
  if (destination.kind === "base")
    result.points.forEach((p, i) => {
      mesh.vertices[i].x = p.x;
      mesh.vertices[i].y = p.y;
    });
  else if (destination.kind === "blend-shape")
    upsert(mesh.blendShapes ??= [], { ...destination.shape, offsets: next, additive: true });
  else {
    mesh.bindings ??= [];
    let binding = mesh.bindings.find((b) => b.parameter === destination.parameter);
    if (!binding) {
      binding = { parameter: destination.parameter, keys: [], additive: true };
      mesh.bindings.push(binding);
      const value = rig.parameters.find((p) => p.id === destination.parameter).default;
      if (value !== destination.input)
        binding.keys.push({ input: value, offsets: [] });
    }
    const key = binding.keys.find((k) => k.input === destination.input);
    if (key)
      key.offsets = next;
    else
      binding.keys.push({ input: destination.input, offsets: next });
    binding.keys.sort((a, b) => a.input - b.input);
  }
  return result.report;
}
function warpBrush(rig, op, brush) {
  if (brush.surface.kind === "artmesh")
    throw Error("warp surface required");
  const destination = brush.destination;
  const parameter = destination.kind === "keyform" ? keyformParameter(rig, destination.parameter, destination.input) : void 0;
  return selectedDeformers(rig, op).map((d) => {
    if (rig.symmetry?.protectedDeformerIds.includes(d.id))
      throw Error("deformer protected by symmetry contract");
    const surface = brush.surface;
    if (surface.kind === "artmesh")
      throw Error("warp surface required");
    const shared = surface.kind === "shared-warp";
    if (shared ? !d.sharedWarp?.enabled : d.kind !== "warp" || !d.warp?.enabled)
      throw Error("enabled warp field required");
    const controls = shared ? d.sharedWarp.controlPoints : d.warp.pins ?? [];
    let old;
    if (destination.kind === "blend-shape") {
      validateBlendWeight(destination.shape, rig);
      old = d.blendShapes?.find((s) => s.id === destination.shape.id);
    }
    const oldOffsets = shared ? old?.sharedPoints : old?.pins;
    const graph = { points: [], edges: [], boundary: /* @__PURE__ */ new Set(), locked: /* @__PURE__ */ new Set() };
    controls.forEach((p) => {
      let x, y;
      if ("column" in p) {
        const field = d.sharedWarp;
        x = field.bounds.left + p.column / field.grid.columns * field.bounds.width;
        y = field.bounds.top + p.row / field.grid.rows * field.bounds.height;
        if (p.column === 0 || p.row === 0 || p.column === field.grid.columns || p.row === field.grid.rows)
          graph.boundary.add(p.id);
      } else {
        if (surface.kind !== "warp-pins" || !Number.isFinite(surface.width) || !Number.isFinite(surface.height) || surface.width <= 0 || surface.height <= 0)
          throw Error("warp-local dimensions required");
        x = p.u * surface.width;
        y = p.v * surface.height;
      }
      const delta = destination.kind === "keyform" ? sampleWarpKeyform(p, destination.parameter, destination.input) : oldOffsets?.find((v) => v.id === p.id);
      graph.points.push({ id: p.id, x: x + p.offsetX + (delta?.x ?? 0), y: y + p.offsetY + (delta?.y ?? 0), referenceX: x + (destination.kind === "base" ? 0 : p.offsetX), referenceY: y + (destination.kind === "base" ? 0 : p.offsetY) });
      if (p.enabled === false)
        graph.locked.add(p.id);
    });
    if (shared) {
      const grid = d.sharedWarp;
      const at = (c, r) => grid.controlPoints.findIndex((p) => p.column === c && p.row === r);
      graph.triangles = [];
      for (let row = 0; row <= grid.grid.rows; row++)
        for (let column = 0; column <= grid.grid.columns; column++) {
          const a = at(column, row);
          if (a < 0)
            throw Error("shared warp must have a complete grid");
          if (column < grid.grid.columns)
            graph.edges.push([a, at(column + 1, row)]);
          if (row < grid.grid.rows)
            graph.edges.push([a, at(column, row + 1)]);
          if (column < grid.grid.columns && row < grid.grid.rows) {
            const b = at(column + 1, row), c = at(column, row + 1), e = at(column + 1, row + 1);
            graph.triangles.push(a, b, c, b, e, c);
          }
        }
    } else {
      if (brush.effect.mode === "contour-follow")
        throw Error("contour-follow requires mesh or shared-grid boundary");
      for (const [a, b] of brush.edges ?? [])
        graph.edges.push([controls.findIndex((p) => p.id === a), controls.findIndex((p) => p.id === b)]);
      controls.forEach((p, i) => {
        if (graph.edges.filter((e) => e.includes(i)).length <= 1)
          graph.boundary.add(p.id);
      });
    }
    const result = applyDeformBrush(graph, brush);
    const deltas = result.points.map((p, i) => ({ id: p.id, x: p.x - graph.points[i].referenceX, y: p.y - graph.points[i].referenceY }));
    if (destination.kind === "base")
      deltas.forEach((p, i) => {
        controls[i].offsetX = p.x;
        controls[i].offsetY = p.y;
      });
    else if (destination.kind === "keyform") {
      deltas.forEach((delta, i) => {
        if (controls[i].enabled === false || graph.locked.has(controls[i].id) || brush.lockedIds?.includes(controls[i].id)) return;
        const previous = sampleWarpKeyform(controls[i], destination.parameter, destination.input);
        writeWarpKeyform(controls[i], destination.parameter, destination.input, parameter.default, delta, previous);
      });
    } else {
      const shape = { ...old, ...destination.shape, kind: "deformer", ...shared ? { sharedPoints: deltas.filter((_, i) => controls[i].enabled !== false) } : { pins: deltas.filter((_, i) => controls[i].enabled !== false) } };
      validateExtendedShape(shape, rig, d.id);
      upsert(d.blendShapes ??= [], shape);
    }
    return { ownerId: d.id, ...result.report };
  });
}
function executeDeformOperation(rig, op, dryRun) {
  const candidate = structuredClone(rig);
  const action = op.action;
  if (action.type === "deform-brush" && action.brush.edges !== void 0 && action.brush.surface.kind !== "warp-pins")
    throw Error("explicit edges are only supported for warp-pins");
  let ids = [];
  const reports = [];
  if (action.type === "blend-shape-set")
    ids = writeShape(candidate, op, action.shape);
  else if (action.type === "deform-brush") {
    if (action.brush.surface.kind === "artmesh") {
      const parts = selectedParts(candidate, op);
      if (!parts.length)
        throw Error("part target required");
      for (const part of parts)
        reports.push({ ownerId: part.id, ...meshBrush(candidate, part, action.brush) });
      ids = parts.map((p) => p.id);
    } else {
      reports.push(...warpBrush(candidate, op, action.brush));
      ids = reports.map((r) => String(r.ownerId));
    }
  } else
    throw Error("unsupported deform operation");
  const changed = JSON.stringify(candidate) !== JSON.stringify(rig);
  if (!dryRun && changed)
    Object.assign(rig, candidate);
  return { operationId: op.id, dryRun, matchedPartIds: ids, skipped: [], deformReports: reports, changes: changed ? ids.map((partId) => ({ partId, path: action.type, before: void 0, after: JSON.stringify(reports.length ? reports : action) })) : [] };
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/facial.ts
var VISEME_IDS = ["A", "I", "U", "E", "O", "Silence"];
function object(value, allowed) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((k) => !allowed.includes(k))) throw Error("invalid facial object/unknown field");
}
var finite4 = (v) => typeof v === "number" && Number.isFinite(v);
function text(v, label) {
  if (typeof v !== "string" || !v.trim() || v.length > 160 || ["__proto__", "prototype", "constructor"].includes(v)) throw Error("invalid " + label);
}
function fade(v) {
  if (v !== void 0 && (!finite4(v) || v < 0 || v > 60)) throw Error("facial fade must be in [0,60] seconds");
}
function parseExpression(value) {
  object(value, ["Version", "Type", "FadeInTime", "FadeOutTime", "Parameters"]);
  if (value.Type !== "Live2D Expression" || value.Version !== void 0 && value.Version !== 3) throw Error("unsupported expression type/version");
  fade(value.FadeInTime);
  fade(value.FadeOutTime);
  if (!Array.isArray(value.Parameters) || value.Parameters.length > 256) throw Error("expression requires at most 256 parameters");
  const seen = /* @__PURE__ */ new Set();
  for (const p of value.Parameters) {
    object(p, ["Id", "Value", "Blend"]);
    text(p.Id, "expression parameter");
    if (seen.has(p.Id) || !finite4(p.Value) || p.Blend !== void 0 && !["Add", "Multiply", "Overwrite"].includes(String(p.Blend))) throw Error("invalid/duplicate expression parameter");
    seen.add(p.Id);
  }
  return structuredClone(value);
}
function validateExpression(doc, parameters) {
  const definitions = new Map(parameters.map((p) => [p.id, p]));
  for (const p of doc.Parameters) {
    const definition = definitions.get(p.Id);
    if (!definition) throw Error("unknown expression parameter: " + p.Id);
    if (p.Blend === "Overwrite" && (p.Value < definition.min || p.Value > definition.max)) throw Error("expression overwrite outside model range: " + p.Id);
  }
}
function parseFacialPresets(value, rig) {
  object(value, ["version", "expressions", "visemes"]);
  if (value.version !== 1 || !Array.isArray(value.expressions) || value.expressions.length > 128) throw Error("invalid facial catalog version/count");
  const defs = parameterDefinitionsForRig(rig), definitionMap = new Map(defs.map((p) => [p.id, p])), seen = /* @__PURE__ */ new Set();
  for (const e of value.expressions) {
    object(e, ["id", "name", "document"]);
    text(e.id, "expression ID");
    text(e.name, "expression name");
    if (seen.has(e.id)) throw Error("duplicate expression ID");
    seen.add(e.id);
    validateExpression(parseExpression(e.document), defs);
  }
  if (value.visemes !== void 0) {
    object(value.visemes, ["mode", "fadeInTime", "fadeOutTime", "presets"]);
    const bank = value.visemes;
    if (!["pose", "blend-shape"].includes(String(bank.mode)) || !Array.isArray(bank.presets) || bank.presets.length > 6) throw Error("invalid viseme bank");
    fade(bank.fadeInTime);
    fade(bank.fadeOutTime);
    const seenVisemes = /* @__PURE__ */ new Set();
    let channels;
    for (const preset of bank.presets) {
      object(preset, ["id", "values"]);
      if (!VISEME_IDS.includes(preset.id) || seenVisemes.has(preset.id)) throw Error("invalid/duplicate viseme ID");
      seenVisemes.add(preset.id);
      if (!preset.values || typeof preset.values !== "object" || Array.isArray(preset.values)) throw Error("invalid viseme values");
      const entries = Object.entries(preset.values);
      if (!entries.length || entries.length > 64) throw Error("viseme requires 1..64 parameters");
      const signature = entries.map(([id]) => id).sort().join("\0");
      if (channels !== void 0 && channels !== signature) throw Error("viseme presets must use the same parameter IDs");
      channels = signature;
      for (const [id, v] of entries) {
        const p = definitionMap.get(id);
        if (!p || !finite4(v) || v < p.min || v > p.max) throw Error("viseme value outside model range/unknown parameter: " + id);
        if (bank.mode === "blend-shape" && (p.min !== 0 || p.max !== 1 || p.default !== 0 || v < 0 || v > 1)) throw Error("blend-shape visemes require zero-default [0,1] parameters");
      }
      if (preset.id === "Silence" && bank.mode === "blend-shape" && entries.some(([, v]) => v !== 0)) throw Error("blend-shape Silence must have zero weights");
    }
  }
  return structuredClone(value);
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/tint.ts
function validatePartTint(tint) {
  if (!tint) return [];
  const issues = [];
  if (tint.mode !== "multiply" && tint.mode !== "screen") issues.push("tint-mode-invalid");
  if (typeof tint.color !== "string" || !/^#[0-9a-fA-F]{6}$/.test(tint.color)) issues.push("tint-color-invalid");
  if (!Number.isFinite(tint.opacity) || tint.opacity < 0 || tint.opacity > 1) issues.push("tint-opacity-invalid");
  return issues;
}

// ../../../../AppData/Local/Temp/cordis-standrig-d74c6aba/packages/core/src/modelingOps.ts
function executeParameterAdd(rig, operation, dryRun) {
  const action = operation.action;
  if (action.type !== "parameter-add") throw new Error("parameter-add action required");
  const result = { operationId: operation.id, dryRun, matchedPartIds: ["rig"], changes: [], skipped: [] };
  const definition = action.parameter;
  const existing = rig.parameters.find((parameter) => parameter.id === definition.id);
  if (existing) {
    if (JSON.stringify(existing) !== JSON.stringify(definition)) result.skipped.push({ partId: "rig", reason: "parameter-conflict" });
    return result;
  }
  result.changes.push({ partId: "rig", path: "parameters." + definition.id, before: void 0, after: definition });
  if (!dryRun) rig.parameters.push(structuredClone(definition));
  return result;
}
function executeDeformerCreate(rig, operation, dryRun) {
  const action = operation.action;
  if (action.type !== "deformer-create") throw new Error("deformer-create action required");
  const result = { operationId: operation.id, dryRun, matchedPartIds: ["rig"], changes: [], skipped: [] };
  const next = action.deformer;
  const existing = (rig.deformers ?? []).find((entry) => entry.id === next.id);
  if (existing) {
    result.skipped.push({ partId: next.id, reason: "deformer-already-exists" });
    return result;
  }
  result.changes.push({ partId: "rig", path: "deformers." + next.id, before: void 0, after: JSON.stringify(next) });
  if (!dryRun) {
    rig.deformers ??= [];
    rig.deformers.push(structuredClone(next));
  }
  return result;
}
function executeDeformerKindSet(rig, operation, dryRun) {
  const action = operation.action;
  if (action.type !== "deformer-kind-set") throw new Error("deformer-kind-set action required");
  const result = { operationId: operation.id, dryRun, matchedPartIds: [], changes: [], skipped: [] };
  if (!operation.target.deformerIds?.includes(action.deformerId)) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-target-mismatch" });
    return result;
  }
  const deformer = (rig.deformers ?? []).find((entry) => entry.id === action.deformerId);
  if (!deformer) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-not-found" });
    return result;
  }
  result.matchedPartIds.push(deformer.id);
  if (deformer.kind !== action.kind) {
    result.changes.push({ partId: deformer.id, path: "kind", before: deformer.kind, after: action.kind });
    if (!dryRun) deformer.kind = action.kind;
  }
  if (action.kind === "warp") {
    const nextWarp = structuredClone(action.warp ?? deformer.warp ?? defaultWarpDeformer());
    if (JSON.stringify(deformer.warp ?? null) !== JSON.stringify(nextWarp)) {
      result.changes.push({ partId: deformer.id, path: "warp", before: deformer.warp ?? null, after: nextWarp });
      if (!dryRun) deformer.warp = nextWarp;
    }
  }
  return result;
}
function executeDeformerTargetsSet(rig, operation, dryRun) {
  const action = operation.action;
  if (action.type !== "deformer-targets-set") throw new Error("deformer-targets-set action required");
  const result = { operationId: operation.id, dryRun, matchedPartIds: [], changes: [], skipped: [] };
  if (!operation.target.deformerIds?.includes(action.deformerId)) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-target-mismatch" });
    return result;
  }
  const deformer = (rig.deformers ?? []).find((entry) => entry.id === action.deformerId);
  if (!deformer) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-not-found" });
    return result;
  }
  const existingTargets = Array.isArray(deformer.targetPartIds) ? deformer.targetPartIds : [];
  const nextTargets = action.mode === "merge" ? [.../* @__PURE__ */ new Set([...existingTargets, ...action.targetPartIds])] : [...new Set(action.targetPartIds)];
  result.matchedPartIds.push(deformer.id);
  const before = JSON.stringify(existingTargets);
  const after = JSON.stringify(nextTargets);
  if (before !== after) {
    result.changes.push({ partId: deformer.id, path: "targetPartIds", before: existingTargets, after: nextTargets });
    if (!dryRun) deformer.targetPartIds = nextTargets;
  }
  return result;
}
function executeDeformerParentSet(rig, operation, dryRun) {
  const action = operation.action;
  if (action.type !== "deformer-parent-set") throw new Error("deformer-parent-set action required");
  const result = { operationId: operation.id, dryRun, matchedPartIds: [], changes: [], skipped: [] };
  if (!operation.target.deformerIds?.includes(action.deformerId)) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-target-mismatch" });
    return result;
  }
  const deformer = (rig.deformers ?? []).find((entry) => entry.id === action.deformerId);
  if (!deformer) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-not-found" });
    return result;
  }
  if (action.parentId === action.deformerId) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-parent-cycle" });
    return result;
  }
  if (action.parentId !== null && !(rig.deformers ?? []).some((entry) => entry.id === action.parentId)) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-parent-not-found" });
    return result;
  }
  result.matchedPartIds.push(deformer.id);
  if (deformer.parentId !== action.parentId) {
    result.changes.push({ partId: deformer.id, path: "parentId", before: deformer.parentId, after: action.parentId });
    if (!dryRun) deformer.parentId = action.parentId;
  }
  return result;
}
function executeDeformerTransform(rig, operation, dryRun) {
  const action = operation.action;
  if (action.type !== "deformer-transform") throw new Error("deformer-transform action required");
  const result = { operationId: operation.id, dryRun, matchedPartIds: [], changes: [], skipped: [] };
  const deformer = (rig.deformers ?? []).find((entry) => entry.id === action.deformerId);
  if (!deformer) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-not-found" });
    return result;
  }
  result.matchedPartIds.push(action.deformerId);
  const before = deformer.transform[action.property];
  const after = action.operator === "set" ? action.value : action.operator === "add" ? before + action.value : before * action.value;
  if (!Number.isFinite(after)) throw new Error("deformer-transform result must be finite");
  if (before !== after) {
    result.changes.push({ partId: action.deformerId, path: "transform." + action.property, before, after });
    if (!dryRun) deformer.transform[action.property] = after;
  }
  return result;
}
function executeDeformerOrigin(rig, operation, dryRun) {
  const action = operation.action;
  if (action.type !== "deformer-origin") throw new Error("deformer-origin action required");
  const result = { operationId: operation.id, dryRun, matchedPartIds: [], changes: [], skipped: [] };
  const deformer = (rig.deformers ?? []).find((entry) => entry.id === action.deformerId);
  if (!deformer) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-not-found" });
    return result;
  }
  result.matchedPartIds.push(action.deformerId);
  if (deformer.origin.x !== action.x) result.changes.push({ partId: action.deformerId, path: "origin.x", before: deformer.origin.x, after: action.x });
  if (deformer.origin.y !== action.y) result.changes.push({ partId: action.deformerId, path: "origin.y", before: deformer.origin.y, after: action.y });
  if (!dryRun) {
    deformer.origin.x = action.x;
    deformer.origin.y = action.y;
  }
  return result;
}
function applyInterpolationOptions(binding, options) {
  if (options.interpolation !== void 0) {
    binding.interpolation = options.interpolation;
    binding.curve = options.interpolation === "curve" && options.curve ? structuredClone(options.curve) : void 0;
  } else if (options.curve !== void 0) {
    binding.curve = structuredClone(options.curve);
  }
}
function executeModelingOperation(rig, operation, options = {}) {
  validateOperation(operation);
  const dryRun = options.dryRun === true;
  const result = { operationId: operation.id, dryRun, matchedPartIds: [], changes: [], skipped: [] };
  if (operation.enabled === false) return result;
  if (operation.action.type === "facial-presets-set") {
    if (Object.values(operation.target).some((v) => Array.isArray(v) && v.length)) throw Error("facial-presets-set is rig-wide; target must be empty");
    const next = operation.action.presets === null ? void 0 : parseFacialPresets(operation.action.presets, rig);
    result.matchedPartIds = ["rig"];
    if (JSON.stringify(rig.facialPresets) !== JSON.stringify(next)) result.changes.push({ partId: "rig", path: "facialPresets", before: rig.facialPresets, after: next });
    if (!dryRun) {
      if (next) rig.facialPresets = next;
      else delete rig.facialPresets;
    }
    return result;
  }
  if (operation.action.type === "blend-shape-set" || operation.action.type === "deform-brush") return executeDeformOperation(rig, operation, dryRun);
  if (operation.action.type === "warp-pin-binding-key") return executeWarpPinBindingKey(rig, operation, dryRun);
  if (operation.action.type === "deformer-create") return executeDeformerCreate(rig, operation, dryRun);
  if (operation.action.type === "deformer-kind-set") return executeDeformerKindSet(rig, operation, dryRun);
  if (operation.action.type === "deformer-targets-set") return executeDeformerTargetsSet(rig, operation, dryRun);
  if (operation.action.type === "deformer-parent-set") return executeDeformerParentSet(rig, operation, dryRun);
  if (operation.action.type === "deformer-origin") return executeDeformerOrigin(rig, operation, dryRun);
  if (operation.action.type === "deformer-transform") return executeDeformerTransform(rig, operation, dryRun);
  if (operation.action.type === "deformer-binding-key") return executeDeformerBindingKey(rig, operation, dryRun);
  if (operation.action.type === "deformer-binding-remove") return executeDeformerBindingRemove(rig, operation, dryRun);
  if (operation.action.type === "deformer-split") return executeDeformerSplit(rig, operation, dryRun);
  if (operation.action.type === "deformer-rotation-metadata") return executeDeformerRotationMetadata(rig, operation, dryRun);
  if (operation.action.type === "symmetry-contract") return executeSymmetryContract(rig, operation, dryRun);
  if (operation.action.type === "symmetry-artmesh-bindings") return executeSymmetryArtMeshBindings(rig, operation, dryRun);
  if (operation.action.type === "parameter-add") return executeParameterAdd(rig, operation, dryRun);
  for (const part of rig.parts) {
    const match = matchesPartTarget(part, operation.target);
    if (!match.matched) {
      if (match.reason) result.skipped.push({ partId: part.id, reason: match.reason });
      continue;
    }
    result.matchedPartIds.push(part.id);
    if (operation.action.type === "role-confirm") {
      const before = part.role ?? "unassigned";
      if (part.roleStatus === "confirmed" && part.role !== operation.action.role) {
        result.skipped.push({ partId: part.id, reason: "role-conflict" });
        continue;
      }
      if (part.role !== operation.action.role || part.roleStatus !== "confirmed" || part.roleConfidence !== 1) {
        result.changes.push({ partId: part.id, path: "role", before, after: operation.action.role });
        if (!dryRun) {
          part.role = operation.action.role;
          part.roleStatus = "confirmed";
          part.roleConfidence = 1;
        }
      }
    } else if (operation.action.type === "role-reclassify") {
      if (part.roleStatus !== "confirmed" || part.role !== operation.action.expectedRole) {
        result.skipped.push({ partId: part.id, reason: "expected-role-mismatch" });
        continue;
      }
      if (part.role === operation.action.role && part.roleConfidence === 1) continue;
      result.changes.push({ partId: part.id, path: "role", before: part.role, after: operation.action.role });
      if (!dryRun) {
        part.role = operation.action.role;
        part.roleStatus = "confirmed";
        part.roleConfidence = 1;
      }
    } else if (operation.action.type === "part-draw-order") {
      const before = part.drawOrder;
      const after = operation.action.drawOrder;
      if (before === after) continue;
      result.changes.push({ partId: part.id, path: "drawOrder", before, after });
      if (!dryRun) part.drawOrder = after;
    } else if (operation.action.type === "part-blend-mode") {
      const before = part.blendMode ?? "normal";
      const after = operation.action.mode;
      if (before === after) continue;
      result.changes.push({ partId: part.id, path: "blendMode", before, after });
      if (!dryRun) {
        if (after === "normal") delete part.blendMode;
        else part.blendMode = after;
      }
    } else if (operation.action.type === "part-visibility") {
      const before = part.visible !== false;
      const after = operation.action.visible;
      if (before === after) continue;
      result.changes.push({ partId: part.id, path: "visible", before, after });
      if (!dryRun) part.visible = after;
    } else if (operation.action.type === "part-tint") {
      const before = part.tint ? structuredClone(part.tint) : null;
      const after = operation.action.tint ? structuredClone(operation.action.tint) : null;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      result.changes.push({ partId: part.id, path: "tint", before: before ?? void 0, after: after ?? void 0 });
      if (!dryRun) {
        if (after) part.tint = after;
        else delete part.tint;
      }
    } else if (operation.action.type === "part-contour-shade") {
      const before = part.contourShade ?? null;
      const after = operation.action.shade;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      result.changes.push({ partId: part.id, path: "contourShade", before, after });
      if (!dryRun) {
        if (after) part.contourShade = structuredClone(after);
        else delete part.contourShade;
      }
    } else if (operation.action.type === "part-alpha-reveal") {
      const before = part.alphaReveal ?? null;
      const after = operation.action.reveal;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      result.changes.push({ partId: part.id, path: "alphaReveal", before, after });
      if (!dryRun) {
        if (after) part.alphaReveal = structuredClone(after);
        else delete part.alphaReveal;
      }
    } else if (operation.action.type === "part-clip") {
      const before = part.clip ? structuredClone(part.clip) : null;
      const after = operation.action.clip ? structuredClone(operation.action.clip) : null;
      if (JSON.stringify(before) === JSON.stringify(after)) continue;
      result.changes.push({ partId: part.id, path: "clip", before: before ?? void 0, after: after ?? void 0 });
      if (!dryRun) {
        if (after) part.clip = after;
        else delete part.clip;
      }
    } else if (operation.action.type === "transform") {
      const property = operation.action.property;
      const before = part.transform[property];
      let after = operation.action.operator === "set" ? operation.action.value : operation.action.operator === "multiply" ? before * operation.action.value : before + operation.action.value;
      if (property === "opacity") after = Math.min(1, Math.max(0, after));
      if (!Number.isFinite(after) || before === after) continue;
      result.changes.push({ partId: part.id, path: `transform.${property}`, before, after });
      if (!dryRun) part.transform[property] = after;
    } else if (operation.action.type === "artmesh-generate" || operation.action.type === "artmesh-rebuild") {
      const action = operation.action;
      if (action.type === "artmesh-generate" && part.artMesh?.enabled) {
        result.skipped.push({ partId: part.id, reason: "artmesh-exists" });
        continue;
      }
      const asset = part.assetId ? rig.assets.find((entry) => entry.id === part.assetId) : void 0;
      const width = asset?.width;
      const height = asset?.height;
      if (!asset || typeof width !== "number" || typeof height !== "number" || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
        result.skipped.push({ partId: part.id, reason: "asset-dimensions-required" });
        continue;
      }
      const topology = action.topology ?? "rect-grid";
      const sampler = topology === "alpha-contour" ? options.assetAlphaSamplers?.get(asset.id) : void 0;
      if (topology === "alpha-contour" && !sampler) {
        result.skipped.push({ partId: part.id, reason: "alpha-sampler-required" });
        continue;
      }
      const generated = sampler ? createAlphaContourArtMesh(width, height, sampler.alphaAt, {
        preset: action.preset,
        columns: action.columns,
        rows: action.rows,
        alphaThreshold: action.alphaThreshold,
        alphaBounds: sampler.alphaBounds,
        quality: action.quality
      }) : createRectArtMesh(width, height, {
        preset: action.preset,
        columns: action.columns,
        rows: action.rows,
        alphaThreshold: action.alphaThreshold,
        quality: action.quality
      });
      const previous = part.artMesh;
      const next = action.type === "artmesh-rebuild" && action.preserveBindings !== false && previous ? preserveArtMeshBindings(generated, previous) : generated;
      result.changes.push({ partId: part.id, path: action.type === "artmesh-rebuild" ? "artMesh.rebuilt.vertices" : "artMesh.generated.vertices", before: previous?.vertices.length ?? 0, after: next.vertices.length });
      if (!dryRun) part.artMesh = next;
    } else if (operation.action.type === "artmesh-quality") {
      const action = operation.action;
      if (!part.artMesh?.enabled) {
        result.skipped.push({ partId: part.id, reason: "artmesh-required" });
        continue;
      }
      const beforeQuality = part.artMesh.generator.quality ?? {};
      const nextQuality = action.merge === false ? { ...action.quality } : { ...beforeQuality, ...action.quality };
      if (JSON.stringify(beforeQuality) !== JSON.stringify(nextQuality)) {
        result.changes.push({
          partId: part.id,
          path: "artMesh.generator.quality",
          before: beforeQuality.boundaryVertexIds?.length ?? 0,
          after: nextQuality.boundaryVertexIds?.length ?? 0
        });
        if (!dryRun) part.artMesh.generator.quality = nextQuality;
      }
    } else if (operation.action.type === "artmesh-binding-key") {
      executeArtMeshBindingKey(part, operation.action, dryRun, result);
    } else if (operation.action.type === "artmesh-multi-key") {
      executeArtMeshMultiKey(part, operation.action, dryRun, result);
    } else if (operation.action.type === "artmesh-blend-shape") {
      executeArtMeshBlendShape(part, operation.action, dryRun, result);
    } else if (operation.action.type === "artmesh-mirror-key") {
      executeArtMeshMirrorKey(part, operation.action, dryRun, result);
    } else if (operation.action.type === "binding-key") {
      const action = operation.action;
      part.bindings ??= [];
      let binding = part.bindings.find((entry) => entry.parameter === action.parameter && entry.property === action.property);
      if (!binding) {
        binding = { parameter: action.parameter, property: action.property, additive: action.additive ?? true, interpolation: action.interpolation ?? "smoothstep", curve: action.curve, keys: [] };
        part.bindings.push(binding);
      }
      applyInterpolationOptions(binding, action);
      if (action.additive !== void 0 && binding.additive !== action.additive) {
        result.changes.push({ partId: part.id, path: "bindings." + action.parameter + "." + action.property + ".additive", before: binding.additive, after: action.additive });
        if (!dryRun) binding.additive = action.additive;
      }
      binding.keys = Array.isArray(binding.keys) ? binding.keys : [];
      const existing = binding.keys.find((key) => Math.abs(key.input - action.input) < 1e-4);
      const before = existing?.value ?? 0;
      if (before !== action.value) result.changes.push({ partId: part.id, path: `bindings.${action.parameter}.${action.property}[${action.input}]`, before, after: action.value });
      if (!dryRun) {
        if (existing) existing.value = action.value;
        else binding.keys.push({ input: action.input, value: action.value });
        binding.keys.sort((left, right) => left.input - right.input);
      }
    } else {
      const action = operation.action;
      if (!part.artMesh?.enabled) {
        result.skipped.push({ partId: part.id, reason: "artmesh-required" });
        continue;
      }
      const region = action.uv;
      const lockedVertexIds = new Set(part.artMesh.generator.quality?.lockedVertexIds ?? []);
      part.artMesh.vertices.forEach((vertex, index) => {
        if (lockedVertexIds.has(vertex.id)) {
          result.skipped.push({ partId: part.id, reason: `artmesh-vertex-locked:${vertex.id}` });
          return;
        }
        if (region && (vertex.u < region.minU || vertex.u > region.maxU || vertex.v < region.minV || vertex.v > region.maxV)) return;
        for (const axis of ["x", "y"]) {
          const delta = action[axis];
          if (!delta) continue;
          const before = vertex[axis];
          const after = before + delta;
          result.changes.push({ partId: part.id, path: `artMesh.vertices[${index}].${axis}`, before, after });
          if (!dryRun) vertex[axis] = after;
        }
      });
    }
  }
  return result;
}
function executeArtMeshBindingKey(part, action, dryRun, result) {
  const mesh = part.artMesh;
  if (!mesh?.enabled) {
    result.skipped.push({ partId: part.id, reason: "artmesh-required" });
    return;
  }
  const offsets = normalizeArtMeshKeyOffsets(mesh, action.offsets, result, part.id);
  if (!offsets) return;
  mesh.bindings ??= [];
  let binding = mesh.bindings.find((entry) => entry.parameter === action.parameter);
  if (!binding) {
    binding = { parameter: action.parameter, additive: action.additive ?? true, interpolation: action.interpolation ?? "smoothstep", curve: action.curve, keys: [] };
    mesh.bindings.push(binding);
  }
  applyInterpolationOptions(binding, action);
  const existing = binding.keys.find((key) => Math.abs(key.input - action.input) < 1e-4);
  const beforeCount = existing?.offsets?.length ?? 0;
  if (!existing || JSON.stringify(existing.offsets) !== JSON.stringify(offsets)) {
    result.changes.push({ partId: part.id, path: "artMesh.bindings." + action.parameter + "[" + action.input + "]", before: beforeCount, after: offsets.length });
  }
  if (!dryRun) {
    if (existing) existing.offsets = offsets;
    else binding.keys.push({ input: action.input, offsets });
    binding.keys.sort((left, right) => left.input - right.input);
  }
}
function executeArtMeshMirrorKey(part, action, dryRun, result) {
  const mesh = part.artMesh;
  if (!mesh?.enabled) {
    result.skipped.push({ partId: part.id, reason: "artmesh-required" });
    return;
  }
  const binding = mesh.bindings?.find((entry) => entry.parameter === action.parameter);
  const source = binding?.keys.find((key) => Math.abs(key.input - action.sourceInput) < 1e-4);
  if (!binding || !source) {
    result.skipped.push({ partId: part.id, reason: "artmesh-source-key-not-found" });
    return;
  }
  const axisU = action.axisU ?? 0.5;
  const tolerance = action.tolerance ?? 0.01;
  const protectedIds = new Set(action.protectVertexIds ?? []);
  const vertices = mesh.vertices;
  const locked = new Set(mesh.generator.quality?.lockedVertexIds ?? []);
  const mirrored = [];
  const usedTargets = /* @__PURE__ */ new Set();
  for (const offset of source.offsets ?? []) {
    const sourceVertex = vertices.find((vertex) => vertex.id === offset.vertexId);
    if (!sourceVertex) {
      result.skipped.push({ partId: part.id, reason: "artmesh-vertex-not-found:" + offset.vertexId });
      return;
    }
    const targetU = 2 * axisU - sourceVertex.u;
    const onAxis = Math.abs(targetU - sourceVertex.u) <= tolerance;
    if (protectedIds.has(sourceVertex.id) || locked.has(sourceVertex.id)) continue;
    let target = onAxis ? sourceVertex : void 0;
    if (!target) {
      target = vertices.filter((vertex) => vertex.id !== sourceVertex.id && !usedTargets.has(vertex.id) && !locked.has(vertex.id) && !protectedIds.has(vertex.id)).filter((vertex) => Math.abs(vertex.u - targetU) <= tolerance && Math.abs(vertex.v - sourceVertex.v) <= tolerance).sort((left, right) => Math.abs(left.u - targetU) + Math.abs(left.v - sourceVertex.v) - (Math.abs(right.u - targetU) + Math.abs(right.v - sourceVertex.v)))[0];
    }
    if (!target) continue;
    usedTargets.add(target.id);
    mirrored.push({ vertexId: target.id, x: onAxis ? 0 : -offset.x, y: offset.y });
  }
  if (!mirrored.length) {
    result.skipped.push({ partId: part.id, reason: "artmesh-mirror-no-editable-targets" });
    return;
  }
  mesh.bindings ??= [];
  let targetBinding = mesh.bindings.find((entry) => entry.parameter === action.parameter);
  if (!targetBinding) {
    targetBinding = { parameter: action.parameter, additive: action.additive ?? binding.additive ?? true, interpolation: action.interpolation ?? binding.interpolation ?? "smoothstep", curve: action.curve ?? binding.curve, keys: [] };
    mesh.bindings.push(targetBinding);
  }
  applyInterpolationOptions(targetBinding, action);
  const existing = targetBinding.keys.find((key) => Math.abs(key.input - action.targetInput) < 1e-4);
  const beforeCount = existing?.offsets?.length ?? 0;
  if (!existing || JSON.stringify(existing.offsets) !== JSON.stringify(mirrored)) {
    result.changes.push({ partId: part.id, path: "artMesh.bindings." + action.parameter + "[" + action.targetInput + "] mirrored", before: beforeCount, after: mirrored.length });
  }
  if (!dryRun) {
    if (existing) existing.offsets = mirrored;
    else targetBinding.keys.push({ input: action.targetInput, offsets: mirrored });
    targetBinding.keys.sort((left, right) => left.input - right.input);
  }
}
function executeArtMeshMultiKey(part, action, dryRun, result) {
  const mesh = part.artMesh;
  if (!mesh?.enabled) {
    result.skipped.push({ partId: part.id, reason: "artmesh-required" });
    return;
  }
  const offsets = normalizeArtMeshKeyOffsets(mesh, action.offsets, result, part.id);
  if (!offsets) return;
  mesh.multiBindings ??= [];
  let binding = mesh.multiBindings.find((entry) => entry.parameters.length === 2 && entry.parameters[0] === action.parameters[0] && entry.parameters[1] === action.parameters[1]);
  if (!binding) {
    binding = { parameters: action.parameters, additive: action.additive ?? true, interpolation: action.interpolation ?? "smoothstep", curve: action.curve, keyforms: [] };
    mesh.multiBindings.push(binding);
  }
  applyInterpolationOptions(binding, action);
  const existing = binding.keyforms.find((keyform) => Math.abs((keyform.inputs[action.parameters[0]] ?? 0) - action.inputs[action.parameters[0]]) < 1e-4 && Math.abs((keyform.inputs[action.parameters[1]] ?? 0) - action.inputs[action.parameters[1]]) < 1e-4);
  const beforeCount = existing?.offsets?.length ?? 0;
  if (!existing || JSON.stringify(existing.offsets) !== JSON.stringify(offsets)) {
    result.changes.push({ partId: part.id, path: "artMesh.multiBindings." + action.parameters.join("x") + "(" + action.inputs[action.parameters[0]] + "," + action.inputs[action.parameters[1]] + ")", before: beforeCount, after: offsets.length });
  }
  if (!dryRun) {
    if (existing) existing.offsets = offsets;
    else binding.keyforms.push({ inputs: { ...action.inputs }, offsets });
    const [xParameter, yParameter] = binding.parameters;
    binding.keyforms.sort((left, right) => (left.inputs[xParameter] ?? 0) - (right.inputs[xParameter] ?? 0) || (left.inputs[yParameter] ?? 0) - (right.inputs[yParameter] ?? 0));
  }
}
function executeArtMeshBlendShape(part, action, dryRun, result) {
  const mesh = part.artMesh;
  if (!mesh?.enabled) {
    result.skipped.push({ partId: part.id, reason: "artmesh-required" });
    return;
  }
  const offsets = normalizeArtMeshKeyOffsets(mesh, action.offsets, result, part.id);
  if (!offsets) return;
  mesh.blendShapes ??= [];
  const existing = mesh.blendShapes.find((shape) => shape.id === action.id);
  const next = { id: action.id, parameter: action.parameter, neutralInput: action.neutralInput, targetInput: action.targetInput, offsets, additive: action.additive, interpolation: action.interpolation, curve: action.curve };
  if (JSON.stringify(existing) !== JSON.stringify(next)) {
    result.changes.push({ partId: part.id, path: "artMesh.blendShapes." + action.id, before: existing ? JSON.stringify(existing) : void 0, after: JSON.stringify(next) });
  }
  if (!dryRun) {
    if (existing) Object.assign(existing, next);
    else mesh.blendShapes.push(next);
  }
}
function validateArtMeshKeyOffsets(offsets) {
  if (!Array.isArray(offsets) || !offsets.length || offsets.some((offset) => !offset || typeof offset.vertexId !== "string" || !offset.vertexId.trim() || !Number.isFinite(offset.x) || !Number.isFinite(offset.y)) || new Set(offsets.map((offset) => offset.vertexId)).size !== offsets.length) {
    throw new Error("ArtMesh key offsets must contain unique finite vertex offsets");
  }
}
function normalizeArtMeshKeyOffsets(mesh, offsets, result, partId) {
  const ids = new Set(mesh.vertices.map((vertex) => vertex.id));
  const locked = new Set(mesh.generator.quality?.lockedVertexIds ?? []);
  const unknown = offsets.filter((offset) => !ids.has(offset.vertexId));
  if (unknown.length) {
    result.skipped.push({ partId, reason: "artmesh-vertex-not-found" });
    return void 0;
  }
  const lockedOffsets = offsets.filter((offset) => locked.has(offset.vertexId));
  if (lockedOffsets.length) {
    result.skipped.push({ partId, reason: "artmesh-vertex-locked:" + lockedOffsets[0].vertexId });
    return void 0;
  }
  return offsets.map((offset) => ({ vertexId: offset.vertexId, x: offset.x, y: offset.y }));
}
function executeWarpPinBindingKey(rig, operation, dryRun) {
  const result = { operationId: operation.id, dryRun, matchedPartIds: [], changes: [], skipped: [] };
  const action = operation.action;
  if (action.type !== "warp-pin-binding-key") return result;
  if (!operation.target.deformerIds?.includes(action.deformerId)) {
    result.skipped.push({ partId: action.deformerId + ":" + action.pinId, reason: "deformer-target-mismatch" });
    return result;
  }
  const deformer = rig.deformers?.find((entry) => entry.id === action.deformerId);
  if (!deformer) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-not-found" });
    return result;
  }
  const pin = deformer.warp?.pins?.find((entry) => entry.id === action.pinId);
  if (!pin) {
    result.skipped.push({ partId: action.deformerId + ":" + action.pinId, reason: "warp-pin-not-found" });
    return result;
  }
  result.matchedPartIds.push(deformer.id + ":" + pin.id);
  pin.bindings ??= [];
  let binding = pin.bindings.find((entry) => entry.parameter === action.parameter && entry.property === action.property);
  if (!binding) {
    binding = { parameter: action.parameter, property: action.property, additive: action.additive ?? true, interpolation: action.interpolation ?? "smoothstep", curve: action.curve, keys: [] };
    pin.bindings.push(binding);
  }
  applyInterpolationOptions(binding, action);
  binding.keys = Array.isArray(binding.keys) ? binding.keys : [];
  const existing = binding.keys.find((key) => Math.abs(key.input - action.input) < 1e-4);
  const before = existing?.value ?? 0;
  if (before !== action.value) {
    result.changes.push({ partId: deformer.id + ":" + pin.id, path: "warp.pins." + pin.id + ".bindings." + action.parameter + "." + action.property + "[" + action.input + "]", before, after: action.value });
  }
  if (!dryRun) {
    if (existing) existing.value = action.value;
    else binding.keys.push({ input: action.input, value: action.value });
    binding.keys.sort((left, right) => left.input - right.input);
  }
  return result;
}
function executeDeformerBindingKey(rig, operation, dryRun) {
  const result = { operationId: operation.id, dryRun, matchedPartIds: [], changes: [], skipped: [] };
  const action = operation.action;
  if (action.type !== "deformer-binding-key") return result;
  if (!operation.target.deformerIds?.includes(action.deformerId)) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-target-mismatch" });
    return result;
  }
  const deformer = rig.deformers?.find((entry) => entry.id === action.deformerId);
  if (!deformer) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-not-found" });
    return result;
  }
  result.matchedPartIds.push(deformer.id);
  deformer.bindings ??= [];
  let binding = deformer.bindings.find((entry) => entry.parameter === action.parameter && entry.property === action.property);
  if (!binding) {
    binding = { parameter: action.parameter, property: action.property, additive: action.additive ?? true, interpolation: action.interpolation ?? "smoothstep", curve: action.curve, keys: [] };
    deformer.bindings.push(binding);
  }
  applyInterpolationOptions(binding, action);
  if (action.additive !== void 0 && binding.additive !== action.additive) {
    result.changes.push({ partId: deformer.id, path: "deformer.bindings." + action.parameter + "." + action.property + ".additive", before: binding.additive, after: action.additive });
    if (!dryRun) binding.additive = action.additive;
  }
  binding.keys = Array.isArray(binding.keys) ? binding.keys : [];
  const existing = binding.keys.find((key) => Math.abs(key.input - action.input) < 1e-4);
  const before = existing?.value ?? 0;
  if (before !== action.value) {
    result.changes.push({ partId: deformer.id, path: "deformer.bindings." + action.parameter + "." + action.property + "[" + action.input + "]", before, after: action.value });
  }
  if (!dryRun) {
    if (existing) existing.value = action.value;
    else binding.keys.push({ input: action.input, value: action.value });
    binding.keys.sort((left, right) => left.input - right.input);
  }
  return result;
}
function executeDeformerBindingRemove(rig, operation, dryRun) {
  const result = { operationId: operation.id, dryRun, matchedPartIds: [], changes: [], skipped: [] };
  const action = operation.action;
  if (action.type !== "deformer-binding-remove") return result;
  if (!operation.target.deformerIds?.includes(action.deformerId)) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-target-mismatch" });
    return result;
  }
  const deformer = rig.deformers?.find((entry) => entry.id === action.deformerId);
  if (!deformer) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-not-found" });
    return result;
  }
  result.matchedPartIds.push(deformer.id);
  const bindings = deformer.bindings ?? [];
  const index = bindings.findIndex((entry) => entry.parameter === action.parameter && entry.property === action.property);
  if (index < 0) return result;
  const before = structuredClone(bindings[index]);
  result.changes.push({ partId: deformer.id, path: "deformer.bindings." + action.parameter + "." + action.property, before, after: void 0 });
  if (!dryRun) bindings.splice(index, 1);
  return result;
}
function executeSymmetryContract(rig, operation, dryRun) {
  const result = { operationId: operation.id, dryRun, matchedPartIds: ["__rig__"], changes: [], skipped: [] };
  const action = operation.action;
  if (action.type !== "symmetry-contract") return result;
  const before = rig.symmetry ? JSON.stringify(rig.symmetry) : void 0;
  const after = JSON.stringify(action.contract);
  if (before === after) return result;
  result.changes.push({ partId: "__rig__", path: "symmetry", before, after });
  if (!dryRun) rig.symmetry = structuredClone(action.contract);
  return result;
}
function executeSymmetryArtMeshBindings(rig, operation, dryRun) {
  const result = { operationId: operation.id, dryRun, matchedPartIds: [], changes: [], skipped: [] };
  const action = operation.action;
  if (action.type !== "symmetry-artmesh-bindings") return result;
  const seen = /* @__PURE__ */ new Set();
  for (const link of action.links) {
    if (link.kind !== "part") continue;
    const sourceId = link.sourceId < link.targetId ? link.sourceId : link.targetId;
    const targetId = link.sourceId < link.targetId ? link.targetId : link.sourceId;
    const pairKey = `${sourceId}|${targetId}`;
    if (seen.has(pairKey)) continue;
    seen.add(pairKey);
    const source = rig.parts.find((part) => part.id === sourceId);
    const target = rig.parts.find((part) => part.id === targetId);
    if (!source || !target || !source.artMesh?.enabled || !target.artMesh?.enabled) {
      result.skipped.push({ partId: pairKey, reason: "symmetry-artmesh-required" });
      continue;
    }
    const sourceBindings = source.artMesh.bindings ?? [];
    if (!sourceBindings.length) continue;
    result.matchedPartIds.push(source.id, target.id);
    target.artMesh.bindings ??= [];
    for (const sourceBinding of sourceBindings) {
      const targetParameter = mirrorSymmetryParameter(sourceBinding.parameter);
      const mirroredKeys = sourceBinding.keys.map((key) => ({ input: key.input, offsets: mirrorArtMeshOffsets(source.artMesh, target.artMesh, key.offsets ?? [], result, target.id) }));
      if (mirroredKeys.some((key) => !key.offsets)) continue;
      const existing = target.artMesh.bindings.find((binding) => binding.parameter === targetParameter);
      const nextBinding = existing ?? { parameter: targetParameter, additive: sourceBinding.additive, interpolation: sourceBinding.interpolation, curve: structuredClone(sourceBinding.curve), keys: [] };
      const nextKeys = action.overwrite === false ? [...existing?.keys ?? []] : [];
      for (const mirrored of mirroredKeys) {
        const index = nextKeys.findIndex((key) => Math.abs(key.input - mirrored.input) < 1e-4);
        if (index >= 0) {
          if (action.overwrite !== false) nextKeys[index] = mirrored;
        } else nextKeys.push(mirrored);
      }
      nextKeys.sort((left, right) => left.input - right.input);
      const before = existing ? JSON.stringify(existing.keys) : void 0;
      const after = JSON.stringify(nextKeys);
      if (before === after) continue;
      result.changes.push({ partId: target.id, path: `artMesh.bindings.${targetParameter}`, before, after });
      if (!dryRun) {
        nextBinding.keys = nextKeys;
        if (existing) Object.assign(existing, nextBinding);
        else target.artMesh.bindings.push(nextBinding);
      }
    }
  }
  result.matchedPartIds = [...new Set(result.matchedPartIds)];
  return result;
}
function mirrorArtMeshOffsets(sourceMesh, targetMesh, offsets, result, targetPartId) {
  const targetVertices = targetMesh.vertices;
  const locked = new Set(targetMesh.generator.quality?.lockedVertexIds ?? []);
  const mirrored = [];
  const used = /* @__PURE__ */ new Set();
  for (const offset of offsets) {
    const sourceVertex = sourceMesh.vertices.find((vertex) => vertex.id === offset.vertexId);
    if (!sourceVertex) {
      result.skipped.push({ partId: targetPartId, reason: "symmetry-artmesh-source-vertex-not-found:" + offset.vertexId });
      return [];
    }
    const candidates = targetVertices.filter((vertex) => !used.has(vertex.id) && !locked.has(vertex.id)).sort((left, right) => {
      const leftScore = Math.abs(left.u - (1 - sourceVertex.u)) + Math.abs(left.v - sourceVertex.v);
      const rightScore = Math.abs(right.u - (1 - sourceVertex.u)) + Math.abs(right.v - sourceVertex.v);
      return leftScore - rightScore;
    });
    const targetVertex = candidates[0];
    if (!targetVertex || Math.abs(targetVertex.u - (1 - sourceVertex.u)) > 0.08 || Math.abs(targetVertex.v - sourceVertex.v) > 0.08) {
      result.skipped.push({ partId: targetPartId, reason: "symmetry-artmesh-target-vertex-not-found:" + offset.vertexId });
      return [];
    }
    used.add(targetVertex.id);
    mirrored.push({ vertexId: targetVertex.id, x: linkInvertX(offset.x), y: offset.y });
  }
  return mirrored.sort((left, right) => left.vertexId.localeCompare(right.vertexId));
}
function linkInvertX(value) {
  return Math.abs(value) < 1e-6 ? 0 : -value;
}
function mirrorSymmetryParameter(parameter) {
  return parameter.replace(/ParamEyeL/g, "ParamEye__TEMP__").replace(/ParamEyeR/g, "ParamEyeL").replace(/ParamEye__TEMP__/g, "ParamEyeR");
}
function executeDeformerRotationMetadata(rig, operation, dryRun) {
  const result = { operationId: operation.id, dryRun, matchedPartIds: [], changes: [], skipped: [] };
  const action = operation.action;
  if (action.type !== "deformer-rotation-metadata") return result;
  const deformer = (rig.deformers ?? []).find((entry) => entry.id === action.deformerId);
  if (!deformer) {
    result.skipped.push({ partId: action.deformerId, reason: "deformer-not-found" });
    return result;
  }
  result.matchedPartIds.push(deformer.id);
  if (deformer.kind !== "rotate") {
    result.skipped.push({ partId: deformer.id, reason: "rotation-metadata-rotate-only" });
    return result;
  }
  const before = deformer.rotationMetadata ? JSON.stringify(deformer.rotationMetadata) : void 0;
  const after = JSON.stringify(action.metadata);
  if (before === after) return result;
  result.changes.push({ partId: deformer.id, path: "rotationMetadata", before, after });
  if (!dryRun) deformer.rotationMetadata = action.metadata;
  return result;
}
function executeDeformerSplit(rig, operation, dryRun) {
  const result = { operationId: operation.id, dryRun, matchedPartIds: [], changes: [], skipped: [] };
  const action = operation.action;
  if (action.type !== "deformer-split") return result;
  if (!operation.target.deformerIds?.includes(action.sourceDeformerId)) {
    result.skipped.push({ partId: action.sourceDeformerId, reason: "deformer-target-mismatch" });
    return result;
  }
  const deformers = rig.deformers ?? (dryRun ? [] : rig.deformers = []);
  const source = deformers.find((entry) => entry.id === action.sourceDeformerId);
  if (!source) {
    result.skipped.push({ partId: action.sourceDeformerId, reason: "deformer-not-found" });
    return result;
  }
  result.matchedPartIds.push(source.id);
  if (source.kind !== "rotate") {
    result.skipped.push({ partId: source.id, reason: "deformer-split-rotate-only" });
    return result;
  }
  if (action.expectedParentId !== void 0 && source.parentId !== action.expectedParentId && source.parentId !== action.parentDeformerId) {
    result.skipped.push({ partId: source.id, reason: "deformer-parent-mismatch" });
    return result;
  }
  const existingParent = deformers.find((entry) => entry.id === action.parentDeformerId);
  if (existingParent && existingParent.id !== source.parentId && existingParent.parentId !== source.parentId) {
    result.skipped.push({ partId: existingParent.id, reason: "deformer-parent-conflict" });
    return result;
  }
  const movedParameters = new Set(action.moveParameterIds);
  if ((source.multiBindings ?? []).some((binding) => binding.parameters.some((parameter) => movedParameters.has(parameter)))) {
    result.skipped.push({ partId: source.id, reason: "deformer-split-multi-binding-conflict" });
    return result;
  }
  const sourceBindings = source.bindings ?? [];
  const movedBindings = sourceBindings.filter((binding) => movedParameters.has(binding.parameter));
  const retainedBindings = sourceBindings.filter((binding) => !movedParameters.has(binding.parameter));
  if (existingParent && existingParent.bindings?.some((binding) => movedBindings.some((moved) => moved.parameter === binding.parameter && moved.property === binding.property))) {
    result.skipped.push({ partId: existingParent.id, reason: "deformer-split-binding-conflict" });
    return result;
  }
  if (source.parentId === action.parentDeformerId && existingParent && movedBindings.length === 0) {
    return result;
  }
  if (!existingParent && movedBindings.length === 0) {
    result.skipped.push({ partId: source.id, reason: "deformer-split-no-bindings" });
    return result;
  }
  const previousParentId = source.parentId;
  if (!existingParent) {
    result.changes.push({ partId: source.id, path: "deformers." + action.parentDeformerId, before: void 0, after: "created" });
  }
  if (previousParentId !== action.parentDeformerId) {
    result.changes.push({ partId: source.id, path: "deformer.parentId", before: previousParentId ?? void 0, after: action.parentDeformerId });
  }
  if (movedBindings.length > 0) {
    result.changes.push({ partId: source.id, path: "deformer.bindings.moved", before: movedBindings.length, after: retainedBindings.length });
  }
  if (dryRun) return result;
  let parent = existingParent;
  if (!parent) {
    parent = {
      id: action.parentDeformerId,
      name: action.parentName ?? source.name + " Body Anchor",
      kind: "rotate",
      parentId: previousParentId,
      visible: source.visible,
      origin: structuredClone(source.origin),
      transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1, pivotX: 0, pivotY: 0, opacity: 1 },
      bindings: [],
      targetPartIds: [],
      tags: []
    };
    const sourceIndex = Math.max(0, deformers.findIndex((entry) => entry.id === source.id));
    deformers.splice(sourceIndex, 0, parent);
  }
  parent.bindings = [...parent.bindings ?? [], ...movedBindings.map((binding) => structuredClone(binding))];
  parent.tags = [.../* @__PURE__ */ new Set([...parent.tags ?? [], "body", "body-anchor", "deformer-split", ...action.parentTags ?? []])];
  source.parentId = parent.id;
  source.bindings = retainedBindings;
  source.tags = [.../* @__PURE__ */ new Set([...source.tags ?? [], "local-angle", "deformer-split", ...action.sourceTags ?? []])];
  return result;
}
function preserveArtMeshBindings(next, previous) {
  const validIds = new Set(next.vertices.map((vertex) => vertex.id));
  const filterOffsets = (offsets) => offsets.filter((offset) => validIds.has(offset.vertexId));
  next.bindings = (previous.bindings ?? []).map((binding) => ({ ...binding, keys: binding.keys.map((key) => ({ ...key, offsets: filterOffsets(key.offsets) })) }));
  next.multiBindings = (previous.multiBindings ?? []).map((binding) => ({ ...binding, keyforms: binding.keyforms.map((keyform) => ({ ...keyform, offsets: filterOffsets(keyform.offsets) })) }));
  next.blendShapes = (previous.blendShapes ?? []).map((shape) => ({ ...shape, offsets: filterOffsets(shape.offsets) }));
  const previousQuality = previous.generator.quality;
  if (previousQuality) {
    const boundaryIds = next.vertices.filter((vertex) => vertex.u === 0 || vertex.u === 1 || vertex.v === 0 || vertex.v === 1).map((vertex) => vertex.id);
    const mergeQualityIds = (ids) => [.../* @__PURE__ */ new Set([...(ids ?? []).filter((id) => validIds.has(id)), ...boundaryIds])];
    next.generator.quality = {
      ...previousQuality,
      boundaryVertexIds: mergeQualityIds(previousQuality.boundaryVertexIds),
      lockedVertexIds: mergeQualityIds(previousQuality.lockedVertexIds),
      pinnedVertexIds: mergeQualityIds(previousQuality.pinnedVertexIds)
    };
  }
  return next;
}
function validateInterpolationOptions(interpolation, curve, label) {
  const allowed = ["linear", "smoothstep", "hold", "arc", "curve"];
  if (interpolation !== void 0 && !allowed.includes(interpolation)) throw new Error(label + " interpolation is invalid");
  if (curve !== void 0 && interpolation !== "curve") throw new Error(label + " curve requires interpolation=curve");
  if (interpolation !== "curve") return;
  if (!curve || !Array.isArray(curve.controlPoints) || curve.controlPoints.length < 2 || curve.controlPoints.length > 16) throw new Error(label + " curve requires 2..16 control points");
  const points = curve.controlPoints;
  if (points.some((point) => !point || !Number.isFinite(point.t) || !Number.isFinite(point.value) || point.t < 0 || point.t > 1 || point.value < 0 || point.value > 1)) throw new Error(label + " curve control points must be finite and normalized");
  for (let index = 1; index < points.length; index += 1) if (points[index - 1].t >= points[index].t) throw new Error(label + " curve control points must be strictly increasing");
  if (Math.abs(points[0].t) > 1e-6 || Math.abs(points[points.length - 1].t - 1) > 1e-6) throw new Error(label + " curve must include t=0 and t=1 endpoints");
}
function validateSymmetryArtMeshLinks(links) {
  if (!Array.isArray(links) || links.length > 256) throw new Error("symmetry-artmesh-bindings links must contain at most 256 entries");
  for (const link of links) {
    if (!link || link.kind !== "part" || typeof link.sourceId !== "string" || !link.sourceId.trim() || typeof link.targetId !== "string" || !link.targetId.trim() || link.sourceId === link.targetId) throw new Error("symmetry-artmesh-bindings link is invalid");
  }
}
function validateSymmetryContract(contract) {
  if (!contract || contract.version !== 1 || contract.axis !== "vertical") throw new Error("symmetry-contract version or axis is invalid");
  if (!Number.isFinite(contract.axisU) || contract.axisU < 0 || contract.axisU > 1) throw new Error("symmetry-contract axisU is invalid");
  if (!Number.isFinite(contract.tolerance) || contract.tolerance <= 0 || contract.tolerance > 0.25) throw new Error("symmetry-contract tolerance is invalid");
  if (!Number.isFinite(contract.confidence) || contract.confidence < 0 || contract.confidence > 1) throw new Error("symmetry-contract confidence is invalid");
  const validateIds = (ids, label) => {
    if (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length) throw new Error("symmetry-contract " + label + " must contain unique non-empty strings");
  };
  validateIds(contract.protectedPartIds, "protectedPartIds");
  validateIds(contract.protectedDeformerIds, "protectedDeformerIds");
  if (!contract.protectedVertexIds || typeof contract.protectedVertexIds !== "object" || Array.isArray(contract.protectedVertexIds)) throw new Error("symmetry-contract protectedVertexIds is invalid");
  for (const [partId, ids] of Object.entries(contract.protectedVertexIds)) {
    if (!partId.trim()) throw new Error("symmetry-contract protectedVertexIds contains an empty part id");
    validateIds(ids, "protectedVertexIds[" + partId + "]");
  }
  if (!Array.isArray(contract.links) || contract.links.length > 256) throw new Error("symmetry-contract links must contain at most 256 entries");
  const kinds = /* @__PURE__ */ new Set(["part", "deformer", "warp-pin", "physics"]);
  for (const link of contract.links) {
    if (!link || !kinds.has(link.kind) || typeof link.sourceId !== "string" || !link.sourceId.trim() || typeof link.targetId !== "string" || !link.targetId.trim() || link.sourceId === link.targetId || link.axis !== "x") throw new Error("symmetry-contract link is invalid");
    if (link.invertX !== void 0 && typeof link.invertX !== "boolean") throw new Error("symmetry-contract link invertX is invalid");
    if (link.preserveY !== void 0 && typeof link.preserveY !== "boolean") throw new Error("symmetry-contract link preserveY is invalid");
  }
}
function validateOperation(operation) {
  if (!operation?.id?.trim() || !operation.name?.trim()) throw new Error("Modeling operation requires id and name");
  if (operation.action?.type === "facial-presets-set") {
    if (!operation.target || typeof operation.target !== "object" || Array.isArray(operation.target) || Object.keys(operation.target).length) throw Error("facial-presets-set is rig-wide; target must be empty");
    return;
  }
  if (!operation.target?.roles?.length && !operation.target?.partIds?.length && !operation.target?.deformerIds?.length) throw new Error("Modeling operation requires a role, partId, or deformerId target");
  const action = operation.action;
  if (!action) throw new Error("Modeling operation requires an action");
  if (action.type === "blend-shape-set" || action.type === "deform-brush") return;
  if (action.type === "part-draw-order") {
    if (typeof action.drawOrder !== "number" || !Number.isFinite(action.drawOrder)) throw new Error("part-draw-order drawOrder must be finite");
    return;
  }
  if (action.type === "part-contour-shade") {
    if (action.shade !== null && !validateContourShade(action.shade)) throw new Error("part-contour-shade is invalid");
    return;
  }
  if (action.type === "part-alpha-reveal") {
    if (action.reveal !== null && !validateAlphaReveal(action.reveal)) throw new Error("part-alpha-reveal is invalid");
    return;
  }
  if (action.type === "symmetry-contract") validateSymmetryContract(action.contract);
  if (action.type === "symmetry-artmesh-bindings") validateSymmetryArtMeshLinks(action.links);
  const values = action.type === "role-confirm" || action.type === "role-reclassify" || action.type === "parameter-add" || action.type === "deformer-create" || action.type === "deformer-kind-set" || action.type === "deformer-targets-set" || action.type === "deformer-parent-set" || action.type === "deformer-origin" || action.type === "deformer-binding-remove" || action.type === "part-visibility" || action.type === "part-blend-mode" || action.type === "part-tint" || action.type === "part-clip" || action.type === "deformer-split" || action.type === "deformer-rotation-metadata" || action.type === "symmetry-contract" || action.type === "symmetry-artmesh-bindings" ? [] : action.type === "transform" || action.type === "deformer-transform" ? [action.value] : action.type === "binding-key" || action.type === "warp-pin-binding-key" || action.type === "deformer-binding-key" ? [action.input, action.value] : action.type === "artmesh-binding-key" ? [action.input, ...action.offsets.flatMap((offset) => [offset.x, offset.y])] : action.type === "artmesh-multi-key" ? [action.inputs[action.parameters[0]], action.inputs[action.parameters[1]], ...action.offsets.flatMap((offset) => [offset.x, offset.y])] : action.type === "artmesh-blend-shape" ? [action.neutralInput, action.targetInput, ...action.offsets.flatMap((offset) => [offset.x, offset.y])] : action.type === "artmesh-mirror-key" ? [action.sourceInput, action.targetInput, action.axisU ?? 0.5, action.tolerance ?? 0.01] : action.type === "artmesh-quality" ? [action.quality?.minTriangleArea ?? 0, action.quality?.maxTriangleAspectRatio ?? 0] : action.type === "artmesh-generate" || action.type === "artmesh-rebuild" ? [action.columns, action.rows, action.alphaThreshold ?? 8] : [action.x, action.y, ...action.uv ? [action.uv.minU, action.uv.maxU, action.uv.minV, action.uv.maxV] : []];
  if (action.type === "part-blend-mode" && !["normal", "multiply", "screen", "additive"].includes(action.mode)) throw new Error("part-blend-mode mode is invalid");
  if (action.type === "part-visibility" && typeof action.visible !== "boolean") throw new Error("part-visibility visible must be boolean");
  if (action.type === "part-tint" && action.tint && validatePartTint(action.tint).length) throw new Error("part-tint tint is invalid");
  if (action.type === "part-clip" && action.clip) {
    const clip = action.clip;
    const hasSingle = typeof clip.maskPartId === "string" && clip.maskPartId.trim().length > 0;
    const maskPartIds = Array.isArray(clip.maskPartIds) ? clip.maskPartIds : void 0;
    const hasMultiple = maskPartIds !== void 0;
    const validMultiple = maskPartIds !== void 0 && maskPartIds.length >= 1 && maskPartIds.length <= 8 && maskPartIds.every((id) => typeof id === "string" && id.trim() === id && id.length > 0) && new Set(maskPartIds).size === maskPartIds.length;
    if (clip.mode !== "alpha" || hasSingle === hasMultiple || hasMultiple && !validMultiple || clip.maskOpacity !== void 0 && clip.maskOpacity !== "rendered" && clip.maskOpacity !== "ignore") throw new Error("part-clip clip is invalid");
  }
  if (action.type === "artmesh-quality") {
    const quality = action.quality;
    if (!quality || typeof quality !== "object") throw new Error("artmesh-quality requires a quality object");
    for (const [name, value] of [["minTriangleArea", quality.minTriangleArea], ["maxTriangleAspectRatio", quality.maxTriangleAspectRatio]]) {
      if (value !== void 0 && (!Number.isFinite(value) || (name === "minTriangleArea" ? value < 0 : value < 1))) throw new Error(`artmesh-quality ${name} is invalid`);
    }
    for (const [name, ids] of [["boundaryVertexIds", quality.boundaryVertexIds], ["lockedVertexIds", quality.lockedVertexIds], ["pinnedVertexIds", quality.pinnedVertexIds]]) {
      if (ids !== void 0 && (!Array.isArray(ids) || ids.some((id) => typeof id !== "string" || !id.trim()) || new Set(ids).size !== ids.length)) throw new Error(`artmesh-quality ${name} must contain unique non-empty strings`);
    }
  }
  if (!values.every(Number.isFinite)) throw new Error("Modeling operation values must be finite");
  if (action.type === "deformer-create") {
    if (!operation.target.deformerIds?.includes(action.deformer.id)) throw new Error("deformer-create target must include deformer id");
    const deformer = action.deformer;
    if (!deformer || !deformer.id?.trim() || !deformer.name?.trim()) throw new Error("deformer-create requires id and name");
    if (!["group", "rotate", "warp"].includes(deformer.kind)) throw new Error("deformer-create kind is invalid");
    if (!deformer.origin || !Number.isFinite(deformer.origin.x) || !Number.isFinite(deformer.origin.y)) throw new Error("deformer-create origin is invalid");
    if (!deformer.transform || [deformer.transform.x, deformer.transform.y, deformer.transform.rotation, deformer.transform.scaleX, deformer.transform.scaleY, deformer.transform.pivotX, deformer.transform.pivotY, deformer.transform.opacity].some((value) => !Number.isFinite(value))) throw new Error("deformer-create transform is invalid");
    if (deformer.parentId !== null && typeof deformer.parentId !== "string") throw new Error("deformer-create parentId is invalid");
    if (deformer.targetPartIds !== void 0 && (!Array.isArray(deformer.targetPartIds) || deformer.targetPartIds.some((id) => typeof id !== "string" || !id.trim()))) throw new Error("deformer-create targetPartIds is invalid");
  }
  if (action.type === "deformer-kind-set") {
    if (!operation.target.deformerIds?.includes(action.deformerId)) throw new Error("deformer-kind-set target must include deformer id");
    if (!action.deformerId?.trim()) throw new Error("deformer-kind-set requires deformerId");
    if (!["group", "rotate", "warp"].includes(action.kind)) throw new Error("deformer-kind-set kind is invalid");
    if (action.warp !== void 0 && (typeof action.warp !== "object" || Array.isArray(action.warp))) throw new Error("deformer-kind-set warp is invalid");
  }
  if (action.type === "deformer-targets-set") {
    if (!operation.target.deformerIds?.includes(action.deformerId)) throw new Error("deformer-targets-set target must include deformer id");
    if (!action.deformerId?.trim()) throw new Error("deformer-targets-set requires deformerId");
    if (!Array.isArray(action.targetPartIds) || action.targetPartIds.some((id) => typeof id !== "string" || !id.trim()) || new Set(action.targetPartIds).size !== action.targetPartIds.length) throw new Error("deformer-targets-set targetPartIds must contain unique non-empty strings");
    if (action.mode !== void 0 && action.mode !== "replace" && action.mode !== "merge") throw new Error("deformer-targets-set mode is invalid");
  }
  if (action.type === "deformer-parent-set") {
    if (!operation.target.deformerIds?.includes(action.deformerId)) throw new Error("deformer-parent-set target must include deformer id");
    if (!action.deformerId?.trim()) throw new Error("deformer-parent-set requires deformerId");
    if (action.parentId !== null && (typeof action.parentId !== "string" || !action.parentId.trim())) throw new Error("deformer-parent-set parentId is invalid");
    if (action.parentId === action.deformerId) throw new Error("deformer-parent-set cannot parent a deformer to itself");
  }
  if (action.type === "deformer-origin") {
    if (!operation.target.deformerIds?.includes(action.deformerId)) throw new Error("deformer-origin target must include deformer id");
    if (!action.deformerId?.trim() || !Number.isFinite(action.x) || !Number.isFinite(action.y)) throw new Error("deformer-origin requires a deformer id and finite x/y");
  }
  if (action.type === "parameter-add") {
    const parameter = action.parameter;
    if (!parameter || typeof parameter !== "object" || !parameter.id?.trim()) throw new Error("parameter-add requires a parameter definition");
    if (!Number.isFinite(parameter.min) || !Number.isFinite(parameter.max) || parameter.min >= parameter.max) throw new Error("parameter-add min/max range is invalid");
    if (!Number.isFinite(parameter.default) || parameter.default < parameter.min || parameter.default > parameter.max) throw new Error("parameter-add default must be within min/max");
    if (parameter.step !== void 0 && (!Number.isFinite(parameter.step) || parameter.step <= 0)) throw new Error("parameter-add step must be positive");
  }
  if (action.type === "role-confirm") {
    if (!operation.target.partIds?.length) throw new Error("role-confirm requires explicit partIds");
    if (action.role === "unknown") throw new Error("role-confirm cannot confirm unknown role");
  }
  if (action.type === "role-reclassify") {
    if (!operation.target.partIds?.length) throw new Error("role-reclassify requires explicit partIds");
    if (action.expectedRole === "unknown" || action.role === "unknown" || action.expectedRole === action.role) throw new Error("role-reclassify requires distinct known roles");
    if (typeof action.reason !== "string" || action.reason.trim().length < 8) throw new Error("role-reclassify requires an audit reason");
  }
  if (action.type === "artmesh-binding-key") {
    validateArtMeshKeyOffsets(action.offsets);
    if (!action.parameter?.trim()) throw new Error("artmesh-binding-key requires parameter");
    validateInterpolationOptions(action.interpolation, action.curve, "artmesh-binding-key");
  }
  if (action.type === "artmesh-mirror-key") {
    if (!action.parameter?.trim() || !Number.isFinite(action.sourceInput) || !Number.isFinite(action.targetInput) || Math.abs(action.sourceInput - action.targetInput) < 1e-4) throw new Error("artmesh-mirror-key requires distinct finite source and target inputs");
    if (action.axisU !== void 0 && (!Number.isFinite(action.axisU) || action.axisU < 0 || action.axisU > 1)) throw new Error("artmesh-mirror-key axisU is invalid");
    if (action.tolerance !== void 0 && (!Number.isFinite(action.tolerance) || action.tolerance <= 0 || action.tolerance > 0.25)) throw new Error("artmesh-mirror-key tolerance is invalid");
    if (action.protectVertexIds !== void 0 && (!Array.isArray(action.protectVertexIds) || action.protectVertexIds.some((id) => typeof id !== "string" || !id.trim()))) throw new Error("artmesh-mirror-key protectVertexIds is invalid");
    validateInterpolationOptions(action.interpolation, action.curve, "artmesh-mirror-key");
  }
  if (action.type === "artmesh-multi-key") {
    validateArtMeshKeyOffsets(action.offsets);
    if (!Array.isArray(action.parameters) || action.parameters.length !== 2 || !action.parameters[0]?.trim() || !action.parameters[1]?.trim() || action.parameters[0] === action.parameters[1]) throw new Error("artmesh-multi-key requires two distinct parameters");
    if (!action.inputs || !Number.isFinite(action.inputs[action.parameters[0]]) || !Number.isFinite(action.inputs[action.parameters[1]])) throw new Error("artmesh-multi-key inputs are invalid");
    validateInterpolationOptions(action.interpolation, action.curve, "artmesh-multi-key");
  }
  if (action.type === "artmesh-blend-shape") {
    validateArtMeshKeyOffsets(action.offsets);
    if (!action.id?.trim() || action.id.length > 80 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(action.id)) throw new Error("artmesh-blend-shape id is invalid");
    if (!action.parameter?.trim() || !Number.isFinite(action.neutralInput) || !Number.isFinite(action.targetInput) || action.neutralInput === action.targetInput) throw new Error("artmesh-blend-shape requires distinct finite neutral and target inputs");
    validateInterpolationOptions(action.interpolation, action.curve, "artmesh-blend-shape");
  }
  if (action.type === "artmesh-generate" || action.type === "artmesh-rebuild") {
    const label = action.type;
    if (!["eyelid", "eye", "mouth", "outline", "hair-root", "face-feature"].includes(action.preset)) throw new Error(`${label} preset is invalid`);
    if (action.topology !== void 0 && !["rect-grid", "alpha-contour"].includes(action.topology)) throw new Error(`${label} topology is invalid`);
    if (!Number.isInteger(action.columns) || action.columns < 1 || action.columns > 16 || !Number.isInteger(action.rows) || action.rows < 1 || action.rows > 16) throw new Error(`${label} columns/rows must be integers from 1 to 16`);
    if (action.alphaThreshold !== void 0 && (!Number.isInteger(action.alphaThreshold) || action.alphaThreshold < 1 || action.alphaThreshold > 255)) throw new Error(`${label} alphaThreshold must be an integer from 1 to 255`);
    if (action.type === "artmesh-rebuild" && action.preserveBindings !== void 0 && typeof action.preserveBindings !== "boolean") throw new Error("artmesh-rebuild preserveBindings must be boolean");
  }
  if (action.type === "deformer-transform" && !["x", "y", "rotation", "scaleX", "scaleY", "opacity"].includes(action.property)) throw new Error("deformer-transform property is invalid");
  if (action.type === "binding-key" && !["x", "y", "rotation", "scaleX", "scaleY", "opacity"].includes(action.property)) throw new Error("binding-key property is invalid");
  if (action.type === "binding-key") validateInterpolationOptions(action.interpolation, action.curve, "binding-key");
  if (action.type === "deformer-binding-key") {
    if (!action.deformerId?.trim() || !action.parameter?.trim()) throw new Error("deformer-binding-key requires deformerId and parameter");
    if (!["x", "y", "rotation", "scaleX", "scaleY", "opacity", "warp.bendX", "warp.bendY", "warp.taperX", "warp.taperY"].includes(action.property)) throw new Error("deformer-binding-key property is invalid");
    validateInterpolationOptions(action.interpolation, action.curve, "deformer-binding-key");
  }
  if (action.type === "deformer-binding-remove") {
    if (!operation.target.deformerIds?.includes(action.deformerId)) throw new Error("deformer-binding-remove target must include deformerId");
    if (!action.deformerId?.trim() || !action.parameter?.trim()) throw new Error("deformer-binding-remove requires deformerId and parameter");
    if (!["x", "y", "rotation", "scaleX", "scaleY", "opacity", "warp.bendX", "warp.bendY", "warp.taperX", "warp.taperY"].includes(action.property)) throw new Error("deformer-binding-remove property is invalid");
  }
  if (action.type === "deformer-rotation-metadata") {
    if (!operation.target.deformerIds?.includes(action.deformerId)) throw new Error("deformer-rotation-metadata target must include deformerId");
    if (!action.deformerId?.trim()) throw new Error("deformer-rotation-metadata requires deformerId");
    const metadata = action.metadata;
    if (!metadata || metadata.version !== 1 || metadata.angleUnit !== "deg") throw new Error("deformer-rotation-metadata version or angleUnit is invalid");
    if (!metadata.angleRange || !Number.isFinite(metadata.angleRange.min) || !Number.isFinite(metadata.angleRange.max) || metadata.angleRange.min >= metadata.angleRange.max || metadata.angleRange.min < -360 || metadata.angleRange.max > 360) throw new Error("deformer-rotation-metadata angleRange is invalid");
    if (!metadata.pivot || !Number.isFinite(metadata.pivot.x) || !Number.isFinite(metadata.pivot.y) || !["stage", "normalized"].includes(metadata.pivotSpace)) throw new Error("deformer-rotation-metadata pivot is invalid");
    if (metadata.pivotSpace === "normalized" && (metadata.pivot.x < 0 || metadata.pivot.x > 1 || metadata.pivot.y < 0 || metadata.pivot.y > 1)) throw new Error("deformer-rotation-metadata normalized pivot is invalid");
    if (!["rigid", "rigid-plus-warp", "none"].includes(metadata.shapePreservation) || !["parent-first", "child-first"].includes(metadata.parentComposition)) throw new Error("deformer-rotation-metadata composition is invalid");
  }
  if (action.type === "deformer-split") {
    if (!operation.target.deformerIds?.includes(action.sourceDeformerId)) throw new Error("deformer-split target must include sourceDeformerId");
    if (!action.sourceDeformerId?.trim() || !action.parentDeformerId?.trim() || action.sourceDeformerId === action.parentDeformerId) throw new Error("deformer-split requires distinct source and parent ids");
    if (!Array.isArray(action.moveParameterIds) || !action.moveParameterIds.length || action.moveParameterIds.some((id) => typeof id !== "string" || !id.trim()) || new Set(action.moveParameterIds).size !== action.moveParameterIds.length) throw new Error("deformer-split moveParameterIds must contain unique non-empty strings");
    for (const [name, tags] of [["parentTags", action.parentTags], ["sourceTags", action.sourceTags]]) {
      if (tags !== void 0 && (!Array.isArray(tags) || tags.some((tag) => typeof tag !== "string" || !tag.trim()) || new Set(tags).size !== tags.length)) throw new Error("deformer-split " + name + " is invalid");
    }
    if (action.parentName !== void 0 && (!action.parentName.trim() || action.parentName.length > 120)) throw new Error("deformer-split parentName is invalid");
    if (action.expectedParentId !== void 0 && !action.expectedParentId.trim()) throw new Error("deformer-split expectedParentId is invalid");
  }
  if (action.type === "warp-pin-binding-key") {
    if (!action.deformerId?.trim() || !action.pinId?.trim() || !action.parameter?.trim()) throw new Error("warp-pin-binding-key requires deformerId, pinId, and parameter");
    if (!["offsetX", "offsetY"].includes(action.property)) throw new Error("warp-pin-binding-key property is invalid");
    validateInterpolationOptions(action.interpolation, action.curve, "warp-pin-binding-key");
  }
  if (action.type === "artmesh-offset" && action.uv && (action.uv.minU > action.uv.maxU || action.uv.minV > action.uv.maxV)) throw new Error("Modeling operation UV bounds are invalid");
}
export {
  DEFAULT_PARAMETERS,
  DEFAULT_TRANSFORM,
  RigRuntime,
  addArtMeshVertex,
  createRectArtMesh,
  defaultWarpDeformer,
  evaluateRigParts,
  executeModelingOperation,
  removeArtMeshVertex,
  resolveArtMesh,
  resolveRigFrame,
  retriangulateArtMesh
};
