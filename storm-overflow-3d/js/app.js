// The 3D scene: the cutaway's static geometry (data/structure.json), the moving water from the
// storage model (model.js, geometry.js), the SDK's rain, and the controls.

import { LIFT, ORIGIN, toLonLat, waterAt } from "./geometry.js";
import { drawChart } from "./chart.js";
import { GROUND, PRESETS, STORM_START, formatClock, monitorText, simulate, summary } from "./model.js";

const [
  Map, SceneView, Ground, Graphic, GraphicsLayer, Camera, Point, Polygon, SpatialReference, Mesh, MeshComponent,
  MeshLocalVertexSpace, MeshMaterialMetallicRoughness, MeshSymbol3D, FillSymbol3DLayer, SolidEdges3D,
  PolygonSymbol3D, WaterSymbol3DLayer, PointSymbol3D, TextSymbol3DLayer, LineCallout3D, RainyWeather,
  CloudyWeather, SunnyWeather,
] = await $arcgis.import([
  "@arcgis/core/Map.js", "@arcgis/core/views/SceneView.js", "@arcgis/core/Ground.js", "@arcgis/core/Graphic.js",
  "@arcgis/core/layers/GraphicsLayer.js", "@arcgis/core/Camera.js", "@arcgis/core/geometry/Point.js",
  "@arcgis/core/geometry/Polygon.js", "@arcgis/core/geometry/SpatialReference.js", "@arcgis/core/geometry/Mesh.js",
  "@arcgis/core/geometry/support/MeshComponent.js", "@arcgis/core/geometry/support/MeshLocalVertexSpace.js",
  "@arcgis/core/geometry/support/MeshMaterialMetallicRoughness.js", "@arcgis/core/symbols/MeshSymbol3D.js",
  "@arcgis/core/symbols/FillSymbol3DLayer.js", "@arcgis/core/symbols/edges/SolidEdges3D.js",
  "@arcgis/core/symbols/PolygonSymbol3D.js", "@arcgis/core/symbols/WaterSymbol3DLayer.js",
  "@arcgis/core/symbols/PointSymbol3D.js", "@arcgis/core/symbols/TextSymbol3DLayer.js",
  "@arcgis/core/symbols/callouts/LineCallout3D.js", "@arcgis/core/views/3d/environment/RainyWeather.js",
  "@arcgis/core/views/3d/environment/CloudyWeather.js", "@arcgis/core/views/3d/environment/SunnyWeather.js",
]);

const WGS84 = SpatialReference.WGS84;
const SIM_MINUTES_PER_SECOND = { slow: 4, normal: 12, fast: 40 };
// Model-space cameras: x, y, z (m, street level 0), heading (deg clockwise from north), pitch (deg, down < 0).
const VIEWS = {
  overview: [23, -50, 15, 0, -17],
  street: [6, -16, 7, 25, -22],
  chamber: [15.5, -10, -1.0, 8, -9],
  outfall: [27, -9, 0.5, 20, -14],
};
const WATER = {
  sewage: [122, 104, 72, 0.88],
  storm: [110, 122, 104, 0.82],
  spill: [158, 104, 40, 0.95],
  river: [70, 112, 132, 0.78],
};
// Screen heights of the label callouts (px), so the labels around the chamber do not overlap.
const LABEL_OFFSETS = { "Weir": 18, "Screen": 48, "To the treatment works": 80, "Event duration monitor (EDM)": 40 };
// ?compact keeps only these labels, shortened to one word.
const SHORT_LABELS = {
  "Combined sewer: sewage and rainwater share one pipe": "Sewer", "To the treatment works": "To works", "Weir": "Weir",
  "Event duration monitor (EDM)": "Monitor", "River": "River",
};
const CLOUD = '<path d="M7 14h10.5a3.5 3.5 0 0 0 .3-7 5.5 5.5 0 0 0-10.6 1.2A3 3 0 0 0 7 14z"/>';
const ICONS = {
  drizzle: `${CLOUD}<path d="M12 17v2"/>`,
  steady: `${CLOUD}<path d="M9.5 17v2M14.5 17v2"/>`,
  shower: `${CLOUD}<path d="M8 17l-1 3M12 17l-1 3M16 17l-1 3"/>`,
  thunder: `${CLOUD}<path d="M13 15l-3 4h4l-2 3"/>`,
  play: '<path class="solid" d="M8 5.5v13l10.5-6.5z"/>',
  pause: '<path class="solid" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>',
  labels: '<path d="M4 5h16v10H10l-4 4v-4H4z"/>',
};
const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const LOOP_PAUSE_MS = 2000;
const NO_EDGES = new Set(["subsoil", "topsoil", "grass", "tree_crown", "road_marking"]);
const ROUGHNESS = { metal: 0.45, window: 0.15, sensor: 0.5, asphalt: 0.9, slate: 0.7 };

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
// ?compact: for a small box (e.g. an Experience Builder Embed widget): icon bar, one-word labels, storm on a loop.
const COMPACT = params.has("compact");
if (COMPACT) document.body.classList.add("compact");
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;
const state = { records: [], minute: 0, playing: false, speed: "normal", intensity: 25, hours: 1, ground: "dry" };

