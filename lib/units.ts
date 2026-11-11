// Unit conversion. Inputs are stored in canonical units (m, mD, MPa, mPa.s = cP, 1/MPa, kg/m3, MPa/m, deg C,
// Mscf/day for CO2 rates, STB/day for water rates) and converted to the field units of the pressure model in page.tsx.
// For every unit: canonical = displayed * f + (off ?? 0), displayed = (canonical - off) / f.

import { PA_PER_PSI, P_SC_PSIA, T_SC_F, calculateCo2Density, prState } from "./bhp.ts";

export type Cat =
  | "length" | "distance" | "perm" | "pressure" | "viscosity" | "compress" | "density" | "gradient" | "gasrate" | "waterrate"
  | "temp" | "diffusivity";

export interface Unit {
  label: string;
  f: number;
  off?: number;
  /** Decimals to add to (negative = remove from) a pressure number's usual precision. */
  dec?: number;
}

export const PSI = PA_PER_PSI / 1e6; // MPa per psi (exact value used by the pressure model)
const FT = 0.3048;
const STB_M3 = 0.158987294928;
const LB_KG = 0.45359237;
/** Mass of 1 Mscf of CO2 at standard conditions (14.696 psia, 60 deg F), tonnes (the model's rho_sc_lb_scf). */
export const CO2_T_PER_MSCF = (1000 * calculateCo2Density(P_SC_PSIA, T_SC_F, prState(P_SC_PSIA, T_SC_F).Z) * LB_KG) / 1000;

export const UNITS: Record<Cat, Unit[]> = {
  length: [{ label: "m", f: 1 }, { label: "ft", f: FT }],
  distance: [{ label: "m", f: 1 }, { label: "km", f: 1000 }, { label: "ft", f: FT }, { label: "mi", f: 1609.344 }],
  perm: [{ label: "mD", f: 1 }, { label: "D", f: 1000 }],
  pressure: [
    { label: "MPa", f: 1, dec: 0 },
    { label: "bar", f: 0.1, dec: -1 },
    { label: "psi", f: PSI, dec: -2 },
    { label: "kPa", f: 0.001, dec: -3 },
  ],
  viscosity: [{ label: "cP", f: 1 }, { label: "mPa·s", f: 1 }, { label: "Pa·s", f: 1000 }],
  compress: [
    { label: "1/MPa", f: 1 },
    { label: "1/bar", f: 10 },
    { label: "1/psi", f: 1 / PSI },
    { label: "1/kPa", f: 1000 },
  ],
  density: [{ label: "kg/m³", f: 1 }, { label: "lb/ft³", f: LB_KG / FT ** 3 }, { label: "g/cm³", f: 1000 }],
  gradient: [
    { label: "MPa/m", f: 1 },
    { label: "psi/ft", f: PSI / FT },
    { label: "bar/m", f: 0.1 },
    { label: "kPa/m", f: 0.001 },
  ],
  gasrate: [
    { label: "Mscf/day", f: 1 },
    { label: "MMscf/day", f: 1000 },
    { label: "t/day", f: 1 / CO2_T_PER_MSCF },
    { label: "Mt/yr", f: 1e6 / (CO2_T_PER_MSCF * 365.25) },
  ],
  waterrate: [{ label: "STB/day", f: 1 }, { label: "m³/day", f: 1 / STB_M3 }],
  temp: [{ label: "°F", f: 5 / 9, off: (-32 * 5) / 9 }, { label: "°C", f: 1 }],
  diffusivity: [
    { label: "m²/s", f: 1 },
    { label: "cm²/s", f: 1e-4 },
    { label: "m²/day", f: 1 / 86400 },
    { label: "ft²/s", f: FT * FT },
    { label: "ft²/day", f: (FT * FT) / 86400 },
  ],
};

export const CAT_LABELS: Record<Cat, string> = {
  length: "Thickness, depth, radii",
  distance: "Well coordinates, distances",
  perm: "Permeability",
  pressure: "Pressure",
  viscosity: "Viscosity",
  compress: "Compressibility",
  density: "Density",
  gradient: "Pressure gradient",
  gasrate: "CO₂ injection rate",
  waterrate: "Water injection rate",
  temp: "Temperature",
  diffusivity: "Hydraulic diffusivity",
};

export const PRESETS: Record<"SI" | "Field", Record<Cat, string>> = {
  SI: { length: "m", distance: "m", perm: "mD", pressure: "MPa", viscosity: "mPa·s", compress: "1/MPa", density: "kg/m³", gradient: "MPa/m", gasrate: "t/day", waterrate: "m³/day", temp: "°C", diffusivity: "m²/s" },
  Field: { length: "ft", distance: "ft", perm: "mD", pressure: "psi", viscosity: "cP", compress: "1/psi", density: "lb/ft³", gradient: "psi/ft", gasrate: "Mscf/day", waterrate: "STB/day", temp: "°F", diffusivity: "ft²/day" },
};

export function findUnit(cat: Cat, label: string): Unit {
  return UNITS[cat].find((u) => u.label === label) ?? UNITS[cat][0];
}

/** Displayed value -> canonical value. */
export const toCanon = (u: Unit, v: number) => v * u.f + (u.off ?? 0);
/** Canonical value -> displayed value. */
export const fromCanon = (u: Unit, v: number) => (v - (u.off ?? 0)) / u.f;
