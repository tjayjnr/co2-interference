// The calculations behind RUN and the tabs that calculate on demand, as plain functions of plain data. They run in the
// background worker (lib/run.worker.ts) so the page never freezes; the page falls back to calling them directly when a
// worker cannot be started. Results are plain data (structured-cloneable).

import { calculateFirstYearDetail, calculateObservation, runModel, withPressureLimit, type Inputs, type LimitInput, type RunOutput } from "./bhp.ts";
import { multiwellCalculation, runMultiwell, type Images, type MultiwellForm, type MultiwellResult, type MultiwellRun, type MWell } from "./multiwell.ts";
import { MultiwellField } from "./mwfield.ts";
import { timeGrid, type Boundary, type Well } from "./physics.ts";

/** What the page's pressure field needs, so the worker can solve it in advance (MultiwellField.prime). */
export interface PrimeSpec { wells: Well[]; boundary: Boundary; horizon: number; offsets: number[] }

/** The single-well program (single-well section): annual results, first-year detail, observation, pressure check. */
export interface SingleJob { p: Inputs; years: number; label: string; limit: LimitInput | null }

export type RunJob =
  | { kind: "single"; program: SingleJob; well: MWell; images: Images | null; prime: PrimeSpec }
  | { kind: "multi"; form: MultiwellForm; boundaryNone: boolean; limit: LimitInput; images: Images | null; prime: PrimeSpec };

export interface RunResult { program: RunOutput | null; multi: MultiwellRun | null; fieldRun: MultiwellResult | null; error: string }

/** A multiwell run for the page's field (Well BHP "alone" curve, boundary comparison), solved in advance. */
export interface FieldJob { p: Inputs; wells: MWell[]; years: number; limit: unknown; images: Images | null; prime: PrimeSpec }

export type Task = { type: "run"; job: RunJob } | { type: "single"; job: SingleJob } | { type: "field"; job: FieldJob };

export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function runSingleProgram(j: SingleJob): RunOutput {
  const { results, constants } = runModel(j.p, j.years);
  const observation = calculateObservation(results[results.length - 1], j.p, true);
  const firstYear = calculateFirstYearDetail(results, j.p, constants);
  return withPressureLimit({ label: j.label, years: j.years, p: j.p, results, constants, observation, firstYear }, j.limit);
}

function prime(r: MultiwellResult, s: PrimeSpec): void {
  const f = new MultiwellField(r, s.wells, s.boundary, s.horizon, s.offsets);
  f.prime(timeGrid(s.horizon, s.wells));
}

export function executeRun(job: RunJob): RunResult {
  try {
    if (job.kind === "single") {
      const program = runSingleProgram(job.program);
      const fieldRun = runMultiwell(job.program.p, [job.well], job.program.years, "", { detail: false, pressureLimit: job.program.limit, images: job.images });
      prime(fieldRun, job.prime);
      return { program, multi: null, fieldRun, error: "" };
    }
    const mr = multiwellCalculation(job.form);
    const r = mr.result;
    const fieldRun = job.boundaryNone ? r : runMultiwell(r.parameters, r.wells, r.years, "", { detail: false, pressureLimit: job.limit, images: job.images });
    prime(fieldRun, job.prime);
    return { program: null, multi: mr, fieldRun, error: "" };
  } catch (e) {
    return { program: null, multi: null, fieldRun: null, error: errText(e) };
  }
}

export function executeField(job: FieldJob): MultiwellResult {
  const r = runMultiwell(job.p, job.wells, job.years, "", { detail: false, pressureLimit: job.limit as LimitInput, images: job.images });
  prime(r, job.prime);
  return r;
}

/** One task, as the worker runs it: { ok, value } or { ok: false, error }. */
export function executeTask(t: Task): { ok: true; value: unknown } | { ok: false; error: string } {
  try {
    if (t.type === "run") return { ok: true, value: executeRun(t.job) };
    if (t.type === "single") return { ok: true, value: runSingleProgram(t.job) };
    return { ok: true, value: executeField(t.job) };
  } catch (e) {
    return { ok: false, error: errText(e) };
  }
}
