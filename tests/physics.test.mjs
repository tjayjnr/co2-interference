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

import { project, unproject, centroid } from "../lib/geo.ts";
import { parseWellsCsv, wellsToCsv } from "../lib/csv.ts";

test("geographic projection: distances and round trip", () => {
  const o = { lat: 58.0, lon: 2.0 };
  const north = project(59, 2, o.lat, o.lon);
  close(north.y, 111195, 1e-3); close(north.x, 0, 1e-6);
  const east = project(58, 3, o.lat, o.lon);
  close(east.x, 111195 * Math.cos(58 * Math.PI / 180), 2e-3);
  for (const [lat, lon] of [[58.3, 2.4], [57.7, 1.5], [58.05, 2.02]]) {
    const xy = project(lat, lon, o.lat, o.lon);
    const back = unproject(xy.x, xy.y, o.lat, o.lon);
    close(back.lat, lat, 1e-9); close(back.lon, lon, 1e-9);
  }
  // distance between two nearby points agrees with the haversine distance to well under 0.5 %
  const a = project(58.1, 2.1, o.lat, o.lon), b = project(58.3, 2.4, o.lat, o.lon);
  const R = 6371008.8, r = Math.PI / 180;
  const h = 2 * R * Math.asin(Math.sqrt(Math.sin((0.2 * r) / 2) ** 2 + Math.cos(58.1 * r) * Math.cos(58.3 * r) * Math.sin((0.3 * r) / 2) ** 2));
  assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) / h - 1) < 0.005);
  assert.deepEqual(centroid([{ lat: 10, lon: 20 }, { lat: 12, lon: 24 }]), { lat: 11, lon: 22 });
});

test("wells CSV: local, geographic and blank skin", () => {
  const local = parseWellsCsv("name,x_m,y_m,rate_Mtpa,start_yr,end_yr,skin\nA,0,0,1,0,25,\nB,3000,0,1,0,25,4.5");
  assert.equal(local.geo, false); assert.equal(local.wells[0].skinText, ""); assert.equal(local.wells[1].skinText, "4.5");
  const geo = parseWellsCsv("name,lon_deg,lat_deg,rate_Mtpa,start_yr,end_yr\nA,2.1,58.2,1,0,25");
  assert.equal(geo.geo, true); assert.equal(geo.wells[0].lon, 2.1); assert.equal(geo.wells[0].lat, 58.2); assert.equal(geo.wells[0].skinText, "");
  assert.throws(() => parseWellsCsv("name,lon_deg,lat_deg,rate_Mtpa,start_yr,end_yr\nA,2.1,98.2,1,0,25"));
  assert.ok(wellsToCsv(geo.wells, true).startsWith("name,lon_deg,lat_deg"));
});

import { makeSatModel, satProfile, plumeRadius, totalSaturation } from "../lib/saturation.ts";

test("CO2 saturation: Buckley-Leverett profile conserves injected volume", () => {
  const m = makeSatModel({ swr: 0.2, krgMax: 0.4, nw: 4, ng: 2, muCo2MPas: 0.06 }, 0.5);
  assert.ok(m.sf > 0 && m.sf < m.smax && m.xiFront > 0);
  assert.equal(satProfile(m, m.xiFront * 1.0001), 0);
  close(satProfile(m, 1e-12), m.smax, 1e-9);
  // integral of Sg over dimensionless area xi equals 1 (all injected volume sits in the plume)
  let integral = 0; const n = 200000, dx = m.xiFront / n;
  for (let i = 0; i < n; i++) integral += satProfile(m, (i + 0.5) * dx) * dx;
  assert.ok(Math.abs(integral - 1) < 0.01, `integral ${integral}`);
  // monotone: saturation decreases with distance
  let prev = Infinity;
  for (let i = 1; i <= 200; i++) { const s = satProfile(m, (i / 200) * m.xiFront); assert.ok(s <= prev + 1e-12); prev = s; }
});

