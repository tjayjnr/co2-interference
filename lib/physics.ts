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

/** Reservoir-volume injection rate, m3/s. */
export function volumeRate(w: Well, a: Aquifer): number {
  return (w.rateMtpa * 1e9) / a.co2DensityKgM3 / SECONDS_PER_YEAR;
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
 * Rate is a boxcar: on at startYr, off at endYr (shut-in recovery by superposed negative rate).
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
  if (tYr <= w.startYr || w.rateMtpa === 0) return 0;
  const q = volumeRate(w, a);
  let dp = 0;
  for (const s of sourcesFor(w, b)) {
    let r = Math.hypot(px - s.x, py - s.y);
    if (s.real) r = Math.max(r, a.wellboreRadiusM);
    const r2 = r * r;
    const t1 = (tYr - w.startYr) * SECONDS_PER_YEAR;
    let term = expint1(r2 / (4 * c.eta * t1));
    if (tYr > w.endYr) {
      const t2 = (tYr - w.endYr) * SECONDS_PER_YEAR;
      term -= expint1(r2 / (4 * c.eta * t2));
    }
    dp += s.sign * term;
  }
  return (q * c.mobilityTerm * dp) / 1e6;
}

/**
 * Extra buildup (MPa) across the skin zone of a well: dp_skin = q mu s / (2 pi k h).
 * Acts only at the injector itself and only while it is injecting (steady, proportional to rate).
 */
export function skinBuildup(w: Well, tYr: number, a: Aquifer, c: SolverConsts = consts(a)): number {
  if (tYr <= w.startYr || tYr > w.endYr) return 0;
  return (volumeRate(w, a) * c.mobilityTerm * 2 * w.skin) / 1e6;
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
  // Buildup rises monotonically while injecting, so scan only up to endYr.
  const tEnd = Math.min(horizonYr, src.endYr);
  if (f(tEnd) < threshold) return null;
  let lo = src.startYr;
  let hi = tEnd;
  for (let i = 0; i < 60; i++) {
    const mid = 0.5 * (lo + hi);
    if (f(mid) >= threshold) hi = mid;
    else lo = mid;
  }
  return hi;
}

export function timeGrid(horizonYr: number, wells: Well[], n = 160): number[] {
  const set = new Set<number>();
  for (let i = 1; i <= n; i++) set.add((horizonYr * i) / n);
  for (const w of wells) {
    for (const t of [w.startYr + 1e-3, w.endYr]) if (t > 0 && t <= horizonYr) set.add(t);
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
