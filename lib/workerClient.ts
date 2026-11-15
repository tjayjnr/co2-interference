// Sends calculations to the background worker (lib/run.worker.ts) and returns a promise of the result, so the page stays
// responsive while they run. If a worker cannot be started (or fails), the task runs on the page instead, after a
// short pause so the "Running…" indicator is painted first.

import { executeTask, type Task } from "./runJob.ts";

type Settle = (r: { ok: true; value: unknown } | { ok: false; error: string }) => void;
let worker: Worker | null | undefined;
let seq = 0;
const pending = new Map<number, { task: Task; settle: Settle }>();

function runHere(task: Task, settle: Settle) {
  window.setTimeout(() => settle(executeTask(task)), 30);
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const w = new Worker(new URL("./run.worker.ts", import.meta.url), { type: "module" });
    w.onmessage = (e: MessageEvent<{ id: number; result: Parameters<Settle>[0] }>) => {
      const job = pending.get(e.data.id);
      if (!job) return;
      pending.delete(e.data.id);
      job.settle(e.data.result);
    };
    w.onerror = (e) => {
      e.preventDefault();
      w.terminate();
      worker = null; // from now on calculate on the page
      const waiting = [...pending.values()];
      pending.clear();
      for (const job of waiting) runHere(job.task, job.settle);
    };
    worker = w;
  } catch {
    worker = null;
  }
  return worker;
}

export function runTask<T>(task: Task): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const settle: Settle = (r) => (r.ok ? resolve(r.value as T) : reject(new Error(r.error)));
    const w = typeof window !== "undefined" ? getWorker() : null;
    if (!w) { runHere(task, settle); return; }
    const id = ++seq;
    pending.set(id, { task, settle });
    try {
      w.postMessage({ id, task });
    } catch (e) {
      pending.delete(id);
      settle({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  });
}
