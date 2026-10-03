// Analytical pressure-buildup model for multi-well CO2 injection into a saline aquifer.
//
// Model: single-phase, slightly compressible, radial flow in a homogeneous, infinite-acting
// confined aquifer (Theis line-source solution), with CO2 injected mass converted to an
// equivalent reservoir-volume rate. Wells are combined by superposition in space and time;
// a single straight boundary (sealing or constant-pressure) is handled with image wells.

export interface Aquifer {
  permMd: number; // horizontal permeability, mD
  thicknessM: number; // net thickness, m
  porosity: number; // fraction
  compressibilityPerMPa: number; // total compressibility (rock + brine), 1/MPa
  viscosityMPas: number; // brine viscosity, mPa.s
  co2DensityKgM3: number; // CO2 density at reservoir conditions, kg/m3
  wellboreRadiusM: number;
  depthM: number; // mid-depth of injection interval
  hydroGradientMPaPerM: number; // initial pressure gradient
  fracGradientMPaPerM: number; // fracture-pressure gradient
  safetyFactor: number; // fraction of fracture pressure allowed (e.g. 0.9)
}

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
  rateMtpa: number; // injection rate, Mt CO2 / year
  startYr: number;
  endYr: number; // injection stops (shut-in afterwards)
  skin: number; // well skin factor (dimensionless), adds near-well pressure drop while injecting
  changes?: { yr: number; rateMtpa: number }[]; // optional rate changes between startYr and endYr (new rate from that year on)
}

export interface Point {
  id: string;
  name: string;
  x: number;
  y: number;
}

const GAMMA = 0.5772156649015329;
export const SECONDS_PER_YEAR = 365.25 * 86400;
const MD_TO_M2 = 9.869233e-16;

