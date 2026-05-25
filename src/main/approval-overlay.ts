import { BrowserWindow, screen, shell } from "electron";
import type { MagiToolUsePart } from "../core/providers/ir.ts";
import type { ComputerUseApprovalPreview, ComputerUseApprovalResponse, ComputerUseGrantFlags } from "../core/tools/computer-use.ts";
import type { ToolApprovalDecision } from "../core/tools/registry.ts";

export interface ApprovalTccState {
  accessibility: boolean;
  screenRecording: boolean;
}

export interface ApprovalOverlayRequest {
  title: string;
  message: string;
  reason: string;
  toolUse: MagiToolUsePart;
  kind: "computer-use" | "command" | "process" | "generic";
  tccState?: ApprovalTccState;
  computerUsePreview?: ComputerUseApprovalPreview;
}

let activeApprovalOverlay: BrowserWindow | null = null;
const APPROVAL_TIMEOUT_MS = 90_000;

export function closeApprovalOverlay(): void {
  const overlay = activeApprovalOverlay;
  activeApprovalOverlay = null;
  if (overlay && !overlay.isDestroyed()) {
    overlay.close();
  }
}

export function showApprovalOverlay(
  parent: BrowserWindow,
  request: ApprovalOverlayRequest,
  signal?: AbortSignal
): Promise<ToolApprovalDecision> {
  closeApprovalOverlay();

  return new Promise((resolve) => {
    const parentBounds = parent.isDestroyed() ? undefined : parent.getBounds();
    const display = parentBounds
      ? screen.getDisplayMatching(parentBounds)
      : screen.getPrimaryDisplay();
    const bounds = display.workArea;
    const width = Math.min(460, Math.max(380, Math.round(bounds.width * 0.42)));
    const height = Math.min(560, Math.max(420, Math.round(bounds.height * 0.6)));
    const overlay = new BrowserWindow({
      x: Math.round(bounds.x + (bounds.width - width) / 2),
      y: Math.round(bounds.y + (bounds.height - height) / 2),
      width,
      height,
      frame: false,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      focusable: true,
      backgroundColor: "#11111a",
      parent: parent.isDestroyed() ? undefined : parent,
      modal: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
	    activeApprovalOverlay = overlay;
	    overlay.setAlwaysOnTop(true, "modal-panel");

	    let settled = false;
	    const timeout = setTimeout(() => finish(false), APPROVAL_TIMEOUT_MS);
	    const finish = (decision: ToolApprovalDecision) => {
	      if (settled) return;
	      settled = true;
	      clearTimeout(timeout);
	      signal?.removeEventListener("abort", onAbort);
	      if (activeApprovalOverlay === overlay) activeApprovalOverlay = null;
      if (!overlay.isDestroyed()) overlay.close();
      resolve(decision);
    };
    const onAbort = () => finish(false);
    signal?.addEventListener("abort", onAbort, { once: true });

    overlay.webContents.on("will-navigate", (event, url) => {
      if (!url.startsWith("kira-approval://")) return;
      event.preventDefault();
      if (openTccUrl(url)) return;
      finish(parseApprovalDecision(url));
    });
    overlay.webContents.setWindowOpenHandler(({ url }) => {
      if (url.startsWith("kira-approval://")) {
        if (openTccUrl(url)) return { action: "deny" };
        finish(parseApprovalDecision(url));
      }
      return { action: "deny" };
    });
    overlay.on("closed", () => {
      if (activeApprovalOverlay === overlay) activeApprovalOverlay = null;
      if (!settled) finish(false);
    });

    overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(renderApprovalHtml(request))}`);
    overlay.show();
    overlay.focus();
  });
}

function renderApprovalHtml(request: ApprovalOverlayRequest): string {
  const input = (request.toolUse.input ?? {}) as Record<string, unknown>;
  const rows = approvalRows(request, input);
  const requestedApps = request.kind === "computer-use" && Array.isArray(input.apps)
    ? input.apps.filter((app): app is string => typeof app === "string")
    : [];
  const grantFlags = computerUseGrantFlags(input);
  const payload = JSON.stringify({
    title: request.title,
    message: request.message,
    reason: request.reason,
    tool: request.toolUse.name,
    action: String(input.action ?? request.toolUse.name),
    kind: request.kind,
    tccState: request.tccState,
    rows,
    requestedApps,
    grantFlags,
    willHide: request.computerUsePreview?.willHide ?? [],
    autoUnhideEnabled: request.computerUsePreview?.autoUnhideEnabled ?? false,
  });

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Kira approval</title>
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #11111a; color: #f2f2f7; font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", system-ui, sans-serif; }
  body { display: flex; flex-direction: column; border: 1px solid rgba(255,255,255,0.12); border-radius: 12px; user-select: none; }
  .top { padding: 16px 18px 13px; border-bottom: 1px solid rgba(255,255,255,0.09); background: linear-gradient(180deg, rgba(255,255,255,0.055), rgba(255,255,255,0)); }
  .eyebrow { color: rgba(242,242,247,0.55); font-size: 11px; line-height: 1.2; margin-bottom: 6px; }
  h1 { margin: 0; font-size: 16px; line-height: 1.25; font-weight: 650; letter-spacing: 0; }
  .message { margin-top: 7px; color: rgba(242,242,247,0.76); font-size: 12.5px; line-height: 1.4; }
  .content { flex: 1; overflow: auto; padding: 14px 18px; }
  .reason { padding: 10px 11px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.055); color: rgba(242,242,247,0.82); font-size: 12px; line-height: 1.42; white-space: pre-wrap; overflow-wrap: anywhere; }
  .section { margin-top: 14px; }
  .label { margin-bottom: 7px; color: rgba(242,242,247,0.5); font-size: 11px; line-height: 1.2; text-transform: uppercase; letter-spacing: 0; }
  .row { display: grid; grid-template-columns: 106px 1fr; gap: 8px; padding: 7px 0; border-bottom: 1px solid rgba(255,255,255,0.07); font-size: 12px; line-height: 1.35; }
	  .row:last-child { border-bottom: 0; }
	  .key { color: rgba(242,242,247,0.48); }
	  .value { color: rgba(242,242,247,0.88); overflow-wrap: anywhere; white-space: pre-wrap; }
	  .checklist { display: grid; gap: 8px; }
	  .check { display: flex; align-items: center; gap: 8px; padding: 8px 9px; border-radius: 8px; background: rgba(255,255,255,0.045); border: 1px solid rgba(255,255,255,0.08); font-size: 12px; line-height: 1.3; color: rgba(242,242,247,0.9); }
	  .check input { width: 14px; height: 14px; margin: 0; accent-color: #6c5ce7; }
	  .tcc { display: grid; gap: 9px; }
	  .tcc-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 10px 11px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.09); background: rgba(255,255,255,0.045); }
	  .tcc-name { font-size: 12.5px; color: rgba(242,242,247,0.9); }
	  .tcc-state { margin-top: 3px; font-size: 11.5px; color: rgba(242,242,247,0.55); }
	  .tcc-open { min-width: 92px; height: 28px; font-size: 11.5px; }
	  .flags { display: flex; flex-wrap: wrap; gap: 7px; }
	  .flag { padding: 5px 8px; border-radius: 999px; background: rgba(108,92,231,0.18); color: #d8d4ff; border: 1px solid rgba(108,92,231,0.35); font-size: 11px; line-height: 1; }
  .notice { padding: 9px 10px; border-radius: 8px; background: rgba(108,92,231,0.12); border: 1px solid rgba(108,92,231,0.24); color: rgba(242,242,247,0.78); font-size: 11.5px; line-height: 1.38; overflow-wrap: anywhere; }
  .warning { margin-top: 12px; color: rgba(255,213,128,0.9); font-size: 11.5px; line-height: 1.38; }
  .footer { display: flex; align-items: center; justify-content: flex-end; gap: 8px; padding: 12px 14px; border-top: 1px solid rgba(255,255,255,0.09); background: rgba(0,0,0,0.16); }
  button { height: 32px; min-width: 82px; border-radius: 8px; border: 1px solid rgba(255,255,255,0.13); padding: 0 13px; font: inherit; font-size: 12px; cursor: pointer; color: #f2f2f7; background: rgba(255,255,255,0.075); }
  button:hover { background: rgba(255,255,255,0.12); }
  .allow { background: #6c5ce7; border-color: transparent; color: white; font-weight: 650; }
  .allow:hover { background: #7d6ff0; }
</style>
</head>
<body>
  <header class="top">
    <div class="eyebrow" id="eyebrow"></div>
    <h1 id="title"></h1>
    <div class="message" id="message"></div>
  </header>
  <main class="content">
    <div class="label">Reason</div>
    <div class="reason" id="reason"></div>
	    <section class="section" id="detailsSection">
	      <div class="label">Details</div>
	      <div id="rows"></div>
	    </section>
	    <section class="section" id="tccSection">
	      <div class="label">macOS Permissions</div>
	      <div class="tcc" id="tcc"></div>
	    </section>
	    <section class="section" id="appsSection">
	      <div class="label">Apps</div>
	      <div class="checklist" id="apps"></div>
	    </section>
	    <section class="section" id="flagsSection">
	      <div class="label">Requested Grants</div>
	      <div class="checklist" id="flags"></div>
	    </section>
	    <section class="section" id="willHideSection">
	      <div class="label">Before Control</div>
	      <div class="notice" id="willHide"></div>
	    </section>
    <div class="warning" id="warning">Kira will only continue this action if you approve. Deny tells the agent to choose another path.</div>
  </main>
  <footer class="footer">
    <button id="deny">Deny</button>
    <button class="allow" id="allow">Allow</button>
  </footer>
<script>
  const data = ${payload};
  document.getElementById("eyebrow").textContent = data.kind === "computer-use" ? "Computer Use approval" : "Action approval";
  document.getElementById("title").textContent = data.title;
  document.getElementById("message").textContent = data.message;
  document.getElementById("reason").textContent = data.reason || "No reason provided.";
  const rows = document.getElementById("rows");
  data.rows.forEach((row) => {
    const el = document.createElement("div");
    el.className = "row";
    const key = document.createElement("div");
    key.className = "key";
    key.textContent = row.key;
    const value = document.createElement("div");
    value.className = "value";
    value.textContent = row.value;
    el.append(key, value);
    rows.append(el);
  });
	  if (data.rows.length === 0) document.getElementById("detailsSection").style.display = "none";
	  const tcc = document.getElementById("tcc");
	  function renderTccRow(name, granted, url) {
	    const row = document.createElement("div");
	    row.className = "tcc-row";
	    const copy = document.createElement("div");
	    const title = document.createElement("div");
	    title.className = "tcc-name";
	    title.textContent = name;
	    const state = document.createElement("div");
	    state.className = "tcc-state";
	    state.textContent = granted ? "Granted" : "Not granted";
	    copy.append(title, state);
	    const button = document.createElement("button");
	    button.className = "tcc-open";
	    button.textContent = "Open";
	    button.disabled = Boolean(granted);
	    button.addEventListener("click", () => { location.href = "kira-approval://open-tcc?target=" + encodeURIComponent(url); });
	    row.append(copy, button);
	    tcc.append(row);
	  }
	  if (data.tccState) {
	    renderTccRow("Accessibility", data.tccState.accessibility, "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
	    renderTccRow("Screen Recording", data.tccState.screenRecording, "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture");
	    document.getElementById("appsSection").style.display = "none";
	    document.getElementById("flagsSection").style.display = "none";
	    document.getElementById("willHideSection").style.display = "none";
	    document.getElementById("allow").textContent = "Try again";
	  } else {
	    document.getElementById("tccSection").style.display = "none";
	  }
	  const apps = document.getElementById("apps");
	  data.requestedApps.forEach((app) => {
	    const label = document.createElement("label");
	    label.className = "check";
	    const input = document.createElement("input");
	    input.type = "checkbox";
	    input.checked = true;
	    input.dataset.app = app;
	    const text = document.createElement("span");
	    text.textContent = app;
	    label.append(input, text);
	    apps.append(label);
	  });
	  if (data.requestedApps.length === 0) document.getElementById("appsSection").style.display = "none";
	  const flags = document.getElementById("flags");
	  data.grantFlags.forEach((flag) => {
	    const label = document.createElement("label");
	    label.className = "check";
	    const input = document.createElement("input");
	    input.type = "checkbox";
	    input.checked = true;
	    input.dataset.flag = flag.key;
	    const text = document.createElement("span");
	    text.textContent = flag.label;
	    label.append(input, text);
	    flags.append(label);
	  });
	  if (data.grantFlags.length === 0) document.getElementById("flagsSection").style.display = "none";
	  const willHide = Array.isArray(data.willHide) ? data.willHide : [];
	  const willHideNames = willHide.map((app) => app && (app.displayName || app.bundleId)).filter(Boolean);
	  if (data.tccState || willHideNames.length === 0) {
	    document.getElementById("willHideSection").style.display = "none";
	  } else {
	    const unique = Array.from(new Set(willHideNames));
	    const count = unique.length;
	    document.getElementById("willHide").textContent =
	      count + " other " + (count === 1 ? "app" : "apps") +
	      " will be hidden while Kira works" +
	      (data.autoUnhideEnabled ? ", then restored when Kira is done." : ".") +
	      " " + unique.slice(0, 5).join(", ") + (unique.length > 5 ? ", ..." : "");
	  }
		  function allow() {
		    if (data.kind !== "computer-use") {
		      location.href = "kira-approval://allow";
		      return;
		    }
	    if (data.tccState) {
	      const payload = encodeURIComponent(JSON.stringify({
	        tccState: data.tccState,
	        userConsented: true
	      }));
	      location.href = "kira-approval://allow?computerUse=" + payload;
	      return;
	    }
	    const checkedApps = Array.from(document.querySelectorAll("input[data-app]")).filter((input) => input.checked).map((input) => input.dataset.app);
	    const checkedFlagKeys = new Set(Array.from(document.querySelectorAll("input[data-flag]")).filter((input) => input.checked).map((input) => input.dataset.flag));
	    const flags = {};
	    data.grantFlags.forEach((flag) => { flags[flag.key] = checkedFlagKeys.has(flag.key); });
	    const payload = encodeURIComponent(JSON.stringify({
	      grantedApps: checkedApps,
	      deniedApps: data.requestedApps.filter((app) => !checkedApps.includes(app)),
	      flags,
	      userConsented: true
		    }));
		    location.href = "kira-approval://allow?computerUse=" + payload;
		  }
		  function deny() {
		    if (data.kind !== "computer-use") {
		      location.href = "kira-approval://deny";
		      return;
		    }
		    const flags = {};
		    data.grantFlags.forEach((flag) => { flags[flag.key] = false; });
		    const payload = encodeURIComponent(JSON.stringify({
		      tccState: data.tccState,
		      grantedApps: [],
		      deniedApps: data.requestedApps,
		      flags,
		      userConsented: false
		    }));
		    location.href = "kira-approval://allow?computerUse=" + payload;
		  }
		  document.getElementById("allow").addEventListener("click", allow);
		  document.getElementById("deny").addEventListener("click", deny);
		  addEventListener("keydown", (event) => {
		    if (event.key === "Escape") deny();
		    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") allow();
		  });
</script>
</body>
</html>`;
}

function approvalRows(request: ApprovalOverlayRequest, input: Record<string, unknown>): Array<{ key: string; value: string }> {
  if (request.kind === "computer-use") {
    return [
      row("Action", input.action),
      Array.isArray(input.apps) ? row("Apps", input.apps.join(", ")) : undefined,
      row("App", input.app ?? input.bundleId),
      row("Coordinates", input.x !== undefined || input.y !== undefined ? `(${input.x ?? "?"}, ${input.y ?? "?"})` : undefined),
      row("Destination", input.toX !== undefined || input.toY !== undefined ? `(${input.toX ?? "?"}, ${input.toY ?? "?"})` : undefined),
      row("Scroll", input.deltaX !== undefined || input.deltaY !== undefined ? `(${input.deltaX ?? 0}, ${input.deltaY ?? 0})` : undefined),
      row("Text", input.text),
      Array.isArray(input.keys) ? row("Keys", input.keys.join("+")) : undefined,
      row("Key", input.key),
      Array.isArray(input.actions) ? row("Batch", `${input.actions.length} actions`) : undefined,
      row("Duration", input.durationMs !== undefined ? `${input.durationMs} ms` : undefined),
    ].filter((item): item is { key: string; value: string } => Boolean(item));
  }
  if (request.kind === "command") {
    return [row("Command", input.command)].filter((item): item is { key: string; value: string } => Boolean(item));
  }
  if (request.kind === "process") {
    return [
      row("PID", input.pid),
      row("Name", input.name),
      row("Signal", input.signal)
    ].filter((item): item is { key: string; value: string } => Boolean(item));
  }
  return [{ key: "Tool", value: request.toolUse.name }];
}

function parseApprovalDecision(url: string): ToolApprovalDecision {
  if (!url.startsWith("kira-approval://allow")) return false;
  try {
    const parsed = new URL(url);
    const raw = parsed.searchParams.get("computerUse");
    if (!raw) return true;
    return {
      approved: true,
      computerUse: parseComputerUseApprovalResponse(JSON.parse(raw))
    };
  } catch {
    return true;
  }
}

function openTccUrl(url: string): boolean {
  if (!url.startsWith("kira-approval://open-tcc")) return false;
  try {
    const parsed = new URL(url);
    const target = parsed.searchParams.get("target");
    if (!target?.startsWith("x-apple.systempreferences:")) return true;
    void shell.openExternal(target).catch(() => undefined);
  } catch {
    // Keep the approval dialog open even if the settings URL could not be parsed.
  }
  return true;
}

function parseComputerUseApprovalResponse(value: unknown): ComputerUseApprovalResponse {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    granted: readAppGrants(input.granted),
    denied: readAppDenials(input.denied),
    grantedApps: readStringArray(input.grantedApps),
    deniedApps: readStringArray(input.deniedApps),
    flags: readGrantFlags(input.flags),
    tccState: readTccState(input.tccState),
    userConsented: input.userConsented === true
  };
}

function readStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  return value.filter((item): item is string => typeof item === "string");
}

function readAppGrants(value: unknown): ComputerUseApprovalResponse["granted"] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const input = item as Record<string, unknown>;
    const bundleId = typeof input.bundleId === "string" ? input.bundleId : undefined;
    const displayName = typeof input.displayName === "string" ? input.displayName : undefined;
    const tier = input.tier === "read" || input.tier === "click" || input.tier === "full" ? input.tier : "full";
    const grantedAt = typeof input.grantedAt === "string" ? input.grantedAt : new Date().toISOString();
    if (!bundleId && !displayName) return [];
    return [{ bundleId, displayName, tier, grantedAt }];
  });
}