test("CO2 plume radius grows with sqrt(time), stops at shut-in, and overlap is capped", () => {
  const m = makeSatModel({ swr: 0.2, krgMax: 0.4, nw: 4, ng: 2, muCo2MPas: 0.06 }, 0.5);
  const A = { ...W("a", 0, 0, 1, 0, 10), skin: 0 };
  const r5 = plumeRadius(A, 5, aq, m), r10 = plumeRadius(A, 10, aq, m);
  close(r10 / r5, Math.SQRT2, 1e-9);
  assert.equal(plumeRadius(A, 40, aq, m), r10);
  // volume balance: radius from a uniform-saturation plume would be sqrt(Q t / (pi phi h Sg)) -- front must lie beyond it
  const q = 1e9 / 700 / (365.25 * 86400), uniform = Math.sqrt((q * 5 * 365.25 * 86400) / (Math.PI * 0.2 * 50 * m.smax));
  assert.ok(r5 > uniform * 0.99 && r5 < uniform * 3);
  const B = { ...W("b", 0, 0, 1, 0, 10), skin: 0 };
  assert.ok(totalSaturation([A, B], 0, 0, 5, aq, m) <= m.smax + 1e-12);
});

import { rateSteps, rateAt, injectedMt, rateToM3s, timeGrid } from "../lib/physics.ts";
import { waterSaturationPressureMPa, waterActivity, equilibriumWaterContent, evaporationCoefficient, dryRadius } from "../lib/dryzone.ts";

test("rate schedules: single-period case unchanged, steps and cumulative mass", () => {
  const A = { ...W("a", 0, 0, 1, 2, 12), skin: 0, changes: [{ yr: 6, rateMtpa: 0.5 }, { yr: 9, rateMtpa: 2 }] };
  assert.deepEqual(rateSteps(A).map((s) => [s.t, s.q]), [[2, 1], [6, 0.5], [9, 2], [12, 0]]);
  assert.equal(rateAt(A, 1), 0); assert.equal(rateAt(A, 4), 1); assert.equal(rateAt(A, 7), 0.5); assert.equal(rateAt(A, 12), 2); assert.equal(rateAt(A, 13), 0);
  close(injectedMt(A, 12), 4 * 1 + 3 * 0.5 + 3 * 2); close(injectedMt(A, 100), 11.5); close(injectedMt(A, 4), 2);
  // a change that restates the same rate must not alter the pressure
  const B = { ...A, changes: [{ yr: 6, rateMtpa: 1 }], endYr: 12 }, C = { ...A, changes: [] };
  close(wellContribution(B, 800, 0, 10, aq, none), wellContribution(C, 800, 0, 10, aq, none), 1e-12);
  assert.ok(timeGrid(40, [A]).includes(6) && timeGrid(40, [A]).includes(9));
});

test("variable rate: rate drop partly offsets the buildup, pressure returns to zero after shut-in", () => {
  const A = { ...W("a", 0, 0, 1, 0, 20), skin: 0, changes: [{ yr: 10, rateMtpa: 0.4 }] };
  const before = wellContribution(A, 500, 0, 9.999, aq, none), after = wellContribution(A, 500, 0, 12, aq, none);
  assert.ok(after < before);
  const late = wellContribution(A, 500, 0, 400, aq, none);
  assert.ok(late > 0 && late < 0.02 * before);
  const s = { ...A, skin: 4 };
  close(skinBuildup(s, 5, aq), 2.5 * skinBuildup(s, 15, aq), 1e-9);
});

