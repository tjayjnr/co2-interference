// Chart generators that return self-contained SVG strings (title and legend included), so the same
// drawing can be shown on screen (theme "css") and exported as SVG/PNG/report figures (theme "light").
// Every generator accepts an optional zoom `view` (data coordinates); the plot is clipped to the plot area.

import { isoSegments } from "./contour";
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
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
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

const heatCache = new WeakMap<GridResult, string>();
const satCache = new WeakMap<GridResult, string>();

function heatmapDataUrl(g: GridResult, stops: Stops, cache: WeakMap<GridResult, string>): string {
  const hit = cache.get(g);
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
      const [r, gg, b] = ramp(g.max > 0 ? v / g.max : 0, stops);
      img.data.set([r, gg, b, 255], o);
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL("image/png");
  cache.set(g, url);
  return url;
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
  const stops = o.palette === "sat" ? STOPS_SAT : STOPS_HEAT;
  const png = heatmapDataUrl(g, stops, o.palette === "sat" ? satCache : heatCache);
  const id = `clip${++uid}`;
  let s = tb.svg + clipDef(id, plot) + `<g clip-path="url(#${id})">`;
  const ix = px(g.x0), iy = py(g.y1);
  s += `<image x="${f1(ix)}" y="${f1(iy)}" width="${f1(px(g.x1) - ix)}" height="${f1(py(g.y0) - iy)}" preserveAspectRatio="none" href="${png}" xlink:href="${png}"/>`;
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
  if (o.palette === "sat") {
    // Saturation map: each well is a thin vertical line starting at the plume centre and pointing up,
    // with its name centred on top of the line.
    const lineH = 40;
    for (const w of o.wells) {
      const cx = px(w.x), cy = py(w.y);
      s += `<line x1="${f1(cx)}" x2="${f1(cx)}" y1="${f1(cy)}" y2="${f1(cy - lineH)}" style="stroke:#fff;stroke-width:4.5;stroke-linecap:butt"/>`;
      s += `<line x1="${f1(cx)}" x2="${f1(cx)}" y1="${f1(cy)}" y2="${f1(cy - lineH)}" style="stroke:#000;stroke-width:2.2;stroke-linecap:butt"/>`;
      s += `<text x="${f1(cx)}" y="${f1(cy - lineH - 6)}" text-anchor="middle" style="${FONT};font-size:12px;font-weight:700;fill:#fff;stroke:#000;stroke-width:3;paint-order:stroke">${esc(w.name)}</text>`;
    }
  } else {
    for (const w of o.wells) {
      s += `<circle cx="${f1(px(w.x))}" cy="${f1(py(w.y))}" r="6" style="fill:#fff;stroke:#111;stroke-width:2"/>${label(px(w.x), py(w.y), w.name)}`;
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
  s += `<defs><linearGradient id="cb${id}" x1="0" y1="1" x2="0" y2="0">${stops.map((c, i) => `<stop offset="${(i / (stops.length - 1)) * 100}%" stop-color="rgb(${c.map(Math.round).join(",")})"/>`).join("")}</linearGradient></defs>`;
  s += `<text x="${lx}" y="${ly + 10}" style="${FONT};font-size:12px;font-weight:700;fill:${p.text}">${esc(o.legendTitle ?? "Pressure buildup")}${o.pLabel ? ` (${esc(o.pLabel)})` : ""}</text>`;
  ly += 18;
  const cbH = 300;
  const top = g.max / o.pf;
  s += `<rect x="${lx}" y="${ly}" width="16" height="${cbH}" fill="url(#cb${id})" style="stroke:${p.frame}"/>`;
  const cbTicks = ticks(0, top, 10).filter((v) => v <= top * 1.0001);
  const stepV = cbTicks.length > 1 ? cbTicks[1] - cbTicks[0] : 1;
  const tickDec = Math.max(o.tickDec ?? o.pDec, Math.ceil(-Math.log10(stepV) - 1e-9), 0);
  for (const v of cbTicks) {
    const yy = ly + cbH * (1 - v / top);
    s += `<line x1="${lx + 16}" x2="${lx + 21}" y1="${f1(yy)}" y2="${f1(yy)}" style="stroke:${p.frame}"/>`;
    s += `<text x="${lx + 25}" y="${f1(yy + 4)}" style="${FONT};font-size:13px;fill:${p.text}">${v.toFixed(tickDec)}</text>`;
  }
  const lastY = ly + cbH * (1 - cbTicks[cbTicks.length - 1] / top);
  if (lastY - ly > 14) s += `<text x="${lx + 25}" y="${ly + 4}" style="${FONT};font-size:11px;font-weight:700;fill:${p.text}">max ${top.toFixed(Math.max(tickDec, 2))}</text>`;
  ly += cbH + 28;
  const row = (icon: string, text: string) => {
    const lines = text.split("\n");
    const out = `${icon}${lines.map((ln, k) => `<text x="${lx + 30}" y="${ly + 4 + k * 14}" style="${FONT};font-size:11px;fill:${p.text}">${esc(ln)}</text>`).join("")}`;
    ly += 12 + lines.length * 12;
    return out;
  };
  if (o.palette !== "sat") s += row(`<circle cx="${lx + 9}" cy="${ly}" r="6" style="fill:#fff;stroke:#111;stroke-width:2"/>`, "Injection well");
  if (o.points.length) s += row(`<rect x="${lx + 4}" y="${ly - 5}" width="10" height="10" style="fill:#1c7ed6;stroke:#888;stroke-width:1"/>`, "Monitoring point");
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
