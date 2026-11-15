"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import ChartView from "@/components/ChartView";
import NumField from "@/components/NumField";
import { COLORMAP_LABELS, render, type ChartSpec, type MapStyle, type Series } from "@/lib/charts";
import { parseWellsCsv, toCsv, download, wellsToCsv, type PointIn, type WellIn } from "@/lib/csv";
import { centroid, project as projectXY, unproject, validLatLon } from "@/lib/geo";
import { downloadBlob, svgToPngDataUrl } from "@/lib/exportImage";
import { injectedRateYears, limits, sourcesFor, timeGrid, type Boundary, type Point, type Well } from "@/lib/physics";
import {
  BROWSER_PHASES, DEFAULT_INPUTS, DETAIL_FIELDS, calculateFirstYearDetail, calculateObservation, modelLabel, observationSchedule, outputFiles, parsePyFloat, pyFormat, pyStr,
  P_SC_PSIA, T_SC_F, coreyFrontQuantities, gasProperties, isInt, prState, pressureLimitSummary, runModel, summaryColumns, validate, waterProperties, withPressureLimit,
  type Inputs as BhpInputs, type LimitInput, type Row, type RunOutput,
} from "@/lib/bhp";
import { renderBhpPlot } from "@/lib/bhpPlot";
import {
  configureWellGeometry, cumulativeRateDays, makeWell, multiwellCalculation, multiwellFiles, runMultiwell, wellSeparations,
  type GeometryInput, type Images, type MWell, type MultiwellRun,
} from "@/lib/multiwell";
import { MultiwellField } from "@/lib/mwfield";
import { renderMultiwellMatrix, renderMultiwellPressure } from "@/lib/multiwellPlot";
import { buildBlocks, renderDocx, renderPdf, type FigureData, type ReportData } from "@/lib/report";
import { makeSatModel, satGrid, type SatParams } from "@/lib/saturation";
import { CAT_LABELS, CO2_T_PER_MSCF, PRESETS, PSI, UNITS, findUnit, fromCanon, toCanon, type Cat } from "@/lib/units";

const COLORS = ["#2a6fdb", "#d9480f", "#2f9e44", "#9c36b5", "#c2255c", "#1098ad", "#e8890c", "#5c677d"];
const FT = 0.3048;
const LB_FT3 = 0.45359237 / FT ** 3; // kg/m3 per lb/ft3

/** Pressure model: the three options of the reference program (lib/bhp.ts). */
type ModelKind = "two" | "co2" | "water";
/** Well system of the program: one well (single-well section) or several (multiwell interference section). */
type System = "single" | "multi";

/** Reservoir and operating inputs, stored in canonical SI units (m, mD, MPa, deg C). */
interface Reservoir {
  permMd: number;
  thicknessM: number;
  porosity: number;
  wellboreRadiusM: number;
  initialMPa: number; // initial absolute pressure
  tempC: number;
}

/** The program's pressure check (absolute pressures, MPa). */
interface LimitIn {
  mode: "none" | "max_bhp" | "fracture_fraction";
  maxBhpMPa: number;
  fractureMPa: number;
  fraction: number;
}

/** Distances between the wells, as in the program's multiwell form (distances in metres; text lists in the display unit). */
interface GeometryIn {
  mode: "constant" | "different";
  layout: "line" | "grid";
  spacingM: number;
  method: "adjacent" | "pairwise" | "coordinates";
  adjacent: string;
  matrix: string;
}

/** Fluid and rock-fluid inputs of the reference program (canonical units: cP, kg/m3, 1/MPa). CO2 viscosity, salinity,
 * brine density at reservoir conditions and water compressibility are calculated by the program, not entered. */
interface Fluids {
  muWater: number;
  /** measured brine density at standard conditions (60 °F, 14.696 psia); the salinity follows from it */
  brineDensityKgM3: number;
  swr: number;
  rockComp: number;
  krg0: number;
  krw0: number;
  krg1: number;
  ng: number;
  nw: number;
  evaporation: boolean;
  /** two-phase: equilibrium CO2 dissolution in the zone 2 brine */
  dissolution: boolean;
}

const B0 = DEFAULT_INPUTS;
const DEFAULT_RES: Reservoir = {
  permMd: B0.k_mD, thicknessM: B0.h_ft * FT, porosity: B0.porosity, wellboreRadiusM: B0.rw_ft * FT,
  initialMPa: B0.initial_pressure_psia * PSI, tempC: ((B0.temperature_F - 32) * 5) / 9,
};
const DEFAULT_LIMIT: LimitIn = { mode: "fracture_fraction", maxBhpMPa: 4680 * PSI, fractureMPa: 5200 * PSI, fraction: 0.9 };
const DEFAULT_GEOMETRY: GeometryIn = { mode: "constant", layout: "line", spacingM: 1000 * FT, method: "adjacent", adjacent: "", matrix: "" };
const DEFAULT_FL: Fluids = {
  muWater: B0.mu_water_cP, brineDensityKgM3: B0.brine_standard_density_lb_ft3 * LB_FT3,
  swr: B0.Swr, rockComp: B0.rock_compressibility_per_psi / PSI,
  krg0: B0.krg_endpoint, krw0: B0.krw_endpoint, krg1: B0.krg_zone1, ng: B0.corey_n_gas, nw: B0.corey_n_water,
  evaporation: B0.include_evaporation,
  dissolution: B0.include_dissolution,
};

/** Reference-program inputs (field units) from the page inputs. Rates and skin are per well (multiwell: also the radius,
 * which keeps the program's default in the shared inputs, as its multiwell form). */
function toBhp(r: Reservoir, f: Fluids, model: ModelKind, system: System = "single"): BhpInputs {
  return {
    ...B0,
    k_mD: r.permMd, h_ft: r.thicknessM / FT, rw_ft: system === "multi" ? B0.rw_ft : r.wellboreRadiusM / FT, porosity: r.porosity,
    initial_pressure_psia: r.initialMPa / PSI, temperature_F: (r.tempC * 9) / 5 + 32,
    mu_water_cP: f.muWater, brine_standard_density_lb_ft3: f.brineDensityKgM3 / LB_FT3,
    Swr: f.swr, rock_compressibility_per_psi: f.rockComp * PSI,
    krg_endpoint: f.krg0, krw_endpoint: f.krw0, krg_zone1: f.krg1, corey_n_gas: f.ng, corey_n_water: f.nw, skin: 0,
    phase_mode: model === "two" ? "two" : "single", single_phase_fluid: model === "water" ? "water" : "co2",
    include_evaporation: f.evaporation,
    include_dissolution: model === "two" && !!f.dissolution,
  };
}

/** The program's background properties at the initial pressure (calculated, never entered); null where not used. */
interface BackgroundProps {
  muGas: number | null; // cP
  cw: number | null; // 1/psi
  ppm: number | null; // salinity, mass ppm
  rhoW: number | null; // brine density at initial pressure, lb/ft3
  error: string | null;
}
function backgroundProps(b: BhpInputs): BackgroundProps {
  try {
    const water = b.phase_mode === "single" && b.single_phase_fluid === "water";
    const w = b.phase_mode === "two" || water ? waterProperties(b.initial_pressure_psia, b) : null;
    const muGas = water ? null : gasProperties(b.initial_pressure_psia, b.temperature_F, prState(P_SC_PSIA, T_SC_F).Z).mu_gas_cP;
    return { muGas, cw: w ? w.cw_per_psi : null, ppm: w ? w.salinity_ppm : null, rhoW: w ? w.rho_water_lb_ft3 : null, error: null };
  } catch (e) {
    return { muGas: null, cw: null, ppm: null, rhoW: null, error: e instanceof Error ? e.message : String(e) };
  }
}

/** The program's default multiwell table: 4 wells, 150 Mscf/day, start year 0, radius 0.55 ft, skin 0 (1000 ft apart). */
const newWellIn = (i: number, x = i * 1000 * FT, y = 0): WellIn => ({
  id: `w${i + 1}`, name: `Well ${i + 1}`, x, y, rate: 150, startYr: 0, endYr: 30, skin: 0, skinText: "",
  rwM: B0.rw_ft * FT, evaporation: "inherit", maxBhpMPa: null,
});
const DEFAULT_WELLS: WellIn[] = [0, 1, 2, 3].map((i) => newWellIn(i));
const DEFAULT_POINTS: PointIn[] = [{ id: "p1", name: "Legacy well", x: 2500, y: -1500 }];

type View = "mw" | "sat" | "map" | "series" | "bhp" | "matrix" | "limits" | "compare";
type Mode = "total" | "interference" | "bhp";

/** Everything the analysis depends on. Results are computed from the snapshot taken when RUN is pressed. */
interface Inputs {
  system: System;
  res: Reservoir;
  fl: Fluids;
  model: ModelKind;
  limit: LimitIn;
  /** single well: rate (Mscf/day or STB/day), skin and whole injection years */
  single: { rate: number; skin: number; years: number };
  /** multiwell: project endpoint (the last end year), reporting times and the distance definition */
  years: string;
  reportTimes: string;
  geometry: GeometryIn;
  boundary: Boundary;
  wells: (Well & { lon?: number; lat?: number })[];
  points: (Point & { lon?: number; lat?: number })[];
  horizon: number; // last end year + observation duration (calculated)
  threshold: number;
  observe: "yes" | "no";
  obsPeriod: string;
  obsYears: string;
  geo: { on: boolean; lat0: number; lon0: number };
  project: string;
  author: string;
  /** the program's well table (field units) and distance definition, as passed to configure_well_geometry */
  mwells: MWell[];
  geomInput: GeometryInput;
}

let seq = 100;
const uid = (p: string) => `${p}${seq++}`;
const num = (v: number) => String(+v.toPrecision(5));
const roundLL = (g: { lat: number; lon: number }) => ({ lat: +g.lat.toFixed(5), lon: +g.lon.toFixed(5) });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

async function fontBase64(url: string): Promise<string> {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(bin);
}

