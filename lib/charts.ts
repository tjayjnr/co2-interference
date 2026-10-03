// Chart generators that return self-contained SVG strings (title and legend included), so the same
// drawing can be shown on screen (theme "css") and exported as SVG/PNG/report figures (theme "light").
// Every generator accepts an optional zoom `view` (data coordinates); the plot is clipped to the plot area.

import { isoSegments, type Segment } from "./contour";
import { findPeaks, streamPaths, type GridPoint } from "./streamlines";
import { unproject } from "./geo";
import type { Boundary, GridResult, Point, Well } from "./physics";

export type Theme = "css" | "light";

export interface Series {
  name: string;
  color: string;
  x: number[];
  y: number[];
  dash?: string;
}

export interface LineOpts {
  series: Series[];
  xLabel: string;
  yLabel: string;
  hline?: { y: number; label: string };
  markerX?: number;
  markerLabel?: string;
  yMin?: number;
  height?: number;
}

export interface StackOpts {
  layers: Series[];
  xLabel: string;
  yLabel: string;
  height?: number;
}

export interface MapOpts {
  grid: GridResult;
  wells: Well[];
  points: Point[];
  boundary: Boundary;
  contourLevels: { level: number; label: string; cls: "thr" | "lim" }[];
  pf: number;
  pLabel: string;
  pDec: number;
  df: number;
  dLabel: string;
  geo?: { lat0: number; lon0: number }; // when set, axes are labelled with longitude / latitude
  legendTitle?: string; // default "Pressure buildup"
  palette?: "heat" | "sat"; // colour scale
  style?: MapStyle; // colour scale, fill, contour lines and streamlines chosen by the user
  wellGrids?: GridResult[]; // pressure change of each well alone (same grid as `grid`), for per-well contours
  tickDec?: number; // minimum decimals on the colour-bar labels
}

export type ChartSpec =
  | { kind: "line"; opts: LineOpts }
  | { kind: "stack"; opts: StackOpts }
  | { kind: "map"; opts: MapOpts };

export interface View {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export interface Rendered {
  svg: string;
  width: number;
  height: number;
  plot: { l: number; t: number; w: number; h: number }; // plot rectangle in SVG units
  domain: View; // full (unzoomed) data domain
  view: View; // domain actually drawn
}

const FONT = "font-family:'Times New Roman',Times,serif";
let uid = 0;

function palette(t: Theme) {
  return t === "css"
    ? { text: "var(--text)", muted: "var(--muted)", line: "var(--line)", bad: "var(--bad)", bg: "var(--panel)", frame: "var(--muted)" }
    : { text: "#1c2330", muted: "#5c677d", line: "#dde1e7", bad: "#c92a2a", bg: "#ffffff", frame: "#5c677d" };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const f1 = (n: number) => n.toFixed(1);

function ticks(lo: number, hi: number, n = 6): number[] {
  const span = hi - lo || 1;
  const raw = span / n;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw * 0.97) ?? raw;
  const dec = Math.max(0, -Math.floor(Math.log10(step)) + 1);
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toFixed(Math.min(dec, 10)));
  return out;
}

interface LegendItem {
  name: string;
  color: string;
  dash?: string;
  kind: "line" | "box";
}

/** Wrapping legend row(s). Returns the svg fragment and its height. */
function legendBlock(items: LegendItem[], x0: number, y0: number, maxX: number, t: Theme): { svg: string; height: number } {
  const p = palette(t);
  const rowH = 18;
  let x = x0;
  let row = 0;
  let out = "";
  for (const it of items) {
    const w = 30 + it.name.length * 6.4 + 16;
    if (x + w > maxX && x > x0) { x = x0; row++; }
    const y = y0 + row * rowH;
    out += it.kind === "line"
      ? `<line x1="${x}" x2="${x + 22}" y1="${y}" y2="${y}" style="stroke:${it.color};stroke-width:2.5" ${it.dash ? `stroke-dasharray="${it.dash}"` : ""}/>`
      : `<rect x="${x}" y="${y - 6}" width="22" height="12" style="fill:${it.color}" fill-opacity="0.9"/>`;
    out += `<text x="${x + 28}" y="${y + 4}" style="${FONT};font-size:12px;fill:${p.text}">${esc(it.name)}</text>`;
    x += w;
  }
  return { svg: out, height: (row + 1) * rowH + 6 };
}

const W = 760;
const M = { l: 70, r: 18, t: 14, b: 46 };

function frame(width: number, height: number, inner: string, t: Theme): string {
  const p = palette(t);
  const bg = t === "light" ? `<rect width="${width}" height="${height}" fill="#ffffff"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="${FONT};color:${p.text}">${bg}${inner}</svg>`;
}

function titleBlock(title: string | undefined, width: number, t: Theme): { svg: string; h: number } {
  if (!title) return { svg: "", h: 0 };
  return { svg: `<text x="${width / 2}" y="22" text-anchor="middle" style="${FONT};font-size:15px;font-weight:700;fill:${palette(t).text}">${esc(title)}</text>`, h: 34 };
}

