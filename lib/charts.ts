// Chart generators that return self-contained SVG strings (legends included), so the same
// drawing can be shown on screen (theme "css") and exported as SVG/PNG/report figures (theme "light").

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
}

export type ChartSpec =
  | { kind: "line"; opts: LineOpts }
  | { kind: "stack"; opts: StackOpts }
  | { kind: "map"; opts: MapOpts };

export interface Rendered {
  svg: string;
  width: number;
  height: number;
}

const FONT = "font-family:Arial,Helvetica,sans-serif";

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
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + 1e-9; v += step) out.push(+v.toPrecision(10));
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
    const w = 30 + it.name.length * 6.1 + 16;
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
const M = { l: 66, r: 18, t: 14, b: 46 };

function frame(width: number, height: number, inner: string, t: Theme): Rendered {
  const p = palette(t);
  const bg = t === "light" ? `<rect width="${width}" height="${height}" fill="#ffffff"/>` : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" style="${FONT};color:${p.text}">${bg}${inner}</svg>`;
  return { svg, width, height };
}

function axes(o: { x1: number; y0: number; y1: number; xLabel: string; yLabel: string; height: number; top: number }, t: Theme) {
  const p = palette(t);
  const plotH = o.height - M.b - o.top;
  const sx = (v: number) => M.l + (v / o.x1) * (W - M.l - M.r);
  const sy = (v: number) => o.height - M.b - ((v - o.y0) / (o.y1 - o.y0)) * plotH;
  let s = "";
  for (const v of ticks(o.y0, o.y1)) {
    s += `<line x1="${M.l}" x2="${W - M.r}" y1="${f1(sy(v))}" y2="${f1(sy(v))}" style="stroke:${p.line}"/>`;
    s += `<text x="${M.l - 8}" y="${f1(sy(v) + 4)}" text-anchor="end" style="${FONT};font-size:11px;fill:${p.muted}">${v}</text>`;
  }
  for (const v of ticks(0, o.x1)) {
    s += `<text x="${f1(sx(v))}" y="${o.height - M.b + 18}" text-anchor="middle" style="${FONT};font-size:11px;fill:${p.muted}">${v}</text>`;
  }
  s += `<line x1="${M.l}" x2="${W - M.r}" y1="${o.height - M.b}" y2="${o.height - M.b}" style="stroke:${p.frame}"/>`;
  s += `<line x1="${M.l}" x2="${M.l}" y1="${o.top}" y2="${o.height - M.b}" style="stroke:${p.frame}"/>`;
  s += `<text x="${(M.l + W - M.r) / 2}" y="${o.height - 8}" text-anchor="middle" style="${FONT};font-size:12px;fill:${p.muted}">${esc(o.xLabel)}</text>`;
  s += `<text transform="translate(15 ${(o.top + o.height - M.b) / 2}) rotate(-90)" text-anchor="middle" style="${FONT};font-size:12px;fill:${p.muted}">${esc(o.yLabel)}</text>`;
  return { s, sx, sy };
}

function titleBlock(title: string | undefined, width: number, t: Theme): { svg: string; h: number } {
  if (!title) return { svg: "", h: 0 };
  return { svg: `<text x="${width / 2}" y="22" text-anchor="middle" style="${FONT};font-size:14px;font-weight:700;fill:${palette(t).text}">${esc(title)}</text>`, h: 34 };
}

