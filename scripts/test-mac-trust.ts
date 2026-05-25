import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { runShellCommand } from "../src/core/tools/shell.ts";

const root = process.cwd();

function read(relativePath: string): string {
  return readFileSync(path.join(root, relativePath), "utf8");
}

async function assertBashAbort(): Promise<void> {
  const controller = new AbortController();
  setTimeout(() => controller.abort("trust-smoke-stop"), 300);
  const started = Date.now();
  await assert.rejects(
    runShellCommand({
      cwd: root,
      command: "sleep 5",
      signal: controller.signal,
      skipAutoBackground: true
    }),
    (error: unknown) => {
      const elapsed = Date.now() - started;
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /Command aborted: sleep 5/);
      assert.ok(elapsed < 2500, `expected abort under 2500ms, got ${elapsed}ms`);
      return true;
    }
  );
}

async function main(): Promise<void> {
  const app = read("src/renderer/App.tsx");
  assert.match(app, /interface TrustStatus/);
  assert.match(app, /function TrustStatusBar/);
  assert.match(app, /Quick Setup/);
  assert.match(app, /Mac Permissions/);
  assert.match(app, /Set up Kira/);
  assert.match(app, /Screen Recording/);
  assert.match(app, /Accessibility/);
  assert.match(app, /cancelCurrentQuery/);
  assert.match(app, /window\.desktopAPI\.cancelQuery/);
  assert.match(app, /event\.key !== "Escape"/);
  assert.match(app, /className="btn-stop"/);
  assert.match(app, /Esc/);
  assert.match(app, /Stops/);

  const ipc = read("src/main/ipc.ts");
  assert.match(ipc, /app:trust-status/);
  assert.match(ipc, /systemPreferences\.getMediaAccessStatus\("screen"\)/);
  assert.match(ipc, /systemPreferences\.isTrustedAccessibilityClient\(false\)/);
  assert.match(ipc, /app:open-permission-settings/);
  assert.match(ipc, /Privacy_ScreenCapture/);
  assert.match(ipc, /Privacy_Accessibility/);

  const preload = read("src/preload/index.ts");
  assert.match(preload, /getTrustStatus/);
  assert.match(preload, /openPermissionSettings/);

  const prompt = read("src/core/agent/system-prompt.ts");
  assert.match(prompt, /You are Kira/);
  assert.match(prompt, /Visible Context First/);
  assert.match(prompt, /Do not silently switch/);
  assert.match(prompt, /Playwright Browser automation is disabled/);
  assert.match(prompt, /Do not claim you saw/);

  const query = read("src/core/agent/query.ts");
  assert.match(query, /new Set\(\["Browser"/);
  assert.match(query, /signal: input\.signal/);

  const tools = read("src/core/tools/registry.ts");
  assert.match(tools, /signal\?: AbortSignal/);
  assert.match(tools, /throwIfAborted\(input\.signal\)/);
  assert.match(tools, /signal: context\.signal/);

  const computerUse = read("src/core/tools/computer-use.ts");
  assert.match(computerUse, /Kira cannot observe the screen right now/);
  assert.match(computerUse, /Screen Recording permission/);

  const styles = read("src/renderer/styles/global.css");
  assert.match(styles, /\.trust-bar/);
  assert.match(styles, /\.setup-cta/);
  assert.match(styles, /\.permission-grid/);

  await assertBashAbort();
  console.log("mac trust tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
