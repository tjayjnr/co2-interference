"use client";

import { useMemo, useRef, useState } from "react";
import ChartView from "@/components/ChartView";
import NumField from "@/components/NumField";
import { render, type ChartSpec, type Series } from "@/lib/charts";
import { parseWellsCsv, toCsv, download, wellsToCsv, type PointIn, type WellIn } from "@/lib/csv";
import { centroid, project as projectXY, unproject, validLatLon } from "@/lib/geo";
import { downloadBlob, svgToPngDataUrl } from "@/lib/exportImage";
import {
  arrivalTime, buildupGrid, consts, hawkinsSkin, interferenceMatrix, limits, skinBuildup, timeGrid, totalBuildup, wellboreBuildup, wellContribution,
  type Aquifer, type Boundary, type Point, type Well,
} from "@/lib/physics";
import { buildBlocks, renderDocx, renderPdf, type FigureData, type ReportData } from "@/lib/report";
import { effTime, makeSatModel, plumeRadius, satGrid, type SatParams } from "@/lib/saturation";
import { CAT_LABELS, PRESETS, UNITS, findUnit, type Cat } from "@/lib/units";

const COLORS = ["#2a6fdb", "#d9480f", "#2f9e44", "#9c36b5", "#c2255c", "#1098ad", "#e8890c", "#5c677d"];

const DEFAULT_AQUIFER: Aquifer = {
  permMd: 150, thicknessM: 60, porosity: 0.2, compressibilityPerMPa: 4.5e-4, viscosityMPas: 0.5,
  co2DensityKgM3: 700, wellboreRadiusM: 0.1, depthM: 2000, hydroGradientMPaPerM: 0.0105,
  fracGradientMPaPerM: 0.0165, safetyFactor: 0.9,
};

const DEFAULT_WELLS: WellIn[] = [
  { id: "w1", name: "INJ-1", x: 0, y: 0, rateMtpa: 1.0, startYr: 0, endYr: 25, skin: 0, skinText: "" },
  { id: "w2", name: "INJ-2", x: 4000, y: 1000, rateMtpa: 1.0, startYr: 2, endYr: 25, skin: 0, skinText: "" },
  { id: "w3", name: "INJ-3", x: 1500, y: 5000, rateMtpa: 0.8, startYr: 5, endYr: 25, skin: 0, skinText: "" },
  { id: "w4", name: "INJ-4", x: -3500, y: 3000, rateMtpa: 0.5, startYr: 8, endYr: 20, skin: 0, skinText: "" },
];
const DEFAULT_POINTS: PointIn[] = [{ id: "p1", name: "Legacy well", x: 8000, y: -3000 }];

type View = "sat" | "map" | "series" | "matrix" | "limits" | "compare";
type Mode = "total" | "interference" | "bhp";

/** Everything the analysis depends on. Results are computed from the snapshot taken when RUN is pressed. */
interface Inputs {
  aq: Aquifer;
  boundary: Boundary;
  wells: (Well & { lon?: number; lat?: number; skinSrc: "input" | "calc" })[];
  points: (Point & { lon?: number; lat?: number })[];
  horizon: number;
  threshold: number;
  sat: SatParams;
  skin: { ksMd: number; rsM: number; s: number };
  geo: { on: boolean; lat0: number; lon0: number };
  project: string;
  author: string;
}

let seq = 100;
const uid = (p: string) => `${p}${seq++}`;
const num = (v: number) => String(+v.toPrecision(5));
const roundLL = (g: { lat: number; lon: number }) => ({ lat: +g.lat.toFixed(5), lon: +g.lon.toFixed(5) });