function material(color, name) {
  const rgba = color.length === 4 ? color : [...color.map((c) => Math.round(c * 255)), 1];
  return new MeshMaterialMetallicRoughness({
    color: rgba,
    metallic: name === "metal" ? 0.6 : 0,
    roughness: ROUGHNESS[name] ?? 0.85,
    doubleSided: true,
    alphaMode: rgba[3] < 1 ? "blend" : "opaque",
  });
}

function mesh({ positions, faces }, meshMaterial) {
  return new Mesh({
    vertexSpace: new MeshLocalVertexSpace({ origin: toLonLat(0, 0, 0) }),
    vertexAttributes: { position: new Float64Array(positions) },
    components: [new MeshComponent({ faces: new Uint32Array(faces), material: meshMaterial, shading: "flat" })],
    spatialReference: WGS84,
  });
}

function meshSymbol(edges) {
  return new MeshSymbol3D({
    symbolLayers: [new FillSymbol3DLayer({
      edges: edges ? new SolidEdges3D({ color: [30, 30, 30, 0.22], size: 0.6 }) : null,
    })],
  });
}

function waterSymbol(color, strength = "rippled") {
  return new PolygonSymbol3D({
    symbolLayers: [new WaterSymbol3DLayer({ color, waveStrength: strength, waterbodySize: "small", waveDirection: 180 })],
  });
}

function camera(name) {
  const [x, y, z, heading, pitch] = VIEWS[name];
  const [longitude, latitude, height] = toLonLat(x, y, z);
  return new Camera({
    position: new Point({ longitude, latitude, z: height, spatialReference: WGS84 }),
    heading,
    tilt: 90 + pitch,
  });
}

