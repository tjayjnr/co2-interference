// The multiwell program's two figures (`_plot_multiwell`, matplotlib) redrawn as SVG with the same content:
//   multiwell_bhp_and_interference.png: BHP of every well and the interference from the other wells vs project time
//     (solid while injecting, dashed after all wells stop);
//   multiwell_matrix_and_fronts.png: the final formation-pressure contribution matrix (rows = receiving wells,
//     columns = source wells, no skin) and each well's gas front (circle) and dry zone (filled) at the endpoint.

import type { Row } from "./bhp.ts";
import type { MultiwellObservation, MultiwellResult } from "./multiwell.ts";

const FONT = "DejaVu Sans, Verdana, Arial, sans-serif";
const TAB10 = ["#1f77b4", "#ff7f0e", "#2ca02c", "#d62728", "#9467bd", "#8c564b", "#e377c2", "#7f7f7f", "#bcbd22", "#17becf"];
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export interface Svg {
  svg: string;
  width: number;
  height: number;
}

function niceTicks(lo: number, hi: number, n = 6): number[] {
  const raw = (hi - lo) / n || 1;
  const scale = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((s) => s * scale).find((s) => s >= raw * (1 - 1e-12)) ?? 10 * scale;
  const out: number[] = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}
const fmt = (v: number, step: number) => v.toFixed(Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9))));

interface Axes { x: number; y: number; w: number; h: number }