export function lineChart(o: LineOpts, t: Theme, title?: string): Rendered {
  const p = palette(t);
  const yMin = o.yMin ?? 0;
  const plotH = o.height ?? 340;
  const tb = titleBlock(title, W, t);
  const top = M.t + tb.h;
  const xs = o.series.flatMap((s) => s.x);
  const ys = o.series.flatMap((s) => s.y).concat(o.hline ? [o.hline.y] : []);
  const x1 = Math.max(...xs, 1e-9);
  const y1 = yMin + (Math.max(...ys, yMin + 1e-9) - yMin) * 1.06;
  const ax = axes({ x1, y0: yMin, y1, xLabel: o.xLabel, yLabel: o.yLabel, height: plotH + tb.h, top }, t);
  let s = tb.svg + ax.s;
  if (o.hline) {
    s += `<line x1="${M.l}" x2="${W - M.r}" y1="${f1(ax.sy(o.hline.y))}" y2="${f1(ax.sy(o.hline.y))}" style="stroke:${p.bad};stroke-width:1.5" stroke-dasharray="6 4"/>`;
    s += `<text x="${W - M.r - 4}" y="${f1(ax.sy(o.hline.y) - 5)}" text-anchor="end" style="${FONT};font-size:11px;fill:${p.bad}">${esc(o.hline.label)}</text>`;
  }
  if (o.markerX !== undefined && o.markerX <= x1) {
    s += `<line x1="${f1(ax.sx(o.markerX))}" x2="${f1(ax.sx(o.markerX))}" y1="${top}" y2="${plotH + tb.h - M.b}" style="stroke:${p.muted}" stroke-dasharray="2 3"/>`;
  }
  for (const se of o.series) {
    const pts = se.x.map((x, i) => `${f1(ax.sx(x))},${f1(ax.sy(se.y[i]))}`).join(" ");
    s += `<polyline fill="none" style="stroke:${se.color};stroke-width:2" ${se.dash ? `stroke-dasharray="${se.dash}"` : ""} points="${pts}"/>`;
  }
  const items: LegendItem[] = o.series.map((se) => ({ name: se.name, color: se.color, dash: se.dash, kind: "line" }));
  if (o.hline) items.push({ name: o.hline.label, color: p.bad, dash: "6 4", kind: "line" });
  if (o.markerX !== undefined) items.push({ name: o.markerLabel ?? "Evaluation time", color: p.muted, dash: "2 3", kind: "line" });
  const lg = legendBlock(items, M.l, plotH + tb.h + 6, W - M.r, t);
  return frame(W, plotH + tb.h + 6 + lg.height, s + lg.svg, t);
}

export function stackedChart(o: StackOpts, t: Theme, title?: string): Rendered {
  const plotH = o.height ?? 320;
  const tb = titleBlock(title, W, t);
  const top = M.t + tb.h;
  const x = o.layers[0]?.x ?? [];
  const n = x.length;
  const cum: number[][] = [new Array(n).fill(0)];
  o.layers.forEach((l, i) => cum.push(cum[i].map((v, k) => v + Math.max(l.y[k], 0))));
  const x1 = Math.max(...x, 1e-9);
  const y1 = Math.max(...cum[o.layers.length], 1e-9) * 1.06;
  const ax = axes({ x1, y0: 0, y1, xLabel: o.xLabel, yLabel: o.yLabel, height: plotH + tb.h, top }, t);
  let s = tb.svg + ax.s;
  o.layers.forEach((l, i) => {
    const up = x.map((xv, k) => `${f1(ax.sx(xv))},${f1(ax.sy(cum[i + 1][k]))}`);
    const down = x.map((xv, k) => `${f1(ax.sx(xv))},${f1(ax.sy(cum[i][k]))}`).reverse();
    s += `<polygon points="${[...up, ...down].join(" ")}" style="fill:${l.color};stroke:${palette(t).bg}" fill-opacity="0.88" stroke-width="0.8"/>`;
  });
  const lg = legendBlock(o.layers.map((l) => ({ name: l.name, color: l.color, kind: "box" as const })), M.l, plotH + tb.h + 6, W - M.r, t);
  return frame(W, plotH + tb.h + 6 + lg.height, s + lg.svg, t);
}

// ---- map -----------------------------------------------------------------

const STOPS: [number, number, number][] = [
  [255, 247, 220], [253, 200, 110], [240, 120, 60], [190, 50, 70], [90, 20, 100], [30, 10, 60],
];

function ramp(v: number): [number, number, number] {
  const p = Math.min(Math.max(v, 0), 1) * (STOPS.length - 1);
  const i = Math.min(Math.floor(p), STOPS.length - 2);
  const f = p - i;
  return [0, 1, 2].map((k) => STOPS[i][k] + f * (STOPS[i + 1][k] - STOPS[i][k])) as [number, number, number];
}

const heatCache = new WeakMap<GridResult, string>();

function heatmapDataUrl(g: GridResult): string {
  const hit = heatCache.get(g);
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
      const [r, gg, b] = ramp(g.max > 0 ? v / g.max : 0);
      img.data.set([r, gg, b, 255], o);
    }
  }
  ctx.putImageData(img, 0, 0);
  const url = cv.toDataURL("image/png");
  heatCache.set(g, url);
  return url;
}