async function main() {
  const structure = await (await fetch("data/structure.json")).json();
  const d = structure.dimensions;

  const staticLayer = new GraphicsLayer({ title: "Model" });
  for (const [name, part] of Object.entries(structure.meshes)) {
    staticLayer.add(new Graphic({
      geometry: mesh({ positions: part.positions, faces: part.triangles }, material(structure.materials[name], name)),
      symbol: meshSymbol(!NO_EDGES.has(name)),
    }));
  }
  const waterLayer = new GraphicsLayer({ title: "Water" });
  const surfaceLayer = new GraphicsLayer({ title: "Water surfaces", elevationInfo: { mode: "absolute-height" } });
  const labelLayer = new GraphicsLayer({ title: "Labels", elevationInfo: { mode: "absolute-height" } });
  // Labels stay hidden: clicking the model shows the nearest one, "All labels" shows every one.
  const labels = [];
  let allLabels = false;
  function showLabels(only) {
    for (const label of labels) label.visible = allLabels || label === only;
  }
  for (const label of structure.labels) {
    const text = COMPACT ? SHORT_LABELS[label.text] : label.text;
    if (!text) continue;
    const [longitude, latitude, z] = toLonLat(label.x, label.y, label.z);
    labels.push(new Graphic({
      geometry: new Point({ longitude, latitude, z, spatialReference: WGS84 }),
      symbol: new PointSymbol3D({
        symbolLayers: [new TextSymbol3DLayer({
          text, size: 11, material: { color: [33, 37, 41] },
          halo: { color: [255, 255, 255, 0.85], size: 0.8 }, background: { color: [255, 255, 255, 0.85] },
        })],
        verticalOffset: { screenLength: LABEL_OFFSETS[label.text] ?? 28, maxWorldLength: 6, minWorldLength: 0.4 },
        callout: new LineCallout3D({ size: 0.75, color: [33, 37, 41, 0.8], border: { color: [255, 255, 255, 0.7] } }),
      }),
    }));
  }

  labelLayer.addMany(labels);
  showLabels(null);

  const water = {
    sewer: new Graphic({ symbol: meshSymbol(false) }),
    chamber: new Graphic({ symbol: meshSymbol(false) }),
    spill: new Graphic({ symbol: meshSymbol(false) }),
    river: new Graphic({ symbol: meshSymbol(false) }),
  };
  waterLayer.addMany(Object.values(water));
  const surfaces = {
    riverTop: new Graphic({ symbol: waterSymbol([62, 104, 122]) }),
    plume: new Graphic({ symbol: waterSymbol([120, 92, 52], "slight") }),
    flood: new Graphic({ symbol: waterSymbol([128, 112, 84]) }),
    runoff: new Graphic({ symbol: waterSymbol([150, 160, 150], "calm") }),
  };
  surfaceLayer.addMany(Object.values(surfaces));

  const map = new Map({
    ground: new Ground({ surfaceColor: [214, 218, 212] }),
    layers: [staticLayer, waterLayer, surfaceLayer, labelLayer],
  });
  const view = new SceneView({
    container: "view",
    map,
    qualityProfile: "high",
    camera: camera("overview"),
    environment: {
      atmosphereEnabled: true,
      lighting: { type: "sun", date: new Date("2025-09-20T12:30:00Z"), directShadowsEnabled: true },
      weather: new SunnyWeather({ cloudCover: 0.2 }),
    },
    ui: { components: [] },  // 5.x widgets are components; no Esri basemap data is shown
  });
  await view.when();
  // Keep the model clear of the panel (beside it on a wide screen, above it on a phone) or the compact bar.
  // The padding follows the panel's actual size, so it stays right as the panel is resized or hidden.
  const panel = $("panel");
  const narrow = () => window.innerWidth <= 700;
  const pad = () => {
    if (COMPACT) { view.padding = { bottom: 48 }; return; }
    if (panel.classList.contains("hidden")) { view.padding = {}; return; }
    const box = panel.getBoundingClientRect();
    view.padding = narrow() ? { bottom: Math.round(window.innerHeight - box.top) } : { left: Math.round(box.right + 16) };
  };
  new ResizeObserver(pad).observe(panel);
  window.addEventListener("resize", pad);
  setupPanel(panel, narrow, pad);

  const materials = {
    sewage: material(WATER.sewage), storm: material(WATER.storm), spill: material(WATER.spill), river: material(WATER.river),
  };
  let weatherKey = "";
  let moveCursor = () => {};

  function render() {
    const record = state.records[state.minute];
    const { meshes, surfaces: plan } = waterAt(record, d);
    const flowing = record.rain > 0 || record.level > d.WEIR_CREST - 0.5;
    const sewerMaterial = flowing ? materials.storm : materials.sewage;
    water.sewer.geometry = meshes.sewer ? mesh(meshes.sewer, sewerMaterial) : null;
    water.chamber.geometry = mesh(meshes.chamber, sewerMaterial);
    water.spill.geometry = meshes.spill ? mesh(meshes.spill, materials.spill) : null;
    water.river.geometry = mesh(meshes.river, materials.river);
    const [riverNear, riverFar] = [d.GROUND_PROFILE[1][0] + 0.1, d.GROUND_PROFILE[4][0] - 0.1];
    surfaces.riverTop.geometry = polygonAt([[riverNear, 0.02], [riverFar, 0.02], [riverFar, d.SOIL_BACK], [riverNear, d.SOIL_BACK]], record.river + 0.003);
    for (const name of ["plume", "flood", "runoff"]) {
      surfaces[name].geometry = plan[name] ? new Polygon({ rings: [plan[name].ring], spatialReference: WGS84 }) : null;
    }
    updateWeather(record);
    updateReadouts(record);
    moveCursor(state.minute);
    $("time").value = state.minute;
    $("mini-time").value = state.minute;
  }

  function polygonAt(pointsXY, z) {
    const ring = pointsXY.map(([x, y]) => toLonLat(x, y, z));
    ring.push(ring[0]);
    return new Polygon({ rings: [ring], spatialReference: WGS84 });
  }

  function updateWeather(record) {
    const records = state.records;
    const nearRain = records.slice(Math.max(0, state.minute - 40), state.minute + 20).some((r) => r.rain > 0);
    // Precipitation starts at 0.4 so even light rain shows in the view.
    const precipitation = Math.min(1, 0.4 + record.rain / 50);
    const key = record.rain > 0 ? `rain-${Math.round(precipitation * 10)}` : nearRain ? "cloud" : "sun";
    if (key === weatherKey) return;
    weatherKey = key;
    view.environment.weather = record.rain > 0
      ? new RainyWeather({ cloudCover: 0.85, precipitation })
      : nearRain ? new CloudyWeather({ cloudCover: 0.7 }) : new SunnyWeather({ cloudCover: 0.2 });
  }

  function updateReadouts(record) {
    $("clock").textContent = formatClock(record.clock);
    const monitor = monitorText(state.records, state.minute);
    $("mini").dataset.status = record.spilling ? "spill" : record.rain > 0 ? "rain" : "dry";
    $("mini-status-text").textContent = record.spilling ? monitor.replace("Spilling for", "Spilling")
      : record.rain > 0 ? "Raining" : "Dry";
  }

  function rerun() {
    state.records = simulate({ intensity: state.intensity, hours: state.hours, ground: state.ground });
    moveCursor = drawChart($("chart"), state.records, summary(state.records).events);
    $("time").max = state.records.length - 1;
    $("mini-time").max = state.records.length - 1;
    $("intensity-value").textContent = `${state.intensity} mm/h`;
    $("hours-value").textContent = state.hours < 1 ? `${state.hours * 60} min` : `${state.hours} h`;
    for (const button of document.querySelectorAll("[data-preset]")) {
      const preset = PRESETS.find((p) => p.id === button.dataset.preset);
      button.setAttribute("aria-pressed", String(preset.intensity === state.intensity && preset.hours === state.hours));
    }
    render();
  }

  // Controls. In compact mode the storm replays after a short pause until the viewer pauses or scrubs it.
  let autoLoop = COMPACT && !REDUCED_MOTION;
  function choosePreset(preset) {
    state.intensity = preset.intensity;
    state.hours = preset.hours;
    $("intensity").value = preset.intensity;
    $("hours").value = preset.hours;
    state.minute = STORM_START;
    autoLoop = COMPACT;
    rerun();
    play(true);
  }
  for (const preset of PRESETS) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.preset = preset.id;
    button.innerHTML = `${preset.label}<small>${preset.intensity} mm/h, ${preset.hours < 1 ? `${preset.hours * 60} min` : `${preset.hours} h`}</small>`;
    button.addEventListener("click", () => choosePreset(preset));
    $("presets").appendChild(button);

    const icon = document.createElement("button");
    icon.type = "button";
    icon.className = "icon";
    icon.dataset.preset = preset.id;
    icon.title = preset.label;
    icon.setAttribute("aria-label", preset.label);
    icon.innerHTML = svg(preset.id);
    icon.addEventListener("click", () => choosePreset(preset));
    $("mini-storms").appendChild(icon);
  }
  $("mini-play").addEventListener("click", () => { autoLoop = COMPACT && !state.playing; play(!state.playing); });
  $("mini-time").addEventListener("input", (event) => { autoLoop = false; state.minute = Number(event.target.value); render(); });
  $("mini-labels").innerHTML = svg("labels");
  $("mini-labels").addEventListener("click", (event) => {
    allLabels = !allLabels;
    showLabels(null);
    event.currentTarget.setAttribute("aria-pressed", String(allLabels));
  });
  // Moving a rain slider while paused in a dry minute jumps to full rain, so the change shows in the view.
  function showRain() {
    if (!state.playing && !(state.records[state.minute]?.rain > 0)) state.minute = STORM_START + Math.min(10, state.hours * 30);
  }
  $("intensity").addEventListener("input", (event) => { state.intensity = Number(event.target.value); showRain(); rerun(); });
  $("hours").addEventListener("input", (event) => { state.hours = Number(event.target.value); showRain(); rerun(); });
  for (const radio of document.querySelectorAll("input[name=ground]")) {
    radio.addEventListener("change", (event) => { state.ground = event.target.value; rerun(); });
  }
  $("ground-wet-label").textContent = GROUND.wet.label;
  $("time").addEventListener("input", (event) => { state.minute = Number(event.target.value); render(); });
  $("play").addEventListener("click", () => play(!state.playing));
  $("speed").addEventListener("change", (event) => { state.speed = event.target.value; });
  $("labels").addEventListener("change", (event) => { allLabels = event.target.checked; showLabels(null); });
  let clicked = null;
  view.on("click", (event) => {
    if (allLabels) return;
    let nearest = null, best = 120;  // px: a click further than this from every label clears it
    for (const label of labels) {
      const at = view.toScreen(label.geometry);
      const distance = at ? Math.hypot(at.x - event.x, at.y - event.y) : Infinity;
      if (distance < best) [nearest, best] = [label, distance];
    }
    clicked = nearest === clicked ? null : nearest;
    showLabels(clicked);
  });
  for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => view.goTo(camera(button.dataset.view), { duration: 1500 }));
  }

  let last = null, carry = 0;
  function play(on) {
    state.playing = on;
    $("play").textContent = on ? "Pause" : "Play";
    $("play").setAttribute("aria-pressed", String(on));
    $("mini-play").innerHTML = svg(on ? "pause" : "play");
    $("mini-play").setAttribute("aria-label", on ? "Pause" : "Play");
    if (on && state.minute >= state.records.length - 1) state.minute = STORM_START;
    last = null;
    if (on) requestAnimationFrame(tick);
  }
  function tick(now) {
    if (!state.playing) return;
    if (last !== null) {
      carry += ((now - last) / 1000) * SIM_MINUTES_PER_SECOND[state.speed];
      const steps = Math.floor(carry);
      if (steps > 0) {
        carry -= steps;
        state.minute = Math.min(state.records.length - 1, state.minute + steps);
        render();
        if (state.minute === state.records.length - 1) {
          play(false);
          if (autoLoop) setTimeout(() => { if (autoLoop && !state.playing) play(true); }, LOOP_PAUSE_MS);
          return;
        }
      }
    }
    last = now;
    requestAnimationFrame(tick);
  }

  rerun();
  $("mini-play").innerHTML = svg("play");
  if (autoLoop) play(true);
  window.__overflowScene = { view, state, ORIGIN, LIFT };  // for debugging in the console
}

