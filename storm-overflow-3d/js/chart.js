// A small SVG chart of one run: rain (bars, top), flow to the works and spill to the river
// (lines, L/s), the monitor's spill periods (band) and a cursor at the current minute.

const NS = "http://www.w3.org/2000/svg";

function el(name, attributes, parent) {
  const node = document.createElementNS(NS, name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (parent) parent.appendChild(node);
  return node;
}

export function drawChart(svg, records, events) {
  svg.replaceChildren();
  const width = 360, height = 150, left = 34, right = 8, top = 8, rainHeight = 34, bottom = 18;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const plotWidth = width - left - right;
  const x = (minute) => left + (minute / records.length) * plotWidth;
  const flowTop = top + rainHeight + 8, flowBottom = height - bottom;
  const maxRain = Math.max(10, ...records.map((r) => r.rain));
  const maxFlow = Math.max(0.1, ...records.map((r) => Math.max(r.toWorks, r.spill))) * 1000;
  const y = (litres) => flowBottom - (litres / maxFlow) * (flowBottom - flowTop);

  for (const event of events) {
    el("rect", { x: x(event.start), y: flowTop, width: Math.max(1, x(event.end) - x(event.start)),
                 height: flowBottom - flowTop, class: "chart-spill-band" }, svg);
  }
  const bars = records.map((r) => r.rain > 0
    ? `M${x(r.minute).toFixed(1)},${top}v${((r.rain / maxRain) * rainHeight).toFixed(1)}` : "").join("");
  el("path", { d: bars, class: "chart-rain" }, svg);
  const line = (key) => records.map((r, i) => `${i ? "L" : "M"}${x(r.minute).toFixed(1)},${y(r[key] * 1000).toFixed(1)}`).join("");
  el("path", { d: line("toWorks"), class: "chart-works" }, svg);
  el("path", { d: line("spill"), class: "chart-spill" }, svg);

  el("line", { x1: left, x2: width - right, y1: flowBottom, y2: flowBottom, class: "chart-axis" }, svg);
  for (let hour = 0; hour <= records.length / 60; hour += 2) {
    const label = el("text", { x: x(hour * 60), y: height - 4, class: "chart-label", "text-anchor": "middle" }, svg);
    label.textContent = `${String(6 + hour).padStart(2, "0")}:00`;
  }
  const flowLabel = el("text", { x: 2, y: flowTop + 8, class: "chart-label" }, svg);
  flowLabel.textContent = `${Math.round(maxFlow)} L/s`;
  const rainLabel = el("text", { x: 2, y: top + 8, class: "chart-label" }, svg);
  rainLabel.textContent = `${Math.round(maxRain)} mm/h`;

  const cursor = el("line", { y1: top, y2: flowBottom, class: "chart-cursor" }, svg);
  return (minute) => {
    cursor.setAttribute("x1", x(minute));
    cursor.setAttribute("x2", x(minute));
  };
}
