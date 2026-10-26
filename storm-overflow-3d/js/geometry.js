// Model-space geometry for the moving water, and model metres -> longitude/latitude.
//
// Model axes (as src/cutaway.py): x along the street (east), y back from the cut face (north),
// z up with street level 0. The SDK's local vertex space uses the same east/north/up metres,
// so meshes use model coordinates directly; polygons (water surfaces) are converted to degrees.
// Plain ES module with no SDK dependency.

// Where the model sits: open sea south-west of the Isles of Scilly, as in the Pro cutaway, so it
// cannot be read as a real site. It is lifted so the soil block stands on the ground like a
// diorama (the scene's ground is at 0 m).
export const ORIGIN = { longitude: -7.0, latitude: 50.0 };
export const LIFT = 6.5;  // = -SOIL_BOTTOM: the soil block stands on the ground
const EARTH_RADIUS = 6378137;

export function toLonLat(x, y, z = 0) {
  const lat0 = (ORIGIN.latitude * Math.PI) / 180;
  return [
    ORIGIN.longitude + ((x / (EARTH_RADIUS * Math.cos(lat0))) * 180) / Math.PI,
    ORIGIN.latitude + ((y / EARTH_RADIUS) * 180) / Math.PI,
    z + LIFT,
  ];
}

// Ground surface height at x from the model's profile [[x, z], ...].
export function groundZ(x, profile) {
  for (let i = 0; i < profile.length - 1; i++) {
    const [x0, z0] = profile[i], [x1, z1] = profile[i + 1];
    if (x >= x0 && x <= x1) return x1 === x0 ? z0 : z0 + ((x - x0) * (z1 - z0)) / (x1 - x0);
  }
  return profile.at(-1)[1];
}

// x of the near and far water's edge at a level.
export function riverEdges(level, profile) {
  const crossings = [];
  for (let i = 0; i < profile.length - 1; i++) {
    const [x0, z0] = profile[i], [x1, z1] = profile[i + 1];
    if ((z0 - level) * (z1 - level) < 0) crossings.push(x0 + ((level - z0) * (x1 - x0)) / (z1 - z0));
  }
  return [crossings[0], crossings.at(-1)];
}

// The river in front elevation (x-z polygon) between the bed and a level.
export function riverSection(level, profile) {
  const [near, far] = riverEdges(level, profile);
  const bed = profile.filter(([x, z]) => x > near && x < far && z < level);
  return [[near, level], ...bed, [far, level]];
}

// A convex polygon fanned from its first vertex: index triples.
function fan(count, offset = 0, reverse = false) {
  const faces = [];
  for (let i = 1; i < count - 1; i++) {
    faces.push(...(reverse ? [offset, offset + i + 1, offset + i] : [offset, offset + i, offset + i + 1]));
  }
  return faces;
}

// Extrude a convex 2D polygon between two positions of a mapping to 3D: {positions, faces}.
function prism(polygon, to3d, w0, w1) {
  const count = polygon.length;
  const positions = [];
  for (const w of [w0, w1]) for (const [u, v] of polygon) positions.push(...to3d(u, v, w));
  const faces = [...fan(count, 0, true), ...fan(count, count)];
  for (let i = 0; i < count; i++) {
    const j = (i + 1) % count;
    faces.push(i, j, j + count, i, j + count, i + count);
  }
  return { positions, faces };
}

