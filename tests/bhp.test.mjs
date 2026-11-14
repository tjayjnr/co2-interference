// The website's model (lib/bhp.ts) against the files written by the reference Python itself
// (tests/bhp-reference.json, made by scripts/bhp-reference.py from reference/co2_bhp_model.py).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_INPUTS, runModel, calculateObservation, calculateFirstYearDetail, outputFiles, browserCalculation,
  pyFloat, pyFormat, observationSchedule, validate, summaryColumns, csvText, DETAIL_FIELDS, withPressureLimit, pressureLimitSpec,
} from "../lib/bhp.ts";

const ref = JSON.parse(readFileSync(new URL("./bhp-reference.json", import.meta.url), "utf8"));
const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|nan|-?inf/g;

/** Same text apart from numbers, which must have the same int/float form and agree within the tolerance. */
function sameText(got, want, { rel = 1e-7, abs = 1e-9 } = {}, what = "") {
  const gl = got.split("\r\n"), wl = want.split("\r\n");
  assert.equal(gl.length, wl.length, `${what}: line count`);
  gl.forEach((g, i) => sameLine(g, wl[i], { rel, abs }, `${what} line ${i + 1}`));
}
function sameLine(g, w, { rel, abs }, what) {
  if (g === w) return;
  assert.equal(g.replace(NUM, "#"), w.replace(NUM, "#"), `${what}: text differs\n got: ${g}\nwant: ${w}`);
  const gn = g.match(NUM) ?? [], wn = w.match(NUM) ?? [];
  gn.forEach((s, k) => {
    const a = Number(s), b = Number(wn[k]);
    const isInt = !/[.e]/.test(wn[k]);
    assert.equal(/[.e]/.test(s), !isInt, `${what}: int/float form of ${s} vs ${wn[k]}`);
    // pressure_evaluations may differ by one: at round-off level (1e-13 psi) a residual can be exactly 0 in one code
    // and not in the other, and Brent's method then stops one evaluation earlier. All other integers are equal.
    if (isInt && a > 3 && Math.abs(a - b) <= 1) return;
    if (!(Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b))))) {
      assert.fail(`${what}: ${s} vs ${wn[k]}`);
    }
  });
}

for (const c of ref.cases) {
  const p = { ...DEFAULT_INPUTS, ...c.patch, observation_period_years: c.observation.period, observation_years: c.observation.offsets };
  const { results, constants } = runModel(p, c.years);
  const observation = calculateObservation(results[results.length - 1], p, true);
  const firstYear = calculateFirstYearDetail(results, p, constants);
  const files = outputFiles(withPressureLimit({ label: "", years: c.years, p, results, constants, observation, firstYear }, c.pressure_limit));

  test(`${c.name}: annual_summary.csv and all_calculations.csv match the Python`, () => {
    sameText(files["annual_summary.csv"], c.files["annual_summary.csv"], {}, "annual_summary");
    sameText(files["all_calculations.csv"], c.files["all_calculations.csv"], { rel: 1e-7, abs: 1e-6 }, "all_calculations"); // balance-check errors and the EOS pressure residual (Pa) are round-off
  });

  test(`${c.name}: first_year_detail.csv matches the Python`, () => {
    const lines = files["first_year_detail.csv"].split("\r\n").filter(Boolean);
    const want = c.files["first_year_detail.csv"];
    assert.equal(lines[0], want.header);
    assert.equal(lines.length - 1, want.count, "number of first-year samples");
    for (const [i, row] of Object.entries(want.rows)) sameLine(lines[1 + Number(i)], row, { rel: 1e-7, abs: 1e-9 }, `first_year row ${i}`);
  });

  test(`${c.name}: observation_summary.csv and inputs_used.json match the Python`, () => {
    assert.equal("observation_summary.csv" in files, "observation_summary.csv" in c.files);
    if (c.files["observation_summary.csv"]) {
      // the shut-in diffusion is integrated differently (scipy BDF there): agree to about 1e-3 psi
      sameText(files["observation_summary.csv"], c.files["observation_summary.csv"], { rel: 1e-9, abs: 3e-3 }, "observation_summary");
    }
    // Python's write_text uses the operating system's line ending (\r\n on Windows)
    const g = files["inputs_used.json"].split("\n"), w = c.files["inputs_used.json"].replace(/\r\n/g, "\n").split("\n");
    assert.equal(g.length, w.length, "inputs_used.json line count");
    g.forEach((line, i) => sameLine(line, w[i], { rel: 1e-9, abs: 1e-12 }, `inputs_used.json line ${i + 1}`));
  });

  test(`${c.name}: pressure_limit_summary.csv matches the Python`, () => {
    sameText(files["pressure_limit_summary.csv"], c.files["pressure_limit_summary.csv"], { rel: 1e-9, abs: 3e-3 }, "pressure_limit_summary");
  });

  if (c.plot_shut_in) {
    test(`${c.name}: shut-in curve for the plot matches the Python`, () => {
      assert.equal(observation.elapsed_years.length, c.plot_shut_in.elapsed_years.length);
      observation.bhp_psia.forEach((v, i) => assert.ok(Math.abs(v - c.plot_shut_in.bhp_psia[i]) < 5e-3, `point ${i}: ${v} vs ${c.plot_shut_in.bhp_psia[i]}`));
    });
  }
}

