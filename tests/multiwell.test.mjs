// The website's multiwell model (lib/multiwell.ts) against the files written by the reference Python's multiwell section
// (tests/multiwell-reference.json, made by scripts/multiwell-reference.py from reference/co2_bhp_model.py).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DEFAULT_INPUTS } from "../lib/bhp.ts";
import {
  calculateMultiwellObservation, configureWellGeometry, coordinatesFromDistances, defaultWells, makeWell, multiwellCalculation,
  multiwellFiles, runMultiwell,
} from "../lib/multiwell.ts";

const ref = JSON.parse(readFileSync(new URL("./multiwell-reference.json", import.meta.url), "utf8"));
const NUM = /-?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|nan|-?inf/g;

function sameText(got, want, tol, what) {
  const gl = got.replace(/\r\n/g, "\n").split("\n"), wl = want.replace(/\r\n/g, "\n").split("\n");
  assert.equal(gl.length, wl.length, `${what}: line count`);
  gl.forEach((g, i) => sameLine(g, wl[i], tol, `${what} line ${i + 1}`));
}
function sameLine(g, w, { rel = 1e-7, abs = 1e-9 } = {}, what = "") {
  if (g === w) return;
  assert.equal(g.replace(NUM, "#"), w.replace(NUM, "#"), `${what}: text differs\n got: ${g}\nwant: ${w}`);
  const gn = g.match(NUM) ?? [], wn = w.match(NUM) ?? [];
  gn.forEach((s, k) => {
    const a = Number(s), b = Number(wn[k]);
    const isInt = !/[.e]/.test(wn[k]);
    assert.equal(/[.e]/.test(s), !isInt, `${what}: int/float form of ${s} vs ${wn[k]}`);
    if (isInt && a > 3 && Math.abs(a - b) <= 1) return; // pressure_evaluations: one evaluation more or less at round-off
    if (!(Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b))))) assert.fail(`${what}: ${s} vs ${wn[k]}\n got: ${g}\nwant: ${w}`);
  });
}

const INJ = { rel: 1e-7, abs: 1e-6 }; // injection period: the same equations and iterations as the Python
const OBS = { rel: 1e-9, abs: 3e-3 }; // after shut-in: scipy BDF there, implicit Euler + Richardson here (about 1e-3 psi)

for (const c of ref.cases) {
  const p = { ...DEFAULT_INPUTS, ...c.patch, observation_period_years: c.observation.period, observation_years: c.observation.offsets };
  const start = c.wells ? c.wells.map((w) => makeWell(w)) : defaultWells(p, c.geometry.number);
  const { wells, settings } = configureWellGeometry(p, start, c.geometry);
  const result = runMultiwell(p, wells, c.years, c.report_times, { pressureLimit: c.limit });
  result.geometry = settings;
  const observation = calculateMultiwellObservation(result, true);
  const files = multiwellFiles(result, observation);

  test(`${c.name}: the same output files as the Python`, () => {
    assert.deepEqual(Object.keys(files).sort(), Object.keys(c.files).sort());
  });

  for (const name of ["multiwell_summary.csv", "final_interference_matrix.csv", "evaluation_distances_ft.csv", "well_separations_ft.csv", "plume_overlap.csv"]) {
    test(`${c.name}: ${name} matches the Python`, () => sameText(files[name], c.files[name], INJ, name));
  }

  for (const name of ["multiwell_time_detail.csv", "source_states.csv", "interference_contributions.csv"]) {
    test(`${c.name}: ${name} matches the Python`, () => {
      const lines = files[name].split("\r\n").filter(Boolean);
      const want = c.files[name];
      assert.equal(lines[0], want.header, `${name} header`);
      assert.equal(lines.length - 1, want.count, `${name} rows`);
      for (const [i, row] of Object.entries(want.rows)) sameLine(lines[1 + Number(i)], row, INJ, `${name} row ${i}`);
    });
  }

  test(`${c.name}: observation and pressure-limit files match the Python`, () => {
    for (const name of ["multiwell_observation.csv", "observation_contributions.csv", "pressure_limit_summary.csv"]) {
      if (c.files[name]) sameText(files[name], c.files[name], OBS, name);
    }
  });

  test(`${c.name}: multiwell_inputs_used.json matches the Python`, () => {
    sameText(files["multiwell_inputs_used.json"], c.files["multiwell_inputs_used.json"], { rel: 1e-9, abs: 1e-9 }, "multiwell_inputs_used.json");
  });
}

test("one well: the multiwell solve equals the single-well program", async () => {
  const { runModel } = await import("../lib/bhp.ts");
  const p = { ...DEFAULT_INPUTS };
  const r = runMultiwell(p, [makeWell({ name: "Well 1" })], 10, "", { detail: false });
  const { results } = runModel(p, 10);
  for (let y = 1; y <= 10; y++) {
    const row = r.summary.find((s) => s.year === y);
    assert.ok(Math.abs(row.BHP_psia - results[y - 1].BHP_psia) < 2e-4, `year ${y}: ${row.BHP_psia} vs ${results[y - 1].BHP_psia}`);
  }
});

