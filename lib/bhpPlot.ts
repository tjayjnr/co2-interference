// The Python's figure bhp_vs_year.png (matplotlib, in save_results) redrawn as SVG with the same content:
// left panel = full injection period (and the post-shut-in curve), right panel = first year on a symlog time axis
// (linear from 0 to 1 second, logarithmic after), same colours, markers and labels. Each panel has its own pressure axis
// fitted to its curve (zoomed in), instead of the Python's shared axis with 100-psi steps from the initial pressure.

import { DAYS_PER_YEAR, isWaterMode, type Row, type RunOutput } from "./bhp.ts";

// Styled like the website's other charts (lib/charts.ts): serif font, muted axis text, horizontal grid lines only,
// left and bottom axis lines, legend rows under the panels. The figure is twice as wide as those charts and is shown
// at the same width, so text and lines are drawn K times larger to appear at the same size.
const W = 1280, H = 580;
const K = 1.6;
const RED = "#BC332B", TEAL = "#235F73", NAVY = "#19394D", BLUE = "#2C7DA0", GREY = "#868e96";
const TEXT = "#1c2330", MUTED = "#5c677d", GRID = "#dde1e7", FRAME = "#5c677d";
const FONT = "'Times New Roman', Times, serif";
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** matplotlib MaxNLocator(nbins, steps).tick_values(lo, hi) */
function maxNLocator(lo: number, hi: number, nbins: number, steps = [1, 2, 2.5, 5, 10], integer = false): number[] {
  const raw = (hi - lo) / nbins;
  const scale = 10 ** Math.floor(Math.log10(raw || 1));
  let step = steps.map((s) => s * scale).find((s) => s >= raw * (1 - 1e-12)) ?? 10 * scale;
  if (integer) step = Math.max(1, Math.ceil(step));
  const out: number[] = [];
  for (let v = Math.floor(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(+v.toPrecision(12));
  return out;
}

/** The Python's checkpoint rows: 0, 1 s, 1 min, 1 h, 1 d, 30 d and 1 yr (math.isclose on t_days). */
function checkpoints(first: Row[]): Row[] {
  const days = [0.0, 1 / 86400, 1 / 1440, 1 / 24, 1.0, 30.0, DAYS_PER_YEAR];
  return days.map((d) => first.find((r) => Math.abs(r.t_days - d) <= Math.max(1e-10 * Math.max(Math.abs(r.t_days), Math.abs(d)), 1e-14)) as Row);
}

export function renderBhpPlot(out: RunOutput): { svg: string; width: number; height: number } {
  const { p, results, observation: obs, firstYear } = out;
  const water = isWaterMode(p);
  const Pi = p.initial_pressure_psia;
  const history = [...firstYear, ...results.slice(1)];
  const cps = checkpoints(firstYear);

  // ---- x axis of the full-period panel
  const shutInYear = results[results.length - 1].year;
  let endYear = shutInYear;
  let xTicks: number[];
  if (water && endYear > 30) xTicks = maxNLocator(0, endYear, 10, [1, 2, 2.5, 5, 10], true).filter((t) => t <= endYear);
  else {
    const step = water && endYear <= 4 ? 1 : 2;
    xTicks = [];
    for (let t = 0; t < endYear + 1; t += step) xTicks.push(t);
  }
  if (obs) {
    endYear = obs.elapsed_years[obs.elapsed_years.length - 1];
    xTicks = [];
    for (let t = 0; t < endYear + 1e-10; t += 2) xTicks.push(t);
  }

  // ---- pressure axes, one per panel, fitted to what each panel is about (zoomed in):
  // left = the yearly values (and the shut-in curve), right = the first-year rise from the initial pressure.
  // Both always include the initial pressure Pi, which gets its own labelled tick.
  const leftVals = [Pi, ...results.map((r) => r.BHP_psia), ...(obs ? obs.bhp_psia : [])];
  const rightVals = [Pi, ...firstYear.map((r) => r.BHP_psia)];
  const axis = (vals: number[]) => {
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const span = hi - lo || Math.max(Math.abs(hi) * 1e-6, 1e-6);
    const lower = lo - 0.12 * span, upper = hi + 0.08 * span; // room under the Pi line for its label
    const nice = maxNLocator(lower, upper, 6).filter((v) => v >= lower && v <= upper);
    const step = nice.length > 1 ? nice[1] - nice[0] : span;
    const dec = Math.max(0, Math.min(6, -Math.floor(Math.log10(step) + 1e-9)));
    // the Pi tick replaces any regular tick too close to it to keep the labels readable
    const ticks = [...nice.filter((v) => Math.abs(v - Pi) > 0.45 * step), Pi].sort((a, b) => a - b);
    const piDec = Math.max(dec, Number.isInteger(Pi) ? 0 : Math.min(2, (String(Pi).split(".")[1] ?? "").length));
    return { lo: lower, hi: upper, ticks, label: (v: number) => (v === Pi ? v.toFixed(piDec) : v.toFixed(dec)) };
  };
  const yL = axis(leftVals), yR = axis(rightVals);
  const ya_label = yL.label;

  // ---- layout (two panels, width ratios 1.3 : 1, shared y)
  const top = 52, bottom = H - 150, left1 = 108;
  const gap = 104, right2 = W - 26;
  const total = right2 - left1 - gap;
  const w1 = (total * 1.3) / 2.3, w2 = total - w1;
  const left2 = left1 + w1 + gap;
  const yScale = (ax: { lo: number; hi: number }) => (v: number) => bottom - ((v - ax.lo) / (ax.hi - ax.lo)) * (bottom - top);
  const Y1 = yScale(yL), Y2 = yScale(yR);
  const X1 = (t: number) => left1 + (t / endYear) * w1;
  const linthresh = 1 / 86400, linscale = water ? 0.8 : 0.5;
  const sym = (d: number) => (d <= linthresh ? (linscale * d) / linthresh : linscale + Math.log10(d / linthresh));
  const X2 = (d: number) => left2 + (sym(d) / sym(DAYS_PER_YEAR)) * w2;

  const s: string[] = [];
  s.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="${FONT}">`);
  s.push(`<rect width="${W}" height="${H}" fill="#ffffff"/>`);
  s.push(`<defs><clipPath id="bhp-c1"><rect x="${left1}" y="${top}" width="${w1}" height="${bottom - top}"/></clipPath><clipPath id="bhp-c2"><rect x="${left2}" y="${top}" width="${w2}" height="${bottom - top}"/></clipPath></defs>`);

  const panel = (x0: number, w: number, X: (v: number) => number, xt: [number, string][], ptitle: string, xlabel: string, Y: (v: number) => number, ya: { ticks: number[]; label: (v: number) => string }) => {
    for (const v of ya.ticks) s.push(`<line x1="${x0}" y1="${Y(v).toFixed(1)}" x2="${x0 + w}" y2="${Y(v).toFixed(1)}" stroke="${GRID}" stroke-width="${K}"/>`);
    s.push(`<line x1="${x0}" y1="${bottom}" x2="${x0 + w}" y2="${bottom}" stroke="${FRAME}" stroke-width="${K}"/>`);
    s.push(`<line x1="${x0}" y1="${top}" x2="${x0}" y2="${bottom}" stroke="${FRAME}" stroke-width="${K}"/>`);
    for (const [v, lab] of xt) s.push(`<text x="${X(v).toFixed(1)}" y="${bottom + 29}" text-anchor="middle" font-size="${11 * K}" fill="${MUTED}">${esc(lab)}</text>`);
    for (const v of ya.ticks) s.push(`<text x="${x0 - 12}" y="${(Y(v) + 6).toFixed(1)}" text-anchor="end" font-size="${11 * K}" fill="${MUTED}">${esc(ya.label(v))}</text>`);
    s.push(`<text x="${x0 + w / 2}" y="${top - 18}" text-anchor="middle" font-size="${15 * K}" font-weight="700" fill="${TEXT}">${esc(ptitle)}</text>`);
    s.push(`<text x="${x0 + w / 2}" y="${bottom + 64}" text-anchor="middle" font-size="${12 * K}" fill="${MUTED}">${esc(xlabel)}</text>`);
  };
  const poly = (pts: [number, number][], color: string, clip: string) =>
    s.push(`<polyline clip-path="url(#${clip})" fill="none" stroke="${color}" stroke-width="${2 * K}" stroke-linejoin="round" stroke-linecap="round" points="${pts.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(" ")}"/>`);
  const dot = (x: number, y: number, r: number, color: string, clip = "") => s.push(`<circle ${clip ? `clip-path="url(#${clip})" ` : ""}cx="${x.toFixed(2)}" cy="${y.toFixed(2)}" r="${r * K}" fill="${color}"/>`);
  const square = (x: number, y: number, a: number, color: string, clip = "") => s.push(`<rect ${clip ? `clip-path="url(#${clip})" ` : ""}x="${(x - (a * K) / 2).toFixed(2)}" y="${(y - (a * K) / 2).toFixed(2)}" width="${a * K}" height="${a * K}" fill="${color}"/>`);

  // initial pressure Pi: dashed reference line across the panel, labelled under its right end
  const piLine = (x0: number, w: number, y: number) => {
    s.push(`<line x1="${x0}" y1="${y.toFixed(1)}" x2="${x0 + w}" y2="${y.toFixed(1)}" stroke="${NAVY}" stroke-width="${1.2 * K}" stroke-dasharray="${8 * K} ${5 * K}" stroke-opacity="0.75"/>`);
    s.push(`<text x="${x0 + w - 8}" y="${(y + 22).toFixed(1)}" text-anchor="end" font-size="${11 * K}" fill="${NAVY}">Pi = ${esc(ya_label(Pi))} psia</text>`);
  };
  // ---- left panel
  panel(left1, w1, X1, xTicks.map((t) => [t, String(t)]), obs ? "Injection and post-shut-in observation" : "Full injection period",
    obs ? "Elapsed time from injection start (years)" : "Elapsed injection time (years)", Y1, yL);
  s.push(`<text transform="translate(${left1 - 82},${(top + bottom) / 2}) rotate(-90)" text-anchor="middle" font-size="${12 * K}" fill="${MUTED}">BHP (psia)</text>`);
  poly(history.map((r) => [X1(r.year), Y1(r.BHP_psia)]), RED, "bhp-c1");
  for (const r of results) dot(X1(r.year), Y1(r.BHP_psia), 1.7, RED, "bhp-c1");
  if (obs) {
    poly(obs.elapsed_years.map((t, i) => [X1(t), Y1(obs.bhp_psia[i])]), TEAL, "bhp-c1");
    for (const r of obs.rows) square(X1(r.elapsed_year), Y1(r.BHP_psia), 4.5, TEAL, "bhp-c1");
    s.push(`<line x1="${X1(shutInYear)}" y1="${top}" x2="${X1(shutInYear)}" y2="${bottom}" stroke="${GREY}" stroke-width="${1.2 * K}" stroke-dasharray="${5 * K} ${4 * K}"/>`);
  }
  piLine(left1, w1, Y1(Pi));
  dot(X1(0), Y1(Pi), 2.9, NAVY, "bhp-c1");
  // first-year checkpoints only on the expanded first-year panel (on the year axis they pile up at t = 0)

  // ---- right panel (first year, symlog)
  const dayTicks: [number, string][] = [[0, "0"], [1 / 86400, "1 s"], [1 / 1440, "1 min"], [1 / 24, "1 h"], [1, "1 d"], [30, "30 d"], [DAYS_PER_YEAR, "1 yr"]];
  panel(left2, w2, X2, dayTicks, "First year: expanded time scale", "Elapsed injection time", Y2, yR);
  piLine(left2, w2, Y2(Pi));
  poly(firstYear.map((r) => [X2(r.t_days), Y2(r.BHP_psia)]), RED, "bhp-c2");
  dot(X2(0), Y2(Pi), 2.9, NAVY);
  for (const r of cps.slice(1)) dot(X2(r.t_days), Y2(r.BHP_psia), 2.75, BLUE);

  // ---- legend under the panels (lines first, then markers, as matplotlib orders them), wrapping into rows
  type Entry = [string, (x: number, y: number) => void];
  const seg = (color: string, width: number, dash = "", opacity = 1) => (x: number, y: number) =>
    s.push(`<line x1="${x}" y1="${y}" x2="${x + 22 * K}" y2="${y}" stroke="${color}" stroke-width="${width * K}"${dash ? ` stroke-dasharray="${dash}"` : ""}${opacity < 1 ? ` stroke-opacity="${opacity}"` : ""}/>`);
  const entries: Entry[] = [["Calculated BHP", seg(RED, 2.5)]];
  if (obs) {
    entries.push(["Shut-in pressure", seg(TEAL, 2.5)]);
    entries.push(["Shut-in", seg(GREY, 1.2, `${5 * K} ${4 * K}`)]);
    entries.push(["Selected observation years", (x, y) => square(x + 11 * K, y, 5.5, TEAL)]);
  }
  entries.push(["Initial pressure Pi", (x, y) => { seg(NAVY, 1.2, `${8 * K} ${5 * K}`, 0.75)(x, y); dot(x + 11 * K, y, 2.9, NAVY); }]);
  entries.push(["First-year checkpoints", (x, y) => dot(x + 11 * K, y, 2.75, BLUE)]);
  const itemW = (lab: string) => 28 * K + lab.length * 5.4 * K + 20 * K;
  const rows: Entry[][] = [[]];
  let used = 0;
  for (const e of entries) {
    if (used + itemW(e[0]) > W - 60 && rows[rows.length - 1].length) { rows.push([]); used = 0; }
    rows[rows.length - 1].push(e);
    used += itemW(e[0]);
  }
  rows.forEach((row, r) => {
    let lx = (W - row.reduce((a, e) => a + itemW(e[0]), 0)) / 2;
    const ly = bottom + 102 + r * 30;
    for (const [lab, draw] of row) {
      draw(lx, ly);
      s.push(`<text x="${lx + 28 * K}" y="${ly + 6}" font-size="${12 * K}" fill="${TEXT}">${esc(lab)}</text>`);
      lx += itemW(lab);
    }
  });

  s.push("</svg>");
  return { svg: s.join(""), width: W, height: H };
}
