"use client";

import { useMemo, useRef, useState } from "react";
import LineChart, { type Series } from "@/components/LineChart";
import MapView from "@/components/MapView";
import StackedChart from "@/components/StackedChart";
import NumField from "@/components/NumField";
import { CAT_LABELS, PRESETS, UNITS, findUnit, type Cat } from "@/lib/units";
import { parseWellsCsv, toCsv, download, wellsToCsv } from "@/lib/csv";
import {
  arrivalTime, buildupGrid, consts, hawkinsSkin, interferenceMatrix, limits, skinBuildup, timeGrid, totalBuildup, wellboreBuildup, wellContribution,
  type Aquifer, type Boundary, type Point, type Well,
} from "@/lib/physics";

const COLORS = ["#2a6fdb", "#d9480f", "#2f9e44", "#9c36b5", "#c2255c", "#1098ad", "#e8890c", "#5c677d"];

const DEFAULT_AQUIFER: Aquifer = {
  permMd: 150, thicknessM: 60, porosity: 0.2, compressibilityPerMPa: 4.5e-4, viscosityMPas: 0.5,
  co2DensityKgM3: 700, wellboreRadiusM: 0.1, depthM: 2000, hydroGradientMPaPerM: 0.0105,
  fracGradientMPaPerM: 0.0165, safetyFactor: 0.9,
};

const DEFAULT_WELLS: Well[] = [
  { id: "w1", name: "INJ-1", x: 0, y: 0, rateMtpa: 1.0, startYr: 0, endYr: 25, skin: 2 },
  { id: "w2", name: "INJ-2", x: 4000, y: 1000, rateMtpa: 1.0, startYr: 2, endYr: 25, skin: 5 },
  { id: "w3", name: "INJ-3", x: 1500, y: 5000, rateMtpa: 0.8, startYr: 5, endYr: 25, skin: 0 },
  { id: "w4", name: "INJ-4", x: -3500, y: 3000, rateMtpa: 0.5, startYr: 8, endYr: 20, skin: 3 },
];
const DEFAULT_POINTS: Point[] = [{ id: "p1", name: "Legacy well", x: 8000, y: -3000 }];

type View = "map" | "series" | "matrix" | "limits" | "compare";
type Mode = "total" | "interference" | "bhp";
let seq = 100;
const uid = (p: string) => `${p}${seq++}`;

