// Helpers and supporting modules (the pressure model is tested in bhp.test.mjs and field.test.mjs).
import test from "node:test";
import assert from "node:assert/strict";
import { expint1, limits, rateSteps, rateAt, injectedRateYears, timeGrid, sourcesFor } from "../lib/physics.ts";
import { DEFAULT_INPUTS, coreyFrontQuantities, gasProperties, prState, P_SC_PSIA, T_SC_F } from "../lib/bhp.ts";
import { UNITS, PRESETS, findUnit, toCanon, fromCanon, CO2_T_PER_MSCF } from "../lib/units.ts";
import { project, unproject, centroid } from "../lib/geo.ts";
import { parseWellsCsv, wellsToCsv } from "../lib/csv.ts";
import { makeSatModel, satProfile, plumeRadius, totalSaturation } from "../lib/saturation.ts";
import { streamPaths } from "../lib/streamlines.ts";

const close = (a, b, tol = 1e-5) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const W = (id, x, y, r = 150, s = 0, e = 20) => ({ id, name: id, x, y, rate: r, startYr: s, endYr: e, skin: 0 });

test("E1 matches reference values", () => {
  close(expint1(0.01), 4.037930);
  close(expint1(0.1), 1.822924);
  close(expint1(1), 0.2193839);
  close(expint1(5), 0.001148296);
  close(expint1(20), 9.835525e-11, 1e-4);
});

test("limits: the program's pressure check (not assessed, maximum BHP, fraction of fracture pressure)", () => {
  const base = { initialMPa: 24, maxBhpMPa: 30, fractureMPa: 40, fraction: 0.9 };
  assert.deepEqual(limits({ ...base, mode: "none" }), { initialMPa: 24, allowableMPa: null, maxBuildupMPa: Infinity });
  assert.equal(limits({ ...base, mode: "max_bhp" }).maxBuildupMPa, 6);
  const f = limits({ ...base, mode: "fracture_fraction" });
  assert.ok(Math.abs(f.allowableMPa - 36) < 1e-12 && Math.abs(f.maxBuildupMPa - 12) < 1e-12);
});

test("image wells: same sign for no-flow, opposite for constant pressure", () => {
  const w = { x: 100, y: 50 };
  assert.equal(sourcesFor(w, { type: "none", axis: "x", positionM: 0 }).length, 1);
  const nf = sourcesFor(w, { type: "noflow", axis: "x", positionM: 1000 });
  assert.deepEqual([nf[1].x, nf[1].y, nf[1].sign], [1900, 50, 1]);
  const cp = sourcesFor(w, { type: "constant", axis: "y", positionM: -50 });
  assert.deepEqual([cp[1].x, cp[1].y, cp[1].sign], [100, -150, -1]);
});

test("unit conversions", () => {
  close(1 / findUnit("length", "ft").f, 3.280840, 1e-6);
  close(1 / findUnit("pressure", "psi").f, 145.0377, 1e-5);
  close(fromCanon(findUnit("temp", "°F"), toCanon(findUnit("temp", "°C"), 100)), 212, 1e-12);
  close(fromCanon(findUnit("density", "lb/ft³"), 1000), 62.42796, 1e-6);
  close(CO2_T_PER_MSCF, 0.0527, 0.01);
  close(toCanon(findUnit("gasrate", "Mt/yr"), 1), 1e6 / (365.25 * CO2_T_PER_MSCF), 1e-12);
  for (const k of Object.keys(PRESETS.Field)) assert.ok(UNITS[k].some((u) => u.label === PRESETS.Field[k]), k);
  for (const k of Object.keys(PRESETS.SI)) assert.ok(UNITS[k].some((u) => u.label === PRESETS.SI[k]), k);
});

test("geographic projection: round trip and centroid", () => {
  const o = { lat: 58.0, lon: 2.0 };
  close(project(59, 2, o.lat, o.lon).y, 111195, 1e-3);
  const xy = project(58.3, 2.4, o.lat, o.lon), back = unproject(xy.x, xy.y, o.lat, o.lon);
  close(back.lat, 58.3, 1e-9); close(back.lon, 2.4, 1e-9);
  assert.deepEqual(centroid([{ lat: 10, lon: 20 }, { lat: 12, lon: 24 }]), { lat: 11, lon: 22 });
});

