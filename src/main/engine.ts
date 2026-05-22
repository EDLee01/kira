/**
 * Engine wrapper — bridges magi-next's runAgentQuery to Electron IPC.
 * Runs in the main process.
 */
import { BrowserWindow } from "electron";
import { runAgentQuery } from "../core/agent/query.ts";
import { ProviderAdapter } from "../core/providers/ir.ts";
import { loadConfig, MagiConfig, McpServerConfig } from "../core/config.ts";
import { getMagiPaths, MagiPaths } from "../core/paths.ts";
import { MessagesCompatibleAdapter } from "../core/providers/messages-compatible.ts";
import { buildProviderRegistry } from "../core/providers/registry.ts";
import { SessionStore } from "../core/session-store.ts";
import { compactSession, recoverSessionContext } from "../core/context/compaction.ts";

export class Engine {
  private abortController: AbortController | null = null;
  private _running = false;
  private _sessionId: string | null = null;
  private _cwd: string = process.cwd();
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
      return;
    }

    this._running = true;
    this._sessionId = sessionId;
    this.abortController = new AbortController();

    try {
      const paths = getMagiPaths(process.env);
      const adapter = this.buildProvider(paths);

      // Load session messages from DB (user message already appended by ipc.ts)
      const session = this.store.getSession(sessionId);
      const rawMessages = session?.messages ?? [];

      // Auto-compact if context is too large (~4 chars/token, threshold 80k tokens)
      const totalChars = rawMessages.reduce((sum: number, m: any) => sum + (m.content?.length ?? 0), 0);
      const estimatedTokens = Math.ceil(totalChars / 4);
      const COMPACT_THRESHOLD = 80_000;

      if (estimatedTokens > COMPACT_THRESHOLD && rawMessages.length > 30) {
        try {
          const result = compactSession({
            store: this.store,
            sessionId,
            recentMessages: 20,
            maxSummaryChars: 6000,
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
        recentMessages: 20,
      });

      // Build messages: prepend summary if exists, then recent messages
      const messages: any[] = [];
      if (recovered.summary) {
        messages.push({
          role: "user",
          content: [{ type: "text", text: `[Context summary from earlier in this conversation]\n${recovered.summary.summary}` }],
        });
        messages.push({
          role: "assistant",
          content: [{ type: "text", text: "Understood. I have the context from our earlier conversation. Continuing." }],
        });
      }

      // Parse recent messages into MagiMessage format
      for (const m of recovered.recentMessages) {
        let content = m.content;
        if (typeof content === "string") {
          try { content = JSON.parse(content); } catch { content = [{ type: "text", text: content }]; }
        }
        if (!Array.isArray(content)) {
          content = [content];
        }
        messages.push({ role: m.role, content });
      }

      // Determine model — resolve "auto" to a real model name
      const rawModel = process.env["ANTHROPIC_MODEL"] ?? "claude-haiku-4-5";
      const model = rawModel === "auto"
        ? (process.env["ANTHROPIC_DEFAULT_SONNET_MODEL"] ?? "claude-sonnet-4-6")
        : rawModel;

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
        providerName: "anthropic",
        messages,
        cwd: this._cwd,
        env: process.env,
        stateRoot: paths.stateRoot,
        sessionId,
        signal: this.abortController.signal,
        permissionMode: "auto",
        mcp: mcpConfig,
        onStreamEvent: (ev) => {
          this.emit("engine:stream-event", ev);
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

  private buildProvider(paths: MagiPaths): ProviderAdapter {
    let config: MagiConfig | null = null;
    try {
      config = loadConfig(paths, process.env);
    } catch {}

    if (config && config.providers && Object.keys(config.providers).length > 0) {
      const registry = buildProviderRegistry({ config, env: process.env });
      const first = registry.values().next().value;
      if (first) return first;
    }

    const apiKey = process.env["ANTHROPIC_AUTH_TOKEN"];
    const baseUrl = process.env["ANTHROPIC_BASE_URL"] ?? "https://api.anthropic.com";
    const model = process.env["ANTHROPIC_MODEL"] ?? "claude-haiku-4-5";

    if (!apiKey) {
      throw new Error("No API key. Set ANTHROPIC_AUTH_TOKEN in your environment.");
    }

    return new MessagesCompatibleAdapter({
      name: "anthropic",
      config: {
        type: "messages-compatible",
        format: "anthropic-messages",
        baseUrl,
        apiKeyEnv: "ANTHROPIC_AUTH_TOKEN",
        defaultModel: model,
      },
      env: process.env,
    });
  }
}
