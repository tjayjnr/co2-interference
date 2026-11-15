// MULTIWELL INTERFERENCE: line-by-line TypeScript translation of the multiwell section of the reference program
// (reference/co2_bhp_model.py: Well, validate_wells, configure_well_geometry, radial_pressure_from_state,
// _single_phase_source_profile, _evaluate_multiwell, solve_multiwell_time, _multiwell_rows, run_multiwell,
// _frozen_source_observation, calculate_multiwell_observation, save_multiwell_results).
//
// Rows = receiving wells; columns = source wells. No skin in off-diagonal terms. Field units (ft, psia, Mscf/day or
// STB/day). The only addition to the Python is optional image wells for a straight boundary (`images`), used by the
// website's boundary option; with no images every number is the Python's.
// Second addition: an end year for each well (`end_year`; null = inject until the project endpoint, as the program).
// A single-phase well's end year is a rate change to 0 in its schedule (the program's own rate_schedule). A two-phase well
// that stops before the endpoint follows the program's fixed-zone falloff (`_frozen_source_observation`) of its profile at
// its end year while the other wells continue. With every end year at the endpoint the results are the program's.

import {
  BhpError, DAYS_PER_YEAR, MAX_PRESSURE_ITERATIONS, PRESSURE_COEFFICIENT, PRESSURE_TOLERANCE_PSI, PyInt,
  SINGLE_PHASE_CO2_BG_RB_SCF, TIME_COEFFICIENT_YEARS, calculateCo2Density, calculateYear, copyRow,
  diffuseRadial, dictCsv, exp1, gasProperties, geomspace, isWaterMode, liveCellProperties, markInt, observationSchedule, parsePyFloat, pressureFailureSummary,
  pressureLimitSpec, pressureStatus, pyFormat, pyJson, referenceQuantities, validate, waterProperties,
  type Inputs, type LimitInput, type PressureLimit, type Row,
} from "./bhp.ts";

const fail = (msg: string): never => {
  throw new BhpError(msg);
};

export const MULTIWELL_METHOD =
  "Infinite-acting spatial superposition of the supplied radial E1 responses. " +
  "Two-phase sources have individual constant rates and staggered start times; " +
  "their PR properties are iterated at the total source-well BHP. This is a " +
  "representative-property multiphase superposition approximation, not a " +
  "coupled multidimensional displacement solution. Single-phase schedules " +
  "use time and space superposition with the background viscosity / cw at " +
  "each source's trial BHP. CO2 viscosity (Fenghour), brine density and cw " +
  "(Driesner + IAPWS-IF97) and salinity (McCain inverse of the standard " +
  "brine density) are calculated, never entered.";

// ---------------------------------------------------------------------------------------------------------------
// Wells

/** Rate: Mscf/day for CO2; STB/day for water. Coordinates/radius: ft. */
export interface MWell {
  name: string;
  x_ft: number;
  y_ft: number;
  rate: number;
  start_year: number;
  rw_ft: number;
  skin: number;
  include_evaporation: boolean | null;
  rate_schedule: { year: number; rate: number }[] | null;
  max_bhp_psia: number | null;
  /** website extension: the year this well stops (null = the project endpoint) */
  end_year?: number | null;
}

export const makeWell = (o: Partial<MWell> = {}): MWell => ({
  name: "Well 1", x_ft: 0.0, y_ft: 0.0, rate: 150.0, start_year: 0.0, rw_ft: 0.55, skin: 0.0,
  include_evaporation: null, rate_schedule: null, max_bhp_psia: null, end_year: null, ...o,
});

export function events(w: MWell): [number, number][] {
  const ev: [number, number][] = w.rate_schedule === null ? [[w.start_year, w.rate]] : w.rate_schedule.map((item) => [item.year, item.rate]);
  const end = w.end_year;
  if (end === null || end === undefined) return ev;
  return [...ev.filter(([t]) => t < end), [end, 0.0]]; // the well stops at its end year
}

export function sourceStart(w: MWell): number {
  const e = events(w).find(([, rate]) => rate > 0);
  return e ? e[0] : w.start_year;
}

export function currentRate(w: MWell, year: number): number {
  const e = [...events(w)].reverse().find(([time]) => year >= time);
  return e ? e[1] : 0.0;
}

export function cumulativeRateDays(w: MWell, year: number): number {
  const ev = events(w);
  let s = 0;
  ev.forEach(([time, rate], j) => {
    s += rate * Math.max(0.0, Math.min(year, j + 1 < ev.length ? ev[j + 1][0] : year) - time);
  });
  return DAYS_PER_YEAR * s;
}

const finiteNumber = (v: unknown) => typeof v === "number" && Number.isFinite(v);

export function validateWells(wells: MWell[], p: Inputs): void {
  if (!Array.isArray(wells) || !(wells.length >= 1 && wells.length <= 32)) fail("Enter between 1 and 32 wells.");
  const names = new Set<string>();
  for (const well of wells) {
    if (typeof well.name !== "string" || !well.name.trim() || well.name.length > 80) fail("Each well needs a nonblank name of at most 80 characters.");
    if (names.has(well.name.toLowerCase())) fail(`Duplicate well name: ${well.name}`);
    names.add(well.name.toLowerCase());
    for (const key of ["x_ft", "y_ft", "rate", "start_year", "rw_ft", "skin"] as const) {
      if (!finiteNumber(well[key])) fail(`${well.name}: ${key} must be a finite number.`);
    }
    if (well.rate < 0 || well.start_year < 0 || well.rw_ft <= 0) fail(`${well.name}: rate/start year must be >= 0 and well radius > 0.`);
    if (well.include_evaporation !== null && typeof well.include_evaporation !== "boolean") fail(`${well.name}: include_evaporation must be true, false, or null.`);
    if (well.end_year !== null && well.end_year !== undefined && !(finiteNumber(well.end_year) && well.end_year > well.start_year)) fail(`${well.name}: end year must be after the start year.`);
    if (well.max_bhp_psia !== null && !(finiteNumber(well.max_bhp_psia) && well.max_bhp_psia > 0)) fail(`${well.name}: maximum BHP must be finite and positive psia, or blank.`);
    if (well.rate_schedule !== null) {
      if (p.phase_mode === "two") {
        fail(`${well.name}: two-phase moving-front injection currently supports one ` +
          "constant rate per well plus its start year. Arbitrary rate changes need " +
          "a validated history-dependent multiphase kernel; they are not reset plumes. " +
          "Use the global post-shut-in observation section for field shut-in.");
      }
      if (!Array.isArray(well.rate_schedule) || !well.rate_schedule.length) fail(`${well.name}: rate_schedule must be a nonempty list.`);
      let previous = -1.0;
      for (const item of well.rate_schedule) {
        const { year, rate } = item;
        if (![year, rate].every(finiteNumber) || year < 0 || rate < 0 || year <= previous) fail(`${well.name}: schedule years must increase strictly; rates must be >= 0.`);
        previous = year;
      }
    }
  }
  wells.forEach((receiver, m) => {
    for (const source of wells.slice(0, m)) {
      const distance = Math.hypot(receiver.x_ft - source.x_ft, receiver.y_ft - source.y_ft);
      if (distance <= receiver.rw_ft + source.rw_ft) fail(`${receiver.name} and ${source.name}: wellbores overlap; increase separation.`);
    }
  });
}