test("Python number formatting", () => {
  assert.equal(pyFloat(150), "150.0");
  assert.equal(pyFloat(4.2e-6), "4.2e-06");
  assert.equal(pyFloat(0.0001), "0.0001");
  assert.equal(pyFloat(1e16), "1e+16");
  assert.equal(pyFloat(1643625000), "1643625000.0");
  assert.equal(pyFloat(-0.5), "-0.5");
  assert.equal(pyFormat(2.19e-4, ".7e"), "2.1900000e-04");
  assert.equal(pyFormat(1.5e-5, ".2e"), "1.50e-05");
  assert.equal(pyFormat(30.5, ".10g"), "30.5");
  assert.equal(pyFormat(40, ".10g"), "40");
  assert.equal(pyFormat(1e-5, ".10g"), "1e-05");
  assert.equal(pyFormat(4.2e-6, "g"), "4.2e-06");
  assert.equal(pyFormat(150, "g"), "150");
});

test("browser form: the Python's validation messages", () => {
  const base = { phase: "two", years: "30", evaporation: "yes", observe: "no", period: "", offsets: "", fields: {} };
  assert.throws(() => browserCalculation({ ...base, years: "0" }), /Number of years must be at least 1/);
  assert.throws(() => browserCalculation({ ...base, years: "2.5" }), /Enter a positive integer number of years/);
  assert.throws(() => browserCalculation({ ...base, fields: { k_mD: "abc" } }), /Enter a number for Permeability in every zone \(mD\)/);
  assert.throws(() => browserCalculation({ ...base, observe: "yes", period: "" }), /Enter a positive observation duration in years/);
  assert.throws(() => browserCalculation({ ...base, observe: "yes", period: "-1" }), /Enter a positive, finite observation duration/);
  assert.throws(() => browserCalculation({ ...base, observe: "yes", period: "5", offsets: "7" }), /Observation years must be numbers between 0 and 5/);
  assert.throws(() => browserCalculation({ ...base, fields: { corey_n_gas: "2" } }), /Set both Corey exponents/);
  const out = browserCalculation({ ...base, years: "3", observe: "yes", period: "2", offsets: "" });
  assert.deepEqual(out.observation.rows.map((r) => r.years_after_shut_in), [1, 2]);
  assert.equal(out.label, "Two-phase CO₂–brine");
});

test("pressure limit: the Python's rules and messages", () => {
  assert.deepEqual(pressureLimitSpec(null), { mode: "none", allowable_bhp_psia: null });
  assert.deepEqual(pressureLimitSpec({ mode: "fracture_fraction", fracture_pressure_psia: "5200", fraction: "0.9" }),
    { mode: "fracture_fraction", fracture_pressure_psia: 5200, fraction: 0.9, allowable_bhp_psia: 5200 * 0.9 });
  assert.throws(() => pressureLimitSpec({ mode: "max_bhp", max_bhp_psia: "" }), /Enter a positive pressure limit in absolute psia/);
  assert.throws(() => pressureLimitSpec({ mode: "max_bhp", max_bhp_psia: -1 }), /must be finite and positive psia/);
  assert.throws(() => pressureLimitSpec({ mode: "fracture_fraction", fracture_pressure_psia: 5000, fraction: 1.5 }), /at most 1/);
  const base = { phase: "two", years: "2", evaporation: "yes", observe: "no", period: "", offsets: "", fields: {} };
  const out = browserCalculation({ ...base, limit_mode: "max_bhp", max_bhp_psia: "3500.5" });
  assert.equal(out.results[1].pressure_limit_status, "FAIL");
  assert.deepEqual(summaryColumns(out.results).slice(-2).map((c) => c[1]), ["max_allowable_BHP_psia", "pressure_limit_status"]);
});

