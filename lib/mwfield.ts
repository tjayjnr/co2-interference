// The pressure field of the multiwell program (lib/multiwell.ts) at any location and time, for the website's maps,
// curves, interference matrix and boundary comparison. Same interface as before (positions in metres, results in MPa).
//
// While the wells inject (t <= project endpoint) every value comes from the program's coupled solve at that time
// (`solve_multiwell_time`): each source's radial profile from `radial_pressure_from_state` (two-phase) or
// `_single_phase_source_profile` (single phase) at its distance, plus the skin at the well itself. After the endpoint all
// wells are shut in and each source follows the program's fixed-zone falloff (`_frozen_source_observation`) or the
// single-phase time superposition. A straight boundary adds image wells (website option; the program is infinite-acting).

import { PA_PER_PSI, type Row } from "./bhp.ts";
import {
  frozenAt, frozenSourceSolution, radialPressureFromState, singlePhaseSourceProfile, solveAt,
  type FrozenSource, type MultiwellResult, type Snapshot,
} from "./multiwell.ts";
import { sourcesFor, type Boundary, type GridResult, type Point, type Well } from "./physics.ts";

export const MPA_PER_PSI = PA_PER_PSI / 1e6;
const M_PER_FT = 0.3048;

export interface WellSummary {
  kind: "idle" | "inj" | "shut";
  /** BHP while injecting; BHP at shut-in afterwards (psia) */
  P: number;
  /** the program's state of this source (fronts, saturation, CO2 properties at its BHP) */
  s: Row | null;
}

export class MultiwellField {
  error: string | null = null;
  readonly wells: Well[];
  readonly boundary: Boundary;
  readonly horizon: number;
  readonly endpoint: number;
  private r: MultiwellResult | null;
  private idx = new Map<string, number>();
  private snaps = new Map<number, Snapshot>();
  private snapTimes: number[] = [];
  private frozen = new Map<number, FrozenSource | null>();
  private hits: number[];

  /** `result` is a run of the program for these wells (index i = wells[i]); null with `error` when it failed. */
  constructor(result: MultiwellResult | null, wells: Well[], boundary: Boundary, horizon: number, observationOffsets: number[] = [], error: string | null = null) {
    this.r = result;
    this.wells = wells;
    this.boundary = boundary;
    this.horizon = horizon;
    this.endpoint = result?.years ?? 0;
    this.error = error ?? (result ? null : "No result.");
    this.hits = observationOffsets;
    wells.forEach((w, i) => this.idx.set(w.id, i));
    for (const s of result?.snapshots ?? []) this.snaps.set(s.year, s);
    this.snapTimes = [...this.snaps.keys()].sort((a, b) => a - b);
  }