export function defaultWells(p: Inputs, number = 4, spacing_ft = 1000.0): MWell[] {
  if (!Number.isInteger(number) || !(number >= 1 && number <= 32)) fail("Number of wells must be an integer from 1 to 32.");
  if (!Number.isFinite(spacing_ft) || spacing_ft <= 0) fail("Well spacing must be finite and positive.");
  const columns = Math.ceil(Math.sqrt(number));
  const rate = isWaterMode(p) ? p.water_rate_stb_day : p.q_Mscf_day;
  return Array.from({ length: number }, (_, i) => makeWell({
    name: `Well ${i + 1}`, x_ft: (i % columns) * spacing_ft, y_ft: Math.floor(i / columns) * spacing_ft,
    rate, start_year: 0.0, rw_ft: p.rw_ft, skin: p.skin,
  }));
}

// ---------------------------------------------------------------------------------------------------------------
// Geometry: constant neighboring spacing (line / grid) or different distances (adjacent gaps, pairwise matrix, x/y)

export function wellSeparations(wells: MWell[]): number[][] {
  return wells.map((a) => wells.map((b) => Math.hypot(a.x_ft - b.x_ft, a.y_ft - b.y_ft)));
}

export function distanceNumbers(value: string | number[]): number[] {
  let list: (string | number)[] = value as (string | number)[];
  if (typeof value === "string") list = value.replace(/;/g, ",").replace(/\n/g, ",").split(",").map((v) => v.trim()).filter(Boolean);
  let numbers: number[] = [];
  try {
    numbers = list.map((v) => (typeof v === "number" ? v : parsePyFloat(v)));
  } catch {
    fail("Enter distances as comma-separated numbers in ft.");
  }
  if (numbers.some((v) => !Number.isFinite(v) || v <= 0)) fail("All interwell distances must be finite and positive.");
  return numbers;
}

/** Eigen-decomposition of a symmetric matrix (cyclic Jacobi); eigenvalues ascending, as numpy.linalg.eigh. */
function eighSym(a0: number[][]): { values: number[]; vectors: number[][] } {
  const n = a0.length;
  const a = a0.map((r) => [...r]);
  const v: number[][] = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) off += a[i][j] ** 2;
    if (off < 1e-30) break;
    for (let p = 0; p < n; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1), s = t * c;
        for (let k = 0; k < n; k++) {
          const akp = a[k][p], akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < n; k++) {
          const apk = a[p][k], aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < n; k++) {
          const vkp = v[k][p], vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = Array.from({ length: n }, (_, i) => i).sort((x, y) => a[x][x] - a[y][y]);
  return { values: order.map((i) => a[i][i]), vectors: v.map((row) => order.map((i) => row[i])) };
}

/** Recover an exact planar layout from a symmetric Euclidean distance matrix (classical scaling). */
export function coordinatesFromDistances(value: string | number[][], number: number): number[][] {
  let rows: number[][] = value as number[][];
  if (typeof value === "string") {
    try {
      rows = value.trim().split(/\r?\n/).filter((r) => r.trim()).map((r) => r.split(",").map((v) => parsePyFloat(v.trim())));
    } catch {
      fail("Enter the distance matrix as numeric CSV rows, without headers.");
    }
  }
  if (!Array.isArray(rows) || rows.length !== number || rows.some((r) => !Array.isArray(r) || r.length !== number) || rows.flat().some((v) => !Number.isFinite(v))) {
    fail(`The distance matrix must contain ${number} rows and ${number} columns.`);
  }
  const scale = Math.max(Math.max(...rows.flat().map(Math.abs)), 1.0);
  const tolerance = 1e-6 * scale;
  for (let i = 0; i < number; i++) for (let j = 0; j < number; j++) {
    if (Math.abs(rows[i][j] - rows[j][i]) > tolerance) fail("Pairwise distances must be symmetric: distance A–B must equal B–A.");
  }
  if (Math.max(...rows.map((r, i) => Math.abs(r[i]))) > tolerance) fail("Distance-matrix diagonal entries must be zero.");
  for (let i = 0; i < number; i++) for (let j = 0; j < number; j++) if (i !== j && rows[i][j] <= 0) fail("Every off-diagonal well separation must be positive.");
  const distance = rows.map((r, i) => r.map((v, j) => (i === j ? 0.0 : (v + rows[j][i]) / 2)));
  // gram = -0.5 * J D^2 J with J = I - 1/n
  const sq = distance.map((r) => r.map((v) => v * v));
  const rowMean = sq.map((r) => r.reduce((s, v) => s + v, 0) / number);
  const allMean = rowMean.reduce((s, v) => s + v, 0) / number;
  const gram = sq.map((r, i) => r.map((v, j) => -0.5 * (v - rowMean[i] - rowMean[j] + allMean)));
  const { values, vectors } = eighSym(gram);
  const eigenTolerance = Math.max(number * scale * tolerance, 1e-10);
  if (values[0] < -eigenTolerance || values.filter((v) => v > eigenTolerance).length > 2) {
    fail("These pairwise distances cannot form a horizontal 2-D well layout. Check the distances or enter x/y coordinates instead.");
  }
  const order = values.map((_, i) => i).reverse().slice(0, 2);
  let coords = vectors.map((row) => order.map((k) => row[k] * Math.sqrt(Math.max(values[k], 0.0))));
  if (order.length === 1) coords = coords.map((c) => [c[0], 0]);
  const [x0, y0] = coords[0];
  coords = coords.map(([x, y]) => [x - x0, y - y0]);
  if (number > 1) {
    const angle = Math.atan2(coords[1][1], coords[1][0]);
    const c = Math.cos(angle), s = Math.sin(angle);
    coords = coords.map(([x, y]) => [x * c + y * s, -x * s + y * c]);
    // numpy's eigenvector signs are not reproducible: show the layout with the third well above the x axis
    const k = coords.findIndex(([, y]) => Math.abs(y) > tolerance);
    if (k >= 0 && coords[k][1] < 0) coords = coords.map(([x, y]) => [x, -y]);
  }
  for (let i = 0; i < number; i++) for (let j = 0; j < number; j++) {
    if (Math.abs(Math.hypot(coords[i][0] - coords[j][0], coords[i][1] - coords[j][1]) - distance[i][j]) > tolerance) {
      fail("The distance matrix is inconsistent with a 2-D layout; check its values.");
    }
  }
  return coords;
}

export interface GeometryInput {
  number?: number;
  mode?: string;
  layout?: string;
  spacing_ft?: number;
  different_input?: string;
  adjacent_distances_ft?: string | number[] | null;
  pairwise_distances_ft?: string | number[][] | null;
}
export type GeometrySettings = Record<string, unknown>;

