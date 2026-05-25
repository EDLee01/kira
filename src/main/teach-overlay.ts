import { BrowserWindow, screen } from "electron";
import type { ComputerUseTeachStepRequest, ComputerUseTeachStepResult } from "../core/tools/computer-use.ts";

let activeTeachOverlay: BrowserWindow | null = null;

export function closeTeachOverlay(): void {
  const overlay = activeTeachOverlay;
  activeTeachOverlay = null;
  if (overlay && !overlay.isDestroyed()) {
    overlay.close();
  }
}

export function showTeachOverlay(
  parent: BrowserWindow,
  request: ComputerUseTeachStepRequest,
  signal?: AbortSignal
): Promise<ComputerUseTeachStepResult> {
  closeTeachOverlay();

  return new Promise((resolve) => {
    const display = request.anchor
      ? screen.getDisplayNearestPoint({ x: Math.round(request.anchor.x), y: Math.round(request.anchor.y) })
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const bounds = display.bounds;
    const localAnchor = request.anchor
      ? {
          x: Math.round(request.anchor.x - bounds.x),
          y: Math.round(request.anchor.y - bounds.y)
        }
      : undefined;

    const overlay = new BrowserWindow({
      x: bounds.x,
      y: bounds.y,
      width: bounds.width,
      height: bounds.height,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true,
      hasShadow: false,
      backgroundColor: "#00000000",
      parent: parent.isDestroyed() ? undefined : parent,
      modal: false,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    activeTeachOverlay = overlay;
    overlay.setAlwaysOnTop(true, process.platform === "darwin" ? "screen-saver" : "floating");
    overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });

    let settled = false;
    const finish = (action: ComputerUseTeachStepResult["action"]) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      if (activeTeachOverlay === overlay) activeTeachOverlay = null;
      if (!overlay.isDestroyed()) overlay.close();
      resolve({ action });
    };
    const onAbort = () => finish("exit");
    signal?.addEventListener("abort", onAbort, { once: true });

    overlay.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith("kira-teach://")) return;
      event.preventDefault();
      finish(url.startsWith("kira-teach://next") ? "next" : "exit");
    });
    overlay.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("kira-teach://")) {
        finish(url.startsWith("kira-teach://next") ? "next" : "exit");
      }
      return { action: "deny" };
    });
    overlay.on("closed", () => {
      if (activeTeachOverlay === overlay) activeTeachOverlay = null;
      if (!settled) finish("exit");
    });

    overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderTeachOverlayHtml(request, localAnchor))}`);
    overlay.show();
    overlay.focus();
  });
}

function renderTeachOverlayHtml(
  request: ComputerUseTeachStepRequest,
  anchor: { x: number; y: number } | undefined
): string {
  const stepLabel = request.stepIndex && request.stepCount
    ? `Step ${request.stepIndex} of ${request.stepCount}`
    : "Kira guide";
  const payload = JSON.stringify({
    stepLabel,
    explanation: request.explanation,
    nextPreview: request.nextPreview,
    actionCount: request.actionCount,
    anchor
  });

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Kira guide</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif; color: #f7f7fb; }
  body { user-select: none; }
  .veil { position: fixed; inset: 0; background: rgba(3, 7, 18, 0.18); }
  .anchor { position: fixed; width: 16px; height: 16px; margin: -8px 0 0 -8px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.96); background: #6c5ce7; box-shadow: 0 0 0 8px rgba(108,92,231,0.22), 0 10px 26px rgba(0,0,0,0.32); display: none; }
  .card { position: fixed; width: min(360px, calc(100vw - 32px)); border: 1px solid rgba(255,255,255,0.16); border-radius: 10px; background: rgba(13, 16, 28, 0.96); box-shadow: 0 20px 70px rgba(0,0,0,0.42); overflow: hidden; }
  .bar { height: 3px; background: linear-gradient(90deg, #6c5ce7, #22c55e); }
  .body { padding: 14px 16px 12px; }
  .meta { font-size: 11px; line-height: 1.2; color: rgba(247,247,251,0.62); letter-spacing: 0; margin-bottom: 8px; }
  .explanation { font-size: 14px; line-height: 1.48; color: #f7f7fb; white-space: pre-wrap; overflow-wrap: anywhere; }
  .next { margin-top: 10px; padding: 9px 10px; border-radius: 8px; background: rgba(255,255,255,0.06); color: rgba(247,247,251,0.78); font-size: 12px; line-height: 1.42; white-space: pre-wrap; overflow-wrap: anywhere; }
  .footer { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 12px; border-top: 1px solid rgba(255,255,255,0.1); background: rgba(0,0,0,0.14); }
  .count { color: rgba(247,247,251,0.54); font-size: 11px; white-space: nowrap; }
  .actions { display: flex; align-items: center; gap: 8px; }
  button { height: 30px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.14); padding: 0 12px; font: inherit; font-size: 12px; cursor: pointer; color: #f7f7fb; background: rgba(255,255,255,0.08); }
  button:hover { background: rgba(255,255,255,0.13); }
  .primary { border-color: transparent; background: #6c5ce7; color: white; font-weight: 600; }
  .primary:hover { background: #7d6ff0; }
  .working .actions button { display: none; }
  .working .count::before { content: ""; display: inline-block; width: 9px; height: 9px; margin-right: 7px; border-radius: 50%; border: 2px solid rgba(255,255,255,0.28); border-top-color: #fff; vertical-align: -1px; animation: spin 0.75s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
</head>
<body>
  <div class="veil"></div>
  <div class="anchor" id="anchor"></div>
  <section class="card" id="card">
    <div class="bar"></div>
    <div class="body">
      <div class="meta" id="step"></div>
      <div class="explanation" id="explanation"></div>
      <div class="next" id="next"></div>
    </div>
    <div class="footer">
      <div class="count" id="count"></div>
      <div class="actions">
        <button id="exit">Exit</button>
        <button class="primary" id="nextButton">Next</button>
      </div>
    </div>
  </section>
<script>
  const data = ${payload};
  const card = document.getElementById("card");
  const anchor = document.getElementById("anchor");
  const step = document.getElementById("step");
  const explanation = document.getElementById("explanation");
  const next = document.getElementById("next");
  const count = document.getElementById("count");
  step.textContent = data.stepLabel;
  explanation.textContent = data.explanation;
  next.textContent = data.nextPreview;
  count.textContent = data.actionCount === 1 ? "1 action after Next" : data.actionCount + " actions after Next";

  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function positionCard() {
    const rect = card.getBoundingClientRect();
    if (!data.anchor) {
      card.style.left = Math.round((innerWidth - rect.width) / 2) + "px";
      card.style.top = Math.round((innerHeight - rect.height) / 2) + "px";
      return;
    }
    anchor.style.display = "block";
    anchor.style.left = data.anchor.x + "px";
    anchor.style.top = data.anchor.y + "px";
    const gap = 22;
    const preferBelow = data.anchor.y + gap + rect.height < innerHeight - 18;
    const left = clamp(data.anchor.x + gap, 16, innerWidth - rect.width - 16);
    const top = preferBelow
      ? clamp(data.anchor.y + gap, 16, innerHeight - rect.height - 16)
      : clamp(data.anchor.y - rect.height - gap, 16, innerHeight - rect.height - 16);
    card.style.left = Math.round(left) + "px";
    card.style.top = Math.round(top) + "px";
  }
  requestAnimationFrame(positionCard);
  addEventListener("resize", positionCard);
  document.getElementById("nextButton").addEventListener("click", () => {
    document.body.classList.add("working");
    count.textContent = "Working...";
    setTimeout(() => { location.href = "kira-teach://next"; }, 160);
  });
  document.getElementById("exit").addEventListener("click", () => { location.href = "kira-teach://exit"; });
  addEventListener("keydown", (event) => {
    if (event.key === "Escape") location.href = "kira-teach://exit";
    if (event.key === "Enter") document.getElementById("nextButton").click();
  });
</script>
</body>
</html>`;
}