  /** The program's coupled solve at time t (cached; the nearest solved time gives the starting guess). */
  private snap(t: number): Snapshot | null {
    if (!this.r || this.error || t <= 0) return null;
    const hit = this.snaps.get(t);
    if (hit) return hit;
    let guess: number[] | undefined;
    const T = this.snapTimes;
    if (T.length) {
      let lo = 0, hi = T.length - 1;
      while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid] <= t) lo = mid; else hi = mid; }
      guess = (this.snaps.get(Math.abs(T[lo] - t) <= Math.abs(T[hi] - t) ? T[lo] : T[hi]) as Snapshot).bhp;
    }
    try {
      const s = solveAt(this.r, t, guess);
      this.snaps.set(t, s);
      if (this.snaps.size < 4000) { this.snapTimes.push(t); this.snapTimes.sort((a, b) => a - b); }
      return s;
    } catch (e) {
      this.error = `At ${t.toFixed(2)} yr: ${e instanceof Error ? e.message : String(e)}`;
      return null;
    }
  }

  /** Fixed-zone falloff of source k after the endpoint (solved once). */
  private frozenOf(k: number): FrozenSource | null {
    if (this.frozen.has(k)) return this.frozen.get(k) ?? null;
    const r = this.r as MultiwellResult;
    const state = r.end_snapshot.states[k];
    const period = this.horizon - this.endpoint;
    let f: FrozenSource | null = null;
    if (state && period > 0) {
      const radii = [...r.distances.map((row) => row[k]), ...(r.images?.[k] ?? []).flatMap((img) => img.d)];
      const hits = [...this.hits, period];
      for (let y = 1; y < period; y++) hits.push(y);
      f = frozenSourceSolution(state, r.source_parameters[k], radii, hits, 200);
    }
    this.frozen.set(k, f);
    return f;
  }

  /** Pressure excess (psi, no skin) of source k at distance rFt, time t. */
  private sourcePsi(k: number, rFt: number, t: number): number {
    const r = this.r as MultiwellResult;
    const p = r.parameters, params = r.source_parameters[k], well = r.wells[k];
    if (t <= 0) return 0;
    // a two-phase well stopped before the endpoint: the program's fixed-zone falloff from its end year
    const endYear = well.end_year;
    if (p.phase_mode === "two" && endYear !== null && endYear !== undefined && t > endYear) {
      const f = r.frozen[k];
      return f ? frozenAt(f, Math.max(rFt, params.rw_ft), t - endYear) : 0;
    }
    if (t <= this.endpoint) {
      const s = this.snap(t);
      if (!s) return NaN;
      if (p.phase_mode === "two") {
        const state = s.states[k];
        return state ? radialPressureFromState([Math.max(rFt, params.rw_ft)], state, params).pressure[0] : 0;
      }
      return singlePhaseSourceProfile(t, well, [Math.max(rFt, 1e-9)], params, r.references[k])[0][0];
    }
    const tau = t - this.endpoint;
    if (p.phase_mode === "two") {
      const state = r.end_snapshot.states[k];
      if (!state) return 0;
      const f = this.frozenOf(k);
      return f ? frozenAt(f, Math.max(rFt, params.rw_ft), tau) : 0;
    }
    return singlePhaseSourceProfile(t, well, [Math.max(rFt, 1e-9)], params, r.references[k], this.endpoint)[0][0];
  }

  private excess(k: number, x: number, y: number, t: number): number {
    if (this.error || !this.r) return NaN;
    const w = this.wells[k];
    const rw = this.r.wells[k].rw_ft;
    let sum = 0;
    for (const src of sourcesFor(w, this.boundary)) {
      const d = Math.hypot(x - src.x, y - src.y) / M_PER_FT;
      sum += src.sign * this.sourcePsi(k, src.real ? Math.max(d, rw) : d, t);
    }
    return sum;
  }

  private index(w: Well | Point): number {
    return this.idx.get(w.id) ?? -1;
  }

  // ---------------- public API (MPa) ----------------

  /** Pressure change (MPa) at (px, py) and time t caused by one well (no skin). */
  contribution(w: Well, px: number, py: number, t: number): number {
    const k = this.index(w);
    return k < 0 ? 0 : this.excess(k, px, py, t) * MPA_PER_PSI;
  }

  /** Pressure across the skin of a well while it injects (at the well only), MPa. */
  skin(w: Well, t: number): number {
    const k = this.index(w);
    if (k < 0 || t <= 0 || t > this.endpoint) return 0;
    const s = this.snap(t);
    return s ? s.skin[k] * MPA_PER_PSI : NaN;
  }

  /** Total pressure change (MPa) at a location from all wells, optionally skipping one. */
  total(px: number, py: number, t: number, skipId?: string): number {
    let s = 0;
    for (let k = 0; k < this.wells.length; k++) if (this.wells[k].id !== skipId) s += this.excess(k, px, py, t);
    return s * MPA_PER_PSI;
  }

  /** Pressure change (MPa) at a well's own wellbore: every well's contribution plus its own skin. */
  wellbore(w: Well, t: number): number {
    return this.total(w.x, w.y, t) + this.skin(w, t);
  }

  /** M[i][j] = pressure change (MPa) at well j caused by well i; the diagonal includes skin. */
  matrix(t: number): number[][] {
    return this.wells.map((wi, i) => this.wells.map((wj, j) => this.contribution(wi, wj.x, wj.y, t) + (i === j ? this.skin(wi, t) : 0)));
  }

  /** First time (years) a well's own influence at a location exceeds `threshold` MPa, or null. */
  arrival(src: Well, px: number, py: number, threshold: number, horizonYr: number, n = 120): number | null {
    const f = (t: number) => this.contribution(src, px, py, t);
    const t0 = Math.max(0, src.startYr);
    let prev = t0;
    for (let k = 1; k <= n; k++) {
      const t = t0 + ((horizonYr - t0) * k) / n;
      if (t <= t0) continue;
      if (f(t) >= threshold) {
        let lo = prev, hi = t;
        for (let i = 0; i < 18; i++) {
          const mid = 0.5 * (lo + hi);
          if (f(mid) >= threshold) hi = mid;
          else lo = mid;
        }
        return hi;
      }
      prev = t;
    }
    return null;
  }

  /** Grid of the pressure change (MPa) of one well, or of all wells (w = null). */
  grid(w: Well | null, t: number, ext: { x0: number; y0: number; x1: number; y1: number }, nx = 90, ny = 90): GridResult {
    const b = this.boundary;
    const values = new Float64Array(nx * ny);
    let max = 0;
    const ref = w ?? this.wells[0];
    if (!this.error) this.snap(t);
    for (let j = 0; j < ny; j++) {
      const y = ext.y0 + ((j + 0.5) / ny) * (ext.y1 - ext.y0);
      for (let i = 0; i < nx; i++) {
        const x = ext.x0 + ((i + 0.5) / nx) * (ext.x1 - ext.x0);
        let v = w ? this.contribution(w, x, y, t) : this.total(x, y, t);
        if (b.type !== "none" && ref) {
          const coord = b.axis === "x" ? x : y;
          const wc = b.axis === "x" ? ref.x : ref.y;
          if ((coord - b.positionM) * (wc - b.positionM) < 0) v = NaN; // other side of the boundary
        }
        values[j * nx + i] = v;
        if (v > max) max = v;
      }
    }
    return { nx, ny, ...ext, values, max };
  }

  /** The program's state of one source at time t (fronts, saturation, CO2 properties at its BHP). */
  summary(w: Well, t: number): WellSummary {
    const k = this.index(w);
    if (k < 0 || this.error || !this.r) return { kind: "idle", P: NaN, s: null };
    const endYear = this.r.wells[k].end_year;
    if (endYear !== null && endYear !== undefined && t > endYear) {
      const st = this.r.frozenStates[k] ?? this.snap(endYear)?.states[k] ?? null;
      return st ? { kind: "shut", P: this.snap(endYear)?.bhp[k] ?? NaN, s: st } : { kind: "idle", P: NaN, s: null };
    }
    if (t > this.endpoint) {
      const state = this.r.end_snapshot.states[k];
      return state ? { kind: "shut", P: this.r.end_snapshot.bhp[k], s: state } : { kind: "idle", P: NaN, s: null };
    }
    const s = this.snap(t);
    if (!s || !s.states[k]) return { kind: "idle", P: s ? s.bhp[k] : NaN, s: null };
    return { kind: "inj", P: s.bhp[k], s: s.states[k] };
  }

  /** Reservoir volume (m3) of the fluid injected by a well up to time t. */
  reservoirVolumeM3(w: Well, t: number): number {
    const s = this.summary(w, t).s;
    return s && Number.isFinite(s.Vr_ft3) ? s.Vr_ft3 * M_PER_FT ** 3 : 0;
  }
}