interface AxesIn { d: View; xLabel: string; yLabel: string; chartH: number; top: number }

function axes(o: AxesIn, t: Theme) {
  const p = palette(t);
  const plotH = o.chartH - M.b - o.top;
  const plotW = W - M.l - M.r;
  const sx = (v: number) => M.l + ((v - o.d.x0) / (o.d.x1 - o.d.x0)) * plotW;
  const sy = (v: number) => o.chartH - M.b - ((v - o.d.y0) / (o.d.y1 - o.d.y0)) * plotH;
  let s = "";
  for (const v of ticks(o.d.y0, o.d.y1)) {
    s += `<line x1="${M.l}" x2="${W - M.r}" y1="${f1(sy(v))}" y2="${f1(sy(v))}" style="stroke:${p.line}"/>`;
    s += `<text x="${M.l - 8}" y="${f1(sy(v) + 4)}" text-anchor="end" style="${FONT};font-size:11px;fill:${p.muted}">${v}</text>`;
  }
  for (const v of ticks(o.d.x0, o.d.x1)) {
    s += `<text x="${f1(sx(v))}" y="${o.chartH - M.b + 18}" text-anchor="middle" style="${FONT};font-size:11px;fill:${p.muted}">${v}</text>`;
  }
  s += `<line x1="${M.l}" x2="${W - M.r}" y1="${o.chartH - M.b}" y2="${o.chartH - M.b}" style="stroke:${p.frame}"/>`;
  s += `<line x1="${M.l}" x2="${M.l}" y1="${o.top}" y2="${o.chartH - M.b}" style="stroke:${p.frame}"/>`;
  s += `<text x="${(M.l + W - M.r) / 2}" y="${o.chartH - 8}" text-anchor="middle" style="${FONT};font-size:12px;fill:${p.muted}">${esc(o.xLabel)}</text>`;
  s += `<text transform="translate(15 ${(o.top + o.chartH - M.b) / 2}) rotate(-90)" text-anchor="middle" style="${FONT};font-size:12px;fill:${p.muted}">${esc(o.yLabel)}</text>`;
  return { s, sx, sy, plot: { l: M.l, t: o.top, w: plotW, h: plotH } };
}

function clipDef(id: string, r: { l: number; t: number; w: number; h: number }): string {
  return `<defs><clipPath id="${id}"><rect x="${r.l}" y="${r.t}" width="${r.w}" height="${r.h}"/></clipPath></defs>`;
}

export function lineChart(o: LineOpts, t: Theme, title?: string, view?: View): Rendered {
  const p = palette(t);
  const yMin = o.yMin ?? 0;
  const tb = titleBlock(title, W, t);
  const chartH = (o.height ?? 340) + tb.h;
  const top = M.t + tb.h;
  const xs = o.series.flatMap((s) => s.x);
  const ys = o.series.flatMap((s) => s.y).concat(o.hline ? [o.hline.y] : []);
  const domain: View = {
    x0: 0, x1: Math.max(...xs, 1e-9),
    y0: yMin, y1: yMin + (Math.max(...ys, yMin + 1e-9) - yMin) * 1.06,
  };
  const d = view ?? domain;
  const ax = axes({ d, xLabel: o.xLabel, yLabel: o.yLabel, chartH, top }, t);
  const id = `clip${++uid}`;
  let s = tb.svg + clipDef(id, ax.plot) + ax.s + `<g clip-path="url(#${id})">`;
  if (o.hline) {
    s += `<line x1="${M.l}" x2="${W - M.r}" y1="${f1(ax.sy(o.hline.y))}" y2="${f1(ax.sy(o.hline.y))}" style="stroke:${p.bad};stroke-width:1.5" stroke-dasharray="6 4"/>`;
  }
  if (o.markerX !== undefined) {
    s += `<line x1="${f1(ax.sx(o.markerX))}" x2="${f1(ax.sx(o.markerX))}" y1="${top}" y2="${chartH - M.b}" style="stroke:${p.muted}" stroke-dasharray="2 3"/>`;
  }
  for (const se of o.series) {
    const pts = se.x.map((x, i) => `${f1(ax.sx(x))},${f1(ax.sy(se.y[i]))}`).join(" ");
    s += `<polyline fill="none" style="stroke:${se.color};stroke-width:2" ${se.dash ? `stroke-dasharray="${se.dash}"` : ""} points="${pts}"/>`;
  }
  s += "</g>";
  if (o.hline) {
    const ly = ax.sy(o.hline.y) - 5;
    if (ly > top && ly < chartH - M.b) s += `<text x="${W - M.r - 4}" y="${f1(ly)}" text-anchor="end" style="${FONT};font-size:11px;fill:${p.bad}">${esc(o.hline.label)}</text>`;
  }
  const items: LegendItem[] = o.series.map((se) => ({ name: se.name, color: se.color, dash: se.dash, kind: "line" }));
  if (o.hline) items.push({ name: o.hline.label, color: p.bad, dash: "6 4", kind: "line" });
  if (o.markerX !== undefined) items.push({ name: o.markerLabel ?? "Evaluation time", color: p.muted, dash: "2 3", kind: "line" });
  const lg = legendBlock(items, M.l, chartH + 6, W - M.r, t);
  const height = chartH + 6 + lg.height;
  return { svg: frame(W, height, s + lg.svg, t), width: W, height, plot: ax.plot, domain, view: d };
}