/** `configure_well_geometry`: keep per-well operations while applying the requested distance definition. */
export function configureWellGeometry(p: Inputs, wells: MWell[] | null, g: GeometryInput): { wells: MWell[]; settings: GeometrySettings } {
  const number = g.number ?? (wells ? wells.length : 4);
  const mode = g.mode ?? "constant", layout = g.layout ?? "line", spacing_ft = g.spacing_ft ?? 1000.0, different_input = g.different_input ?? "adjacent";
  if (!Number.isInteger(number) || !(number >= 1 && number <= 32)) fail("Choose an integer number of wells from 1 to 32.");
  if (mode !== "constant" && mode !== "different") fail("Choose constant spacing or different distances.");
  if (!Number.isFinite(spacing_ft) || spacing_ft <= 0) fail("Neighboring-well spacing must be finite and positive.");
  const existing = wells ?? [];
  const templates = defaultWells(p, number, spacing_ft);
  const operations = templates.map((t, i) => (i < existing.length ? existing[i] : t));
  const settings: GeometrySettings = { number: new PyInt(number), mode, layout, spacing_ft, different_input };
  let coords: number[][] = [];
  if (mode === "constant") {
    if (layout !== "line" && layout !== "grid") fail("Choose a straight line or a square grid for constant spacing.");
    const columns = layout === "grid" ? Math.ceil(Math.sqrt(number)) : number;
    coords = Array.from({ length: number }, (_, i) => [(i % columns) * spacing_ft, Math.floor(i / columns) * spacing_ft]);
  } else if (different_input === "adjacent") {
    if ((g.adjacent_distances_ft === null || g.adjacent_distances_ft === undefined) && number > 1) fail(`Enter ${number - 1} adjacent distances in ft.`);
    const gaps = distanceNumbers(g.adjacent_distances_ft || []);
    if (gaps.length !== number - 1) fail(`Enter ${number - 1} adjacent distances: Well 1–2, Well 2–3, and so on.`);
    let x = 0.0;
    coords = [[0.0, 0.0], ...gaps.map((d) => [(x += d), 0.0])];
    settings.adjacent_distances_ft = gaps;
  } else if (different_input === "pairwise") {
    if (g.pairwise_distances_ft === null || g.pairwise_distances_ft === undefined) fail("Enter the full pairwise-distance matrix.");
    coords = coordinatesFromDistances(g.pairwise_distances_ft as string | number[][], number);
    settings.pairwise_distances_ft = coords.map((a) => coords.map((b) => Math.hypot(a[0] - b[0], a[1] - b[1])));
  } else if (different_input === "coordinates") {
    if (existing.length !== number) fail("The coordinate table must have exactly the selected number of wells. Apply the well count first.");
    coords = operations.map((w) => [w.x_ft, w.y_ft]);
  } else {
    fail("Choose adjacent distances, a pairwise matrix, or x/y coordinates.");
  }
  const configured = operations.map((w, i) => ({ ...w, x_ft: coords[i][0], y_ft: coords[i][1] }));
  validateWells(configured, p);
  return { wells: configured, settings };
}

// ---------------------------------------------------------------------------------------------------------------
// Pressure of one source

/** `_well_parameters`: the shared inputs with this well's rate, radius, skin and evaporation choice. */
export function wellParameters(p: Inputs, well: MWell, rate?: number): Inputs {
  const r = rate === undefined ? Math.max(well.rate, 1.0) : rate;
  const values: Partial<Inputs> = { rw_ft: well.rw_ft, skin: well.skin, observation_period_years: 0.0, observation_years: "" };
  if (isWaterMode(p)) values.water_rate_stb_day = r;
  else values.q_Mscf_day = r;
  if (well.include_evaporation !== null) values.include_evaporation = well.include_evaporation;
  return { ...p, ...values };
}

/** `radial_pressure_from_state`: the supplied piecewise E1 expression, excluding the local skin drop. */
export function radialPressureFromState(radii: number[], state: Row, p: Inputs): { pressure: number[]; zones: number[]; pD: number[] } {
  if (radii.some((r) => !Number.isFinite(r) || r < p.rw_ft * (1 - 1e-12))) fail("Evaluate source pressure at or outside its wellbore radius.");
  let zones: number[], pD: number[], viscosity: number;
  if (p.phase_mode === "two") {
    zones = radii.map((r) => (p.include_evaporation && r <= state.rd_ft ? 1 : r <= state.rg_ft ? 2 : 3));
    pD = radii.map((r, k) => {
      const z = zones[k];
      const argument = (r / p.rw_ft) ** 2 / (4 * state[`D${z}`] * state.tD);
      return (state[`a${z}`] + state[`b${z}`] * exp1(argument)) / p.krg_zone1;
    });
    viscosity = state.mu_gas_cP;
  } else {
    zones = radii.map(() => 1);
    pD = radii.map((r) => 0.5 * exp1((r / p.rw_ft) ** 2 / (4 * state.tD)));
    viscosity = isWaterMode(p) ? p.mu_water_cP : state.mu_gas_cP;
  }
  const prefactor = (PRESSURE_COEFFICIENT * viscosity * state.q_reservoir_rb_day) / (p.k_mD * p.h_ft);
  return { pressure: pD.map((v) => prefactor * v), zones, pD };
}

const KERNEL_PROPS = new Map<string, number>();
/** Background property of the single-phase kernel at a pressure: water cw, or CO2 viscosity (memoised for the maps). */
function kernelProperty(p: Inputs, constants: Row, pressure: number): number {
  const water = isWaterMode(p);
  const key = `${water ? "w" : "g"}|${pressure}|${p.temperature_F}|${p.brine_standard_density_lb_ft3}`;
  let v = KERNEL_PROPS.get(key);
  if (v === undefined) {
    v = water ? waterProperties(pressure, p).cw_per_psi : gasProperties(pressure, p.temperature_F, constants.Zsc).mu_gas_cP;
    if (KERNEL_PROPS.size > 20000) KERNEL_PROPS.clear();
    KERNEL_PROPS.set(key, v as number);
  }
  return v as number;
}

/**
 * `_single_phase_source_profile`: exact time superposition for the adopted E1 kernel. Water cw and CO2 viscosity are
 * the background properties at the source well's property pressure (its trial BHP); the other kernel inputs are fixed.
 */
export function singlePhaseSourceProfile(year: number, well: MWell, radii: number[], p: Inputs, constants: Row, stopYear: number | null = null,
  propertyPressure: number | null = null): [number[], number] {
  const water = isWaterMode(p);
  const pressure = propertyPressure === null ? p.initial_pressure_psia : propertyPressure;
  const viscosity = water ? p.mu_water_cP : kernelProperty(p, constants, pressure);
  const ct = (water ? kernelProperty(p, constants, pressure) : constants.initial_cg_per_psi) + p.rock_compressibility_per_psi;
  const B = water ? 1.0 : SINGLE_PHASE_CO2_BG_RB_SCF;
  const rateConversion = water ? 1.0 : 1000.0;
  const scale = (PRESSURE_COEFFICIENT * viscosity * B * rateConversion) / (p.k_mD * p.h_ft);
  const profile = radii.map(() => 0.0);
  let ev = events(well);
  if (stopYear !== null) ev = [...ev.filter(([time]) => time < stopYear), [stopYear, 0.0]];
  let previousRate = 0.0;
  for (const [time, rate] of ev) {
    const increment = rate - previousRate;
    previousRate = rate;
    const lag = year - time;
    if (lag > 0 && increment) {
      radii.forEach((r, k) => {
        const argument = (r ** 2 * p.porosity * viscosity * ct) / (4 * TIME_COEFFICIENT_YEARS * p.k_mD * lag);
        profile[k] += scale * increment * 0.5 * exp1(argument);
      });
    }
  }
  const current = stopYear === null || year < stopYear ? currentRate(well, year) : 0.0;
  return [profile, scale * current * well.skin];
}