export function mapChart(o: MapOpts, t: Theme, title?: string): Rendered {
  const p = palette(t);
  const S = 560;
  const L = 62;
  const legendW = 210;
  const width = L + S + 24 + legendW;
  const tb = titleBlock(title, width, t);
  const T = 12 + tb.h;
  const height = T + S + 52;
  const { grid: g } = o;
  const px = (x: number) => L + ((x - g.x0) / (g.x1 - g.x0)) * S;
  const py = (y: number) => T + S - ((y - g.y0) / (g.y1 - g.y0)) * S;
  const gx = (i: number) => L + ((i + 0.5) / g.nx) * S;
  const gy = (j: number) => T + S - ((j + 0.5) / g.ny) * S;
  const fmtD = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(1));
  let s = tb.svg;
  s += `<image x="${L}" y="${T}" width="${S}" height="${S}" preserveAspectRatio="none" href="${heatmapDataUrl(g)}" xlink:href="${heatmapDataUrl(g)}"/>`;
  s += `<rect x="${L}" y="${T}" width="${S}" height="${S}" fill="none" style="stroke:${p.frame}"/>`;
  for (const c of o.contourLevels) {
    const segs = isoSegments(g.values, g.nx, g.ny, c.level);
    if (c.cls === "thr") {
      s += `<g style="stroke:#0b7285;stroke-width:2" stroke-dasharray="5 3">${segs.map((q) => `<line x1="${f1(gx(q[0]))}" y1="${f1(gy(q[1]))}" x2="${f1(gx(q[2]))}" y2="${f1(gy(q[3]))}"/>`).join("")}</g>`;
    } else {
      const lines = segs.map((q) => `<line x1="${f1(gx(q[0]))}" y1="${f1(gy(q[1]))}" x2="${f1(gx(q[2]))}" y2="${f1(gy(q[3]))}"/>`).join("");
      s += `<g style="stroke:#000;stroke-width:4.5">${lines}</g><g style="stroke:#fff;stroke-width:2">${lines}</g>`;
    }
  }
  const b = o.boundary;
  if (b.type !== "none") {
    const bx1 = b.axis === "x" ? px(b.positionM) : L;
    const bx2 = b.axis === "x" ? px(b.positionM) : L + S;
    const by1 = b.axis === "y" ? py(b.positionM) : T;
    const by2 = b.axis === "y" ? py(b.positionM) : T + S;
    if (bx1 >= L - 1 && bx1 <= L + S + 1 && by1 >= T - 1 && by1 <= T + S + 1) {
      s += `<line x1="${f1(bx1)}" y1="${f1(by1)}" x2="${f1(bx2)}" y2="${f1(by2)}" style="stroke:${b.type === "noflow" ? "#111" : "#1c7ed6"};stroke-width:4" ${b.type === "constant" ? 'stroke-dasharray="10 6"' : ""}/>`;
    }
  }
  const label = (x: number, y: number, text: string) =>
    `<text x="${f1(x + 9)}" y="${f1(y + 4)}" style="${FONT};font-size:11px;fill:#111;stroke:#fff;stroke-width:3;paint-order:stroke">${esc(text)}</text>`;
  for (const q of o.points) {
    s += `<rect x="${f1(px(q.x) - 5)}" y="${f1(py(q.y) - 5)}" width="10" height="10" style="fill:#1c7ed6;stroke:#fff;stroke-width:1.5"/>${label(px(q.x), py(q.y), q.name)}`;
  }
  for (const w of o.wells) {
    s += `<circle cx="${f1(px(w.x))}" cy="${f1(py(w.y))}" r="6" style="fill:#fff;stroke:#111;stroke-width:2"/>${label(px(w.x), py(w.y), w.name)}`;
  }
  for (const f of [0, 0.25, 0.5, 0.75, 1]) {
    const xv = g.x0 + f * (g.x1 - g.x0), yv = g.y0 + f * (g.y1 - g.y0);
    const xl = o.geo ? unproject(xv, (g.y0 + g.y1) / 2, o.geo.lat0, o.geo.lon0).lon.toFixed(3) : fmtD(xv / o.df);
    const yl = o.geo ? unproject((g.x0 + g.x1) / 2, yv, o.geo.lat0, o.geo.lon0).lat.toFixed(3) : fmtD(yv / o.df);
    s += `<text x="${f1(L + f * S)}" y="${T + S + 16}" text-anchor="middle" style="${FONT};font-size:11px;fill:${p.muted}">${xl}</text>`;
    s += `<text x="${L - 6}" y="${f1(T + S - f * S + 4)}" text-anchor="end" style="${FONT};font-size:11px;fill:${p.muted}">${yl}</text>`;
  }
  s += `<text x="${L + S / 2}" y="${T + S + 36}" text-anchor="middle" style="${FONT};font-size:12px;fill:${p.muted}">${o.geo ? "Longitude (°)" : `x (${esc(o.dLabel)})`}</text>`;
  s += `<text transform="translate(14 ${T + S / 2}) rotate(-90)" text-anchor="middle" style="${FONT};font-size:12px;fill:${p.muted}">${o.geo ? "Latitude (°)" : `y (${esc(o.dLabel)})`}</text>`;

  // legend panel
  const lx = L + S + 28;
  let ly = T + 4;
  s += `<defs><linearGradient id="cb" x1="0" y1="1" x2="0" y2="0">${STOPS.map((c, i) => `<stop offset="${(i / (STOPS.length - 1)) * 100}%" stop-color="rgb(${c.map(Math.round).join(",")})"/>`).join("")}</linearGradient></defs>`;
  s += `<text x="${lx}" y="${ly + 10}" style="${FONT};font-size:12px;font-weight:700;fill:${p.text}">Pressure buildup</text>`;
  ly += 18;
  const cbH = 150;
  s += `<rect x="${lx}" y="${ly}" width="16" height="${cbH}" fill="url(#cb)" style="stroke:${p.frame}"/>`;
  s += `<text x="${lx + 24}" y="${ly + 10}" style="${FONT};font-size:11px;fill:${p.text}">${(g.max / o.pf).toFixed(o.pDec)} ${esc(o.pLabel)}</text>`;
  s += `<text x="${lx + 24}" y="${ly + cbH / 2 + 4}" style="${FONT};font-size:11px;fill:${p.muted}">${(g.max / o.pf / 2).toFixed(o.pDec)}</text>`;
  s += `<text x="${lx + 24}" y="${ly + cbH}" style="${FONT};font-size:11px;fill:${p.text}">0</text>`;
  ly += cbH + 28;
  const row = (icon: string, text: string) => {
    const out = `${icon}<text x="${lx + 30}" y="${ly + 4}" style="${FONT};font-size:11px;fill:${p.text}">${esc(text)}</text>`;
    ly += 22;
    return out;
  };
  s += row(`<circle cx="${lx + 9}" cy="${ly}" r="6" style="fill:#fff;stroke:#111;stroke-width:2"/>`, "Injection well");
  if (o.points.length) s += row(`<rect x="${lx + 4}" y="${ly - 5}" width="10" height="10" style="fill:#1c7ed6;stroke:#888;stroke-width:1"/>`, "Monitoring point");
  for (const c of o.contourLevels) {
    s += row(
      c.cls === "thr"
        ? `<line x1="${lx}" x2="${lx + 22}" y1="${ly}" y2="${ly}" style="stroke:#0b7285;stroke-width:2" stroke-dasharray="5 3"/>`
        : `<line x1="${lx}" x2="${lx + 22}" y1="${ly}" y2="${ly}" style="stroke:#000;stroke-width:4.5"/><line x1="${lx}" x2="${lx + 22}" y1="${ly}" y2="${ly}" style="stroke:#fff;stroke-width:2"/>`,
      c.label,
    );
  }
  if (b.type !== "none") {
    s += row(`<line x1="${lx}" x2="${lx + 22}" y1="${ly}" y2="${ly}" style="stroke:${b.type === "noflow" ? "#111" : "#1c7ed6"};stroke-width:4" ${b.type === "constant" ? 'stroke-dasharray="6 4"' : ""}/>`, b.type === "noflow" ? "No-flow boundary" : "Constant-pressure boundary");
  }
  return frame(width, height, s, t);
}

export function render(spec: ChartSpec, t: Theme, title?: string): Rendered {
  return spec.kind === "line" ? lineChart(spec.opts, t, title) : spec.kind === "stack" ? stackedChart(spec.opts, t, title) : mapChart(spec.opts, t, title);
}
