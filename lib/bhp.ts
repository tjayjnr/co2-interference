// Injection bottom-hole pressure: single-phase water, single-phase CO2, or two-phase CO2-brine.
//
// TypeScript translation of the reference Python model, reference/co2_bhp_model.py
// (co2_bhp_water_first_year_detail(3).py). Function names, result keys, units, equations, messages and output files
// follow the Python, so each part can be compared line by line. tests/bhp.test.mjs checks the outputs against files
// written by the Python itself (tests/bhp-reference.json, from scripts/bhp-reference.py).
//
// Field units throughout: psia (absolute), ft, mD, cP, 1/psi, lb/ft3, Mscf/day (CO2) or STB/day (water), deg F, and
// years of 365.25 days. CO2 properties come from the Peng-Robinson equation of state, as in the Python. The only numerical difference from the Python is the integrator of the shut-in diffusion
// (scipy BDF there; L-stable implicit Euler with Richardson extrapolation here, agreeing to about 1e-3 psi).

// ---------------------------------------------------------------------------------------------------------------
// Constants supplied in the equation images; these are not fitted inputs.
export const CO2_PC_PA = 7.3773e6;
export const CO2_TC_K = 304.1282;
export const CO2_OMEGA = 0.22394;
export const P_SC_PSIA = 14.696;
export const T_SC_F = 60.0;
export const WATER_TC_K = 647.096;
export const WATER_PC_MPA = 22.064;
const WATER_A = [-7.85951783, 1.84408259, -11.7866497, 22.6807411, -15.9618719, 1.80122502];
const WATER_POWERS = [1.0, 1.5, 3.0, 3.5, 4.0, 7.5];
export const MW_WATER = 18.01528;
export const MW_CO2 = 44.0095;
const MW_SALT_KG_MOL = 0.0584428;
const WATER_MOLES_KG = 55.508;
export const DAYS_PER_YEAR = 365.25;
export const FT3_PER_BBL = 539.0 / 96.0;
export const PA_PER_PSI = 6894.757293168;
const R_UNIVERSAL_J_MOL_K = 8.31446261815324;
const KG_M3_TO_LB_FT3 = 0.3048 ** 3 / 0.45359237;
const M2_PER_MD = 9.869233e-16;
const PA_S_PER_CP = 0.001;
const M_PER_FT = 0.3048;
export const PRESSURE_COEFFICIENT = 141.2;
export const TIME_COEFFICIENT_YEARS = (M2_PER_MD * PA_PER_PSI * DAYS_PER_YEAR * 86400.0) / (PA_S_PER_CP * M_PER_FT ** 2);

// Numerical convergence settings; these do not change the physical inputs.
export const PRESSURE_TOLERANCE_PSI = 1e-4;
export const MAX_PRESSURE_ITERATIONS = 100;
export const SINGLE_PHASE_WATER_BW_RB_STB = 1.0;
export const SINGLE_PHASE_CO2_BG_RB_SCF = 0.0005690187;

export class BhpError extends Error {}
const fail = (msg: string): never => {
  throw new BhpError(msg);
};

// ---------------------------------------------------------------------------------------------------------------
// Python number formatting (str/repr of a float, format specs) so tables and files read exactly as the Python's.

/** Python repr/str of a float (shortest round-trip digits; exponent form when the exponent is < -4 or >= 16). */
export function pyFloat(x: number): string {
  if (Number.isNaN(x)) return "nan";
  if (!Number.isFinite(x)) return x > 0 ? "inf" : "-inf";
  if (x === 0) return Object.is(x, -0) ? "-0.0" : "0.0";
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(x.toExponential()) as RegExpExecArray;
  const sign = m[1], digits = m[2] + (m[3] ?? ""), e = parseInt(m[4], 10);
  if (e >= -5 + 1 && e < 16) {
    if (e >= 0) {
      const intPart = digits.slice(0, e + 1).padEnd(e + 1, "0");
      const frac = digits.slice(e + 1);
      return `${sign}${intPart}.${frac || "0"}`;
    }
    return `${sign}0.${"0".repeat(-e - 1)}${digits}`;
  }
  const mant = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
  return `${sign}${mant}e${e < 0 ? "-" : "+"}${String(Math.abs(e)).padStart(2, "0")}`;
}

function expForm(s: string): string {
  // JS "1.23e-4" -> Python "1.23e-04"
  return s.replace(/e([+-])(\d+)$/, (_, sg, d) => `e${sg}${d.padStart(2, "0")}`);
}

/** Python format(x, spec) for the specs used by the model: ".Nf", ".Ne", ".Ng" and "g". */
export function pyFormat(x: number, spec: string): string {
  const m = /^\.?(\d*)([feg])$/.exec(spec);
  if (!m) throw new Error(`unsupported format ${spec}`);
  const p = m[1] === "" ? 6 : parseInt(m[1], 10);
  if (!Number.isFinite(x)) return Number.isNaN(x) ? "nan" : x > 0 ? "inf" : "-inf";
  if (m[2] === "f") return x.toFixed(p);
  if (m[2] === "e") return expForm(x.toExponential(p));
  // general format
  if (x === 0) return "0";
  const prec = Math.max(p, 1);
  const exp = parseInt(x.toExponential(prec - 1).split("e")[1], 10);
  if (exp >= -4 && exp < prec) {
    let s = x.toFixed(prec - 1 - exp);
    if (s.includes(".")) s = s.replace(/0+$/, "").replace(/\.$/, "");
    return s;
  }
  let s = x.toExponential(prec - 1);
  s = s.replace(/\.?0+e/, "e");
  return expForm(s);
}

/** A value that the Python holds as an int (printed without ".0"). */
export class PyInt {
  readonly v: number;
  constructor(v: number) {
    this.v = v;
  }
}

/** Result rows: same keys and order as the Python dicts. */
// Values are numbers, as in the Python dicts, plus the few text/bool/None entries (pressure status, well names).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Row = Record<string, any>;
const GLOBAL_INT_KEYS = new Set(["phase_count", "single_fluid_code", "pressure_evaluations"]);
const ROW_INTS = new WeakMap<object, Set<string>>();
export function markInt(row: object, ...keys: string[]) {
  const s = ROW_INTS.get(row) ?? new Set<string>();
  keys.forEach((k) => s.add(k));
  ROW_INTS.set(row, s);
}
export const isInt = (row: object, key: string) => GLOBAL_INT_KEYS.has(key) || (ROW_INTS.get(row)?.has(key) ?? false);
/** Python str() of a row value (csv module: None -> "", bools True/False). */
export function pyStr(row: Row, key: string): string {
  const v = row[key];
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "True" : "False";
  return isInt(row, key) ? String(v) : pyFloat(v);
}
export function copyRow(row: Row): Row {
  const c = { ...row };
  const s = ROW_INTS.get(row);
  if (s) ROW_INTS.set(c, new Set(s));
  return c;
}

// ---------------------------------------------------------------------------------------------------------------
// Inputs

export type PhaseMode = "single" | "two";
export type SingleFluid = "co2" | "water";

/** User-editable reservoir and operating inputs, in the displayed units (Python dataclass `Inputs`, same order). */
export interface Inputs {
  q_Mscf_day: number;
  k_mD: number;
  h_ft: number;
  rw_ft: number;
  porosity: number;
  initial_pressure_psia: number;
  temperature_F: number;
  mu_water_cP: number;
  mu_gas_cP: number;
  brine_density_lb_ft3: number;
  salt_mass_fraction: number;
  Swr: number;
  rock_compressibility_per_psi: number;
  water_compressibility_per_psi: number;
  krg_endpoint: number;
  krw_endpoint: number;
  krg_zone1: number;
  corey_n_gas: number;
  corey_n_water: number;
  skin: number;
  phase_mode: PhaseMode;
  single_phase_fluid: SingleFluid;
  water_rate_stb_day: number;
  water_Bw_rb_stb: number;
  observation_period_years: number;
  observation_years: string;
  include_evaporation: boolean;
}

export const DEFAULT_INPUTS: Inputs = {
  q_Mscf_day: 150.0,
  k_mD: 50.0,
  h_ft: 20.0,
  rw_ft: 0.55,
  porosity: 0.2,
  initial_pressure_psia: 3500.0,
  temperature_F: 200.0,
  mu_water_cP: 0.3,
  mu_gas_cP: 0.0432,
  brine_density_lb_ft3: 63.9,
  salt_mass_fraction: 0.034,
  Swr: 0.55,
  rock_compressibility_per_psi: 4.2e-6,
  water_compressibility_per_psi: 3.5e-6,
  krg_endpoint: 0.65,
  krw_endpoint: 1.0,
  krg_zone1: 0.65,
  corey_n_gas: 3.0,
  corey_n_water: 3.0,
  skin: 0.0,
  phase_mode: "two",
  single_phase_fluid: "co2",
  water_rate_stb_day: 150.0,
  water_Bw_rb_stb: SINGLE_PHASE_WATER_BW_RB_STB,
  observation_period_years: 0.0,
  observation_years: "",
  include_evaporation: true,
};

export const PHASE_LABELS = {
  single: "Single-phase CO2",
  two: "Two-phase CO2-brine (original three-zone model)",
};
const TWO_PHASE_ONLY = new Set([
  "mu_water_cP", "brine_density_lb_ft3", "salt_mass_fraction", "Swr", "water_compressibility_per_psi",
  "krg_endpoint", "krw_endpoint", "krg_zone1", "corey_n_gas", "corey_n_water",
]);
const OBSERVATION_INPUTS = new Set(["observation_period_years", "observation_years"]);

export const isWaterMode = (p: Inputs) => p.phase_mode === "single" && p.single_phase_fluid === "water";

export function modelLabel(p: Inputs): string {
  if (p.phase_mode === "two") return PHASE_LABELS.two;
  return isWaterMode(p) ? "Single-phase water" : "Single-phase CO2";
}

/** Numerical inputs used by the chosen model; unused fields are hidden (Python `input_names_for_phase`). */
export function inputNamesForPhase(phase: PhaseMode, fluid: SingleFluid = "co2"): (keyof Inputs)[] {
  if (phase === "single" && fluid === "water") {
    return ["water_rate_stb_day", "k_mD", "h_ft", "rw_ft", "porosity", "initial_pressure_psia", "mu_water_cP",
      "brine_density_lb_ft3", "rock_compressibility_per_psi", "water_compressibility_per_psi", "skin"];
  }
  return (Object.keys(DEFAULT_INPUTS) as (keyof Inputs)[]).filter(
    (n) => !["phase_mode", "single_phase_fluid", "water_rate_stb_day", "water_Bw_rb_stb", "include_evaporation"].includes(n)
      && !OBSERVATION_INPUTS.has(n) && (phase === "two" || !TWO_PHASE_ONLY.has(n)),
  );
}

