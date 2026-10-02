// Unit conversion. All physics uses canonical units (m, mD, MPa, mPa.s, 1/MPa, kg/m3, MPa/m, Mt/yr).
// For every unit: canonical = displayed * f, displayed = canonical / f.

export type Cat =
  | "length" | "distance" | "perm" | "pressure" | "viscosity" | "compress" | "density" | "gradient" | "rate";

export interface Unit {
  label: string;
  f: number;
  /** Decimals to add to (negative = remove from) a pressure number's usual precision. */
  dec?: number;
}

const PSI = 0.00689476; // MPa per psi
const FT = 0.3048;

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
  viscosity: [{ label: "mPa·s", f: 1 }, { label: "Pa·s", f: 1000 }],
  compress: [
    { label: "1/MPa", f: 1 },
    { label: "1/bar", f: 10 },
    { label: "1/psi", f: 1 / PSI },
    { label: "1/kPa", f: 1000 },
  ],
  density: [{ label: "kg/m³", f: 1 }, { label: "lb/ft³", f: 16.01846 }, { label: "g/cm³", f: 1000 }],
  gradient: [
    { label: "MPa/m", f: 1 },
    { label: "psi/ft", f: PSI / FT },
    { label: "bar/m", f: 0.1 },
    { label: "kPa/m", f: 0.001 },
  ],
  rate: [{ label: "Mt/yr", f: 1 }, { label: "kt/yr", f: 0.001 }, { label: "t/day", f: 365.25e-6 }],
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
  rate: "Injection rate",
};

export const PRESETS: Record<"SI" | "Field", Record<Cat, string>> = {
  SI: { length: "m", distance: "m", perm: "mD", pressure: "MPa", viscosity: "mPa·s", compress: "1/MPa", density: "kg/m³", gradient: "MPa/m", rate: "Mt/yr" },
  Field: { length: "ft", distance: "ft", perm: "mD", pressure: "psi", viscosity: "mPa·s", compress: "1/psi", density: "lb/ft³", gradient: "psi/ft", rate: "Mt/yr" },
};

export function findUnit(cat: Cat, label: string): Unit {
  return UNITS[cat].find((u) => u.label === label) ?? UNITS[cat][0];
}