// ---------------------------------------------------------------------------------------------------------------
// Coupled solve of all wells at one time

/** Image wells of each source (website extension): distance from every receiver to each image, and its sign. */
export type Images = { d: number[]; sign: number }[][];

export interface Snapshot {
  year: number;
  bhp: number[];
  matrix: number[][];
  skin: number[];
  zones: number[][];
  states: (Row | null)[];
  trial: number[];
  residual: number[];
  evaluations: number;
}

interface Ctx {
  p: Inputs;
  wells: MWell[];
  params: Inputs[];
  constants: Row[];
  distances: number[][];
  images: Images | null;
  /** two-phase wells stopped before the endpoint: falloff of their profile from their end year */
  frozen: (FrozenSource | null)[];
}

function evaluateMultiwell(year: number, trial: number[], c: Ctx): Omit<Snapshot, "residual" | "evaluations"> {
  const { p, wells } = c;
  const count = wells.length;
  const C = Array.from({ length: count }, () => new Array<number>(count).fill(0));
  const zones = Array.from({ length: count }, () => new Array<number>(count).fill(0));
  const skin = new Array<number>(count).fill(0);
  const states: (Row | null)[] = new Array(count).fill(null);
  const column = (i: number) => c.distances.map((row) => row[i]);
  wells.forEach((well, i) => {
    const parameters = c.params[i], reference = c.constants[i];
    const age = year - sourceStart(well);
    if (year <= 0) return; // prescribed initial state, immediately before initial startup
    if (p.phase_mode === "two") {
      const endYear = well.end_year;
      const f = c.frozen[i];
      if (age > 0 && well.rate > 0 && endYear !== null && endYear !== undefined && year > endYear) {
        if (!f) fail(`${well.name}: the shut-in state at year ${pyFormat(endYear, "g")} is missing.`);
        const tau = year - (endYear as number);
        column(i).forEach((r, m) => { C[m][i] = frozenAt(f as FrozenSource, Math.max(r, well.rw_ft), tau); });
        for (const img of c.images?.[i] ?? []) img.d.forEach((r, m) => { C[m][i] += img.sign * frozenAt(f as FrozenSource, r, tau); });
      } else if (age > 0 && well.rate > 0) {
        const state = calculateYear(age, trial[i], parameters, reference);
        const r = radialPressureFromState(column(i), state, parameters);
        r.pressure.forEach((v, m) => { C[m][i] = v; zones[m][i] = r.zones[m]; });
        for (const img of c.images?.[i] ?? []) radialPressureFromState(img.d, state, parameters).pressure.forEach((v, m) => { C[m][i] += img.sign * v; });
        skin[i] = ((PRESSURE_COEFFICIENT * state.mu_gas_cP * state.q_reservoir_rb_day) / (p.k_mD * p.h_ft)) * well.skin;
        states[i] = state;
      } else if (age === 0 && well.rate > 0 && well.skin) {
        const gas = gasProperties(trial[i], p.temperature_F, reference.Zsc);
        skin[i] = (PRESSURE_COEFFICIENT * gas.mu_gas_cP * well.rate * 1000 * gas.Bg_rb_scf * well.skin) / (p.k_mD * p.h_ft);
      }
    } else {
      const [profile, s] = singlePhaseSourceProfile(year, well, column(i), parameters, reference, null, trial[i]);
      profile.forEach((v, m) => { C[m][i] = v; });
      for (const img of c.images?.[i] ?? []) singlePhaseSourceProfile(year, well, img.d, parameters, reference, null, trial[i])[0].forEach((v, m) => { C[m][i] += img.sign * v; });
      skin[i] = s;
      const cumulative = cumulativeRateDays(well, year);
      if (age > 0 && cumulative > 0) {
        const water = isWaterMode(p);
        const equivalentRate = cumulative / (age * DAYS_PER_YEAR);
        const averageParameters = wellParameters(p, well, equivalentRate);
        const averageReference = copyRow(reference);
        averageReference[water ? "q_water_stb_day" : "q_sc_scf_day"] = water ? equivalentRate : equivalentRate * 1000;
        const state = calculateYear(age, trial[i], averageParameters, averageReference);
        state.equivalent_rate_for_cumulative_volume = equivalentRate;
        state.current_surface_rate = currentRate(well, year);
        state.q_reservoir_rb_day = currentRate(well, year) * (water ? 1.0 : 1000 * SINGLE_PHASE_CO2_BG_RB_SCF);
        states[i] = state;
        for (let m = 0; m < count; m++) zones[m][i] = 1;
      }
    }
  });
  const total = C.map((row, m) => p.initial_pressure_psia + row.reduce((s, v) => s + v, 0) + skin[m]);
  if (!total.every((v) => Number.isFinite(v) && v > 0)) fail("Multiwell calculation produced nonpositive or nonfinite BHP.");
  return { year, bhp: total, matrix: C, skin, zones, states, trial: [...trial] };
}

const maxAbs = (a: number[]) => Math.max(0, ...a.map(Math.abs));