export function stackedChart(o: StackOpts, t: Theme, title?: string, view?: View): Rendered {
  const tb = titleBlock(title, W, t);
  const chartH = (o.height ?? 320) + tb.h;
  const top = M.t + tb.h;
  const x = o.layers[0]?.x ?? [];
  const n = x.length;
  const cum: number[][] = [new Array(n).fill(0)];
  o.layers.forEach((l, i) => cum.push(cum[i].map((v, k) => v + Math.max(l.y[k], 0))));
  const domain: View = { x0: 0, x1: Math.max(...x, 1e-9), y0: 0, y1: Math.max(...cum[o.layers.length], 1e-9) * 1.06 };
  const d = view ?? domain;
  const ax = axes({ d, xLabel: o.xLabel, yLabel: o.yLabel, chartH, top }, t);
  const id = `clip${++uid}`;
  let s = tb.svg + clipDef(id, ax.plot) + ax.s + `<g clip-path="url(#${id})">`;
  o.layers.forEach((l, i) => {
    const up = x.map((xv, k) => `${f1(ax.sx(xv))},${f1(ax.sy(cum[i + 1][k]))}`);
    const down = x.map((xv, k) => `${f1(ax.sx(xv))},${f1(ax.sy(cum[i][k]))}`).reverse();
    s += `<polygon points="${[...up, ...down].join(" ")}" style="fill:${l.color};stroke:${palette(t).bg}" fill-opacity="0.88" stroke-width="0.8"/>`;
  });
  s += "</g>";
  const lg = legendBlock(o.layers.map((l) => ({ name: l.name, color: l.color, kind: "box" as const })), M.l, chartH + 6, W - M.r, t);
  const height = chartH + 6 + lg.height;
  return { svg: frame(W, height, s + lg.svg, t), width: W, height, plot: ax.plot, domain, view: d };
}

// ---- map -----------------------------------------------------------------

type Stops = [number, number, number][];
const STOPS_HEAT: Stops = [[255, 247, 220], [253, 200, 110], [240, 120, 60], [190, 50, 70], [90, 20, 100], [30, 10, 60]];
// MATLAB-style "jet" scale for CO2 saturation: dark blue (0) - blue - cyan - green - yellow - red - dark red (max)
const STOPS_SAT: Stops = Array.from({ length: 41 }, (_, i) => {
  const v = i / 40;
  const c = (x: number) => Math.round(255 * Math.min(1, Math.max(0, x)));
  return [c(1.5 - Math.abs(4 * v - 3)), c(1.5 - Math.abs(4 * v - 2)), c(1.5 - Math.abs(4 * v - 1))] as [number, number, number];
});

function ramp(v: number, stops: Stops): [number, number, number] {
  const p = Math.min(Math.max(v, 0), 1) * (stops.length - 1);
  const i = Math.min(Math.floor(p), stops.length - 2);
  const f = p - i;
  return [0, 1, 2].map((k) => stops[i][k] + f * (stops[i + 1][k] - stops[i][k])) as [number, number, number];
}

const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const fromHex = (a: string[]): Stops => a.map(hex);

/** Colour scales offered for the maps (control points, interpolated linearly). */
export const COLORMAPS: Record<string, Stops> = {
  sunset: STOPS_HEAT,
  jet: STOPS_SAT,
  turbo: fromHex(["#30123b", "#4662d7", "#36aaf9", "#1ae4b6", "#72fe5e", "#c7ef34", "#faba39", "#f66b19", "#ca2a04", "#7a0403"]),
  viridis: fromHex(["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"]),
  plasma: fromHex(["#0d0887", "#46039f", "#7201a8", "#9c179e", "#bd3786", "#d8576b", "#ed7953", "#fb9f3a", "#fdca26", "#f0f921"]),
  blues: fromHex(["#f7fbff", "#deebf7", "#c6dbef", "#9ecae1", "#6baed6", "#4292c6", "#2171b5", "#08519c", "#08306b"]),
  coolwarm: fromHex(["#3b4cc0", "#6788ee", "#9abbff", "#c9d7f0", "#edd1c2", "#f7a789", "#e36a53", "#b40426"]),
  greys: fromHex(["#ffffff", "#f0f0f0", "#d9d9d9", "#bdbdbd", "#969696", "#737373", "#525252", "#252525", "#000000"]),
};

