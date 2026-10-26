// A conceptual storage model of one storm overflow, for the illustrative 3D scene.
//
// Not a hydraulic model: one storage (the overflow chamber and the sewer just upstream), a
// throttled pass-forward to the treatment works, a weir to the river, and a street that floods
// when the drains are full. It is sized to read clearly, not calibrated to a real site.
// Flows feeding the sewer:
//   - sewage: dry weather flow with a daily cycle (lowest before dawn, peak mid-morning);
//   - surface runoff from roofs and roads, lagged by a linear reservoir;
//   - infiltration: groundwater seeping in, plus rain that soaks in and reaches the pipes
//     hours later (rainfall-derived infiltration). Wet ground raises both; this is what
//     keeps overflows spilling long after the rain (Lipp & Dobson 2026).
// Plain ES module with no SDK dependency, so it runs under node --test.

export const MINUTES = 12 * 60;     // simulated period
export const STORM_START = 60;      // minutes after the start
export const CLOCK_START = 6 * 60;  // the simulation starts at 06:00
const SUBSTEPS = 30;                // 2 s steps keep the weir stable

// Dimensions from the 3D model (metres, street level 0); see data/structure.json.
export const LEVELS = {
  floor: -4.1,          // chamber floor
  crest: -2.9,          // weir crest
  sewerSoffit: -2.7,    // top of the incoming sewer at the chamber
  roof: -0.6,           // chamber soffit
  street: 0.0,
  monitorThreshold: 0.01, // m over the crest before the level monitor logs a spill
};

export const SITE = {
  imperviousHa: 4,       // roofs and roads draining to this overflow
  perviousHa: 12,        // gardens and verges: rain soaks in here
  sewageMean: 0.025,     // m3/s, dry weather flow
  passForward: 0.09,     // m3/s, the most the continuation pipe passes to the works
  passForwardDepth: 0.45, // m of water over the floor at which the pass-forward is full
  drainCapacity: 0.5,    // m3/s, the most the gullies and sewer can take from the street
  runoffLag: 8 * 60,     // s, linear reservoir constant for surface runoff
  weirLength: 2.5,       // m (the chamber width)
  weirCoefficient: 1.7,  // SI broad-crested weir
  overflowCapacity: 2.0, // m3/s, the overflow pipe flowing full
  storageArea: 60,       // m2 plan area of storage below the sewer soffit (chamber + sewer upstream)
  surchargeArea: 12,     // m2 above it (chamber and manholes only), so the level then rises fast
  streetPondArea: 600,   // m2 of road and pavement where floodwater collects
};

export const GROUND = {
  dry: { label: "Dry ground", groundwater: 0.002, soakIn: 0.03, soakLag: 6 * 3600, river: 0.0 },
  wet: { label: "Wet ground (high groundwater)", groundwater: 0.035, soakIn: 0.25, soakLag: 5 * 3600, river: 0.08 },
};

export const PRESETS = [
  { id: "drizzle", label: "Light rain", intensity: 2, hours: 4 },
  { id: "steady", label: "Steady rain", intensity: 6, hours: 3 },
  { id: "shower", label: "Heavy shower", intensity: 25, hours: 1 },
  { id: "thunder", label: "Thunderstorm", intensity: 70, hours: 0.5 },
];

// Sewage flow factor over the day (1 = mean): low at night, peak in the morning.
export function sewageFactor(clockMinutes) {
  const hour = (clockMinutes / 60) % 24;
  return 1 + 0.35 * Math.sin(((hour - 4) / 24) * 2 * Math.PI) + 0.15 * Math.sin(((hour - 6) / 12) * 2 * Math.PI);
}

// Rain intensity (mm/h) at a minute: a block with 10-minute ramps.
export function rainAt(minute, intensity, hours, start = STORM_START) {
  const end = start + hours * 60;
  if (minute < start || minute >= end || intensity <= 0) return 0;
  const ramp = Math.min(10, (end - start) / 2);
  const t = Math.min(minute - start, end - minute);
  return intensity * Math.min(1, (t + 0.5) / ramp);
}

// Storage volume (m3 above the floor) <-> level (m), with the two plan areas.
export function volumeAt(level, site = SITE, levels = LEVELS) {
  const split = levels.sewerSoffit - levels.floor;
  const depth = Math.max(0, level - levels.floor);
  return Math.min(depth, split) * site.storageArea + Math.max(0, depth - split) * site.surchargeArea;
}

export function levelAt(volume, site = SITE, levels = LEVELS) {
  const split = levels.sewerSoffit - levels.floor;
  const below = split * site.storageArea;
  const depth = volume <= below ? volume / site.storageArea : split + (volume - below) / site.surchargeArea;
  return levels.floor + Math.max(0, depth);
}

export function weirFlow(level, site = SITE, levels = LEVELS) {
  const head = level - levels.crest;
  return head > 0 ? Math.min(site.overflowCapacity, site.weirCoefficient * site.weirLength * head ** 1.5) : 0;
}

export function passForwardFlow(level, site = SITE, levels = LEVELS) {
  const depth = Math.max(0, level - levels.floor);
  return site.passForward * Math.sqrt(Math.min(1, depth / site.passForwardDepth));
}