/** `solve_multiwell_time`: solve the whole BHP vector; update source properties at total source BHP. */
function solveMultiwellTime(year: number, previous: number[], c: Ctx): Snapshot {
  let evaluations = 0;
  const evaluate = (trial: number[]) => {
    evaluations++;
    if (trial.some((v) => !(v > 0) || !Number.isFinite(v))) fail("All trial source pressures must be finite and positive.");
    return evaluateMultiwell(year, trial, c);
  };
  let trial = [...previous];
  let snapshot = evaluate(trial);
  let residual = trial.map((v, i) => v - snapshot.bhp[i]);
  let converged = maxAbs(residual) < PRESSURE_TOLERANCE_PSI;
  for (let it = 1; it < MAX_PRESSURE_ITERATIONS && !converged; it++) {
    trial = c.p.phase_mode === "single" ? snapshot.bhp : trial.map((v, i) => 0.5 * v + 0.5 * snapshot.bhp[i]);
    snapshot = evaluate(trial);
    residual = trial.map((v, i) => v - snapshot.bhp[i]);
    converged = maxAbs(residual) < PRESSURE_TOLERANCE_PSI;
  }
  if (!converged) {
    // The Python falls back to scipy least_squares here; a damped Newton step on the same residual does the same job.
    const F = (x: number[]) => { const s = evaluate(x); return x.map((v, i) => v - s.bhp[i]); };
    let x = [...trial];
    for (let k = 0; k < MAX_PRESSURE_ITERATIONS && maxAbs(F(x)) >= PRESSURE_TOLERANCE_PSI; k++) {
      const f0 = F(x);
      const J = x.map((_, j) => {
        const h = 1e-3 * Math.max(1, Math.abs(x[j]));
        const xp = [...x];
        xp[j] += h;
        const fp = F(xp);
        return fp.map((v, i) => (v - f0[i]) / h);
      }); // J[j][i] = dF_i/dx_j
      const n = x.length;
      const A = Array.from({ length: n }, (_, i) => [...Array.from({ length: n }, (_, j) => J[j][i]), -f0[i]]);
      for (let col = 0; col < n; col++) {
        let piv = col;
        for (let r = col + 1; r < n; r++) if (Math.abs(A[r][col]) > Math.abs(A[piv][col])) piv = r;
        [A[col], A[piv]] = [A[piv], A[col]];
        for (let r = 0; r < n; r++) {
          if (r === col || !A[col][col]) continue;
          const f = A[r][col] / A[col][col];
          for (let k2 = col; k2 <= n; k2++) A[r][k2] -= f * A[col][k2];
        }
      }
      const dx = A.map((row, i) => row[n] / row[i]);
      x = x.map((v, i) => Math.max(1e-6, v + dx[i]));
    }
    snapshot = evaluate(x);
    residual = x.map((v, i) => v - snapshot.bhp[i]);
    if (maxAbs(residual) >= PRESSURE_TOLERANCE_PSI) fail(`Year ${pyFormat(year, "g")}: coupled BHP residual is ${pyFormat(maxAbs(residual), "g")} psi.`);
  }
  return { ...snapshot, residual, evaluations };
}

// ---------------------------------------------------------------------------------------------------------------
// Result rows

const sumRow = (r: number[]) => r.reduce((s, v) => s + v, 0);

function multiwellRows(snapshot: Snapshot, p: Inputs, wells: MWell[], distances: number[][], includeDetails: boolean, pressureLimit: PressureLimit) {
  const summary: Row[] = [], contributions: Row[] = [], states: Row[] = [], overlaps: Row[] = [];
  const C = snapshot.matrix, skin = snapshot.skin;
  const two = p.phase_mode === "two";
  const water = isWaterMode(p);
  const get = (s: Row | null, k: string) => (s ? (k in s ? s[k] : "") : "");
  wells.forEach((receiver, m) => {
    const state = snapshot.states[m];
    const dryRadius = state && two && (state.dry_zone_thickness_ft ?? 0) > 0 ? state.rd_ft : 0.0;
    const row: Row = {
      year: snapshot.year, well: receiver.name,
      BHP_psia: snapshot.bhp[m],
      initial_pressure_psia: p.initial_pressure_psia,
      own_formation_response_psi: C[m][m],
      own_skin_psi: skin[m],
      interference_psi: sumRow(C[m]) - C[m][m],
      total_delta_p_psi: sumRow(C[m]) + skin[m],
      current_surface_rate: snapshot.year > 0 ? currentRate(receiver, snapshot.year) : 0.0,
      rate_units: water ? "STB/day" : "Mscf/day",
      source_age_years: Math.max(0.0, snapshot.year - sourceStart(receiver)),
      dry_zone_radius_ft: two ? dryRadius : "",
      zone2_inner_radius_ft: state && two ? state.rd_ft : "",
      dry_zone_thickness_ft: get(state, "dry_zone_thickness_ft"),
      gas_front_radius_ft: get(state, "rg_ft"),
      Sg2: get(state, "Sg2"),
      krg2: get(state, "krg2"),
      krw2: get(state, "krw2"),
      pressure_residual_psi: snapshot.residual[m],
      pressure_evaluations: snapshot.evaluations,
    };
    Object.assign(row, pressureStatus(row.BHP_psia, pressureLimit, receiver.max_bhp_psia));
    wells.forEach((source, i) => { row[`from_${source.name}_psi`] = C[m][i]; });
    summary.push(row);
    if (!includeDetails) return;
    wells.forEach((source, i) => {
      const c: Row = {
        year: snapshot.year, receiving_well: receiver.name,
        source_well: source.name, is_self: m === i,
        evaluation_radius_ft: distances[m][i],
        rD: distances[m][i] / source.rw_ft,
        source_age_years: Math.max(0.0, snapshot.year - sourceStart(source)),
        receiver_zone_in_source_response: snapshot.zones[m][i],
        delta_p_psi: C[m][i],
      };
      markInt(c, "receiver_zone_in_source_response");
      contributions.push(c);
    });
    const details: Row = state ? copyRow(state) : {};
    for (const key of ["BHP_psia", "total_delta_p_psi", "annual_gain_psi"]) {
      if (key in details) {
        const v = details[key];
        delete details[key];
        details[`constant_rate_equivalent_${key}`] = v;
      }
    }
    Object.assign(details, row);
    details.P_used_psia = snapshot.trial[m];
    if (state) {
      if (water) details.rho_water_at_BHP_lb_ft3 = waterProperties(snapshot.bhp[m], p).rho_water_lb_ft3;
      else if (p.phase_mode === "single") details.rho_g_at_BHP_lb_ft3 = state.rho_g_lb_ft3;
      else details.rho_g_at_BHP_lb_ft3 = calculateCo2Density(snapshot.bhp[m], p.temperature_F);
    }
    states.push(details);
  });
  if (includeDetails && two) {
    wells.forEach((wi, i) => {
      for (let m = i + 1; m < wells.length; m++) {
        const wm = wells[m];
        const si = snapshot.states[i], sm = snapshot.states[m];
        const [gi, gm] = [si, sm].map((s) => (s ? s.rg_ft : 0.0));
        const [di, dm] = [si, sm].map((s) => (s && (s.dry_zone_thickness_ft ?? 0) > 0 ? s.rd_ft : 0.0));
        overlaps.push({
          year: snapshot.year, well_i: wi.name, well_m: wm.name,
          separation_ft: distances[m][i],
          rg_i_ft: gi, rg_m_ft: gm, rd_i_ft: di, rd_m_ft: dm,
          plumes_touch_or_overlap: gi > 0 && gm > 0 && gi + gm >= distances[m][i],
          dry_zones_touch_or_overlap: di > 0 && dm > 0 && di + dm >= distances[m][i],
        });
      }
    });
  }
  return { summary, contributions, states, overlaps };
}

/** `_parse_report_times` */
export function parseReportTimes(value: string | number[] | null | undefined, years: number): number[] {
  let values: number[];
  if (value === null || value === undefined || value === "") {
    values = Array.from({ length: Math.floor(years) }, (_, k) => k + 1.0);
  } else if (typeof value === "string") {
    try {
      values = value.split(",").map((s) => s.trim()).filter(Boolean).map(parsePyFloat);
    } catch {
      return fail("Reporting times must be comma-separated years.");
    }
  } else {
    values = [...value];
  }
  if (values.some((t) => typeof t !== "number" || !Number.isFinite(t) || !(t >= 0 && t <= years))) fail("Reporting times must lie between zero and the project injection endpoint.");
  return [...new Set([0.0, years, ...values])].sort((a, b) => a - b);
}