function readAppDenials(value: unknown): ComputerUseApprovalResponse["denied"] {
  if (!Array.isArray(value)) return undefined;
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const input = item as Record<string, unknown>;
    const bundleId = typeof input.bundleId === "string" ? input.bundleId : undefined;
    const reason = input.reason === "not_installed" ? "not_installed" : "user_denied";
    if (!bundleId) return [];
    return [{ bundleId, reason }];
  });
}

function readGrantFlags(value: unknown): Partial<ComputerUseGrantFlags> | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  const flags: Partial<ComputerUseGrantFlags> = {};
  if (typeof input.clipboardRead === "boolean") flags.clipboardRead = input.clipboardRead;
  if (typeof input.clipboardWrite === "boolean") flags.clipboardWrite = input.clipboardWrite;
  if (typeof input.systemKeyCombos === "boolean") flags.systemKeyCombos = input.systemKeyCombos;
  return flags;
}

function readTccState(value: unknown): ApprovalTccState | undefined {
  if (!value || typeof value !== "object") return undefined;
  const input = value as Record<string, unknown>;
  if (typeof input.accessibility !== "boolean" || typeof input.screenRecording !== "boolean") return undefined;
  return {
    accessibility: input.accessibility,
    screenRecording: input.screenRecording
  };
}

function computerUseGrantFlags(input: Record<string, unknown>): Array<{ key: keyof ComputerUseGrantFlags; label: string }> {
  return [
    input.clipboardRead === true ? { key: "clipboardRead" as const, label: "Clipboard read" } : undefined,
    input.clipboardWrite === true ? { key: "clipboardWrite" as const, label: "Clipboard write / paste" } : undefined,
    input.systemKeyCombos === true ? { key: "systemKeyCombos" as const, label: "System shortcuts" } : undefined
  ].filter((flag): flag is { key: keyof ComputerUseGrantFlags; label: string } => Boolean(flag));
}

function row(key: string, value: unknown): { key: string; value: string } | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  return { key, value: String(value).slice(0, 1000) };
}