// Drag the panel's edge (right edge on a wide screen, top on a phone) or use the arrow keys on it to resize.
function setupPanel(panel, narrow, onChange) {
  const root = document.documentElement.style;
  const handle = $("resize");
  handle.setAttribute("aria-orientation", narrow() ? "horizontal" : "vertical");
  const limits = () => narrow()
    ? { min: 120, max: Math.round(window.innerHeight * 0.85) }
    : { min: 240, max: Math.min(640, Math.round(window.innerWidth * 0.6)) };
  const set = (px) => {
    const { min, max } = limits();
    const size = Math.round(Math.min(max, Math.max(min, px)));
    root.setProperty(narrow() ? "--panel-h" : "--panel-w", `${size}px`);
    try { localStorage.setItem(narrow() ? "panelH" : "panelW", String(size)); } catch { /* storage blocked */ }
    onChange();
  };
  try {
    const w = localStorage.getItem("panelW"), h = localStorage.getItem("panelH");
    if (w) root.setProperty("--panel-w", `${w}px`);
    if (h) root.setProperty("--panel-h", `${h}px`);
  } catch { /* storage blocked */ }
  handle.addEventListener("pointerdown", (event) => {
    handle.setPointerCapture(event.pointerId);
    handle.classList.add("dragging");
    const move = (e) => set(narrow() ? window.innerHeight - e.clientY : e.clientX - panel.getBoundingClientRect().left);
    const up = () => {
      handle.classList.remove("dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
  });
  handle.addEventListener("keydown", (event) => {
    const step = { ArrowRight: 20, ArrowUp: 20, ArrowLeft: -20, ArrowDown: -20 }[event.key];
    if (!step) return;
    event.preventDefault();
    const box = panel.getBoundingClientRect();
    set((narrow() ? box.height : box.width) + step);
  });
  const toggle = (hide) => {
    panel.classList.toggle("hidden", hide);
    $("show-panel").hidden = !hide;
    onChange();
  };
  $("hide-panel").addEventListener("click", () => toggle(true));
  $("show-panel").addEventListener("click", () => toggle(false));
}

main().catch((error) => {
  console.error(error);
  const box = $("error");
  box.hidden = false;
  box.textContent = `The scene could not load: ${error.message ?? error}`;
});
