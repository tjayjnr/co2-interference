// Background worker: runs the calculations of lib/runJob.ts off the page's main thread, so the site never freezes.
import { executeTask, type Task } from "./runJob.ts";

self.onmessage = (e: MessageEvent<{ id: number; task: Task }>) => {
  const { id, task } = e.data;
  (self as unknown as Worker).postMessage({ id, result: executeTask(task) });
};