test("validation and observation schedule", () => {
  assert.throws(() => validate({ ...DEFAULT_INPUTS, porosity: 1 }), /porosity/);
  validate({ ...DEFAULT_INPUTS, phase_mode: "single", single_phase_fluid: "water", corey_n_gas: 7 }); // inactive input
  assert.deepEqual(observationSchedule(2.5, "").offsets.map((o) => [o.v, o.int]), [[1, true], [2, true], [2.5, false]]);
  assert.deepEqual(observationSchedule(10, "5, 0,0.5").offsets.map((o) => o.v), [0, 0.5, 5]);
  assert.throws(() => observationSchedule(0, "1"), /positive observation period/);
});

test("table columns follow _notebook_summary_html", () => {
  const two = runModel({ ...DEFAULT_INPUTS }, 1).results;
  assert.deepEqual(summaryColumns(two).map((c) => c[1]).slice(0, 5), ["year", "mu_gas_cP", "salinity_ppm", "salt_concentration_kg_m3", "rho_water_lb_ft3"]);
  const co2 = runModel({ ...DEFAULT_INPUTS, phase_mode: "single" }, 1).results;
  const cols = summaryColumns(co2);
  assert.ok(cols.some(([l]) => l === "Fixed CO2 density at Pi (lb/ft3)"));
  assert.ok(!cols.some(([, k]) => k === "rho_g_at_BHP_lb_ft3"));
  assert.ok(csvText(DETAIL_FIELDS, []).startsWith("year,phase_count"));
});

test("background properties are calculated (not inputs) and match the Python", async () => {
  const b = await import("../lib/bhp.ts");
  for (const gone of ["mu_gas_cP", "water_compressibility_per_psi", "salt_mass_fraction", "brine_density_lb_ft3"]) {
    assert.ok(!(gone in b.DEFAULT_INPUTS), `${gone} is no longer an input`);
  }
  assert.equal(b.DEFAULT_INPUTS.brine_standard_density_lb_ft3, 63.878);
  const near = (a, e, rel = 1e-12) => assert.ok(Math.abs(a - e) <= rel * Math.abs(e), `${a} vs ${e}`);
  // values printed by reference/co2_bhp_model.py
  const w = b.waterProperties(3500, b.DEFAULT_INPUTS);
  near(w.salinity_ppm, 34005.45609907303);
  near(w.rho_water_lb_ft3, 62.190297675579785);
  near(w.cw_per_psi, 2.9410944094676516e-06, 1e-9);
  near(b.gasProperties(3500, 200, b.prState(b.P_SC_PSIA, b.T_SC_F).Z).mu_gas_cP, 0.04524240026351626, 1e-10);
  const w2 = b.waterProperties(5000, { ...b.DEFAULT_INPUTS, brine_standard_density_lb_ft3: 66.0, temperature_F: 150 });
  near(w2.salinity_ppm, 80446.46244539539);
  near(w2.rho_water_lb_ft3, 65.42979180006385);
  near(w2.cw_per_psi, 2.5921706359501734e-06, 1e-9);
  near(b.co2Viscosity(120, 40).mu_gas_cP, 0.04950898047563166);
  // salinity does not change with pressure; density and cw do
  const w3 = b.waterProperties(4500, b.DEFAULT_INPUTS);
  assert.equal(w3.salt_mass_fraction, w.salt_mass_fraction);
  assert.ok(w3.rho_water_lb_ft3 > w.rho_water_lb_ft3 && w3.cw_per_psi < w.cw_per_psi);
  assert.throws(() => b.salinityFromStandardDensity(62.0), /at least 62.368/);
});

