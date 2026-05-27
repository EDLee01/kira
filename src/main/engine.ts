/**
 * Engine wrapper — bridges magi-next's runAgentQuery to Electron IPC.
 * Runs in the main process.
 */
import { BrowserWindow, systemPreferences } from "electron";
import { runAgentQuery } from "../core/agent/query.ts";
import { MagiContentPart, textMessage } from "../core/providers/ir.ts";
import { loadConfig, McpServerConfig } from "../core/config.ts";
import { getMagiPaths, MagiPaths } from "../core/paths.ts";
import { SessionStore } from "../core/session-store.ts";
import { compactSession, recoverSessionContext } from "../core/context/compaction.ts";
import { buildLayeredContext } from "../core/context/layers.ts";
import { formatGoalContext, getGoal } from "../core/goal.ts";
import { buildSystemInstructions } from "../core/agent/system-prompt.ts";
import { formatMemoryContext, retrieveRelevantMemory } from "../core/memory-search.ts";
import { extractExplicitMemoryWrite, MemoryScope } from "../core/memory.ts";
import { proposeMemoryDraft } from "../core/memory-draft.ts";
import { readMemdirIndex, searchMemdir } from "../core/memdir.ts";
import { selectRelevantMemories } from "../core/memory-selection.ts";
import { getBuiltinToolDefinitions } from "../core/tools/registry.ts";
import { executeComputerUse, previewComputerUseApproval, releaseComputerUseSession, resetComputerUseTurnState, restoreComputerUseClipboard, restoreComputerUseHiddenApps } from "../core/tools/computer-use.ts";
import type { ComputerUseTeachStepRequest } from "../core/tools/computer-use.ts";
import { buildKiraWorkspaceEnv, defaultKiraWorkspaceRoot, ensureKiraWorkspace } from "../core/kira-workspace.ts";
import { buildDesktopProvider } from "./desktop-provider";
import { closeApprovalOverlay, showApprovalOverlay, type ApprovalOverlayRequest } from "./approval-overlay";
import { closeTeachOverlay, showTeachOverlay } from "./teach-overlay";
import { readDesktopSettings } from "./settings-store";

export class Engine {
  private abortController: AbortController | null = null;
  private _running = false;
  private _sessionId: string | null = null;
  private _cwd: string = process.cwd();
  private _kiraWorkspaceRoot: string = defaultKiraWorkspaceRoot();
  private _mcpServers: Record<string, McpServerConfig> = {};
  private win: BrowserWindow;
  private store: SessionStore;
  private _listeners: Array<(event: string, data: unknown) => void> = [];
  private teachModeHidWindow = false;

  constructor(win: BrowserWindow, store: SessionStore) {
    this.win = win;
    this.store = store;
  }

  get running(): boolean { return this._running; }
  get sessionId(): string | null { return this._sessionId; }
  get cwd(): string { return this._cwd; }
  set cwd(dir: string) { this._cwd = dir; }
  get kiraWorkspaceRoot(): string { return this._kiraWorkspaceRoot; }
  set kiraWorkspaceRoot(dir: string) {
    this._kiraWorkspaceRoot = dir;
    ensureKiraWorkspace(dir);
  }
  get mcpServers(): Record<string, McpServerConfig> { return this._mcpServers; }
  set mcpServers(servers: Record<string, McpServerConfig>) { this._mcpServers = servers; }

  /** Add a listener that receives all emitted events */
  addListener(fn: (event: string, data: unknown) => void): void {
    this._listeners.push(fn);
  }

  private emit(event: string, data: unknown): void {
    if (!this.win.isDestroyed()) {
      this.win.webContents.send(event, data);
    }
    for (const fn of this._listeners) fn(event, data);
  }

