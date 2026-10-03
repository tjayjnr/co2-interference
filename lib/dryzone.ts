// Dry-zone (evaporation front) radius around an injector: water balance at the moving boundary between the
// dry CO2-dominated region and the two-phase CO2-brine region.
//
//   r_d(t) = sqrt( r_w^2 + alpha * V(t) / (pi phi h) ),   alpha = rho_g c_eq / ( rho_b (1 - X_s) S_wr + rho_g c_eq (1 - S_wr) )
//
// c_eq (kg water per kg CO2) follows from water-fugacity equilibrium between the CO2-rich phase and the brine:
//   y_w = a_w P_sat Pi_w / (Phi_w P),  c_eq = (M_w / M_CO2) y_w / (1 - y_w)
// with the IAPWS saturation pressure, a Poynting correction and NaCl water activity.

import type { Aquifer, Well } from "./physics.ts";
import { injectedMt } from "./physics.ts";

export interface DryParams {
  tempC: number; // reservoir temperature
  salinity: number; // NaCl mass fraction of the brine, X_s
  brineDensityKgM3: number; // rho_b
  phiW: number; // fugacity coefficient of water in the CO2-rich phase (1 = screening approximation)
}

const TC = 647.096; // K
const PC = 22.064; // MPa
const A = [-7.85951783, 1.84408259, -11.7866497, 22.6807411, -15.9618719, 1.80122502];
const R = 8.314462618;
const VW = 18.07e-6; // m3/mol, liquid water partial molar volume
const MW = 18.01528;
const MCO2 = 44.0095;

/** Saturation pressure of pure water (MPa), IAPWS (Wagner-Pruss) correlation. */
export function waterSaturationPressureMPa(tK: number): number {
  const tau = 1 - tK / TC;
  const poly = A[0] * tau + A[1] * tau ** 1.5 + A[2] * tau ** 3 + A[3] * tau ** 3.5 + A[4] * tau ** 4 + A[5] * tau ** 7.5;
  return PC * Math.exp((TC / tK) * poly);
}

/** Water activity of NaCl brine (ideal complete dissociation). */
export function waterActivity(xs: number): number {
  const ms = xs / (0.0584428 * (1 - xs)); // mol NaCl per kg water
  return 55.508 / (55.508 + 2 * ms);
}

/** Equilibrium mass of water carried per mass of CO2 (kg/kg) at pressure pMPa. */
export function equilibriumWaterContent(pMPa: number, d: DryParams): number {
  const tK = d.tempC + 273.15;
  const psat = waterSaturationPressureMPa(tK);
  const poynting = Math.exp((VW * (pMPa - psat) * 1e6) / (R * tK));
  const yw = Math.min((waterActivity(d.salinity) * psat * poynting) / (Math.max(d.phiW, 1e-3) * pMPa), 0.5);
  return (MW / MCO2) * (yw / (1 - yw));
}

/** Dry-front coefficient alpha (dimensionless). */
export function evaporationCoefficient(pMPa: number, a: Aquifer, d: DryParams, swr: number): number {
  const ceq = equilibriumWaterContent(pMPa, d);
  const rg = a.co2DensityKgM3;
  return (rg * ceq) / (d.brineDensityKgM3 * (1 - d.salinity) * swr + rg * ceq * (1 - swr));
}

/** Radius (m) of the dry zone of one well at time t, evaluated at the initial reservoir pressure p0MPa. */
export function dryRadius(w: Well, tYr: number, a: Aquifer, d: DryParams, swr: number, p0MPa: number): number {
  const v = (injectedMt(w, tYr) * 1e9) / a.co2DensityKgM3;
  const alpha = evaporationCoefficient(p0MPa, a, d, swr);
  return Math.sqrt(a.wellboreRadiusM ** 2 + (alpha * v) / (Math.PI * a.porosity * a.thicknessM));
}