export const PROMPTS: Record<string, string> = {
  water_rate_stb_day: "Surface water injection rate (STB/day)",
  water_Bw_rb_stb: "Water formation-volume factor (fixed at 1.0 rb/STB)",
  q_Mscf_day: "Surface injection rate (Mscf/day; 150 means 150,000 scf/day)",
  k_mD: "Permeability in every zone (mD)",
  h_ft: "Reservoir thickness (ft)",
  rw_ft: "Well radius (ft)",
  porosity: "Porosity in every zone (fraction)",
  initial_pressure_psia: "Initial absolute pressure (psia)",
  temperature_F: "Constant reservoir temperature (deg F)",
  mu_water_cP: "Water viscosity (cP)",
  mu_gas_cP: "Gas viscosity (cP)",
  brine_density_lb_ft3: "Brine density (lb/ft^3)",
  salt_mass_fraction: "Salt mass fraction",
  Swr: "Irreducible water saturation Swr",
  rock_compressibility_per_psi: "Rock compressibility (1/psi)",
  water_compressibility_per_psi: "Water compressibility (1/psi)",
  krg_endpoint: "Gas endpoint relative permeability krg0",
  krw_endpoint: "Water endpoint relative permeability krw0",
  krg_zone1: "Zone 1 gas relative permeability krg1",
  corey_n_gas: "Gas Corey exponent (3; or 2 with matching water exponent)",
  corey_n_water: "Water Corey exponent (must match gas exponent)",
  skin: "Skin factor",
};

/** Python `Inputs.validate` (it may set water_Bw_rb_stb, as the Python does). */
export function validate(p: Inputs): void {
  if (!(p.phase_mode in PHASE_LABELS)) fail("phase_mode must be 'single' or 'two'.");
  if (!["water", "co2"].includes(p.single_phase_fluid)) fail("single_phase_fluid must be 'water' or 'co2'.");
  if (typeof p.include_evaporation !== "boolean") fail("include_evaporation must be True or False.");
  observationSchedule(p.observation_period_years, p.observation_years);
  if (isWaterMode(p)) p.water_Bw_rb_stb = SINGLE_PHASE_WATER_BW_RB_STB;
  const active = inputNamesForPhase(p.phase_mode, p.single_phase_fluid);
  for (const name of active) {
    const v = p[name];
    if (typeof v !== "number") fail(`${name} must be numeric.`);
    if (!Number.isFinite(v as number)) fail(`${name} must be finite.`);
  }
  for (const name of ["q_Mscf_day", "k_mD", "h_ft", "rw_ft", "initial_pressure_psia", "mu_water_cP", "mu_gas_cP",
    "brine_density_lb_ft3", "corey_n_gas", "corey_n_water", "water_rate_stb_day", "water_Bw_rb_stb"] as (keyof Inputs)[]) {
    if (active.includes(name) && (p[name] as number) <= 0) fail(`${name} must be greater than zero.`);
  }
  if (!(p.porosity > 0 && p.porosity < 1)) fail("porosity must be strictly between 0 and 1.");
  for (const name of ["salt_mass_fraction", "Swr"] as const) {
    if (active.includes(name) && !(p[name] >= 0 && p[name] < 1)) fail(`${name} must satisfy 0 <= value < 1.`);
  }
  for (const name of ["krg_endpoint", "krw_endpoint", "krg_zone1"] as const) {
    if (active.includes(name) && !(p[name] > 0 && p[name] <= 1)) fail(`${name} must satisfy 0 < value <= 1.`);
  }
  for (const name of ["rock_compressibility_per_psi", "water_compressibility_per_psi"] as const) {
    if (active.includes(name) && p[name] < 0) fail(`${name} cannot be negative.`);
  }
  if (p.phase_mode === "two" && !((p.corey_n_gas === 2 && p.corey_n_water === 2) || (p.corey_n_gas === 3 && p.corey_n_water === 3))) {
    fail("Set both Corey exponents to 3 for the cubic model, or both to 2 for the quadratic comparison. Other exponent pairs require a different front-saturation derivation.");
  }
  if (isWaterMode(p)) {
    if (!(p.water_compressibility_per_psi + p.rock_compressibility_per_psi > 0)) fail("Water plus rock compressibility must be positive.");
    return;
  }
  const tK = ((p.temperature_F + 459.67) * 5.0) / 9.0;
  if (tK <= 0) fail("Absolute reservoir temperature must be positive.");
  if (p.phase_mode === "two" && !(tK < WATER_TC_K)) fail("The supplied water-saturation equation requires 0 < absolute temperature < 647.096 K.");
}

// ---------------------------------------------------------------------------------------------------------------
// Numerical helpers (scipy/numpy equivalents)

const GAMMA = 0.5772156649015329;