export default function Page() {
  const [aq, setAq] = useState(DEFAULT_AQUIFER);
  const [boundary, setBoundary] = useState<Boundary>({ type: "none", axis: "x", positionM: 10000 });
  const [rawWells, setWells] = useState(DEFAULT_WELLS);
  const [skinMode, setSkinMode] = useState<"manual" | "calc">("calc");
  const [dmg, setDmg] = useState({ ksMd: 50, rsM: 1.5 });
  const [points, setPoints] = useState(DEFAULT_POINTS);
  const [horizon, setHorizon] = useState(40);
  const [tEval, setTEval] = useState(25);
  const [threshold, setThreshold] = useState(0.1);
  const [padM, setPadM] = useState(8000);
  const [units, setUnits] = useState<Record<Cat, string>>(PRESETS.SI);
  const [view, setView] = useState<View>("map");
  const [mode, setMode] = useState<Mode>("total");
  const [csvError, setCsvError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const setA = (k: keyof Aquifer) => (v: number) => setAq((a) => ({ ...a, [k]: v }));
  const calcSkin = useMemo(() => hawkinsSkin(aq.permMd, dmg.ksMd, dmg.rsM, aq.wellboreRadiusM), [aq.permMd, aq.wellboreRadiusM, dmg]);
  // Wells actually used in every calculation: skin is either typed per well or computed (Hawkins).
  const wells = useMemo(
    () => (skinMode === "calc" ? rawWells.map((w) => ({ ...w, skin: calcSkin })) : rawWells),
    [rawWells, skinMode, calcSkin],
  );
  const lim = useMemo(() => limits(aq), [aq]);
  const c = useMemo(() => consts(aq), [aq]);
  const tNow = Math.min(tEval, horizon);

  // Display units. Everything above this line works in canonical units; these only convert for display/input.
  const pU = findUnit("pressure", units.pressure);
  const dU = findUnit("distance", units.distance);
  const rU = findUnit("rate", units.rate);
  const P = (v: number, d = 2) => (v / pU.f).toFixed(Math.max(0, d + (pU.dec ?? 0)));
  const pDec = Math.max(0, 2 + (pU.dec ?? 0));
  const D = (v: number) => { const x = v / dU.f; return Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1); };
  const toP = (a: number[]) => a.map((v) => v / pU.f);
  const uf = (cat: Cat, o: { label?: string; ariaLabel?: string; value: number; onChange: (v: number) => void; min?: number; step?: number }) => {
    const un = findUnit(cat, units[cat]);
    return (
      <NumField
        label={o.label} ariaLabel={o.ariaLabel} unit={un.label}
        value={+(o.value / un.f).toPrecision(6)} onChange={(v) => o.onChange(v * un.f)}
        min={o.min !== undefined ? o.min / un.f : undefined} step={o.step !== undefined ? o.step / un.f : undefined}
      />
    );
  };
  const presetName = (["SI", "Field"] as const).find((k) => (Object.keys(PRESETS[k]) as Cat[]).every((c) => PRESETS[k][c] === units[c])) ?? "Custom";

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

  // Time series at each well (wellbore) and monitoring point.
  const series = useMemo(() => {
    const out: Series[] = [];
    const base = mode === "bhp" ? lim.initialMPa : 0; // absolute BHP = initial pressure + buildup
    wells.forEach((w, i) => {
      out.push({
        name: w.name, color: COLORS[i % COLORS.length], x: times,
        y: times.map((t) => base + (mode === "interference" ? totalBuildup(wells, w.x, w.y, t, aq, boundary, c, w.id) : wellboreBuildup(wells, w, t, aq, boundary, c))),
      });
    });
    points.forEach((p, i) => {
      out.push({
        name: p.name, color: "#495057", dash: i % 2 ? "2 4" : "6 4", x: times,
        y: times.map((t) => base + totalBuildup(wells, p.x, p.y, t, aq, boundary, c)),
      });
    });
    if (wells.length > 1) {
      // Field-wide view: all wells together as one pressure envelope and average.
      const wellSeries = out.slice(0, wells.length);
      out.push({ name: mode === "bhp" ? "Field maximum BHP" : "Field maximum", color: "#111111", x: times, y: times.map((_, k) => Math.max(...wellSeries.map((s) => s.y[k]))) });
      out.push({ name: mode === "bhp" ? "Field average BHP" : "Field average", color: "#868e96", dash: "8 3 2 3", x: times, y: times.map((_, k) => wellSeries.reduce((a, s) => a + s.y[k], 0) / wellSeries.length) });
    }
    return out;
  }, [wells, points, times, aq, boundary, c, mode, lim.initialMPa]);

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

  const worst = peaks.reduce((m, p, i) => (p.peak > peaks[m].peak ? i : m), 0);
  const scaleToLimit = peaks.length && peaks[worst].peak > 0 ? lim.maxBuildupMPa / peaks[worst].peak : Infinity;

  // Same wells, three boundary conditions. Bounded cases use the boundary line set in the panel.
  const cases = useMemo(() => {
    const defs: { key: Boundary["type"]; label: string; color: string; dash?: string }[] = [
      { key: "none", label: "Infinite-acting", color: "#2a6fdb" },
      { key: "constant", label: "Constant-pressure boundary", color: "#2f9e44", dash: "6 4" },
      { key: "noflow", label: "No-flow boundary", color: "#d9480f", dash: "2 4" },
    ];
    const cc = consts(aq);
    return defs.map((d) => {
      const b: Boundary = { ...boundary, type: d.key };
      const perWell = wells.map((w) => {
        const ys = times.map((t) => wellboreBuildup(wells, w, t, aq, b, cc));
        const k = ys.reduce((m, v, i) => (v > ys[m] ? i : m), 0);
        return { ys, peak: ys[k], t: times[k] };
      });
      return { ...d, perWell };
    });
  }, [wells, aq, boundary, times]);
  const [cmpWell, setCmpWell] = useState(0);
  const cmpIdx = Math.min(cmpWell, Math.max(wells.length - 1, 0));

  const extent = useMemo(() => {
    const all = [...wells, ...points];
    const xs = all.map((o) => o.x), ys = all.map((o) => o.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), 1000) / 2 + padM;
    return { x0: cx - half, x1: cx + half, y0: cy - half, y1: cy + half };
  }, [wells, points, padM]);

  const grid = useMemo(
    () => (view === "map" && wells.length ? buildupGrid(wells, tNow, aq, boundary, extent) : null),
    [view, wells, tNow, aq, boundary, extent],
  );

  const updWell = (id: string, patch: Partial<Well>) => setWells((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const updPoint = (id: string, patch: Partial<Point>) => setPoints((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      setWells(parseWellsCsv(await file.text()));
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
    rows.push([], [`# Time series (${pU.label}; mode: ${mode})`], ["time_yr", ...series.map((s) => s.name)]);
    times.forEach((t, k) => rows.push([+t.toFixed(4), ...series.map((s) => +(s.y[k] / pU.f).toFixed(5))]));
    rows.push([], ["# Peak check"], ["well", `peak_${pU.label}`, "time_yr", `self_${pU.label}`, `skin_${pU.label}`, `interference_${pU.label}`, `limit_${pU.label}`]);
    wells.forEach((w, i) => rows.push([w.name, +(peaks[i].peak / pU.f).toFixed(4), +peaks[i].t.toFixed(4), ...[peaks[i].self, peaks[i].skin, peaks[i].interference].map((v) => +(v / pU.f).toFixed(4)), +(lim.maxBuildupMPa / pU.f).toFixed(4)]));
    download("co2-interference-results.csv", toCsv(rows));
  };

  const targets = [...wells, ...points];
  const maxOff = Math.max(1e-9, ...matrix.flatMap((r, i) => r.filter((_, j) => j !== i)));

  return (
    <main className="app">
      <header className="top">
        <div>
          <h1>CO₂ Injection Pressure Interference</h1>
          <p className="sub">Multi-well Theis superposition for a confined saline aquifer · screening-level, brine-equivalent</p>
        </div>
        <button onClick={exportResults}>Export results CSV</button>
      </header>

      <div className="layout">
        <aside className="panel">
          <section>
            <div className="row-head">
              <h2>Units</h2>
              <select className="preset" aria-label="Unit preset" value={presetName}
                onChange={(e) => { if (e.target.value !== "Custom") setUnits(PRESETS[e.target.value as "SI" | "Field"]); }}>
                <option value="SI">SI (metric)</option>
                <option value="Field">Field (US oilfield)</option>
                {presetName === "Custom" && <option value="Custom">Custom</option>}
              </select>
            </div>
            <div className="grid2">
              {(Object.keys(UNITS) as Cat[]).map((cat) => (
                <label className="field" key={cat}><span>{CAT_LABELS[cat]}</span>
                  <select value={units[cat]} onChange={(e) => setUnits((u) => ({ ...u, [cat]: e.target.value }))}>
                    {UNITS[cat].map((u) => <option key={u.label} value={u.label}>{u.label}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <p className="hint">Values convert automatically when you change a unit. Time is always in years. CSV import/export always uses metres and Mt/yr.</p>
          </section>

          <section>
            <h2>Aquifer</h2>
            <div className="grid2">
              {uf("perm", { label: "Permeability", value: aq.permMd, onChange: setA("permMd"), min: 0 })}
              {uf("length", { label: "Thickness", value: aq.thicknessM, onChange: setA("thicknessM"), min: 0 })}
              <NumField label="Porosity" unit="frac" value={aq.porosity} onChange={setA("porosity")} step={0.01} min={0} />
              {uf("compress", { label: "Total compress.", value: aq.compressibilityPerMPa, onChange: setA("compressibilityPerMPa"), min: 0 })}
              {uf("viscosity", { label: "Brine viscosity", value: aq.viscosityMPas, onChange: setA("viscosityMPas"), min: 0 })}
              {uf("density", { label: "CO₂ density", value: aq.co2DensityKgM3, onChange: setA("co2DensityKgM3"), min: 1 })}
              {uf("length", { label: "Wellbore radius", value: aq.wellboreRadiusM, onChange: setA("wellboreRadiusM"), min: 0.01 })}
              {uf("length", { label: "Depth", value: aq.depthM, onChange: setA("depthM"), min: 0 })}
            </div>
            <p className="hint">Diffusivity η = {c.eta.toFixed(2)} m²/s</p>
          </section>

          <section>
            <h2>Pressure limit</h2>
            <div className="grid2">
              {uf("gradient", { label: "Hydrostatic grad.", value: aq.hydroGradientMPaPerM, onChange: setA("hydroGradientMPaPerM") })}
              {uf("gradient", { label: "Fracture grad.", value: aq.fracGradientMPaPerM, onChange: setA("fracGradientMPaPerM") })}
              <NumField label="Safety factor" unit="× Pfrac" value={aq.safetyFactor} onChange={setA("safetyFactor")} step={0.05} />
              {uf("pressure", { label: "Interference threshold", value: threshold, onChange: setThreshold })}
            </div>
            <p className="hint">
              P₀ {P(lim.initialMPa, 1)} {pU.label} · P<sub>frac</sub> {P(lim.fractureMPa, 1)} {pU.label} · max buildup <b>{P(lim.maxBuildupMPa)} {pU.label}</b>
            </p>
          </section>

          <section>
            <h2>Well skin</h2>
            <div className="grid2">
              <label className="field"><span>Skin source</span>
                <select value={skinMode} onChange={(e) => setSkinMode(e.target.value as "manual" | "calc")}>
                  <option value="calc">Calculate (Hawkins damaged zone)</option>
                  <option value="manual">Enter per well</option>
                </select>
              </label>
              <span />
              {skinMode === "calc" && (
                <>
                  {uf("perm", { label: "Damaged-zone perm. ks", value: dmg.ksMd, onChange: (v) => setDmg((d) => ({ ...d, ksMd: v })), min: 0.001 })}
                  {uf("length", { label: "Damaged-zone radius rs", value: dmg.rsM, onChange: (v) => setDmg((d) => ({ ...d, rsM: v })), min: 0 })}
                </>
              )}
            </div>
            <p className="hint">
              {skinMode === "calc"
                ? <>s = (k/ks − 1)·ln(rs/rw) = <b>{calcSkin.toFixed(2)}</b> for all wells (ks &lt; k is damage, ks &gt; k is stimulation).</>
                : "Type a skin value for each well in the table below."}
            </p>
          </section>

          <section>
            <h2>Boundary condition</h2>
            <div className="grid2">
              <label className="field"><span>Type</span>
                <select value={boundary.type} onChange={(e) => setBoundary({ ...boundary, type: e.target.value as Boundary["type"] })}>
                  <option value="none">None (infinite)</option>
                  <option value="noflow">Sealing fault (no-flow)</option>
                  <option value="constant">Constant pressure</option>
                </select>
              </label>
              <label className="field"><span>Line</span>
                <select value={boundary.axis} disabled={boundary.type === "none"} onChange={(e) => setBoundary({ ...boundary, axis: e.target.value as "x" | "y" })}>
                  <option value="x">x = const</option>
                  <option value="y">y = const</option>
                </select>
              </label>
              {uf("distance", { label: "Position", value: boundary.positionM, onChange: (v) => setBoundary({ ...boundary, positionM: v }) })}
            </div>
            <p className="hint">The Compare boundaries tab runs all three conditions side by side using this line.</p>
          </section>

          <section>
            <div className="row-head">
              <h2>Injection wells</h2>
              <div className="btns">
                <button className="ghost" onClick={() => fileRef.current?.click()}>Import CSV</button>
                <button className="ghost" onClick={() => download("wells.csv", wellsToCsv(wells))}>Export</button>
              </div>
            </div>
            <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" hidden onChange={(e) => onImport(e.target.files?.[0])} />
            {csvError && <p className="err">{csvError}</p>}
            <div className="tablewrap">
              <table className="edit">
                <thead><tr><th>Name</th><th>x ({dU.label})</th><th>y ({dU.label})</th><th>{rU.label}</th><th>Start</th><th>End</th><th>Skin</th><th /></tr></thead>
                <tbody>
                  {wells.map((w) => (
                    <tr key={w.id}>
                      <td><input value={w.name} aria-label="Well name" onChange={(e) => updWell(w.id, { name: e.target.value })} /></td>
                      <td>{uf("distance", { ariaLabel: `${w.name} x`, value: w.x, onChange: (v) => updWell(w.id, { x: v }) })}</td>
                      <td>{uf("distance", { ariaLabel: `${w.name} y`, value: w.y, onChange: (v) => updWell(w.id, { y: v }) })}</td>
                      <td>{uf("rate", { ariaLabel: `${w.name} rate`, value: w.rateMtpa, onChange: (v) => updWell(w.id, { rateMtpa: v }), min: 0 })}</td>
                      <td><NumField ariaLabel={`${w.name} start`} value={w.startYr} onChange={(v) => updWell(w.id, { startYr: v })} min={0} /></td>
                      <td><NumField ariaLabel={`${w.name} end`} value={w.endYr} onChange={(v) => updWell(w.id, { endYr: v })} min={0} /></td>
                      <td>{skinMode === "calc"
                        ? <span className="calc" title="Calculated from the damaged-zone inputs">{w.skin.toFixed(2)}</span>
                        : <NumField ariaLabel={`${w.name} skin`} value={w.skin} onChange={(v) => updWell(w.id, { skin: v })} />}</td>
                      <td><button className="x" aria-label={`Remove ${w.name}`} onClick={() => setWells((ws) => ws.filter((q) => q.id !== w.id))}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="ghost" onClick={() => setWells((ws) => [...ws, { id: uid("w"), name: `INJ-${ws.length + 1}`, x: 0, y: 0, rateMtpa: 1, startYr: 0, endYr: 25, skin: 0 }])}>+ Add well</button>
            <p className="hint">CSV columns (always metres and Mt/yr): name, x_m, y_m, rate_Mtpa, start_yr, end_yr, skin (optional). Excel: save as CSV.</p>
          </section>

          <section>
            <h2>Monitoring points</h2>
            <div className="tablewrap">
              <table className="edit">
                <thead><tr><th>Name</th><th>x ({dU.label})</th><th>y ({dU.label})</th><th /></tr></thead>
                <tbody>
                  {points.map((p) => (
                    <tr key={p.id}>
                      <td><input value={p.name} aria-label="Point name" onChange={(e) => updPoint(p.id, { name: e.target.value })} /></td>
                      <td>{uf("distance", { ariaLabel: `${p.name} x`, value: p.x, onChange: (v) => updPoint(p.id, { x: v }) })}</td>
                      <td>{uf("distance", { ariaLabel: `${p.name} y`, value: p.y, onChange: (v) => updPoint(p.id, { y: v }) })}</td>
                      <td><button className="x" aria-label={`Remove ${p.name}`} onClick={() => setPoints((ps) => ps.filter((q) => q.id !== p.id))}>×</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <button className="ghost" onClick={() => setPoints((ps) => [...ps, { id: uid("p"), name: `Point ${ps.length + 1}`, x: 0, y: 0 }])}>+ Add point</button>
          </section>
        </aside>

        <section className="results">
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
              <span>Status</span>
              <b>{wells.length && peaks[worst].peak > lim.maxBuildupMPa ? "Limit exceeded" : "Within limit"}</b>
              <small>{Number.isFinite(scaleToLimit) ? `rates can scale ×${scaleToLimit.toFixed(2)} to reach limit` : ""}</small>
            </div>
          </div>

          <nav className="tabs" role="tablist">
            {([["map", "Pressure map"], ["series", "Time series"], ["matrix", "Interference matrix"], ["limits", "Limit check"], ["compare", "Compare boundaries"]] as [View, string][]).map(([v, l]) => (
              <button key={v} role="tab" aria-selected={view === v} className={view === v ? "on" : ""} onClick={() => setView(v)}>{l}</button>
            ))}
          </nav>

          <div className="controls">
            <NumField label="Horizon" unit="yr" value={horizon} onChange={(v) => setHorizon(Math.max(1, v))} min={1} />
            <label className="field slider"><span>Evaluation time <em>{tNow.toFixed(1)} yr</em></span>
              <input type="range" min={0.1} max={horizon} step={0.1} value={tNow} onChange={(e) => setTEval(+e.target.value)} />
            </label>
            {view === "map" && uf("distance", { label: "Map padding", value: padM, onChange: (v) => setPadM(Math.max(0, v)), min: 0 })}
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

          {view === "map" && grid && (
            <>
              <MapView
                grid={grid} wells={wells} points={points} boundary={boundary}
                pf={pU.f} pLabel={pU.label} pDec={pDec} df={dU.f} dLabel={dU.label}
                contourLevels={[
                  { level: threshold, label: "threshold", cls: "iso-thr" },
                  ...(lim.maxBuildupMPa > 0 ? [{ level: lim.maxBuildupMPa, label: "limit", cls: "iso-lim" }] : []),
                ]}
              />
              <p className="caption">
                Buildup at {tNow.toFixed(1)} yr. <span className="key thr" /> {P(threshold, 3)} {pU.label} threshold contour · <span className="key lim" /> {P(lim.maxBuildupMPa)} {pU.label} allowable-buildup contour (appears only near the wells).
              </p>
            </>
          )}

          {view === "series" && (
            <>
              <LineChart
                series={series.map((s) => ({ ...s, y: toP(s.y) }))} xLabel="Time (years)"
                yLabel={mode === "bhp" ? `Bottomhole pressure (${pU.label})` : `Pressure buildup, ${mode === "total" ? "total" : "interference"} (${pU.label})`}
                hline={mode === "bhp" ? { y: (lim.initialMPa + lim.maxBuildupMPa) / pU.f, label: `max allowable BHP ${P(lim.initialMPa + lim.maxBuildupMPa, 1)} ${pU.label}` }
                  : mode === "total" && lim.maxBuildupMPa > 0 ? { y: lim.maxBuildupMPa / pU.f, label: "allowable buildup" } : undefined}
                yMin={mode === "bhp" ? Math.floor(lim.initialMPa / pU.f) : 0}
                markerX={tNow}
              />
              <ul className="swatches">
                {series.map((s) => <li key={s.name}><i style={{ background: s.color }} />{s.name}</li>)}
              </ul>
              {wells.length > 0 && (
                <>
                  <h3>What drives the field maximum</h3>
                  <p className="caption">
                    At each time the well with the highest pressure is the controlling well. The chart splits its buildup into the share caused by each injector (its own injection is the layer with its own name) plus skin. Add {P(lim.initialMPa, 1)} {pU.label} for absolute BHP.
                  </p>
                  <StackedChart layers={fieldDrivers.layers.map((l) => ({ ...l, y: toP(l.y) }))} xLabel="Time (years)" yLabel={`Field-maximum buildup by source (${pU.label})`} />
                  <ul className="swatches">
                    {fieldDrivers.layers.map((l) => <li key={l.name}><i style={{ background: l.color, height: 10 }} />{l.name}</li>)}
                  </ul>
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
              <p className="caption">Wells are evaluated at the wellbore radius; dashed lines are monitoring points. Bottomhole pressure = initial pressure + own buildup + skin + interference from every other well; the field lines show the highest and the average BHP across all wells at each time. Interference-only removes each well&apos;s own contribution at its own location.</p>
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
              {wells.length > 0 && (
                <>
                  <LineChart
                    series={cases.map((k) => ({ name: k.label, color: k.color, dash: k.dash, x: times, y: toP(k.perWell[cmpIdx].ys) }))}
                    xLabel="Time (years)" yLabel={`${wells[cmpIdx].name} wellbore buildup incl. skin (${pU.label})`}
                    hline={lim.maxBuildupMPa > 0 ? { y: lim.maxBuildupMPa / pU.f, label: "allowable buildup" } : undefined}
                  />
                  <ul className="swatches">{cases.map((k) => <li key={k.key}><i style={{ background: k.color }} />{k.label}</li>)}</ul>
                </>
              )}
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
        </section>
      </div>
    </main>
  );
}