test("geometry: the Python's checks and messages", () => {
  const p = { ...DEFAULT_INPUTS };
  assert.throws(() => configureWellGeometry(p, null, { number: 3, mode: "different", different_input: "adjacent", adjacent_distances_ft: "1000" }), /Enter 2 adjacent distances: Well 1–2, Well 2–3/);
  assert.throws(() => configureWellGeometry(p, null, { number: 3, mode: "different", different_input: "adjacent", adjacent_distances_ft: "1000,-5" }), /finite and positive/);
  assert.throws(() => coordinatesFromDistances("0,1,5\n1,0,1\n5,1,0", 3), /cannot form a horizontal 2-D well layout|inconsistent with a 2-D layout/);
  assert.throws(() => coordinatesFromDistances("0,1\n2,0", 2), /symmetric/);
  const square = coordinatesFromDistances([[0, 1, 1.4142135623730951], [1, 0, 1], [1.4142135623730951, 1, 0]], 3);
  assert.ok(Math.abs(square[1][0] - 1) < 1e-9 && Math.abs(square[1][1]) < 1e-9);
  assert.throws(() => configureWellGeometry(p, null, { number: 2, mode: "constant", spacing_ft: 0.5 }), /wellbores overlap/);
  assert.throws(() => configureWellGeometry({ ...p }, [makeWell({ name: "A", rate_schedule: [{ year: 0, rate: 1 }] }), makeWell({ name: "B" })], { number: 2 }), /two-phase moving-front injection/);
});

test("form: endpoint, observation and limit messages", () => {
  const base = { p: { ...DEFAULT_INPUTS }, wells: [], geometry: { number: 2, spacing_ft: 1000 }, years: "2", report_times: "", observe: "no", period: "", offsets: "", limit: { mode: "none" } };
  assert.throws(() => multiwellCalculation({ ...base, years: "x" }), /Enter a valid project endpoint in years/);
  assert.throws(() => multiwellCalculation({ ...base, observe: "yes", period: "0" }), /Enter a positive observation duration/);
  assert.throws(() => multiwellCalculation({ ...base, report_times: "5" }), /Reporting times must lie between zero and the project injection endpoint/);
  const run = multiwellCalculation({ ...base, limit: { mode: "max_bhp", max_bhp_psia: "3500.5" } });
  assert.deepEqual(run.limitSummary.map((r) => r.overall_status), ["FAIL", "FAIL"]);
});

test("end year (website addition): single phase = the program's rate schedule ending at rate 0", () => {
  const p = { ...DEFAULT_INPUTS, phase_mode: "single", single_phase_fluid: "co2" };
  const a = runMultiwell(p, [makeWell({ name: "A", end_year: 6 }), makeWell({ name: "B", x_ft: 1000 })], 10, "");
  const b = runMultiwell(p, [makeWell({ name: "A", rate_schedule: [{ year: 0, rate: 150 }, { year: 6, rate: 0 }] }), makeWell({ name: "B", x_ft: 1000 })], 10, "");
  for (const y of [3, 6, 7, 10]) {
    const ra = a.summary.filter((r) => r.year === y), rb = b.summary.filter((r) => r.year === y);
    ra.forEach((r, i) => assert.ok(Math.abs(r.BHP_psia - rb[i].BHP_psia) < 1e-9, `year ${y} ${r.well}`));
  }
});

test("end year (website addition): at the endpoint it is exactly the program", () => {
  const p = { ...DEFAULT_INPUTS };
  const a = runMultiwell(p, [makeWell({ name: "A", end_year: 8 }), makeWell({ name: "B", x_ft: 1000, end_year: 8 })], 8, "");
  const b = runMultiwell(p, [makeWell({ name: "A" }), makeWell({ name: "B", x_ft: 1000 })], 8, "");
  a.summary.forEach((r, i) => assert.equal(r.BHP_psia, b.summary[i].BHP_psia));
});

test("end year (website addition): a two-phase well stopped early follows the program's shut-in falloff", async () => {
  const { runModel, calculateObservation } = await import("../lib/bhp.ts");
  const p = { ...DEFAULT_INPUTS };
  // B is so far away that it does not affect A
  const r = runMultiwell(p, [makeWell({ name: "A", end_year: 10 }), makeWell({ name: "B", x_ft: 1e7 })], 20, "11,15,20");
  const single = { ...p, observation_period_years: 10, observation_years: "1,5,10" };
  const { results } = runModel(single, 10);
  const obs = calculateObservation(results[9], single, false);
  for (const [y, k] of [[11, 0], [15, 1], [20, 2]]) {
    const row = r.summary.find((s) => s.year === y && s.well === "A");
    assert.ok(Math.abs(row.BHP_psia - obs.rows[k].BHP_psia) < 5e-3, `year ${y}: ${row.BHP_psia} vs ${obs.rows[k].BHP_psia}`);
    assert.equal(row.current_surface_rate, 0);
  }
  assert.throws(() => runMultiwell(p, [makeWell({ name: "A", start_year: 5, end_year: 5 }), makeWell({ name: "B", x_ft: 1000 })], 10, ""), /end year must be after the start year/);
});

test("CO2 dissolution: one well in the multiwell solve equals the single-well program, and two wells run", async () => {
  const { runModel } = await import("../lib/bhp.ts");
  const p = { ...DEFAULT_INPUTS, include_dissolution: true };
  const r = runMultiwell(p, [makeWell({ name: "Well 1" })], 6, "", { detail: false });
  const { results } = runModel(p, 6);
  for (let y = 1; y <= 6; y++) {
    const row = r.summary.find((s) => s.year === y);
    assert.ok(Math.abs(row.BHP_psia - results[y - 1].BHP_psia) < 2e-4, `year ${y}: ${row.BHP_psia} vs ${results[y - 1].BHP_psia}`);
  }
  const two = runMultiwell(p, [makeWell({ name: "A" }), makeWell({ name: "B", x_ft: 1000 })], 5, "", { detail: false });
  const off = runMultiwell({ ...DEFAULT_INPUTS }, [makeWell({ name: "A" }), makeWell({ name: "B", x_ft: 1000 })], 5, "", { detail: false });
  const last = (res) => res.summary.filter((s) => s.year === 5);
  last(two).forEach((row, i) => assert.ok(row.BHP_psia < last(off)[i].BHP_psia && row.interference_psi > 0));
});
