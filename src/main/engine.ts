/**
 * Engine wrapper — bridges magi-next's runAgentQuery to Electron IPC.
 * Runs in the main process.
 */
import { BrowserWindow, dialog } from "electron";
import { runAgentQuery } from "../core/agent/query.ts";
import { MagiContentPart, textMessage } from "../core/providers/ir.ts";
import { McpServerConfig } from "../core/config.ts";
import { getMagiPaths, MagiPaths } from "../core/paths.ts";
import { SessionStore } from "../core/session-store.ts";
import { compactSession, recoverSessionContext } from "../core/context/compaction.ts";
import { buildLayeredContext } from "../core/context/layers.ts";
import { formatGoalContext, getGoal } from "../core/goal.ts";
import { buildSystemInstructions } from "../core/agent/system-prompt.ts";
import { getBuiltinToolDefinitions } from "../core/tools/registry.ts";
import { buildKiraWorkspaceEnv, defaultKiraWorkspaceRoot, ensureKiraWorkspace } from "../core/kira-workspace.ts";
import { buildDesktopProvider } from "./desktop-provider";

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
      const { systemPrompt } = buildLayeredContext({
        cwd: this._cwd,
        paths,
        systemInstructions: buildSystemInstructions({
          cwd: this._cwd,
          platform: process.platform,
          toolCount: getBuiltinToolDefinitions().filter((tool) => tool.name !== "Browser").length
        }),
        memoryContext: goalContext || undefined,
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
        outputRoot: ensureKiraWorkspace(this._kiraWorkspaceRoot).artifactsRoot,
        kiraWorkspaceRoot: this._kiraWorkspaceRoot,
        sessionId,
        signal: this.abortController.signal,
        permissionMode: "auto",
        approvalResolver: async ({ toolUse, reason }) => {
          let title = "Allow Kira to continue?";
          let message = "Kira wants to perform an action that needs approval.";
          let detail = reason;

          if (toolUse.name === "ComputerUse") {
            title = "Allow Kira to control the computer?";
            message = "Kira wants to perform a desktop action.";
            detail = [
              reason,
              "",
              `Action: ${String(toolUse.input.action ?? "")}`,
              toolUse.input.x !== undefined || toolUse.input.y !== undefined ? `Coordinates: (${toolUse.input.x ?? "?"}, ${toolUse.input.y ?? "?"})` : undefined,
              toolUse.input.text !== undefined ? `Text: ${String(toolUse.input.text).slice(0, 200)}` : undefined,
              Array.isArray(toolUse.input.keys) ? `Keys: ${toolUse.input.keys.join("+")}` : undefined,
              toolUse.input.key !== undefined ? `Key: ${String(toolUse.input.key)}` : undefined
            ].filter((line): line is string => Boolean(line)).join("\n");
          } else if (toolUse.name === "Bash") {
            title = "Allow Kira to run this command?";
            message = "Kira wants to run a command that may install software or change system state.";
            detail = [
              reason,
              "",
              `Command: ${String(toolUse.input.command ?? "").slice(0, 1000)}`
            ].join("\n");
          } else if (toolUse.name === "KillProcess") {
            title = "Allow Kira to close this process?";
            message = "Kira wants to terminate a running process.";
            detail = [
              reason,
              "",
              toolUse.input.pid !== undefined ? `PID: ${String(toolUse.input.pid)}` : undefined,
              toolUse.input.name !== undefined ? `Name: ${String(toolUse.input.name).slice(0, 300)}` : undefined,
              toolUse.input.signal !== undefined ? `Signal: ${String(toolUse.input.signal)}` : undefined
            ].filter((line): line is string => Boolean(line)).join("\n");
          } else {
            return false;
          }

          const result = await dialog.showMessageBox(this.win, {
            type: "warning",
            buttons: ["Allow", "Deny"],
            defaultId: 1,
            cancelId: 1,
            title,
            message,
            detail
          });
          return result.response === 0;
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
      this._running = false;
      this._sessionId = null;
      this.abortController = null;
      this.emit("engine:status", { running: false, sessionId: null });
    }
  }

  cancelQuery(): void {
    this.abortController?.abort();
    this.abortController = null;
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
}

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
