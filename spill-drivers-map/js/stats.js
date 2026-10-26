// Class breaks, rank statistics and renderer expressions for the drivers map.
// Plain ES module with no SDK dependency, so it runs under node --test.

// Round to two significant figures (116.7 -> 120, 0.43 -> 0.43), as the Pro maps do.
export function roundSignificant(value, digits = 2) {
  if (value === 0) return 0;
  const power = digits - 1 - Math.floor(Math.log10(Math.abs(value)));
  return Math.round(value * 10 ** power) / 10 ** power;
}

function quantile(sorted, p) {
  const position = (sorted.length - 1) * p;
  const low = Math.floor(position), high = Math.ceil(position);
  return sorted[low] + (sorted[high] - sorted[low]) * (position - low);
}

// Upper bounds of equal-count classes (nulls ignored); inner bounds rounded and de-duplicated,
// the last bound is the maximum so every value is classed.
export function breaks(values, classes = 5) {
  const sorted = values.filter((v) => v !== null && v !== undefined && !Number.isNaN(v)).sort((a, b) => a - b);
  if (sorted.length < 2) throw new Error("Need at least two values for class breaks");
  const cuts = new Set();
  for (let i = 1; i < classes; i++) cuts.add(roundSignificant(quantile(sorted, i / classes)));
  const max = sorted.at(-1);
  return [...[...cuts].filter((c) => c < max).sort((a, b) => a - b), max];
}

// 1-based class of a value given upper bounds; null for no value.
export function classOf(value, bounds) {
  if (value === null || value === undefined) return null;
  const index = bounds.findIndex((bound) => value <= bound);
  return (index === -1 ? bounds.length - 1 : index) + 1;
}

export function breakLabels(bounds, unit = "") {
  const fmt = (v) => `${Number(v.toPrecision(6)).toLocaleString("en-GB")}${unit}`;
  if (bounds.length === 1) return [`up to ${fmt(bounds[0])}`];
  return bounds.map((bound, i) => {
    if (i === 0) return bound === 0 ? "none" : `up to ${fmt(bound)}`;
    if (i === bounds.length - 1) return `over ${fmt(bounds[i - 1])}`;
    return `${fmt(bounds[i - 1])} - ${fmt(bound)}`;
  });
}

// Average ranks (1-based), ties share their mean rank.
export function ranks(values) {
  const order = values.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const result = new Array(values.length);
  for (let i = 0; i < order.length;) {
    let j = i;
    while (j + 1 < order.length && order[j + 1][0] === order[i][0]) j++;
    for (let k = i; k <= j; k++) result[order[k][1]] = (i + j) / 2 + 1;
    i = j + 1;
  }
  return result;
}

export function spearman(x, y) {
  const rx = ranks(x), ry = ranks(y);
  const mean = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  const mx = mean(rx), my = mean(ry);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < rx.length; i++) {
    num += (rx[i] - mx) * (ry[i] - my);
    dx += (rx[i] - mx) ** 2;
    dy += (ry[i] - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}

// Share of values at or below a value (0-100).
export function percentile(value, values) {
  const valid = values.filter((v) => v !== null && v !== undefined);
  return (100 * valid.filter((v) => v <= value).length) / valid.length;
}

// Arcade for a class field: "1".."n" by upper bounds, "none" without a value.
export function classExpression(field, bounds) {
  const cases = bounds.slice(0, -1).map((bound, i) => `v <= ${bound}, "${i + 1}"`).join(", ");
  return `var v = $feature.${field}; When(IsEmpty(v), "none", ${cases ? `${cases}, ` : ""}"${bounds.length}")`;
}

// Arcade for a 3x3 bivariate class "R{x}_S{y}" from two fields' tertile cut points.
export function bivariateExpression(xField, xCuts, yField, yCuts) {
  const third = (name, cuts) => `When(${name} <= ${cuts[0]}, 1, ${name} <= ${cuts[1]}, 2, 3)`;
  return `var x = $feature.${xField}; var y = $feature.${yField};
When(IsEmpty(x) || IsEmpty(y), "none", "R" + ${third("x", xCuts)} + "_S" + ${third("y", yCuts)})`;
}

export function tertiles(values) {
  const sorted = values.filter((v) => v !== null && v !== undefined).sort((a, b) => a - b);
  return [quantile(sorted, 1 / 3), quantile(sorted, 2 / 3)];
}