// Run the storm. Returns one record per minute (flows in m3/s, levels in m, rain in mm/h).
export function simulate({ intensity = 25, hours = 1, ground = "dry", site = SITE, levels = LEVELS } = {}) {
  const soil = GROUND[ground];
  if (!soil) throw new Error(`Unknown ground ${ground}`);
  const dt = 60 / SUBSTEPS;
  const surfaceStore = { runoff: 0, soak: 0, river: 0 };
  // Start in balance with the dry weather flow so there is no warm-up surge.
  const base = site.sewageMean * sewageFactor(CLOCK_START) + soil.groundwater;
  let low = levels.floor, high = levels.street;
  for (let i = 0; i < 60; i++) {
    const mid = (low + high) / 2;
    if (passForwardFlow(mid, site, levels) + weirFlow(mid, site, levels) < base) low = mid; else high = mid;
  }
  let volume = volumeAt(low, site, levels);
  let pond = 0;
  const records = [];
  for (let minute = 0; minute < MINUTES; minute++) {
    const rain = rainAt(minute, intensity, hours);
    const rainRate = rain / 1000 / 3600;  // m/s
    const sewage = site.sewageMean * sewageFactor(CLOCK_START + minute);
    const sums = { toWorks: 0, spill: 0, inflow: 0, runoff: 0, toStreet: 0 };
    for (let s = 0; s < SUBSTEPS; s++) {
      // Surface runoff and slow infiltration as linear reservoirs (m3 stored, outflow = store / lag).
      surfaceStore.runoff += (rainRate * site.imperviousHa * 1e4 - surfaceStore.runoff / site.runoffLag) * dt;
      const runoff = surfaceStore.runoff / site.runoffLag;
      surfaceStore.soak += (rainRate * site.perviousHa * 1e4 * soil.soakIn - surfaceStore.soak / soil.soakLag) * dt;
      const infiltration = soil.groundwater + surfaceStore.soak / soil.soakLag;

      const level = levelAt(volume, site, levels);
      const surcharged = level >= levels.roof;
      // The drains take runoff and any ponded water up to their capacity, unless the sewer is surcharged.
      const drainRoom = surcharged ? 0 : site.drainCapacity;
      const fromStreet = Math.min(runoff + pond / dt, drainRoom);
      pond = Math.max(0, pond + (runoff - fromStreet) * dt);
      const inflow = sewage + infiltration + fromStreet;
      const toWorks = passForwardFlow(level, site, levels);
      const spill = weirFlow(level, site, levels);
      volume += (inflow - toWorks - spill) * dt;
      // Water cannot rise above the street: the excess comes up out of the manholes.
      const full = volumeAt(levels.street, site, levels);
      if (volume > full) { pond += volume - full; volume = full; }
      if (volume < 0) volume = 0;

      sums.toWorks += toWorks / SUBSTEPS; sums.spill += spill / SUBSTEPS;
      sums.inflow += inflow / SUBSTEPS; sums.runoff += runoff / SUBSTEPS;
    }
    // The river rises a little and late with the rain (a 2-hour reservoir), more on wet ground.
    surfaceStore.river += (rain - surfaceStore.river) / 120;
    const level = levelAt(volume, site, levels);
    records.push({
      minute,
      clock: CLOCK_START + minute,
      rain,
      level,
      inflow: sums.inflow,
      toWorks: sums.toWorks,
      spill: sums.spill,
      runoff: sums.runoff,
      floodDepth: pond / site.streetPondArea,
      river: Math.min(-3.45, -3.6 + soil.river + 0.004 * surfaceStore.river),
      spilling: level > levels.crest + levels.monitorThreshold,
    });
  }
  return records;
}

// Spill events as the level monitor logs them: [{start, end}] in minutes (end exclusive).
export function spillEvents(records) {
  const events = [];
  let open = null;
  for (const record of records) {
    if (record.spilling && open === null) open = record.minute;
    if (!record.spilling && open !== null) { events.push({ start: open, end: record.minute }); open = null; }
  }
  if (open !== null) events.push({ start: open, end: records.length });
  return events;
}

// The Environment Agency's 12/24 counting method: the first 12 hours from the start of a
// spill count as one spill, then each further 24-hour block with any spilling counts one more.
export function countedSpills(events) {
  let count = 0;
  let blockEnd = -Infinity;
  let first = true;
  for (const event of events) {
    let t = event.start;
    while (t < event.end) {
      if (t >= blockEnd) {
        count += 1;
        blockEnd = t + (first ? 12 : 24) * 60;
        first = false;
      }
      t = Math.min(event.end, blockEnd);
    }
  }
  return count;
}

// Monitor text at a minute: "No spill" or "Spilling for 1 h 12 min".
export function monitorText(records, minute) {
  if (!records[minute].spilling) return "No spill";
  let start = minute;
  while (start > 0 && records[start - 1].spilling) start -= 1;
  return `Spilling for ${formatDuration(minute - start + 1)}`;
}

export function formatDuration(minutes) {
  const h = Math.floor(minutes / 60), m = Math.round(minutes % 60);
  return h ? `${h} h ${String(m).padStart(2, "0")} min` : `${m} min`;
}

export function formatClock(clockMinutes) {
  const total = Math.round(clockMinutes) % (24 * 60);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

// Totals for a run: spill duration (min), counted spills, spill volume (m3), peak flood depth (m).
export function summary(records) {
  const events = spillEvents(records);
  return {
    events,
    spillMinutes: events.reduce((sum, event) => sum + event.end - event.start, 0),
    counted: countedSpills(events),
    spillVolume: records.reduce((sum, record) => sum + record.spill * 60, 0),
    peakFlood: Math.max(...records.map((record) => record.floodDepth)),
    peakSpill: Math.max(...records.map((record) => record.spill)),
  };
}