  async startQuery(sessionId: string, userMessage: string): Promise<void> {
    if (this._running) {
      this.emit("engine:error", { error: "A query is already running" });
      throw new Error("A query is already running");
    }

    this._running = true;
    this._sessionId = sessionId;
    this.abortController = new AbortController();

    try {
      const identityResponse = identityAnswer(userMessage);
      if (identityResponse) {
        this.emit("engine:status", { running: true, sessionId });
        this.emit("engine:stream-event", { type: "text_delta", text: identityResponse });
        this.store.appendMessage({
          sessionId,
          role: "assistant",
          content: JSON.stringify([{ type: "text", text: identityResponse }]),
          metadata: { local: true, kind: "identity" },
        });
        this.emit("engine:stream-event", { type: "done", text: identityResponse, messages: [] });
        return;
      }

      const paths = getMagiPaths(process.env);
      const runtime = this.buildProvider(paths);
      const { adapter, model, providerName, env } = runtime;
      const settings = readDesktopSettings(paths);
      const workspaceEnv = buildKiraWorkspaceEnv({
        root: this._kiraWorkspaceRoot,
        projectDir: this._cwd,
        env
      });

      // Load session messages from DB (user message already appended by ipc.ts)
      const session = this.store.getSession(sessionId);
      const rawMessages = session?.messages ?? [];

      // Auto-compact when either token or message volume starts to hurt response quality.
      const totalChars = rawMessages.reduce((sum: number, m: any) => sum + (m.content?.length ?? 0), 0);
      const estimatedTokens = Math.ceil(totalChars / 4);
      const COMPACT_THRESHOLD = 80_000;
      const MESSAGE_THRESHOLD = 80;
      const latestSummary = this.store.getLatestContextSummary(sessionId);
      const messagesSinceCompact = latestSummary
        ? Math.max(0, rawMessages.length - latestSummary.sourceMessageCount)
        : rawMessages.length;

      if (rawMessages.length > 30 && (estimatedTokens > COMPACT_THRESHOLD || messagesSinceCompact > MESSAGE_THRESHOLD)) {
        try {
          const result = compactSession({
            store: this.store,
            sessionId,
            recentMessages: 30,
            maxSummaryChars: 8000,
          });
          this.emit("engine:stream-event", {
            type: "compact_boundary",
            summaryId: result.summary.id,
            sourceMessageCount: result.summary.sourceMessageCount,
            estimatedTokensBefore: estimatedTokens,
          });
        } catch {}
      }

      // After potential compaction, recover context (summary + recent messages)
      const recovered = recoverSessionContext({
        store: this.store,
        sessionId,
        recentMessages: 30,
      });

      // Build messages: prepend summary if exists, then recent messages
      const messages: any[] = [];
      const goalContext = formatGoalContext(getGoal(paths, sessionId));
      const durableMemoryContext = await this.buildDurableMemoryContext({
        paths,
        userMessage,
        sessionId,
        adapter,
        providerName
      });
      const memoryContext = [goalContext, durableMemoryContext].filter(Boolean).join("\n\n") || undefined;
      const { systemPrompt } = buildLayeredContext({
        cwd: this._cwd,
        paths,
        systemInstructions: buildSystemInstructions({
          cwd: this._cwd,
          platform: process.platform,
          toolCount: getBuiltinToolDefinitions().filter((tool) => tool.name !== "Browser").length
        }),
        memoryContext,
        includeGit: true,
        includeDate: true,
        platform: process.platform
      });
      messages.push(textMessage("system", systemPrompt));
      if (recovered.summary) {
        messages.push(textMessage("system", `[Previous conversation summary]\n${recovered.summary.summary}`));
      }

      // Parse recent messages into MagiMessage format
      for (const m of recovered.recentMessages) {
        let content: unknown = m.content;
        if (typeof content === "string") {
          try { content = JSON.parse(content); } catch { content = [{ type: "text", text: content }]; }
        }
        if (!Array.isArray(content)) {
          content = [content];
        }
        messages.push({ role: m.role, content: content as MagiContentPart[] });
      }

      this.emit("engine:status", { running: true, sessionId });

      // Accumulate assistant text for persistence
      let assistantText = "";

      // Run agent loop
      const mcpConfig = Object.keys(this._mcpServers).length > 0
        ? { servers: this._mcpServers }
        : undefined;

      for await (const event of runAgentQuery({
        adapter,
        model,
        providerName,
        messages,
        cwd: this._cwd,
        env: workspaceEnv,
        stateRoot: paths.stateRoot,
        memoryRoot: loadConfig(paths).memory.root,
        outputRoot: ensureKiraWorkspace(this._kiraWorkspaceRoot).artifactsRoot,
        kiraWorkspaceRoot: this._kiraWorkspaceRoot,
        computerUseDeniedBundleIds: parseStringArraySetting(settings.computerUseDeniedBundleIds),
        sessionId,
        signal: this.abortController.signal,
        permissionMode: "auto",
        approvalResolver: async ({ toolUse, reason }) => {
          let request: ApprovalOverlayRequest;

          const computerUseInput = normalizeComputerUseToolInput(toolUse.name, toolUse.input);
          if (computerUseInput) {
            const action = computerUseInput.action;
            const isTeachAccess = action === "request_teach_access";
            const computerUsePreview = await this.computerUseApprovalPreview(computerUseInput);
            const tccState = this.computerUseTccStateForApproval(action);
            request = {
              title: isTeachAccess ? "Allow Kira to guide you?" : "Allow Kira to control the computer?",
              message: isTeachAccess
                ? "Kira is requesting permission to show a step-by-step guide. The main window will hide and a teaching overlay will appear."
                : action === "request_access"
                ? "Kira is requesting access to desktop apps."
                : "Kira wants to perform a desktop action.",
              reason: [
                reason,
                computerUseInput.reason !== undefined ? String(computerUseInput.reason).slice(0, 300) : undefined,
                tccState ? formatComputerUseTccState(tccState) : undefined,
                isTeachAccess
                  ? "Approve only if you want Kira to enter teaching mode for this task. Each step waits for your Next or Exit choice."
                  : "Coordinates are pixels from Kira's latest screenshot; Kira handles display scaling."
              ].filter((line): line is string => Boolean(line)).join("\n\n"),
              toolUse,
              kind: "computer-use",
              tccState,
              computerUsePreview
            };
          } else if (toolUse.name === "Bash") {
            request = {
              title: "Allow Kira to run this command?",
              message: "Kira wants to run a command that may install software or change system state.",
              reason,
              toolUse,
              kind: "command"
            };
          } else if (toolUse.name === "KillProcess") {
            request = {
              title: "Allow Kira to close this process?",
              message: "Kira wants to terminate a running process.",
              reason,
              toolUse,
              kind: "process"
            };
          } else {
            return false;
          }

          return showApprovalOverlay(this.win, request, this.abortController?.signal);
        },
        computerUseTeachStepResolver: async (request: ComputerUseTeachStepRequest) => {
          return showTeachOverlay(this.win, request, this.abortController?.signal);
        },
        computerUseHideHostWindow: () => {
          this.hideMainWindowForComputerUse();
        },
        computerUseTeachModeActivated: () => {
          this.hideMainWindowForTeachMode();
        },
        computerUseTeachModeExited: () => {
          this.restoreMainWindowFromTeachMode();
        },
        mcp: mcpConfig,
        onStreamEvent: (ev) => {
          const visibleEvent = ev.type === "tool_result"
            ? { ...ev, content: hideEncodedImages(ev.content) }
            : ev;
          this.emit("engine:stream-event", visibleEvent);
          if (ev.type === "text_delta" && ev.text) {
            assistantText += ev.text;
          }
        },
      })) {
        // Events already emitted via onStreamEvent
      }

      // Persist assistant response to session store
      if (assistantText) {
        this.store.appendMessage({
          sessionId,
          role: "assistant",
          content: JSON.stringify([{ type: "text", text: assistantText }]),
          metadata: {},
        });
      }
    } catch (error) {
      // Don't emit error for intentional cancellation
      if (this.abortController?.signal.aborted) {
        this.emit("engine:stream-event", { type: "cancelled" });
      } else {
        this.emit("engine:error", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      closeApprovalOverlay();
      closeTeachOverlay();
      await restoreComputerUseHiddenApps({
        cwd: this._cwd,
        kiraWorkspaceRoot: this._kiraWorkspaceRoot,
        sessionId
      });
      await restoreComputerUseClipboard({
        cwd: this._cwd,
        kiraWorkspaceRoot: this._kiraWorkspaceRoot,
        sessionId
      });
      await releaseComputerUseSession({
        cwd: this._cwd,
        kiraWorkspaceRoot: this._kiraWorkspaceRoot,
        sessionId
      });
      resetComputerUseTurnState({
        cwd: this._cwd,
        kiraWorkspaceRoot: this._kiraWorkspaceRoot,
        sessionId
      });
      this.restoreMainWindowFromTeachMode();
      this._running = false;
      this._sessionId = null;
      this.abortController = null;
      this.emit("engine:status", { running: false, sessionId: null });
    }
  }

  cancelQuery(): void {
    this.abortController?.abort();
    this.abortController = null;
    closeApprovalOverlay();
    closeTeachOverlay();
    if (this._sessionId) {
      void restoreComputerUseHiddenApps({
        cwd: this._cwd,
        kiraWorkspaceRoot: this._kiraWorkspaceRoot,
        sessionId: this._sessionId
      });
      void restoreComputerUseClipboard({
        cwd: this._cwd,
        kiraWorkspaceRoot: this._kiraWorkspaceRoot,
        sessionId: this._sessionId
      });
      void releaseComputerUseSession({
        cwd: this._cwd,
        kiraWorkspaceRoot: this._kiraWorkspaceRoot,
        sessionId: this._sessionId
      });
      resetComputerUseTurnState({
        cwd: this._cwd,
        kiraWorkspaceRoot: this._kiraWorkspaceRoot,
        sessionId: this._sessionId
      });
    }
    this.restoreMainWindowFromTeachMode();
  }

  canStartQuery(): boolean {
    return !this._running;
  }

  appendUserMessage(sessionId: string, text: string): void {
    if (!this.store.getSession(sessionId)) {
      this.store.createSession({ id: sessionId, title: text.slice(0, 80), cwd: this._cwd });
    }
    this.store.appendMessage({
      sessionId,
      role: "user",
      content: JSON.stringify({ type: "text", text }),
      metadata: {},
    });
  }

  private buildProvider(paths: MagiPaths): ReturnType<typeof buildDesktopProvider> {
    const runtime = buildDesktopProvider(paths);
    if (!hasRuntimeApiKey(runtime)) {
      throw new Error("No API key. Set an API key in Settings.");
    }
    return runtime;
  }

  private hideMainWindowForTeachMode(): void {
    this.hideMainWindowForComputerUse();
  }

  private hideMainWindowForComputerUse(): void {
    if (this.win.isDestroyed() || this.teachModeHidWindow) return;
    if (!this.win.isVisible()) return;
    this.teachModeHidWindow = true;
    this.win.hide();
  }

  private restoreMainWindowFromTeachMode(): void {
    if (!this.teachModeHidWindow) return;
    this.teachModeHidWindow = false;
    if (this.win.isDestroyed()) return;
    this.win.show();
    this.win.focus();
  }

  private async buildDurableMemoryContext(input: {
    paths: MagiPaths;
    userMessage: string;
    sessionId: string;
    adapter: ReturnType<typeof buildDesktopProvider>["adapter"];
    providerName: string;
  }): Promise<string> {
    try {
      const config = loadConfig(input.paths);
      if (!config.memory.enabled) {
        return "";
      }
      this.handleExplicitMemoryWrite(input);
      const sections: string[] = [];
      const hits = retrieveRelevantMemory({
        appRoot: input.paths.root,
        root: config.memory.root,
        query: input.userMessage,
        maxResults: config.memory.maxResults,
        sessionId: input.sessionId
      });
      const formalMemoryContext = formatMemoryContext(hits);
      if (formalMemoryContext) {
        sections.push(formalMemoryContext);
      }

      const memdirIndex = readMemdirIndex({ root: input.paths.root });
      if (memdirIndex.trim()) {
        sections.push(`[Memory Wiki Index]\n${memdirIndex.trim()}`);
      }

      const memdirMatches = searchMemdir({
        paths: { root: input.paths.root },
        query: input.userMessage,
        maxResults: Math.min(5, config.memory.maxResults)
      });
      if (memdirMatches.length > 0) {
        const lines = ["[Relevant Memory Wiki Pages]"];
        for (const entry of memdirMatches) {
          lines.push(`## ${entry.name} (${entry.type})`);
          lines.push(entry.description);
          if (entry.body) {
            lines.push(entry.body.length > 600 ? `${entry.body.slice(0, 600)}...` : entry.body);
          }
          lines.push("");
        }
        sections.push(lines.join("\n").trim());
      }

      const selectionRoute = config.memory.selectionModel
        ? {
            adapter: input.adapter,
            model: config.memory.selectionModel,
            providerName: input.providerName
          }
        : undefined;
      const selected = await selectRelevantMemories({
        paths: input.paths,
        cwd: this._cwd,
        sessionId: input.sessionId,
        scopes: config.memory.scopes,
        maxResults: config.memory.maxResults,
        prompt: input.userMessage,
        selectionRoute,
        signal: this.abortController?.signal
      });
      if (selected.formatted) {
        sections.push(selected.formatted);
      }
      this.store.recordAudit({
        sessionId: input.sessionId,
        action: "memory.retrieved",
        target: input.sessionId,
        metadata: {
          formalHitCount: hits.length,
          memdirHitCount: memdirMatches.length,
          legacyHitCount: selected.entries.length,
          legacySelectionMethod: selected.method
        }
      });
      return sections.join("\n\n");
    } catch {
      return "";
    }
  }

  private handleExplicitMemoryWrite(input: {
    paths: MagiPaths;
    userMessage: string;
    sessionId: string;
  }): void {
    const config = loadConfig(input.paths);
    if (!config.memory.enabled || config.memory.autoWrite === "off") {
      return;
    }
    const write = extractExplicitMemoryWrite(input.userMessage);
    if (!write) {
      return;
    }
    const draft = proposeMemoryDraft({
      appRoot: input.paths.root,
      root: config.memory.root,
      targetFile: explicitMemoryTargetFile(write.scope),
      content: formatExplicitMemoryDraft(write),
      reason: `Explicit user Memory request for ${write.scope}`,
      sourceSession: input.sessionId,
      confidence: 1
    });
    this.store.recordAudit({
      sessionId: input.sessionId,
      action: "memory.draft.created",
      target: draft.targetFile,
      metadata: {
        scope: write.scope,
        draftId: draft.id
      }
    });
  }

  private async computerUseApprovalPreview(input: Record<string, unknown>) {
    try {
      return await previewComputerUseApproval(input, {
        cwd: this._cwd,
        kiraWorkspaceRoot: this._kiraWorkspaceRoot,
        sessionId: this._sessionId ?? undefined,
        signal: this.abortController?.signal
      });
    } catch {
      return undefined;
    }
  }

  private computerUseTccStateForApproval(action: unknown): { accessibility: boolean; screenRecording: boolean } | undefined {
    if (process.platform !== "darwin") return undefined;
    if (action !== "request_access" && action !== "request_teach_access") return undefined;
    const accessibility = systemPreferences.isTrustedAccessibilityClient(false);
    const screenRecording = systemPreferences.getMediaAccessStatus("screen") === "granted";
    if (accessibility && screenRecording) return undefined;
    return {
      accessibility,
      screenRecording
    };
  }
}

function parseStringArraySetting(value: string | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
}

function formatComputerUseTccState(state: { accessibility: boolean; screenRecording: boolean }): string {
  const accessibility = state.accessibility
    ? "Accessibility: *granted*"
    : "Accessibility: *not granted*";
  const screenRecording = state.screenRecording
    ? "Screen Recording: *granted*"
    : "Screen Recording: *not granted*";
  return [
    accessibility,
    screenRecording
  ].join("\n");
}

function normalizeComputerUseToolInput(toolName: string, input: Record<string, unknown>): Record<string, unknown> | undefined {
  if (toolName === "ComputerUse") return input;
  const action = COMPUTER_USE_TOOL_ACTIONS[toolName];
  return action ? { ...input, action } : undefined;
}

function explicitMemoryTargetFile(scope: MemoryScope): string {
  if (scope === "user") return "user.md";
  if (scope === "project") return "projects/default.md";
  return "sessions/README.md";
}

function formatExplicitMemoryDraft(write: { scope: MemoryScope; text: string }): string {
  return [
    `## ${explicitMemoryTitle(write.scope)}`,
    "",
    write.text.trim()
  ].join("\n");
}

function explicitMemoryTitle(scope: MemoryScope): string {
  if (scope === "user") return "User memory";
  if (scope === "project") return "Project memory";
  return "Session memory";
}

const COMPUTER_USE_TOOL_ACTIONS: Record<string, string> = {
  request_access: "request_access",
  screenshot: "screenshot",
  zoom: "zoom",
  display_info: "display_info",
  switch_display: "switch_display",
  permissions: "permissions",
  cursor_position: "cursor_position",
  frontmost_app: "frontmost_app",
  app_under_point: "app_under_point",
  left_click: "click",
  double_click: "double_click",
  triple_click: "triple_click",
  right_click: "right_click",
  middle_click: "middle_click",
  mouse_move: "move",
  left_click_drag: "drag",
  scroll: "scroll",
  type: "type",
  key: "key",
  hold_key: "hold_key",
  left_mouse_down: "left_mouse_down",
  left_mouse_up: "left_mouse_up",
  open_application: "open_app",
  list_granted_applications: "list_granted_apps",
  list_running_applications: "list_running_apps",
  list_installed_applications: "list_installed_apps",
  read_clipboard: "read_clipboard",
  write_clipboard: "write_clipboard",
  wait: "wait",
  computer_batch: "batch",
  request_teach_access: "request_teach_access",
  teach_step: "teach_step",
  teach_batch: "teach_batch"
};

function hasRuntimeApiKey(runtime: ReturnType<typeof buildDesktopProvider>): boolean {
  if (runtime.providerName === "anthropic") {
    return Boolean(runtime.env.ANTHROPIC_AUTH_TOKEN);
  }
  return Boolean(runtime.env.OPENAI_API_KEY);
}

function hideEncodedImages(content: string): string {
  return content.replace(/<<MAGI_IMAGE:[\s\S]*?:MAGI_IMAGE>>/g, "[Screenshot provided to the vision model]");
}

function identityAnswer(text: string): string | undefined {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!normalized) {
    return undefined;
  }
  const asksIdentity = /(你是谁|你叫什么|怎么称呼你|我应该怎么称呼你|whatareyou|whoareyou|what'syourname|whatisyourname)/i.test(normalized);
  if (!asksIdentity) {
    return undefined;
  }
  return "我是 Kira，一个本地优先的 AI agent 桌面助手。你可以叫我 Kira。";
}
