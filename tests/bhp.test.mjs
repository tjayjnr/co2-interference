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
  assert.deepEqual(summaryColumns(two).map((c) => c[1]).slice(0, 4), ["year", "P_used_psia", "rho_g_lb_ft3", "rho_g_at_BHP_lb_ft3"]);
  const co2 = runModel({ ...DEFAULT_INPUTS, phase_mode: "single" }, 1).results;
  const cols = summaryColumns(co2);
  assert.ok(cols.some(([l]) => l === "Fixed CO2 density at Pi (lb/ft3)"));
  assert.ok(!cols.some(([, k]) => k === "rho_g_at_BHP_lb_ft3"));
  assert.ok(csvText(DETAIL_FIELDS, []).startsWith("year,phase_count"));
});