test("derivation validation: field-unit single-well and two-well superposition agree with the SI implementation", () => {
  // field units: k=76 md, mu=1 cp, B=1.08, h=20 ft, phi=0.2, ct=1e-5 1/psi, rw=0.25 ft
  const k = 76, mu = 1, B = 1.08, h = 20, phi = 0.2, ct = 1e-5, rw = 0.25;
  const pD = (rD, tD) => 0.5 * expint1(rD * rD / (4 * tD));
  const tD = (t) => 0.0002637 * k * t / (phi * mu * ct * rw * rw);
  const fieldDp = (qB, r, t, s = 0) => 141.2 * mu / (k * h) * qB * (pD(r / rw, tD(t)) + s);
  const dp40 = fieldDp(100 * B, rw, 40);
  assert.ok(Math.abs(dp40 - 82.7) < 1.0, `field dp ${dp40}`);
  const FT = 0.3048, PSI = 0.006894757, BBL = 0.158987294928;
  const si = { permMd: k, thicknessM: h * FT, porosity: phi, compressibilityPerMPa: ct / PSI, viscosityMPas: mu, co2DensityKgM3: 1000, wellboreRadiusM: rw * FT,
    depthM: 2000, hydroGradientMPaPerM: 0.0105, fracGradientMPaPerM: 0.0165, safetyFactor: 0.9 };
  const m3s = (rbd) => rbd * BBL / 86400;
  const mtpa = (rbd) => m3s(rbd) * 1000 * 365.25 * 86400 / 1e9;
  const yr = (hr) => hr / (365.25 * 24);
  const W1 = { id: "1", name: "1", x: 0, y: 0, rateMtpa: mtpa(100 * B), startYr: 0, endYr: yr(1e9), skin: 0, changes: [] };
  close(wellContribution(W1, 0, 0, yr(40), si, none) / PSI, dp40, 2e-3);
  const W2a = { id: "a", name: "a", x: 0, y: 0, rateMtpa: mtpa(100 * B), startYr: 0, endYr: yr(1e9), skin: 5, changes: [{ yr: yr(10), rateMtpa: mtpa(50 * B) }] };
  const W2b = { id: "b", name: "b", x: 100 * FT, y: 0, rateMtpa: mtpa(25 * B), startYr: 0, endYr: yr(1e9), skin: 1.7, changes: [{ yr: yr(8), rateMtpa: mtpa(100 * B) }] };
  const t = 11;
  const own1 = fieldDp(100 * B, rw, t) + fieldDp((50 - 100) * B, rw, t - 10) + 141.2 * mu / (k * h) * 50 * B * 5;
  const own2 = fieldDp(25 * B, rw, t) + fieldDp((100 - 25) * B, rw, t - 8) + 141.2 * mu / (k * h) * 100 * B * 1.7;
  const cross12 = fieldDp(100 * B, 100, t) + fieldDp(-50 * B, 100, t - 10);
  const cross21 = fieldDp(25 * B, 100, t) + fieldDp(75 * B, 100, t - 8);
  const p1 = totalBuildup([W2a, W2b], W2a.x, W2a.y, yr(t), si, none) + skinBuildup(W2a, yr(t), si);
  const p2 = totalBuildup([W2a, W2b], W2b.x, W2b.y, yr(t), si, none) + skinBuildup(W2b, yr(t), si);
  close(p1 / PSI, own1 + cross21, 2e-3);
  close(p2 / PSI, own2 + cross12, 2e-3);
  assert.ok(rateToM3s(1, si) > 0);
});

test("derivation validation: closed-form gas front (beta_g) matches the numerical Buckley-Leverett model", () => {
  const swr = 0.56, M = (0.33 * 0.30) / (1 * 0.064);
  close(M, 1.5469, 1e-4);
  const beta = (1 + Math.sqrt(1 + M)) / (2 * (1 - swr));
  close(beta, 2.950, 2e-3);
  const m = makeSatModel({ swr, krgMax: 0.33, nw: 2, ng: 2, muCo2MPas: 0.064 }, 0.30);
  assert.ok(Math.abs(m.xiFront / beta - 1) < 5e-3, `numerical ${m.xiFront} vs closed form ${beta}`);
  const V = 1.0e6 * 0.0025 * 7300;
  const rg = Math.sqrt((beta * V) / (Math.PI * 0.15 * 40));
  assert.ok(Math.abs(rg - 1690) < 5, `rg ${rg}`);
  assert.ok(Math.abs(rg / 1701 - 1) < 0.01);
  const aq2 = { ...aq, porosity: 0.15, thicknessM: 40, co2DensityKgM3: 700, wellboreRadiusM: 0.1 };
  const mass = (V * 700) / 1e9;
  const wY = 7300 / 365.25;
  const Wf = { id: "f", name: "f", x: 0, y: 0, rateMtpa: mass / wY, startYr: 0, endYr: 100, skin: 0 };
  assert.ok(Math.abs(plumeRadius(Wf, wY, aq2, m) / rg - 1) < 5e-3);
});

