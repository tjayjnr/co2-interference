// Runs the BHP calculation used by the website, without the website.
//
//   node run_bhp.mjs                 SINGLE WELL: the program's single-well calculation
//   node run_bhp.mjs --multiwell     MULTIWELL INTERFERENCE: the program's multiwell section
//
// Edit the INPUTS below (field units, same names as the Python program). Results are printed and saved as the
// program's files in the folder "results" (single well) or "results_multiwell" (multiwell), with the figures as SVG.
// Needs Node.js 22.18 or newer (runs the .ts files directly).

import { mkdirSync, writeFileSync } from "node:fs";
import {
  DEFAULT_INPUTS, runModel, calculateObservation, calculateFirstYearDetail, outputFiles, withPressureLimit, BROWSER_PHASES,
} from "./bhp.ts";
import { renderBhpPlot } from "./bhpPlot.ts";
import { makeWell, multiwellCalculation, multiwellFiles } from "./multiwell.ts";
import { renderMultiwellMatrix, renderMultiwellPressure } from "./multiwellPlot.ts";

// ---------------------------------------------------------------------------------------------------------------
// INPUTS shared by both systems (field units; the defaults of the program)
const INPUTS = {
  ...DEFAULT_INPUTS,
  phase_mode: "two",            // "two" = two-phase CO2-brine, "single" = single phase
  single_phase_fluid: "co2",    // for phase_mode "single": "co2" or "water"
  include_evaporation: true,    // two-phase only
  k_mD: 50.0, h_ft: 20.0, porosity: 0.2,
  initial_pressure_psia: 3500.0, temperature_F: 200.0,
  mu_water_cP: 0.3, mu_gas_cP: 0.0432, brine_density_lb_ft3: 63.9, salt_mass_fraction: 0.034, Swr: 0.55,
  rock_compressibility_per_psi: 4.2e-6, water_compressibility_per_psi: 3.5e-6,
  krg_endpoint: 0.65, krw_endpoint: 1.0, krg_zone1: 0.65, corey_n_gas: 3.0, corey_n_water: 3.0,
};
const OBSERVATION = { period: 10.0, years: "0,0.5,1,5,10" }; // period 0 = no observation after shut-in
// Pressure check: { mode: "none" } | { mode: "max_bhp", max_bhp_psia: 4680 } | { mode: "fracture_fraction", fracture_pressure_psia: 5200, fraction: 0.9 }
const PRESSURE_LIMIT = { mode: "fracture_fraction", fracture_pressure_psia: 5200.0, fraction: 0.9 };

// SINGLE WELL
const SINGLE = { q_Mscf_day: 150.0, water_rate_stb_day: 150.0, rw_ft: 0.55, skin: 0.0, years: 30 };

// MULTIWELL INTERFERENCE
const REPORT_TIMES = "";       // reporting years, e.g. "0.5,1,5,10,30"; "" = every year and the endpoint
const RADIUS = { same: true, rw_ft: 0.55 }; // same radius for all wells; same: false uses each well's rw_ft below
// Rate: Mscf/day (CO2) or STB/day (water); 0 = observation well. include_evaporation: null (inherit), true or false.
// end_year: the year the well stops (the last end year is the project endpoint; observation starts after it).
// max_bhp_psia: this well's own limit (null = the shared limit). rate_schedule: single phase only, e.g.
// [{ year: 0, rate: 150 }, { year: 5, rate: 75 }, { year: 10, rate: 0 }].
const WELLS = [
  { name: "Well 1", rate: 150.0, start_year: 0.0, end_year: 30.0, rw_ft: 0.55, skin: 0.0, include_evaporation: null, max_bhp_psia: null },
  { name: "Well 2", rate: 150.0, start_year: 0.0, end_year: 30.0, rw_ft: 0.55, skin: 0.0, include_evaporation: null, max_bhp_psia: null },
  { name: "Well 3", rate: 150.0, start_year: 0.0, end_year: 30.0, rw_ft: 0.55, skin: 0.0, include_evaporation: null, max_bhp_psia: null },
  { name: "Well 4", rate: 150.0, start_year: 0.0, end_year: 30.0, rw_ft: 0.55, skin: 0.0, include_evaporation: null, max_bhp_psia: null },
];
// Distances (ft), as the program's configure_well_geometry:
//   { mode: "constant", layout: "line" | "grid", spacing_ft: 1000 }
//   { mode: "different", different_input: "adjacent", adjacent_distances_ft: "1000, 1500, 800" }
//   { mode: "different", different_input: "pairwise", pairwise_distances_ft: "0,1000,1500,2000\n1000,0,..." }
//   { mode: "different", different_input: "coordinates" }  (then give x_ft and y_ft for every well above)
const GEOMETRY = { mode: "constant", layout: "line", spacing_ft: 1000.0 };
// ---------------------------------------------------------------------------------------------------------------