/** Exponential integral E1(x), x > 0 (scipy.special.exp1). */
export function exp1(x: number): number {
  if (!(x > 0)) return x === 0 ? Infinity : NaN;
  if (x > 745) return 0;
  if (x <= 1) {
    let sum = 0;
    let term = 1;
    for (let k = 1; k <= 60; k++) {
      term *= -x / k;
      const add = -term / k;
      sum += add;
      if (Math.abs(add) < 1e-17 * Math.abs(sum)) break;
    }
    return -GAMMA - Math.log(x) + sum;
  }
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

/**
 * scipy.optimize.brentq: a step-by-step port of scipy's brentq.c, so the number of function evaluations (reported by
 * the model as pressure_evaluations) is the same as in the Python.
 */
export function brentq(f: (x: number) => number, xa: number, xb: number, xtol = 2e-12, rtol = 8.881784197001252e-16, iter = 100): number {
  let xpre = xa, xcur = xb;
  let xblk = 0, fblk = 0, spre = 0, scur = 0;
  let fpre = f(xpre);
  let fcur = f(xcur);
  if (fpre === 0) return xpre;
  if (fcur === 0) return xcur;
  if (Math.sign(fpre) === Math.sign(fcur)) fail("f(a) and f(b) must have different signs");
  for (let i = 0; i < iter; i++) {
    if (fpre !== 0 && fcur !== 0 && Math.sign(fpre) !== Math.sign(fcur)) {
      xblk = xpre;
      fblk = fpre;
      spre = scur = xcur - xpre;
    }
    if (Math.abs(fblk) < Math.abs(fcur)) {
      xpre = xcur; xcur = xblk; xblk = xpre;
      fpre = fcur; fcur = fblk; fblk = fpre;
    }
    const delta = (xtol + rtol * Math.abs(xcur)) / 2;
    const sbis = (xblk - xcur) / 2;
    if (fcur === 0 || Math.abs(sbis) < delta) return xcur;
    if (Math.abs(spre) > delta && Math.abs(fcur) < Math.abs(fpre)) {
      let stry: number;
      if (xpre === xblk) {
        stry = (-fcur * (xcur - xpre)) / (fcur - fpre); // interpolate
      } else {
        const dpre = (fpre - fcur) / (xpre - xcur); // extrapolate
        const dblk = (fblk - fcur) / (xblk - xcur);
        stry = (-fcur * (fblk * dblk - fpre * dpre)) / (dblk * dpre * (fblk - fpre));
      }
      if (2 * Math.abs(stry) < Math.min(Math.abs(spre), 3 * Math.abs(sbis) - delta)) {
        spre = scur; // good short step
        scur = stry;
      } else {
        spre = sbis; // bisect
        scur = sbis;
      }
    } else {
      spre = sbis; // bisect
      scur = sbis;
    }
    xpre = xcur;
    fpre = fcur;
    if (Math.abs(scur) > delta) xcur += scur;
    else xcur += sbis > 0 ? delta : -delta;
    fcur = f(xcur);
  }
  throw new Error("Brent root finder did not converge"); // scipy raises RuntimeError
}

/** numpy.geomspace(start, stop, num). */
export function geomspace(start: number, stop: number, num: number): number[] {
  const ls = Math.log10(start), le = Math.log10(stop);
  const step = (le - ls) / (num - 1);
  const out = Array.from({ length: num }, (_, k) => 10 ** (k * step + ls));
  out[0] = start;
  out[num - 1] = stop;
  return out;
}

const uniqueSorted = (xs: number[]) => [...new Set(xs)].sort((x, y) => x - y);

// ---------------------------------------------------------------------------------------------------------------
// Model equations

/** Real roots of z^3 + a z^2 + b z + c (numpy.roots for a monic cubic, keeping the real ones). */
function cubicRealRoots(a: number, b: number, c: number): number[] {
  const p = b - (a * a) / 3;
  const q = (2 * a * a * a) / 27 - (a * b) / 3 + c;
  const disc = (q / 2) ** 2 + (p / 3) ** 3;
  let roots: number[];
  if (disc > 0) {
    const s = Math.sqrt(disc);
    roots = [Math.cbrt(-q / 2 + s) + Math.cbrt(-q / 2 - s) - a / 3];
  } else {
    const r = Math.sqrt(Math.max(-p / 3, 0));
    const arg = r > 0 ? Math.min(1, Math.max(-1, -q / (2 * r * r * r))) : 0;
    const phi = Math.acos(arg);
    roots = [0, 1, 2].map((k) => 2 * r * Math.cos((phi - 2 * Math.PI * k) / 3) - a / 3);
  }
  return roots.map((z) => {
    for (let i = 0; i < 4; i++) {
      const f = ((z + a) * z + b) * z + c;
      const df = (3 * z + 2 * a) * z + b;
      if (df === 0) break;
      const nz = z - f / df;
      if (!Number.isFinite(nz)) break;
      z = nz;
    }
    return z;
  });
}

/** Solve the supplied PR cubic and select the lowest-fugacity real root. */
export function prState(pressure_psia: number, temperature_F: number): Row {
  if (pressure_psia <= 0 || !Number.isFinite(pressure_psia)) fail("Peng-Robinson pressure must be finite and positive psia.");
  const temperature_K = ((temperature_F + 459.67) * 5.0) / 9.0;
  const Pr = (pressure_psia * PA_PER_PSI) / CO2_PC_PA;
  const Tr = temperature_K / CO2_TC_K;
  const kappa = 0.37464 + 1.54226 * CO2_OMEGA - 0.26992 * CO2_OMEGA ** 2;
  const alpha = (1 + kappa * (1 - Math.sqrt(Tr))) ** 2;
  const A = (0.45724 * alpha * Pr) / Tr ** 2;
  const B = (0.0778 * Pr) / Tr;
  const ca = B - 1;
  const cb = A - 2 * B - 3 * B ** 2;
  const cc = -A * B + B ** 2 + B ** 3;
  const candidates = cubicRealRoots(ca, cb, cc).filter((z) => z > B);
  if (!candidates.length) fail("No admissible real Peng-Robinson root with Z > B.");
  const sqrt2 = Math.sqrt(2.0);
  const lnFugacity = (Z: number) => Z - 1 - Math.log(Z - B) - (A / (2 * sqrt2 * B)) * Math.log1p((2 * sqrt2 * B) / (Z + (1 - sqrt2) * B));
  const Z = candidates.reduce((best, z) => (lnFugacity(z) < lnFugacity(best) ? z : best), candidates[0]);
  const FZ = 3 * Z ** 2 + 2 * (B - 1) * Z + A - 2 * B - 3 * B ** 2;
  if (Math.abs(FZ) < 1e-14) fail("The PR pressure derivative is singular at this state.");
  const N = B * Z ** 2 + (A - 2 * B - 6 * B ** 2) * Z - 2 * A * B + 2 * B ** 2 + 3 * B ** 3;
  const dZ_dP = -N / (pressure_psia * FZ);
  const cg = 1 / pressure_psia - dZ_dP / Z;
  if (!Number.isFinite(cg) || cg <= 0) fail("Gas compressibility is not positive at this PR state.");
  const residual = Z ** 3 + ca * Z ** 2 + cb * Z + cc;
  return {
    temperature_K, Pr, Tr, kappa, alpha_PR: alpha, A_PR: A, B_PR: B, Z, FZ,
    N_PR: N, dZ_dP_per_psi: dZ_dP, cg_per_psi: cg, PR_cubic_residual: residual,
  };
}

/** Calculate pure-CO2 density from rho = p*M/(Z*R*T), in lb/ft^3. */
export function calculateCo2Density(pressure_psia: number, temperature_F: number, Z?: number): number {
  const temperature_K = ((temperature_F + 459.67) * 5.0) / 9.0;
  if (!Number.isFinite(pressure_psia) || pressure_psia <= 0) fail("Density calculation requires positive absolute pressure.");
  if (!Number.isFinite(temperature_K) || temperature_K <= 0) fail("Density calculation requires positive absolute temperature.");
  const z = Z ?? prState(pressure_psia, temperature_F).Z;
  if (!Number.isFinite(z) || z <= 0) fail("Density calculation requires a positive finite PR Z.");
  const rho = (pressure_psia * PA_PER_PSI * (MW_CO2 / 1000.0)) / (z * R_UNIVERSAL_J_MOL_K * temperature_K);
  return rho * KG_M3_TO_LB_FT3;
}

export function gasProperties(pressure_psia: number, temperature_F: number, Zsc: number): Row {
  const state = prState(pressure_psia, temperature_F);
  state.rho_g_lb_ft3 = calculateCo2Density(pressure_psia, temperature_F, state.Z);
  state.Bg_rb_scf = ((((state.Z / Zsc) * (temperature_F + 459.67)) / (T_SC_F + 459.67)) * P_SC_PSIA) / pressure_psia / FT3_PER_BBL;
  return state;
}

/** Return the leading-shock state and its radial front factor. */
export function coreyFrontQuantities(M_lambda: number, Swr: number, n_gas = 3.0, n_water = 3.0): Row {
  if (!Number.isFinite(M_lambda) || M_lambda <= 0) fail("Endpoint mobility ratio M_lambda must be finite and positive.");
  if (!(Swr >= 0 && Swr < 1)) fail("Swr must satisfy 0 <= Swr < 1.");
  let sf: number, front_factor: number;
  if (n_gas === n_water && n_water === 3.0) {
    sf = brentq((v) => (M_lambda - 1.0) * v ** 3 + 3.0 * v - 2.0, 0.0, 1.0, 1e-14, 1e-14);
    front_factor = (sf + 2.0) / (3.0 * sf * (1.0 - Swr));
  } else if (n_gas === n_water && n_water === 2.0) {
    sf = 1.0 / Math.sqrt(1.0 + M_lambda);
    front_factor = (1.0 + Math.sqrt(1.0 + M_lambda)) / (2.0 * (1.0 - Swr));
  } else {
    return fail("Supported Corey exponent pairs are (3, 3) and (2, 2).");
  }
  const exponent = n_gas;
  const denominator = M_lambda * sf ** exponent + (1.0 - sf) ** exponent;
  const fg = (M_lambda * sf ** exponent) / denominator;
  const derivative = (exponent * M_lambda * sf ** (exponent - 1.0) * (1.0 - sf) ** (exponent - 1.0)) / denominator ** 2;
  const tangent_error = sf * derivative - fg;
  if (Math.abs(tangent_error) > 1e-9) fail("Leading-front saturation failed the shock-tangent condition.");
  return {
    corey_n_gas: n_gas, corey_n_water: n_water, sf_normalized: sf, Sg_front: (1.0 - Swr) * sf,
    fg_front: fg, dfg_ds_front: derivative, front_tangent_error: tangent_error, gas_front_factor: front_factor,
  };
}

/** Quantities fixed while temperature and operating inputs stay constant. */
function referenceTwoPhaseQuantities(p: Inputs): Row {
  const Zsc = prState(P_SC_PSIA, T_SC_F).Z;
  const initial = gasProperties(p.initial_pressure_psia, p.temperature_F, Zsc);
  const rho_sc = initial.rho_g_lb_ft3 * initial.Bg_rb_scf * FT3_PER_BBL;
  const TK = initial.temperature_K;
  const tau = 1 - TK / WATER_TC_K;
  const saturation_sum = WATER_A.reduce((s, a, i) => s + a * tau ** WATER_POWERS[i], 0);
  const Psat_MPa = WATER_PC_MPA * Math.exp((WATER_TC_K / TK) * saturation_sum);
  const ms = p.salt_mass_fraction / (MW_SALT_KG_MOL * (1 - p.salt_mass_fraction));
  const aw = WATER_MOLES_KG / (WATER_MOLES_KG + 2 * ms);
  const M_lambda = (p.krg_endpoint * p.mu_water_cP) / (p.krw_endpoint * p.mu_gas_cP);
  const front = coreyFrontQuantities(M_lambda, p.Swr, p.corey_n_gas, p.corey_n_water);
  return {
    Zsc, initial_Bg_rb_scf: initial.Bg_rb_scf,
    initial_gas_density_calculated_lb_ft3: initial.rho_g_lb_ft3,
    rho_sc_lb_scf: rho_sc, salt_molality: ms, water_activity: aw,
    water_Psat_psia: (Psat_MPa * 1e6) / PA_PER_PSI,
    M_lambda, ...front,
    reference_mobility_mD_cP: (p.k_mD * p.krg_zone1) / p.mu_gas_cP,
    q_sc_scf_day: p.q_Mscf_day * 1000.0,
    time_coefficient_years: TIME_COEFFICIENT_YEARS,
  };
}

/** Evaluate the supplied annual equations at one trial property pressure. */
function calculateTwoPhaseYear(year: number, property_pressure: number, p: Inputs, c: Row): Row {
  // 1. Current pressure-dependent Bg, cg and density.
  const gas = gasProperties(property_pressure, p.temperature_F, c.Zsc);
  const Bg = gas.Bg_rb_scf, cg = gas.cg_per_psi;
  const rho_g = gas.rho_g_lb_ft3;
  // 2. Cumulative injected volume, evaluated at the current property pressure.
  const t_days = year * DAYS_PER_YEAR;
  const Vsc = c.q_sc_scf_day * t_days;
  const Vr_rb = Vsc * Bg;
  const Vr_ft3 = Vr_rb * FT3_PER_BBL;
  // 3. Water vapor and evaporation, with the cancelled factor omitted.
  let yw = 0.0, ceq = 0.0, alpha_d = 0.0;
  if (p.include_evaporation) {
    yw = (c.water_activity * c.water_Psat_psia) / property_pressure;
    if (!(yw >= 0 && yw < 1)) fail("The supplied water-vapor expression gives yw outside [0,1).");
    ceq = ((MW_WATER / MW_CO2) * yw) / (1 - yw);
    alpha_d = (rho_g * ceq) / (p.brine_density_lb_ft3 * (1 - p.salt_mass_fraction) * p.Swr + rho_g * ceq * (1 - p.Swr));
  }
  // 4. Front radii measured from the well center.
  const area_factor = Math.PI * p.porosity * p.h_ft;
  const rg = Math.sqrt(p.rw_ft ** 2 + (Vr_ft3 / area_factor) * c.gas_front_factor);
  const rd = p.include_evaporation ? Math.sqrt(p.rw_ft ** 2 + (alpha_d * Vr_ft3) / area_factor) : p.rw_ft;
  const dry_zone_thickness = p.include_evaporation ? rd - p.rw_ft : 0.0;
  // 5. Zone volumes, masses and representative saturations.
  const Vp1 = p.include_evaporation ? area_factor * (rd ** 2 - p.rw_ft ** 2) : 0.0;
  const Vp2 = area_factor * (rg ** 2 - rd ** 2);
  if (Vp2 <= 0) fail("The equations give a non-positive Zone 2 pore volume.");
  const Minj = c.rho_sc_lb_scf * Vsc;
  const Mg1 = rho_g * Vp1;
  const Mg2 = Minj - Mg1;
  const Vg2 = Mg2 / rho_g;
  const Sg2 = Vg2 / Vp2;
  const Sw2 = 1 - Sg2;
  if (!(Sg2 >= 0 && Sg2 <= 1 - p.Swr && Sw2 >= p.Swr && Sw2 <= 1)) fail(`Calculated saturations violate the supplied limits: Sg2=${pyFloat(Sg2)}, Sw2=${pyFloat(Sw2)}.`);
  const x2 = Sg2 / (1 - p.Swr);
  const krg2 = p.krg_endpoint * x2 ** p.corey_n_gas;
  const krw2 = p.krw_endpoint * (1 - x2) ** p.corey_n_water;
  // 6. Zone mobilities and total compressibilities.
  const mobilities = [
    (p.k_mD * p.krg_zone1) / p.mu_gas_cP,
    p.k_mD * (krg2 / p.mu_gas_cP + krw2 / p.mu_water_cP),
    p.k_mD / p.mu_water_cP, // supplied Zone 3 krw = 1
  ];
  const total_c = [
    cg + p.rock_compressibility_per_psi,
    Sg2 * cg + Sw2 * p.water_compressibility_per_psi + p.rock_compressibility_per_psi,
    p.water_compressibility_per_psi + p.rock_compressibility_per_psi,
  ];
  if (total_c.some((v) => v <= 0)) fail("Every zone total compressibility must be positive.");
  const m = mobilities.map((v) => v / c.reference_mobility_mD_cP);
  const c_star = total_c.map((v) => v / total_c[0]); // common porosity cancels
  const D = m.map((mi, i) => mi / c_star[i]);
  // 7. Dimensionless time and interface/well arguments.
  const rdD = rd / p.rw_ft, rgD = rg / p.rw_ft;
  const tD = (TIME_COEFFICIENT_YEARS * p.k_mD * p.krg_zone1 * year) / (p.mu_gas_cP * p.porosity * p.rw_ft ** 2 * total_c[0]);
  const uw = 1 / (4 * (p.include_evaporation ? D[0] : D[1]) * tD);
  let u1d = rdD ** 2 / (4 * D[0] * tD);
  let u2d = rdD ** 2 / (4 * D[1] * tD);
  const u2g = rgD ** 2 / (4 * D[1] * tD);
  const u3g = rgD ** 2 / (4 * D[2] * tD);
  const [E1w, , , E1g2, E1g3] = [uw, u1d, u2d, u2g, u3g].map(exp1);
  let E1d1 = exp1(u1d), E1d2 = exp1(u2d);
  // 8. Flux matching and pressure continuity coefficients.
  let dry_exponent = u2d - u1d;
  const gas_exponent = u3g - u2g;
  const a3 = 0.0;
  let b1: number, b2: number, b3: number, a1: number, a2: number;
  if (p.include_evaporation) {
    b1 = 1 / (2 * m[0]);
    b2 = Math.exp(dry_exponent) / (2 * m[1]);
    b3 = Math.exp(dry_exponent + gas_exponent) / (2 * m[2]);
    a2 = b3 * E1g3 - b2 * E1g2;
    a1 = a2 + b2 * E1d2 - b1 * E1d1;
  } else {
    // The absent dry region has no matching condition. Zone 2 begins at rw.
    b1 = a1 = dry_exponent = E1d1 = E1d2 = u1d = u2d = 0.0;
    b2 = 1 / (2 * m[1]);
    b3 = Math.exp(gas_exponent) / (2 * m[2]);
    a2 = b3 * E1g3 - b2 * E1g2;
  }
  // 9. Select the Zone 1 branch at the well and align the pressure reference.
  const pD_gas = p.include_evaporation ? a1 + b1 * E1w : a2 + b2 * E1w;
  const pD_intrinsic = pD_gas / p.krg_zone1;
  const q_reservoir = c.q_sc_scf_day * Bg;
  const delta_p = ((PRESSURE_COEFFICIENT * p.mu_gas_cP * q_reservoir) / (p.k_mD * p.h_ft)) * (pD_intrinsic + p.skin);
  const BHP = p.initial_pressure_psia + delta_p;
  const annual_gain = BHP - property_pressure;
  if (BHP <= 0 || !Number.isFinite(BHP)) fail("The calculated BHP is non-positive or non-finite.");
  // 10. Reconciliation checks; these never feed the physical calculations.
  const mass_error = Mg1 + Mg2 - Minj;
  const volume_error = Vp1 + Sg2 * Vp2 - Vr_ft3;
  const dry_error = p.include_evaporation ? a1 + b1 * E1d1 - (a2 + b2 * E1d2) : 0.0;
  const gas_error = a2 + b2 * E1g2 - (a3 + b3 * E1g3);
  if (Math.abs(mass_error) > 1e-9 * Math.max(1, Minj)) fail("CO2 mass balance failed.");
  if (Math.abs(volume_error) > 1e-9 * Math.max(1, Vr_ft3)) fail("Gas-volume balance failed.");
  if (Math.max(Math.abs(dry_error), Math.abs(gas_error)) > 1e-9 * Math.max(1, Math.abs(pD_gas))) fail("Interface pressure continuity failed.");
  const result: Row = {
    year, P_used_psia: property_pressure, t_days,
    ...gas, ...c,
    rho_g_lb_ft3: rho_g, Vsc_scf: Vsc,
    Vr_rb, Vr_ft3,
    yw, ceq, alpha_d_evaporation: alpha_d,
    rg_ft: rg, rd_ft: rd,
    dry_zone_thickness_ft: dry_zone_thickness,
    Vp1_ft3: Vp1, Vp2_ft3: Vp2,
    Minj_lb: Minj, Mg1_lb: Mg1, Mg2_lb: Mg2, Vg2_ft3: Vg2,
    Sg2, Sw2, x2, krg2, krw2,
    rdD, rgD, tD,
    uw, u1d, u2d, u2g, u3g,
    E1w, E1d1, E1d2, E1g2, E1g3,
    dry_exponent, gas_exponent,
    b1, b2, b3, a1, a2, a3,
    pD_gas_reference: pD_gas, pD_intrinsic_reference: pD_intrinsic,
    q_reservoir_rb_day: q_reservoir,
    total_delta_p_psi: delta_p, annual_gain_psi: annual_gain,
    BHP_psia: BHP, mass_balance_error_lb: mass_error,
    volume_balance_error_ft3: volume_error,
    dry_interface_error: dry_error, gas_interface_error: gas_error,
  };
  for (let zone = 0; zone < 3; zone++) {
    const n = zone + 1;
    result[`Lambda${n}_mD_cP`] = mobilities[zone];
    result[`ct${n}_per_psi`] = total_c[zone];
    result[`m${n}`] = m[zone];
    result[`c${n}_star`] = c_star[zone];
    result[`D${n}`] = D[zone];
  }
  if (!Object.values(result).every(Number.isFinite)) fail("A calculated intermediate is non-finite.");
  return result;
}

/** Constant-cw water referenced to initial pressure (no CO2 EOS). */
export function waterProperties(pressure_psia: number, p: Inputs): Row {
  if (!Number.isFinite(pressure_psia) || pressure_psia <= 0) fail("Water properties require positive absolute pressure.");
  const exponent = p.water_compressibility_per_psi * (pressure_psia - p.initial_pressure_psia);
  return {
    rho_water_lb_ft3: p.brine_density_lb_ft3 * Math.exp(exponent),
    Bw_rb_stb: SINGLE_PHASE_WATER_BW_RB_STB,
    cw_per_psi: p.water_compressibility_per_psi,
  };
}

/** Set constants for the selected phase without using inactive inputs. */
export function referenceQuantities(p: Inputs): Row {
  if (p.phase_mode === "two") return { ...referenceTwoPhaseQuantities(p), phase_count: 2, single_fluid_code: 0 };
  if (isWaterMode(p)) {
    return {
      phase_count: 1, single_fluid_code: 2,
      reference_mobility_mD_cP: p.k_mD / p.mu_water_cP,
      initial_Bw_rb_stb: SINGLE_PHASE_WATER_BW_RB_STB,
      initial_water_density_lb_ft3: p.brine_density_lb_ft3,
      q_water_stb_day: p.water_rate_stb_day,
      water_mass_per_stb_lb: p.brine_density_lb_ft3 * SINGLE_PHASE_WATER_BW_RB_STB * FT3_PER_BBL,
      time_coefficient_years: TIME_COEFFICIENT_YEARS,
    };
  }
  const Zsc = prState(P_SC_PSIA, T_SC_F).Z;
  const initial = prState(p.initial_pressure_psia, p.temperature_F);
  return {
    phase_count: 1, single_fluid_code: 1, Zsc,
    initial_Bg_rb_scf: SINGLE_PHASE_CO2_BG_RB_SCF,
    initial_cg_per_psi: initial.cg_per_psi,
    initial_gas_density_calculated_lb_ft3: calculateCo2Density(p.initial_pressure_psia, p.temperature_F, initial.Z),
    rho_sc_lb_scf: calculateCo2Density(P_SC_PSIA, T_SC_F, Zsc),
    reference_mobility_mD_cP: p.k_mD / p.mu_gas_cP,
    q_sc_scf_day: p.q_Mscf_day * 1000.0,
    time_coefficient_years: TIME_COEFFICIENT_YEARS,
  };
}

/** Homogeneous, CO2-filled, infinite-acting radial E1 approximation. */
function calculateSinglePhaseYear(year: number, property_pressure: number, p: Inputs, c: Row): Row {
  const gas = prState(property_pressure, p.temperature_F);
  gas.cg_per_psi = c.initial_cg_per_psi;
  gas.rho_g_lb_ft3 = c.initial_gas_density_calculated_lb_ft3;
  gas.Bg_rb_scf = c.initial_Bg_rb_scf;
  const ct = gas.cg_per_psi + p.rock_compressibility_per_psi;
  if (ct <= 0) fail("Single-phase total compressibility must be positive.");
  const t_days = year * DAYS_PER_YEAR;
  const Vsc = c.q_sc_scf_day * t_days;
  const Vr_rb = Vsc * gas.Bg_rb_scf;
  const tD = (TIME_COEFFICIENT_YEARS * p.k_mD * year) / (p.mu_gas_cP * p.porosity * p.rw_ft ** 2 * ct);
  const uw = 1.0 / (4.0 * tD);
  const E1w = exp1(uw);
  const pD = 0.5 * E1w;
  const q_reservoir = c.q_sc_scf_day * gas.Bg_rb_scf;
  const delta_p = ((PRESSURE_COEFFICIENT * p.mu_gas_cP * q_reservoir) / (p.k_mD * p.h_ft)) * (pD + p.skin);
  const bhp = p.initial_pressure_psia + delta_p;
  const result: Row = {
    year, P_used_psia: property_pressure, t_days,
    ...gas, ...c, Vsc_scf: Vsc, Vr_rb,
    Vr_ft3: Vr_rb * FT3_PER_BBL, Minj_lb: c.rho_sc_lb_scf * Vsc,
    krg_single_phase: 1.0, Lambda1_mD_cP: p.k_mD / p.mu_gas_cP,
    ct1_per_psi: ct, m1: 1.0, c1_star: 1.0, D1: 1.0,
    tD, uw, E1w,
    pD_gas_reference: pD, pD_intrinsic_reference: pD,
    q_reservoir_rb_day: q_reservoir,
    total_delta_p_psi: delta_p, annual_gain_psi: bhp - property_pressure,
    BHP_psia: bhp,
  };
  if (bhp <= 0 || !Object.values(result).every(Number.isFinite)) fail("Single-phase calculation produced an invalid value.");
  return result;
}

/** Single-phase water in an initially water-filled infinite reservoir. */
function calculateSinglePhaseWaterYear(year: number, property_pressure: number, p: Inputs, c: Row): Row {
  const water = waterProperties(property_pressure, p);
  const ct = p.water_compressibility_per_psi + p.rock_compressibility_per_psi;
  const t_days = year * DAYS_PER_YEAR;
  const q_reservoir = p.water_rate_stb_day * water.Bw_rb_stb;
  const tD = (TIME_COEFFICIENT_YEARS * p.k_mD * year) / (p.mu_water_cP * p.porosity * p.rw_ft ** 2 * ct);
  const uw = 1.0 / (4.0 * tD);
  const E1w = exp1(uw);
  const pD = 0.5 * E1w;
  const delta_p = ((PRESSURE_COEFFICIENT * p.mu_water_cP * q_reservoir) / (p.k_mD * p.h_ft)) * (pD + p.skin);
  const bhp = p.initial_pressure_psia + delta_p;
  const result: Row = {
    year, P_used_psia: property_pressure, t_days,
    ...water, ...c, Vwater_stb: p.water_rate_stb_day * t_days,
    Vr_rb: q_reservoir * t_days, Vr_ft3: q_reservoir * t_days * FT3_PER_BBL,
    Minj_lb: c.water_mass_per_stb_lb * p.water_rate_stb_day * t_days,
    krw_single_phase: 1.0, Lambda1_mD_cP: p.k_mD / p.mu_water_cP,
    ct1_per_psi: ct, m1: 1.0, c1_star: 1.0, D1: 1.0,
    tD, uw, E1w,
    pD_water_reference: pD, pD_intrinsic_reference: pD,
    q_reservoir_rb_day: q_reservoir,
    total_delta_p_psi: delta_p, annual_gain_psi: bhp - property_pressure,
    BHP_psia: bhp,
  };
  if (bhp <= 0 || !Object.values(result).every(Number.isFinite)) fail("Single-phase water calculation produced an invalid value.");
  return result;
}

/** Dispatch to one physical model; never combine their pressure terms. */
export function calculateYear(year: number, property_pressure: number, p: Inputs, c: Row): Row {
  if (!Number.isFinite(year) || year <= 0) fail("Elapsed time must be positive; use the initial state at t=0.");
  if (isWaterMode(p)) return calculateSinglePhaseWaterYear(year, property_pressure, p, c);
  if (p.phase_mode === "single") return calculateSinglePhaseYear(year, property_pressure, p, c);
  if (p.phase_mode === "two") return calculateTwoPhaseYear(year, property_pressure, p, c);
  return fail("Select phase_mode='single' or phase_mode='two'.");
}

/** Close the pressure/property coupling at a fixed cumulative elapsed time. */
export function solveYear(year: number, previous_bhp: number, p: Inputs, constants: Row, yearIsInt = false): Row {
  let evaluations = 0;
  const evaluate = (trial: number): [Row, number] => {
    evaluations += 1;
    let r: Row;
    try {
      r = calculateYear(year, trial, p, constants);
    } catch (e) {
      throw new BhpError(`Property pressure ${trial.toFixed(6)} psia: ${e instanceof Error ? e.message : String(e)}`);
    }
    return [r, trial - r.BHP_psia];
  };
  let trial = previous_bhp;
  let previous_trial: number | null = null;
  let previous_residual: number | null = null;
  let result: Row = {};
  let residual = NaN;
  let done = false;
  for (let i = 0; i < MAX_PRESSURE_ITERATIONS; i++) {
    [result, residual] = evaluate(trial);
    if (Math.abs(residual) < PRESSURE_TOLERANCE_PSI) { done = true; break; }
    if (previous_residual !== null && previous_trial !== null && previous_residual * residual < 0) {
      const lower = Math.min(previous_trial, trial), upper = Math.max(previous_trial, trial);
      let root: number;
      try {
        root = brentq((x) => evaluate(x)[1], lower, upper, 1e-8, 1e-12, MAX_PRESSURE_ITERATIONS);
      } catch (e) {
        if (e instanceof BhpError) throw e;
        throw new BhpError("Pressure/property solve did not converge.");
      }
      [result, residual] = evaluate(root);
      if (Math.abs(residual) >= PRESSURE_TOLERANCE_PSI) {
        fail(`Pressure/property residual ${pyFormat(residual, ".6g")} psi exceeds the ${pyFormat(PRESSURE_TOLERANCE_PSI, "g")} psi tolerance.`);
      }
      done = true;
      break;
    }
    previous_trial = trial;
    previous_residual = residual;
    trial = result.BHP_psia;
  }
  if (!done) fail(`Pressure/property solve did not converge after ${MAX_PRESSURE_ITERATIONS} fixed-point trials; last residual was ${pyFormat(residual, ".6g")} psi.`);
  // Annual gain compares time levels, not the final nonlinear trial pressures.
  result.annual_gain_psi = result.BHP_psia - previous_bhp;
  if (isWaterMode(p)) result.rho_water_at_BHP_lb_ft3 = waterProperties(result.BHP_psia, p).rho_water_lb_ft3;
  else if (p.phase_mode === "single") result.rho_g_at_BHP_lb_ft3 = result.rho_g_lb_ft3;
  else result.rho_g_at_BHP_lb_ft3 = calculateCo2Density(result.BHP_psia, p.temperature_F);
  result.pressure_evaluations = evaluations;
  result.pressure_residual_psi = residual;
  if (yearIsInt) markInt(result, "year");
  return result;
}

/** Solve pressure and properties together at each annual reporting time. */
export function runModel(p: Inputs, years: number): { results: Row[]; constants: Row } {
  validate(p);
  if (!Number.isInteger(years) || years < 1) fail("Number of years must be a positive integer.");
  const constants = referenceQuantities(p);
  let pressure = p.initial_pressure_psia;
  const results: Row[] = [];
  for (let year = 1; year <= years; year++) {
    let result: Row;
    try {
      result = solveYear(year, pressure, p, constants, true);
    } catch (e) {
      throw new BhpError(`Year ${year}, starting pressure ${pressure.toFixed(6)} psia: ${e instanceof Error ? e.message : String(e)}`);
    }
    results.push(result);
    pressure = result.BHP_psia; // next year's initial pressure guess
  }
  return { results, constants };
}

export const SUMMARY_FIELDS = [
  "year", "phase_count", "single_fluid_code", "P_used_psia",
  "Bw_rb_stb", "cw_per_psi", "rho_water_lb_ft3", "rho_water_at_BHP_lb_ft3", "Bg_rb_scf", "cg_per_psi", "rho_g_lb_ft3",
  "rho_g_at_BHP_lb_ft3",
  "corey_n_gas", "corey_n_water", "sf_normalized", "Sg_front",
  "gas_front_factor", "rd_ft", "dry_zone_thickness_ft", "Vp1_ft3", "Mg1_lb",
  "rg_ft", "Sg2", "Sw2", "krg2", "krw2",
  "Lambda2_mD_cP",
  "pD_gas_reference", "pD_intrinsic_reference",
  "total_delta_p_psi", "annual_gain_psi", "BHP_psia",
  "pressure_evaluations", "pressure_residual_psi",
  "max_allowable_BHP_psia", "pressure_limit_status", "pressure_margin_psi", "pressure_exceedance_psi",
];

/** Calculate plotting samples without changing the annual model results. */
export function calculateFirstYearDetail(annual_results: Row[], p: Inputs, constants: Row): Row[] {
  const water_mode = isWaterMode(p);
  let initial_gas: Row;
  if (water_mode) {
    initial_gas = waterProperties(p.initial_pressure_psia, p);
    initial_gas.rho_water_at_BHP_lb_ft3 = initial_gas.rho_water_lb_ft3;
  } else if (p.phase_mode === "single") {
    initial_gas = prState(p.initial_pressure_psia, p.temperature_F);
    initial_gas.cg_per_psi = constants.initial_cg_per_psi;
    initial_gas.rho_g_lb_ft3 = constants.initial_gas_density_calculated_lb_ft3;
    initial_gas.rho_g_at_BHP_lb_ft3 = constants.initial_gas_density_calculated_lb_ft3;
    initial_gas.Bg_rb_scf = constants.initial_Bg_rb_scf;
  } else {
    initial_gas = gasProperties(p.initial_pressure_psia, p.temperature_F, constants.Zsc);
    initial_gas.rho_g_at_BHP_lb_ft3 = initial_gas.rho_g_lb_ft3;
  }
  const detailed: Row[] = [{
    year: 0.0, t_days: 0.0, phase_count: constants.phase_count,
    single_fluid_code: constants.single_fluid_code,
    P_used_psia: p.initial_pressure_psia,
    BHP_psia: p.initial_pressure_psia, total_delta_p_psi: 0.0,
    ...initial_gas,
    ...(p.phase_mode === "two" ? { rd_ft: p.rw_ft, rg_ft: p.rw_ft, dry_zone_thickness_ft: 0.0, Vp1_ft3: 0.0, Mg1_lb: 0.0 } : {}),
    pressure_evaluations: 0, pressure_residual_psi: 0.0,
  }];
  const subdaily_days = geomspace(1.0 / 86400.0, 1.0, water_mode ? 241 : 61);
  const later_days: number[] = [];
  if (water_mode) for (let i = 0; 1.25 + i * 0.25 < DAYS_PER_YEAR; i++) later_days.push(1.25 + i * 0.25);
  else for (let i = 0; 2.0 + i * 1.0 < DAYS_PER_YEAR; i++) later_days.push(2.0 + i * 1.0);
  // Include exact minute/hour checkpoints so plotted BHP labels use solved values at those times.
  const label_checkpoint_days = [1.0 / 1440.0, 1.0 / 24.0];
  const sample_days = uniqueSorted([...subdaily_days, ...label_checkpoint_days, ...later_days]);
  let pressure_guess = p.initial_pressure_psia;
  for (const days of sample_days) {
    const elapsed_years = days / DAYS_PER_YEAR;
    let result: Row;
    try {
      result = solveYear(elapsed_years, pressure_guess, p, constants);
    } catch (e) {
      throw new BhpError(`First-year detail at ${pyFormat(days, ".9g")} days: ${e instanceof Error ? e.message : String(e)}`);
    }
    detailed.push(result);
    pressure_guess = result.BHP_psia;
  }
  // Reuse the annual endpoint exactly; retain one sample at year 1.
  detailed.push(copyRow(annual_results[0]));
  return detailed;
}

/** One reporting time after shut-in; `int` is true when the Python holds it as an int (blank list). */
export interface Offset {
  v: number;
  int: boolean;
}

/** Validate the shut-in duration and return sorted reporting offsets (Python `observation_schedule`). */
export function observationSchedule(period: number, selected: string | number[]): { period: number; offsets: Offset[] } {
  if (typeof period !== "number" || !Number.isFinite(period) || period < 0) fail("Observation period must be a finite number of years >= 0.");
  let list: (string | number)[] = typeof selected === "string" ? (selected.trim() ? selected.split(",") : []) : selected;
  if (period === 0) {
    if (list.length) fail("Enter a positive observation period before selecting observation years.");
    return { period, offsets: [] };
  }
  if (!list.length) {
    const offsets: Offset[] = [];
    for (let k = 1; k <= Math.floor(period); k++) offsets.push({ v: k, int: true });
    if (!offsets.length || offsets[offsets.length - 1].v !== period) offsets.push({ v: period, int: false });
    return { period, offsets };
  }
  let vals: number[];
  try {
    vals = list.map((v) => (typeof v === "number" ? v : parsePyFloat(v)));
  } catch {
    return fail(`Observation years must be numbers between 0 and ${pyFormat(period, "g")}.`);
  }
  list = [];
  const sorted = uniqueSorted(vals);
  if (sorted.some((v) => !Number.isFinite(v) || !(v >= 0 && v <= period))) fail(`Observation years must be numbers between 0 and ${pyFormat(period, "g")}.`);
  return { period, offsets: sorted.map((v) => ({ v, int: false })) };
}

/** Python float(text): accepts surrounding spaces, signs, decimals, exponents, inf and nan; throws otherwise. */
export function parsePyFloat(text: string): number {
  const t = text.trim().replace(/_/g, "");
  if (/^[+-]?(inf|infinity)$/i.test(t)) return t.startsWith("-") ? -Infinity : Infinity;
  if (/^[+-]?nan$/i.test(t)) return NaN;
  if (!/^[+-]?((\d+\.?\d*)|(\.\d+))([eE][+-]?\d+)?$/.test(t)) throw new BhpError(`could not convert string to float: '${text}'`);
  return Number(t);
}

/** Python `positive_integer` for the number of injection years. */
export function positiveInteger(text: string): number {
  const t = text.trim();
  if (!/^[+-]?\d+$/.test(t)) fail("Enter a positive integer number of years.");
  const v = parseInt(t, 10);
  if (v < 1) fail("Number of years must be at least 1.");
  return v;
}

export interface Observation {
  rows: Row[];
  elapsed_years: number[];
  bhp_psia: number[];
}

/** Solve the tridiagonal system (lower, diag, upper) x = rhs in place of rhs. */
function triSolve(l: Float64Array, d: Float64Array, u: Float64Array, rhs: Float64Array): void {
  const n = d.length;
  const cp = new Float64Array(n);
  let den = d[0];
  cp[0] = n > 1 ? u[0] / den : 0;
  rhs[0] /= den;
  for (let i = 1; i < n; i++) {
    den = d[i] - l[i - 1] * cp[i - 1];
    if (i < n - 1) cp[i] = u[i] / den;
    rhs[i] = (rhs[i] - l[i - 1] * rhs[i - 1]) / den;
  }
  for (let i = n - 2; i >= 0; i--) rhs[i] -= cp[i] * rhs[i + 1];
}

/** Diffuse the final pressure profile at zero well flow with frozen properties (Python `calculate_observation`). */
export function calculateObservation(final: Row, p: Inputs, make_plot = true): Observation | null {
  const { period, offsets } = observationSchedule(p.observation_period_years, p.observation_years);
  if (!offsets.length) return null;
  // Mobility is in mD/cP, storage in 1/psi, and the radial grid is in ft.
  const active_zones = p.phase_mode === "two" ? [1, 2, 3] : [1];
  const mobility = active_zones.map((z) => final[`Lambda${z}_mD_cP`]);
  const storage = active_zones.map((z) => p.porosity * final[`ct${z}_per_psi`]);
  const diffusivity = mobility.map((mo, i) => (TIME_COEFFICIENT_YEARS * mo) / storage[i]);
  // Keep the fixed-pressure outer edge well beyond the diffusing disturbance.
  const outer_front = p.phase_mode === "two" ? final.rg_ft : p.rw_ft;
  const outer_radius = outer_front + 12 * Math.sqrt(Math.max(...diffusivity) * (final.year + period));
  const zone_edges = p.phase_mode === "two" ? [p.rw_ft, final.rd_ft, final.rg_ft, outer_radius] : [p.rw_ft, outer_radius];
  const faces: number[] = [p.rw_ft];
  const zones: number[] = [];
  for (let zone = 0; zone < zone_edges.length - 1; zone++) {
    const inner = zone_edges[zone], outer = zone_edges[zone + 1];
    if (outer > inner) {
      const cells = Math.ceil(Math.log(outer / inner) / 0.04);
      faces.push(...geomspace(inner, outer, cells + 1).slice(1));
      for (let k = 0; k < cells; k++) zones.push(zone);
    }
  }
  const n = zones.length;
  const centers = new Float64Array(n);
  const cell_storage = new Float64Array(n);
  const cell_mobility = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    centers[i] = Math.sqrt(faces[i] * faces[i + 1]);
    cell_storage[i] = (storage[zones[i]] * (faces[i + 1] ** 2 - faces[i] ** 2)) / 2;
    cell_mobility[i] = mobility[zones[i]];
  }
  // Integrate the cylindrical flow resistance from each cell center to the shared face.
  const lower = new Float64Array(Math.max(n - 1, 0));
  const upper = new Float64Array(Math.max(n - 1, 0));
  const diagonal = new Float64Array(n);
  for (let i = 0; i < n - 1; i++) {
    const interface_resistance = Math.log(faces[i + 1] / centers[i]) / cell_mobility[i] + Math.log(centers[i + 1] / faces[i + 1]) / cell_mobility[i + 1];
    const conductance = TIME_COEFFICIENT_YEARS / interface_resistance;
    lower[i] = conductance / cell_storage[i + 1];
    upper[i] = conductance / cell_storage[i];
    diagonal[i + 1] -= lower[i];
    diagonal[i] -= upper[i];
  }
  // Inner face flux is zero. The far edge has zero excess pressure.
  diagonal[n - 1] -= (TIME_COEFFICIENT_YEARS * cell_mobility[n - 1]) / (Math.log(outer_radius / centers[n - 1]) * cell_storage[n - 1]);

  let scale: number, offsets_a: number[], coefficients_b: number[], ratios_D: number[], well_dimensionless_pressure: number;
  if (p.phase_mode === "two") {
    scale = (PRESSURE_COEFFICIENT * p.mu_gas_cP * final.q_reservoir_rb_day) / (p.k_mD * p.h_ft * p.krg_zone1);
    offsets_a = [final.a1, final.a2, final.a3];
    coefficients_b = [final.b1, final.b2, final.b3];
    ratios_D = [final.D1, final.D2, final.D3];
    well_dimensionless_pressure = final.pD_gas_reference;
  } else {
    const viscosity = isWaterMode(p) ? p.mu_water_cP : p.mu_gas_cP;
    scale = (PRESSURE_COEFFICIENT * viscosity * final.q_reservoir_rb_day) / (p.k_mD * p.h_ft);
    offsets_a = [0.0];
    coefficients_b = [0.5];
    ratios_D = [1.0];
    well_dimensionless_pressure = final.pD_intrinsic_reference;
  }
  const y0 = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const z = zones[i];
    const argument = (centers[i] / p.rw_ft) ** 2 / (4 * ratios_D[z] * final.tD);
    y0[i] = scale * (offsets_a[z] + coefficients_b[z] * exp1(argument));
  }

  let times = [0.0, period, ...offsets.map((o) => o.v)];
  if (make_plot) {
    const first_plot_year = Math.min(period / 100, 1 / (DAYS_PER_YEAR * 86400));
    times.push(...geomspace(first_plot_year, period, 90));
  }
  times = uniqueSorted(times);
  // Time integration of d(excess)/dt = operator @ excess: L-stable implicit Euler with Richardson extrapolation on
  // geometric steps that hit every requested time (the Python uses scipy's BDF with rtol 2e-7).
  const tiny = Math.min(period / 100, 1 / (DAYS_PER_YEAR * 86400)) / 10;
  const grid = new Set<number>(times);
  const steps = 700;
  for (let k = 0; k <= steps; k++) grid.add(tiny * (period / tiny) ** (k / steps));
  const stepTimes = [...grid].filter((t) => t >= 0 && t <= period).sort((a, b) => a - b);
  const ieStep = (y: Float64Array, h: number): Float64Array => {
    const x = Float64Array.from(y);
    triSolve(lower.map((v) => -h * v), diagonal.map((v) => 1 - h * v), upper.map((v) => -h * v), x);
    return x;
  };
  const wellAt = new Map<number, number>();
  let y = y0;
  let tPrev = 0;
  for (const t of stepTimes) {
    if (t > tPrev) {
      const h = t - tPrev;
      const coarse = ieStep(y, h);
      const fine = ieStep(ieStep(y, h / 2), h / 2);
      const next = new Float64Array(n);
      for (let i = 0; i < n; i++) next[i] = 2 * fine[i] - coarse[i];
      y = next;
      tPrev = t;
    }
    wellAt.set(t, y[0]);
  }
  if (![...wellAt.values()].every(Number.isFinite)) fail("Shut-in pressure solve failed: non-finite pressure.");
  // The first cell approximates the zero-flow well pressure at positive time.
  // At shut-in itself the analytical formation pressure is available at rw.
  const well_excess = times.map((t) => (t === 0 ? scale * well_dimensionless_pressure : (wellAt.get(t) as number)));
  const byTime = new Map(times.map((t, i) => [t, well_excess[i]]));
  const finalYearInt = isInt(final, "year");
  const rows: Row[] = offsets.map((o) => {
    const buildup = byTime.get(o.v) as number;
    const bhp = p.initial_pressure_psia + buildup;
    const row: Row = {
      years_after_shut_in: o.v,
      elapsed_year: final.year + o.v,
      BHP_psia: bhp,
      total_delta_p_psi: buildup,
      falloff_from_flowing_BHP_psi: final.BHP_psia - bhp,
      ...(isWaterMode(p)
        ? { q_water_stb_day: 0.0, cumulative_injected_water_stb: final.Vwater_stb }
        : { q_sc_scf_day: 0.0, cumulative_injected_CO2_scf: final.Vsc_scf }),
      ...(p.phase_mode === "two"
        ? { rd_ft: final.rd_ft, rg_ft: final.rg_ft, dry_zone_thickness_ft: final.dry_zone_thickness_ft, Vp1_ft3: final.Vp1_ft3, Mg1_lb: final.Mg1_lb }
        : {}),
    };
    if (o.int) markInt(row, "years_after_shut_in");
    if (o.int && finalYearInt) markInt(row, "elapsed_year");
    return row;
  });
  return {
    rows,
    elapsed_years: times.map((t) => final.year + t),
    bhp_psia: well_excess.map((e) => p.initial_pressure_psia + e),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// The browser form of the Python (`_browser_calculation`): one complete run and its outputs.

export const BROWSER_PHASES: Record<string, [PhaseMode, SingleFluid, string]> = {
  two: ["two", "co2", "Two-phase CO₂–brine"],
  water: ["single", "water", "Single-phase water"],
  co2: ["single", "co2", "Single-phase CO₂"],
};

/** Values typed in the form (all text, as the Python form posts them). */
export interface FormValues {
  phase: string;
  years: string;
  evaporation: "yes" | "no";
  observe: "yes" | "no";
  period: string;
  offsets: string;
  fields: Record<string, string>;
  /** pressure check of the form: limit_mode none | max_bhp | fracture_fraction */
  limit_mode?: string;
  max_bhp_psia?: string;
  fracture_pressure_psia?: string;
  pressure_fraction?: string;
}

/** `pressure_limit_from_form` */
export function pressureLimitFromForm(v: { limit_mode?: string; max_bhp_psia?: string; fracture_pressure_psia?: string; pressure_fraction?: string }): PressureLimit {
  return pressureLimitSpec({
    mode: v.limit_mode ?? "none", max_bhp_psia: v.max_bhp_psia ?? "", fracture_pressure_psia: v.fracture_pressure_psia ?? "",
    fraction: v.pressure_fraction ?? 0.9,
  });
}

export interface RunOutput {
  label: string;
  years: number;
  p: Inputs;
  results: Row[];
  constants: Row;
  observation: Observation | null;
  firstYear: Row[];
  /** the pressure check (`save_results` applies it to every table) */
  pressureLimit: PressureLimit;
}

/** The pressure-status part of `save_results`: status columns on the annual, first-year and observation rows. */
export function withPressureLimit(out: Omit<RunOutput, "pressureLimit">, limit?: LimitInput | PressureLimit | null): RunOutput {
  const pressureLimit = pressureLimitSpec(limit);
  applyPressureStatus(out.results, pressureLimit);
  applyPressureStatus(out.firstYear, pressureLimit);
  if (out.observation) applyPressureStatus(out.observation.rows, pressureLimit);
  return { ...out, pressureLimit };
}

/** Python `_browser_calculation` up to (and including) `save_results`' calculations. Throws BhpError with the Python's message. */
export function browserCalculation(values: FormValues): RunOutput {
  if (!(values.phase in BROWSER_PHASES)) fail("Select a phase.");
  const [phase, fluid, label] = BROWSER_PHASES[values.phase];
  const years = positiveInteger(values.years ?? "");
  const p: Inputs = { ...DEFAULT_INPUTS, phase_mode: phase, single_phase_fluid: fluid };
  if (phase === "two") {
    if (!["yes", "no"].includes(values.evaporation)) fail("Choose Yes or No for Include evaporation.");
    p.include_evaporation = values.evaporation === "yes";
  }
  for (const name of inputNamesForPhase(phase, fluid)) {
    const text = values.fields[name];
    try {
      (p as unknown as Record<string, number>)[name] = text === undefined ? (p[name] as number) : parsePyFloat(text);
    } catch {
      fail(`Enter a number for ${PROMPTS[name]}.`);
    }
  }
  if (values.observe === "yes") {
    try {
      p.observation_period_years = parsePyFloat(values.period ?? "");
    } catch {
      fail("Enter a positive observation duration in years.");
    }
    if (!Number.isFinite(p.observation_period_years) || p.observation_period_years <= 0) fail("Enter a positive, finite observation duration in years.");
    p.observation_years = (values.offsets ?? "").trim();
  }
  const { results, constants } = runModel(p, years);
  const observation = calculateObservation(results[results.length - 1], p, true);
  const limit = pressureLimitFromForm(values);
  const firstYear = calculateFirstYearDetail(results, p, constants);
  return withPressureLimit({ label, years, p, results, constants, observation, firstYear }, limit);
}

// ---------------------------------------------------------------------------------------------------------------
// Output files written by the Python `save_results`.

/** csv.DictWriter with extrasaction="ignore" (missing keys are blank), \r\n line endings. */
export function csvText(columns: string[], rows: Row[]): string {
  const lines = [columns.map(csvField).join(",")];
  for (const r of rows) lines.push(columns.map((c) => (c in r ? csvField(pyStr(r, c)) : "")).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** csv module QUOTE_MINIMAL: a field holding a comma, a quote or a line break is quoted. */
export function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** `_write_multiwell_csv`: the columns are every key in order of first appearance (or the fallback columns when empty). */
export function dictCsv(rows: Row[], fallback: string[] = []): string {
  const keys: string[] = [];
  const seen = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) if (!seen.has(k)) { seen.add(k); keys.push(k); }
  return csvText(rows.length ? keys : fallback, rows);
}

// ---------------------------------------------------------------------------------------------------------------
// Pressure-limit assessment (a user-provided operating limit, not a mechanical integrity model).

export type LimitMode = "none" | "max_bhp" | "fracture_fraction";
export interface PressureLimit {
  mode: LimitMode;
  max_bhp_psia?: number;
  fracture_pressure_psia?: number;
  fraction?: number;
  allowable_bhp_psia: number | null;
}
export interface LimitInput {
  mode?: string;
  max_bhp_psia?: number | string | null;
  fracture_pressure_psia?: number | string | null;
  fraction?: number | string | null;
}

/** Python float() of a number or text. */
function toFloat(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parsePyFloat(v);
  throw new BhpError("not a number");
}

/** `pressure_limit_spec` */
export function pressureLimitSpec(value?: LimitInput | PressureLimit | null): PressureLimit {
  const v = { ...(value ?? {}) } as LimitInput;
  const mode = v.mode ?? "none";
  if (mode === "none") return { mode: "none", allowable_bhp_psia: null };
  if (mode !== "max_bhp" && mode !== "fracture_fraction") fail("Choose no pressure assessment, maximum BHP, or a fracture-pressure fraction.");
  const key = mode === "max_bhp" ? "max_bhp_psia" : "fracture_pressure_psia";
  let pressure = NaN, fraction = NaN;
  try {
    if (!(key in v) || v[key] === undefined) throw new Error("KeyError");
    pressure = toFloat(v[key]);
    fraction = v.fraction === undefined ? 0.9 : toFloat(v.fraction);
  } catch {
    fail("Enter a positive pressure limit in absolute psia.");
  }
  if (!Number.isFinite(pressure) || pressure <= 0) fail("The pressure limit must be finite and positive psia.");
  if (mode === "fracture_fraction" && (!Number.isFinite(fraction) || !(fraction > 0 && fraction <= 1))) fail("The allowable fraction of fracture pressure must be greater than 0 and at most 1.");
  return { mode, [key]: pressure, fraction, allowable_bhp_psia: mode === "max_bhp" ? pressure : pressure * fraction } as PressureLimit;
}

/** `pressure_status`: the status columns for one BHP. `wellMax` is a well's own maximum BHP (overrides the shared limit). */
export function pressureStatus(bhp: number, spec?: LimitInput | PressureLimit | null, wellMax: number | null = null): Row {
  const s = pressureLimitSpec(spec);
  const limit = wellMax !== null && wellMax !== undefined ? wellMax : s.allowable_bhp_psia;
  if (limit === null) {
    return { max_allowable_BHP_psia: "", pressure_limit_status: "NOT ASSESSED", pressure_margin_psi: "", pressure_exceedance_psi: "", failure_criterion: "No pressure limit supplied" };
  }
  return {
    max_allowable_BHP_psia: limit, pressure_limit_status: bhp > limit ? "FAIL" : "PASS",
    pressure_margin_psi: limit - bhp, pressure_exceedance_psi: Math.max(0.0, bhp - limit),
    failure_criterion: "Required BHP exceeds the user-specified allowable BHP",
  };
}

/** `apply_pressure_status` (updates the rows in place, as dict.update). */
export function applyPressureStatus<T extends Row>(rows: T[], spec?: LimitInput | PressureLimit | null, wellMax: number | null = null): T[] {
  for (const r of rows) Object.assign(r, pressureStatus(r.BHP_psia, spec, wellMax));
  return rows;
}

/** `pressure_failure_summary`: peak BHP, minimum margin and first sampled exceedance of every well. */
export function pressureFailureSummary(rows: Row[], defaultName = "Well 1"): Row[] {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const name = "well" in r ? r.well : defaultName;
    if (!groups.has(name)) groups.set(name, []);
    (groups.get(name) as Row[]).push(r);
  }
  const yearOf = (r: Row): [unknown, boolean] => ("year" in r ? [r.year, isInt(r, "year")] : "elapsed_year" in r ? [r.elapsed_year, isInt(r, "elapsed_year")] : ["", false]);
  const out: Row[] = [];
  for (const [name, values] of groups) {
    const peak = values.reduce((m, r) => (r.BHP_psia > m.BHP_psia ? r : m), values[0]);
    const failed = values.filter((r) => r.pressure_limit_status === "FAIL");
    const assessed = values.some((r) => r.pressure_limit_status === "PASS" || r.pressure_limit_status === "FAIL");
    const margins = values.map((r) => r.pressure_margin_psi).filter((v) => typeof v === "number") as number[];
    let first: [unknown, boolean] = ["", false];
    for (const r of failed) {
      const y = "year" in r ? yearOf(r) : "elapsed_year" in r ? yearOf(r) : [0, true] as [unknown, boolean];
      if (first[0] === "" || (y[0] as number) < (first[0] as number)) first = y;
    }
    const [peakYear, peakYearInt] = yearOf(peak);
    const row: Row = {
      well: name, overall_status: failed.length ? "FAIL" : assessed ? "PASS" : "NOT ASSESSED",
      max_allowable_BHP_psia: "max_allowable_BHP_psia" in peak ? peak.max_allowable_BHP_psia : "",
      peak_BHP_psia: peak.BHP_psia,
      peak_project_year: peakYear,
      minimum_pressure_margin_psi: margins.length ? Math.min(...margins) : "",
      first_detected_failure_year: first[0],
      assessment: "Pressure limit at computed sample times; not a mechanical integrity prediction",
    };
    if (peakYearInt) markInt(row, "peak_project_year");
    if (first[1]) markInt(row, "first_detected_failure_year");
    out.push(row);
  }
  return out;
}

export const LIMIT_FIELDS = ["max_allowable_BHP_psia", "pressure_limit_status", "pressure_margin_psi", "pressure_exceedance_psi"];

export const DETAIL_FIELDS = [
  "year", "phase_count", "single_fluid_code", "t_days",
  "Bw_rb_stb", "cw_per_psi", "rho_water_lb_ft3", "rho_water_at_BHP_lb_ft3", "P_used_psia", "BHP_psia", "total_delta_p_psi",
  "rho_g_lb_ft3", "rho_g_at_BHP_lb_ft3", "Bg_rb_scf", "cg_per_psi",
  "rd_ft", "dry_zone_thickness_ft", "Vp1_ft3", "Mg1_lb", "rg_ft",
  "pressure_evaluations", "pressure_residual_psi",
  "max_allowable_BHP_psia", "pressure_limit_status", "pressure_margin_psi", "pressure_exceedance_psi",
];

/** json.dumps(value, indent=2, allow_nan=False) of the Python (ensure_ascii, ints vs floats). */
export function pyJson(v: unknown, indent = 0): string {
  const pad = (k: number) => " ".repeat(k);
  if (v === null || v === undefined) return "null";
  if (v instanceof PyInt) return String(v.v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error("Out of range float values are not JSON compliant");
    return pyFloat(v);
  }
  if (typeof v === "string") return JSON.stringify(v).replace(/[\u007f-￿]/g, (ch) => `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}`);
  if (Array.isArray(v)) {
    if (!v.length) return "[]";
    return `[\n${v.map((x) => pad(indent + 2) + pyJson(x, indent + 2)).join(",\n")}\n${pad(indent)}]`;
  }
  const entries = Object.entries(v as Record<string, unknown>);
  if (!entries.length) return "{}";
  return `{\n${entries.map(([k, x]) => `${pad(indent + 2)}${pyJson(k)}: ${pyJson(x, indent + 2)}`).join(",\n")}\n${pad(indent)}}`;
}

const rowJson = (r: Row) => Object.fromEntries(Object.keys(r).map((k) => [k, isInt(r, k) ? new PyInt(r[k]) : r[k]]));

/** inputs_used.json */
export function inputsUsed(out: RunOutput): string {
  const { p, results, constants, observation } = out;
  const water_mode = isWaterMode(p);
  const method: Record<string, unknown> = {
    wells_M: new PyInt(1), constant_rate_periods_N1: new PyInt(1),
    days_per_year: DAYS_PER_YEAR,
    property_pressure: "converged same-year BHP within the pressure residual tolerance",
    elapsed_time: "cumulative year n",
    BHP: "initial pressure + total_delta_p",
    update: "within-year pressure/property solve at fixed cumulative time and injected standard mass",
    pressure_initial_guess: "previous year's BHP; initial pressure in year 1",
    pressure_residual_tolerance_psi: PRESSURE_TOLERANCE_PSI,
    maximum_pressure_iterations: new PyInt(MAX_PRESSURE_ITERATIONS),
    pressure_residual: "P_used_psia - BHP_psia",
    pressure_evaluations: "number of annual-equation evaluations in the within-year solve",
    gas_density: "calculated from rho = p*M/(Z*R*T); not an input",
    gas_density_timing: "rho_g_lb_ft3 uses converged P_used_psia; rho_g_at_BHP_lb_ft3 uses BHP_psia; pressures agree within tolerance",
    vapor_correction: "blue-cancelled factor omitted",
    pressure_reference: "intrinsic k with pD_gas_reference / krg_zone1",
    leading_front: "n=3: (M_lambda-1)*sf^3+3*sf-2=0; F3=(sf+2)/(3*sf*(1-Swr)); n=2 uses its matching quadratic front",
    gas_front_radius: "sqrt(rw^2 + Vr_ft3*gas_front_factor/(pi*phi*h))",
    dry_front_radius: "center-based boundary rd = sqrt(rw^2 + alpha_d*Vr_ft3/(pi*phi*h)) with evaporation; rd = rw without evaporation",
    dry_zone_thickness: "dry_zone_thickness_ft = rd - rw; exactly 0 without evaporation",
    dry_zone_without_evaporation: "yw = ceq = alpha_d = dry_zone_thickness_ft = Vp1_ft3 = Mg1_lb = 0; internal rd_ft = rw_ft",
    zone2_saturation: "representative mass-balance saturation; distinct from leading-front saturation Sg_front",
    plot_initial_state: "time = 0; BHP = initial_pressure_psia",
    first_year_sampling: "61 geometrically spaced samples from 1 second to 1 day, plus exact 1-minute and 1-hour checkpoints; daily from day 2; exact year-1 endpoint",
    later_year_sampling: "annual endpoints only",
    full_period_time_tick_interval_years: new PyInt(2),
    first_year_plot_axis: "linear from 0 to 1 second; logarithmic thereafter",
    first_year_checkpoints: "0, 1 second, 1 minute, 1 hour, 1 day, 30 days, 1 year; matching markers on both panels",
    pressure_axis: "ticks start at initial_pressure_psia; regular 100-psi intervals; 5 percent visual margin below initial pressure",
  };
  const saved: Record<string, unknown> = {
    years: new PyInt(results.length),
    parameters: { ...p },
    references: rowJson(constants),
    pressure_limit: out.pressureLimit,
    phase_mode: p.phase_mode,
    phase_description: modelLabel(p),
    method,
  };
  if (observation) {
    method.observation = "Zero-flow radial pressure diffusion with zone geometry, mobility, and storage frozen at shut-in. Observation times are years after shut-in. Year zero reports formation pressure after removal of flowing skin.";
    saved.observation_report_years = observation.rows.map((r) => (isInt(r, "years_after_shut_in") ? new PyInt(r.years_after_shut_in) : r.years_after_shut_in));
  }
  if (p.phase_mode === "single") {
    Object.assign(method, {
      leading_front: "not applicable: initially single-phase CO2 reservoir",
      gas_front_radius: "not applicable", dry_front_radius: "not applicable",
      zone2_saturation: "not applicable", vapor_correction: "not applicable",
      relative_permeability: "1.0 for single-phase CO2",
      total_compressibility: "cg + rock compressibility",
      pressure_reference: "intrinsic k; pD = 0.5*E1(1/(4*tD))",
      limitation: "E1 slightly-compressible kernel with representative-BHP PR updates; not an exact real-gas solution",
    });
  }
  if (water_mode) {
    const n = results.length;
    Object.assign(method, {
      gas_density: "not applicable", gas_density_timing: "not applicable",
      leading_front: "not applicable: initially water-filled reservoir",
      relative_permeability: "1.0 for single-phase water",
      total_compressibility: "water compressibility + rock compressibility",
      pressure_reference: "intrinsic k; pD = 0.5*E1(1/(4*tD))",
      water_density: "rho_w(Pi)*exp(cw*(P-Pi))",
      water_Bw: "fixed at exactly 1.0 rb/STB for all times and pressures",
      surface_rate_unit: "STB/day", reservoir_rate: "q_water*1.0 (rb/day)",
      first_year_sampling: "241 logarithmically spaced samples from 1 second to 1 day, plus exact 1-minute and 1-hour checkpoints; every 6 hours after day 1; exact year-1 endpoint",
      pressure_axis: "Shared BHP range with rounded ticks anchored at initial pressure and padding around the full water curve",
      full_period_time_tick_interval_years: n <= 4 ? new PyInt(1) : n <= 30 ? new PyInt(2) : "automatic integer-year ticks",
      limitation: "slightly-compressible radial E1 approximation with constant water viscosity and cw",
    });
  } else if (p.phase_mode === "single") {
    Object.assign(method, {
      gas_formation_volume_factor: `Fixed at ${pyFormat(constants.initial_Bg_rb_scf, ".10f")} rb/scf`,
      gas_density: "Fixed at the Peng-Robinson value at the initial pressure and reservoir temperature",
      gas_density_timing: "Both density columns report the fixed initial density",
      total_compressibility: "Fixed initial cg + rock compressibility",
      reservoir_rate: "q_sc_scf_day * initial_Bg_rb_scf (rb/day)",
      limitation: "E1 slightly-compressible kernel with fixed Bg, cg and CO2 density",
    });
  }
  saved.active_input_names = inputNamesForPhase(p.phase_mode, p.single_phase_fluid);
  return pyJson(saved);
}

/** All files written by `save_results` (the plot image is made separately). */
export function outputFiles(out: RunOutput): Record<string, string> {
  const files: Record<string, string> = {
    "annual_summary.csv": csvText(SUMMARY_FIELDS, out.results),
    "all_calculations.csv": csvText(Object.keys(out.results[0]), out.results),
    "first_year_detail.csv": csvText(DETAIL_FIELDS, out.firstYear),
  };
  if (out.observation) {
    const rows = out.observation.rows;
    files["observation_summary.csv"] = csvText(Object.keys(rows[0]), rows);
  }
  files["pressure_limit_summary.csv"] = dictCsv(pressureLimitSummary(out));
  files["inputs_used.json"] = inputsUsed(out);
  return files;
}

/** Rows of pressure_limit_summary.csv: annual results, first-year samples and the shut-in curve. */
export function pressureLimitSummary(out: RunOutput): Row[] {
  const samples: Row[] = [...out.results, ...out.firstYear];
  if (out.observation) {
    const obs = out.observation;
    samples.push(...applyPressureStatus(obs.elapsed_years.map((t, i) => ({ year: t, BHP_psia: obs.bhp_psia[i] })), out.pressureLimit));
  }
  return pressureFailureSummary(samples);
}

// ---------------------------------------------------------------------------------------------------------------
// `_notebook_summary_html`: the columns and number formats of the tables the Python form shows.

export const SUMMARY_COLUMNS: [string, string, string][] = [
  ["Year", "year", ".0f"],
  ["Years after shut-in", "years_after_shut_in", ".10g"],
  ["Elapsed year", "elapsed_year", ".10g"],
  ["Water density at pressure used (lb/ft3)", "rho_water_lb_ft3", ".6f"],
  ["Water density at BHP (lb/ft3)", "rho_water_at_BHP_lb_ft3", ".6f"],
  ["Bw (rb/STB)", "Bw_rb_stb", ".8f"],
  ["cw (1/psi)", "cw_per_psi", ".7e"],
  ["Converged property pressure (psia)", "P_used_psia", ".4f"],
  ["CO2 density at pressure used (lb/ft3)", "rho_g_lb_ft3", ".6f"],
  ["CO2 density at new BHP (lb/ft3)", "rho_g_at_BHP_lb_ft3", ".6f"],
  ["Bg (rb/scf)", "Bg_rb_scf", ".10f"],
  ["cg (1/psi)", "cg_per_psi", ".7e"],
  ["Dry boundary from well center (ft)", "rd_ft", ".4f"],
  ["Dry-zone thickness (ft)", "dry_zone_thickness_ft", ".4f"],
  ["Dry-zone pore volume (ft3)", "Vp1_ft3", ".4f"],
  ["CO2 mass in dry zone (lb)", "Mg1_lb", ".4f"],
  ["Gas radius (ft)", "rg_ft", ".4f"],
  ["Normalized front saturation sf", "sf_normalized", ".6f"],
  ["Gas-front factor", "gas_front_factor", ".6f"],
  ["Zone 2 gas saturation", "Sg2", ".6f"],
  ["Zone 2 krg", "krg2", ".6f"],
  ["Zone 2 krw", "krw2", ".6f"],
  ["Total increase (psi)", "total_delta_p_psi", ".6f"],
  ["Annual gain (psi)", "annual_gain_psi", ".6f"],
  ["BHP (psia)", "BHP_psia", ".6f"],
  ["Falloff from flowing BHP (psi)", "falloff_from_flowing_BHP_psi", ".6f"],
  ["Pressure evaluations", "pressure_evaluations", ".0f"],
  ["Pressure residual (psi)", "pressure_residual_psi", ".2e"],
];

/** Columns of `_notebook_summary_html(results)`: [label, key, format]. */
export function summaryColumns(rows: Row[]): [string, string, string][] {
  const fixed_co2 = rows[0]?.single_fluid_code === 1;
  return SUMMARY_COLUMNS
    .map(([l, k, f]): [string, string, string] => [fixed_co2 && k === "rho_g_lb_ft3" ? "Fixed CO2 density at Pi (lb/ft3)" : l, k, f])
    .filter(([, k]) => k in (rows[0] ?? {}) && !(fixed_co2 && k === "rho_g_at_BHP_lb_ft3"))
    .concat(rows.length && "pressure_limit_status" in rows[0] ? [["Allowable BHP (psia)", "max_allowable_BHP_psia", ""], ["Pressure status", "pressure_limit_status", ""]] : []);
}