test("dry zone: IAPWS saturation pressure, water activity and evaporation front", () => {
  close(waterSaturationPressureMPa(373.15), 0.101325, 5e-3);
  close(waterSaturationPressureMPa(333.15), 0.019946, 5e-3);
  close(waterActivity(0), 1, 1e-12);
  assert.ok(waterActivity(0.1) < 0.95 && waterActivity(0.1) > 0.9);
  const d = { tempC: 60, salinity: 0.1, brineDensityKgM3: 1050, phiW: 1 };
  const ceq = equilibriumWaterContent(21, d);
  assert.ok(ceq > 1e-4 && ceq < 2e-3, `ceq ${ceq}`);
  assert.ok(equilibriumWaterContent(21, { ...d, phiW: 0.3 }) > 2.5 * ceq);
  const alpha = evaporationCoefficient(21, aq, d, 0.2);
  assert.ok(alpha > 0 && alpha < 0.05);
  const Wd = { ...W("d", 0, 0, 1, 0, 20), skin: 0 };
  const r10 = dryRadius(Wd, 10, aq, d, 0.2, 21), r20 = dryRadius(Wd, 20, aq, d, 0.2, 21);
  assert.ok(r10 > aq.wellboreRadiusM && r20 > r10);
  assert.ok(r20 < 0.5 * plumeRadius(Wd, 20, aq, makeSatModel({ swr: 0.2, krgMax: 0.4, nw: 4, ng: 2, muCo2MPas: 0.06 }, 0.5)));
  close((r20 ** 2 - aq.wellboreRadiusM ** 2) / (r10 ** 2 - aq.wellboreRadiusM ** 2), 2, 1e-9);
});

test("wells CSV: rate changes round trip", () => {
  const text = "name,x_m,y_m,rate_Mtpa,start_yr,end_yr,skin,changes\nA,0,0,1,0,25,,8:0.5|15:0.2";
  const r = parseWellsCsv(text);
  assert.deepEqual(r.wells[0].changes, [{ yr: 8, rateMtpa: 0.5 }, { yr: 15, rateMtpa: 0.2 }]);
  assert.ok(wellsToCsv(r.wells, false).includes("8:0.5|15:0.2"));
  assert.deepEqual(parseWellsCsv("A,0,0,1,0,25").wells[0].changes, []);
  assert.throws(() => parseWellsCsv("A,0,0,1,0,25,,8-0.5"));
});

import { threeZoneKernel } from "../lib/physics.ts";
import { buildZones } from "../lib/threezone.ts";

const satIn = { swr: 0.2, krgMax: 0.4, nw: 4, ng: 2, muCo2MPas: 0.06 };
const dryIn = { tempC: 60, salinity: 0.1, brineDensityKgM3: 1050, phiW: 1 };
const zin = { sat: satIn, dry: dryIn, rockCompPerMPa: 4e-5, co2CompPerMPa: 0.02 };

test("three-zone kernel: reduces exactly to Theis when all zones are the brine reference", () => {
  const unit = { m: [1, 1, 1], D: [1, 1, 1], alphaD: 0.01, beta: 3 };
  const a1 = { ...aq, zones: unit };
  const w = { ...W("a", 0, 0, 1, 0, 20), skin: 0 };
  for (const [r, t] of [[0.1, 1], [50, 5], [1500, 10], [8000, 19]]) {
    close(wellContribution(w, r, 0, t, a1, none), wellContribution(w, r, 0, t, aq, none), 1e-10);
  }
});

