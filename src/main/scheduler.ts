/**
 * Background scheduler — polls cron-jobs.json and executes due tasks.
 * Runs in the Electron main process.
 */
import { BrowserWindow } from "electron";
import { runAgentQuery } from "../core/agent/query.ts";
import { SessionStore } from "../core/session-store.ts";
import { MagiPaths } from "../core/paths.ts";
import { ProviderAdapter } from "../core/providers/ir.ts";
import { takeDueCronJobs, cronStorePathFromRoot, CronRunResult } from "../core/tools/cron.ts";

const POLL_INTERVAL_MS = 30_000;

export interface SchedulerDeps {
  store: SessionStore;
  paths: MagiPaths;
  getAdapter: () => ProviderAdapter;
  getModel: () => string;
  win: BrowserWindow;
}

export function startScheduler(deps: SchedulerDeps): () => void {
  const { store, paths, getAdapter, getModel, win } = deps;
  const cronPath = cronStorePathFromRoot(paths.stateRoot);
  let running = false;

  const emit = (data: unknown) => {
    if (!win.isDestroyed()) {
      win.webContents.send("tasks:event", data);
    }
  };

  async function poll() {
    if (running) return;
    running = true;
    try {
      const due = takeDueCronJobs(cronPath);
      for (const item of due) {
        await executeTask(item);
      }
    } catch {
      // cron-jobs.json might not exist yet — that's fine
    } finally {
      running = false;
    }
  }

  async function executeTask(item: CronRunResult) {
    const taskId = store.createAgentTask({
      role: "worker",
      prompt: item.prompt,
      cwd: process.cwd(),
      metadata: { cronJobId: item.job.id, cronExpression: item.job.cron },
    });

    store.updateAgentTask({ id: taskId, status: "running" });
    emit({ type: "task_started", taskId, cronJobId: item.job.id });

    let resultText = "";
    try {
      const adapter = getAdapter();
      const model = getModel();
      const messages = [{ role: "user" as const, content: [{ type: "text" as const, text: item.prompt }] }];

      for await (const event of runAgentQuery({
        adapter,
        model,
        providerName: "anthropic",
        messages,
        cwd: process.cwd(),
        env: process.env,
        permissionMode: "auto",
      })) {
        if (event.type === "text_delta" && event.text) {
          resultText += event.text;
        }
      }

      store.updateAgentTask({ id: taskId, status: "completed", result: resultText });
      emit({ type: "task_completed", taskId, cronJobId: item.job.id, result: resultText.slice(0, 200) });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      store.updateAgentTask({
        id: taskId,
        status: "failed",
        result: errMsg,
        metadata: { cronJobId: item.job.id, error: errMsg },
      });
      emit({ type: "task_failed", taskId, cronJobId: item.job.id, error: errMsg });
    }
  }

  // Initial poll on startup (catch missed jobs)
  setTimeout(poll, 5000);
  const interval = setInterval(poll, POLL_INTERVAL_MS);

  return () => clearInterval(interval);
}