export const COLORMAP_LABELS: [string, string][] = [
  ["sunset", "Sunset (default)"],
  ["jet", "Jet (rainbow)"],
  ["turbo", "Turbo"],
  ["viridis", "Viridis"],
  ["plasma", "Plasma"],
  ["blues", "Blues"],
  ["coolwarm", "Cool–warm (diverging)"],
  ["greys", "Greyscale"],
];

export interface MapStyle {
  cmap?: string; // key of COLORMAPS
  reverse?: boolean;
  fill?: "smooth" | "bands" | "none";
  bands?: number; // target number of colour classes when fill = "bands"
  contours?: boolean;
  nContours?: number; // target number of contour levels
  contourLabels?: boolean;
  contourSource?: "wells" | "total"; // contours of each well's own pressure change (default) or of the total field
  contourReach?: number; // contours only within this fraction of the map half-width around each well (>= 1: whole map)
  streamlines?: boolean;
}

const imgCache = new WeakMap<GridResult, Map<string, string>>();

/** Heat-map image; `bounds` (ascending, same units as the grid values) turn it into discrete colour classes. */
function heatmapDataUrl(g: GridResult, stops: Stops, key: string, bounds?: number[]): string {
  let m = imgCache.get(g);
  if (!m) { m = new Map(); imgCache.set(g, m); }
  const hit = m.get(key);
  if (hit) return hit;
  const cv = document.createElement("canvas");
  cv.width = g.nx;
  cv.height = g.ny;
  const ctx = cv.getContext("2d")!;
  const img = ctx.createImageData(g.nx, g.ny);
  for (let j = 0; j < g.ny; j++) {
    for (let i = 0; i < g.nx; i++) {
      const v = g.values[j * g.nx + i];
      const o = ((g.ny - 1 - j) * g.nx + i) * 4;
      if (Number.isNaN(v)) { img.data.set([200, 200, 200, 90], o); continue; }
      let u = g.max > 0 ? v / g.max : 0;
      if (bounds && bounds.length > 1) {
        let k = 0;
        while (k < bounds.length - 2 && v >= bounds[k + 1]) k++;
        u = (k + 0.5) / (bounds.length - 1);
      }
      const [r, gg, b] = ramp(u, stops);
      img.data.set([r, gg, b, 255], o);
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL("image/png");
  m.set(key, url);
  return url;
}

/** 0, nice steps ..., top: class boundaries for banded fills. */
function niceBounds(top: number, n: number): number[] {
  const ts = ticks(0, top, n);
  const out = ts.filter((v) => v < top * 0.9999);
  if (out[0] !== 0) out.unshift(0);
  const step = ts.length > 1 ? ts[1] - ts[0] : top;
  if (out.length > 1 && top - out[out.length - 1] < 0.25 * step) out.pop(); // last class absorbs a sliver at the top
  out.push(top);
  return out;
}

export function mapChart(o: MapOpts, t: Theme, title?: string, view?: View): Rendered {
  const p = palette(t);
  const S = 560;
  const L = 66;
  const legendW = 270;
  const width = L + S + 24 + legendW;
  const tb = titleBlock(title, width, t);
  const T = 12 + tb.h;
  const height = T + S + 52;
  const { grid: g } = o;
  const domain: View = { x0: g.x0, x1: g.x1, y0: g.y0, y1: g.y1 };
  const d = view ?? domain;
  const px = (x: number) => L + ((x - d.x0) / (d.x1 - d.x0)) * S;
  const py = (y: number) => T + S - ((y - d.y0) / (d.y1 - d.y0)) * S;
  const gx = (i: number) => px(g.x0 + ((i + 0.5) / g.nx) * (g.x1 - g.x0));
  const gy = (j: number) => py(g.y0 + ((j + 0.5) / g.ny) * (g.y1 - g.y0));
  const fmtD = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
  const plot = { l: L, t: T, w: S, h: S };

  const st = o.style ?? {};
  const cmapName = st.cmap && COLORMAPS[st.cmap] ? st.cmap : o.palette === "sat" ? "jet" : "sunset";
  const stops = st.reverse ? [...COLORMAPS[cmapName]].reverse() : COLORMAPS[cmapName];
  const fill = st.fill ?? "smooth";
  const top = g.max / o.pf; // top of the scale in display units
  const bounds = fill === "bands" ? niceBounds(top, st.bands ?? 10).map((v) => v * o.pf) : undefined;
  const png = fill === "none" ? "" : heatmapDataUrl(g, stops, `${cmapName}|${st.reverse ? 1 : 0}|${fill}|${bounds ? bounds.join(",") : ""}`, bounds);
  const id = `clip${++uid}`;
  let s = tb.svg + clipDef(id, plot) + `<g clip-path="url(#${id})">`;
  const ix = px(g.x0), iy = py(g.y1);
  if (fill === "none") s += `<rect x="${f1(ix)}" y="${f1(iy)}" width="${f1(px(g.x1) - ix)}" height="${f1(py(g.y0) - iy)}" style="fill:#ffffff"/>`;
  else s += `<image x="${f1(ix)}" y="${f1(iy)}" width="${f1(px(g.x1) - ix)}" height="${f1(py(g.y0) - iy)}" preserveAspectRatio="none" href="${png}" xlink:href="${png}"/>`;

  const rgbAt = (u: number) => {
    const [r, gg, bb] = ramp(u, stops);
    return `rgb(${Math.round(r)},${Math.round(gg)},${Math.round(bb)})`;
  };
  // contour lines. "Each well": the pressure change caused by that well alone, drawn around that well, so the
  // rings show how the pressure of every well propagates. "Total field": iso-lines of the summed field.
  // Lines stay within reach of the well(s) and use common round levels spanning the pressures found there.
  let contourStep = 0;
  let contourLevels: number[] = [];
  let contourNear = false;
  let contourPerWell = false;
  if (st.contours) {
    const perWell = (st.contourSource ?? "wells") === "wells" && !!o.wellGrids && o.wellGrids.length === o.wells.length && o.wells.length > 0;
    contourPerWell = perWell;
    const sources: { grid: GridResult; centres: { x: number; y: number }[]; wi: number }[] = perWell
      ? (o.wellGrids as GridResult[]).map((wg, wi) => ({ grid: wg, centres: [o.wells[wi]], wi }))
      : [{ grid: g, centres: o.wells, wi: -1 }];
    const reach = st.contourReach ?? 0.35;
    const whole = reach >= 1 || o.wells.length === 0;
    contourNear = !whole;
    const reachM = reach * 0.5 * (g.x1 - g.x0);
    const nearM = (cs: { x: number; y: number }[], x: number, y: number) => whole || cs.some((w) => Math.hypot(x - w.x, y - w.y) <= reachM);
    let vmin = Infinity, vmax = -Infinity;
    for (const src of sources) {
      const gg = src.grid;
      for (let j = 0; j < gg.ny; j++) {
        for (let i = 0; i < gg.nx; i++) {
          const v = gg.values[j * gg.nx + i];
          if (Number.isNaN(v)) continue;
          if (nearM(src.centres, gg.x0 + ((i + 0.5) / gg.nx) * (gg.x1 - gg.x0), gg.y0 + ((j + 0.5) / gg.ny) * (gg.y1 - gg.y0))) {
            if (v < vmin) vmin = v;
            if (v > vmax) vmax = v;
          }
        }
      }
    }
    if (vmax > vmin) {
      contourLevels = ticks(vmin / o.pf, vmax / o.pf, st.nContours ?? 10).filter((v) => v > vmin / o.pf && v < vmax / o.pf);
      contourStep = contourLevels.length > 1 ? contourLevels[1] - contourLevels[0] : contourLevels[0] ?? 0;
    }
    const dec = Math.max(0, Math.ceil(-Math.log10(contourStep || 1) - 1e-9));
    const rpx = (reachM / (d.x1 - d.x0)) * S;
    for (const src of sources) {
      const gg = src.grid;
      const cid = `cc${id}_${src.wi}`;
      if (!whole) s += `<defs><clipPath id="${cid}">${src.centres.map((w) => `<circle cx="${f1(px(w.x))}" cy="${f1(py(w.y))}" r="${f1(rpx)}"/>`).join("")}</clipPath></defs>`;
      s += whole ? "<g>" : `<g clip-path="url(#${cid})">`;
      const ggx = (i: number) => px(gg.x0 + ((i + 0.5) / gg.nx) * (gg.x1 - gg.x0));
      const ggy = (j: number) => py(gg.y0 + ((j + 0.5) / gg.ny) * (gg.y1 - gg.y0));
      contourLevels.forEach((v, li) => {
        const segs = isoSegments(gg.values, gg.nx, gg.ny, v * o.pf);
        if (!segs.length) return;
        const lines = segs.map((q) => `<line x1="${f1(ggx(q[0]))}" y1="${f1(ggy(q[1]))}" x2="${f1(ggx(q[2]))}" y2="${f1(ggy(q[3]))}"/>`).join("");
        // no fill: a classic contour plot with every line coloured by its value; otherwise dark lines over the fill
        s += fill === "none"
          ? `<g style="stroke:${rgbAt(g.max > 0 ? (v * o.pf) / g.max : 0)};stroke-width:2.2;stroke-linecap:round">${lines}</g>`
          : `<g style="stroke:#fff;stroke-width:2.6;stroke-opacity:0.55">${lines}</g><g style="stroke:#161616;stroke-width:1;stroke-opacity:0.9">${lines}</g>`;
        if (st.contourLabels) {
          // each well gets its labels at its own angles (shifting with the level) so labels of different wells do not collide
          const c0 = src.centres[0];
          const cxp = px(c0.x), cyp = py(c0.y);
          const target = perWell ? src.wi * 2.4 + 0.5 + li * 0.45 : 0;
          let best: Segment | null = null;
          let bestScore = Infinity;
          for (const q of segs) {
            const mx = (ggx(q[0]) + ggx(q[2])) / 2, my = (ggy(q[1]) + ggy(q[3])) / 2;
            const inside = whole || src.centres.some((w) => Math.hypot(mx - px(w.x), my - py(w.y)) <= rpx * 0.92);
            if (!(inside && mx > L + 26 && mx < L + S - 26 && my > T + 10 && my < T + S - 10)) continue;
            const score = perWell ? Math.abs(Math.atan2(Math.sin(Math.atan2(my - cyp, mx - cxp) - target), Math.cos(Math.atan2(my - cyp, mx - cxp) - target))) : -mx;
            if (score < bestScore) { bestScore = score; best = q; }
          }
          if (best) {
            const mx = (ggx(best[0]) + ggx(best[2])) / 2, my = (ggy(best[1]) + ggy(best[3])) / 2;
            s += `<text x="${f1(mx)}" y="${f1(my + 3.5)}" text-anchor="middle" style="${FONT};font-size:10px;font-weight:700;fill:#111;stroke:#fff;stroke-width:3;paint-order:stroke">${v.toFixed(dec)}</text>`;
          }
        }
      });
      s += "</g>";
    }
  }

  // streamlines of the flow (down the pressure gradient, away from the injectors) with direction arrows
  if (st.streamlines) {
    // seed rings around the pressure maxima (the injecting wells; a shut-in well that no longer peaks gets none)
    const seeds: GridPoint[] = [];
    for (const pk of findPeaks(g.values, g.nx, g.ny)) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * 2 * Math.PI + 0.1;
        seeds.push({ i: pk.i + 2.5 * Math.cos(a), j: pk.j + 2.5 * Math.sin(a) });
      }
    }
    for (const path of streamPaths(g.values, g.nx, g.ny, seeds)) {
      if (path.length < 6) continue;
      const pts = path.map((q) => [gx(q.i), gy(q.j)]);
      const dd = "M" + pts.map((q) => `${f1(q[0])},${f1(q[1])}`).join(" L");
      s += `<path d="${dd}" fill="none" style="stroke:#fff;stroke-width:2.6;stroke-opacity:0.5"/><path d="${dd}" fill="none" style="stroke:#161616;stroke-width:1;stroke-opacity:0.85"/>`;
      const k = Math.floor(path.length * 0.45);
      const [x1, y1] = pts[k], [x2, y2] = pts[Math.min(k + 2, pts.length - 1)];
      const ang = Math.atan2(y2 - y1, x2 - x1), sz = 5;
      const tri = [[x1 + Math.cos(ang) * sz, y1 + Math.sin(ang) * sz], [x1 + Math.cos(ang + 2.5) * sz, y1 + Math.sin(ang + 2.5) * sz], [x1 + Math.cos(ang - 2.5) * sz, y1 + Math.sin(ang - 2.5) * sz]];
      s += `<polygon points="${tri.map((q) => `${f1(q[0])},${f1(q[1])}`).join(" ")}" style="fill:#161616;stroke:#fff;stroke-width:0.8"/>`;
    }
  }

  for (const c of o.contourLevels) {
    const segs = isoSegments(g.values, g.nx, g.ny, c.level);
    const lines = segs.map((q) => `<line x1="${f1(gx(q[0]))}" y1="${f1(gy(q[1]))}" x2="${f1(gx(q[2]))}" y2="${f1(gy(q[3]))}"/>`).join("");
    if (c.cls === "thr") {
      s += o.palette === "sat"
        ? `<g style="stroke:#000;stroke-width:4.5">${lines}</g><g style="stroke:#fff;stroke-width:2" stroke-dasharray="5 3">${lines}</g>`
        : `<g style="stroke:#0b7285;stroke-width:2" stroke-dasharray="5 3">${lines}</g>`;
    }
    else s += `<g style="stroke:#000;stroke-width:4.5">${lines}</g><g style="stroke:#fff;stroke-width:2">${lines}</g>`;
  }
  const b = o.boundary;
  if (b.type !== "none") {
    const bx1 = b.axis === "x" ? px(b.positionM) : L;
    const bx2 = b.axis === "x" ? px(b.positionM) : L + S;
    const by1 = b.axis === "y" ? py(b.positionM) : T;
    const by2 = b.axis === "y" ? py(b.positionM) : T + S;
    s += `<line x1="${f1(bx1)}" y1="${f1(by1)}" x2="${f1(bx2)}" y2="${f1(by2)}" style="stroke:${b.type === "noflow" ? "#111" : "#1c7ed6"};stroke-width:4" ${b.type === "constant" ? 'stroke-dasharray="10 6"' : ""}/>`;
  }
  const label = (x: number, y: number, text: string) =>
    `<text x="${f1(x + 9)}" y="${f1(y + 4)}" style="${FONT};font-size:11px;fill:#111;stroke:#fff;stroke-width:3;paint-order:stroke">${esc(text)}</text>`;
  for (const q of o.points) {
    s += `<rect x="${f1(px(q.x) - 5)}" y="${f1(py(q.y) - 5)}" width="10" height="10" style="fill:#1c7ed6;stroke:#fff;stroke-width:1.5"/>${label(px(q.x), py(q.y), q.name)}`;
  }
  // Wells on every map: a thin vertical line starting at the well and pointing up, with the name centred on top of it.
  {
    const lineH = 40;
    for (const w of o.wells) {
      const cx = px(w.x), cy = py(w.y);
      s += `<line x1="${f1(cx)}" x2="${f1(cx)}" y1="${f1(cy)}" y2="${f1(cy - lineH)}" style="stroke:#fff;stroke-width:4.5;stroke-linecap:butt"/>`;
      s += `<line x1="${f1(cx)}" x2="${f1(cx)}" y1="${f1(cy)}" y2="${f1(cy - lineH)}" style="stroke:#000;stroke-width:2.2;stroke-linecap:butt"/>`;
      s += `<text x="${f1(cx)}" y="${f1(cy - lineH - 6)}" text-anchor="middle" style="${FONT};font-size:12px;font-weight:700;fill:#fff;stroke:#000;stroke-width:3;paint-order:stroke">${esc(w.name)}</text>`;
    }
  }
  s += "</g>";
  s += `<rect x="${L}" y="${T}" width="${S}" height="${S}" fill="none" style="stroke:${p.frame}"/>`;
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const xv = d.x0 + f * (d.x1 - d.x0), yv = d.y0 + f * (d.y1 - d.y0);
    const xl = o.geo ? unproject(xv, (d.y0 + d.y1) / 2, o.geo.lat0, o.geo.lon0).lon.toFixed(3) : fmtD(xv / o.df);
    const yl = o.geo ? unproject((d.x0 + d.x1) / 2, yv, o.geo.lat0, o.geo.lon0).lat.toFixed(3) : fmtD(yv / o.df);
    s += `<text x="${f1(L + f * S)}" y="${T + S + 16}" text-anchor="middle" style="${FONT};font-size:11px;fill:${p.muted}">${xl}</text>`;
    s += `<text x="${L - 6}" y="${f1(T + S - f * S + 4)}" text-anchor="end" style="${FONT};font-size:11px;fill:${p.muted}">${yl}</text>`;
  }
  s += `<text x="${L + S / 2}" y="${T + S + 36}" text-anchor="middle" style="${FONT};font-size:12px;fill:${p.muted}">${o.geo ? "Longitude (°)" : `x (${esc(o.dLabel)})`}</text>`;
  s += `<text transform="translate(14 ${T + S / 2}) rotate(-90)" text-anchor="middle" style="${FONT};font-size:12px;fill:${p.muted}">${o.geo ? "Latitude (°)" : `y (${esc(o.dLabel)})`}</text>`;

  // legend panel
  const lx = L + S + 28;
  let ly = T + 4;
  s += `<text x="${lx}" y="${ly + 10}" style="${FONT};font-size:12px;font-weight:700;fill:${p.text}">${esc(o.legendTitle ?? "Pressure buildup")}${o.pLabel ? ` (${esc(o.pLabel)})` : ""}</text>`;
  ly += 18;
  const cbH = 300;
  if (fill !== "none" || contourLevels.length > 0) {
    s += `<defs><linearGradient id="cb${id}" x1="0" y1="1" x2="0" y2="0">${stops.map((c, i) => `<stop offset="${(i / (stops.length - 1)) * 100}%" stop-color="rgb(${c.map(Math.round).join(",")})"/>`).join("")}</linearGradient></defs>`;
    let barTicks: number[];
    if (bounds) {
      // discrete classes
      const n = bounds.length - 1;
      for (let k = 0; k < n; k++) {
        const y0 = ly + cbH * (1 - bounds[k + 1] / g.max), y1 = ly + cbH * (1 - bounds[k] / g.max);
        const [r, gg, bb] = ramp((k + 0.5) / n, stops);
        s += `<rect x="${lx}" y="${f1(y0)}" width="16" height="${f1(y1 - y0 + 0.5)}" style="fill:rgb(${Math.round(r)},${Math.round(gg)},${Math.round(bb)})"/>`;
      }
      s += `<rect x="${lx}" y="${ly}" width="16" height="${cbH}" fill="none" style="stroke:${p.frame}"/>`;
      barTicks = bounds.map((v) => v / o.pf);
    } else {
      s += `<rect x="${lx}" y="${ly}" width="16" height="${cbH}" fill="url(#cb${id})" style="stroke:${p.frame}"/>`;
      barTicks = ticks(0, top, 10).filter((v) => v <= top * 1.0001);
    }
    const withContours = contourLevels.length > 0;
    if (withContours) barTicks = [0, ...contourLevels, top]; // the legend follows the contour levels
    const stepV = withContours ? contourStep || 1 : barTicks.length > 1 ? Math.min(...barTicks.slice(1).map((v, i) => v - barTicks[i]).filter((x) => x > 0)) : 1;
    const tickDec = Math.max(withContours ? 0 : o.tickDec ?? o.pDec, Math.ceil(-Math.log10(stepV) - 1e-9), 0);
    const levelY = contourLevels.map((v) => ly + cbH * (1 - v / top));
    for (const v of barTicks) {
      const yy = ly + cbH * (1 - v / top);
      const isLevel = withContours && contourLevels.includes(v);
      if (withContours && !isLevel && levelY.some((ty) => Math.abs(ty - yy) < 13)) continue; // end labels yield to nearby contour labels
      if (isLevel) s += `<line x1="${lx}" x2="${lx + 16}" y1="${f1(yy)}" y2="${f1(yy)}" style="stroke:#161616;stroke-width:1"/>`;
      s += `<line x1="${lx + 16}" x2="${lx + 21}" y1="${f1(yy)}" y2="${f1(yy)}" style="stroke:${p.frame}"/>`;
      s += `<text x="${lx + 25}" y="${f1(yy + 4)}" style="${FONT};font-size:13px;${isLevel ? "font-weight:700;" : ""}fill:${isLevel || !withContours ? p.text : p.muted}">${v.toFixed(isLevel || !withContours ? tickDec : Math.max(tickDec, 2))}</text>`;
    }
    const lastY = ly + cbH * (1 - barTicks[barTicks.length - 1] / top);
    if (!withContours && lastY - ly > 14) s += `<text x="${lx + 25}" y="${ly + 4}" style="${FONT};font-size:11px;font-weight:700;fill:${p.text}">max ${top.toFixed(Math.max(tickDec, 2))}</text>`;
    ly += cbH + 28;
  } else {
    ly += 6;
  }
  const row = (icon: string, text: string) => {
    const lines = text.split("\n");
    const out = `${icon}${lines.map((ln, k) => `<text x="${lx + 30}" y="${ly + 4 + k * 14}" style="${FONT};font-size:11px;fill:${p.text}">${esc(ln)}</text>`).join("")}`;
    ly += 12 + lines.length * 12;
    return out;
  };
  if (o.points.length) s += row(`<rect x="${lx + 4}" y="${ly - 5}" width="10" height="10" style="fill:#1c7ed6;stroke:#888;stroke-width:1"/>`, "Monitoring point");
  if (st.contours && contourStep > 0) {
    s += row(`<line x1="${lx}" x2="${lx + 22}" y1="${ly}" y2="${ly}" style="stroke:${fill === "none" ? rgbAt(0.75) : "#161616"};stroke-width:${fill === "none" ? 2.2 : 1}"/>`, `Contour lines${contourPerWell ? " of each well" : ""}${contourNear ? " (near the wells)" : ""}\nevery ${+contourStep.toFixed(4)} ${o.pLabel}`.trim());
  }
  if (st.streamlines) {
    s += row(`<line x1="${lx}" x2="${lx + 22}" y1="${ly}" y2="${ly}" style="stroke:#161616;stroke-width:1"/><polygon points="${lx + 22},${ly} ${lx + 15},${ly - 3.5} ${lx + 15},${ly + 3.5}" style="fill:#161616"/>`, "Streamlines\n(flow direction)");
  }
  for (const c of o.contourLevels) {
    s += row(
      c.cls === "thr"
        ? (o.palette === "sat"
            ? `<line x1="${lx}" x2="${lx + 22}" y1="${ly}" y2="${ly}" style="stroke:#000;stroke-width:4.5"/><line x1="${lx}" x2="${lx + 22}" y1="${ly}" y2="${ly}" style="stroke:#fff;stroke-width:2" stroke-dasharray="5 3"/>`
            : `<line x1="${lx}" x2="${lx + 22}" y1="${ly}" y2="${ly}" style="stroke:#0b7285;stroke-width:2" stroke-dasharray="5 3"/>`)
        : `<line x1="${lx}" x2="${lx + 22}" y1="${ly}" y2="${ly}" style="stroke:#000;stroke-width:4.5"/><line x1="${lx}" x2="${lx + 22}" y1="${ly}" y2="${ly}" style="stroke:#fff;stroke-width:2"/>`,
      c.label,
    );
  }
  if (b.type !== "none") {
    s += row(`<line x1="${lx}" x2="${lx + 22}" y1="${ly}" y2="${ly}" style="stroke:${b.type === "noflow" ? "#111" : "#1c7ed6"};stroke-width:4" ${b.type === "constant" ? 'stroke-dasharray="6 4"' : ""}/>`, b.type === "noflow" ? "No-flow boundary" : "Constant-pressure boundary");
  }
  return { svg: frame(width, height, s, t), width, height, plot, domain, view: d };
}

export function render(spec: ChartSpec, t: Theme, title?: string, view?: View): Rendered {
  return spec.kind === "line" ? lineChart(spec.opts, t, title, view) : spec.kind === "stack" ? stackedChart(spec.opts, t, title, view) : mapChart(spec.opts, t, title, view);
}