/** One matplotlib-like line panel. */
function linePanel(ax: Axes, series: { name: string; color: string; dash?: boolean; x: number[]; y: number[] }[], o: { title: string; xlabel: string; ylabel: string; legend: string[] }): string {
  const xs = series.flatMap((s) => s.x), ys = series.flatMap((s) => s.y).filter(Number.isFinite);
  // project time starts at zero on the vertical (pressure) axis and ends at the last time, with no margin
  const x0 = Math.min(0, ...xs), x1 = Math.max(...xs);
  let y0 = Math.min(...ys), y1 = Math.max(...ys);
  const span = y1 - y0 || Math.max(Math.abs(y1) * 1e-3, 1);
  y0 -= 0.05 * span; y1 += 0.05 * span;
  const X = (v: number) => ax.x + ((v - x0) / (x1 - x0 || 1)) * ax.w;
  const Y = (v: number) => ax.y + ax.h - ((v - y0) / (y1 - y0)) * ax.h;
  const xt = niceTicks(x0, x1), yt = niceTicks(y0, y1);
  const xs1 = xt.length > 1 ? xt[1] - xt[0] : 1, ys1 = yt.length > 1 ? yt[1] - yt[0] : 1;
  let g = `<rect x="${ax.x}" y="${ax.y}" width="${ax.w}" height="${ax.h}" fill="#fff" stroke="#000" stroke-width="0.8"/>`;
  for (const t of xt) if (X(t) >= ax.x - 0.5 && X(t) <= ax.x + ax.w + 0.5) {
    g += `<line x1="${X(t)}" x2="${X(t)}" y1="${ax.y}" y2="${ax.y + ax.h}" stroke="#b0b0b0" stroke-opacity="0.25"/>`;
    g += `<line x1="${X(t)}" x2="${X(t)}" y1="${ax.y + ax.h}" y2="${ax.y + ax.h + 4}" stroke="#000"/><text x="${X(t)}" y="${ax.y + ax.h + 17}" text-anchor="middle" font-size="11">${fmt(t, xs1)}</text>`;
  }
  for (const t of yt) if (Y(t) >= ax.y - 0.5 && Y(t) <= ax.y + ax.h + 0.5) {
    g += `<line x1="${ax.x}" x2="${ax.x + ax.w}" y1="${Y(t)}" y2="${Y(t)}" stroke="#b0b0b0" stroke-opacity="0.25"/>`;
    g += `<line x1="${ax.x - 4}" x2="${ax.x}" y1="${Y(t)}" y2="${Y(t)}" stroke="#000"/><text x="${ax.x - 7}" y="${Y(t) + 4}" text-anchor="end" font-size="11">${fmt(t, ys1)}</text>`;
  }
  g += `<clipPath id="c${ax.x | 0}"><rect x="${ax.x}" y="${ax.y}" width="${ax.w}" height="${ax.h}"/></clipPath><g clip-path="url(#c${ax.x | 0})">`;
  for (const s of series) {
    const d = s.x.map((v, k) => `${k ? "L" : "M"}${X(v).toFixed(2)},${Y(s.y[k]).toFixed(2)}`).join("");
    g += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="1.5"${s.dash ? ' stroke-dasharray="5.5,2.4"' : ""}/>`;
  }
  g += "</g>";
  g += `<text x="${ax.x + ax.w / 2}" y="${ax.y - 9}" text-anchor="middle" font-size="13">${esc(o.title)}</text>`;
  g += `<text x="${ax.x + ax.w / 2}" y="${ax.y + ax.h + 36}" text-anchor="middle" font-size="12">${esc(o.xlabel)}</text>`;
  g += `<text transform="translate(${ax.x - 58},${ax.y + ax.h / 2}) rotate(-90)" text-anchor="middle" font-size="12">${esc(o.ylabel)}</text>`;
  // legend in the lower middle of the panel (the curves start at time zero on the left axis and rise to the top)
  const lw = Math.max(...o.legend.map((n) => n.length)) * 6.2 + 38, lh = o.legend.length * 16 + 8;
  const lx0 = ax.x + ax.w * 0.32, ly0 = ax.y + ax.h - lh - 10;
  g += `<rect x="${lx0}" y="${ly0}" width="${lw}" height="${lh}" fill="#fff" fill-opacity="0.85" stroke="#ccc" rx="3"/>`;
  o.legend.forEach((n, i) => {
    const yy = ly0 + 12 + i * 16;
    g += `<line x1="${lx0 + 6}" x2="${lx0 + 26}" y1="${yy}" y2="${yy}" stroke="${TAB10[i % 10]}" stroke-width="1.5"/><text x="${lx0 + 32}" y="${yy + 4}" font-size="10.5">${esc(n)}</text>`;
  });
  return g;
}

/** multiwell_bhp_and_interference.png */
export function renderMultiwellPressure(result: MultiwellResult, observation: MultiwellObservation | null): Svg {
  const W = 1300, H = 500;
  const wells = result.wells;
  const by = (rows: Row[], name: string) => rows.filter((r) => r.well === name);
  const make = (key: string) => wells.flatMap((w, i) => {
    const rows = by(result.detail, w.name);
    const out = [{ name: w.name, color: TAB10[i % 10], x: rows.map((r) => r.year as number), y: rows.map((r) => r[key] as number) }];
    if (observation) {
      const o = by(observation.detail, w.name);
      out.push({ name: w.name, color: TAB10[i % 10], dash: true, x: o.map((r) => r.year as number), y: o.map((r) => r[key] as number) } as typeof out[0]);
    }
    return out;
  });
  const names = wells.map((w) => w.name);
  const a1 = { x: 90, y: 40, w: 520, h: 390 }, a2 = { x: 740, y: 40, w: 520, h: 390 };
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}"><rect width="${W}" height="${H}" fill="#fff"/>` +
    linePanel(a1, make("BHP_psia"), { title: "Well pressure", xlabel: "Project time (years)", ylabel: "BHP (psia)", legend: names }) +
    linePanel(a2, make("interference_psi"), { title: "Neighboring-well contributions", xlabel: "Project time (years)", ylabel: "Interference from other wells (psi)", legend: names }) +
    (observation ? `<text x="${W / 2}" y="${H - 10}" text-anchor="middle" font-size="11" fill="#444">Dashed: after all wells stop at year ${result.years}.</text>` : "") +
    "</svg>";
  return { svg, width: W, height: H };
}

/** matplotlib YlOrRd */
function ylOrRd(t: number): string {
  const stops = ["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#bd0026", "#800026"];
  const x = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(x)), f = x - i;
  const c = (h: string) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
  const a = c(stops[i]), b = c(stops[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + f * (b[k] - v))).join(",")})`;
}

/** multiwell_matrix_and_fronts.png */
export function renderMultiwellMatrix(result: MultiwellResult): Svg {
  const W = 1300, H = 520;
  const wells = result.wells, n = wells.length;
  const M = result.end_snapshot.matrix;
  const vmin = Math.min(...M.flat()), vmax = Math.max(...M.flat());
  // left: heat map
  const side = Math.min(360, 360), cell = side / n;
  const hx = 150, hy = 50;
  let g = "";
  M.forEach((row, m) => row.forEach((v, i) => {
    g += `<rect x="${hx + i * cell}" y="${hy + m * cell}" width="${cell}" height="${cell}" fill="${ylOrRd((v - vmin) / (vmax - vmin || 1))}"/>`;
    if (n <= 8) g += `<text x="${hx + (i + 0.5) * cell}" y="${hy + (m + 0.5) * cell + 4}" text-anchor="middle" font-size="11" fill="${v > 0.65 * Math.max(vmax, 1e-12) ? "#fff" : "#000"}">${v.toFixed(2)}</text>`;
  }));
  g += `<rect x="${hx}" y="${hy}" width="${side}" height="${side}" fill="none" stroke="#000" stroke-width="0.8"/>`;
  wells.forEach((w, i) => {
    g += `<text transform="translate(${hx + (i + 0.5) * cell + 4},${hy + side + 10}) rotate(-45)" text-anchor="end" font-size="11">${esc(w.name)}</text>`;
    g += `<text x="${hx - 7}" y="${hy + (i + 0.5) * cell + 4}" text-anchor="end" font-size="11">${esc(w.name)}</text>`;
  });
  g += `<text x="${hx + side / 2}" y="${hy - 12}" text-anchor="middle" font-size="13">Final formation-pressure contributions</text>`;
  g += `<text x="${hx + side / 2}" y="${H - 18}" text-anchor="middle" font-size="12">Source well</text>`;
  g += `<text transform="translate(${hx - 95},${hy + side / 2}) rotate(-90)" text-anchor="middle" font-size="12">Receiving well</text>`;
  // colour bar
  const cbx = hx + side + 24, cbh = side * 0.8, cby = hy + (side - cbh) / 2;
  for (let k = 0; k < 60; k++) g += `<rect x="${cbx}" y="${cby + cbh - ((k + 1) * cbh) / 60}" width="14" height="${cbh / 60 + 0.5}" fill="${ylOrRd(k / 59)}"/>`;
  g += `<rect x="${cbx}" y="${cby}" width="14" height="${cbh}" fill="none" stroke="#000" stroke-width="0.6"/>`;
  const ct = niceTicks(vmin, vmax, 5).filter((v) => v >= vmin - 1e-9 && v <= vmax + 1e-9);
  const cs = ct.length > 1 ? ct[1] - ct[0] : 1;
  for (const v of ct) {
    const yy = cby + cbh - ((v - vmin) / (vmax - vmin || 1)) * cbh;
    g += `<line x1="${cbx + 14}" x2="${cbx + 18}" y1="${yy}" y2="${yy}" stroke="#000"/><text x="${cbx + 21}" y="${yy + 4}" font-size="10.5">${fmt(v, cs)}</text>`;
  }
  g += `<text transform="translate(${cbx + 72},${cby + cbh / 2}) rotate(-90)" text-anchor="middle" font-size="11.5">Pressure contribution (psi)</text>`;
  // right: front circles
  const states = result.end_snapshot.states;
  const lx: number[] = [], ly: number[] = [];
  wells.forEach((w, i) => {
    const radius = states[i]?.rg_ft ?? 0;
    const e = Math.max(radius, 20.0);
    lx.push(w.x_ft - e, w.x_ft + e);
    ly.push(w.y_ft - e, w.y_ft + e);
  });
  let X0 = Math.min(...lx) - 50, X1 = Math.max(...lx) + 50, Y0 = Math.min(...ly) - 50, Y1 = Math.max(...ly) + 50;
  const ax = { x: 760, y: 50, w: 480, h: 400 };
  const sc = Math.min(ax.w / (X1 - X0), ax.h / (Y1 - Y0)); // aspect equal
  const cx = (X0 + X1) / 2, cy = (Y0 + Y1) / 2;
  X0 = cx - ax.w / sc / 2; X1 = cx + ax.w / sc / 2; Y0 = cy - ax.h / sc / 2; Y1 = cy + ax.h / sc / 2;
  const PX = (v: number) => ax.x + (v - X0) * sc, PY = (v: number) => ax.y + ax.h - (v - Y0) * sc;
  g += `<rect x="${ax.x}" y="${ax.y}" width="${ax.w}" height="${ax.h}" fill="#fff" stroke="#000" stroke-width="0.8"/>`;
  const xt = niceTicks(X0, X1, 6), yt = niceTicks(Y0, Y1, 6);
  const xs = xt.length > 1 ? xt[1] - xt[0] : 1, ys = yt.length > 1 ? yt[1] - yt[0] : 1;
  for (const t of xt) if (PX(t) >= ax.x && PX(t) <= ax.x + ax.w) g += `<line x1="${PX(t)}" x2="${PX(t)}" y1="${ax.y}" y2="${ax.y + ax.h}" stroke="#b0b0b0" stroke-opacity="0.2"/><text x="${PX(t)}" y="${ax.y + ax.h + 17}" text-anchor="middle" font-size="11">${fmt(t, xs)}</text>`;
  for (const t of yt) if (PY(t) >= ax.y && PY(t) <= ax.y + ax.h) g += `<line x1="${ax.x}" x2="${ax.x + ax.w}" y1="${PY(t)}" y2="${PY(t)}" stroke="#b0b0b0" stroke-opacity="0.2"/><text x="${ax.x - 7}" y="${PY(t) + 4}" text-anchor="end" font-size="11">${fmt(t, ys)}</text>`;
  g += `<clipPath id="fr"><rect x="${ax.x}" y="${ax.y}" width="${ax.w}" height="${ax.h}"/></clipPath><g clip-path="url(#fr)">`;
  wells.forEach((w, i) => {
    const col = TAB10[i % 10];
    const s = states[i];
    const radius = s?.rg_ft ?? 0;
    if (radius) {
      g += `<circle cx="${PX(w.x_ft)}" cy="${PY(w.y_ft)}" r="${radius * sc}" fill="none" stroke="${col}" stroke-width="1.5"/>`;
      if ((s?.dry_zone_thickness_ft ?? 0) > 0) g += `<circle cx="${PX(w.x_ft)}" cy="${PY(w.y_ft)}" r="${(s as Row).rd_ft * sc}" fill="${col}" fill-opacity="0.25"/>`;
    }
    g += `<circle cx="${PX(w.x_ft)}" cy="${PY(w.y_ft)}" r="3.5" fill="${col}"/><text x="${PX(w.x_ft) + 5}" y="${PY(w.y_ft) - 5}" font-size="11">${esc(w.name)}</text>`;
  });
  g += "</g>";
  g += `<text x="${ax.x + ax.w / 2}" y="${ax.y - 12}" text-anchor="middle" font-size="13">Individual radial front estimates</text>`;
  g += `<text x="${ax.x + ax.w / 2}" y="${ax.y + ax.h + 38}" text-anchor="middle" font-size="12">x (ft)</text>`;
  g += `<text transform="translate(${ax.x - 62},${ax.y + ax.h / 2}) rotate(-90)" text-anchor="middle" font-size="12">y (ft)</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}"><rect width="${W}" height="${H}" fill="#fff"/>${g}</svg>`;
  return { svg, width: W, height: H };
}
