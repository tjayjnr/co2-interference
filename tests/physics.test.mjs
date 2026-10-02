import test from "node:test";
import assert from "node:assert/strict";
import { expint1, wellContribution, totalBuildup, arrivalTime, limits, consts, volumeRate } from "../lib/physics.ts";

const close = (a, b, tol = 1e-5) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);

const aq = { permMd: 100, thicknessM: 50, porosity: 0.2, compressibilityPerMPa: 4.5e-4, viscosityMPas: 0.5,
  co2DensityKgM3: 700, wellboreRadiusM: 0.1, depthM: 2000, hydroGradientMPaPerM: 0.0105, fracGradientMPaPerM: 0.0165, safetyFactor: 0.9 };
const none = { type: "none", axis: "x", positionM: 0 };
const W = (id, x, y, r = 1, s = 0, e = 20) => ({ id, name: id, x, y, rateMtpa: r, startYr: s, endYr: e, skin: 0 });

test("E1 matches reference values", () => {
  close(expint1(0.01), 4.037930);
  close(expint1(0.1), 1.822924);
  close(expint1(1), 0.2193839);
  close(expint1(2), 0.04890051);
  close(expint1(5), 0.001148296);
  close(expint1(20), 9.835525e-11, 1e-4);
});

test("Theis value matches hand calculation", () => {
  const c = consts(aq);
  const q = volumeRate(W("a", 0, 0), aq);
  const r = 1000, t = 5;
  const x = r * r / (4 * c.eta * t * 365.25 * 86400);
  const expected = q * c.mobilityTerm * expint1(x) / 1e6;
  close(wellContribution(W("a", 0, 0), r, 0, t, aq, none), expected, 1e-12);
  assert.ok(expected > 0);
});

test("superposition is additive and symmetric", () => {
  const A = W("a", 0, 0), B = W("b", 3000, 0);
  const sum = wellContribution(A, 1500, 800, 8, aq, none) + wellContribution(B, 1500, 800, 8, aq, none);
  close(totalBuildup([A, B], 1500, 800, 8, aq, none), sum, 1e-12);
  close(wellContribution(A, 3000, 0, 8, aq, none), wellContribution(B, 0, 0, 8, aq, none), 1e-12);
});

test("shut-in recovery: pressure falls after end of injection", () => {
  const A = W("a", 0, 0, 1, 0, 10);
  const atEnd = wellContribution(A, 500, 0, 10, aq, none);
  const later = wellContribution(A, 500, 0, 40, aq, none);
  assert.ok(later < atEnd * 0.2, `${later} vs ${atEnd}`);
  assert.ok(later > 0);
});

test("no-flow boundary raises pressure, constant-pressure lowers it", () => {
  const A = W("a", 0, 0);
  const base = wellContribution(A, 500, 0, 10, aq, none);
  const nf = wellContribution(A, 500, 0, 10, aq, { type: "noflow", axis: "x", positionM: 2000 });
  const cp = wellContribution(A, 500, 0, 10, aq, { type: "constant", axis: "x", positionM: 2000 });
  assert.ok(nf > base && cp < base);
  // symmetry: observation point on the boundary sees double the image-less value under no-flow
  close(wellContribution(A, 2000, 0, 10, aq, { type: "noflow", axis: "x", positionM: 2000 }),
        2 * wellContribution(A, 2000, 0, 10, aq, none), 1e-12);
  close(wellContribution(A, 2000, 0, 10, aq, { type: "constant", axis: "x", positionM: 2000 }), 0, 1e-12);
});

test("arrival time is consistent with the buildup curve", () => {
  const A = W("a", 0, 0, 2, 0, 30);
  const t = arrivalTime(A, 4000, 0, 0.05, 30, aq, none);
  assert.ok(t !== null);
  close(wellContribution(A, 4000, 0, t, aq, none), 0.05, 1e-6);
  assert.equal(arrivalTime(A, 200000, 0, 0.05, 30, aq, none), null);
});

test("limits", () => {
  const l = limits(aq);
  close(l.initialMPa, 21); close(l.fractureMPa, 33); close(l.maxBuildupMPa, 0.9 * 33 - 21);
});

import { skinBuildup, wellboreBuildup, interferenceMatrix } from "../lib/physics.ts";

test("skin adds q*mu*s/(2*pi*k*h) only at the injector and only while injecting", () => {
  const A = { ...W("a", 0, 0, 1, 0, 10), skin: 5 };
  const c = consts(aq);
  const expected = (volumeRate(A, aq) * aq.viscosityMPas * 1e-3 * 5) / (2 * Math.PI * aq.permMd * 9.869233e-16 * aq.thicknessM) / 1e6;
  close(skinBuildup(A, 5, aq, c), expected, 1e-10);
  assert.equal(skinBuildup(A, 11, aq, c), 0);
  close(wellboreBuildup([A], A, 5, aq, none, c), totalBuildup([A], 0, 0, 5, aq, none, c) + expected, 1e-10);
  const B = { ...W("b", 2000, 0), skin: 0 };
  const m = interferenceMatrix([A, B], 5, aq, none);
  close(m[0][1], wellContribution(A, 2000, 0, 5, aq, none), 1e-12);
});

test("boundary ordering at the wellbore: no-flow > infinite > constant", () => {
  const A = { ...W("a", 0, 0), skin: 2 }, c = consts(aq);
  const f = (type) => wellboreBuildup([A], A, 15, aq, { type, axis: "x", positionM: 1500 }, c);
  assert.ok(f("noflow") > f("none") && f("none") > f("constant"));
});

import { hawkinsSkin } from "../lib/physics.ts";

test("Hawkins skin", () => {
  close(hawkinsSkin(150, 50, 1.5, 0.1), 2 * Math.log(15));
  assert.equal(hawkinsSkin(100, 100, 5, 0.1), 0);
  assert.ok(hawkinsSkin(100, 400, 5, 0.1) < 0);
  assert.equal(hawkinsSkin(100, 50, 0.05, 0.1), 0); // zone smaller than wellbore: ignored
});

import { UNITS, PRESETS, findUnit } from "../lib/units.ts";

test("unit conversions", () => {
  close(1 / findUnit("length", "ft").f, 3.280840, 1e-6);          // 1 m in ft
  close(1 / findUnit("pressure", "psi").f, 145.0377, 1e-5);      // 1 MPa in psi
  close(1 / findUnit("gradient", "psi/ft").f, 44.2065, 1e-4);    // 1 MPa/m in psi/ft
  close(0.0105 / findUnit("gradient", "psi/ft").f, 0.4643, 1e-3);// 0.0105 MPa/m ~ 0.464 psi/ft
  close(1 / findUnit("rate", "t/day").f, 2737.85, 1e-5);         // 1 Mt/yr in t/day
  close(4.5e-4 / findUnit("compress", "1/psi").f, 3.1026e-6, 1e-3);
  for (const k of Object.keys(PRESETS.Field)) assert.ok(UNITS[k].some((u) => u.label === PRESETS.Field[k]), k);
  for (const k of Object.keys(PRESETS.SI)) assert.equal(findUnit(k, PRESETS.SI[k]).f, 1);
});
