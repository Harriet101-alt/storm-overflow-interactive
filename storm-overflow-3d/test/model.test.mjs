// Run with: node --test web/storm-overflow-3d/test/
import assert from "node:assert/strict";
import test from "node:test";

import {
  LEVELS, MINUTES, PRESETS, STORM_START, countedSpills, formatClock, formatDuration, levelAt, monitorText,
  rainAt, sewageFactor, simulate, spillEvents, summary, volumeAt, weirFlow,
} from "../js/model.js";

test("volume and level are inverse, through the change of plan area", () => {
  for (const level of [-4.1, -3.5, -2.7, -2.0, -0.6, 0]) {
    assert.ok(Math.abs(levelAt(volumeAt(level)) - level) < 1e-9);
  }
});

test("no flow over the weir below the crest", () => {
  assert.equal(weirFlow(LEVELS.crest - 0.01), 0);
  assert.ok(weirFlow(LEVELS.crest + 0.1) > 0);
});

test("sewage flow averages to the mean over a day", () => {
  let sum = 0;
  for (let minute = 0; minute < 24 * 60; minute++) sum += sewageFactor(minute);
  assert.ok(Math.abs(sum / (24 * 60) - 1) < 1e-6);
});

test("rain is a block with ramps, starting at the storm start", () => {
  assert.equal(rainAt(STORM_START - 1, 20, 1), 0);
  assert.equal(rainAt(STORM_START + 30, 20, 1), 20);
  assert.equal(rainAt(STORM_START + 60, 20, 1), 0);
  assert.ok(rainAt(STORM_START, 20, 1) < 20);
});

test("a dry day does not spill and starts in balance", () => {
  const records = simulate({ intensity: 0, hours: 0, ground: "dry" });
  assert.equal(records.length, MINUTES);
  assert.equal(summary(records).spillMinutes, 0);
  assert.ok(Math.abs(records[1].level - records[0].level) < 0.01);
});

test("water balance closes: in = to works + spill + change in storage (no flooding)", () => {
  const records = simulate({ intensity: 6, hours: 3, ground: "dry" });
  const inflow = records.reduce((s, r) => s + r.inflow * 60, 0);
  const out = records.reduce((s, r) => s + (r.toWorks + r.spill) * 60, 0);
  const stored = volumeAt(records.at(-1).level) - volumeAt(records[0].level);
  assert.ok(Math.abs(inflow - out - stored) / inflow < 0.02, `${inflow} vs ${out + stored}`);
});

test("wet ground makes the same storm spill longer", () => {
  for (const preset of PRESETS) {
    const dry = summary(simulate({ intensity: preset.intensity, hours: preset.hours, ground: "dry" }));
    const wet = summary(simulate({ intensity: preset.intensity, hours: preset.hours, ground: "wet" }));
    assert.ok(wet.spillMinutes > dry.spillMinutes, preset.label);
  }
});

test("only the thunderstorm floods the street", () => {
  for (const preset of PRESETS) {
    const flooded = summary(simulate({ intensity: preset.intensity, hours: preset.hours })).peakFlood > 0.005;
    assert.equal(flooded, preset.id === "thunder", preset.label);
  }
});

test("the monitor spills exactly while the level is over the crest plus threshold", () => {
  const records = simulate({ intensity: 25, hours: 1 });
  for (const record of records) {
    assert.equal(record.spilling, record.level > LEVELS.crest + LEVELS.monitorThreshold);
  }
  const [event] = spillEvents(records);
  assert.equal(monitorText(records, event.start), "Spilling for 1 min");
  assert.equal(monitorText(records, event.start - 1), "No spill");
});

test("EA 12/24 counting", () => {
  assert.equal(countedSpills([]), 0);
  assert.equal(countedSpills([{ start: 0, end: 30 }, { start: 600, end: 700 }]), 1);  // inside the first 12 h
  assert.equal(countedSpills([{ start: 0, end: 30 }, { start: 800, end: 810 }]), 2);  // a new 24 h block
  assert.equal(countedSpills([{ start: 0, end: 13 * 60 }]), 2);                       // runs past 12 h
});

test("formatting", () => {
  assert.equal(formatDuration(72), "1 h 12 min");
  assert.equal(formatDuration(5), "5 min");
  assert.equal(formatClock(6 * 60 + 5), "06:05");
});