async function fontBase64(url: string): Promise<string> {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

export default function Page() {
  // ---- live (editable) inputs ----
  const [aqL, setAq] = useState(DEFAULT_AQUIFER);
  const [boundaryL, setBoundary] = useState<Boundary>({ type: "none", axis: "x", positionM: 10000 });
  const [rawWells, setWells] = useState(DEFAULT_WELLS);
  const [coordMode, setCoordMode] = useState<"local" | "geo">("local");
  const [geoRef] = useState({ lat: 29.7604, lon: -95.3698 }); // example location, used when first switching to lon/lat
  const [boundaryDeg, setBoundaryDeg] = useState(-95.3);
  const [dmg, setDmg] = useState({ ksMd: 50, rsM: 1.5 });
  const [pointsL, setPoints] = useState(DEFAULT_POINTS);
  const [horizonL, setHorizon] = useState(40);
  const [satIn, setSatIn] = useState<SatParams>({ swr: 0.2, krgMax: 0.4, nw: 4, ng: 2, muCo2MPas: 0.06 });
  const [thresholdL, setThreshold] = useState(0.1);
  const [project, setProject] = useState("");
  const [author, setAuthor] = useState("");
  const [units, setUnits] = useState<Record<Cat, string>>(PRESETS.SI);
  // ---- display-only state (acts on results that were already computed) ----
  const [tEval, setTEval] = useState(25);
  const [padM, setPadM] = useState(8000);
  const [view, setView] = useState<View>("sat");
  const [mode, setMode] = useState<Mode>("total");
  const [cmpWell, setCmpWell] = useState(0);
  const [csvError, setCsvError] = useState("");
  const [busy, setBusy] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const setA = (k: keyof Aquifer) => (v: number) => setAq((a) => ({ ...a, [k]: v }));
  const calcSkin = useMemo(() => hawkinsSkin(aqL.permMd, dmg.ksMd, dmg.rsM, aqL.wellboreRadiusM), [aqL.permMd, aqL.wellboreRadiusM, dmg]);
  const isGeo = coordMode === "geo";
  // Projection origin for lon/lat input: the centroid of all entered locations.
  const origin = useMemo(
    () => (isGeo ? centroid([...rawWells, ...pointsL].filter((o) => o.lon !== undefined && o.lat !== undefined).map((o) => ({ lat: o.lat as number, lon: o.lon as number }))) : null),
    [isGeo, rawWells, pointsL],
  );
  const toXY = (o: { x: number; y: number; lon?: number; lat?: number }) =>
    isGeo && origin && o.lon !== undefined && o.lat !== undefined ? projectXY(o.lat, o.lon, origin.lat, origin.lon) : { x: o.x, y: o.y };
  /* eslint-disable react-hooks/exhaustive-deps */
  const wellsL = useMemo(() => rawWells.map((w) => {
    const t = w.skinText.trim();
    const entered = t !== "" && Number.isFinite(Number(t));
    return { ...w, ...toXY(w), skin: entered ? Number(t) : calcSkin, skinSrc: (entered ? "input" : "calc") as "input" | "calc" };
  }), [rawWells, calcSkin, isGeo, origin]);
  const pointsP = useMemo(() => pointsL.map((p) => ({ ...p, ...toXY(p) })), [pointsL, isGeo, origin]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const boundaryEff: Boundary = useMemo(() => {
    if (!isGeo || !origin) return boundaryL;
    const m = boundaryL.axis === "x" ? projectXY(origin.lat, boundaryDeg, origin.lat, origin.lon).x : projectXY(boundaryDeg, origin.lon, origin.lat, origin.lon).y;
    return { ...boundaryL, positionM: m };
  }, [isGeo, origin, boundaryL, boundaryDeg]);
  const limL = useMemo(() => limits(aqL), [aqL]);
  const geoBad = isGeo && [...rawWells, ...pointsL].some((o) => !validLatLon(o.lat ?? 0, o.lon ?? 0));

  const inputsL: Inputs = useMemo(() => ({
    aq: aqL, boundary: boundaryEff, wells: wellsL, points: pointsP, horizon: horizonL, threshold: thresholdL, sat: satIn,
    skin: { ksMd: dmg.ksMd, rsM: dmg.rsM, s: calcSkin }, geo: { on: isGeo, lat0: origin?.lat ?? 0, lon0: origin?.lon ?? 0 }, project, author,
  }), [aqL, boundaryEff, wellsL, pointsP, horizonL, thresholdL, satIn, dmg, calcSkin, isGeo, origin, project, author]);

  // ---- RUN ----
  const [applied, setApplied] = useState<Inputs | null>(null);
  const [runId, setRunId] = useState(0);
  const runNow = () => { setApplied(inputsL); setRunId((n) => n + 1); };
  const stale = useMemo(() => applied !== null && JSON.stringify(applied) !== JSON.stringify(inputsL), [applied, inputsL]);
  const cur = applied ?? inputsL; // before the first RUN nothing is displayed; this only keeps the hooks well-defined
  const { aq, boundary, wells, points, horizon, threshold, geo, sat } = cur;
  const lim = useMemo(() => limits(aq), [aq]);
  const c = useMemo(() => consts(aq), [aq]);
  const tNow = Math.min(tEval, horizon);

  // ---- display units (everything above works in canonical units) ----
  const pU = findUnit("pressure", units.pressure);
  const dU = findUnit("distance", units.distance);
  const rU = findUnit("rate", units.rate);
  const P = (v: number, d = 2) => (v / pU.f).toFixed(Math.max(0, d + (pU.dec ?? 0)));
  const pDec = Math.max(0, 2 + (pU.dec ?? 0));
  const D = (v: number) => { const x = v / dU.f; return Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1); };
  const toP = (a: number[]) => a.map((v) => v / pU.f);
  const setUnit = (cat: Cat) => (v: string) => setUnits((u) => ({ ...u, [cat]: v }));
  const uf = (cat: Cat, o: { label?: string; ariaLabel?: string; value: number; onChange: (v: number) => void; min?: number; step?: number }) => {
    const un = findUnit(cat, units[cat]);
    return (
      <NumField
        label={o.label} ariaLabel={o.ariaLabel}
        unitSelect={o.label ? { value: units[cat], options: UNITS[cat].map((u) => u.label), onChange: setUnit(cat) } : undefined}
        value={+(o.value / un.f).toPrecision(6)} onChange={(v) => o.onChange(v * un.f)}
        min={o.min !== undefined ? o.min / un.f : undefined} step={o.step !== undefined ? o.step / un.f : undefined}
      />
    );
  };
  const unitHead = (cat: Cat) => (
    <select className="unitsel mini" aria-label={`${CAT_LABELS[cat]} unit`} value={units[cat]} onChange={(e) => setUnit(cat)(e.target.value)}>
      {UNITS[cat].map((u) => <option key={u.label} value={u.label}>{u.label}</option>)}
    </select>
  );
  const presetName = (["SI", "Field"] as const).find((k) => (Object.keys(PRESETS[k]) as Cat[]).every((cc) => PRESETS[k][cc] === units[cc])) ?? "Custom";

  const warnings = useMemo(() => {
    const w: string[] = [];
    if (lim.maxBuildupMPa <= 0) w.push("Safety-factored fracture pressure is below initial pressure: no injection headroom.");
    if (boundary.type !== "none") {
      const coord = (o: { x: number; y: number }) => (boundary.axis === "x" ? o.x : o.y);
      const side = [...wells, ...points].map((o) => Math.sign(coord(o) - boundary.positionM));
      if (side.some((s) => s === 0)) w.push("A well or point lies on the boundary.");
      else if (new Set(side).size > 1) w.push("Wells/points are on both sides of the boundary; they must all be inside the aquifer.");
    }
    wells.forEach((a, i) => wells.slice(i + 1).forEach((b) => {
      if (Math.hypot(a.x - b.x, a.y - b.y) < aq.wellboreRadiusM * 2) w.push(`${a.name} and ${b.name} are at the same location.`);
    }));
    wells.forEach((x) => { if (x.endYr <= x.startYr) w.push(`${x.name}: end year must be after start year.`); });
    return w;
  }, [wells, points, boundary, aq.wellboreRadiusM, lim]);

  const times = useMemo(() => timeGrid(horizon, wells), [horizon, wells]);

  // Time series at each well (wellbore) and monitoring point, in canonical MPa.
  const buildSeries = (m: Mode): Series[] => {
    const out: Series[] = [];
    const base = m === "bhp" ? lim.initialMPa : 0; // absolute BHP = initial pressure + buildup
    wells.forEach((w, i) => {
      out.push({
        name: w.name, color: COLORS[i % COLORS.length], x: times,
        y: times.map((t) => base + (m === "interference" ? totalBuildup(wells, w.x, w.y, t, aq, boundary, c, w.id) : wellboreBuildup(wells, w, t, aq, boundary, c))),
      });
    });
    points.forEach((p, i) => {
      out.push({ name: p.name, color: "#495057", dash: i % 2 ? "2 4" : "6 4", x: times, y: times.map((t) => base + totalBuildup(wells, p.x, p.y, t, aq, boundary, c)) });
    });
    if (wells.length > 1) {
      const ws = out.slice(0, wells.length);
      out.push({ name: m === "bhp" ? "Field maximum BHP" : "Field maximum", color: "#111111", x: times, y: times.map((_, k) => Math.max(...ws.map((s) => s.y[k]))) });
      out.push({ name: m === "bhp" ? "Field average BHP" : "Field average", color: "#868e96", dash: "8 3 2 3", x: times, y: times.map((_, k) => ws.reduce((a, s) => a + s.y[k], 0) / ws.length) });
    }
    return out;
  };
  const seriesNow = useMemo(() => buildSeries(mode), [wells, points, times, aq, boundary, c, mode, lim.initialMPa]); // eslint-disable-line react-hooks/exhaustive-deps

  // What drives the field maximum: at each time, find the well with the highest buildup
  // and split that pressure into the contribution of every injector (self included) plus skin.
  const fieldDrivers = useMemo(() => {
    const layers = wells.map((w, i) => ({ name: w.name, color: COLORS[i % COLORS.length], x: times, y: [] as number[] }));
    const skinLayer = { name: "Skin (controlling well)", color: "#adb5bd", x: times, y: [] as number[] };
    const controlling: number[] = [];
    for (const t of times) {
      let best = 0, bestV = -Infinity;
      wells.forEach((w, j) => {
        const v = wellboreBuildup(wells, w, t, aq, boundary, c);
        if (v > bestV) { bestV = v; best = j; }
      });
      controlling.push(best);
      const wj = wells[best];
      wells.forEach((wi, i) => layers[i].y.push(wellContribution(wi, wj.x, wj.y, t, aq, boundary, c)));
      skinLayer.y.push(skinBuildup(wj, t, aq, c));
    }
    const all = [...layers, skinLayer];
    const totals = times.map((_, k) => all.reduce((s, l) => s + l.y[k], 0));
    const kPeak = totals.reduce((m, v, k) => (v > totals[m] ? k : m), 0);
    return { layers: all, controlling, kPeak, peak: totals[kPeak] };
  }, [wells, times, aq, boundary, c]);

  const matrix = useMemo(() => interferenceMatrix(wells, tNow, aq, boundary), [wells, tNow, aq, boundary]);

  const arrivals = useMemo(
    () => wells.map((src) => [...wells, ...points].map((tg) =>
      tg === src ? null : arrivalTime(src, tg.x, tg.y, threshold, horizon, aq, boundary))),
    [wells, points, threshold, horizon, aq, boundary],
  );

  // Peak buildup per well (total, at wellbore) over the horizon.
  const peaks = useMemo(() => wells.map((w) => {
    const ys = times.map((t) => wellboreBuildup(wells, w, t, aq, boundary, c));
    const iMax = ys.reduce((m, v, i) => (v > ys[m] ? i : m), 0);
    const skinAtPeak = skinBuildup(w, times[iMax], aq, c);
    const interference = totalBuildup(wells, w.x, w.y, times[iMax], aq, boundary, c, w.id);
    return { peak: ys[iMax], t: times[iMax], self: ys[iMax] - interference - skinAtPeak, skin: skinAtPeak, interference };
  }), [wells, times, aq, boundary, c]);

  // Monitoring points are checked against the interference threshold (detection level), not the pressure limit.
  const pointChecks = useMemo(() => points.map((pt) => {
    const ys = times.map((t) => totalBuildup(wells, pt.x, pt.y, t, aq, boundary, c));
    const iMax = ys.reduce((m, v, i) => (v > ys[m] ? i : m), 0);
    const iFirst = ys.findIndex((v) => v >= threshold);
    return { name: pt.name, peak: ys[iMax], tPeak: times[iMax], first: iFirst >= 0 ? times[iFirst] : null };
  }), [points, wells, times, aq, boundary, c, threshold]);

  const worst = peaks.reduce((m, p, i) => (p.peak > peaks[m].peak ? i : m), 0);
  const scaleToLimit = peaks.length && peaks[worst].peak > 0 ? lim.maxBuildupMPa / peaks[worst].peak : Infinity;

  // Same wells, three boundary conditions. Bounded cases use the boundary line set in the panel.
  const cases = useMemo(() => {
    const defs: { key: Boundary["type"]; label: string; color: string; dash?: string }[] = [
      { key: "none", label: "Infinite-acting", color: "#2a6fdb" },
      { key: "constant", label: "Constant-pressure boundary", color: "#2f9e44", dash: "6 4" },
      { key: "noflow", label: "No-flow boundary", color: "#d9480f", dash: "2 4" },
    ];
    return defs.map((d) => {
      const b: Boundary = { ...boundary, type: d.key };
      const perWell = wells.map((w) => {
        const ys = times.map((t) => wellboreBuildup(wells, w, t, aq, b, c));
        const k = ys.reduce((m, v, i) => (v > ys[m] ? i : m), 0);
        return { ys, peak: ys[k], t: times[k] };
      });
      return { ...d, perWell };
    });
  }, [wells, aq, boundary, times, c]);
  const cmpIdx = Math.min(cmpWell, Math.max(wells.length - 1, 0));

  const extent = useMemo(() => {
    const all = [...wells, ...points];
    const xs = all.map((o) => o.x), ys = all.map((o) => o.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1000) / 2 + padM;
    return { x0: cx - half, x1: cx + half, y0: cy - half, y1: cy + half };
  }, [wells, points, padM]);

  const grid = useMemo(
    () => (applied && wells.length ? buildupGrid(wells, tNow, aq, boundary, extent) : null),
    [applied, wells, tNow, aq, boundary, extent],
  );

  // CO2 saturation (Buckley-Leverett plume around each injector)
  const satModel = useMemo(() => makeSatModel(sat, aq.viscosityMPas), [sat, aq.viscosityMPas]);
  const gridSat = useMemo(
    () => (applied && wells.length ? satGrid(wells, tNow, aq, satModel, extent) : null),
    [applied, wells, tNow, aq, satModel, extent],
  );
  const plumes = useMemo(() => wells.map((w) => ({
    name: w.name,
    massMt: w.rateMtpa * effTime(w, tNow),
    radius: plumeRadius(w, tNow, aq, satModel),
  })), [wells, tNow, aq, satModel]);

  // ---- chart specs (display units applied) ----
  const mapSpec = (g: NonNullable<typeof grid>): ChartSpec => ({
    kind: "map",
    opts: {
      grid: g, wells, points, boundary, pf: pU.f, pLabel: pU.label, pDec, df: dU.f, dLabel: dU.label,
      geo: geo.on ? { lat0: geo.lat0, lon0: geo.lon0 } : undefined,
      contourLevels: [
        { level: threshold, label: `Interference threshold\n${P(threshold, 3)} ${pU.label} (detection only)`, cls: "thr" },
        ...(lim.maxBuildupMPa > 0 ? [{ level: lim.maxBuildupMPa, label: `Max allowable buildup\n${P(lim.maxBuildupMPa)} ${pU.label} (pass/fail limit)`, cls: "lim" as const }] : []),
      ],
    },
  });
  const satSpec = (g: NonNullable<typeof gridSat>): ChartSpec => ({
    kind: "map",
    opts: {
      grid: g, wells, points, boundary: { ...boundary, type: "none" }, pf: 1, pLabel: "", pDec: 1, df: dU.f, dLabel: dU.label,
      geo: geo.on ? { lat0: geo.lat0, lon0: geo.lon0 } : undefined,
      legendTitle: "CO₂ saturation Sg", palette: "sat", tickDec: 1,
      contourLevels: [{ level: 0.05, label: "Plume edge\n(Sg = 0.05)", cls: "thr" }],
    },
  });
  const lineSpec = (m: Mode, ser: Series[], withMarker: boolean): ChartSpec => ({
    kind: "line",
    opts: {
      series: ser.map((s) => ({ ...s, y: toP(s.y) })), xLabel: "Time (years)",
      yLabel: m === "bhp" ? `Bottomhole pressure (${pU.label})` : `Pressure buildup, ${m === "total" ? "total" : "interference"} (${pU.label})`,
      hline: m === "bhp" ? { y: (lim.initialMPa + lim.maxBuildupMPa) / pU.f, label: `Max allowable BHP ${P(lim.initialMPa + lim.maxBuildupMPa, 1)} ${pU.label}` }
        : m === "total" && lim.maxBuildupMPa > 0 ? { y: lim.maxBuildupMPa / pU.f, label: "Allowable buildup" } : undefined,
      yMin: m === "bhp" ? Math.floor(lim.initialMPa / pU.f) : 0,
      markerX: withMarker ? tNow : undefined, markerLabel: "Evaluation time",
    },
  });
  const stackSpec = (): ChartSpec => ({
    kind: "stack",
    opts: { layers: fieldDrivers.layers.map((l) => ({ ...l, y: toP(l.y) })), xLabel: "Time (years)", yLabel: `Field-maximum buildup by source (${pU.label})` },
  });
  const compareSpec = (idx: number): ChartSpec => ({
    kind: "line",
    opts: {
      series: cases.map((k) => ({ name: k.label, color: k.color, dash: k.dash, x: times, y: toP(k.perWell[idx].ys) })),
      xLabel: "Time (years)", yLabel: `${wells[idx].name} wellbore buildup incl. skin (${pU.label})`,
      hline: lim.maxBuildupMPa > 0 ? { y: lim.maxBuildupMPa / pU.f, label: "Allowable buildup" } : undefined,
    },
  });
  /* eslint-disable react-hooks/exhaustive-deps */
  const specSat = useMemo(() => (gridSat ? satSpec(gridSat) : null), [gridSat, wells, points, geo, dU]);
  const specMap = useMemo(() => (grid ? mapSpec(grid) : null), [grid, wells, points, boundary, threshold, lim, pU, dU]);
  const specSeries = useMemo(() => lineSpec(mode, seriesNow, true), [seriesNow, mode, lim, pU, tNow]);
  const specStack = useMemo(stackSpec, [fieldDrivers, pU]);
  const specCompare = useMemo(() => (wells.length ? compareSpec(cmpIdx) : null), [cases, cmpIdx, lim, pU, times]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const updWell = (id: string, patch: Partial<WellIn>) => setWells((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const updPoint = (id: string, patch: Partial<PointIn>) => setPoints((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const switchCoord = (next: "local" | "geo") => {
    if (next === coordMode) return;
    if (next === "geo") {
      const fill = <T extends { x: number; y: number; lon?: number; lat?: number }>(o: T): T =>
        o.lon !== undefined && o.lat !== undefined ? o : { ...o, ...roundLL(unproject(o.x, o.y, geoRef.lat, geoRef.lon)) };
      setWells((ws) => ws.map(fill));
      setPoints((ps) => ps.map(fill));
      const g = boundaryL.axis === "x" ? unproject(boundaryL.positionM, 0, geoRef.lat, geoRef.lon).lon : unproject(0, boundaryL.positionM, geoRef.lat, geoRef.lon).lat;
      setBoundaryDeg(+g.toFixed(5));
    } else {
      setWells((ws) => ws.map((w) => ({ ...w, ...toXY(w) })));
      setPoints((ps) => ps.map((p) => ({ ...p, ...toXY(p) })));
      setBoundary((b) => ({ ...b, positionM: boundaryEff.positionM }));
    }
    setCoordMode(next);
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = parseWellsCsv(await file.text());
      if (r.geo) {
        // keep the monitoring points at the same offsets from the imported wells' centroid
        const c0 = centroid(r.wells.map((w) => ({ lat: w.lat as number, lon: w.lon as number }))) ?? geoRef;
        if (!isGeo) {
          setPoints((ps) => ps.map((p) => ({ ...p, ...roundLL(unproject(p.x, p.y, c0.lat, c0.lon)) })));
          setBoundaryDeg(+(boundaryL.axis === "x" ? unproject(boundaryL.positionM, 0, c0.lat, c0.lon).lon : unproject(0, boundaryL.positionM, c0.lat, c0.lon).lat).toFixed(5));
        }
        setCoordMode("geo");
      } else {
        if (isGeo) {
          setPoints((ps) => ps.map((p) => ({ ...p, ...toXY(p) })));
          setBoundary((b) => ({ ...b, positionM: boundaryEff.positionM }));
        }
        setCoordMode("local");
      }
      setWells(r.wells);
      setCsvError("");
    } catch (e) {
      setCsvError(e instanceof Error ? e.message : String(e));
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const exportResults = () => {
    const names = wells.map((w) => w.name);
    const rows: (string | number)[][] = [[`# Interference matrix (${pU.label}) at t = ` + tNow + " yr; row = source well, column = receiving well"], ["source\\receiver", ...names]];
    matrix.forEach((r, i) => rows.push([names[i], ...r.map((v) => +(v / pU.f).toFixed(5))]));
    rows.push([], [`# Time series (${pU.label}; mode: ${mode})`], ["time_yr", ...seriesNow.map((s) => s.name)]);
    times.forEach((t, k) => rows.push([+t.toFixed(4), ...seriesNow.map((s) => +(s.y[k] / pU.f).toFixed(5))]));
    rows.push([], ["# Peak check"], ["well", `peak_${pU.label}`, "time_yr", `self_${pU.label}`, `skin_${pU.label}`, `interference_${pU.label}`, `limit_${pU.label}`]);
    wells.forEach((w, i) => rows.push([w.name, +(peaks[i].peak / pU.f).toFixed(4), +peaks[i].t.toFixed(4), ...[peaks[i].self, peaks[i].skin, peaks[i].interference].map((v) => +(v / pU.f).toFixed(4)), +(lim.maxBuildupMPa / pU.f).toFixed(4)]));
    download("co2-interference-results.csv", toCsv(rows));
  };

  // ---- publication-style report (PDF / Word) ----
  const exportReport = async (kind: "pdf" | "docx") => {
    if (!applied || !wells.length) return;
    setBusy(kind === "pdf" ? "Building PDF…" : "Building Word file…");
    try {
      const fig = async (spec: ChartSpec): Promise<FigureData> => {
        const r = render(spec, "light");
        return { png: await svgToPngDataUrl(r.svg, r.width, r.height, 2), w: r.width, h: r.height };
      };
      const figures = {
        sat: await fig(satSpec(satGrid(wells, tNow, aq, satModel, extent))),
        map: await fig(mapSpec(buildupGrid(wells, tNow, aq, boundary, extent))),
        bhp: await fig(lineSpec("bhp", buildSeries("bhp"), false)),
        compare: await fig(compareSpec(worst)),
        drivers: await fig(stackSpec()),
      };
      const un = (cat: Cat) => units[cat];
      const uv = (cat: Cat, v: number) => num(v / findUnit(cat, units[cat]).f);
      const names = wells.map((w) => w.name);
      const allTargets = [...wells, ...points];
      const kp = fieldDrivers.kPeak;
      const ownIdx = fieldDrivers.controlling[kp];
      const shares = fieldDrivers.layers.map((l) => (fieldDrivers.peak > 0 ? Math.round((l.y[kp] / fieldDrivers.peak) * 100) : 0));
      const skinShare = shares[shares.length - 1];
      const ownShare = shares[ownIdx];
      const worstCase = (k: number) => cases[k].perWell[worst].peak;
      const exceeds = cases.filter((k) => k.perWell[worst].peak > lim.maxBuildupMPa).map((k) => k.label.toLowerCase());
      const bLine = `${boundary.axis} = ${D(boundary.positionM)} ${dU.label}`;
      const data: ReportData = {
        project: applied.project, author: applied.author,
        date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
        nWells: wells.length, nPoints: points.length, horizon, pLabel: pU.label,
        paramHead: ["Parameter", "Value", "Unit"],
        paramRows: [
          ["Permeability, k", uv("perm", aq.permMd), un("perm")],
          ["Net thickness, h", uv("length", aq.thicknessM), un("length")],
          ["Porosity, φ", num(aq.porosity), "–"],
          ["Total compressibility, c_t", uv("compress", aq.compressibilityPerMPa), un("compress")],
          ["Brine viscosity, μ", uv("viscosity", aq.viscosityMPas), un("viscosity")],
          ["CO₂ density, ρ", uv("density", aq.co2DensityKgM3), un("density")],
          ["Wellbore radius, r_w", uv("length", aq.wellboreRadiusM), un("length")],
          ["Injection depth, D", uv("length", aq.depthM), un("length")],
          ["Hydrostatic gradient, G_h", uv("gradient", aq.hydroGradientMPaPerM), un("gradient")],
          ["Fracture gradient, G_f", uv("gradient", aq.fracGradientMPaPerM), un("gradient")],
          ["Safety factor, f", num(aq.safetyFactor), "× P_frac"],
          ["Interference threshold", P(threshold, 3), pU.label],
          ["Hydraulic diffusivity, η", num(c.eta), "m²/s"],
          ["Analysis horizon", String(horizon), "yr"],
          ["Irreducible brine saturation, S_wr", num(sat.swr), "–"],
          ["Maximum CO₂ relative permeability, k_rg,max", num(sat.krgMax), "–"],
          ["Corey exponent, brine, n_w", num(sat.nw), "–"],
          ["Corey exponent, CO₂, n_g", num(sat.ng), "–"],
          ["CO₂ viscosity, μ_g", uv("viscosity", sat.muCo2MPas), un("viscosity")],
          ...(wells.some((w) => w.skinSrc === "calc")
            ? [["Damaged-zone permeability, k_s", uv("perm", applied.skin.ksMd), un("perm")], ["Damaged-zone radius, r_s", uv("length", applied.skin.rsM), un("length")]]
            : []),
        ],
        wellHead: geo.on
          ? ["Well", "Lon (°)", "Lat (°)", `x (${dU.label})`, `y (${dU.label})`, `Rate (${rU.label})`, "Start (yr)", "End (yr)", "Skin"]
          : ["Well", `x (${dU.label})`, `y (${dU.label})`, `Rate (${rU.label})`, "Start (yr)", "End (yr)", "Skin"],
        wellRows: wells.map((w) => {
          const skinCell = `${w.skin.toFixed(2)} (${w.skinSrc === "input" ? "input" : "calc."})`;
          const tail = [num(w.rateMtpa / rU.f), num(w.startYr), num(w.endYr), skinCell];
          return geo.on ? [w.name, (w.lon ?? 0).toFixed(5), (w.lat ?? 0).toFixed(5), D(w.x), D(w.y), ...tail] : [w.name, D(w.x), D(w.y), ...tail];
        }),
        pointHead: geo.on ? ["Point", "Lon (°)", "Lat (°)", `x (${dU.label})`, `y (${dU.label})`] : ["Point", `x (${dU.label})`, `y (${dU.label})`],
        pointRows: points.map((p) => (geo.on ? [p.name, (p.lon ?? 0).toFixed(5), (p.lat ?? 0).toFixed(5), D(p.x), D(p.y)] : [p.name, D(p.x), D(p.y)])),
        boundaryDesc: boundary.type === "none"
          ? "The base case treats the aquifer as infinite-acting; the constant-pressure and no-flow cases are evaluated for comparison."
          : `The base case uses a ${boundary.type === "noflow" ? "no-flow (sealing)" : "constant-pressure"} boundary along ${bLine}; the other two conditions are evaluated for comparison.`,
        coordDesc: geo.on
          ? `Well and monitoring-point locations were entered as geographic coordinates (longitude and latitude, WGS84) and converted to local Cartesian coordinates (x east, y north) with an azimuthal equidistant projection centred on the centroid of the locations (latitude ${geo.lat0.toFixed(5)}°, longitude ${geo.lon0.toFixed(5)}°).`
          : "Locations are given as local Cartesian coordinates (x east, y north).",
        skinDesc: (() => {
          const inN = wells.filter((w) => w.skinSrc === "input").map((w) => w.name);
          const clN = wells.filter((w) => w.skinSrc === "calc").map((w) => w.name);
          const calcTxt = `calculated from a damaged zone of radius ${uv("length", applied.skin.rsM)} ${un("length")} and permeability ${uv("perm", applied.skin.ksMd)} ${un("perm")}, giving s = ${applied.skin.s.toFixed(2)}`;
          if (!inN.length) return `The skin factor of every well was ${calcTxt}.`;
          if (!clN.length) return "Skin factors were specified for every well.";
          return `Skin factors were specified for ${inN.join(", ")}; for ${clN.join(", ")} the skin factor was ${calcTxt}.`;
        })(),
        limits: {
          p0: `${P(lim.initialMPa, 1)} ${pU.label}`, pfrac: `${P(lim.fractureMPa, 1)} ${pU.label}`, safety: String(aq.safetyFactor),
          maxBuildup: `${P(lim.maxBuildupMPa)} ${pU.label}`, maxBhp: `${P(lim.initialMPa + lim.maxBuildupMPa, 1)} ${pU.label}`,
        },
        kpi: {
          worst: wells[worst].name, peak: `${P(peaks[worst].peak)} ${pU.label}`, at: `at ${peaks[worst].t.toFixed(1)} yr`,
          allowable: `${P(lim.maxBuildupMPa)} ${pU.label}`, exceeded: peaks[worst].peak > lim.maxBuildupMPa,
          scale: Number.isFinite(scaleToLimit) ? scaleToLimit.toFixed(2) : "–",
          interferenceShare: peaks[worst].peak > 0 ? Math.round((peaks[worst].interference / peaks[worst].peak) * 100) : 0,
        },
        peakHead: ["Well", `Peak (${pU.label})`, "Time (yr)", "Self", "Skin", "Interf.", "Margin", "Status"],
        peakRows: wells.map((w, i) => {
          const p = peaks[i], mg = lim.maxBuildupMPa - p.peak;
          return [w.name, P(p.peak), p.t.toFixed(1), P(p.self), P(p.skin), P(p.interference), P(mg), mg < 0 ? "Exceeds" : "OK"];
        }),
        matrixTime: `${tNow.toFixed(1)} yr`,
        matrixHead: ["Source \\ Receiver", ...names, "Felt elsewhere"],
        matrixRows: [
          ...matrix.map((row, i) => [names[i], ...row.map((v) => P(v, 3)), P(row.reduce((s, v, j) => (j === i ? s : s + v), 0), 3)]),
          ["Total at receiver", ...wells.map((_, j) => P(matrix.reduce((s, r) => s + r[j], 0), 3)), ""],
        ],
        arrivalThreshold: `${P(threshold, 3)} ${pU.label}`,
        arrivalHead: ["Source \\ Target", ...allTargets.map((t) => t.name)],
        arrivalRows: arrivals.map((row, i) => [names[i], ...row.map((v) => (v === null ? "–" : v.toFixed(2)))]),
        pointCheckHead: ["Point", `Peak buildup (${pU.label})`, "Time (yr)", "Threshold reached?", "First reached (yr)"],
        pointCheckRows: pointChecks.map((pc) => [pc.name, P(pc.peak, 3), pc.tPeak.toFixed(1), pc.first !== null ? "Yes" : "No", pc.first !== null ? pc.first.toFixed(2) : "–"]),
        satHead: ["Well", "CO₂ injected (Mt)", `Plume radius (${dU.label})`, "S_g behind front", "Max S_g"],
        satRows: plumes.map((q) => [q.name, q.massMt.toFixed(2), D(q.radius), satModel.sf.toFixed(2), satModel.smax.toFixed(2)]),
        satSentence: (() => {
          const rs = plumes.map((q) => q.radius);
          const big = plumes.reduce((m, q) => (q.radius > m.radius ? q : m), plumes[0]);
          return `At t = ${tNow.toFixed(1)} yr the CO₂ plume fronts lie between ${D(Math.min(...rs))} and ${D(Math.max(...rs))} ${dU.label} from the injectors (largest: ${big.name}). Behind the front the CO₂ saturation is ${satModel.sf.toFixed(2)} and it rises to the maximum of ${satModel.smax.toFixed(2)} at the wells. Saturation was calculated per well with the radial Buckley–Leverett solution and added where plumes overlap (capped at the maximum); gravity override, dissolution, capillarity and residual trapping are not included, so the plume extent is an estimate of the piston-like front.`;
        })(),
        compareHead: ["Well", ...cases.map((k) => k.label)],
        compareRows: [
          ...wells.map((w, i) => [w.name, ...cases.map((k) => P(k.perWell[i].peak))]),
          ["Allowable", ...cases.map(() => P(lim.maxBuildupMPa))],
        ],
        compareSentence:
          `For the controlling well (${wells[worst].name}) the peak wellbore buildup is ${P(worstCase(0))} ${pU.label} for the infinite-acting aquifer, ${P(worstCase(1))} ${pU.label} for a constant-pressure boundary and ${P(worstCase(2))} ${pU.label} for a no-flow boundary (boundary line ${bLine}), against an allowable buildup of ${P(lim.maxBuildupMPa)} ${pU.label}. ` +
          (exceeds.length ? `The allowable buildup is exceeded for the ${exceeds.join(" and ")} case${exceeds.length > 1 ? "s" : ""}.` : "The allowable buildup is not exceeded in any of the three cases."),
        driverHead: ["Source", `Buildup (${pU.label})`, "Share (%)"],
        driverRows: fieldDrivers.layers.map((l, i) => [i === ownIdx ? `${l.name} (own injection)` : l.name, P(l.y[kp], 3), String(shares[i])]),
        driverSentence:
          `The field-maximum buildup of ${P(fieldDrivers.peak)} ${pU.label} (bottomhole pressure ${P(lim.initialMPa + fieldDrivers.peak, 1)} ${pU.label}) occurs at ${times[kp].toFixed(1)} yr at ${wells[ownIdx].name}. ` +
          `Of this, ${ownShare}% is the well's own injection, ${skinShare}% is skin and ${Math.max(0, 100 - ownShare - skinShare)}% is interference from the other wells.`,
        figures,
        warnings,
      };
      const blocks = buildBlocks(data);
      const title = "CO₂ injection pressure interference analysis";
      if (kind === "pdf") {
        const fonts = { regular: await fontBase64("/fonts/STIX-Regular.ttf"), bold: await fontBase64("/fonts/STIX-Bold.ttf"), italic: await fontBase64("/fonts/STIX-Italic.ttf") };
        downloadBlob(new Blob([await renderPdf(blocks, fonts, title)], { type: "application/pdf" }), "co2-interference-report.pdf");
      } else {
        downloadBlob(await renderDocx(blocks, title), "co2-interference-report.docx");
      }
    } catch (e) {
      alert(`Could not build the report: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy("");
    }
  };

  const targets = [...wells, ...points];
  const maxOff = Math.max(1e-9, ...matrix.flatMap((r, i) => r.filter((_, j) => j !== i)));
  const fx = Math.max(0, 1 + (pU.dec ?? 0));

  return (
    <main className="app">
      <header className="top">
        <div>
          <h1>CO₂ Injection Pressure Interference</h1>
          <p className="sub">Multi-well Theis superposition for a confined saline aquifer · screening-level, brine-equivalent</p>
        </div>
        <div className="hdrbtns">
          <a className="toplink" href="/manual" target="_blank" rel="noopener noreferrer">User manual</a>
          <button className="ghost" onClick={exportResults} disabled={!applied}>Export results CSV</button>
          <button onClick={() => exportReport("pdf")} disabled={!applied || !!busy}>Report (PDF)</button>
          <button onClick={() => exportReport("docx")} disabled={!applied || !!busy}>Report (Word)</button>
        </div>
      </header>
      {busy && <p className="hint">{busy}</p>}

      <div className="layout">
        <aside className="panel">
          <div className="runbar">
            <button className="run" onClick={() => runNow()}>▶ RUN analysis</button>
            <span className="hint"> {applied ? (stale ? "Inputs changed — press RUN to update." : "Results are up to date.") : "Set your inputs, then press RUN."}</span>
          </div>

          <section>
            <div className="row-head">
              <h2>Input</h2>
              <select className="preset" aria-label="Unit preset" title="Unit preset" value={presetName}
                onChange={(e) => { if (e.target.value !== "Custom") setUnits(PRESETS[e.target.value as "SI" | "Field"]); }}>
                <option value="SI">SI units</option>
                <option value="Field">Field units</option>
                {presetName === "Custom" && <option value="Custom">Custom units</option>}
              </select>
            </div>
            <div className="grid2">
              {uf("perm", { label: "Permeability", value: aqL.permMd, onChange: setA("permMd"), min: 0 })}
              {uf("length", { label: "Thickness", value: aqL.thicknessM, onChange: setA("thicknessM"), min: 0 })}
              <NumField label="Porosity" unit="frac" value={aqL.porosity} onChange={setA("porosity")} step={0.01} min={0} />
              {uf("compress", { label: "Total compress.", value: aqL.compressibilityPerMPa, onChange: setA("compressibilityPerMPa"), min: 0 })}
              {uf("viscosity", { label: "Brine viscosity", value: aqL.viscosityMPas, onChange: setA("viscosityMPas"), min: 0 })}
              {uf("density", { label: "CO₂ density", value: aqL.co2DensityKgM3, onChange: setA("co2DensityKgM3"), min: 1 })}
              {uf("length", { label: "Wellbore radius", value: aqL.wellboreRadiusM, onChange: setA("wellboreRadiusM"), min: 0.01 })}
              {uf("length", { label: "Depth", value: aqL.depthM, onChange: setA("depthM"), min: 0 })}
              <NumField label="Analysis horizon" unit="yr" value={horizonL} onChange={(v) => setHorizon(Math.max(1, v))} min={1} />
            </div>
            <p className="hint">Diffusivity η = {consts(aqL).eta.toFixed(2)} m²/s</p>
          </section>

          <section>
            <h2>Pressure limit</h2>
            <div className="grid2">
              {uf("gradient", { label: "Hydrostatic grad.", value: aqL.hydroGradientMPaPerM, onChange: setA("hydroGradientMPaPerM") })}
              {uf("gradient", { label: "Fracture grad.", value: aqL.fracGradientMPaPerM, onChange: setA("fracGradientMPaPerM") })}
              <NumField label="Safety factor" unit="× Pfrac" value={aqL.safetyFactor} onChange={setA("safetyFactor")} step={0.05} />
              {uf("pressure", { label: "Interference threshold", value: thresholdL, onChange: setThreshold })}
            </div>
            <p className="hint">
              P₀ {(limL.initialMPa / pU.f).toFixed(fx)} {pU.label} · P<sub>frac</sub> {(limL.fractureMPa / pU.f).toFixed(fx)} {pU.label} · max buildup <b>{(limL.maxBuildupMPa / pU.f).toFixed(pDec)} {pU.label}</b>
            </p>
          </section>

          <section>
            <h2>CO₂ saturation</h2>
            <div className="grid2">
              <NumField label="Residual brine Swr" unit="frac" value={satIn.swr} onChange={(v) => setSatIn((q) => ({ ...q, swr: Math.min(Math.max(v, 0), 0.95) }))} step={0.05} min={0} />
              <NumField label="Max CO₂ rel. perm. krg" value={satIn.krgMax} onChange={(v) => setSatIn((q) => ({ ...q, krgMax: Math.min(Math.max(v, 0.01), 1) }))} step={0.05} min={0} />
              <NumField label="Corey exponent, brine" value={satIn.nw} onChange={(v) => setSatIn((q) => ({ ...q, nw: Math.max(v, 1) }))} step={0.5} min={1} />
              <NumField label="Corey exponent, CO₂" value={satIn.ng} onChange={(v) => setSatIn((q) => ({ ...q, ng: Math.max(v, 1) }))} step={0.5} min={1} />
              {uf("viscosity", { label: "CO₂ viscosity", value: satIn.muCo2MPas, onChange: (v) => setSatIn((q) => ({ ...q, muCo2MPas: Math.max(v, 1e-4) })), min: 0 })}
            </div>
            <p className="hint">Used for the CO₂ saturation map (radial Buckley–Leverett front around each injector, using the porosity, thickness and brine viscosity above).</p>
          </section>

          <section>
            <h2>Well skin</h2>
            <p className="hint" style={{ marginTop: 0 }}>
              Skin is set per well in the table below. If you have a measured skin, type it in that well&apos;s Skin cell. If you leave the cell blank, the app calculates it from the damaged zone described here.
            </p>
            <div className="grid2">
              {uf("perm", { label: "Damaged-zone perm. ks", value: dmg.ksMd, onChange: (v) => setDmg((d) => ({ ...d, ksMd: v })), min: 0.001 })}
              {uf("length", { label: "Damaged-zone radius rs", value: dmg.rsM, onChange: (v) => setDmg((d) => ({ ...d, rsM: v })), min: 0 })}
            </div>
            <p className="hint">
              Calculated skin: s = (k/ks − 1)·ln(rs/rw) = <b>{calcSkin.toFixed(2)}</b> (ks &lt; k is damage, ks &gt; k is stimulation).
            </p>
          </section>

          <section>
            <h2>Boundary condition</h2>
            <div className="grid2">
              <label className="field"><span>Type</span>
                <select value={boundaryL.type} onChange={(e) => setBoundary({ ...boundaryL, type: e.target.value as Boundary["type"] })}>
                  <option value="none">None (infinite)</option>
                  <option value="noflow">Sealing fault (no-flow)</option>
                  <option value="constant">Constant pressure</option>
                </select>
              </label>
              <label className="field"><span>Line</span>
                <select value={boundaryL.axis} disabled={boundaryL.type === "none"} onChange={(e) => setBoundary({ ...boundaryL, axis: e.target.value as "x" | "y" })}>
                  <option value="x">{isGeo ? "longitude = const (N–S line)" : "x = const"}</option>
                  <option value="y">{isGeo ? "latitude = const (E–W line)" : "y = const"}</option>
                </select>
              </label>
              {isGeo
                ? <NumField label={boundaryL.axis === "x" ? "Longitude" : "Latitude"} unit="°" value={boundaryDeg} onChange={setBoundaryDeg} />
                : uf("distance", { label: "Position", value: boundaryL.positionM, onChange: (v) => setBoundary({ ...boundaryL, positionM: v }) })}
            </div>
            <p className="hint">The Compare boundaries tab runs all three conditions side by side using this line.</p>
          </section>

          <section>
            <div className="row-head">
              <h2>Injection wells</h2>
              <div className="btns">
                <button className="ghost" onClick={() => fileRef.current?.click()}>Import CSV</button>
                <button className="ghost" onClick={() => download("wells.csv", wellsToCsv(rawWells, isGeo))}>Export</button>
              </div>
            </div>
            <label className="field coordsel"><span>Location input</span>
              <select value={coordMode} onChange={(e) => switchCoord(e.target.value as "local" | "geo")}>
                <option value="local">Local x, y</option>
                <option value="geo">Longitude / latitude (real-world)</option>
              </select>
            </label>
            {isGeo && (
              <p className="hint">
                Enter WGS84 decimal degrees (east and north positive). Calculations use a local projection centred on the centroid of your locations
                {origin ? ` (${origin.lat.toFixed(4)}°, ${origin.lon.toFixed(4)}°)` : ""}, and the pressure map is labelled in longitude and latitude.
                The coordinates shown are an example — replace them with your own.
              </p>
            )}
            <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" hidden onChange={(e) => onImport(e.target.files?.[0])} />
            {csvError && <p className="err">{csvError}</p>}
            {geoBad && <p className="err">Latitude must be within ±90° and longitude within ±180°.</p>}
            <div className="tablewrap">
              <table className="edit">
                <thead><tr><th>Name</th>{isGeo ? <><th>Lon (°)</th><th>Lat (°)</th></> : <><th>x {unitHead("distance")}</th><th>y {unitHead("distance")}</th></>}<th>Rate {unitHead("rate")}</th><th>Start</th><th>End</th><th>Skin</th><th /></tr></thead>
                <tbody>
                  {rawWells.map((w) => (
                    <tr key={w.id}>
                      <td><input value={w.name} aria-label="Well name" onChange={(e) => updWell(w.id, { name: e.target.value })} /></td>
                      {isGeo ? (
                        <>
                          <td><NumField className="geoin" ariaLabel={`${w.name} longitude`} value={w.lon ?? 0} onChange={(v) => updWell(w.id, { lon: v })} /></td>
                          <td><NumField className="geoin" ariaLabel={`${w.name} latitude`} value={w.lat ?? 0} onChange={(v) => updWell(w.id, { lat: v })} /></td>
                        </>
                      ) : (
                        <>
                          <td>{uf("distance", { ariaLabel: `${w.name} x`, value: w.x, onChange: (v) => updWell(w.id, { x: v }) })}</td>
                          <td>{uf("distance", { ariaLabel: `${w.name} y`, value: w.y, onChange: (v) => updWell(w.id, { y: v }) })}</td>
                        </>
                      )}
                      <td>{uf("rate", { ariaLabel: `${w.name} rate`, value: w.rateMtpa, onChange: (v) => updWell(w.id, { rateMtpa: v }), min: 0 })}</td>
                      <td><NumField ariaLabel={`${w.name} start`} value={w.startYr} onChange={(v) => updWell(w.id, { startYr: v })} min={0} /></td>
                      <td><NumField ariaLabel={`${w.name} end`} value={w.endYr} onChange={(v) => updWell(w.id, { endYr: v })} min={0} /></td>
                      <td><input type="number" step="any" className="skininput" aria-label={`${w.name} skin`} value={w.skinText} placeholder={calcSkin.toFixed(2)} title={`Type a skin value, or leave blank to use the calculated value (${calcSkin.toFixed(2)})`} onChange={(e) => updWell(w.id, { skinText: e.target.value })} /></td>
                      <td><button className="x" aria-label={`Remove ${w.name}`} onClick={() => setWells((ws) => ws.filter((q) => q.id !== w.id))}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="ghost" onClick={() => setWells((ws) => [...ws, { id: uid("w"), name: `INJ-${ws.length + 1}`, x: 0, y: 0, lon: origin?.lon ?? geoRef.lon, lat: origin?.lat ?? geoRef.lat, rateMtpa: 1, startYr: 0, endYr: 25, skin: 0, skinText: "" }])}>+ Add well</button>
            <p className="hint">Skin: type a value if you have it; leave it blank and the app calculates it (grey number = calculated value). CSV columns (metres or degrees, Mt/yr): name, x_m, y_m <i>or</i> lon_deg, lat_deg, rate_Mtpa, start_yr, end_yr, skin (optional). Excel: save as CSV.</p>
          </section>

          <section>
            <h2>Monitoring points</h2>
            <div className="tablewrap">
              <table className="edit">
                <thead><tr><th>Name</th>{isGeo ? <><th>Lon (°)</th><th>Lat (°)</th></> : <><th>x {unitHead("distance")}</th><th>y {unitHead("distance")}</th></>}<th /></tr></thead>
                <tbody>
                  {pointsL.map((p) => (
                    <tr key={p.id}>
                      <td><input value={p.name} aria-label="Point name" onChange={(e) => updPoint(p.id, { name: e.target.value })} /></td>
                      {isGeo ? (
                        <>
                          <td><NumField className="geoin" ariaLabel={`${p.name} longitude`} value={p.lon ?? 0} onChange={(v) => updPoint(p.id, { lon: v })} /></td>
                          <td><NumField className="geoin" ariaLabel={`${p.name} latitude`} value={p.lat ?? 0} onChange={(v) => updPoint(p.id, { lat: v })} /></td>
                        </>
                      ) : (
                        <>
                          <td>{uf("distance", { ariaLabel: `${p.name} x`, value: p.x, onChange: (v) => updPoint(p.id, { x: v }) })}</td>
                          <td>{uf("distance", { ariaLabel: `${p.name} y`, value: p.y, onChange: (v) => updPoint(p.id, { y: v }) })}</td>
                        </>
                      )}
                      <td><button className="x" aria-label={`Remove ${p.name}`} onClick={() => setPoints((ps) => ps.filter((q) => q.id !== p.id))}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="ghost" onClick={() => setPoints((ps) => [...ps, { id: uid("p"), name: `Point ${ps.length + 1}`, x: 0, y: 0, lon: origin?.lon ?? geoRef.lon, lat: origin?.lat ?? geoRef.lat }])}>+ Add point</button>
          </section>

          <section>
            <h2>Report details</h2>
            <div className="grid2">
              <label className="field"><span>Project name</span><input value={project} onChange={(e) => setProject(e.target.value)} placeholder="optional" /></label>
              <label className="field"><span>Author</span><input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="optional" /></label>
            </div>
            <p className="hint">Printed on the PDF / Word report.</p>
          </section>
        </aside>

        <section className="results">
          {!applied && (
            <div className="empty">
              <p><b>No results yet.</b></p>
              <p>Check the inputs on the left, then press <button type="button" className="linkbtn" onClick={() => runNow()}>▶ RUN analysis</button>.</p>
            </div>
          )}

          {applied && (
            <>
              {stale && <div className="stale">The inputs have changed since the last run. The results below still show the previous run — press <b>▶ RUN analysis</b> to update them. <button type="button" className="linkbtn" onClick={() => runNow()}>▶ RUN analysis</button></div>}
              {warnings.length > 0 && (
                <ul className="warn">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              )}

              <div className="kpis">
                <div className="kpi">
                  <span>Peak buildup (worst well)</span>
                  <b>{wells.length ? P(peaks[worst].peak) : "–"} {pU.label}</b>
                  <small>{wells.length ? `${wells[worst].name} at ${peaks[worst].t.toFixed(1)} yr` : ""}</small>
                </div>
                <div className="kpi">
                  <span>Allowable buildup</span>
                  <b>{P(lim.maxBuildupMPa)} {pU.label}</b>
                  <small>{aq.safetyFactor} × Pfrac − P₀</small>
                </div>
                <div className={`kpi ${wells.length && peaks[worst].peak > lim.maxBuildupMPa ? "bad" : "good"}`}>
                  <span>Status vs max allowable buildup</span>
                  <b>{wells.length && peaks[worst].peak > lim.maxBuildupMPa ? "Limit exceeded" : "Within limit"}</b>
                  <small>Pass/fail uses the max allowable buildup, not the interference threshold.</small>
                  <small>{Number.isFinite(scaleToLimit) ? `Rates can scale ×${scaleToLimit.toFixed(2)} to reach the limit.` : ""}</small>
                </div>
              </div>

              <nav className="tabs" role="tablist">
                {([["sat", "CO₂ saturation"], ["map", "Pressure map"], ["series", "Time series"], ["matrix", "Interference matrix"], ["limits", "Limit check"], ["compare", "Compare boundaries"]] as [View, string][]).map(([v, l]) => (
                  <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{l}</button>
                ))}
              </nav>

              <div className="controls">
                <label className="field slider"><span>Evaluation time <em>{tNow.toFixed(1)} yr</em></span>
                  <input type="range" min={0.1} max={horizon} step={0.1} value={tNow} onChange={(e) => setTEval(+e.target.value)} />
                </label>
                <label className="field"><span>Pressure unit</span>
                  <select value={units.pressure} onChange={(e) => setUnit("pressure")(e.target.value)}>
                    {UNITS.pressure.map((u) => <option key={u.label} value={u.label}>{u.label}</option>)}
                  </select>
                </label>
                {(view === "map" || view === "sat") && uf("distance", { label: "Map padding", value: padM, onChange: (v) => setPadM(Math.max(0, v)), min: 0 })}
                {view === "series" && (
                  <label className="field"><span>Show</span>
                    <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                      <option value="total">Total buildup (ΔP)</option>
                      <option value="bhp">Bottomhole pressure (absolute)</option>
                      <option value="interference">Interference only (excl. self)</option>
                    </select>
                  </label>
                )}
              </div>

              {view === "sat" && specSat && (
                <>
                  <ChartView key={`sat-${runId}`} spec={specSat} title={`CO₂ saturation map at t = ${tNow.toFixed(1)} yr`} filename="co2-saturation-map" />
                  <p className="caption">
                    Saturation of the injected CO₂ (Sg) at {tNow.toFixed(1)} yr from a radial Buckley–Leverett front around each injector; overlapping plumes are added and capped at {satModel.smax.toFixed(2)}. Brine fills the rest of the pore space. The dashed contour marks the plume edge (Sg = 0.05). Gravity override, dissolution and residual trapping are not modelled. Drag the evaluation-time slider to watch the plumes grow; they stop growing at each well&apos;s shut-in.
                  </p>
                  <h3>CO₂ plume of each well at t = {tNow.toFixed(1)} yr</h3>
                  <div className="tablewrap">
                    <table className="matrix">
                      <thead><tr><th>Well</th><th>CO₂ injected (Mt)</th><th>Plume radius ({dU.label})</th><th>Sg behind front</th><th>Max Sg (at well)</th></tr></thead>
                      <tbody>
                        {plumes.map((q) => (
                          <tr key={q.name}>
                            <th>{q.name}</th><td>{q.massMt.toFixed(2)}</td><td>{D(q.radius)}</td><td>{satModel.sf.toFixed(2)}</td><td>{satModel.smax.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {view === "map" && specMap && (
                <>
                  <ChartView key={`map-${runId}`} spec={specMap} title={`Pressure buildup map at t = ${tNow.toFixed(1)} yr`} filename="pressure-map" />
                  <p className="caption">
                    Buildup at {tNow.toFixed(1)} yr. <b>Pass/fail</b> is judged against the <b>max allowable buildup</b> ({P(lim.maxBuildupMPa)} {pU.label} = {aq.safetyFactor} × fracture pressure − initial pressure), shown as the solid white/black contour, which only appears near the wells if the limit is approached.
                    The dashed teal contour is the <b>interference threshold</b> ({P(threshold, 3)} {pU.label}); it only shows how far a pressure effect can be detected and is not a pass/fail limit.
                  </p>
                </>
              )}

              {view === "series" && (
                <>
                  <ChartView key={`series-${runId}-${mode}`} spec={specSeries} title={mode === "bhp" ? "Bottomhole pressure of each well vs time" : mode === "total" ? "Wellbore pressure buildup vs time" : "Interference pressure at each well vs time"} filename={`time-series-${mode}`} />
                  {wells.length > 0 && (
                    <>
                      <h3>What drives the field maximum</h3>
                      <p className="caption">
                        At each time the well with the highest pressure is the controlling well. The chart splits its buildup into the share caused by each injector (its own injection is the layer with its own name) plus skin. Add {P(lim.initialMPa, 1)} {pU.label} for absolute BHP.
                      </p>
                      <ChartView key={`stack-${runId}`} spec={specStack} title="Field-maximum buildup split by source well" filename="field-maximum-drivers" />
                      <div className="tablewrap">
                        <table className="matrix">
                          <thead><tr><th>At field peak: {P(fieldDrivers.peak)} {pU.label} ({P(lim.initialMPa + fieldDrivers.peak, 1)} {pU.label} BHP) at {times[fieldDrivers.kPeak].toFixed(1)} yr in {wells[fieldDrivers.controlling[fieldDrivers.kPeak]].name}</th><th>{pU.label}</th><th>Share</th></tr></thead>
                          <tbody>
                            {fieldDrivers.layers.map((l) => (
                              <tr key={l.name}>
                                <th>{l.name}{l.name === wells[fieldDrivers.controlling[fieldDrivers.kPeak]].name ? " (own injection)" : ""}</th>
                                <td>{P(l.y[fieldDrivers.kPeak], 3)}</td>
                                <td>{fieldDrivers.peak > 0 ? Math.round((l.y[fieldDrivers.kPeak] / fieldDrivers.peak) * 100) : 0}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                  <p className="caption">Wells are evaluated at the wellbore radius; dashed lines are monitoring points. Bottomhole pressure = initial pressure + own buildup + skin + interference from every other well; the field lines show the highest and the average across all wells at each time. Interference-only removes each well&apos;s own contribution at its own location.</p>
                </>
              )}

              {view === "matrix" && (
                <>
                  <h3>Buildup ({pU.label}) at t = {tNow.toFixed(1)} yr</h3>
                  <p className="caption">Row = injecting well, column = where pressure is felt. Diagonal is the well&apos;s own buildup.</p>
                  <div className="tablewrap">
                    <table className="matrix">
                      <thead><tr><th>Source ↓ / Receiver →</th>{wells.map((w) => <th key={w.id}>{w.name}</th>)}<th>Felt elsewhere</th></tr></thead>
                      <tbody>
                        {matrix.map((row, i) => (
                          <tr key={wells[i].id}>
                            <th>{wells[i].name}</th>
                            {row.map((v, j) => (
                              <td key={j} className={i === j ? "diag" : ""} style={i === j ? undefined : { background: `color-mix(in srgb, var(--accent) ${Math.round((v / maxOff) * 55)}%, transparent)` }}>{P(v, 3)}</td>
                            ))}
                            <td>{P(row.reduce((s, v, j) => (j === i ? s : s + v), 0), 3)}</td>
                          </tr>
                        ))}
                        <tr className="total">
                          <th>Total at receiver</th>
                          {wells.map((_, j) => <td key={j}>{P(matrix.reduce((s, r) => s + r[j], 0), 3)}</td>)}
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>

                  <h3>Arrival time of ≥ {P(threshold, 3)} {pU.label} (years)</h3>
                  <p className="caption">First time a source well alone raises pressure at the target by the threshold. “–” means it does not within the injection period/horizon.</p>
                  <div className="tablewrap">
                    <table className="matrix">
                      <thead><tr><th>Source ↓ / Target →</th>{targets.map((t) => <th key={t.id}>{t.name}</th>)}</tr></thead>
                      <tbody>
                        {arrivals.map((row, i) => (
                          <tr key={wells[i].id}>
                            <th>{wells[i].name}</th>
                            {row.map((v, j) => <td key={j}>{v === null ? "–" : v.toFixed(2)}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {view === "limits" && (
                <>
                  <p className="caption" style={{ marginTop: 0 }}>
                    <b>Injection wells</b> are judged against the <b>max allowable buildup</b> of {P(lim.maxBuildupMPa)} {pU.label} ({aq.safetyFactor} × fracture pressure − initial pressure). The <b>interference threshold</b> ({P(threshold, 3)} {pU.label}) is not a pass/fail limit; it is only used for the map contour, the arrival times and the monitoring-point table below.
                  </p>
                  <div className="tablewrap">
                    <table className="matrix">
                      <thead><tr><th>Well</th><th>Peak buildup ({pU.label})</th><th>at (yr)</th><th>of which self</th><th>of which skin</th><th>of which interference</th><th>Bottomhole P ({pU.label})</th><th>Margin ({pU.label})</th><th>Status</th></tr></thead>
                      <tbody>
                        {wells.map((w, i) => {
                          const p = peaks[i], margin = lim.maxBuildupMPa - p.peak;
                          return (
                            <tr key={w.id}>
                              <th>{w.name}</th>
                              <td>{P(p.peak)}</td><td>{p.t.toFixed(1)}</td>
                              <td>{P(p.self)}</td><td>{P(p.skin)}</td><td>{P(p.interference)}</td>
                              <td>{P(lim.initialMPa + p.peak)}</td>
                              <td>{P(margin)}</td>
                              <td className={margin < 0 ? "bad-cell" : "good-cell"}>{margin < 0 ? "Exceeds" : "OK"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                  <p className="caption">
                    Interference share at the worst well: {wells.length && peaks[worst].peak > 0 ? Math.round((peaks[worst].interference / peaks[worst].peak) * 100) : 0}% of its peak buildup.
                    Because the model is linear in rate, scaling every rate by ×{Number.isFinite(scaleToLimit) ? scaleToLimit.toFixed(2) : "–"} brings the worst well exactly to the limit.
                  </p>
                  {points.length > 0 && (
                    <>
                      <h3>Monitoring points vs the interference threshold ({P(threshold, 3)} {pU.label})</h3>
                      <div className="tablewrap">
                        <table className="matrix">
                          <thead><tr><th>Point</th><th>Peak buildup ({pU.label})</th><th>at (yr)</th><th>Threshold reached?</th><th>First reached (yr)</th></tr></thead>
                          <tbody>
                            {pointChecks.map((pc) => (
                              <tr key={pc.name}>
                                <th>{pc.name}</th>
                                <td>{P(pc.peak, 3)}</td><td>{pc.tPeak.toFixed(1)}</td>
                                <td className={pc.first !== null ? "bad-cell" : "good-cell"}>{pc.first !== null ? "Yes" : "No"}</td>
                                <td>{pc.first !== null ? pc.first.toFixed(2) : "–"}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </>
                  )}
                </>
              )}

              {view === "compare" && (
                <>
                  <div className="controls">
                    <label className="field"><span>Well shown in chart</span>
                      <select value={cmpIdx} onChange={(e) => setCmpWell(+e.target.value)}>
                        {wells.map((w, i) => <option key={w.id} value={i}>{w.name}</option>)}
                      </select>
                    </label>
                  </div>
                  {specCompare && <ChartView key={`cmp-${runId}-${cmpIdx}`} spec={specCompare} title={`Boundary-condition comparison for ${wells[cmpIdx].name}`} filename="boundary-comparison" />}
                  <h3>Peak wellbore buildup ({pU.label}), skin included</h3>
                  <div className="tablewrap">
                    <table className="matrix">
                      <thead><tr><th>Well</th>{cases.map((k) => <th key={k.key}>{k.label}</th>)}</tr></thead>
                      <tbody>
                        {wells.map((w, i) => (
                          <tr key={w.id}>
                            <th>{w.name}</th>
                            {cases.map((k) => {
                              const v = k.perWell[i].peak;
                              return <td key={k.key} className={v > lim.maxBuildupMPa ? "bad-cell" : ""}>{P(v)}</td>;
                            })}
                          </tr>
                        ))}
                        <tr className="total">
                          <th>Allowed</th>
                          {cases.map((k) => <td key={k.key}>{P(lim.maxBuildupMPa)}</td>)}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="caption">
                    Boundary line: {boundary.axis} = {D(boundary.positionM)} {dU.label}. Red cells exceed the allowable buildup. A no-flow boundary is the most conservative case (the image well adds pressure); a constant-pressure boundary the least (the image well relieves pressure).
                  </p>
                </>
              )}

              <details className="assump">
                <summary>Model assumptions and limitations</summary>
                <ul>
                  <li>Homogeneous, isotropic, confined aquifer of constant thickness; single-phase slightly-compressible flow (Theis line source) with Δp = qμ/(4πkh)·E₁(r²/4ηt).</li>
                  <li>CO₂ mass is converted to reservoir volume with the given CO₂ density and the brine viscosity is used everywhere (brine-equivalent). This overstates near-well pressure because CO₂ is less viscous than brine, but is reasonable for far-field interference.</li>
                  <li>Wells are evaluated at the wellbore radius. Skin adds a steady pressure drop Δp = qμs/(2πkh) at the injector itself, only while injecting; it does not change interference at other wells. Wellbore storage, non-Darcy flow and CO₂-mobility effects are not modelled.</li>
                  <li>Boundaries are one straight line handled by image wells. Leaky caprock, multiple faults, heterogeneity, dissolution and brine production are not modelled.</li>
                  <li>Use for screening and ranking of well layouts; confirm with numerical simulation before decisions.</li>
                </ul>
              </details>
            </>
          )}
        </section>
      </div>
    </main>
  );
}
