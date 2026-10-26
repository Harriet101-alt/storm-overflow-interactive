// Run with: node --test web/spill-drivers-map/test/stats.test.mjs
import assert from "node:assert/strict";
import test from "node:test";

import {
  bivariateExpression, breakLabels, breaks, classExpression, classOf, percentile, ranks, roundSignificant, spearman, tertiles,
} from "../js/stats.js";

test("significant-figure rounding", () => {
  assert.equal(roundSignificant(116.7), 120);
  assert.equal(roundSignificant(0.434), 0.43);
  assert.equal(roundSignificant(0), 0);
});

test("breaks end at the maximum and collapse ties", () => {
  const values = [0, 0, 0, 0, 0, 0, 1, 2, 3, 50, null];
  const bounds = breaks(values);
  assert.equal(bounds.at(-1), 50);
  assert.equal(new Set(bounds).size, bounds.length);
  assert.deepEqual(breakLabels(bounds, "%").slice(0, 1), ["none"]);
});

test("every value gets a class", () => {
  const bounds = [10, 20, 30];
  assert.equal(classOf(5, bounds), 1);
  assert.equal(classOf(20, bounds), 2);
  assert.equal(classOf(30, bounds), 3);
  assert.equal(classOf(31, bounds), 3);
  assert.equal(classOf(null, bounds), null);
});

test("ranks share ties and spearman matches known values", () => {
  assert.deepEqual(ranks([10, 20, 20, 5]), [2, 3.5, 3.5, 1]);
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [4, 3, 2, 1]), -1);
});

test("percentile", () => {
  assert.equal(percentile(3, [1, 2, 3, 4, null]), 75);
});

test("Arcade expressions name the field and every class", () => {
  const expression = classExpression("TREATMENT_PCT", [12, 23, 100]);
  assert.match(expression, /\$feature\.TREATMENT_PCT/);
  assert.match(expression, /v <= 12, "1", v <= 23, "2", "3"/);
  const bivariate = bivariateExpression("A", [1, 2], "B", [3, 4]);
  assert.match(bivariate, /"R" \+ When\(x <= 1, 1, x <= 2, 2, 3\)/);
  assert.deepEqual(tertiles([1, 2, 3, 4]), [2, 3]);
});