export interface MultiwellResult {
  parameters: Inputs;
  wells: MWell[];
  years: number;
  report_times: number[];
  summary: Row[];
  contributions: Row[];
  source_states: Row[];
  overlaps: Row[];
  detail: Row[];
  end_snapshot: Snapshot;
  source_parameters: Inputs[];
  references: Row[];
  distances: number[][];
  method: string;
  pressure_limit: PressureLimit;
  geometry: GeometrySettings | null;
  images: Images | null;
  /** every solved snapshot (website: the BHP and interference curves) */
  snapshots: Snapshot[];
  /** two-phase wells stopped before the endpoint: falloff solution, state and BHP at their end year */
  frozen: (FrozenSource | null)[];
  frozenStates: (Row | null)[];
  frozenBhp: number[];
  /** website: each source's shut-in falloff solved by calculateMultiwellObservation (reused by the maps and curves) */
  observationFrozen?: (FrozenSource | null)[];
}

/** Distances from every receiver to each source (diagonal = the source's own well radius). */
export function evaluationDistances(wells: MWell[]): number[][] {
  return wells.map((wm, m) => wells.map((wi, i) => (m !== i ? Math.hypot(wm.x_ft - wi.x_ft, wm.y_ft - wi.y_ft) : wi.rw_ft)));
}

/** numpy.linspace */
function linspace(a: number, b: number, n: number): number[] {
  const step = (b - a) / (n - 1);
  const out = Array.from({ length: n }, (_, i) => i * step + a);
  out[n - 1] = b;
  return out;
}

/** `run_multiwell`: annual decomposition, full source states, overlaps and plot samples. */
export function runMultiwell(p: Inputs, wellsIn: MWell[], years: number, reportTimes: string | number[] | null = null,
  opts: { detail?: boolean; pressureLimit?: LimitInput | PressureLimit | null; images?: Images | null } = {}): MultiwellResult {
  const detail = opts.detail ?? true;
  validate(p);
  // an end year at or after the endpoint is the program's own case (the well injects until the endpoint)
  const wells = wellsIn.map((w) => ({ ...w, end_year: w.end_year !== null && w.end_year !== undefined && w.end_year < years ? w.end_year : null }));
  validateWells(wells, p);
  const pressureLimit = pressureLimitSpec(opts.pressureLimit);
  if (typeof years !== "number" || !Number.isFinite(years) || years <= 0) fail("Project injection endpoint must be finite and positive.");
  const params = wells.map((w) => wellParameters(p, w));
  const constants = params.map((q) => referenceQuantities(q));
  const distances = evaluationDistances(wells);
  const ctx: Ctx = { p, wells, params, constants, distances, images: opts.images ?? null, frozen: wells.map(() => null) };
  const frozenStates: (Row | null)[] = wells.map(() => null);
  const frozenBhp: number[] = wells.map(() => NaN);
  const report = parseReportTimes(reportTimes, years);
  const times = new Set<number>(report);
  for (const w of wells) if (w.end_year !== null && w.end_year !== undefined) times.add(w.end_year); // each well's shut-in is solved
  if (detail) {
    const first = Math.min(1.0, years);
    const second = 1 / (DAYS_PER_YEAR * 86400);
    geomspace(second, Math.min(1 / DAYS_PER_YEAR, first), 45).forEach((t) => times.add(t));
    linspace(Math.min(1 / DAYS_PER_YEAR, first), first, 61).forEach((t) => times.add(t));
    for (const well of wells) {
      for (const [event] of events(well)) {
        if (event >= 0 && event < years) {
          times.add(event);
          const duration = Math.min(1.0, years - event);
          if (duration > second) geomspace(second, duration, 45).forEach((t) => times.add(event + t));
        }
      }
    }
  }
  const sorted = [...times].filter((t) => t >= 0 && t <= years).sort((a, b) => a - b);
  let previous = wells.map(() => p.initial_pressure_psia);
  const summary: Row[] = [], contributions: Row[] = [], states: Row[] = [], overlaps: Row[] = [], detailed: Row[] = [], snapshots: Snapshot[] = [];
  let end: Snapshot | null = null;
  for (const year of sorted) {
    const snapshot = solveMultiwellTime(year, previous, ctx);
    previous = snapshot.bhp;
    snapshots.push(snapshot);
    const selected = report.includes(year);
    const rows = multiwellRows(snapshot, p, wells, distances, selected, pressureLimit);
    detailed.push(...rows.summary);
    if (selected) {
      summary.push(...rows.summary);
      contributions.push(...rows.contributions);
      states.push(...rows.states);
      overlaps.push(...rows.overlaps);
    }
    if (year === years) end = snapshot;
    // two-phase wells stopping now: the program's fixed-zone falloff of their profile from here on
    wells.forEach((w, i) => {
      if (p.phase_mode !== "two" || w.end_year !== year) return;
      const state = snapshot.states[i];
      frozenBhp[i] = snapshot.bhp[i];
      if (!state) return;
      frozenStates[i] = state;
      const radii = [...distances.map((row) => row[i]), ...(ctx.images?.[i] ?? []).flatMap((img) => img.d)];
      const hits = sorted.filter((t) => t > year).map((t) => t - year);
      const obs = observationSchedule(p.observation_period_years, p.observation_years);
      if (obs.period > 0) hits.push(years - year + obs.period, ...obs.offsets.map((o) => years - year + o.v));
      if (!hits.length) hits.push(years - year);
      ctx.frozen[i] = frozenSourceSolution(state, params[i], radii, hits, 400);
    });
  }
  return {
    parameters: p, wells, years, report_times: report,
    summary, contributions, source_states: states,
    overlaps, detail: detailed, end_snapshot: end as Snapshot,
    source_parameters: params, references: constants, distances,
    method: MULTIWELL_METHOD, pressure_limit: pressureLimit, geometry: null, images: ctx.images, snapshots,
    frozen: ctx.frozen, frozenStates, frozenBhp,
  };
}

/** A solve at any project time (website: maps and curves between the reported times). */
export function solveAt(result: MultiwellResult, year: number, previous?: number[]): Snapshot {
  const ctx: Ctx = { p: result.parameters, wells: result.wells, params: result.source_parameters, constants: result.references, distances: result.distances, images: result.images, frozen: result.frozen };
  return solveMultiwellTime(year, previous ?? result.wells.map(() => result.parameters.initial_pressure_psia), ctx);
}

// ---------------------------------------------------------------------------------------------------------------
// After all wells stop (post-shut-in observation)

/** Fixed-zone radial diffusion of one source's final profile (`_frozen_source_observation`), live cell properties. */
export interface FrozenSource {
  centers: number[];
  logCenters: number[];
  times: number[];
  profiles: Float64Array[];
}

