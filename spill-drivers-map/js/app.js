// Interactive drivers map: one map, a list of measures ranked by how well they track spill
// hours, a linked scatter chart and a catchment profile. Data: data/catchments.geojson
// (scripts/stages/export_drivers_web.py).

import {
  bivariateExpression, breakLabels, breaks, classExpression, classOf, percentile, spearman, tertiles,
} from "./stats.js";

const [Map, MapView, GeoJSONLayer, Basemap, TileLayer, UniqueValueRenderer, SimpleFillSymbol] = await $arcgis.import([
  "@arcgis/core/Map.js", "@arcgis/core/views/MapView.js", "@arcgis/core/layers/GeoJSONLayer.js",
  "@arcgis/core/Basemap.js", "@arcgis/core/layers/TileLayer.js", "@arcgis/core/renderers/UniqueValueRenderer.js",
  "@arcgis/core/symbols/SimpleFillSymbol.js",
]);

const OUTCOME = "HOURS_PER_OVERFLOW";
// Shared with the Pro stills and the ArcGIS Online maps (src/mapping.py: RAIN_RAMP, SPILL_RAMP, SHARE_RAMP).
const RAMPS = {
  purples: ["#f2f0f7", "#cbc9e2", "#9e9ac8", "#756bb1", "#54278f"],
  oranges: ["#feedde", "#fdbe85", "#fd8d3c", "#e6550d", "#a63603"],
  reds: ["#fee5d9", "#fcae91", "#fb6a4a", "#de2d26", "#a50f15"],
  blues: ["#eff3ff", "#bdd7e7", "#6baed6", "#3182bd", "#08519c"],
  greens: ["#edf8e9", "#bae4b3", "#74c476", "#31a354", "#006d2c"],
  pinks: ["#feebe2", "#fbb4b9", "#f768a1", "#c51b8a", "#7a0177"],
  teals: ["#ffffcc", "#a1dab4", "#41b6c4", "#2c7fb8", "#253494"],
};
// The same 3x3 palette as the Pro bivariate maps (x: driver low -> high; y: spill hours low -> high).
const BIVARIATE = {
  R1_S1: "#e8e8e8", R2_S1: "#ace4e4", R3_S1: "#5ac8c8",
  R1_S2: "#dfb0d6", R2_S2: "#a5add3", R3_S2: "#5698b9",
  R1_S3: "#be64ac", R2_S3: "#8c62aa", R3_S3: "#3b4994",
};
const MEASURES = [
  { field: OUTCOME, label: "Spill hours per overflow", unit: " h", ramp: "purples", outcome: true,
    text: "Hours spilled per overflow per year, 2021-2025. The other measures try to explain this." },
  { field: "TREATMENT_PCT", label: "Overflows at treatment works", unit: "%", ramp: "oranges",
    text: "Share of overflows that are storm tanks or inlet overflows at sewage works. These spill far longer (typically 273 hours a year) than overflows on the sewer network (10 hours)." },
  { field: "INFILTRATION_PCT", label: "Infiltration (company-stated)", unit: "%", ramp: "oranges", stated: true,
    text: "Share of overflows the water company says spilled a lot because ground or surface water gets into the sewers (2024-2025 reviews)." },
  { field: "CAPACITY_PCT", label: "Lack of capacity (company-stated)", unit: "%", ramp: "oranges", stated: true,
    text: "Share of overflows the water company says spilled a lot because the sewers lack hydraulic capacity. Edges follow company areas: each company reports differently." },
  { field: "RAINFALL_MM", label: "Rainfall", unit: " mm", ramp: "blues",
    text: "Mean annual rainfall, 2021-2025 (Met Office HadUK-Grid)." },
  { field: "IMPERVIOUS_BUILT_UP_PCT", label: "Paved share of towns", unit: "%", ramp: "pinks",
    text: "How sealed the built-up land is (Copernicus 2024). The pressure index assumed this drives spill hours. More paved places actually spill less per overflow, because they have more short-spilling network overflows." },
  { field: "UWPI", label: "Urban Water Pressure Index", unit: "", ramp: "greens",
    text: "The project's index of rainfall, paved area and residents per overflow. It tracks spill hours worse than rainfall alone." },
  { field: "AQUIFER_AREA_PCT", label: "On productive aquifers", unit: "%", ramp: "teals",
    text: "Share of the catchment on productive aquifers (BGS). Tested as a groundwater measure; it does not explain spill hours at this scale." },
];
const NOT_ANALYSED = new SimpleFillSymbol({
  style: "backward-diagonal", color: [150, 150, 150, 0.6], outline: { color: [200, 200, 200, 0.8], width: 0.3 },
});

