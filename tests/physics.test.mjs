import test from "node:test";
import assert from "node:assert/strict";
import { expint1, wellContribution, totalBuildup, arrivalTime, limits, consts, volumeRate } from "../lib/physics.ts";

const close = (a, b, tol = 1e-5) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);

const aq = { permMd: 100, thicknessM: 50, porosity: 0.2, compressibilityPerMPa: 4.5e-4, viscosityMPas: 0.5,
  co2DensityKgM3: 700, wellboreRadiusM: 0.1, depthM: 2000, hydroGradientMPaPerM: 0.0105, fracGradientMPaPerM: 0.0165, safetyFactor: 0.9 };
const none = { type: "none", axis: "x", positionM: 0 };
const W = (id, x, y, r = 1, s = 0, e = 20) => ({ id, name: id, x, y, rateMtpa: r, startYr: s, endYr: e });

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
