// Shared types and helpers for the multi-well analysis: wells, rate schedules, the aquifer boundary (image wells),
// time grids and the pressure limits.
//
// The pressure model itself is the reference program: lib/bhp.ts (single well) and lib/multiwell.ts (multiwell
// interference), translated from reference/co2_bhp_model.py; lib/mwfield.ts evaluates it anywhere for the maps.

export { exp1 as expint1 } from "./bhp.ts";

export type BoundaryType = "none" | "noflow" | "constant";

export interface Boundary {
  type: BoundaryType;
  axis: "x" | "y"; // boundary is the line x = position (axis x) or y = position (axis y)
  positionM: number;
}

export interface Well {
  id: string;
  name: string;
  x: number; // m
  y: number; // m
  /** Surface injection rate: Mscf/day of CO2 (CO2 models) or STB/day of water (water model). */
  rate: number;
  startYr: number;
  endYr: number; // injection stops (shut-in afterwards)
  skin: number; // well skin factor (dimensionless)
  changes?: { yr: number; rate: number }[]; // optional rate changes between startYr and endYr (new rate from that year on)
  rwM?: number; // well radius (m); the reservoir well radius when absent
  evaporation?: "inherit" | "on" | "off"; // two-phase evaporation choice of this well
  maxBhpMPa?: number | null; // this well's own maximum allowable BHP (absolute MPa); null = the shared limit
}

export interface Point {
  id: string;
  name: string;
  x: number;
  y: number;
}

export interface GridResult {
  nx: number;
  ny: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  values: Float64Array; // row-major, row 0 = y0 (south)
  max: number;
}

export interface RateStep {
  t: number; // year the rate changes
  q: number; // new rate (0 = shut in)
}

/** Rate history of a well as steps: start of injection, optional rate changes, shut-in (q = 0) at endYr. */
export function rateSteps(w: Well): RateStep[] {
  if (!(w.endYr > w.startYr)) return [];
  const mid = (w.changes ?? []).filter((c) => c.yr > w.startYr && c.yr < w.endYr).sort((x, y) => x.yr - y.yr);
  return [{ t: w.startYr, q: w.rate }, ...mid.map((c) => ({ t: c.yr, q: c.rate })), { t: w.endYr, q: 0 }];
}

/** Injection rate in force at time t; the last rate stays in force through endYr. */
export function rateAt(w: Well, t: number): number {
  const st = rateSteps(w);
  if (!st.length || t <= st[0].t || t > w.endYr) return 0;
  let q = 0;
  for (const x of st) if (x.t < t) q = x.q;
  return q;
}

/** Cumulative injection up to time t, in rate units x years (e.g. Mscf/day x yr). */
export function injectedRateYears(w: Well, t: number): number {
  const st = rateSteps(w);
  let m = 0;
  for (let i = 0; i < st.length - 1; i++) {
    const t1 = Math.min(st[i + 1].t, t);
    if (t1 > st[i].t) m += st[i].q * (t1 - st[i].t);
  }
  return m;
}

export interface Source {
  x: number;
  y: number;
  sign: 1 | -1;
  real: boolean;
}

/** The well itself plus its image across the boundary (same sign for no-flow, opposite for constant pressure). */
export function sourcesFor(w: { x: number; y: number }, b: Boundary): Source[] {
  const out: Source[] = [{ x: w.x, y: w.y, sign: 1, real: true }];
  if (b.type === "none") return out;
  const sign = b.type === "noflow" ? 1 : -1;
  if (b.axis === "x") out.push({ x: 2 * b.positionM - w.x, y: w.y, sign, real: false });
  else out.push({ x: w.x, y: 2 * b.positionM - w.y, sign, real: false });
  return out;
}

export function timeGrid(horizonYr: number, wells: Well[], n = 160): number[] {
  // the curves start at project time zero (initial pressure, on the vertical axis); a few early points follow the fast
  // initial rise before the regular steps
  const set = new Set<number>([0]);
  for (let k = 0; k < 12; k++) set.add((horizonYr / n) * 10 ** (-3 + (3 * k) / 12));
  for (let i = 1; i <= n; i++) set.add((horizonYr * i) / n);
  for (const w of wells) {
    const st = rateSteps(w);
    for (const x of st) if (x.t > 0 && x.t <= horizonYr) set.add(x.t);
    if (st.length && st[0].t + 1e-3 <= horizonYr) set.add(st[0].t + 1e-3);
    if (st.length && w.endYr + 1e-3 <= horizonYr) set.add(w.endYr + 1e-3);
  }
  return [...set].sort((x, y) => x - y);
}

/** The program's pressure check: not assessed, a maximum allowable BHP, or a fraction of the fracture pressure. */
export interface LimitInputs {
  initialMPa: number; // initial reservoir pressure (absolute)
  mode: "none" | "max_bhp" | "fracture_fraction";
  maxBhpMPa: number; // maximum allowable BHP (absolute)
  fractureMPa: number; // fracture pressure (absolute)
  fraction: number; // allowable fraction of the fracture pressure (0.9 by default; a user choice, not a rule)
}

export interface Limits {
  initialMPa: number;
  /** allowable BHP (absolute MPa), null when not assessed */
  allowableMPa: number | null;
  /** allowable buildup above the initial pressure (Infinity when not assessed) */
  maxBuildupMPa: number;
}

export function limits(a: LimitInputs): Limits {
  const allowableMPa = a.mode === "none" ? null : a.mode === "max_bhp" ? a.maxBhpMPa : a.fraction * a.fractureMPa;
  return { initialMPa: a.initialMPa, allowableMPa, maxBuildupMPa: allowableMPa === null ? Infinity : allowableMPa - a.initialMPa };
}