export function frozenSourceSolution(state: Row, p: Inputs, radii: number[], hits: number[], dense = 0): FrozenSource {
  const period = Math.max(...hits);
  const zonesActive = p.include_evaporation ? [1, 2, 3] : [2, 3];
  const mobility = zonesActive.map((n) => state[`Lambda${n}_mD_cP`] as number);
  const storage = zonesActive.map((n) => p.porosity * state[`ct${n}_per_psi`]);
  const diffusivity = mobility.map((m, i) => (TIME_COEFFICIENT_YEARS * m) / storage[i]);
  const outer = Math.max(state.rg_ft + 12 * Math.sqrt(Math.max(...diffusivity) * (state.year + period)), 2 * Math.max(...radii));
  const edges = p.include_evaporation ? [p.rw_ft, state.rd_ft, state.rg_ft, outer] : [p.rw_ft, state.rg_ft, outer];
  const faces: number[] = [p.rw_ft];
  const zones: number[] = [];
  for (let z = 0; z < edges.length - 1; z++) {
    const inner = edges[z], boundary = edges[z + 1];
    if (boundary > inner) {
      const cells = Math.max(1, Math.ceil(Math.log(boundary / inner) / 0.035));
      faces.push(...geomspace(inner, boundary, cells + 1).slice(1));
      for (let k = 0; k < cells; k++) zones.push(z);
    }
  }
  const n = zones.length;
  const centers = Array.from({ length: n }, (_, i) => Math.sqrt(faces[i] * faces[i + 1]));
  const profile = Float64Array.from(radialPressureFromState(centers, state, p).pressure);
  // live cell viscosity and storage at initial pressure + this source's own excess (zones: 0 dry, 1 two-phase, 2 brine)
  const physical = zones.map((z) => (p.include_evaporation ? z : z + 1));
  const cell = liveCellProperties(p, physical, state);
  // Time integration on a fine geometric step sequence that lands exactly on every requested time.
  const first = Math.min(period / 100, 1 / (DAYS_PER_YEAR * 86400)) / 10;
  const steps = 700;
  const set = new Set<number>(hits.filter((t) => t > 0));
  for (let k = 0; k <= steps; k++) set.add(first * (period / first) ** (k / steps));
  if (dense) for (let k = 1; k <= dense; k++) set.add((period * k) / dense);
  const times = [0, ...[...set].filter((t) => t > 0 && t <= period).sort((a, b) => a - b)];
  const profiles = diffuseRadial(faces, Float64Array.from(centers), outer, p.porosity, profile, cell, times);
  return { centers, logCenters: centers.map(Math.log), times, profiles };
}

/** numpy.interp(log r, log centers, profile): linear in log radius, clamped at both ends. */
export function interpLog(f: FrozenSource, prof: Float64Array, r: number): number {
  const x = Math.log(r), xp = f.logCenters, n = xp.length;
  if (x <= xp[0]) return prof[0];
  if (x >= xp[n - 1]) return prof[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (xp[mid] <= x) lo = mid; else hi = mid; }
  return prof[lo] + ((x - xp[lo]) / (xp[hi] - xp[lo])) * (prof[hi] - prof[lo]);
}

/** Profile of a frozen source at time tau after shut-in, at radius r (linear in time between solved times). */
export function frozenAt(f: FrozenSource, r: number, tau: number): number {
  const T = f.times, last = T.length - 1;
  if (tau >= T[last]) return interpLog(f, f.profiles[last], r);
  let lo = 0, hi = last;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= tau) lo = mid; else hi = mid; }
  if (T[lo] === tau) return interpLog(f, f.profiles[lo], r);
  const w = (tau - T[lo]) / (T[hi] - T[lo]);
  return (1 - w) * interpLog(f, f.profiles[lo], r) + w * interpLog(f, f.profiles[hi], r);
}

/** `_frozen_source_observation`: samples[receiver][k] at the given years after shut-in (and the solution, for reuse). */
function frozenSourceObservation(state: Row, p: Inputs, radii: number[], offsets: number[]): { samples: number[][]; f: FrozenSource | null } {
  const period = Math.max(...offsets);
  const initial = radialPressureFromState(radii, state, p).pressure;
  if (period === 0) return { samples: radii.map((_, m) => offsets.map(() => initial[m])), f: null };
  const f = frozenSourceSolution(state, p, radii, offsets);
  return { samples: radii.map((r, m) => offsets.map((t) => (t === 0 ? initial[m] : frozenAt(f, r, t)))), f };
}

export interface MultiwellObservation {
  rows: Row[];
  contributions: Row[];
  detail: Row[];
  method: string;
}