test("wells CSV: surface rate, blank skin and rate changes", () => {
  const local = parseWellsCsv("name,x_m,y_m,rate,start_yr,end_yr,skin,changes\nA,0,0,150,0,25,,8:100|15:50\nB,3000,0,150,0,25,4.5");
  assert.equal(local.wells[0].rate, 150);
  assert.equal(local.wells[0].skinText, "");
  assert.deepEqual(local.wells[0].changes, [{ yr: 8, rate: 100 }, { yr: 15, rate: 50 }]);
  assert.ok(wellsToCsv(local.wells, false).includes("8:100|15:50"));
  const geo = parseWellsCsv("name,lon_deg,lat_deg,rate,start_yr,end_yr\nA,2.1,58.2,150,0,25");
  assert.equal(geo.geo, true);
  assert.throws(() => parseWellsCsv("name,lon_deg,lat_deg,rate,start_yr,end_yr\nA,2.1,98.2,150,0,25"));
});

test("CO2 saturation: profile conserves volume and its front matches the program's Corey front", () => {
  const m = makeSatModel({ swr: 0.2, krgMax: 0.4, nw: 4, ng: 2, muCo2MPas: 0.06 }, 0.5);
  let integral = 0; const n = 200000, dx = m.xiFront / n;
  for (let i = 0; i < n; i++) integral += satProfile(m, (i + 0.5) * dx) * dx;
  assert.ok(Math.abs(integral - 1) < 0.01);
  const p = DEFAULT_INPUTS;
  // CO2 viscosity is calculated in the background (Fenghour, live PR density), not entered
  const mu = gasProperties(p.initial_pressure_psia, p.temperature_F, prState(P_SC_PSIA, T_SC_F).Z).mu_gas_cP;
  for (const k of [3, 2]) {
    const s = makeSatModel({ swr: p.Swr, krgMax: p.krg_endpoint, krwMax: p.krw_endpoint, nw: k, ng: k, muCo2MPas: mu }, p.mu_water_cP);
    const f = coreyFrontQuantities((p.krg_endpoint * p.mu_water_cP) / (p.krw_endpoint * mu), p.Swr, k, k);
    close(s.xiFront, f.gas_front_factor, 2e-3);
    close(s.sf, f.Sg_front, 2e-3);
  }
  const g = { porosity: 0.2, thicknessM: 50, rwM: 0.1 };
  close(plumeRadius(2e6, g, m) / plumeRadius(1e6, g, m), Math.SQRT2, 1e-9);
  assert.ok(totalSaturation([W("a", 0, 0), W("b", 0, 0)], [1e6, 1e6], 0, 0, g, m) <= m.smax + 1e-12);
  // overlapping plumes: the higher of the two saturations, not their sum
  const two = [W("a", 0, 0), W("b", 30, 0)], one = [W("a", 0, 0)];
  const at = (ws, x) => totalSaturation(ws, ws.map(() => 1e6), x, 0, g, m);
  for (const x of [5, 15, 25]) close(at(two, x), Math.max(at(one, x), at([W("b", 30, 0)], x)), 1e-12);
  assert.ok(at(one, 1) > at(one, 20), "saturation falls outward from the well");
});

test("rate schedules: steps, rate in force and cumulative injection", () => {
  const A = { ...W("a", 0, 0, 1, 2, 12), changes: [{ yr: 6, rate: 0.5 }, { yr: 9, rate: 2 }] };
  assert.deepEqual(rateSteps(A).map((s) => [s.t, s.q]), [[2, 1], [6, 0.5], [9, 2], [12, 0]]);
  assert.equal(rateAt(A, 4), 1); assert.equal(rateAt(A, 7), 0.5); assert.equal(rateAt(A, 13), 0);
  close(injectedRateYears(A, 12), 4 + 1.5 + 6);
  assert.ok(timeGrid(40, [A]).includes(6));
});

test("streamlines run away from a source and stay inside the grid", () => {
  const n = 81, c = 40, v = new Float64Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) v[j * n + i] = -Math.log(Math.hypot(i - c, j - c) + 1);
  const paths = streamPaths(v, n, n, [{ i: c + 3, j: c }]);
  assert.ok(paths[0].length > 40);
  for (const q of paths[0]) assert.ok(q.i >= 0 && q.i <= n - 1 && q.j >= 0 && q.j <= n - 1);
});

test("time grid starts at project time zero", () => {
  const g = timeGrid(30, []);
  assert.equal(g[0], 0);
  assert.ok(g[1] > 0 && g[1] < 0.01 && g[g.length - 1] === 30);
});