if (process.argv.includes("--multiwell")) {
  const PROJECT_YEARS = Math.max(...WELLS.map((w) => w.end_year));
  const wells = WELLS.map((w) => makeWell({ ...w, rw_ft: RADIUS.same ? RADIUS.rw_ft : w.rw_ft }));
  const run = multiwellCalculation({
    p: { ...INPUTS }, wells, geometry: { number: wells.length, ...GEOMETRY }, years: String(PROJECT_YEARS), report_times: REPORT_TIMES,
    observe: OBSERVATION.period > 0 ? "yes" : "no", period: String(OBSERVATION.period), offsets: OBSERVATION.years, limit: PRESSURE_LIMIT,
  });
  const { result, observation, limitSummary } = run;
  console.log(`Multiwell results at project year ${PROJECT_YEARS}; ${wells.length} wells`);
  console.log(["Well", "BHP psia", "Own formation", "Skin psi", "Interference psi", "Status"].map((s, i) => (i ? s.padStart(17) : s.padEnd(12))).join(""));
  for (const r of result.summary.filter((s) => s.year === result.years)) {
    console.log([r.well.padEnd(12), ...[r.BHP_psia, r.own_formation_response_psi, r.own_skin_psi, r.interference_psi].map((v) => v.toFixed(6).padStart(17)), String(r.pressure_limit_status).padStart(17)].join(""));
  }
  if (observation) for (const r of observation.rows) console.log(`  ${r.years_after_shut_in} yr after all wells stop  ${r.well}  BHP ${r.BHP_psia.toFixed(6)} psia`);
  for (const r of limitSummary) console.log(`${r.well}: ${r.overall_status}; peak BHP ${r.peak_BHP_psia.toFixed(6)} psia; allowable BHP ${r.max_allowable_BHP_psia === "" ? "not set" : r.max_allowable_BHP_psia}.`);
  mkdirSync("results_multiwell", { recursive: true });
  const files = multiwellFiles(result, observation);
  for (const [name, text] of Object.entries(files)) writeFileSync(`results_multiwell/${name}`, text);
  writeFileSync("results_multiwell/multiwell_bhp_and_interference.svg", renderMultiwellPressure(result, observation).svg);
  writeFileSync("results_multiwell/multiwell_matrix_and_fronts.svg", renderMultiwellMatrix(result).svg);
  console.log("Saved in the folder results_multiwell/: " + [...Object.keys(files), "multiwell_bhp_and_interference.svg", "multiwell_matrix_and_fronts.svg"].join(", "));
} else {
  const p = {
    ...INPUTS, q_Mscf_day: SINGLE.q_Mscf_day, water_rate_stb_day: SINGLE.water_rate_stb_day, rw_ft: SINGLE.rw_ft, skin: SINGLE.skin,
    observation_period_years: OBSERVATION.period, observation_years: OBSERVATION.period > 0 ? OBSERVATION.years : "",
  };
  const { results, constants } = runModel(p, SINGLE.years);
  const observation = calculateObservation(results[results.length - 1], p, true);
  const firstYear = calculateFirstYearDetail(results, p, constants);
  const key = p.phase_mode === "two" ? "two" : p.single_phase_fluid;
  const out = withPressureLimit({ label: BROWSER_PHASES[key][2], years: SINGLE.years, p, results, constants, observation, firstYear }, PRESSURE_LIMIT);
  console.log(`${out.label} · End-of-injection BHP at year ${SINGLE.years}: ${results[results.length - 1].BHP_psia.toFixed(3)} psia`);
  for (const r of results) console.log(`  year ${String(r.year).padStart(2)}  BHP ${r.BHP_psia.toFixed(6)} psia  ${r.pressure_limit_status}`);
  if (observation) for (const r of observation.rows) console.log(`  ${r.years_after_shut_in} yr after shut-in  BHP ${r.BHP_psia.toFixed(6)} psia`);
  mkdirSync("results", { recursive: true });
  const files = outputFiles(out);
  for (const [name, text] of Object.entries(files)) writeFileSync(`results/${name}`, text);
  writeFileSync("results/bhp_vs_year.svg", renderBhpPlot(out).svg);
  console.log("Saved in the folder results/: " + [...Object.keys(files), "bhp_vs_year.svg"].join(", "));
}