/** `calculate_multiwell_observation`: all field wells stop at the project endpoint. */
export function calculateMultiwellObservation(result: MultiwellResult, detail = true): MultiwellObservation | null {
  const p = result.parameters, wells = result.wells;
  const { period, offsets } = observationSchedule(p.observation_period_years, p.observation_years);
  if (!offsets.length) return null;
  // set {0.0, period, *offsets} (+ plot times): a value already present keeps its first (float) form
  const timeInt = new Map<number, boolean>([[0.0, false], [period, false]]);
  for (const o of offsets) if (!timeInt.has(o.v)) timeInt.set(o.v, o.int);
  if (detail) for (const t of geomspace(Math.min(period / 100, 1 / (DAYS_PER_YEAR * 86400)), period, 75)) if (!timeInt.has(t)) timeInt.set(t, false);
  const times = [...timeInt.keys()].sort((a, b) => a - b);
  const count = wells.length;
  const matrices = times.map(() => Array.from({ length: count }, () => new Array<number>(count).fill(0)));
  const end = result.end_snapshot;
  wells.forEach((well, i) => {
    const radii = result.distances.map((row) => row[i]);
    const parameters = result.source_parameters[i], constants = result.references[i];
    const early = result.frozen[i];
    if (p.phase_mode === "two" && early && well.end_year !== null && well.end_year !== undefined) {
      // stopped before the endpoint: its falloff continues
      const t0 = well.end_year;
      times.forEach((offset, j) => {
        radii.forEach((r, m) => { matrices[j][m][i] = frozenAt(early, Math.max(r, well.rw_ft), result.years + offset - t0); });
        for (const img of result.images?.[i] ?? []) img.d.forEach((r, m) => { matrices[j][m][i] += img.sign * frozenAt(early, r, result.years + offset - t0); });
      });
    } else if (p.phase_mode === "two") {
      const state = end.states[i];
      if (state) {
        // one solve per source; image wells (website boundary option) are sampled from the same solution
        const imgs = result.images?.[i] ?? [];
        const all = [...radii, ...imgs.flatMap((img) => img.d)];
        const { samples, f } = frozenSourceObservation(state, parameters, all, times);
        let at = radii.length;
        for (const img of imgs) {
          img.d.forEach((_, m) => samples[at + m].forEach((v, j) => { samples[m][j] += img.sign * v; }));
          at += img.d.length;
        }
        samples.slice(0, radii.length).forEach((row, m) => row.forEach((v, j) => { matrices[j][m][i] = v; }));
        (result.observationFrozen ??= wells.map(() => null))[i] = f;
      }
    } else {
      times.forEach((offset, j) => {
        const [profile] = singlePhaseSourceProfile(result.years + offset, well, radii, parameters, constants, result.years, end.trial[i]);
        for (const img of result.images?.[i] ?? []) singlePhaseSourceProfile(result.years + offset, well, img.d, parameters, constants, result.years, end.trial[i])[0].forEach((v, m) => { profile[m] += img.sign * v; });
        profile.forEach((v, m) => { matrices[j][m][i] = v; });
      });
    }
  });
  const offsetValues = offsets.map((o) => o.v);
  const rows: Row[] = [], pairs: Row[] = [], plotRows: Row[] = [];
  times.forEach((offset, j) => {
    wells.forEach((well, m) => {
      const C = matrices[j];
      const total = sumRow(C[m]);
      const row: Row = {
        years_after_shut_in: offset, year: result.years + offset,
        well: well.name,
        BHP_psia: p.initial_pressure_psia + total,
        own_formation_response_psi: C[m][m], own_skin_psi: 0.0,
        interference_psi: total - C[m][m],
        total_delta_p_psi: total, current_surface_rate: 0.0,
        falloff_from_flowing_BHP_psi: end.bhp[m] - p.initial_pressure_psia - total,
      };
      if (timeInt.get(offset)) markInt(row, "years_after_shut_in");
      Object.assign(row, pressureStatus(row.BHP_psia, result.pressure_limit, well.max_bhp_psia));
      wells.forEach((source, i) => { row[`from_${source.name}_psi`] = C[m][i]; });
      plotRows.push(row);
      if (offsetValues.includes(offset)) {
        rows.push(row);
        wells.forEach((source, i) => {
          const c: Row = { years_after_shut_in: offset, year: row.year, receiving_well: well.name, source_well: source.name, is_self: m === i, delta_p_psi: C[m][i] };
          if (timeInt.get(offset)) markInt(c, "years_after_shut_in");
          pairs.push(c);
        });
      }
    });
  });
  return {
    rows, contributions: pairs, detail: plotRows,
    method: p.phase_mode === "two"
      ? "Fixed-zone zero-flow radial diffusion of each final source profile with live cell viscosity and storage; spatial superposition; all field wells stop at the project endpoint."
      : "E1 time/space superposition with background properties at each source's endpoint BHP; all wells stop at endpoint.",
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Output files (`save_multiwell_results`; the two plots are made by lib/multiwellPlot.ts)

const FALLBACK = ["year", "well_i", "well_m", "plumes_touch_or_overlap"];

export function multiwellFiles(result: MultiwellResult, observation: MultiwellObservation | null): Record<string, string> {
  const files: Record<string, string> = {
    "multiwell_summary.csv": dictCsv(result.summary, FALLBACK),
    "interference_contributions.csv": dictCsv(result.contributions, FALLBACK),
    "source_states.csv": dictCsv(result.source_states, FALLBACK),
    "multiwell_time_detail.csv": dictCsv(result.detail, FALLBACK),
    "plume_overlap.csv": dictCsv(result.overlaps, FALLBACK),
  };
  const wells = result.wells;
  files["final_interference_matrix.csv"] = dictCsv(wells.map((well, m) => ({ receiving_well: well.name, ...Object.fromEntries(wells.map((s, i) => [s.name, result.end_snapshot.matrix[m][i]])) })));
  files["evaluation_distances_ft.csv"] = dictCsv(wells.map((well, m) => ({ receiving_well: well.name, ...Object.fromEntries(wells.map((s, i) => [s.name, result.distances[m][i]])) })));
  const separations = wellSeparations(wells);
  files["well_separations_ft.csv"] = dictCsv(wells.map((well, m) => ({ well: well.name, ...Object.fromEntries(wells.map((s, i) => [s.name, separations[m][i]])) })));
  files["pressure_limit_summary.csv"] = dictCsv(multiwellLimitSummary(result, observation));
  const saved = {
    system: "multiwell", years: result.years,
    parameters: { ...result.parameters },
    // end_year is the website's addition: written only for a well that stops before the endpoint
    wells: wells.map(({ end_year, ...w }) => (end_year === null || end_year === undefined ? { ...w } : { ...w, end_year })), report_times: result.report_times,
    method: MULTIWELL_METHOD, matrix_orientation: "rows=receivers; columns=sources; no skin",
    pressure_tolerance_psi: PRESSURE_TOLERANCE_PSI,
    dry_zone_convention: "dry_zone_radius_ft=0 when absent; zone2_inner_radius_ft=rw",
    observation_method: observation ? observation.method : null,
    overlap_detected: result.overlaps.some((r) => r.plumes_touch_or_overlap),
    geometry: result.geometry, pressure_limit: result.pressure_limit,
  };
  files["multiwell_inputs_used.json"] = pyJson(saved);
  if (observation) {
    files["multiwell_observation.csv"] = dictCsv(observation.rows);
    files["observation_contributions.csv"] = dictCsv(observation.contributions);
  }
  return files;
}

/** pressure_limit_summary.csv of the multiwell run: every computed time, injection and observation. */
export function multiwellLimitSummary(result: MultiwellResult, observation: MultiwellObservation | null): Row[] {
  return pressureFailureSummary([...result.detail, ...(observation ? observation.detail : [])]);
}

// ---------------------------------------------------------------------------------------------------------------
// The browser form (`_browser_calculation`, multiwell branch)

export interface MultiwellForm {
  /** shared physical inputs (rate, rw and skin are per well) */
  p: Inputs;
  /** the well table (name, rate, start_year, rw_ft, skin, evaporation, max_bhp_psia; x/y when coordinates are used) */
  wells: MWell[];
  geometry: GeometryInput;
  years: string;
  report_times: string;
  observe: "yes" | "no";
  period: string;
  offsets: string;
  limit: LimitInput;
  images?: Images | null;
}

export interface MultiwellRun {
  result: MultiwellResult;
  observation: MultiwellObservation | null;
  limitSummary: Row[];
}

export function multiwellCalculation(f: MultiwellForm): MultiwellRun {
  const p: Inputs = { ...f.p, observation_period_years: 0.0, observation_years: "" };
  const { wells, settings } = configureWellGeometry(p, f.wells, f.geometry);
  const limit = pressureLimitSpec(f.limit);
  if (f.observe === "yes") {
    let period = NaN;
    try {
      period = parsePyFloat(f.period ?? "");
    } catch {
      fail("Enter a positive observation duration.");
    }
    if (!Number.isFinite(period) || period <= 0) fail("Enter a positive observation duration.");
    p.observation_period_years = period;
    p.observation_years = f.offsets ?? "";
  }
  let years = NaN;
  try {
    years = parsePyFloat(f.years ?? "30");
  } catch {
    fail("Enter a valid project endpoint in years.");
  }
  const result = runMultiwell(p, wells, years, f.report_times, { pressureLimit: limit, images: f.images ?? null });
  result.geometry = settings;
  const observation = calculateMultiwellObservation(result, true);
  return { result, observation, limitSummary: multiwellLimitSummary(result, observation) };
}
