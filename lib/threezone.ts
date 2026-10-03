// Builds the constants of the three-zone CO2-brine pressure kernel from the aquifer, relative-permeability,
// dry-out and compressibility inputs.
//
//   zone 1 (dry CO2)          m1 = k_rg,1 mu_w / mu_g            (k_rg,1 = end-point CO2 relative permeability)
//   zone 2 (CO2 + brine)      m2 = k_rg(S) mu_w / mu_g + k_rw(S)  at the average saturation behind the front S = 1 / beta
//   zone 3 (brine)            m3 = 1                              (brine is the reference: Lambda_0 = k / mu_w)
//   storage ratios            c*_n = c_t,n / c_t,   c_t,1 = c_f + c_g,   c_t,2 = c_f + (1 - S) c_w + S c_g,   c_t,3 = c_t
//   diffusivity ratios        D_n = m_n / c*_n

import type { Aquifer, ZoneConsts } from "./physics.ts";
import { evaporationCoefficient, type DryParams } from "./dryzone.ts";
import { makeSatModel, type SatParams } from "./saturation.ts";

export interface ThreeZoneInputs {
  sat: SatParams;
  dry: DryParams;
  rockCompPerMPa: number; // c_f
  co2CompPerMPa: number; // c_g
}

export interface ZoneSummary {
  consts: ZoneConsts;
  avgSat: number; // average CO2 saturation behind the front, 1 / beta
  cStar: [number, number, number];
}

export function buildZones(a: Aquifer, z: ThreeZoneInputs, p0MPa: number): ZoneSummary {
  const model = makeSatModel(z.sat, a.viscosityMPas);
  const beta = model.xiFront;
  const smax = model.smax;
  const avg = Math.min(1 / beta, smax); // mass balance: injected volume / pore volume inside the front
  const sn = avg / smax;
  const krg2 = z.sat.krgMax * sn ** z.sat.ng;
  const krw2 = (1 - sn) ** z.sat.nw;
  const muRatio = a.viscosityMPas / z.sat.muCo2MPas; // mu_w / mu_g
  const m1 = z.sat.krgMax * muRatio;
  const m2 = krg2 * muRatio + krw2;
  const cf = z.rockCompPerMPa;
  const cg = z.co2CompPerMPa;
  const cw = Math.max(a.compressibilityPerMPa - cf, 0);
  const ct = a.compressibilityPerMPa;
  const cStar: [number, number, number] = [(cf + cg) / ct, (cf + (1 - avg) * cw + avg * cg) / ct, 1];
  const m: [number, number, number] = [m1, m2, 1];
  return {
    consts: {
      m,
      D: [m[0] / cStar[0], m[1] / cStar[1], m[2] / cStar[2]],
      alphaD: evaporationCoefficient(p0MPa, a, z.dry, z.sat.swr),
      beta,
    },
    avgSat: avg,
    cStar,
  };
}
