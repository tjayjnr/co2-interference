// The website's pressure field (lib/mwfield.ts): maps and curves come from the multiwell program (lib/multiwell.ts).
import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_INPUTS, runModel } from "../lib/bhp.ts";
import { calculateMultiwellObservation, makeWell, runMultiwell } from "../lib/multiwell.ts";
import { MultiwellField, MPA_PER_PSI } from "../lib/mwfield.ts";

const FT = 0.3048;
const none = { type: "none", axis: "x", positionM: 5000 };
const pageWell = (w, i) => ({ id: `w${i}`, name: w.name, x: w.x_ft * FT, y: w.y_ft * FT, rate: w.rate, startYr: w.start_year, endYr: 10, skin: w.skin });

function setup(wells, p = { ...DEFAULT_INPUTS }, years = 10, boundary = none, images = null) {
  const r = runMultiwell(p, wells, years, "", { images });
  const page = wells.map(pageWell);
  return { r, page, f: new MultiwellField(r, page, boundary, years + (p.observation_period_years || 0), []) };
}

test("one well: the field at the wellbore equals the single-well program", () => {
  const { f, page } = setup([makeWell({ name: "W", skin: 1.2 })]);
  const { results } = runModel({ ...DEFAULT_INPUTS, skin: 1.2 }, 10);
  for (const y of [1, 4, 10]) {
    const bhp = DEFAULT_INPUTS.initial_pressure_psia + f.wellbore(page[0], y) / MPA_PER_PSI;
    assert.ok(Math.abs(bhp - results[y - 1].BHP_psia) < 2e-4, `year ${y}: ${bhp} vs ${results[y - 1].BHP_psia}`);
  }
});

test("several wells: BHP, own response, skin and interference equal the program's rows", () => {
  const wells = [makeWell({ name: "A" }), makeWell({ name: "B", x_ft: 1200, rate: 200, start_year: 2, skin: 2 }), makeWell({ name: "C", x_ft: 600, y_ft: 900, rate: 0 })];
  const { r, f, page } = setup(wells);
  for (const row of r.summary.filter((s) => s.year === 6)) {
    const k = wells.findIndex((w) => w.name === row.well);
    const bhp = DEFAULT_INPUTS.initial_pressure_psia + f.wellbore(page[k], 6) / MPA_PER_PSI;
    assert.ok(Math.abs(bhp - row.BHP_psia) < 1e-6, `${row.well}: ${bhp} vs ${row.BHP_psia}`);
    assert.ok(Math.abs(f.total(page[k].x, page[k].y, 6, page[k].id) / MPA_PER_PSI - row.interference_psi) < 1e-6);
    assert.ok(Math.abs(f.skin(page[k], 6) / MPA_PER_PSI - row.own_skin_psi) < 1e-9);
  }
  const m = f.matrix(10);
  r.end_snapshot.matrix.forEach((row, recv) => row.forEach((v, src) => {
    const got = m[src][recv] / MPA_PER_PSI - (src === recv ? r.end_snapshot.skin[src] : 0);
    assert.ok(Math.abs(got - v) < 1e-6, `matrix ${src}->${recv}`);
  }));
});

test("after the endpoint the field follows the program's falloff", () => {
  const p = { ...DEFAULT_INPUTS, observation_period_years: 5, observation_years: "0,1,5" };
  const wells = [makeWell({ name: "A", skin: 1 }), makeWell({ name: "B", x_ft: 1000 })];
  const r = runMultiwell(p, wells, 8, "");
  const obs = calculateMultiwellObservation(r, true);
  const page = wells.map(pageWell);
  const f = new MultiwellField(r, page, none, 13, [0, 1, 5]);
  for (const row of obs.rows.filter((x) => x.years_after_shut_in > 0)) {
    const k = wells.findIndex((w) => w.name === row.well);
    const bhp = p.initial_pressure_psia + f.wellbore(page[k], 8 + row.years_after_shut_in) / MPA_PER_PSI;
    assert.ok(Math.abs(bhp - row.BHP_psia) < 2e-3, `${row.well} +${row.years_after_shut_in}: ${bhp} vs ${row.BHP_psia}`);
  }
});

test("boundaries: a sealing fault raises and a constant-pressure edge lowers the pressure", () => {
  const wells = [makeWell({ name: "A" })];
  const page = wells.map(pageWell);
  const img = (sign) => [[{ d: [2 * 300 / FT], sign }]]; // image 2 x 300 m away
  const base = setup(wells).f.wellbore(page[0], 10);
  const sealed = new MultiwellField(runMultiwell({ ...DEFAULT_INPUTS }, wells, 10, "", { images: img(1) }), page, { type: "noflow", axis: "x", positionM: 300 }, 10).wellbore(page[0], 10);
  const open = new MultiwellField(runMultiwell({ ...DEFAULT_INPUTS }, wells, 10, "", { images: img(-1) }), page, { type: "constant", axis: "x", positionM: 300 }, 10).wellbore(page[0], 10);
  assert.ok(sealed > base && base > open, `${sealed} > ${base} > ${open}`);
});