/** `_notebook_summary_html`: a table of the program with its column labels and number formats. */
function SummaryTable({ rows }: { rows: Row[] }) {
  const cols = summaryColumns(rows);
  return (
    <div className="bhp-summary-wrap">
      <table className="bhp-summary">
        <thead><tr>{cols.map(([label]) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{cols.map(([, key, fmt]) => <td key={key}>{fmt === "" || typeof r[key] !== "number" ? pyStr(r, key) : pyFormat(r[key], fmt)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** A CSV file of the program shown as a table (values printed as the Python writes them). */
function FileTable({ columns, rows }: { columns: string[]; rows: Row[] }) {
  return (
    <div className="bhp-summary-wrap">
      <table className="bhp-summary">
        <thead><tr>{columns.map((c) => <th key={c}>{c}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{columns.map((c) => <td key={c}>{c in r ? pyStr(r, c) : ""}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

/** A table of the program's multiwell form: floats with a fixed format, everything else as str(). */
function PyTable({ cols, rows, fmt = ".6f" }: { cols: [string, string][]; rows: Row[]; fmt?: string }) {
  return (
    <div className="bhp-summary-wrap">
      <table className="bhp-summary">
        <thead><tr>{cols.map(([label]) => <th key={label}>{label}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{cols.map(([, key]) => {
          const v = r[key];
          const text = typeof v === "number" && !isInt(r, key) ? pyFormat(v, fmt) : pyStr(r, key);
          return <td key={key} className={v === "FAIL" ? "bad-cell" : v === "PASS" ? "good-cell" : ""}>{text}</td>;
        })}</tr>)}</tbody>
      </table>
    </div>
  );
}

const MW_SUMMARY_COLS: [string, string][] = [["Year", "year"], ["Well", "well"], ["BHP (psia)", "BHP_psia"], ["Own formation (psi)", "own_formation_response_psi"], ["Skin (psi)", "own_skin_psi"], ["Interference (psi)", "interference_psi"], ["Limit status", "pressure_limit_status"], ["Pressure margin (psi)", "pressure_margin_psi"]];
const MW_OBS_COLS: [string, string][] = [["Years after shut-in", "years_after_shut_in"], ...MW_SUMMARY_COLS.filter(([, k]) => k !== "own_skin_psi")];
const FAILURE_COLS: [string, string][] = [["Well", "well"], ["Overall status", "overall_status"], ["Peak BHP (psia)", "peak_BHP_psia"], ["Allowed BHP (psia)", "max_allowable_BHP_psia"], ["First sampled exceedance (year)", "first_detected_failure_year"]];

export default function Page() {
  // ---- live (editable) inputs ----
  const [systemL, setSystemRaw] = useState<System>("multi");
  const [resL, setRes] = useState(DEFAULT_RES);
  const [flL, setFl] = useState(DEFAULT_FL);
  const [modelL, setModel] = useState<ModelKind>("two");
  const [boundaryL, setBoundary] = useState<Boundary>({ type: "none", axis: "x", positionM: 3000 });
  const [rawWells, setWells] = useState(DEFAULT_WELLS);
  const [geomL, setGeom] = useState<GeometryIn>(DEFAULT_GEOMETRY);
  const [reportL, setReportL] = useState(""); // multiwell reporting times (blank = annual)
  const [singleL, setSingle] = useState({ rate: 150, skin: 0, years: 30 });
  // multiwell well radius: one value for all wells, or a value for each well (column of the well table)
  const [rwModeL, setRwMode] = useState<"same" | "each">("same");
  const [rwAllL, setRwAll] = useState(B0.rw_ft * FT);
  const [limitL, setLimitL] = useState<LimitIn>(DEFAULT_LIMIT);
  const [coordMode, setCoordMode] = useState<"local" | "geo">("local");
  const [geoRef] = useState({ lat: 29.7604, lon: -95.3698 }); // example location, used when first switching to lon/lat
  const [boundaryDeg, setBoundaryDeg] = useState(-95.3);
  const [pointsL, setPoints] = useState(DEFAULT_POINTS);
  const [thresholdL, setThreshold] = useState(1 * PSI); // 1 psi
  // post-shut-in observation, asked as in the program's form
  const [observeL, setObserve] = useState<"yes" | "no">("yes");
  const [obsPeriodL, setObsPeriod] = useState("10");
  const [obsYearsL, setObsYears] = useState("0, 0.5, 1, 5, 10");
  const [project, setProject] = useState("");
  const [author, setAuthor] = useState("");
  const [units, setUnits] = useState<Record<Cat, string>>(PRESETS.Field);
  // ---- display-only state (acts on results that were already computed) ----
  const [tEval, setTEval] = useState(30);
  const [padM, setPadM] = useState<number | null>(null); // map padding around the wells; null = automatic
  const [mapArea, setMapArea] = useState<"wells" | "all">("wells"); // fit the maps to the wells, or also to the monitoring points
  const [view, setView] = useState<View>("mw");
  const [inTab, setInTab] = useState("system");
  const [mode, setMode] = useState<Mode>("bhp");
  const [cmpWell, setCmpWell] = useState(0);
  const [bhpWell, setBhpWell] = useState(0);
  const DEFAULT_MAP_STYLE: MapStyle = { cmap: "sunset", reverse: false, fill: "smooth", bands: 10, contours: false, nContours: 10, contourLabels: true, contourSource: "wells", contourReach: 0.35, streamlines: false };
  const [mapStyle, setMapStyle] = useState<MapStyle>(DEFAULT_MAP_STYLE);
  const setStyle = (patch: Partial<MapStyle>) => setMapStyle((m) => ({ ...m, ...patch }));
  const [csvError, setCsvError] = useState("");
  const [busy, setBusy] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const setR = (k: keyof Reservoir) => (v: number) => setRes((a) => ({ ...a, [k]: v }));
  const setF = (k: keyof Fluids) => (v: number) => setFl((a) => ({ ...a, [k]: v }));
  const multiL = systemL === "multi";
  const coordsEditable = multiL && geomL.mode === "different" && geomL.method === "coordinates";
  const isGeo = coordMode === "geo" && coordsEditable;
  // Projection origin for lon/lat input: the centroid of all entered locations.
  const origin = useMemo(
    () => (isGeo ? centroid([...rawWells, ...pointsL].filter((o) => o.lon !== undefined && o.lat !== undefined).map((o) => ({ lat: o.lat as number, lon: o.lon as number }))) : null),
    [isGeo, rawWells, pointsL],
  );
  const toXY = (o: { x: number; y: number; lon?: number; lat?: number }) =>
    isGeo && origin && o.lon !== undefined && o.lat !== undefined ? projectXY(o.lat, o.lon, origin.lat, origin.lon) : { x: o.x, y: o.y };
  /* eslint-disable react-hooks/exhaustive-deps */
  const tableWells = useMemo(() => rawWells.map((w) => {
    const t = w.skinText.trim();
    return {
      ...w, ...toXY(w), skin: t !== "" && Number.isFinite(Number(t)) ? Number(t) : 0, // blank skin = 0
      rwM: rwModeL === "same" ? rwAllL : w.rwM ?? B0.rw_ft * FT, // the same radius for all wells, or each well's own
    };
  }), [rawWells, isGeo, origin, rwModeL, rwAllL]);
  const pointsP = useMemo(() => pointsL.map((p) => ({ ...p, ...toXY(p) })), [pointsL, isGeo, origin]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const boundaryEff: Boundary = useMemo(() => {
    if (!isGeo || !origin) return boundaryL;
    const m = boundaryL.axis === "x" ? projectXY(origin.lat, boundaryDeg, origin.lat, origin.lon).x : projectXY(boundaryDeg, origin.lon, origin.lat, origin.lon).y;
    return { ...boundaryL, positionM: m };
  }, [isGeo, origin, boundaryL, boundaryDeg]);
  const limL = useMemo(() => limits({ initialMPa: resL.initialMPa, ...limitL }), [resL.initialMPa, limitL]);
  const geoBad = isGeo && [...rawWells, ...pointsL].some((o) => !validLatLon(o.lat ?? 0, o.lon ?? 0));

  // live check of the model inputs with the program's own rules
  const bhpL = useMemo(() => toBhp(resL, flL, modelL, systemL), [resL, flL, modelL, systemL]);
  const dUL = findUnit("distance", units.distance);
  const pUL = findUnit("pressure", units.pressure);
  /** A distance list typed in the display unit, as the program's ft (left as typed when it is not numeric, so the program reports it). */
  const listToFt = (text: string) => {
    const parts = text.replace(/;/g, ",").replace(/\n/g, ",").split(",").map((v) => v.trim()).filter(Boolean);
    const nums = parts.map(Number);
    return nums.some((v) => !Number.isFinite(v)) ? text : nums.map((v) => toCanon(dUL, v) / FT);
  };
  const matrixToFt = (text: string) => {
    const rows = text.trim().split(/\r?\n/).filter((r) => r.trim()).map((r) => r.split(",").map((v) => Number(v.trim())));
    return rows.flat().some((v) => !Number.isFinite(v)) ? text : rows.map((r) => r.map((v) => toCanon(dUL, v) / FT));
  };
  const geomInputL: GeometryInput = useMemo(() => ({
    number: rawWells.length, mode: geomL.mode, layout: geomL.layout, spacing_ft: geomL.spacingM / FT, different_input: geomL.method,
    adjacent_distances_ft: geomL.adjacent.trim() ? listToFt(geomL.adjacent) : null,
    pairwise_distances_ft: geomL.matrix.trim() ? matrixToFt(geomL.matrix) : null,
  }), [rawWells.length, geomL, dUL]); // eslint-disable-line react-hooks/exhaustive-deps
  // the program's well table (field units) from the page table
  const toMWell = (w: Well, p: BhpInputs, rwDefaultM: number, model: ModelKind): MWell => {
    const changes = (w.changes ?? []).filter((c) => c.yr > w.startYr).sort((x, y) => x.yr - y.yr);
    return makeWell({
      name: w.name, x_ft: w.x / FT, y_ft: w.y / FT, rate: w.rate, start_year: w.startYr, rw_ft: (w.rwM ?? rwDefaultM) / FT, skin: w.skin,
      include_evaporation: model === "two" && w.evaporation && w.evaporation !== "inherit" ? w.evaporation === "on" : null,
      rate_schedule: p.phase_mode === "single" && changes.length ? [{ year: w.startYr, rate: w.rate }, ...changes.map((c) => ({ year: c.yr, rate: c.rate }))] : null,
      max_bhp_psia: w.maxBhpMPa !== null && w.maxBhpMPa !== undefined ? w.maxBhpMPa / PSI : null,
      end_year: w.endYr, // each well's own end year (the program's endpoint is the last of them)
    });
  };
  const mwellsL = useMemo(() => tableWells.map((w) => toMWell(w, bhpL, resL.wellboreRadiusM, modelL)), [tableWells, bhpL, resL.wellboreRadiusM, modelL]); // eslint-disable-line react-hooks/exhaustive-deps
  // the program's configure_well_geometry: the positions used for the run (and the separation preview)
  const layoutL = useMemo(() => {
    if (!multiL) return { wells: [] as MWell[], error: "" };
    try {
      return { wells: configureWellGeometry(bhpL, mwellsL, geomInputL).wells, error: "" };
    } catch (e) {
      return { wells: mwellsL, error: errText(e) };
    }
  }, [multiL, bhpL, mwellsL, geomInputL]);
  // the project endpoint is the last end year of the wells (observation starts after the last well stops)
  const endpointL = useMemo(() => Math.max(...rawWells.map((w) => w.endYr)), [rawWells]);
  const yearsL = String(endpointL);
  // the wells of the run, in page units (metres): multiwell = the configured layout, all wells inject until the endpoint
  const wellsL: Well[] = useMemo(() => {
    if (!multiL) {
      const w0 = rawWells[0];
      return [{ id: w0.id, name: w0.name, x: 0, y: 0, rate: singleL.rate, startYr: 0, endYr: singleL.years, skin: singleL.skin, rwM: resL.wellboreRadiusM, evaporation: "inherit", maxBhpMPa: null }];
    }
    return tableWells.map((w, i) => ({ ...w, x: (layoutL.wells[i]?.x_ft ?? w.x / FT) * FT, y: (layoutL.wells[i]?.y_ft ?? w.y / FT) * FT }));
  }, [multiL, rawWells, singleL, resL.wellboreRadiusM, tableWells, layoutL]);
  // observation duration (program rules): a positive number of years when observation is on
  const obsCheck = useMemo(() => {
    if (observeL === "no") return { period: 0, offsets: [] as number[], error: "" };
    let period = NaN;
    try { period = parsePyFloat(obsPeriodL); } catch { return { period: 0, offsets: [], error: "Enter a positive observation duration in years." }; }
    if (!Number.isFinite(period) || period <= 0) return { period: 0, offsets: [], error: "Enter a positive, finite observation duration in years." };
    try {
      return { period, offsets: observationSchedule(period, obsYearsL.trim()).offsets.map((o) => o.v), error: "" };
    } catch (e) {
      return { period, offsets: [], error: errText(e) };
    }
  }, [observeL, obsPeriodL, obsYearsL]);
  const limitSpec = (l: LimitIn): LimitInput => ({ mode: l.mode, max_bhp_psia: l.maxBhpMPa / PSI, fracture_pressure_psia: l.fractureMPa / PSI, fraction: l.fraction });
  const liveError = useMemo(() => {
    try {
      validate({ ...bhpL, q_Mscf_day: 1, water_rate_stb_day: 1 });
      if (obsCheck.error) return obsCheck.error;
      if (!multiL) {
        if (!Number.isInteger(singleL.years) || singleL.years < 1) return "Number of years must be a positive integer.";
        if (!(singleL.rate > 0)) return `${modelL === "water" ? "water_rate_stb_day" : "q_Mscf_day"} must be greater than zero.`;
        return "";
      }
      const bad = rawWells.find((w) => !(Number.isFinite(w.endYr) && w.endYr > w.startYr));
      if (bad) return `${bad.name}: end year must be after the start year.`;
      return layoutL.error;
    } catch (e) {
      return errText(e);
    }
  }, [bhpL, obsCheck.error, multiL, singleL, modelL, rawWells, layoutL.error]);
  // results run from year 0 to the end of injection, plus the observation period after it
  const horizonL = Math.max(0.1, multiL ? (Number.isFinite(endpointL) ? endpointL : 0) : singleL.years) + obsCheck.period;

  const inputsL: Inputs = useMemo(() => ({
    system: systemL, res: resL, fl: flL, model: modelL, limit: limitL, single: singleL, years: yearsL, reportTimes: reportL, geometry: geomL,
    boundary: boundaryEff, wells: wellsL, points: pointsP, horizon: horizonL, threshold: thresholdL, observe: observeL, obsPeriod: obsPeriodL, obsYears: obsYearsL,
    geo: { on: isGeo, lat0: origin?.lat ?? 0, lon0: origin?.lon ?? 0 }, project, author,
    mwells: mwellsL, geomInput: geomInputL,
  }), [systemL, resL, flL, modelL, limitL, singleL, yearsL, reportL, geomL, boundaryEff, wellsL, pointsP, horizonL, thresholdL, observeL, obsPeriodL, obsYearsL, isGeo, origin, project, author, mwellsL, geomInputL]);

  // ---- RUN ----
  const [applied, setApplied] = useState<Inputs | null>(null);
  const [runId, setRunId] = useState(0);
  const runNow = () => { if (obsCheck.error) return; setApplied(inputsL); setRunId((n) => n + 1); };
  // Names are cosmetic (they update everywhere without a new RUN), so they are ignored when checking for stale results.
  const sig = (i: Inputs) => JSON.stringify({ ...i, wells: i.wells.map(({ name, ...r }) => (void name, r)), points: i.points.map(({ name, ...r }) => (void name, r)), mwells: i.mwells.map(({ name, ...r }) => (void name, r)) });
  const stale = useMemo(() => applied !== null && sig(applied) !== sig(inputsL), [applied, inputsL]); // eslint-disable-line react-hooks/exhaustive-deps
  const cur = applied ?? inputsL; // before the first RUN nothing is displayed; this only keeps the hooks well-defined
  const { res, fl, model, boundary, horizon, threshold, geo } = cur;
  const multi = cur.system === "multi";
  const bhpIn = useMemo(() => toBhp(res, fl, model, cur.system), [res, fl, model, cur.system]);
  // Well and point names follow the editable tables immediately; everything else comes from the last run.
  const wellNameKey = rawWells.map((w) => `${w.id}${w.name}`).join("");
  const pointNameKey = pointsL.map((q) => `${q.id}${q.name}`).join("");
  /* eslint-disable react-hooks/exhaustive-deps */
  // Nothing is calculated before the first RUN (no wells), so typing in the inputs stays fast.
  const wells = useMemo(() => { if (!applied) return []; const m = new Map(rawWells.map((w) => [w.id, w.name])); return cur.wells.map((w) => ({ ...w, name: m.get(w.id) ?? w.name })); }, [applied, cur.wells, wellNameKey]);
  const points = useMemo(() => { const m = new Map(pointsL.map((q) => [q.id, q.name])); return cur.points.map((q) => ({ ...q, name: m.get(q.id) ?? q.name })); }, [cur.points, pointNameKey]);
  /* eslint-enable react-hooks/exhaustive-deps */
  const lim = useMemo(() => limits({ initialMPa: res.initialMPa, ...cur.limit }), [res.initialMPa, cur.limit]);
  const tNow = Math.min(tEval, horizon);
  // Play: step the evaluation time from its current value to the end of the results. The next step is scheduled
  // only after the previous frame has been drawn, so slow maps simply play more slowly instead of piling up.
  const [playing, setPlaying] = useState(false);
  const playStep = Math.max(0.1, Math.round((horizon / 50) * 10) / 10);
  useEffect(() => {
    if (!playing) return;
    if (tNow >= horizon - 1e-9) { setPlaying(false); return; }
    const id = window.setTimeout(() => setTEval(Math.min(horizon, Math.round((tNow + playStep) * 10) / 10)), 60);
    return () => window.clearTimeout(id);
  }, [playing, tNow, horizon, playStep]);
  const togglePlay = () => {
    if (playing) { setPlaying(false); return; }
    if (tNow >= horizon - 1e-9) setTEval(0.1); // at the end: start again from the beginning
    setPlaying(true);
  };
  const two = model === "two";
  const water = model === "water";
  const rateCat: Cat = water ? "waterrate" : "gasrate";
  const rateCatL: Cat = modelL === "water" ? "waterrate" : "gasrate";

  const obsApplied = useMemo(() => {
    if (cur.observe === "no") return { period: 0, offsets: [] as number[] };
    try {
      const period = parsePyFloat(cur.obsPeriod);
      return { period, offsets: observationSchedule(period, cur.obsYears.trim()).offsets.map((o) => o.v) };
    } catch {
      return { period: 0, offsets: [] as number[] };
    }
  }, [cur.observe, cur.obsPeriod, cur.obsYears]);

  /** Image wells of every source for a straight boundary: distance (ft) from each receiving well to each image. */
  const imagesFor = (ws: Well[], b: Boundary): Images | null => {
    if (b.type === "none") return null;
    return ws.map((w) => sourcesFor(w, b).filter((s) => !s.real).map((s) => ({ d: ws.map((r) => Math.hypot(r.x - s.x, r.y - s.y) / FT), sign: s.sign })));
  };

  // The run of the program for the applied inputs: single well (single-well section) or multiwell interference.
  const run = useMemo((): { program: RunOutput | null; multi: MultiwellRun | null; fieldRun: ReturnType<typeof runMultiwell> | null; error: string } => {
    if (!applied) return { program: null, multi: null, fieldRun: null, error: "" };
    const c = applied;
    const p = toBhp(c.res, c.fl, c.model, c.system);
    const spec = limitSpec(c.limit);
    const period = c.observe === "yes" ? obsApplied.period : 0;
    try {
      if (c.system === "single") {
        const w = c.wells[0];
        const pp: BhpInputs = { ...p, q_Mscf_day: w.rate, water_rate_stb_day: w.rate, skin: w.skin, observation_period_years: period, observation_years: period > 0 ? c.obsYears.trim() : "" };
        const { results, constants } = runModel(pp, c.single.years);
        const observation = calculateObservation(results[results.length - 1], pp, true);
        const firstYear = calculateFirstYearDetail(results, pp, constants);
        const program = withPressureLimit({ label: BROWSER_PHASES[c.model][2], years: c.single.years, p: pp, results, constants, observation, firstYear }, spec);
        const fieldRun = runMultiwell(pp, [toMWell(w, pp, c.res.wellboreRadiusM, c.model)], c.single.years, "", { detail: false, pressureLimit: spec, images: imagesFor(c.wells, c.boundary) });
        return { program, multi: null, fieldRun, error: "" };
      }
      const mr = multiwellCalculation({
        p, wells: c.mwells, geometry: c.geomInput, years: c.years, report_times: c.reportTimes,
        observe: c.observe, period: c.obsPeriod, offsets: c.obsYears, limit: spec,
      });
      const r = mr.result;
      const fieldRun = c.boundary.type === "none" ? r : runMultiwell(r.parameters, r.wells, r.years, "", { detail: false, pressureLimit: spec, images: imagesFor(c.wells, c.boundary) });
      return { program: null, multi: mr, fieldRun, error: "" };
    } catch (e) {
      return { program: null, multi: null, fieldRun: null, error: errText(e) };
    }
  }, [applied, obsApplied]); // eslint-disable-line react-hooks/exhaustive-deps

  // The pressure field of the run (maps and curves), and the same wells with the other boundary conditions on demand.
  const field = useMemo(
    () => new MultiwellField(run.fieldRun, applied ? cur.wells : [], boundary, horizon, obsApplied.offsets, run.error || null),
    [run, applied, cur.wells, boundary, horizon, obsApplied],
  );
  const fieldCache = useMemo(() => new Map<Boundary["type"], MultiwellField>(), [run, cur.wells, boundary, horizon, obsApplied]); // eslint-disable-line react-hooks/exhaustive-deps
  const fieldFor = (type: Boundary["type"]): MultiwellField => {
    if (type === boundary.type) return field;
    const hit = fieldCache.get(type);
    if (hit) return hit;
    let f: MultiwellField;
    const base = run.fieldRun;
    if (!base) f = field;
    else {
      try {
        const r = runMultiwell(base.parameters, base.wells, base.years, "", { detail: false, pressureLimit: base.pressure_limit, images: imagesFor(cur.wells, { ...boundary, type }) });
        f = new MultiwellField(r, cur.wells, { ...boundary, type }, horizon, obsApplied.offsets);
      } catch (e) {
        f = new MultiwellField(null, cur.wells, { ...boundary, type }, horizon, [], errText(e));
      }
    }
    fieldCache.set(type, f);
    return f;
  };
  const fieldError = applied ? field.error : null;

  // ---- display units (everything above works in canonical units) ----
  const pU = findUnit("pressure", units.pressure);
  const dU = findUnit("distance", units.distance);
  const lU = findUnit("length", units.length);
  const rU = findUnit(rateCat, units[rateCat]);
  const P = (v: number, d = 2) => (v / pU.f).toFixed(Math.max(0, d + (pU.dec ?? 0)));
  const pDec = Math.max(0, 2 + (pU.dec ?? 0));
  const D = (v: number) => { const x = v / dU.f; return Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(1); };
  const L = (v: number) => num(v / lU.f);
  const toP = (a: number[]) => a.map((v) => v / pU.f);
  const setUnit = (cat: Cat) => (v: string) => setUnits((u) => ({ ...u, [cat]: v }));
  const uv = (cat: Cat, v: number) => num(fromCanon(findUnit(cat, units[cat]), v));
  const uf = (cat: Cat, o: { label?: string; ariaLabel?: string; value: number; onChange: (v: number) => void; min?: number; step?: number }) => {
    const un = findUnit(cat, units[cat]);
    return (
      <NumField
        label={o.label} ariaLabel={o.ariaLabel}
        unitSelect={o.label ? { value: units[cat], options: UNITS[cat].map((u) => u.label), onChange: setUnit(cat) } : undefined}
        value={+fromCanon(un, o.value).toPrecision(6)} onChange={(v) => o.onChange(toCanon(un, v))}
        min={o.min !== undefined ? fromCanon(un, o.min) : undefined} step={o.step !== undefined ? o.step / un.f : undefined}
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
    if (lim.maxBuildupMPa <= 0) w.push("The allowable BHP is at or below the initial pressure: no injection headroom.");
    if (boundary.type !== "none") {
      const coord = (o: { x: number; y: number }) => (boundary.axis === "x" ? o.x : o.y);
      const side = [...wells, ...points].map((o) => Math.sign(coord(o) - boundary.positionM));
      if (side.some((s) => s === 0)) w.push("A well or point lies on the boundary.");
      else if (new Set(side).size > 1) w.push("Wells/points are on both sides of the boundary; they must all be inside the aquifer.");
    }
    wells.forEach((a, i) => wells.slice(i + 1).forEach((b) => {
      if (Math.hypot(a.x - b.x, a.y - b.y) < res.wellboreRadiusM * 2) w.push(`${a.name} and ${b.name} are at the same location.`);
    }));
    wells.forEach((x) => { if (x.endYr <= x.startYr) w.push(`${x.name}: end year must be after start year.`); });
    return w;
  }, [wells, points, boundary, res.wellboreRadiusM, lim]);

  const times = useMemo(() => timeGrid(horizon, wells), [horizon, wells]);

  // Time series at each well (wellbore) and monitoring point, in canonical MPa.
  const buildSeries = (m: Mode): Series[] => {
    const out: Series[] = [];
    const base = m === "bhp" ? lim.initialMPa : 0; // absolute BHP = initial pressure + buildup
    wells.forEach((w, i) => {
      out.push({
        name: w.name, color: COLORS[i % COLORS.length], x: times,
        y: times.map((t) => base + (m === "interference" ? field.total(w.x, w.y, t, w.id) : field.wellbore(w, t))),
      });
    });
    points.forEach((p, i) => {
      out.push({ name: p.name, color: "#495057", dash: i % 2 ? "2 4" : "6 4", x: times, y: times.map((t) => base + field.total(p.x, p.y, t)) });
    });
    if (wells.length > 1) {
      const ws = out.slice(0, wells.length);
      out.push({ name: m === "bhp" ? "Field maximum BHP" : "Field maximum", color: "#111111", x: times, y: times.map((_, k) => Math.max(...ws.map((s) => s.y[k]))) });
      out.push({ name: m === "bhp" ? "Field average BHP" : "Field average", color: "#868e96", dash: "8 3 2 3", x: times, y: times.map((_, k) => ws.reduce((a, s) => a + s.y[k], 0) / ws.length) });
    }
    return out;
  };
  const seriesNow = useMemo(() => buildSeries(mode), [wells, points, times, field, mode, lim.initialMPa]); // eslint-disable-line react-hooks/exhaustive-deps

  // What drives the field maximum: at each time, find the well with the highest buildup
  // and split that pressure into the contribution of every injector (self included) plus skin.
  const fieldDrivers = useMemo(() => {
    const layers = wells.map((w, i) => ({ name: w.name, color: COLORS[i % COLORS.length], x: times, y: [] as number[] }));
    const skinLayer = { name: "Skin (controlling well)", color: "#adb5bd", x: times, y: [] as number[] };
    const controlling: number[] = [];
    if (!wells.length) return { layers: [skinLayer], controlling, kPeak: 0, peak: 0 };
    for (const t of times) {
      let best = 0, bestV = -Infinity;
      wells.forEach((w, j) => {
        const v = field.wellbore(w, t);
        if (v > bestV) { bestV = v; best = j; }
      });
      controlling.push(best);
      const wj = wells[best];
      wells.forEach((wi, i) => layers[i].y.push(field.contribution(wi, wj.x, wj.y, t)));
      skinLayer.y.push(field.skin(wj, t));
    }
    const all = [...layers, skinLayer];
    const totals = times.map((_, k) => all.reduce((s, l) => s + l.y[k], 0));
    const kPeak = totals.reduce((m, v, k) => (v > totals[m] ? k : m), 0);
    return { layers: all, controlling, kPeak, peak: totals[kPeak] };
  }, [wells, times, field]);

  const matrix = useMemo(() => field.matrix(tNow), [field, tNow]);

  const arrivals = useMemo(
    () => wells.map((src) => [...wells, ...points].map((tg) =>
      tg === src ? null : field.arrival(src, tg.x, tg.y, threshold, horizon))),
    [wells, points, threshold, horizon, field],
  );

  // Peak buildup per well (total, at wellbore) over the horizon.
  const peaks = useMemo(() => wells.map((w) => {
    const ys = times.map((t) => field.wellbore(w, t));
    const iMax = ys.reduce((m, v, i) => (v > ys[m] ? i : m), 0);
    const skinAtPeak = field.skin(w, times[iMax]);
    const interference = field.total(w.x, w.y, times[iMax], w.id);
    return { peak: ys[iMax], t: times[iMax], self: ys[iMax] - interference - skinAtPeak, skin: skinAtPeak, interference };
  }), [wells, times, field]);

  // Monitoring points are checked against the interference threshold (detection level), not the pressure limit.
  const pointChecks = useMemo(() => points.map((pt) => {
    const ys = times.map((t) => field.total(pt.x, pt.y, t));
    const iMax = ys.reduce((m, v, i) => (v > ys[m] ? i : m), 0);
    const iFirst = ys.findIndex((v) => v >= threshold);
    return { name: pt.name, peak: ys[iMax], tPeak: times[iMax], first: iFirst >= 0 ? times[iFirst] : null };
  }), [points, times, field, threshold]);

  const worst = peaks.reduce((m, p, i) => (p.peak > peaks[m].peak ? i : m), 0);
  const scaleToLimit = peaks.length && peaks[worst].peak > 0 && Number.isFinite(lim.maxBuildupMPa) ? lim.maxBuildupMPa / peaks[worst].peak : Infinity;

  // Same wells, three boundary conditions (each a run of the program with image wells; the infinite case is the program).
  // Calculated only when the comparison is shown or the report is built.
  type Case = { key: Boundary["type"]; label: string; color: string; dash?: string; perWell: { ys: number[]; peak: number; t: number }[] };
  const computeCases = (): Case[] => {
    const defs: { key: Boundary["type"]; label: string; color: string; dash?: string }[] = [
      { key: "none", label: "Infinite-acting", color: "#2a6fdb" },
      { key: "constant", label: "Constant-pressure boundary", color: "#2f9e44", dash: "6 4" },
      { key: "noflow", label: "No-flow boundary", color: "#d9480f", dash: "2 4" },
    ];
    return defs.map((d) => {
      const f = fieldFor(d.key);
      const perWell = wells.map((w) => {
        const ys = times.map((t) => f.wellbore(w, t));
        const k = ys.reduce((m, v, i) => (v > ys[m] ? i : m), 0);
        return { ys, peak: ys[k], t: times[k] };
      });
      return { ...d, perWell };
    });
  };
  const cases = useMemo(() => (view === "compare" && applied ? computeCases() : []), [view, applied, wells, times, field]); // eslint-disable-line react-hooks/exhaustive-deps
  const cmpIdx = Math.min(cmpWell, Math.max(wells.length - 1, 0));
  const bhpIdx = Math.min(bhpWell, Math.max(wells.length - 1, 0));

  // Automatic map padding: enough to show the largest CO2 plume in full and to keep neighbouring wells well apart on the map.
  const autoPadM = useMemo(() => {
    if (!wells.length) return 300;
    let maxR = 0;
    for (const w of wells) {
      const sm = field.summary(w, Math.min(w.endYr, horizon));
      if (sm.s && Number.isFinite(sm.s.rg_ft)) maxR = Math.max(maxR, sm.s.rg_ft * FT);
    }
    let spacing = Infinity;
    wells.forEach((a, i) => wells.slice(i + 1).forEach((b) => { spacing = Math.min(spacing, Math.hypot(a.x - b.x, a.y - b.y)); }));
    return Math.max(1.4 * maxR, Number.isFinite(spacing) ? 0.8 * spacing : 0, 150);
  }, [wells, field, horizon]);
  const padEff = padM ?? autoPadM;
  const extent = useMemo(() => {
    const all = mapArea === "all" ? [...wells, ...points] : wells.length ? wells : points;
    const xs = all.map((o) => o.x), ys = all.map((o) => o.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + padEff;
    return { x0: cx - half, x1: cx + half, y0: cy - half, y1: cy + half };
  }, [wells, points, padEff, mapArea]);

  // Pressure map area: the wells spread over the map with about two well spacings around them (at least the
  // saturation map margin), so every well is clearly seen. The colour scale of the map starts at the buildup on the map
  // edge, so the infinite-acting pressure is seen fading out before the edge. Only the display changes, not the
  // calculation. A padding typed by the user is used as given.
  const autoPadPressM = useMemo(() => {
    if (!wells.length) return autoPadM;
    const xs = wells.map((w) => w.x), ys = wells.map((w) => w.y);
    const halfC = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2;
    let spacing = Infinity;
    wells.forEach((p, i) => wells.slice(i + 1).forEach((q) => { spacing = Math.min(spacing, Math.hypot(p.x - q.x, p.y - q.y)); }));
    return Math.max(autoPadM, Number.isFinite(spacing) ? 2 * spacing : 0, halfC);
  }, [wells, autoPadM]);
  const padPressEff = padM ?? autoPadPressM;
  const extentP = useMemo(() => {
    const all = mapArea === "all" ? [...wells, ...points] : wells.length ? wells : points;
    const xs = all.map((o) => o.x), ys = all.map((o) => o.y);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const half = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) / 2 + padPressEff;
    return { x0: cx - half, x1: cx + half, y0: cy - half, y1: cy + half };
  }, [wells, points, padPressEff, mapArea]);

  const grid = useMemo(
    () => (applied && wells.length ? field.grid(null, tNow, extentP, 180, 180) : null),
    [applied, wells, tNow, field, extentP],
  );

  // CO2 saturation (Buckley-Leverett plume around each injector, two-phase model only)
  // CO2 viscosity of the plume model: the program's background value at the initial pressure
  const bgApplied = useMemo(() => backgroundProps(bhpIn), [bhpIn]);
  const muGasBg = bgApplied.muGas ?? 0.045;
  const sat: SatParams = useMemo(() => ({ swr: fl.swr, krgMax: fl.krg0, krwMax: fl.krw0, nw: fl.nw, ng: fl.ng, muCo2MPas: muGasBg }), [fl, muGasBg]);
  const satModel = useMemo(() => makeSatModel(sat, fl.muWater), [sat, fl.muWater]);
  const satGeom = useMemo(() => ({ porosity: res.porosity, thicknessM: res.thicknessM, rwM: res.wellboreRadiusM }), [res]);
  const vols = useMemo(() => wells.map((w) => field.reservoirVolumeM3(w, tNow)), [wells, field, tNow]);
  const gridSat = useMemo(
    () => (applied && two && wells.length ? satGrid(wells, vols, satGeom, satModel, extent) : null),
    [applied, two, wells, vols, satGeom, satModel, extent],
  );
  const frontSg = useMemo(() => {
    try { return coreyFrontQuantities((bhpIn.krg_endpoint * bhpIn.mu_water_cP) / (bhpIn.krw_endpoint * muGasBg), bhpIn.Swr, bhpIn.corey_n_gas, bhpIn.corey_n_water).Sg_front; } catch { return NaN; }
  }, [bhpIn, muGasBg]);
  const plumes = useMemo(() => wells.map((w) => {
    const s = field.summary(w, tNow).s;
    return {
      id: w.id, name: w.name,
      massMt: (injectedRateYears(w, tNow) * 365.25 * CO2_T_PER_MSCF) / 1e6,
      radius: s && two ? s.rg_ft * FT : 0,
      dryR: s && two ? s.rd_ft * FT : 0,
      sg2: s?.Sg2 ?? NaN,
    };
  }), [wells, tNow, field, two]);

  // The program run for one well on its own (your calculation, unchanged): rate, injection years and skin of that well,
  // and the post-shut-in observation entered in the Input section.
  // Single well: the run itself. Multiwell: the selected well run on its own (its rate, radius, skin, evaporation choice and
  // own maximum BHP; injection from its start year to its end year, in whole years).
  const code = useMemo((): { out: RunOutput | null; error: string; note: string } => {
    if (!applied) return { out: null, error: "", note: "" };
    if (!multi) return { out: run.program, error: run.error, note: "" };
    const w = wells[bhpIdx];
    if (!w) return { out: null, error: "", note: "" };
    const years = Math.max(1, Math.round(w.endYr - w.startYr));
    const notes: string[] = [];
    if (Math.abs(w.endYr - w.startYr - years) > 1e-9) notes.push(`the injection period is rounded to ${years} whole years`);
    if ((w.changes ?? []).some((ch) => ch.yr > w.startYr && ch.yr < w.endYr)) notes.push("the program uses one constant rate, the first rate of the well (its rate changes are only in the multiwell results)");
    try {
      const period = cur.observe === "yes" ? obsApplied.period : 0;
      const p: BhpInputs = {
        ...bhpIn, q_Mscf_day: w.rate, water_rate_stb_day: w.rate, skin: w.skin, rw_ft: (w.rwM ?? B0.rw_ft * FT) / FT,
        include_evaporation: model === "two" && w.evaporation && w.evaporation !== "inherit" ? w.evaporation === "on" : bhpIn.include_evaporation,
        observation_period_years: period, observation_years: period > 0 ? cur.obsYears.trim() : "",
      };
      const { results, constants } = runModel(p, years);
      const observation = calculateObservation(results[results.length - 1], p, true);
      const firstYear = calculateFirstYearDetail(results, p, constants);
      const limit = w.maxBhpMPa !== null && w.maxBhpMPa !== undefined ? { mode: "max_bhp", max_bhp_psia: w.maxBhpMPa / PSI } : limitSpec(cur.limit);
      return { out: withPressureLimit({ label: BROWSER_PHASES[model][2], years, p, results, constants, observation, firstYear }, limit), error: "", note: notes.join("; ") };
    } catch (e) {
      return { out: null, error: errText(e), note: notes.join("; ") };
    }
  }, [applied, multi, run, wells, bhpIdx, bhpIn, cur.observe, cur.obsYears, cur.limit, obsApplied, model]); // eslint-disable-line react-hooks/exhaustive-deps
  const codePlot = useMemo(() => (code.out ? renderBhpPlot(code.out) : null), [code.out]);
  const codeFiles = useMemo(() => (code.out ? outputFiles(code.out) : null), [code.out]);
  const saveCodePlot = async () => {
    if (!codePlot || !wells[bhpIdx]) return;
    const url = await svgToPngDataUrl(codePlot.svg, codePlot.width, codePlot.height, 2);
    downloadBlob(await (await fetch(url)).blob(), `${wells[bhpIdx].name}-bhp_vs_year.png`);
  };
  const textFile = (name: string, text: string) => downloadBlob(new Blob([text], { type: name.endsWith(".json") ? "application/json" : "text/csv" }), name);

  // ---- chart specs (display units applied) ----
  const mapSpec = (g: NonNullable<typeof grid>): ChartSpec => ({
    kind: "map",
    opts: {
      grid: g, wells, points, boundary, pf: pU.f, pLabel: pU.label, pDec, df: dU.f, dLabel: dU.label,
      geo: geo.on ? { lat0: geo.lat0, lon0: geo.lon0 } : undefined,
      style: mapStyle,
      wellGrids: mapStyle.contours && (mapStyle.contourSource ?? "wells") === "wells" ? wells.map((w) => field.grid(w, tNow, extentP, Math.max(g.nx, 150), Math.max(g.ny, 150))) : undefined,
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
      contourLevels: [],
    },
  });
  const lineSpec = (m: Mode, ser: Series[], withMarker: boolean): ChartSpec => ({
    kind: "line",
    opts: {
      series: ser.map((s) => ({ ...s, y: toP(s.y) })), xLabel: "Time (years)",
      yLabel: m === "bhp" ? `Bottomhole pressure (${pU.label})` : `Pressure buildup, ${m === "total" ? "total" : "interference"} (${pU.label})`,
      hline: m === "bhp" ? (lim.allowableMPa !== null ? { y: lim.allowableMPa / pU.f, label: `Max allowable BHP ${P(lim.allowableMPa, 1)} ${pU.label}` } : undefined)
        : m === "total" && lim.maxBuildupMPa > 0 && Number.isFinite(lim.maxBuildupMPa) ? { y: lim.maxBuildupMPa / pU.f, label: "Allowable buildup" } : undefined,
      yMin: m === "bhp" ? Math.floor(lim.initialMPa / pU.f) : 0,
      fit: m === "bhp", // zoom the pressure axis to the curves (the allowable BHP is usually far above them)
      markerX: withMarker ? tNow : undefined, markerLabel: "Evaluation time",
    },
  });
  const stackSpec = (): ChartSpec => ({
    kind: "stack",
    opts: { layers: fieldDrivers.layers.map((l) => ({ ...l, y: toP(l.y) })), xLabel: "Time (years)", yLabel: `Field-maximum buildup by source (${pU.label})` },
  });
  const compareSpec = (idx: number, cases: Case[]): ChartSpec => ({
    kind: "line",
    opts: {
      series: cases.map((k) => ({ name: k.label, color: k.color, dash: k.dash, x: times, y: toP(k.perWell[idx].ys) })),
      xLabel: "Time (years)", yLabel: `${wells[idx].name} wellbore buildup incl. skin (${pU.label})`,
      hline: lim.maxBuildupMPa > 0 && Number.isFinite(lim.maxBuildupMPa) ? { y: lim.maxBuildupMPa / pU.f, label: "Allowable buildup" } : undefined,
    },
  });
  /* eslint-disable react-hooks/exhaustive-deps */
  const specSat = useMemo(() => (gridSat ? satSpec(gridSat) : null), [gridSat, wells, points, geo, dU, tNow]);
  const specMap = useMemo(() => (grid ? mapSpec(grid) : null), [grid, wells, points, boundary, threshold, lim, pU, dU, mapStyle, tNow, field, extentP]);
  const specSeries = useMemo(() => lineSpec(mode, seriesNow, false), [seriesNow, mode, lim, pU]);
  const specStack = useMemo(stackSpec, [fieldDrivers, pU]);
  const specCompare = useMemo(() => (wells.length && cases.length ? compareSpec(cmpIdx, cases) : null), [cases, cmpIdx, lim, pU, times]);
  // BHP of the selected well with interference, and the same well alone (exactly the program for one well)
  const specWellBhp = useMemo(() => {
    const w = wells[bhpIdx];
    if (!w) return null;
    const all = buildSeries("bhp");
    const base = run.fieldRun;
    let alone: MultiwellField;
    try {
      alone = new MultiwellField(base ? runMultiwell(base.parameters, [base.wells[bhpIdx]], base.years, "", { detail: false }) : null, [cur.wells[bhpIdx]], { ...boundary, type: "none" }, horizon, obsApplied.offsets);
    } catch (e) {
      alone = new MultiwellField(null, [cur.wells[bhpIdx]], { ...boundary, type: "none" }, horizon, [], errText(e));
    }
    const own: Series = { name: `${w.name} alone (your program, no other wells)`, color: "#111111", dash: "5 4", x: times, y: times.map((t) => lim.initialMPa + alone.wellbore(w, t)) };
    return lineSpec("bhp", [{ ...all[bhpIdx], name: `${w.name} with interference from the other wells` }, own], true);
  }, [wells, points, times, field, run, bhpIdx, lim, pU, tNow, horizon, boundary, obsApplied]);
  /* eslint-enable react-hooks/exhaustive-deps */

  const updWell = (id: string, patch: Partial<WellIn>) => setWells((ws) => ws.map((w) => (w.id === id ? { ...w, ...patch } : w)));
  const updPoint = (id: string, patch: Partial<PointIn>) => setPoints((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  const addChange = (id: string) =>
    setWells((ws) => ws.map((w) => (w.id !== id ? w : { ...w, changes: [...(w.changes ?? []), { yr: +((w.startYr + w.endYr) / 2).toFixed(2), rate: w.rate }] })));
  const updChange = (id: string, idx: number, patch: Partial<{ yr: number; rate: number }>) =>
    setWells((ws) => ws.map((w) => (w.id !== id ? w : { ...w, changes: (w.changes ?? []).map((c, i) => (i === idx ? { ...c, ...patch } : c)) })));
  const delChange = (id: string, idx: number) =>
    setWells((ws) => ws.map((w) => (w.id !== id ? w : { ...w, changes: (w.changes ?? []).filter((_, i) => i !== idx) })));

  /** Set the number of wells: extra wells are added on a spiral around the first one (rate 150, years 0-25); surplus wells are removed from the end. */
  /** Set the number of wells (2–32), as the program's resize_well_rows: surplus wells are removed from the end; a new well
   * gets the next free name "Well k", the default rate, start year 0, radius 0.55 ft and skin 0, 1000 ft beyond the last x. */
  const setWellCount = (n: number) => {
    const k = Math.max(2, Math.min(32, Math.round(n)));
    setWells((ws) => {
      if (k <= ws.length) return ws.slice(0, k);
      const ref = origin ?? geoRef;
      const names = new Set(ws.map((w) => w.name.toLowerCase()));
      const add: WellIn[] = [];
      for (let i = ws.length; i < k; i++) {
        let c = i + 1;
        while (names.has(`well ${c}`)) c++;
        names.add(`well ${c}`);
        const x = Math.max(...[...ws, ...add].map((w) => w.x), -1000 * FT) + 1000 * FT;
        add.push({ ...newWellIn(i, x, 0), rwM: rwAllL, endYr: ws[ws.length - 1]?.endYr ?? 30, id: uid("w"), name: `Well ${c}`, ...roundLL(unproject(x, 0, ref.lat, ref.lon)) });
      }
      return [...ws, ...add];
    });
  };
  const setSystem = (v: System) => {
    if (v === "single" && coordMode === "geo") switchCoord("local");
    setSystemRaw(v);
  };
  const setGeomSafe = (patch: Partial<GeometryIn>) => {
    const next = { ...geomL, ...patch };
    if (coordMode === "geo" && !(next.mode === "different" && next.method === "coordinates")) switchCoord("local");
    setGeom(next);
  };

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
      setWells(r.wells.map((w) => ({ rwM: B0.rw_ft * FT, evaporation: "inherit" as const, maxBhpMPa: null, ...w })));
      setGeom((g) => ({ ...g, mode: "different", method: "coordinates" }));
      setCsvError("");
    } catch (e) {
      setCsvError(errText(e));
    }
    if (fileRef.current) fileRef.current.value = "";
  };

  const exportResults = () => {
    const names = wells.map((w) => w.name);
    const rows: (string | number)[][] = [[`# Model: ${modelLabel(bhpIn)}`], [`# Interference matrix (${pU.label}) at t = ` + tNow + " yr; row = source well, column = receiving well"], ["source\\receiver", ...names]];
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
      const cases = computeCases();
      const figures = {
        sat: two ? await fig(satSpec(satGrid(wells, vols, satGeom, satModel, extent))) : undefined,
        map: await fig(mapSpec(field.grid(null, tNow, extentP, 180, 180))),
        bhp: await fig(lineSpec("bhp", buildSeries("bhp"), false)),
        compare: await fig(compareSpec(worst, cases)),
        drivers: await fig(stackSpec()),
      };
      const un = (cat: Cat) => units[cat];
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
      const wSum = field.summary(wells[worst], tNow);
      const zoneNames = two ? ["1  Dry CO₂", "2  CO₂ + brine", "3  Brine"] : [water ? "Water" : "CO₂"];
      const data: ReportData = {
        project: applied.project, author: applied.author,
        date: new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" }),
        nWells: wells.length, nPoints: points.length, horizon, pLabel: pU.label,
        model, modelLabel: modelLabel(bhpIn), evaporation: fl.evaporation, dissolution: two && !!fl.dissolution,
        paramHead: ["Parameter", "Value", "Unit"],
        paramRows: [
          ["Pressure model", modelLabel(bhpIn), "–"],
          ...(two ? [["Include evaporation (dry zone)", fl.evaporation ? "Yes" : "No", "–"], ["Include CO₂ dissolution (zone 2 brine)", fl.dissolution ? "Yes" : "No", "–"]] : []),
          ["Permeability, k (every zone)", uv("perm", res.permMd), un("perm")],
          ["Net thickness, h", uv("length", res.thicknessM), un("length")],
          ["Porosity, φ (every zone)", num(res.porosity), "–"],
          ["Wellbore radius, r_w", uv("length", res.wellboreRadiusM), un("length")],
          ["Initial absolute pressure, P_i", uv("pressure", res.initialMPa), un("pressure")],
          ["Reservoir temperature, T", uv("temp", res.tempC), un("temp")],
          ...(model !== "co2" ? [["Water viscosity, μ_w", uv("viscosity", fl.muWater), un("viscosity")], ["Brine density at 60 °F and 14.696 psia (standard)", uv("density", fl.brineDensityKgM3), un("density")]] : []),
          ["Rock compressibility, c_r", uv("compress", fl.rockComp), un("compress")],
          ...(bgApplied.muGas !== null ? [["CO₂ viscosity at P_i (calculated: Fenghour 1998, live Peng–Robinson density)", uv("viscosity", bgApplied.muGas), un("viscosity")]] : []),
          ...(bgApplied.ppm !== null ? [["Salinity, NaCl equivalent (calculated: McCain inverse of the standard density)", Math.round(bgApplied.ppm).toLocaleString("en-US"), "mass ppm"]] : []),
          ...(bgApplied.rhoW !== null ? [["Brine density at P_i and T (calculated: Driesner 2007 + IAPWS-IF97)", uv("density", bgApplied.rhoW * LB_FT3), un("density")]] : []),
          ...(bgApplied.cw !== null ? [["Water compressibility at P_i, c_w (calculated: (1/ρ)·dρ/dP)", uv("compress", bgApplied.cw / PSI), un("compress")]] : []),
          ...(two ? [
            ["Irreducible water saturation, S_wr", num(fl.swr), "–"],
            ["Gas end-point relative permeability, k_rg0", num(fl.krg0), "–"],
            ["Water end-point relative permeability, k_rw0", num(fl.krw0), "–"],
            ["Zone 1 gas relative permeability, k_rg1", num(fl.krg1), "–"],
            ["Corey exponents, n_g / n_w", `${num(fl.ng)} / ${num(fl.nw)}`, "–"],
          ] : []),
          ["Well system", multi ? "Multiwell interference" : "Single well", "–"],
          ...(multi ? [["Last end year (observation starts after it)", num(Number(cur.years)), "yr"]] : [["Injection years", String(cur.single.years), "yr"]]),
          ["Pressure check", cur.limit.mode === "none" ? "Not assessed" : cur.limit.mode === "max_bhp" ? "Maximum allowable BHP" : "Fraction of fracture pressure", "–"],
          ...(cur.limit.mode === "max_bhp" ? [["Maximum allowable BHP", uv("pressure", cur.limit.maxBhpMPa), un("pressure")]] : []),
          ...(cur.limit.mode === "fracture_fraction" ? [["Fracture pressure", uv("pressure", cur.limit.fractureMPa), un("pressure")], ["Allowable fraction of fracture pressure", num(cur.limit.fraction), "–"]] : []),
          ["Interference threshold", P(threshold, 3), pU.label],
          ["Post-shut-in observation", cur.observe === "yes" ? `${cur.obsPeriod} yr after all wells stop` : "No", "–"],
          ["Results period", `0 to ${num(horizon)}`, "yr"],
        ],
        wellHead: geo.on
          ? ["Well", "Lon (°)", "Lat (°)", `x (${dU.label})`, `y (${dU.label})`, `Rate (${rU.label})`, "Start (yr)", "End (yr)", `r_w (${lU.label})`, "Skin"]
          : ["Well", `x (${dU.label})`, `y (${dU.label})`, `Rate (${rU.label})`, "Start (yr)", "End (yr)", `r_w (${lU.label})`, "Skin"],
        wellRows: wells.map((w) => {
          const tail = [num(fromCanon(rU, w.rate)), num(w.startYr), num(w.endYr), L(w.rwM ?? res.wellboreRadiusM), w.skin.toFixed(2)];
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
        skinDesc: wells.some((w) => w.skin !== 0) ? "A skin factor was specified for each well (Table 3)." : "All wells have zero skin.",
        limits: {
          p0: `${P(lim.initialMPa, 1)} ${pU.label}`,
          check: cur.limit.mode === "none"
            ? "No pressure limit was supplied, so the wells are not assessed (status NOT ASSESSED)"
            : cur.limit.mode === "max_bhp"
              ? `The pressure check uses a maximum allowable bottom-hole pressure of ${P(cur.limit.maxBhpMPa, 1)} ${pU.label}`
              : `The pressure check uses ${num(cur.limit.fraction)} of a fracture pressure of ${P(cur.limit.fractureMPa, 1)} ${pU.label}, an allowable bottom-hole pressure of ${P(lim.allowableMPa ?? NaN, 1)} ${pU.label}`,
          assessed: lim.allowableMPa !== null,
          maxBuildup: Number.isFinite(lim.maxBuildupMPa) ? `${P(lim.maxBuildupMPa)} ${pU.label}` : "–",
          maxBhp: lim.allowableMPa !== null ? `${P(lim.allowableMPa, 1)} ${pU.label}` : "–",
        },
        kpi: {
          worst: wells[worst].name, peak: `${P(peaks[worst].peak)} ${pU.label}`, at: `at ${peaks[worst].t.toFixed(1)} yr`,
          allowable: Number.isFinite(lim.maxBuildupMPa) ? `${P(lim.maxBuildupMPa)} ${pU.label}` : "not assessed", exceeded: overall === "FAIL",
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
        zoneHead: ["Zone", "Mobility Λ (mD/cP)", "Total compressibility c_t (1/psi)", "Mobility ratio m", "Storage ratio c*", "Diffusivity ratio D"],
        zoneRows: wSum.s
          ? zoneNames.map((z, i) => [z, ...["Lambda", "ct"].map((k) => wSum.s![`${k}${i + 1}${k === "Lambda" ? "_mD_cP" : "_per_psi"}`].toPrecision(4)), ...["m", "c", "D"].map((k) => wSum.s![k === "c" ? `c${i + 1}_star` : `${k}${i + 1}`].toPrecision(4))])
          : [],
        zoneNote: wSum.s
          ? `${wells[worst].name} at t = ${tNow.toFixed(1)} yr (${wSum.kind === "shut" ? "frozen at shut-in" : "injecting"}), from the program at its bottom-hole pressure ${P(wSum.P * PSI, 1)} ${pU.label}${two ? `; zone 2 gas saturation ${(wSum.s.Sg2 ?? NaN).toFixed(3)}, dry front ${L(wSum.s.rd_ft * FT)} ${lU.label}, gas front ${L(wSum.s.rg_ft * FT)} ${lU.label}` : ""}.`
          : "",
        scheduleHead: ["Well", "Rate changes from year", `New rate (${rU.label})`],
        scheduleRows: wells.flatMap((w) => (w.changes ?? []).filter((ch) => ch.yr > w.startYr && ch.yr < w.endYr).sort((x, y) => x.yr - y.yr).map((ch) => [w.name, num(ch.yr), num(fromCanon(rU, ch.rate))])),
        satHead: ["Well", "CO₂ injected (Mt)", `Gas front r_g (${dU.label})`, `Dry front r_d (${dU.label})`, "Zone 2 S_g", "Front S_g", "Max S_g"],
        satRows: plumes.map((q) => [q.name, q.massMt.toFixed(4), D(q.radius), D(q.dryR), Number.isFinite(q.sg2) ? q.sg2.toFixed(3) : "–", frontSg.toFixed(3), satModel.smax.toFixed(2)]),
        satSentence: (() => {
          const rs = plumes.map((q) => q.radius);
          const big = plumes.reduce((m, q) => (q.radius > m.radius ? q : m), plumes[0]);
          return `At t = ${tNow.toFixed(1)} yr the CO₂ gas fronts lie between ${D(Math.min(...rs))} and ${D(Math.max(...rs))} ${dU.label} from the injectors (largest: ${big.name}). ${fl.evaporation ? `The dry (evaporation) zone next to the wells extends to ${D(Math.min(...plumes.map((q) => q.dryR)))}–${D(Math.max(...plumes.map((q) => q.dryR)))} ${dU.label}.` : "Evaporation was switched off, so there is no dry zone."} The front radii and the zone 2 saturation come from the pressure model (cumulative reservoir volume of CO₂ at each well's bottom-hole pressure); the map shows the radial Buckley–Leverett saturation profile of each well for the same volumes, highest next to the well and falling outward; where plumes overlap the higher of the two saturations is shown. ${fl.dissolution ? "CO₂ dissolution was included in the zone 2 mass balance (it lowers the free-gas saturation S_g2, not the front radii). " : ""}Gravity override, ${fl.dissolution ? "" : "dissolution, "}capillarity and residual trapping are not included.`;
        })(),
        bhpHead: ["Well", `BHP at end of injection (${pU.label})`, "End (yr)", `BHP at horizon (${pU.label})`, ...(two ? [`r_g at shut-in (${dU.label})`, "Zone 2 S_g"] : []), `${fluidName} injected (t)`],
        injectedTotal: `${massText(injected.totalLb)} (${intStr(tonnes(injected.totalLb))} tonnes, ${intStr(injected.totalLb)} lb; ${intStr(volOf(injected.totalVol))} ${volUnit})`,
        bhpRows: wells.map((w) => {
          const end = Math.min(w.endYr, horizon);
          const s = field.summary(w, end).s;
          const inj = injected.rows[wells.indexOf(w)];
          return [w.name, P(lim.initialMPa + field.wellbore(w, end), 1), num(end), P(lim.initialMPa + field.wellbore(w, horizon), 1), ...(two ? [s ? D(s.rg_ft * FT) : "–", s?.Sg2 !== undefined ? s.Sg2.toFixed(3) : "–"] : []), inj ? intStr(tonnes(inj.massLb)) : "–"];
        }).concat(injected.rows.length > 1 ? [["Field", "", num(injected.end), "", ...(two ? ["", ""] : []), intStr(tonnes(injected.totalLb))]] : []),
        compareHead: ["Well", ...cases.map((k) => k.label)],
        compareRows: [
          ...wells.map((w, i) => [w.name, ...cases.map((k) => P(k.perWell[i].peak))]),
          ["Allowable", ...cases.map(() => (Number.isFinite(lim.maxBuildupMPa) ? P(lim.maxBuildupMPa) : "–"))],
        ],
        compareSentence:
          `For the controlling well (${wells[worst].name}) the peak wellbore buildup is ${P(worstCase(0))} ${pU.label} for the infinite-acting aquifer, ${P(worstCase(1))} ${pU.label} for a constant-pressure boundary and ${P(worstCase(2))} ${pU.label} for a no-flow boundary (boundary line ${bLine})${Number.isFinite(lim.maxBuildupMPa) ? `, against an allowable buildup of ${P(lim.maxBuildupMPa)} ${pU.label}` : ""}. ` +
          (!Number.isFinite(lim.maxBuildupMPa) ? "No pressure limit was supplied." : exceeds.length ? `The allowable buildup is exceeded for the ${exceeds.join(" and ")} case${exceeds.length > 1 ? "s" : ""}.` : "The allowable buildup is not exceeded in any of the three cases."),
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
      alert(`Could not build the report: ${errText(e)}`);
    } finally {
      setBusy("");
    }
  };

  // the program's pressure-limit summary (pressure_limit_summary.csv) and the multiwell outputs
  // Cumulative injected mass at the end of injection, as the program calculates it (Minj = standard-condition density x
  // injected surface volume: rho_sc_lb_scf x scf for CO2, water_mass_per_stb_lb x STB for water), per well and for the field.
  const injected = useMemo(() => {
    const rows: { name: string; end: number; volume: number; massLb: number }[] = [];
    if (run.multi) {
      const r = run.multi.result;
      r.wells.forEach((w, i) => {
        const end = w.end_year ?? r.years;
        const days = cumulativeRateDays(w, end); // rate x days (Mscf or STB)
        const c = r.references[i];
        rows.push(water
          ? { name: wells[i]?.name ?? w.name, end, volume: days, massLb: days * c.water_mass_per_stb_lb }
          : { name: wells[i]?.name ?? w.name, end, volume: days * 1000.0, massLb: days * 1000.0 * c.rho_sc_lb_scf });
      });
    } else if (run.program) {
      const last = run.program.results[run.program.results.length - 1];
      rows.push({ name: wells[0]?.name ?? "Well 1", end: last.year, volume: water ? last.Vwater_stb : last.Vsc_scf, massLb: last.Minj_lb });
    }
    const totalLb = rows.reduce((a, r) => a + r.massLb, 0), totalVol = rows.reduce((a, r) => a + r.volume, 0);
    return { rows, totalLb, totalVol, end: Math.max(0, ...rows.map((r) => r.end)) };
  }, [run, wells, water]);
  const KG_PER_LB = 0.45359237;
  const fluidName = water ? "water" : "CO₂";
  const volUnit = water ? "STB" : "MMscf";
  const volOf = (v: number) => (water ? v : v / 1e6);
  const intStr = (v: number) => Math.round(v).toLocaleString("en-US");
  const tonnes = (lb: number) => (lb * KG_PER_LB) / 1000;
  const massText = (lb: number) => (tonnes(lb) >= 1e5 ? `${(tonnes(lb) / 1e6).toFixed(3)} Mt` : `${intStr(tonnes(lb))} t`);
  const InjectedTable = () => (
    <div className="bhp-summary-wrap">
      <table className="bhp-summary">
        <thead><tr><th>Well</th><th>End of injection (yr)</th><th>Injected surface volume ({volUnit})</th><th>Injected mass (lb)</th><th>Injected mass (tonnes)</th></tr></thead>
        <tbody>
          {injected.rows.map((r) => (
            <tr key={r.name}><td>{r.name}</td><td>{+r.end.toFixed(4)}</td><td>{intStr(volOf(r.volume))}</td><td>{intStr(r.massLb)}</td><td>{intStr(tonnes(r.massLb))}</td></tr>
          ))}
          {injected.rows.length > 1 && (
            <tr className="total"><td><b>Field</b></td><td>{+injected.end.toFixed(4)}</td><td><b>{intStr(volOf(injected.totalVol))}</b></td><td><b>{intStr(injected.totalLb)}</b></td><td><b>{intStr(tonnes(injected.totalLb))}</b></td></tr>
          )}
        </tbody>
      </table>
    </div>
  );

  const limitRows: Row[] = multi ? run.multi?.limitSummary ?? [] : run.program ? pressureLimitSummary(run.program) : [];
  const worstRow = limitRows.reduce<Row | null>((m, r) => (!m || r.peak_BHP_psia > m.peak_BHP_psia ? r : m), null);
  const overall = limitRows.some((r) => r.overall_status === "FAIL") ? "FAIL" : limitRows.some((r) => r.overall_status === "PASS") ? "PASS" : "NOT ASSESSED";
  const nameOf = (programName: string) => (multi ? programName : wells[0]?.name ?? programName);
  const mwRun = run.multi;
  const mwFiles = useMemo(() => (mwRun ? multiwellFiles(mwRun.result, mwRun.observation) : null), [mwRun]);
  const mwPlots = useMemo(() => (mwRun ? [renderMultiwellPressure(mwRun.result, mwRun.observation), renderMultiwellMatrix(mwRun.result)] : null), [mwRun]);
  const savePlot = async (p: { svg: string; width: number; height: number }, name: string) => {
    const url = await svgToPngDataUrl(p.svg, p.width, p.height, 2);
    downloadBlob(await (await fetch(url)).blob(), name);
  };
  /** own formation / skin / interference of a well at the time of its peak (the program's multiwell rows) */
  const peakSplit = (r: Row): Row | null => {
    if (!mwRun) return null;
    const all = [...mwRun.result.detail, ...(mwRun.observation?.detail ?? [])];
    return all.find((x) => x.well === r.well && x.year === r.peak_project_year && x.BHP_psia === r.peak_BHP_psia) ?? null;
  };

  const targets = [...wells, ...points];
  const maxOff = Math.max(1e-9, ...matrix.flatMap((r, i) => r.filter((_, j) => j !== i)));
  const fx = Math.max(0, 1 + (pU.dec ?? 0));
  const satTab: [View, string][] = two ? [["sat", "CO₂ saturation"]] : [];
  const tabs: [View, string][] = multi
    ? [["mw", "Multiwell results"], ...satTab, ["map", "Pressure map"], ["series", "Time series"], ["bhp", "Well BHP"], ["matrix", "Interference matrix"], ["limits", "Limit check"], ["compare", "Compare boundaries"]]
    : [["bhp", "Program results"], ...satTab, ["map", "Pressure map"], ["series", "Time series"], ["limits", "Limit check"], ["compare", "Compare boundaries"]];
  const viewEff: View = view === "sat" && !two ? "map" : !multi && (view === "mw" || view === "matrix") ? "bhp" : view;
  const showF = (n: keyof BhpInputs) => (modelL === "two" ? true : modelL === "co2" ? ["rock_compressibility_per_psi", "temperature_F"].includes(n) : ["mu_water_cP", "brine_standard_density_lb_ft3", "rock_compressibility_per_psi", "temperature_F"].includes(n));
  const inputTabs: [string, string][] = [["system", "Well system"], ["model", "Model"], ["reservoir", "Reservoir & fluids"], ["wells", multiL ? "Wells" : "Injection well"], ["limit", "Pressure limit"], ["shutin", "Shut-in"], ["points", "Monitoring points"], ["report", "Report"]];

  return (
    <main className="app">
      <header className="top">
        <div className="brand">
          <div className="logo" aria-hidden="true">
            <svg className="logo-badge" viewBox="0 0 64 64">
              <defs>
                <linearGradient id="lg-bg" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#1f63c6" />
                  <stop offset="100%" stopColor="#0f8b8d" />
                </linearGradient>
              </defs>
              <rect x="1" y="1" width="62" height="62" rx="16" fill="url(#lg-bg)" />
              <rect x="1" y="1" width="62" height="62" rx="16" fill="none" stroke="#fff" strokeOpacity=".35" strokeWidth="1.5" />
              <ellipse cx="32" cy="44" rx="24" ry="7" fill="none" stroke="#a7f3e6" strokeOpacity=".45" strokeWidth="1.6" />
              <ellipse cx="32" cy="44" rx="14" ry="4.2" fill="none" stroke="#a7f3e6" strokeOpacity=".8" strokeWidth="1.6" />
              <line x1="32" y1="12" x2="32" y2="44" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
              <rect x="25" y="9" width="14" height="7" rx="2" fill="#fff" />
              <circle cx="32" cy="44" r="3.2" fill="#7fe3d6" />
              <text x="32" y="32" textAnchor="middle" fontSize="13" fontWeight="800" fill="#fff" fontFamily="Times New Roman, serif" stroke="#16457a" strokeWidth="3" paintOrder="stroke">CO₂</text>
            </svg>
            <div className="logo-text">
              <b>CO<sub>2</sub>-SATriPI</b>
              <span>Tool</span>
            </div>
          </div>
          <div className="wm-track"><h1 className="wordmark" aria-label="CO₂-SATriPI Tool"><span className="wm-co2">CO<sub>2</sub></span><span className="wm-dash">-</span><span className="wm-name">SATriPI</span><span className="wm-tool">Tool</span></h1></div>
        </div>
        <div className="hdrbtns">
          <a className="toplink" href="/manual" target="_blank" rel="noopener noreferrer">User manual</a>
          <button className="ghost" onClick={exportResults} disabled={!applied || !!fieldError}>Export results CSV</button>
          <button onClick={() => exportReport("pdf")} disabled={!applied || !!busy || !!fieldError}>Report (PDF)</button>
          <button onClick={() => exportReport("docx")} disabled={!applied || !!busy || !!fieldError}>Report (Word)</button>
        </div>
      </header>
      {busy && <p className="hint">{busy}</p>}

      <div className="layout">
        <aside className="panel">
          <div className="runbar">
            <button className="run" onClick={() => runNow()}>▶ RUN analysis</button>
            <span className="hint"> {applied ? (stale ? "Inputs changed — press RUN to update." : "Results are up to date.") : "Set your inputs, then press RUN."}</span>
          </div>
          {liveError && <p className="err">Input problem: {liveError}</p>}

          <section className="inputs">
            <div className="row-head inhead">
              <div className="inhead-title">
                <svg className="inhead-ic" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" />
                  <circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" />
                </svg>
                <h2>Input</h2>
              </div>
              <label className="unitpick"><span>Units</span>
              <select className="preset" aria-label="Unit preset" title="Unit preset" value={presetName}
                onChange={(e) => { if (e.target.value !== "Custom") setUnits(PRESETS[e.target.value as "SI" | "Field"]); }}>
                <option value="Field">Field units</option>
                <option value="SI">SI units</option>
                {presetName === "Custom" && <option value="Custom">Custom units</option>}
              </select>
              </label>
            </div>
            <nav className="tabs intabs" role="tablist" aria-label="Input sections">
              {inputTabs.map(([k, l]) => (
                <button key={k} role="tab" aria-selected={inTab === k} aria-expanded={inTab === k} className={inTab === k ? "on" : ""} onClick={() => setInTab(inTab === k ? "" : k)}>{l}</button>
              ))}
            </nav>

            <div className="group" data-group="system" hidden={inTab !== "system"}>
              <h3>Well system</h3>
              <div className="sysbtns" role="radiogroup" aria-label="Well system">
                <label className={`sysbtn ${systemL === "single" ? "on" : ""}`}>
                  <input type="radio" name="system" checked={systemL === "single"} onChange={() => setSystem("single")} />
                  <b>Single well</b>
                </label>
                <label className={`sysbtn ${systemL === "multi" ? "on" : ""}`}>
                  <input type="radio" name="system" checked={systemL === "multi"} onChange={() => setSystem("multi")} />
                  <b>Multiwell interference</b>
                </label>
              </div>
            </div>

            <div className="group" data-group="model" hidden={inTab !== "model"}>
              <h3>Pressure model and boundary</h3>
              <div className="subhd">Fluid model</div>
              <div className="grid1">
                <label className="field"><span>Phase / fluid</span>
                  <select aria-label="Phase / fluid" value={modelL} onChange={(e) => setModel(e.target.value as ModelKind)}>
                    <option value="two">Two-phase CO₂–brine (three-zone model)</option>
                    <option value="co2">Single-phase CO₂</option>
                    <option value="water">Single-phase water</option>
                  </select>
                </label>
                {modelL === "two" && (
                  <label className="field"><span>Evaporation</span>
                    <select aria-label="Include evaporation" value={flL.evaporation ? "yes" : "no"} onChange={(e) => setFl((f) => ({ ...f, evaporation: e.target.value === "yes" }))}>
                      <option value="yes">Yes (dry zone next to the well)</option>
                      <option value="no">No (r_d = r_w, no dry zone)</option>
                    </select>
                  </label>
                )}
                {modelL === "two" && (
                  <label className="field"><span>CO₂ dissolution</span>
                    <select aria-label="Include CO2 dissolution" value={flL.dissolution ? "yes" : "no"} onChange={(e) => setFl((f) => ({ ...f, dissolution: e.target.value === "yes" }))}>
                      <option value="no">Off (no CO₂ dissolved in the brine)</option>
                      <option value="yes">On (CO₂ dissolves in the brine: front, S_g2, c_t2, zone 3 flux)</option>
                    </select>
                  </label>
                )}
              </div>
              <div className="subhd">Boundary</div>
              <div className="grid1">
                <label className="field"><span>Boundary</span>
                  <select aria-label="Boundary type" value={boundaryL.type} onChange={(e) => setBoundary({ ...boundaryL, type: e.target.value as Boundary["type"] })}>
                    <option value="none">Infinite</option>
                    <option value="noflow">Sealing fault (no-flow)</option>
                    <option value="constant">Constant pressure</option>
                  </select>
                </label>
              </div>
              {boundaryL.type !== "none" && (
                <div className="grid2" style={{ marginTop: 12 }}>
                  <label className="field"><span>Boundary line</span>
                    <select aria-label="Boundary line" value={boundaryL.axis} onChange={(e) => setBoundary({ ...boundaryL, axis: e.target.value as "x" | "y" })}>
                      <option value="x">{isGeo ? "longitude = const (N–S line)" : "x = const"}</option>
                      <option value="y">{isGeo ? "latitude = const (E–W line)" : "y = const"}</option>
                    </select>
                  </label>
                  {isGeo
                    ? <NumField label={boundaryL.axis === "x" ? "Boundary longitude" : "Boundary latitude"} unit="°" value={boundaryDeg} onChange={setBoundaryDeg} />
                    : uf("distance", { label: "Boundary position", value: boundaryL.positionM, onChange: (v) => setBoundary({ ...boundaryL, positionM: v }) })}
                </div>
              )}
            </div>

            <div className="group" data-group="reservoir" hidden={inTab !== "reservoir"}>
              <h3>Reservoir and fluids</h3>
              <div className="subhd">Formation</div>
              <div className="grid2">
                {uf("perm", { label: "Permeability", value: resL.permMd, onChange: setR("permMd"), min: 0 })}
                <NumField label="Porosity" unit="frac" value={resL.porosity} onChange={setR("porosity")} step={0.01} min={0} />
                {uf("length", { label: "Thickness", value: resL.thicknessM, onChange: setR("thicknessM"), min: 0 })}
                {uf("compress", { label: "Rock compressibility", value: flL.rockComp, onChange: setF("rockComp"), min: 0 })}
                {!multiL && uf("length", { label: "Well radius", value: resL.wellboreRadiusM, onChange: setR("wellboreRadiusM"), min: 0.01 })}
              </div>
              <div className="subhd">Initial conditions</div>
              <div className="grid2">
                {uf("pressure", { label: "Initial pressure (absolute)", value: resL.initialMPa, onChange: setR("initialMPa"), min: 0 })}
                {uf("temp", { label: "Temperature", value: resL.tempC, onChange: setR("tempC") })}
              </div>
              {showF("mu_water_cP") && (
                <>
                  <div className="subhd">Brine</div>
                  <div className="grid2">
                    {uf("viscosity", { label: "Water viscosity", value: flL.muWater, onChange: setF("muWater"), min: 0 })}
                    {uf("density", { label: "Standard density (60 °F, 1 atm)", value: flL.brineDensityKgM3, onChange: setF("brineDensityKgM3"), min: 0 })}
                  </div>
                </>
              )}
              {modelL === "two" && (
                <>
                  <div className="subhd">Relative permeability</div>
                  <div className="grid2">
                    <NumField label="Irreducible water Swr" unit="frac" value={flL.swr} onChange={setF("swr")} step={0.05} min={0} />
                    <NumField label="Gas end-point krg0" value={flL.krg0} onChange={setF("krg0")} step={0.05} min={0} />
                    <NumField label="Water end-point krw0" value={flL.krw0} onChange={setF("krw0")} step={0.05} min={0} />
                    <NumField label="Zone 1 gas krg1" value={flL.krg1} onChange={setF("krg1")} step={0.05} min={0} />
                    <NumField label="Gas Corey exponent ng" unit="1 < ng < 6" value={flL.ng} onChange={setF("ng")} min={1} />
                    <NumField label="Water Corey exponent nw" unit="1 < nw < 6" value={flL.nw} onChange={setF("nw")} min={1} />
                  </div>
                </>
              )}
            </div>

            {!multiL && (
              <div className="group" data-group="wells" hidden={inTab !== "wells"}>
                <h3>Injection well</h3>
                <div className="subhd">Injection</div>
                <div className="grid2">
                  {uf(rateCatL, { label: modelL === "water" ? "Surface water injection rate" : "Surface injection rate", value: singleL.rate, onChange: (v) => setSingle((s) => ({ ...s, rate: v })), min: 0 })}
                  <NumField label="Number of injection years" unit="whole years" value={singleL.years} onChange={(v) => setSingle((s) => ({ ...s, years: v }))} step={1} min={1} />
                </div>
                <div className="subhd">Well completion</div>
                <div className="grid2">
                  <NumField label="Skin factor" value={singleL.skin} onChange={(v) => setSingle((s) => ({ ...s, skin: v }))} step={0.5} />
                </div>
              </div>
            )}

            {multiL && (
              <div className="group" data-group="wells" hidden={inTab !== "wells"}>
                <div className="row-head">
                  <h3>Number of wells and distances</h3>
                  <div className="btns">
                    <button className="ghost" onClick={() => fileRef.current?.click()}>Import CSV</button>
                    <button className="ghost" onClick={() => download("wells.csv", wellsToCsv(rawWells, isGeo))}>Export</button>
                  </div>
                </div>
                <div className="subhd">Number of wells and layout</div>
                <div className="grid2">
                  <NumField label="Number of wells" unit="2–32" value={rawWells.length} onChange={setWellCount} step={1} min={2} />
                  <label className="field"><span>Distances</span>
                    <select aria-label="Distances" value={geomL.mode} onChange={(e) => setGeomSafe({ mode: e.target.value as GeometryIn["mode"] })}>
                      <option value="constant">Constant neighboring spacing</option>
                      <option value="different">Different distances</option>
                    </select>
                  </label>
                  {geomL.mode === "constant" ? (
                    <>
                      <label className="field"><span>Layout</span>
                        <select aria-label="Layout" value={geomL.layout} onChange={(e) => setGeom((g) => ({ ...g, layout: e.target.value as GeometryIn["layout"] }))}>
                          <option value="line">Straight line</option>
                          <option value="grid">Square grid</option>
                        </select>
                      </label>
                      {uf("distance", { label: "Neighboring spacing", value: geomL.spacingM, onChange: (v) => setGeom((g) => ({ ...g, spacingM: v })), min: 0 })}
                    </>
                  ) : (
                    <label className="field"><span>Different-distance input</span>
                      <select aria-label="Different-distance input" value={geomL.method} onChange={(e) => setGeomSafe({ method: e.target.value as GeometryIn["method"] })}>
                        <option value="adjacent">Adjacent distances along a line</option>
                        <option value="pairwise">Full pairwise distance matrix</option>
                        <option value="coordinates">Custom x/y coordinates</option>
                      </select>
                    </label>
                  )}
                  {geomL.mode === "different" && geomL.method === "coordinates" && (
                    <label className="field coordsel"><span>Location input</span>
                      <select value={coordMode} onChange={(e) => switchCoord(e.target.value as "local" | "geo")}>
                        <option value="local">Local x, y</option>
                        <option value="geo">Longitude / latitude (real-world)</option>
                      </select>
                    </label>
                  )}
                </div>
                {geomL.mode === "different" && geomL.method === "adjacent" && (
                  <label className="field" style={{ marginTop: 8 }}><span>Adjacent distances ({dUL.label}): Well 1–2, Well 2–3, …</span>
                    <input aria-label="Adjacent distances" placeholder={rawWells.length > 1 ? `e.g. ${Array.from({ length: rawWells.length - 1 }, (_, i) => [1000, 1500, 800][i % 3]).join(", ")}` : ""} value={geomL.adjacent} onChange={(e) => setGeom((g) => ({ ...g, adjacent: e.target.value }))} />
                  </label>
                )}
                {geomL.mode === "different" && geomL.method === "pairwise" && (
                  <label className="field" style={{ marginTop: 8 }}><span>Pairwise distances ({dUL.label}; numeric CSV, one row per well, zero diagonal)</span>
                    <textarea aria-label="Pairwise distances" rows={Math.min(8, rawWells.length + 1)} className="mono" placeholder={"0, 1000, 1500\n1000, 0, 1200\n1500, 1200, 0"} value={geomL.matrix} onChange={(e) => setGeom((g) => ({ ...g, matrix: e.target.value }))} />
                  </label>
                )}
                <div className="subhd">Well radius</div>
                <div className="grid2">
                  <label className="field"><span>Well radius</span>
                    <select aria-label="Well radius" value={rwModeL} onChange={(e) => {
                      const next = e.target.value as "same" | "each";
                      // switching to one value per well starts every well at the common value
                      if (next === "each" && rwModeL === "same") setWells((ws) => ws.map((w) => ({ ...w, rwM: rwAllL })));
                      setRwMode(next);
                    }}>
                      <option value="same">Same for all wells</option>
                      <option value="each">Different for each well</option>
                    </select>
                  </label>
                  {rwModeL === "same"
                    ? uf("length", { label: "Well radius (all wells)", value: rwAllL, onChange: setRwAll, min: 0 })
                    : <p className="hint" style={{ alignSelf: "end", margin: 0 }}>Enter the radius of each well in the Radius column of the table.</p>}
                </div>
                <input ref={fileRef} type="file" accept=".csv,.txt,.tsv" hidden onChange={(e) => onImport(e.target.files?.[0])} />
                {csvError && <p className="err">{csvError}</p>}
                {geoBad && <p className="err">Latitude must be within ±90° and longitude within ±180°.</p>}
                <div className="subhd">Individual well inputs</div>
                <div className="tablewrap">
                  <table className="edit">
                    <thead><tr>
                      <th>Name</th>
                      {coordsEditable ? (isGeo ? <><th>Lon (°)</th><th>Lat (°)</th></> : <><th>x {unitHead("distance")}</th><th>y {unitHead("distance")}</th></>) : <><th>x ({dUL.label})</th><th>y ({dUL.label})</th></>}
                      <th>Rate {unitHead(rateCatL)}</th><th>Start (yr)</th><th>End (yr)</th>{rwModeL === "each" && <th>Radius {unitHead("length")}</th>}<th>Skin</th>
                      {modelL === "two" && <th>Evaporation</th>}
                      <th>Max BHP {unitHead("pressure")}</th><th />
                    </tr></thead>
                    <tbody>
                      {rawWells.map((w, wi) => (
                        <Fragment key={w.id}>
                        <tr>
                          <td><input value={w.name} aria-label="Well name" onChange={(e) => updWell(w.id, { name: e.target.value })} /></td>
                          {coordsEditable ? (isGeo ? (
                            <>
                              <td><NumField className="geoin" ariaLabel={`${w.name} longitude`} value={w.lon ?? 0} onChange={(v) => updWell(w.id, { lon: v })} /></td>
                              <td><NumField className="geoin" ariaLabel={`${w.name} latitude`} value={w.lat ?? 0} onChange={(v) => updWell(w.id, { lat: v })} /></td>
                            </>
                          ) : (
                            <>
                              <td>{uf("distance", { ariaLabel: `${w.name} x`, value: w.x, onChange: (v) => updWell(w.id, { x: v }) })}</td>
                              <td>{uf("distance", { ariaLabel: `${w.name} y`, value: w.y, onChange: (v) => updWell(w.id, { y: v }) })}</td>
                            </>
                          )) : (
                            <>
                              <td className="calc" title="Calculated from the distances">{wellsL[wi] ? D(wellsL[wi].x) : "–"}</td>
                              <td className="calc" title="Calculated from the distances">{wellsL[wi] ? D(wellsL[wi].y) : "–"}</td>
                            </>
                          )}
                          <td>{uf(rateCatL, { ariaLabel: `${w.name} rate`, value: w.rate, onChange: (v) => updWell(w.id, { rate: v }), min: 0 })}</td>
                          <td><NumField ariaLabel={`${w.name} start year`} value={w.startYr} onChange={(v) => updWell(w.id, { startYr: v })} min={0} /></td>
                          <td><NumField ariaLabel={`${w.name} end year`} value={w.endYr} onChange={(v) => updWell(w.id, { endYr: v })} min={0} /></td>
                          {rwModeL === "each" && <td>{uf("length", { ariaLabel: `${w.name} radius`, value: w.rwM ?? B0.rw_ft * FT, onChange: (v) => updWell(w.id, { rwM: v }), min: 0 })}</td>}
                          <td><input type="number" step="any" className="skininput" aria-label={`${w.name} skin`} value={w.skinText} placeholder="0" title="Skin factor of this well (blank = 0)" onChange={(e) => updWell(w.id, { skinText: e.target.value })} /></td>
                          {modelL === "two" && (
                            <td>
                              <select aria-label={`${w.name} evaporation`} value={w.evaporation ?? "inherit"} onChange={(e) => updWell(w.id, { evaporation: e.target.value as "inherit" | "on" | "off" })}>
                                <option value="inherit">inherit</option>
                                <option value="on">on</option>
                                <option value="off">off</option>
                              </select>
                            </td>
                          )}
                          <td>
                            <input type="number" step="any" className="skininput" aria-label={`${w.name} maximum BHP`} placeholder="shared"
                              title="This well's own maximum allowable BHP (absolute); blank = the shared pressure limit"
                              value={w.maxBhpMPa === null || w.maxBhpMPa === undefined ? "" : +fromCanon(pUL, w.maxBhpMPa).toPrecision(6)}
                              onChange={(e) => updWell(w.id, { maxBhpMPa: e.target.value.trim() === "" || !Number.isFinite(Number(e.target.value)) ? null : toCanon(pUL, Number(e.target.value)) })} />
                          </td>
                          <td className="actions">
                            {modelL !== "two" && <button className="x" aria-label={`Add a rate change for ${w.name}`} title="Add a rate change (single-phase: a new rate from a later year; rate 0 stops the well)" onClick={() => addChange(w.id)}>＋</button>}
                            <button className="x" aria-label={`Remove ${w.name}`} disabled={rawWells.length <= 2} onClick={() => setWells((ws) => (ws.length > 2 ? ws.filter((q) => q.id !== w.id) : ws))}>×</button>
                          </td>
                        </tr>
                        {modelL !== "two" && (w.changes ?? []).map((ch, ci) => (
                          <tr key={`${w.id}-c${ci}`} className="subrow">
                            <td className="sub">↳ rate change</td>
                            <td colSpan={2} className="sub">new rate from year →</td>
                            <td>{uf(rateCatL, { ariaLabel: `${w.name} new rate ${ci + 1}`, value: ch.rate, onChange: (v) => updChange(w.id, ci, { rate: v }), min: 0 })}</td>
                            <td><NumField ariaLabel={`${w.name} rate change year ${ci + 1}`} value={ch.yr} onChange={(v) => updChange(w.id, ci, { yr: v })} min={0} /></td>
                            <td colSpan={rwModeL === "each" ? 3 : 2} />
                            <td />
                            <td><button className="x" aria-label={`Remove rate change ${ci + 1} of ${w.name}`} onClick={() => delChange(w.id, ci)}>×</button></td>
                          </tr>
                        ))}
                        </Fragment>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!layoutL.error && layoutL.wells.length > 1 && (
                  <details className="seps" open={layoutL.wells.length <= 6}>
                    <summary>Well separation distances ({dUL.label})</summary>
                    <div className="tablewrap">
                      <table className="matrix compact">
                        <thead><tr><th />{layoutL.wells.map((w, i) => <th key={i}>{w.name}</th>)}</tr></thead>
                        <tbody>
                          {wellSeparations(layoutL.wells).map((row, i) => (
                            <tr key={i}><th>{layoutL.wells[i].name}</th>{row.map((v, j) => <td key={j}>{(fromCanon(dUL, v * FT)).toFixed(1)}</td>)}</tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
                <div className="subhd">Reporting</div>
                <label className="field"><span>Reporting times (project years; blank = annual)</span>
                  <input aria-label="Reporting times" placeholder="e.g. 0.5, 1, 5, 10, 30" value={reportL} onChange={(e) => setReportL(e.target.value)} />
                </label>
              </div>
            )}

            <div className="group" data-group="limit" hidden={inTab !== "limit"}>
              <h3>Will the required pressure exceed a limit?</h3>
              <div className="subhd">Pressure limit</div>
              <div className="grid2">
                <label className="field"><span>Pressure assessment</span>
                  <select aria-label="Pressure assessment" value={limitL.mode} onChange={(e) => setLimitL((l) => ({ ...l, mode: e.target.value as LimitIn["mode"] }))}>
                    <option value="none">Not assessed — no limit supplied</option>
                    <option value="max_bhp">Maximum allowable BHP</option>
                    <option value="fracture_fraction">Fraction of fracture pressure</option>
                  </select>
                </label>
                {limitL.mode === "max_bhp" && uf("pressure", { label: "Maximum allowable BHP (absolute)", value: limitL.maxBhpMPa, onChange: (v) => setLimitL((l) => ({ ...l, maxBhpMPa: v })), min: 0 })}
                {limitL.mode === "fracture_fraction" && (
                  <>
                    {uf("pressure", { label: "Fracture pressure (absolute)", value: limitL.fractureMPa, onChange: (v) => setLimitL((l) => ({ ...l, fractureMPa: v })), min: 0 })}
                    <NumField label="Allowable fraction" unit="0–1" value={limitL.fraction} onChange={(v) => setLimitL((l) => ({ ...l, fraction: v }))} step={0.05} min={0} />
                  </>
                )}
              </div>
              <div className="subhd">Interference</div>
              <div className="grid2">
                {uf("pressure", { label: "Interference threshold", value: thresholdL, onChange: setThreshold })}
              </div>
            </div>

            <div className="group" data-group="shutin" hidden={inTab !== "shutin"}>
              <h3>Post-shut-in observation</h3>
              <div className="subhd">Observation after injection stops</div>
              <div className="grid1">
                <label className="field"><span>Include pressure observation after injection stops?</span>
                  <select aria-label="Include observation" value={observeL} onChange={(e) => setObserve(e.target.value as "yes" | "no")}>
                    <option value="yes">Yes</option>
                    <option value="no">No</option>
                  </select>
                </label>
              </div>
              {observeL === "yes" && (
                <>
                <div className="subhd">Observation period</div>
                <div className="grid2">
                  <label className="field"><span>Observation duration (years)</span>
                    <input type="number" step="any" min={0} placeholder="e.g. 10" aria-label="Observation duration (years)" value={obsPeriodL} onChange={(e) => setObsPeriod(e.target.value)} />
                  </label>
                  <label className="field"><span>Observation years to report</span>
                    <input type="text" placeholder="e.g. 0, 0.5, 1, 5, 10" aria-label="Observation years to report" value={obsYearsL} onChange={(e) => setObsYears(e.target.value)} />
                  </label>
                </div>
                </>
              )}
            </div>

            <div className="group" data-group="points" hidden={inTab !== "points"}>
              <h3>Monitoring points</h3>
              <div className="subhd">Point locations</div>
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
            </div>

            <div className="group" data-group="report" hidden={inTab !== "report"}>
              <h3>Report details</h3>
              <div className="subhd">Report title page</div>
              <div className="grid2">
                <label className="field"><span>Project name</span><input value={project} onChange={(e) => setProject(e.target.value)} placeholder="optional" /></label>
                <label className="field"><span>Author</span><input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="optional" /></label>
              </div>
            </div>
          </section>
        </aside>

        <section className="results">
          {!applied && (
            <div className="empty welcome">
              <svg className="welcome-art" viewBox="0 0 320 170" aria-hidden="true">
                <defs>
                  <radialGradient id="wg1" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#14a39a" stopOpacity=".55" />
                    <stop offset="100%" stopColor="#14a39a" stopOpacity="0" />
                  </radialGradient>
                  <radialGradient id="wg2" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#2f6fd6" stopOpacity=".5" />
                    <stop offset="100%" stopColor="#2f6fd6" stopOpacity="0" />
                  </radialGradient>
                </defs>
                <rect x="10" y="118" width="300" height="34" rx="8" className="wa-layer" />
                <ellipse cx="110" cy="135" rx="78" ry="16" fill="url(#wg1)" />
                <ellipse cx="210" cy="135" rx="78" ry="16" fill="url(#wg2)" />
                <ellipse cx="160" cy="135" rx="20" ry="6" className="wa-overlap" />
                {[110, 210].map((x, i) => (
                  <g key={x}>
                    <line x1={x} y1="34" x2={x} y2="135" className="wa-pipe" />
                    <rect x={x - 13} y="20" width="26" height="16" rx="3" className={i ? "wa-head b" : "wa-head"} />
                    <circle cx={x} cy="135" r="4.5" className={i ? "wa-dot b" : "wa-dot"} />
                    {[0, 1, 2].map((k) => <ellipse key={k} cx={x} cy="135" rx="18" ry="5" className={i ? "wa-ring b" : "wa-ring"} style={{ animationDelay: `${k * 0.9 + i * 0.45}s` }} />)}
                  </g>
                ))}
              </svg>
              <span className="welcome-badge"><i aria-hidden="true" />Ready</span>
              <h2 className="welcome-title">No results yet</h2>
              <p className="welcome-text"><span className="welcome-arrow" aria-hidden="true">←</span>Check the inputs on the left, then run the analysis.</p>
              <button type="button" className="run welcome-run" onClick={() => runNow()}>▶ RUN analysis</button>
              <ol className="welcome-steps">
                <li><span>1</span>Choose the well system</li>
                <li><span>2</span>Set the inputs</li>
                <li><span>3</span>Press RUN</li>
              </ol>
            </div>
          )}

          {applied && fieldError && (
            <>
              {stale && <div className="stale">The inputs have changed since the last run — press <b>▶ RUN analysis</b> to try again. <button type="button" className="linkbtn" onClick={() => runNow()}>▶ RUN analysis</button></div>}
              <div className="empty">
                <p><b>Calculation stopped.</b></p>
                <p className="err">{fieldError}</p>
                <p className="hint">The program checks its inputs and its intermediate results (for example the zone 2 saturation must stay between 0 and 1 − Swr). Change the inputs and press RUN again.</p>
              </div>
            </>
          )}

          {applied && !fieldError && (
            <>
              {stale && <div className="stale">The inputs have changed since the last run. The results below still show the previous run — press <b>▶ RUN analysis</b> to update them. <button type="button" className="linkbtn" onClick={() => runNow()}>▶ RUN analysis</button></div>}
              {warnings.length > 0 && (
                <ul className="warn">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
              )}

              <div className="kpis">
                {(() => {
                  const peakMPa = worstRow ? worstRow.peak_BHP_psia * PSI : null;
                  const frac = peakMPa !== null && lim.allowableMPa ? Math.min(1, Math.max(0, (peakMPa - lim.initialMPa) / (lim.allowableMPa - lim.initialMPa))) : null;
                  return (
                    <div className="kpi kpi-peak">
                      <i className="kpi-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3v13" /><path d="M7 8l5-5 5 5" /><path d="M4 21h16" /></svg></i>
                      <span>Peak BHP (worst well)</span>
                      <b>{peakMPa !== null ? P(peakMPa, 2) : "–"}<em>{pU.label}</em></b>
                      {frac !== null && (
                        <div className="kpi-bar" role="img" aria-label={`Peak buildup is ${Math.round(frac * 100)}% of the allowable buildup`}>
                          <div style={{ width: `${Math.max(2, frac * 100)}%` }} className={frac >= 1 ? "over" : ""} />
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="kpi kpi-allow">
                  <i className="kpi-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7z" /></svg></i>
                  <span>Allowable BHP</span>
                  <b>{lim.allowableMPa !== null ? <>{P(lim.allowableMPa, 1)}<em>{pU.label}</em></> : "Not assessed"}</b>
                </div>
                <div className={`kpi kpi-status ${overall === "FAIL" ? "bad" : overall === "PASS" ? "good" : ""}`}>
                  <i className="kpi-ic" aria-hidden="true">
                    {overall === "FAIL"
                      ? <svg viewBox="0 0 24 24"><path d="M7 7l10 10M17 7L7 17" /></svg>
                      : overall === "PASS" ? <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
                      : <svg viewBox="0 0 24 24"><path d="M6 12h12" /></svg>}
                  </i>
                  <span>Pressure status</span>
                  <b>{overall}</b>
                </div>
                <div className="kpi kpi-mass">
                  <i className="kpi-ic" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="8" cy="14" r="4" /><circle cx="16" cy="10" r="5" /></svg></i>
                  <span>Cumulative {fluidName} injected (field)</span>
                  <b>{massText(injected.totalLb).split(" ")[0]}<em>{massText(injected.totalLb).split(" ")[1]}</em></b>
                </div>
              </div>

              <nav className="tabs" role="tablist">
                {tabs.map(([v, l]) => (
                  <button key={v} role="tab" aria-selected={viewEff === v} className={viewEff === v ? "on" : ""} onClick={() => { setView(v); setPlaying(false); }}>{l}</button>
                ))}
              </nav>

              <div className="controls">
                {(viewEff === "map" || viewEff === "sat") && (
                <div className="field slider timeplay">
                  <span>Evaluation time <em>{tNow.toFixed(1)} yr</em></span>
                  <div className="playrow">
                    <button type="button" className={`playbtn ${playing ? "on" : ""}`} onClick={togglePlay}
                      aria-label={playing ? "Pause the time animation" : "Play the time animation"} title={playing ? "Pause" : "Play through time"}>
                      {playing
                        ? <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.5" y="3.5" width="4" height="13" rx="1" /><rect x="11.5" y="3.5" width="4" height="13" rx="1" /></svg>
                        : <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M6 3.6v12.8a.8.8 0 0 0 1.2.7l10.2-6.4a.8.8 0 0 0 0-1.4L7.2 2.9A.8.8 0 0 0 6 3.6z" /></svg>}
                    </button>
                    <input type="range" aria-label="Evaluation time" min={0.1} max={horizon} step={0.1} value={tNow} onChange={(e) => { setPlaying(false); setTEval(+e.target.value); }} />
                  </div>
                </div>
                )}
                <label className="field"><span>Pressure unit</span>
                  <select value={units.pressure} onChange={(e) => setUnit("pressure")(e.target.value)}>
                    {UNITS.pressure.map((u) => <option key={u.label} value={u.label}>{u.label}</option>)}
                  </select>
                </label>
                {(viewEff === "map" || viewEff === "sat") && (
                  <>
                    <label className="field"><span>Map area</span>
                      <select aria-label="Map area" value={mapArea} onChange={(e) => setMapArea(e.target.value as "wells" | "all")}>
                        <option value="wells">Around the wells</option>
                        <option value="all">Wells and monitoring points</option>
                      </select>
                    </label>
                    {uf("distance", { label: padM === null ? "Map padding (auto)" : "Map padding", value: viewEff === "map" ? padPressEff : padEff, onChange: (v) => setPadM(Math.max(0, v)), min: 0 })}
                    {padM !== null && <button type="button" className="ghost" style={{ alignSelf: "end" }} onClick={() => setPadM(null)}>Auto padding</button>}
                  </>
                )}
                {viewEff === "series" && (
                  <label className="field"><span>Show</span>
                    <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                      <option value="bhp">Bottomhole pressure (absolute)</option>
                      <option value="total">Total buildup (ΔP)</option>
                      <option value="interference">Interference only (excl. self)</option>
                    </select>
                  </label>
                )}
                {viewEff === "bhp" && multi && (
                  <label className="field"><span>Well</span>
                    <select value={bhpIdx} onChange={(e) => setBhpWell(+e.target.value)}>
                      {wells.map((w, i) => <option key={w.id} value={i}>{w.name}</option>)}
                    </select>
                  </label>
                )}
              </div>

              {viewEff === "mw" && mwRun && mwFiles && mwPlots && (
                <div id="results">
                  <div className="plotwrap" role="img" aria-label="BHP and interference of every well versus project time" dangerouslySetInnerHTML={{ __html: mwPlots[0].svg.replace(`width="${mwPlots[0].width}" height="${mwPlots[0].height}"`, 'width="100%"') }} />
                  <div className="plotwrap" role="img" aria-label="Final interference matrix and front estimates" dangerouslySetInnerHTML={{ __html: mwPlots[1].svg.replace(`width="${mwPlots[1].width}" height="${mwPlots[1].height}"`, 'width="100%"') }} />
                  <h3>Multiwell pressure and interference</h3>
                  <PyTable cols={MW_SUMMARY_COLS} rows={mwRun.result.summary.filter((r) => r.year === mwRun.result.years)} />
                  <h3>Peak pressure assessment</h3>
                  <PyTable cols={FAILURE_COLS} rows={mwRun.limitSummary} fmt=".4f" />
                  <h3>Cumulative {fluidName} injected at the end of injection</h3>
                  <InjectedTable />
                  <h3>Well separation distances (ft)</h3>
                  <div className="bhp-summary-wrap">
                    <table className="bhp-summary">
                      <thead><tr><th />{mwRun.result.wells.map((w) => <th key={w.name}>{w.name}</th>)}</tr></thead>
                      <tbody>{wellSeparations(mwRun.result.wells).map((row, i) => <tr key={i}><th>{mwRun.result.wells[i].name}</th>{row.map((v, j) => <td key={j}>{v.toFixed(3)}</td>)}</tr>)}</tbody>
                    </table>
                  </div>
                  {mwRun.observation && (
                    <>
                      <h3>After all wells stop</h3>
                      <PyTable cols={MW_OBS_COLS} rows={mwRun.observation.rows} />
                    </>
                  )}
                  <h3>Download calculations</h3>
                  <ul className="files">
                    {Object.entries(mwFiles).map(([name, text]) => (
                      <li key={name}><button type="button" className="linkbtn" onClick={() => textFile(name, text)}>{name}</button></li>
                    ))}
                    <li><button type="button" className="linkbtn" onClick={() => savePlot(mwPlots[0], "multiwell_bhp_and_interference.png")}>multiwell_bhp_and_interference.png</button></li>
                    <li><button type="button" className="linkbtn" onClick={() => savePlot(mwPlots[1], "multiwell_matrix_and_fronts.png")}>multiwell_matrix_and_fronts.png</button></li>
                  </ul>
                  <details>
                    <summary>multiwell_summary.csv at every reporting time ({mwRun.result.report_times.length} times)</summary>
                    <PyTable cols={MW_SUMMARY_COLS} rows={mwRun.result.summary} />
                  </details>
                </div>
              )}

              {viewEff === "sat" && specSat && (
                <>
                  <ChartView key={`sat-${runId}`} spec={specSat} title={`CO₂ saturation map at t = ${tNow.toFixed(1)} yr`} filename="co2-saturation-map" />
                  <h3>CO₂ zones of each well at t = {tNow.toFixed(1)} yr</h3>
                  <div className="tablewrap">
                    <table className="matrix">
                      <thead><tr><th>Well</th><th>CO₂ injected (Mt)</th><th>Gas front r<sub>g</sub> ({dU.label})</th><th>Dry front r<sub>d</sub> ({dU.label})</th><th>Zone 2 Sg</th><th>Front Sg</th><th>Max Sg</th></tr></thead>
                      <tbody>
                        {plumes.map((q) => (
                          <tr key={q.id}>
                            <th><input className="nameedit" aria-label={`Rename ${q.name}`} title="Click to rename this well" value={q.name} onChange={(e) => updWell(q.id, { name: e.target.value })} /></th><td>{q.massMt.toFixed(4)}</td><td>{D(q.radius)}</td><td>{D(q.dryR)}</td><td>{Number.isFinite(q.sg2) ? q.sg2.toFixed(3) : "–"}</td><td>{frontSg.toFixed(3)}</td><td>{satModel.smax.toFixed(2)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              {viewEff === "map" && specMap && (
                <>
                  <div className="mapstyle">
                    <label className="field"><span>Colour scale</span>
                      <select aria-label="Colour scale" value={mapStyle.cmap} onChange={(e) => setStyle({ cmap: e.target.value })}>
                        {COLORMAP_LABELS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                      </select>
                    </label>
                    <label className="field"><span>Fill</span>
                      <select aria-label="Fill style" value={mapStyle.fill} onChange={(e) => setStyle({ fill: e.target.value as MapStyle["fill"] })}>
                        <option value="smooth">Smooth colours</option>
                        <option value="bands">Colour bands</option>
                        <option value="none">No fill</option>
                      </select>
                    </label>
                    {mapStyle.fill === "bands" && (
                      <label className="field"><span>Bands</span>
                        <select aria-label="Number of colour bands" value={mapStyle.bands} onChange={(e) => setStyle({ bands: +e.target.value })}>
                          {[5, 6, 8, 10, 12, 15, 20].map((n) => <option key={n} value={n}>{n}</option>)}
                        </select>
                      </label>
                    )}
                    <label className="check"><input type="checkbox" aria-label="Reverse colours" checked={!!mapStyle.reverse} onChange={(e) => setStyle({ reverse: e.target.checked })} /> Reverse colours</label>
                    <label className="check"><input type="checkbox" aria-label="Contour lines" checked={!!mapStyle.contours} onChange={(e) => setStyle({ contours: e.target.checked })} /> Contour lines</label>
                    {mapStyle.contours && (
                      <>
                        <label className="field"><span>Levels</span>
                          <select aria-label="Number of contour levels" value={mapStyle.nContours} onChange={(e) => setStyle({ nContours: +e.target.value })}>
                            {[5, 8, 10, 15, 20, 30, 40].map((n) => <option key={n} value={n}>{n}</option>)}
                          </select>
                        </label>
                        <label className="field"><span>Contours of</span>
                          <select aria-label="Contour source" value={mapStyle.contourSource ?? "wells"} onChange={(e) => setStyle({ contourSource: e.target.value as "wells" | "total" })}>
                            <option value="wells">Each well separately</option>
                            <option value="total">Total field</option>
                          </select>
                        </label>
                        <label className="field"><span>Contour reach</span>
                          <select aria-label="Contour reach" value={String(mapStyle.contourReach ?? 0.35)} onChange={(e) => setStyle({ contourReach: +e.target.value })}>
                            <option value="0.1">Close to the wells</option>
                            <option value="0.2">Around the wells</option>
                            <option value="0.35">Wide</option>
                            <option value="0.5">Half the map</option>
                            <option value="1">Whole map</option>
                          </select>
                        </label>
                        <label className="check"><input type="checkbox" aria-label="Contour labels" checked={!!mapStyle.contourLabels} onChange={(e) => setStyle({ contourLabels: e.target.checked })} /> Labels</label>
                      </>
                    )}
                    <label className="check"><input type="checkbox" aria-label="Streamlines" checked={!!mapStyle.streamlines} onChange={(e) => setStyle({ streamlines: e.target.checked })} /> Streamlines</label>
                    <button className="ghost" onClick={() => setMapStyle(DEFAULT_MAP_STYLE)}>Reset style</button>
                  </div>
                  <ChartView key={`map-${runId}`} spec={specMap} title={`Pressure buildup map at t = ${tNow.toFixed(1)} yr`} filename="pressure-map" />
                </>
              )}

              {viewEff === "series" && (
                <>
                  <ChartView key={`series-${runId}-${mode}`} spec={specSeries} title={mode === "bhp" ? "Bottomhole pressure of each well vs time" : mode === "total" ? "Wellbore pressure buildup vs time" : "Interference pressure at each well vs time"} filename={`time-series-${mode}`} />
                  {wells.length > 0 && (
                    <>
                      <h3>What drives the field maximum</h3>
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
                  <p className="caption">Wells are evaluated at the wellbore radius; dashed lines are monitoring points. Bottomhole pressure = initial pressure + own response from the program + skin + interference from every other well; the field lines show the highest and the average across all wells at each time. Interference-only removes each well&apos;s own contribution at its own location.</p>
                </>
              )}

              {viewEff === "bhp" && wells[bhpIdx] && (
                <>
                  {multi && specWellBhp && <ChartView key={`wbhp-${runId}-${bhpIdx}`} spec={specWellBhp} title={`Bottom-hole pressure of ${wells[bhpIdx].name}, with interference from the other wells`} filename={`${wells[bhpIdx].name}-bhp`} />}
                  {code.out && codePlot && (
                    <div className="plotwrap" role="img" aria-label="Bottom-hole pressure versus elapsed time" dangerouslySetInnerHTML={{ __html: codePlot.svg.replace(`width="${codePlot.width}" height="${codePlot.height}"`, 'width="100%"') }} />
                  )}
                  {multi && <h3>Your program for {wells[bhpIdx].name} on its own</h3>}
                  {code.note && <p className="caption" style={{ marginTop: 0 }}>Note: {code.note}.</p>}
                  {code.error && <p className="err" role="alert">{code.error}</p>}
                  {code.out && codeFiles && codePlot && (
                    <div id="results">
                      <h3>Calculated pressure</h3>
                      <p>{code.out.label} · End-of-injection BHP at year {code.out.years}: <strong>{code.out.results[code.out.results.length - 1].BHP_psia.toFixed(3)} psia</strong></p>
                      {code.out.observation && (
                        <>
                          <h3>Selected post-shut-in observation years</h3>
                          <SummaryTable rows={code.out.observation.rows} />
                        </>
                      )}
                      <h3>Annual injection results</h3>
                      <SummaryTable rows={code.out.results} />
                      <h3>Pressure assessment</h3>
                      <PyTable cols={FAILURE_COLS} rows={pressureLimitSummary(code.out).map((r) => ({ ...r, well: wells[bhpIdx].name }))} fmt=".4f" />
                      {!multi && (
                        <>
                          <h3>Cumulative {fluidName} injected at the end of injection</h3>
                          <InjectedTable />
                        </>
                      )}
                      <h3>Saved results</h3>
                      <ul className="files">
                        {Object.entries(codeFiles).map(([name, text]) => (
                          <li key={name}><button type="button" className="linkbtn" onClick={() => textFile(`${wells[bhpIdx].name}-${name}`, text)}>{name}</button></li>
                        ))}
                        <li><button type="button" className="linkbtn" onClick={saveCodePlot}>bhp_vs_year.png</button></li>
                      </ul>
                      <details>
                        <summary>all_calculations.csv (every annual intermediate calculation, including the zone diffusivity ratios D1, D2, D3)</summary>
                        <FileTable columns={Object.keys(code.out.results[0])} rows={code.out.results} />
                      </details>
                      <details>
                        <summary>first_year_detail.csv (initial state and detailed BHP samples through year 1)</summary>
                        <FileTable columns={DETAIL_FIELDS} rows={code.out.firstYear} />
                      </details>
                    </div>
                  )}
                </>
              )}

              {viewEff === "matrix" && (
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

              {viewEff === "limits" && (
                <>
                  <div className="tablewrap">
                    <table className="matrix">
                      <thead><tr><th>Well</th><th>Status</th><th>Peak BHP ({pU.label})</th><th>at (yr)</th>{multi && <><th>own formation</th><th>skin</th><th>interference</th></>}<th>Allowable BHP ({pU.label})</th><th>Minimum margin ({pU.label})</th><th>First exceedance (yr)</th></tr></thead>
                      <tbody>
                        {limitRows.map((r) => {
                          const sp = peakSplit(r);
                          const n = (v: unknown, d = 2) => (typeof v === "number" ? P(v * PSI, d) : "–");
                          return (
                            <tr key={r.well}>
                              <th>{nameOf(r.well)}</th>
                              <td className={r.overall_status === "FAIL" ? "bad-cell" : r.overall_status === "PASS" ? "good-cell" : ""}>{r.overall_status}</td>
                              <td>{n(r.peak_BHP_psia)}</td><td>{typeof r.peak_project_year === "number" ? +r.peak_project_year.toFixed(4) : "–"}</td>
                              {multi && <><td>{n(sp?.own_formation_response_psi)}</td><td>{n(sp?.own_skin_psi)}</td><td>{n(sp?.interference_psi)}</td></>}
                              <td>{n(r.max_allowable_BHP_psia)}</td><td>{n(r.minimum_pressure_margin_psi)}</td>
                              <td>{typeof r.first_detected_failure_year === "number" ? +r.first_detected_failure_year.toFixed(4) : "–"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
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

              {viewEff === "compare" && (
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
                          {cases.map((k) => <td key={k.key}>{Number.isFinite(lim.maxBuildupMPa) ? P(lim.maxBuildupMPa) : "–"}</td>)}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="caption">
                    Boundary line: {boundary.axis} = {D(boundary.positionM)} {dU.label}. Red cells exceed the allowable buildup. A no-flow boundary is the most conservative case (the image well adds pressure); a constant-pressure boundary the least (the image well relieves pressure).
                  </p>
                </>
              )}

              {viewEff === "mw" && (
              <details className="assump">
                <summary>Model assumptions and limitations</summary>
                <ul>
                  <li>Each well follows the reference injection-BHP program ({modelLabel(bhpIn)}): homogeneous, confined, infinite-acting radial flow with one permeability and porosity for all zones, constant temperature and viscosities. In the two-phase model the dry-CO₂, CO₂ + brine and brine zones each have their own mobility and compressibility, the fronts grow with the injected volume, and the CO₂ properties come from the Peng–Robinson equation of state for pure CO₂ at the well&apos;s bottom-hole pressure (solved to 10⁻⁴ psi).</li>
                  <li>{multi
                    ? <>Multiwell interference follows the program&apos;s multiwell section: the pressure at every well is the sum of every source&apos;s radial pressure profile (the well itself at its own radius), so a well&apos;s BHP = initial pressure + own formation response + skin + interference. Each two-phase source has one constant rate from its start year, and its Peng–Robinson properties and fronts are evaluated at its own total BHP (the coupled system of all wells is solved at every time). This is a representative-property multiphase superposition approximation: overlapping plumes are flagged, not resolved. Single-phase wells may change rate (time superposition). Each well stops at its own End year: a single-phase stop is a rate change to 0 (the program's rate schedule); a two-phase well that stops before the last one follows the program's fixed-zone falloff from its end year while the others continue (an extension: the program stops all wells together).</>
                    : <>Single well: the program&apos;s single-well calculation, one well at a constant rate from year 0. The maps and curves evaluate the same well&apos;s radial pressure profile around it.</>}</li>
                  <li>After shut-in the pressure diffuses at zero rate with the zones frozen at shut-in (the program&apos;s fixed-zone falloff approximation).</li>
                  <li>Skin adds 141.2·μ·q·B·s/(k·h) at the injector itself, only while injecting. Wellbore storage, gravity override, dissolution and trapping are not modelled.</li>
                  <li>The program is infinite-acting. A boundary (one straight line) is an addition of this website, handled by image wells in the maps, curves and matrix; the program results stay infinite-acting. Leaky caprock, multiple faults and heterogeneity are not modelled. The equations have not been fitted to simulation.</li>
                  <li>Use for screening and ranking of well layouts; confirm with numerical simulation before decisions.</li>
                </ul>
              </details>
              )}
            </>
          )}
        </section>
      </div>
    </main>
  );
}
