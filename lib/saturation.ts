// CO2 saturation around the injectors: radial Buckley-Leverett (Welge) solution for CO2 displacing brine.
//
// For a constant volumetric injection rate q into a homogeneous layer, the saturation Sg obeys
//   r(Sg, t)^2 = q t / (pi phi h) * dfg/dSg,
// with a shock (the plume front) at the Welge tangent point Sf, where dfg/dSg = fg(Sf) / Sf.
// Fractional flow uses Corey relative permeabilities. Gravity override, dissolution, capillarity and
// residual trapping are ignored; overlapping plumes are added and capped at the maximum saturation.

import type { Aquifer, GridResult, Well } from "./physics.ts";
import { SECONDS_PER_YEAR, volumeRate } from "./physics.ts";

export interface SatParams {
  swr: number; // irreducible brine saturation
  krgMax: number; // CO2 relative permeability at maximum CO2 saturation
  nw: number; // Corey exponent, brine
  ng: number; // Corey exponent, CO2
  muCo2MPas: number; // CO2 viscosity, mPa.s
}

export interface SatModel {
  smax: number; // maximum CO2 saturation = 1 - swr
  sf: number; // saturation just behind the front
  xiFront: number; // dfg/dSg at the front: dimensionless position of the front
  s: number[]; // saturations from sf to smax (increasing)
  xi: number[]; // dfg/dSg for those saturations (non-increasing)
}

export function makeSatModel(p: SatParams, muBrineMPas: number): SatModel {
  const smax = 1 - p.swr;
  const n = 2000;
  const fg = (sg: number) => {
    const sn = Math.min(Math.max(sg / smax, 0), 1);
    const krw = (1 - sn) ** p.nw;
    const krg = p.krgMax * sn ** p.ng;
    if (krg <= 0) return 0;
    return 1 / (1 + (krw * p.muCo2MPas) / (krg * muBrineMPas));
  };
  const S = Array.from({ length: n + 1 }, (_, i) => (i / n) * smax);
  const F = S.map(fg);
  // Welge tangent: the saturation maximising fg/S
  let iF = 1;
  for (let i = 1; i <= n; i++) if (F[i] / S[i] > F[iF] / S[iF]) iF = i;
  const dF = S.map((_, i) => (i === 0 ? (F[1] - F[0]) / (S[1] - S[0]) : i === n ? (F[n] - F[n - 1]) / (S[n] - S[n - 1]) : (F[i + 1] - F[i - 1]) / (S[i + 1] - S[i - 1])));
  const s: number[] = [];
  const xi: number[] = [];
  let run = F[iF] / S[iF]; // front value; enforce a non-increasing profile behind it
  for (let i = iF; i <= n; i++) {
    run = Math.min(run, Math.max(dF[i], 0));
    s.push(S[i]);
    xi.push(run);
  }
  return { smax, sf: S[iF], xiFront: F[iF] / S[iF], s, xi };
}

/** Saturation at dimensionless position xi = pi phi h r^2 / (q t). */
export function satProfile(m: SatModel, x: number): number {
  if (!(x > 0)) return m.smax;
  if (x > m.xiFront) return 0;
  const last = m.xi.length - 1;
  if (x <= m.xi[last]) return m.smax;
  let lo = 0, hi = last; // xi is non-increasing: find the first index with xi <= x
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (m.xi[mid] > x) lo = mid;
    else hi = mid;
  }
  const a = m.xi[lo], b = m.xi[hi];
  const f = a === b ? 0 : (a - x) / (a - b);
  return m.s[lo] + f * (m.s[hi] - m.s[lo]);
}

/** Effective injection time (years): the plume stops growing at shut-in. */
export const effTime = (w: Well, tYr: number) => Math.max(0, Math.min(tYr, w.endYr) - w.startYr);

/** Radius (m) of the plume front of one well. */
export function plumeRadius(w: Well, tYr: number, a: Aquifer, m: SatModel): number {
  const t = effTime(w, tYr) * SECONDS_PER_YEAR;
  if (t <= 0) return 0;
  return Math.sqrt((volumeRate(w, a) * t * m.xiFront) / (Math.PI * a.porosity * a.thicknessM));
}

export function satFromWell(w: Well, px: number, py: number, tYr: number, a: Aquifer, m: SatModel): number {
  const t = effTime(w, tYr) * SECONDS_PER_YEAR;
  const q = volumeRate(w, a);
  if (t <= 0 || q <= 0) return 0;
  const r = Math.max(Math.hypot(px - w.x, py - w.y), a.wellboreRadiusM);
  return satProfile(m, (Math.PI * a.porosity * a.thicknessM * r * r) / (q * t));
}

export function totalSaturation(wells: Well[], px: number, py: number, tYr: number, a: Aquifer, m: SatModel): number {
  let s = 0;
  for (const w of wells) s += satFromWell(w, px, py, tYr, a, m);
  return Math.min(s, m.smax);
}

export function satGrid(
  wells: Well[], tYr: number, a: Aquifer, m: SatModel,
  ext: { x0: number; y0: number; x1: number; y1: number }, nx = 300, ny = 300,
): GridResult {
  const values = new Float64Array(nx * ny);
  for (let j = 0; j < ny; j++) {
    const y = ext.y0 + ((j + 0.5) / ny) * (ext.y1 - ext.y0);
    for (let i = 0; i < nx; i++) {
      values[j * nx + i] = totalSaturation(wells, ext.x0 + ((i + 0.5) / nx) * (ext.x1 - ext.x0), y, tYr, a, m);
    }
  }
  return { nx, ny, ...ext, values, max: m.smax }; // colour scale is always 0 .. maximum saturation
}