/** Exponential integral E1(x), x > 0. Series for x <= 1, continued fraction otherwise. */
export function expint1(x: number): number {
  if (!(x > 0)) return x === 0 ? Infinity : NaN;
  if (x <= 1) {
    let sum = 0;
    let term = 1;
    for (let k = 1; k <= 60; k++) {
      term *= -x / k;
      const add = -term / k; // -(-x)^k / (k * k!)
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return -GAMMA - Math.log(x) + sum;
  }
  // Lentz continued fraction
  let b = x + 1;
  let c = 1 / 1e-300;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= 200; i++) {
    const an = -i * i;
    b += 2;
    d = 1 / (an * d + b);
    c = b + an / c;
    const del = c * d;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h * Math.exp(-x);
}

/** Derived SI quantities used by the solver. */
export interface SolverConsts {
  eta: number; // hydraulic diffusivity, m2/s
  mobilityTerm: number; // mu / (4 pi k h), Pa.s/m3
}

export function consts(a: Aquifer): SolverConsts {
  const k = a.permMd * MD_TO_M2;
  const mu = a.viscosityMPas * 1e-3;
  const ct = a.compressibilityPerMPa * 1e-6;
  return {
    eta: k / (a.porosity * mu * ct),
    mobilityTerm: mu / (4 * Math.PI * k * a.thicknessM),
  };
}

/** Convert a mass rate (Mt/yr) to a reservoir-volume rate (m3/s). */
export function rateToM3s(mtpa: number, a: Aquifer): number {
  return (mtpa * 1e9) / a.co2DensityKgM3 / SECONDS_PER_YEAR;
}

/** Reservoir-volume injection rate of the first rate period, m3/s. */
export function volumeRate(w: Well, a: Aquifer): number {
  return rateToM3s(w.rateMtpa, a);
}

export interface RateStep {
  t: number; // year the rate changes
  q: number; // new rate, Mt/yr (0 = shut in)
}

/** Rate history of a well as steps: start of injection, optional rate changes, shut-in (q = 0) at endYr. */
export function rateSteps(w: Well): RateStep[] {
  if (!(w.endYr > w.startYr)) return [];
  const mid = (w.changes ?? []).filter((c) => c.yr > w.startYr && c.yr < w.endYr).sort((x, y) => x.yr - y.yr);
  return [{ t: w.startYr, q: w.rateMtpa }, ...mid.map((c) => ({ t: c.yr, q: c.rateMtpa })), { t: w.endYr, q: 0 }];
}

/** Injection rate (Mt/yr) in force at time t; the last rate stays in force through endYr. */
export function rateAt(w: Well, t: number): number {
  const st = rateSteps(w);
  if (!st.length || t <= st[0].t || t > w.endYr) return 0;
  let q = 0;
  for (const x of st) if (x.t < t) q = x.q;
  return q;
}

/** Mass of CO2 injected (Mt) up to time t. */
export function injectedMt(w: Well, t: number): number {
  const st = rateSteps(w);
  let m = 0;
  for (let i = 0; i < st.length - 1; i++) {
    const t1 = Math.min(st[i + 1].t, t);
    if (t1 > st[i].t) m += st[i].q * (t1 - st[i].t);
  }
  return m;
}

interface Source {
  x: number;
  y: number;
  sign: 1 | -1;
  real: boolean;
}

function sourcesFor(w: Well, b: Boundary): Source[] {
  const out: Source[] = [{ x: w.x, y: w.y, sign: 1, real: true }];
  if (b.type === "none") return out;
  const sign = b.type === "noflow" ? 1 : -1;
  if (b.axis === "x") out.push({ x: 2 * b.positionM - w.x, y: w.y, sign, real: false });
  else out.push({ x: w.x, y: 2 * b.positionM - w.y, sign, real: false });
  return out;
}

/**
 * Pressure buildup (MPa) at (px, py) and time tYr caused by a single well.
 * Superposition in time over the rate history: every rate change dq_j = q_j - q_(j-1) (including the
 * final shut-in, q = 0) adds dq_j * E1(r^2 / 4 eta (t - t_j)) for t > t_j.
 */
export function wellContribution(
  w: Well,
  px: number,
  py: number,
  tYr: number,
  a: Aquifer,
  b: Boundary,
  c: SolverConsts = consts(a),
): number {
  const steps = rateSteps(w);
  if (!steps.length || tYr <= steps[0].t) return 0;
  let dp = 0;
  for (const s of sourcesFor(w, b)) {
    let r = Math.hypot(px - s.x, py - s.y);
    if (s.real) r = Math.max(r, a.wellboreRadiusM);
    const r2 = r * r;
    let term = 0;
    let qPrev = 0;
    for (const st of steps) {
      if (tYr <= st.t) break;
      term += rateToM3s(st.q - qPrev, a) * expint1(r2 / (4 * c.eta * (tYr - st.t) * SECONDS_PER_YEAR));
      qPrev = st.q;
    }
    dp += s.sign * term;
  }
  return (c.mobilityTerm * dp) / 1e6;
}

/**
 * Hawkins skin from a damaged (or stimulated) zone of radius rs and permeability ks:
 * s = (k/ks - 1) ln(rs/rw). Positive = damage (ks < k), negative = stimulation (ks > k).
 */
export function hawkinsSkin(permMd: number, ksMd: number, rsM: number, rwM: number): number {
  if (!(ksMd > 0) || !(rsM > rwM) || !(rwM > 0)) return 0;
  return (permMd / ksMd - 1) * Math.log(rsM / rwM);
}

/**
 * Extra buildup (MPa) across the skin zone of a well: dp_skin = q mu s / (2 pi k h).
 * Acts only at the injector itself and only while it is injecting (steady, proportional to rate).
 */
export function skinBuildup(w: Well, tYr: number, a: Aquifer, c: SolverConsts = consts(a)): number {
  if (tYr <= w.startYr || tYr > w.endYr) return 0;
  return (rateToM3s(rateAt(w, tYr), a) * c.mobilityTerm * 2 * w.skin) / 1e6;
}

/** Buildup (MPa) at a well's own wellbore: all wells' Theis contributions plus its own skin. */
export function wellboreBuildup(
  wells: Well[],
  w: Well,
  tYr: number,
  a: Aquifer,
  b: Boundary,
  c: SolverConsts = consts(a),
): number {
  return totalBuildup(wells, w.x, w.y, tYr, a, b, c) + skinBuildup(w, tYr, a, c);
}

/** Total buildup (MPa) at a location from all wells, optionally skipping one. */
export function totalBuildup(
  wells: Well[],
  px: number,
  py: number,
  tYr: number,
  a: Aquifer,
  b: Boundary,
  c: SolverConsts = consts(a),
  skipId?: string,
): number {
  let s = 0;
  for (const w of wells) {
    if (w.id === skipId) continue;
    s += wellContribution(w, px, py, tYr, a, b, c);
  }
  return s;
}

/** Interference matrix: M[i][j] = buildup (MPa) at well j caused by well i. Diagonal is self-buildup incl. skin. */
export function interferenceMatrix(wells: Well[], tYr: number, a: Aquifer, b: Boundary): number[][] {
  const c = consts(a);
  return wells.map((wi, i) =>
    wells.map((wj, j) => wellContribution(wi, wj.x, wj.y, tYr, a, b, c) + (i === j ? skinBuildup(wi, tYr, a, c) : 0)),
  );
}

/** First time (years) a well's influence at a target location exceeds `threshold` MPa, or null. */
export function arrivalTime(
  src: Well,
  px: number,
  py: number,
  threshold: number,
  horizonYr: number,
  a: Aquifer,
  b: Boundary,
): number | null {
  const c = consts(a);
  const f = (t: number) => wellContribution(src, px, py, t, a, b, c);
  // With rate changes the buildup is no longer monotonic, so scan for the first crossing and refine it by bisection.
  const t0 = src.startYr;
  const n = 600;
  let prev = t0;
  for (let k = 1; k <= n; k++) {
    const t = t0 + ((horizonYr - t0) * k) / n;
    if (t <= t0) continue;
    if (f(t) >= threshold) {
      let lo = prev;
      let hi = t;
      for (let i = 0; i < 60; i++) {
        const mid = 0.5 * (lo + hi);
        if (f(mid) >= threshold) hi = mid;
        else lo = mid;
      }
      return hi;
    }
    prev = t;
  }
  return null;
}

export function timeGrid(horizonYr: number, wells: Well[], n = 160): number[] {
  const set = new Set<number>();
  for (let i = 1; i <= n; i++) set.add((horizonYr * i) / n);
  for (const w of wells) {
    const st = rateSteps(w);
    if (st.length) set.add(st[0].t + 1e-3);
    for (const x of st) if (x.t > 0 && x.t <= horizonYr) set.add(x.t);
    if (st.length && st[0].t + 1e-3 <= horizonYr) set.add(st[0].t + 1e-3);
  }
  return [...set].sort((x, y) => x - y);
}

export interface Limits {
  initialMPa: number;
  fractureMPa: number;
  maxBuildupMPa: number;
}

export function limits(a: Aquifer): Limits {
  const initialMPa = a.hydroGradientMPaPerM * a.depthM;
  const fractureMPa = a.fracGradientMPaPerM * a.depthM;
  return { initialMPa, fractureMPa, maxBuildupMPa: a.safetyFactor * fractureMPa - initialMPa };
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

export function buildupGrid(
  wells: Well[],
  tYr: number,
  a: Aquifer,
  b: Boundary,
  ext: { x0: number; y0: number; x1: number; y1: number },
  nx = 90,
  ny = 90,
): GridResult {
  const c = consts(a);
  const values = new Float64Array(nx * ny);
  let max = 0;
  for (let j = 0; j < ny; j++) {
    const y = ext.y0 + ((j + 0.5) / ny) * (ext.y1 - ext.y0);
    for (let i = 0; i < nx; i++) {
      const x = ext.x0 + ((i + 0.5) / nx) * (ext.x1 - ext.x0);
      let v = totalBuildup(wells, x, y, tYr, a, b, c);
      // Mirror side of a boundary is outside the aquifer: blank it out.
      if (b.type !== "none") {
        const coord = b.axis === "x" ? x : y;
        const wcoord = wells.length ? (b.axis === "x" ? wells[0].x : wells[0].y) : 0;
        if ((coord - b.positionM) * (wcoord - b.positionM) < 0) v = NaN;
      }
      values[j * nx + i] = v;
      if (v > max) max = v;
    }
  }
  return { nx, ny, ...ext, values, max };
}