test("three-zone kernel: line-source, continuity of pressure and flux at both fronts, far-field", () => {
  const zs = buildZones(aq, zin, 21);
  const a3 = { ...aq, zones: zs.consts };
  const c = consts(a3);
  assert.ok(zs.consts.m[0] > 1 && zs.consts.m[1] > 0 && zs.consts.D.every((d) => d > 0 && Number.isFinite(d)));   // CO2 is more mobile than brine (m1 > 1) but much more compressible (D1 < 1)
  const q = rateToM3s(1, aq), t = 10 * 365.25 * 86400, z = zs.consts;
  const rd = Math.sqrt((z.alphaD * q * t) / (Math.PI * aq.porosity * aq.thicknessM));
  const rg = Math.sqrt((z.beta * q * t) / (Math.PI * aq.porosity * aq.thicknessM));
  assert.ok(rd > aq.wellboreRadiusM && rd < rg);
  const P = (r) => threeZoneKernel(r, t, q, a3, c);
  const eps = 1e-6;
  // pressure continuity (the kernel is evaluated just inside / outside each front)
  for (const rf of [rd, rg]) close(P(rf * (1 - eps)), P(rf * (1 + eps)), 1e-6);
  // flux continuity: m dP/dr is the same on both sides
  const dP = (r, h) => (P(r + h) - P(r - h)) / (2 * h);
  const mAt = (r) => (r < rd ? z.m[0] : r < rg ? z.m[1] : z.m[2]);
  for (const rf of [rd, rg]) {
    const h = rf * 1e-4;
    const inside = mAt(rf * (1 - 1e-3)) * (P(rf * (1 - 1e-3)) - P(rf * (1 - 1e-3 - 2e-4))) / (rf * 2e-4);
    const outside = mAt(rf * (1 + 1e-3)) * (P(rf * (1 + 1e-3 + 2e-4)) - P(rf * (1 + 1e-3))) / (rf * 2e-4);
    assert.ok(Math.abs(inside / outside - 1) < 0.01, `flux ${inside} vs ${outside}`);
    void h; void dP;
  }
  // line source: -m1 r dP/dr -> 1 / 2 * 2 = 1 per unit (in P_D units  -m r dP/dr = 1 for r_D units) -> check -m1 r dP/dr ~ 1
  const r0 = rd * 0.05;
  close(-z.m[0] * r0 * (P(r0 * 1.001) - P(r0 * 0.999)) / (r0 * 0.002), 1, 5e-3);
  // far field: amplitude of the brine zone is ~ 1/2 (Theis)
  const far = P(rg * 20), theis = 0.5 * expint1((rg * 20) ** 2 / (4 * c.eta * t));
  close(far / theis, Math.exp(Math.log(far / theis)), 1e-12); assert.ok(Math.abs(far / theis - 1) < 0.02);   // brine-zone amplitude ~ Theis (small shift from the compressible CO2 zones)
  // lumped-resistance check at the wellbore: (1/m1) ln(rd/rw) + (1/m2) ln(rg/rd) + P(rg)
  const rw = aq.wellboreRadiusM;
  const approx = Math.log(rd / rw) / z.m[0] + Math.log(rg / rd) / z.m[1] + P(rg);
  assert.ok(Math.abs(P(rw) / approx - 1) < 0.01, `wellbore ${P(rw)} vs ${approx}`);
});

test("three-zone model: lower wellbore pressure than brine-equivalent, same far field, superposition and shut-in still work", () => {
  const zs = buildZones(aq, zin, 21);
  const a3 = { ...aq, zones: zs.consts };
  const A = { ...W("a", 0, 0, 1, 0, 20), skin: 0, changes: [{ yr: 10, rateMtpa: 0.5 }] };
  const B = { ...W("b", 4000, 0, 1, 0, 20), skin: 0 };
  const self3 = wellContribution(A, 0, 0, 15, a3, none), self1 = wellContribution(A, 0, 0, 15, aq, none);
  assert.ok(self3 < self1 && self3 > 0.5 * self1, `${self3} vs ${self1}`);          // mobile CO2 near the well lowers the pressure
  const far3 = wellContribution(A, 4000, 0, 15, a3, none), far1 = wellContribution(A, 4000, 0, 15, aq, none);
  assert.ok(Math.abs(far3 / far1 - 1) < 0.02);
  const tot3 = totalBuildup([A, B], 0, 0, 15, a3, none);
  close(tot3, wellContribution(A, 0, 0, 15, a3, none) + wellContribution(B, 0, 0, 15, a3, none), 1e-12);
  assert.ok(wellContribution(A, 500, 0, 300, a3, none) < 0.05 * wellContribution(A, 500, 0, 19.99, a3, none));   // recovers after shut-in
  assert.ok(wellContribution(A, 500, 0, 12, a3, none) < wellContribution(A, 500, 0, 9.999, a3, none));          // rate reduction lowers pressure
});