test("CO2 dissolution (co2_dissolution_pressure_only.py): solubility, mass balance and the pressure coupling", async () => {
  const b = await import("../lib/bhp.ts");
  assert.equal(b.DEFAULT_INPUTS.include_dissolution, false, "off by default");
  const near = (a, e, rel = 1e-12) => assert.ok(Math.abs(a - e) <= rel * Math.abs(e), `${a} vs ${e}`);
  // values printed by calculate_solubility in reference/co2_bhp_model.py (psia, F, NaCl kg/kg -> mol/kg water, mass fraction)
  for (const [p, t, xs, mc, X] of [
    [1450.38, 122, 0.0, 1.136433651662037, 0.04763163411285918],
    [5801.5, 122, 0.0, 1.4993390415255703, 0.06190063795277993],
    [3500, 200, 0.034, 1.0694633977501797, 0.043489003233249404],
    [2000, 150, 0.1, 0.7609394951042276, 0.029257885843149412],
    [6000, 100, 0.2, 0.758263564380409, 0.02600246189787643],
  ]) {
    const r = b.calculateSolubility(p, t, xs);
    near(r.mc_mol_per_kg_water, mc);
    near(r.Xco2_eq, X);
  }
  assert.throws(() => b.calculateSolubility(3500, 230, 0.03), /35-99 C/);
  assert.throws(() => b.calculateSolubility(10, 150, 0.03), /1-600 bar/);
  assert.throws(() => b.runModel({ ...b.DEFAULT_INPUTS, include_dissolution: true, temperature_F: 230 }, 2), /35-99 C/);
  // off: no dissolution columns, results unchanged; on: equilibrium inventory in zone 2
  const off = b.runModel({ ...b.DEFAULT_INPUTS }, 10).results;
  const on = b.runModel({ ...b.DEFAULT_INPUTS, include_dissolution: true }, 10).results;
  assert.ok(!("Mdiss_lb" in off[0]) && !("Cd_lb_ft3_aqueous" in off[0]));
  for (const r of on) {
    near(r.Cd_lb_ft3_aqueous, r.rho_aq_lb_ft3 * r.Xco2_eq);
    near(r.Sg2, (r.Minj_lb - r.rho_g_lb_ft3 * r.Vp1_ft3 - r.Cd_lb_ft3_aqueous * r.Vp2_ft3) / ((r.rho_g_lb_ft3 - r.Cd_lb_ft3_aqueous) * r.Vp2_ft3), 1e-10);
    near(r.Mdiss_lb, r.Cd_lb_ft3_aqueous * (1 - r.Sg2) * r.Vp2_ft3);
    near(r.Mfree_lb + r.Mdiss_lb, r.Minj_lb, 1e-12);
    near(r.krg2, b.DEFAULT_INPUTS.krg_endpoint * (r.Sg2 / (1 - b.DEFAULT_INPUTS.Swr)) ** 3, 1e-12);
    assert.equal(r.dissolution_enabled, 1);
  }
  const y = 9;
  assert.ok(on[y].Sg2 < off[y].Sg2 && on[y].Lambda2_mD_cP < off[y].Lambda2_mD_cP && on[y].ct2_per_psi < off[y].ct2_per_psi);
  assert.ok(on[y].BHP_psia > off[y].BHP_psia, "less free gas in zone 2 -> lower zone 2 mobility -> higher BHP");
  near(on[y].dissolved_fraction_of_injected, 0.2113, 2e-3);
  // the saved inputs record the choice and the method
  const out = b.withPressureLimit({ label: "", years: 3, p: { ...b.DEFAULT_INPUTS, include_dissolution: true }, results: on.slice(0, 3), constants: {}, observation: null, firstYear: [] }, null);
  const json = b.inputsUsed(out);
  assert.match(json, /"include_dissolution": true/);
  assert.match(json, /"dissolution_coupling": /);
  // shut-in observation runs with the dissolution saturations
  const p = { ...b.DEFAULT_INPUTS, include_dissolution: true, observation_period_years: 2, observation_years: "0,1,2" };
  const obs = b.calculateObservation(b.runModel(p, 3).results[2], p, false);
  assert.ok(obs.rows.every((r) => Number.isFinite(r.BHP_psia)));
});