export const prismY = (polygonXZ, y0, y1) => prism(polygonXZ, (x, z, y) => [x, y, z], y0, y1);
export const prismZ = (polygonXY, z0, z1) => prism(polygonXY, (x, y, z) => [x, y, z], z0, z1);
export const box = (x0, x1, y0, y1, z0, z1) => prismZ([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z0, z1);

// The back half (y >= 0) of the water in a pipe running along x from xStart to xEnd, with the
// invert falling linearly from invertStart to invertEnd; depth above the invert.
export function pipeWater(radius, depth, xStart, xEnd, invertStart, invertEnd, segments = 14) {
  depth = Math.max(0, Math.min(depth, 2 * radius));
  if (depth < 1e-3) return null;
  const level = depth - radius;
  const top = Math.asin(Math.max(-1, Math.min(1, level / radius)));
  const section = [];  // (y, v) with v up from the pipe centre
  for (let i = 0; i <= segments; i++) {
    const a = -Math.PI / 2 + ((top + Math.PI / 2) * i) / segments;
    section.push([radius * Math.cos(a), radius * Math.sin(a)]);
  }
  section.push([0, level]);
  const centre = (x) => invertStart + ((x - xStart) * (invertEnd - invertStart)) / (xEnd - xStart) + radius;
  return prism(section, (y, v, x) => [x, y, centre(x) + v], xStart, xEnd);
}

// Merge {positions, faces} meshes into one.
export function merge(meshes) {
  const positions = [], faces = [];
  for (const mesh of meshes.filter(Boolean)) {
    const offset = positions.length / 3;
    positions.push(...mesh.positions);
    faces.push(...mesh.faces.map((index) => index + offset));
  }
  return { positions, faces };
}

// A horizontal ring in model x-y at height z, as [lon, lat, z] for a polygon.
export function ringLonLat(pointsXY, z) {
  const ring = pointsXY.map(([x, y]) => toLonLat(x, y, z));
  ring.push(ring[0]);
  return ring;
}

// The moving water at one simulation record, as model-space meshes and plan polygons.
// d: the model's dimensions (data/structure.json). Returns {meshes: {name: mesh|null}, surfaces: {name: {ring, z}|null}}.
export function waterAt(record, d) {
  const [chamberX0, chamberX1] = d.CHAMBER_X;
  const [weirX0, weirX1] = d.WEIR_X;
  const level = record.level;
  const head = Math.max(0, level - d.WEIR_CREST);
  const sewerR = d.SEWER_DIAMETER / 2 - 0.01;
  const sewerDepth = Math.max(0.12, level - d.SEWER_INVERT_END);
  const meshes = {
    sewer: pipeWater(sewerR, sewerDepth, d.SEWER_START, d.SEWER_END + 0.01, d.SEWER_INVERT_START, d.SEWER_INVERT_END),
    chamber: box(chamberX0 + 0.01, weirX0, 0.01, d.CHAMBER_Y - 0.01, d.CHAMBER_FLOOR + 0.001, Math.max(d.CHAMBER_FLOOR + 0.05, level)),
    spill: null,
    river: prismY(riverSection(record.river, d.GROUND_PROFILE), 0.0, d.SOIL_BACK),
  };
  const surfaces = { plume: null, flood: null, runoff: null };
  if (record.spill > 0) {
    // Over the weir and through the screen, down onto the benching, along the overflow pipe.
    const fall = weirX1 + 0.12;
    const flowDepth = Math.min(0.25, 0.05 + 0.8 * head);
    const sheet = [
      [weirX0, d.WEIR_CREST + head], [weirX1 + 0.02, d.WEIR_CREST + head], [fall + 0.15, d.BENCHING + flowDepth + 0.02],
      [chamberX1, d.BENCHING + flowDepth], [chamberX1, d.BENCHING], [fall, d.BENCHING + flowDepth],
      [weirX1, d.WEIR_CREST], [weirX0, d.WEIR_CREST],
    ];
    const overR = d.OVERFLOW_DIAMETER / 2 - 0.01;
    const pipeDepth = Math.min(d.OVERFLOW_DIAMETER * 0.8, 0.04 + 1.4 * head);
    meshes.spill = merge([
      fanSheet(sheet, 0.01, d.CHAMBER_Y - 0.01),
      pipeWater(overR, pipeDepth, chamberX1, d.OVERFLOW_END, d.OVERFLOW_INVERT_START, d.OVERFLOW_INVERT_END),
      prismY([[d.OVERFLOW_END, d.OVERFLOW_INVERT_END + 2 * Math.min(0.3, 0.05 + head)], [d.OVERFLOW_END, d.OVERFLOW_INVERT_END],
              [riverEdges(record.river, d.GROUND_PROFILE)[0] + 0.25, record.river - 0.04],
              [riverEdges(record.river, d.GROUND_PROFILE)[0] + 0.6, record.river + 0.02]], 0.05, 0.75),
    ]);
    // The plume spreads downstream (away from the viewer) from the outfall.
    const near = riverEdges(record.river, d.GROUND_PROFILE)[0];
    const size = Math.min(1, record.spill / 0.3);
    surfaces.plume = {
      ring: ringLonLat([[near + 0.1, 0.05], [near + 0.9 + 1.2 * size, 0.05], [near + 0.8 + 2.4 * size, 4 + 6 * size],
                        [near + 0.4 + 1.6 * size, 7 + 9 * size], [near + 0.1, 5 + 6 * size]], record.river + 0.01),
      z: record.river + 0.01,
    };
  }
  if (record.floodDepth > 0.003) {
    const depth = Math.min(0.3, record.floodDepth);
    const end = d.GROUND_PROFILE[1][0] - 0.45;
    surfaces.flood = { ring: ringLonLat([[0.05, 0.05], [end, 0.05], [end, 9.5], [0.05, 9.5]], depth), z: depth };
  } else if (record.rain > 1) {
    // Runoff running along the kerb towards the gullies.
    const width = Math.min(1.2, 0.25 + record.rain / 40);
    const end = d.GROUND_PROFILE[1][0] - 0.6;
    surfaces.runoff = { ring: ringLonLat([[0.2, 6.95 - width], [end, 6.95 - width], [end, 6.94], [0.2, 6.94]], 0.015), z: 0.015 };
  }
  return { meshes, surfaces };
}

// The spill sheet is concave in section, so build it from quads between paired points.
function fanSheet(sheet, y0, y1) {
  // sheet: upper surface left->right (first half), then lower surface right->left (second half).
  const half = sheet.length / 2;
  const meshes = [];
  for (let i = 0; i < half - 1; i++) {
    const a = sheet[i], b = sheet[i + 1], c = sheet[sheet.length - 2 - i], e = sheet[sheet.length - 1 - i];
    meshes.push(prismY([e, c, b, a].reverse(), y0, y1));
  }
  return merge(meshes);
}