const $ = (id) => document.getElementById(id);
// ?embed: inside a StoryMap the story supplies the title and finding, so the page drops its own.
if (new URLSearchParams(location.search).has("embed")) document.body.classList.add("embed");
const state = { measure: MEASURES[1], mode: "single", selected: null, hovered: null };

async function main() {
  const data = await (await fetch("data/catchments.geojson")).json();
  const all = data.features.map((f) => f.properties);
  const analysed = all.filter((p) => p.STATUS === "Analysed");
  const byId = Object.fromEntries(all.map((p) => [p.OPCAT_ID, p]));
  for (const measure of MEASURES) {
    const pairs = analysed.filter((p) => p[measure.field] !== null && p[OUTCOME] !== null);
    measure.rho = measure.outcome ? null : spearman(pairs.map((p) => p[measure.field]), pairs.map((p) => p[OUTCOME]));
    measure.values = analysed.map((p) => p[measure.field]);
  }

  const layer = new GeoJSONLayer({ url: "data/catchments.geojson", outFields: ["*"], title: "Catchments" });
  const map = new Map({
    basemap: new Basemap({
      baseLayers: [new TileLayer({ url: "https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Light_Gray_Base/MapServer" })],
      referenceLayers: [new TileLayer({ url: "https://services.arcgisonline.com/arcgis/rest/services/Canvas/World_Light_Gray_Reference/MapServer" })],
    }),
    layers: [layer],
  });
  const view = new MapView({
    container: "map", map,
    extent: { xmin: -6.0, ymin: 49.8, xmax: 2.0, ymax: 55.9, spatialReference: { wkid: 4326 } },
    constraints: { minZoom: 5, maxZoom: 12, snapToZoom: false },  // England fits between tile levels
  });
  await view.when();
  const layerView = await view.whenLayerView(layer);
  await layer.load();
  const { features } = await layer.queryFeatures({ where: "1=1", outFields: ["OPCAT_ID"], returnGeometry: true });
  const objectIds = Object.fromEntries(features.map((f) => [f.attributes.OPCAT_ID, f.attributes[layer.objectIdField]]));
  const extents = Object.fromEntries(features.map((f) => [f.attributes.OPCAT_ID, f.geometry.extent]));
  const england = features.reduce((extent, f) => (extent ? extent.union(f.geometry.extent) : f.geometry.extent.clone()), null);
  await view.goTo(england.expand(1.04), { animate: false }).catch((error) => console.warn("Could not zoom to England", error));

  let highlights = [];
  function highlight() {
    highlights.forEach((h) => h.remove());
    highlights = [state.selected, state.hovered].filter(Boolean).map((id) => layerView.highlight(objectIds[id]));
  }

  // ---- measure list (ranked bars)
  function renderList() {
    const list = $("measures");
    list.replaceChildren();
    const ordered = [MEASURES[0], ...MEASURES.slice(1).sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho))];
    for (const measure of ordered) {
      const row = document.createElement("button");
      row.type = "button";
      row.className = "measure";
      row.setAttribute("aria-pressed", String(measure === state.measure));
      const bar = measure.outcome ? `<span class="rho-note">the outcome</span>`
        : `<span class="rho-track"><span class="rho-bar ${measure.rho < 0 ? "neg" : "pos"}" style="width:${Math.abs(measure.rho) * 100}%"></span></span>
           <span class="rho-value">${measure.rho >= 0 ? "+" : "−"}${Math.abs(measure.rho).toFixed(2)}</span>`;
      row.innerHTML = `<span class="measure-label">${measure.label}${measure.stated ? '<sup title="Reported by the water companies">*</sup>' : ""}</span>${bar}`;
      row.addEventListener("click", () => select(measure));
      list.appendChild(row);
    }
  }

  // ---- map renderer and legend
  function renderMap() {
    const m = state.measure;
    const bivariate = state.mode === "bivariate" && !m.outcome;
    let renderer, legend;
    if (bivariate) {
      const xCuts = tertiles(m.values), yCuts = tertiles(MEASURES[0].values);
      renderer = new UniqueValueRenderer({
        valueExpression: bivariateExpression(m.field, xCuts, OUTCOME, yCuts),
        uniqueValueInfos: Object.entries(BIVARIATE).map(([value, color]) => ({ value, symbol: fill(color) })),
        defaultSymbol: NOT_ANALYSED,
      });
      legend = bivariateLegend(m, xCuts, yCuts);
    } else {
      const bounds = breaks(m.values);
      const colors = RAMPS[m.ramp].slice(-bounds.length);
      const labels = breakLabels(bounds, m.unit);
      renderer = new UniqueValueRenderer({
        valueExpression: classExpression(m.field, bounds),
        uniqueValueInfos: bounds.map((_, i) => ({ value: String(i + 1), symbol: fill(colors[i]), label: labels[i] })),
        defaultSymbol: NOT_ANALYSED,
      });
      m.bounds = bounds; m.colors = colors;
      legend = `<ol class="legend-classes">${labels.map((label, i) => `<li><span style="background:${colors[i]}"></span>${label}</li>`).join("")}</ol>`;
    }
    layer.renderer = renderer;
    $("legend").innerHTML = `<h3>${bivariate ? `${m.label} × spill hours` : m.label}</h3>${legend}
      <p class="legend-na"><span class="hatch"></span>Not analysed: estuary or coastal water, or under 5 overflows a year</p>`;
    $("measure-text").textContent = m.text;
    $("mode-bivariate").disabled = m.outcome;
  }

  function fill(color) {
    return new SimpleFillSymbol({ color, outline: { color: [255, 255, 255, 0.55], width: 0.35 } });
  }

  function bivariateLegend(m, xCuts, yCuts) {
    const cells = [];
    for (let s = 3; s >= 1; s--) for (let r = 1; r <= 3; r++) cells.push(`<span style="background:${BIVARIATE[`R${r}_S${s}`]}"></span>`);
    const fmt = (v, unit) => `${Math.round(v).toLocaleString("en-GB")}${unit}`;
    return `<div class="biv"><div class="biv-y">More spill hours →</div><div class="biv-grid">${cells.join("")}</div>
      <div class="biv-x">More ${m.label.toLowerCase().replace(/ \(.*\)/, "")} →</div></div>
      <p class="biv-cuts">Thirds of each. ${m.label}: ${fmt(xCuts[0], m.unit)} / ${fmt(xCuts[1], m.unit)}.
      Spill hours: ${fmt(yCuts[0], " h")} / ${fmt(yCuts[1], " h")}.<br>
      <strong>Dark blue</strong>: both high. <strong>Pink</strong>: spills long without it. <strong>Teal</strong>: it is high but spills are short.</p>`;
  }

  // ---- scatter chart
  const NS = "http://www.w3.org/2000/svg";
  let dots = {};
  function renderScatter() {
    const svg = $("scatter");
    svg.replaceChildren();
    dots = {};
    const m = state.measure;
    if (m.outcome) {
      $("scatter-wrap").hidden = true;
      $("top-list").hidden = false;
      renderTopList();
      return;
    }
    $("scatter-wrap").hidden = false;
    $("top-list").hidden = true;
    const width = 360, height = 230, left = 44, right = 10, top = 10, bottom = 34;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const points = analysed.filter((p) => p[m.field] !== null && p[OUTCOME] !== null);
    const xs = points.map((p) => p[m.field]);
    const xMin = Math.min(...xs), xMax = Math.max(...xs);
    const yMax = Math.max(...points.map((p) => p[OUTCOME]));
    // Spill hours on a square-root axis: the long tail would otherwise squash most catchments.
    const sx = (v) => left + ((v - xMin) / (xMax - xMin || 1)) * (width - left - right);
    const sy = (v) => height - bottom - (Math.sqrt(v) / Math.sqrt(yMax)) * (height - top - bottom);
    const add = (name, attributes, parent = svg) => {
      const node = document.createElementNS(NS, name);
      for (const [k, v] of Object.entries(attributes)) node.setAttribute(k, v);
      parent.appendChild(node);
      return node;
    };
    for (const tick of [0, 100, 250, 500, 1000].filter((t) => t <= yMax)) {
      add("line", { x1: left, x2: width - right, y1: sy(tick), y2: sy(tick), class: "grid" });
      add("text", { x: left - 4, y: sy(tick) + 3, class: "tick", "text-anchor": "end" }).textContent = `${tick}`;
    }
    add("text", { x: 4, y: top + 4, class: "axis-title" }).textContent = "spill h";
    add("text", { x: width - right, y: height - 6, class: "axis-title", "text-anchor": "end" }).textContent = `${m.label} →`;
    for (const tick of [xMin, (xMin + xMax) / 2, xMax]) {
      add("text", { x: sx(tick), y: height - bottom + 13, class: "tick", "text-anchor": "middle" }).textContent =
        `${Math.round(tick).toLocaleString("en-GB")}${m.unit.trim() === "%" ? "%" : ""}`;
    }
    for (const p of points) {
      const colour = state.mode === "bivariate" ? null : m.colors[classOf(p[m.field], m.bounds) - 1];
      const dot = add("circle", { cx: sx(p[m.field]), cy: sy(p[OUTCOME]), r: 3.4, class: "dot",
                                  fill: colour ?? "#5d6d7e", "data-id": p.OPCAT_ID });
      dot.addEventListener("mouseenter", (event) => hover(p.OPCAT_ID, event));
      dot.addEventListener("mouseleave", () => hover(null));
      dot.addEventListener("click", () => selectCatchment(p.OPCAT_ID, true));
      dots[p.OPCAT_ID] = dot;
    }
    $("scatter-caption").innerHTML = `Each dot is a catchment. Rank correlation with spill hours:
      <strong>${m.rho >= 0 ? "+" : "−"}${Math.abs(m.rho).toFixed(2)}</strong> (${strength(m.rho)}).${m.stated ? " Company-stated reasons are partly tied to spill hours by design." : ""}`;
    markDots();
  }

  function strength(rho) {
    const a = Math.abs(rho);
    const word = a >= 0.5 ? "strong" : a >= 0.3 ? "moderate" : a >= 0.15 ? "weak" : "almost none";
    return a < 0.15 ? word : `${word}, ${rho > 0 ? "more of it, longer spills" : "more of it, shorter spills"}`;
  }

  function renderTopList() {
    const top = [...analysed].sort((a, b) => b[OUTCOME] - a[OUTCOME]).slice(0, 10);
    $("top-list").innerHTML = `<h3>Longest spilling catchments</h3><ol>${top.map((p) =>
      `<li><button type="button" data-id="${p.OPCAT_ID}">${p.OPCAT_NAME}</button><span>${Math.round(p[OUTCOME])} h</span></li>`).join("")}</ol>`;
    for (const button of $("top-list").querySelectorAll("button")) {
      button.addEventListener("click", () => selectCatchment(button.dataset.id, true));
      button.addEventListener("mouseenter", () => hover(button.dataset.id));
      button.addEventListener("mouseleave", () => hover(null));
    }
  }

  function markDots() {
    for (const [id, dot] of Object.entries(dots)) {
      dot.classList.toggle("hovered", id === state.hovered);
      dot.classList.toggle("selected", id === state.selected);
      if (id === state.hovered || id === state.selected) dot.parentNode.appendChild(dot);
    }
  }

  // ---- hover, tooltip and profile
  function hover(id, event) {
    if (id === state.hovered) return;
    state.hovered = id;
    highlight();
    markDots();
    const tip = $("tooltip");
    if (!id) { tip.hidden = true; return; }
    const p = byId[id];
    const m = state.measure;
    tip.innerHTML = `<strong>${p.OPCAT_NAME}</strong><br>${p.STATUS !== "Analysed" ? p.STATUS
      : `${Math.round(p[OUTCOME])} spill h per overflow${m.outcome ? "" : `<br>${m.label}: ${format(p[m.field], m)}`}`}`;
    tip.hidden = false;
    if (event) positionTip(event.clientX, event.clientY);
  }

  function positionTip(x, y) {
    const tip = $("tooltip");
    tip.style.left = `${Math.min(x + 14, window.innerWidth - tip.offsetWidth - 8)}px`;
    tip.style.top = `${y + 14}px`;
  }

  function format(value, m) {
    if (value === null || value === undefined) return "no value";
    const digits = m.field === "UWPI" ? 2 : value < 10 && m.unit === "%" ? 1 : 0;
    return `${value.toLocaleString("en-GB", { maximumFractionDigits: digits, minimumFractionDigits: digits })}${m.unit}`;
  }

  function selectCatchment(id, zoom) {
    state.selected = id;
    highlight();
    markDots();
    const card = $("profile");
    if (!id) { card.hidden = true; return; }
    const p = byId[id];
    card.hidden = false;
    const rows = p.STATUS !== "Analysed" ? `<p>${p.STATUS}.</p>` : MEASURES.map((m) => {
      const value = p[m.field];
      const pct = value === null ? null : percentile(value, m.values);
      return `<div class="profile-row"><span>${m.label}</span><span class="profile-value">${format(value, m)}</span>
        <span class="profile-track" title="${pct === null ? "" : `Higher than ${Math.round(pct)}% of catchments`}">
        <span class="profile-bar" style="width:${pct ?? 0}%"></span></span></div>`;
    }).join("");
    card.innerHTML = `<button type="button" class="close" aria-label="Close">×</button>
      <h3>${p.OPCAT_NAME}</h3><p class="profile-meta">${p.COMPANY ?? "No overflows"} · catchment ${p.OPCAT_ID}</p>
      ${rows}<p class="profile-note">Bars: position among the ${analysed.length} analysed catchments (right = highest).</p>`;
    card.querySelector(".close").addEventListener("click", () => selectCatchment(null));
    if (zoom && extents[id]) view.goTo(extents[id].clone().expand(2.5), { duration: 800 }).catch(() => {});
  }

  function select(measure) {
    state.measure = measure;
    if (measure.outcome) state.mode = "single";
    $("mode-single").setAttribute("aria-pressed", String(state.mode === "single"));
    $("mode-bivariate").setAttribute("aria-pressed", String(state.mode === "bivariate"));
    renderList();
    renderMap();
    renderScatter();
  }

  for (const [id, mode] of [["mode-single", "single"], ["mode-bivariate", "bivariate"]]) {
    $(id).addEventListener("click", () => { state.mode = mode; select(state.measure); });
  }

  let pending = null;
  view.on("pointer-move", (event) => {
    pending = event;
    requestAnimationFrame(async () => {
      if (pending !== event) return;
      const hit = await view.hitTest(event, { include: [layer] });
      const id = hit.results[0]?.graphic?.attributes?.OPCAT_ID ?? null;
      hover(id);
      const rect = view.container.getBoundingClientRect();
      if (id) positionTip(rect.left + event.x, rect.top + event.y);
    });
  });
  view.on("pointer-leave", () => hover(null));
  view.on("click", async (event) => {
    const hit = await view.hitTest(event, { include: [layer] });
    selectCatchment(hit.results[0]?.graphic?.attributes?.OPCAT_ID ?? null, false);
  });

  select(state.measure);
  window.__driversMap = { view, state, select, selectCatchment, MEASURES };  // for debugging
}

main().catch((error) => {
  console.error(error);
  const box = $("error");
  box.hidden = false;
  box.textContent = `The map could not load: ${error.message ?? error}`;
});
