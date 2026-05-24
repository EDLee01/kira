import { useState, useCallback, useRef, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import kiraLogo from "./assets/kira-logo.svg";
import { MARKDOWN_SAMPLE } from "./markdown-sample";
import { cronToDisplay } from "./utils/cron-display";

interface DiscoveredModel {
  id: string;
  label: string;
  source: "discovered" | "fallback";
  capabilities: {
    role: "fast" | "main" | "deep";
    vision: boolean;
    longContext: boolean;
  };
}

interface AutoModelRoutes {
  fast: string;
  main: string;
  deep: string;
  vision: string;
  long: string;
}

interface SettingsState {
  provider?: "anthropic" | "openai" | "openai-compatible";
  baseUrl: string;
  apiKey: string;
  model: string;
  openAiEndpoint?: "chat" | "responses";
  theme: string;
  availableModels?: DiscoveredModel[];
  autoRoutes?: AutoModelRoutes;
  modelsUpdatedAt?: string;
  kiraWorkspaceRoot?: string;
  workspace?: string;
}

interface WorkspaceInfo {
  root: string;
  projectDir: string;
  projectsRoot: string;
  isProjectInsideWorkspace: boolean;
}

declare global {
  interface Window {
    desktopAPI: {
      sendMessage: (sessionId: string, text: string) => Promise<void>;
      cancelQuery: () => Promise<void>;
      handleGoal: (sessionId: string, text: string) => Promise<string>;
      createSession: (title?: string) => Promise<string>;
      listSessions: () => Promise<Array<{ id: string; title: string | null; createdAt: string }>>;
      deleteSession: (id: string) => Promise<void>;
      renameSession: (id: string, title: string) => Promise<void>;
      getSession: (id: string) => Promise<any>;
      getWorkspace: () => Promise<WorkspaceInfo>;
      pickKiraWorkspaceRoot: () => Promise<WorkspaceInfo | null>;
      pickWorkspace: () => Promise<WorkspaceInfo | null>;
      getSettings: () => Promise<SettingsState>;
      setSettings: (s: SettingsState) => Promise<SettingsState>;
      testConnection: (s: { provider?: string; baseUrl: string; apiKey: string; model: string; openAiEndpoint?: string }) => Promise<{ ok: boolean; message: string; discovery?: { models: DiscoveredModel[]; auto: AutoModelRoutes; updatedAt: string } }>;
      discoverModels: (s: { provider?: string; baseUrl: string; apiKey: string; model: string; openAiEndpoint?: string }) => Promise<{ ok: boolean; message: string; models: DiscoveredModel[]; auto: AutoModelRoutes; updatedAt: string }>;
      listScheduledTasks: () => Promise<any[]>;
      pauseTask: (id: string) => Promise<any>;
      resumeTask: (id: string) => Promise<any>;
      deleteScheduledTask: (id: string) => Promise<any>;
      getTaskHistory: (cronJobId?: string) => Promise<any[]>;
      getTaskResult: (taskId: string) => Promise<any>;
      onStreamEvent: (callback: (event: any) => void) => () => void;
      onEngineStatus: (callback: (status: any) => void) => () => void;
      onEngineError: (callback: (err: any) => void) => () => void;
      onTaskEvent: (callback: (event: any) => void) => () => void;
      openExternal: (url: string) => Promise<void>;
    };
  }
}

interface Msg {
  id: string;
  role: "user" | "assistant" | "tool" | "system";
  text: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
}

interface Session {
  id: string;
  title: string | null;
  createdAt: string;
}

let mid = 0;
const uid = () => `m_${++mid}`;
const DEFAULT_SESSION_TITLE = "Kira";

function displaySessionTitle(title: string | null | undefined, fallback = "Untitled"): string {
  if (!title) return fallback;
  return title.trim() === "Magi" ? DEFAULT_SESSION_TITLE : title;
}

function displayPathName(workspace: string | undefined, fallback = "Workspace"): string {
  const trimmed = (workspace ?? "").trim().replace(/[\\/]+$/, "");
  if (!trimmed) return fallback;
  const parts = trimmed.split(/[\\/]+/);
  return parts[parts.length - 1] || trimmed;
}

/** Extract display text from a parsed message content field */
function contentToText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((b: any) => b.type === "text")
      .map((b: any) => b.text)
      .join("");
  }
  if (content?.text) return content.text;
  return "";
}

function isSafeExternalUrl(url: string | undefined): url is string {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "http:" || parsed.protocol === "https:" || parsed.protocol === "mailto:";
  } catch {
    return false;
  }
}

function MessageMarkdown({ text, isError }: { text: string; isError?: boolean }) {
  const openExternal = useCallback((href: string | undefined) => {
    if (!isSafeExternalUrl(href)) return;
    void window.desktopAPI?.openExternal?.(href);
  }, []);

  return (
    <div className={`msg-text markdown-body ${isError ? "msg-error" : ""}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children }) => (
            <a
              href={isSafeExternalUrl(href) ? href : undefined}
              className="markdown-link"
              title={href}
              onClick={(event) => {
                event.preventDefault();
                openExternal(href);
              }}
            >
              {children}
            </a>
          ),
          pre: ({ children }) => <pre>{children}</pre>,
          code: ({ children, className }) => {
            const language = /language-([\w-]+)/.exec(className ?? "")?.[1];
            return (
              <code className={className} data-language={language}>
                {children}
              </code>
            );
          },
          table: ({ children }) => (
            <div className="markdown-table-wrap">
              <table>{children}</table>
            </div>
          ),
          input: ({ checked, type }) => (
            <input type={type} checked={Boolean(checked)} readOnly />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

export default function App() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [sid, setSid] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "tasks">("chat");
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [settings, setSettings] = useState<SettingsState>({ provider: "anthropic", baseUrl: "", apiKey: "", model: "", openAiEndpoint: "chat", theme: "dark" });
  const streamText = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const markdownSampleMode = new URLSearchParams(window.location.search).has("markdown-sample");

  // Load sessions
  const loadSessions = useCallback(async () => {
    try {
      const list = await window.desktopAPI.listSessions();
      setSessions(list ?? []);
    } catch {}
  }, []);

  // Init: load latest session or create one
  useEffect(() => {
    if (markdownSampleMode) return;

    (async () => {
      // Load workspace
      const info = await window.desktopAPI.getWorkspace();
      setWorkspace(info);

      // Load settings
      const s = await window.desktopAPI.getSettings();
      setSettings(s);
      document.documentElement.setAttribute("data-theme", s.theme || "dark");

      const list = await window.desktopAPI.listSessions();
      if (list && list.length > 0) {
        const latest = list[0]; // list is sorted by updated_at DESC
        setSid(latest.id);
        setSessions(list);
        try {
          const session = await window.desktopAPI.getSession(latest.id);
          if (session?.messages?.length) {
            setMsgs(session.messages.map((m: any) => ({
              id: uid(),
              role: m.role,
              text: contentToText(m.content),
              toolName: m.toolName,
              isError: m.isError,
            })));
          }
        } catch {}
      } else {
        const newId = await window.desktopAPI.createSession("Kira");
        setSid(newId);
      }
    })();
  }, [markdownSampleMode]);

  // Click outside to close history dropdown
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setShowHistory(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Engine events
  useEffect(() => {
    if (markdownSampleMode) return;

    const unsub = window.desktopAPI.onStreamEvent((ev) => {
      switch (ev.type) {
        case "text_delta":
          streamText.current += ev.text ?? "";
          setMsgs((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last?.role === "assistant") {
              copy[copy.length - 1] = { ...last, text: streamText.current };
            } else {
              copy.push({ id: uid(), role: "assistant", text: streamText.current });
            }
            return copy;
          });
          break;
        case "tool_use":
          // Reset streamText so next text segment starts fresh
          streamText.current = "";
          setMsgs((p) => [...p, {
            id: uid(), role: "tool",
            text: `Running ${ev.toolUse?.name ?? "tool"}…`,
            toolName: ev.toolUse?.name,
            toolCallId: ev.toolUse?.id,
          }]);
          break;
        case "tool_result":
          setMsgs((prev) => {
            const copy = [...prev];
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].toolCallId && copy[i].toolCallId === ev.toolCallId) {
                const c = (ev.content ?? "").slice(0, 300);
                copy[i] = { ...copy[i], text: c || "Done" };
                break;
              }
            }
            return copy;
          });
          break;
        case "done":
        case "cancelled":
          setRunning(false);
          streamText.current = "";
          loadSessions();
          break;
        case "error":
          setMsgs((p) => [...p, { id: uid(), role: "system", text: ev.error, isError: true }]);
          setRunning(false);
          streamText.current = "";
          break;
      }
    });
    const unsub2 = window.desktopAPI.onEngineError((err) => {
      setMsgs((p) => [...p, { id: uid(), role: "system", text: err.error ?? "Engine error", isError: true }]);
      setRunning(false);
    });
    const unsub3 = window.desktopAPI.onEngineStatus((status) => {
      setRunning(status.running);
    });
    return () => { unsub(); unsub2(); unsub3(); };
  }, [loadSessions, markdownSampleMode]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs]);

  // Switch session
  const switchSession = useCallback(async (id: string) => {
    if (running) return;
    setShowHistory(false);
    setSid(id);
    setMsgs([]);
    streamText.current = "";
    try {
      const session = await window.desktopAPI.getSession(id);
      if (session?.messages?.length) {
        setMsgs(session.messages.map((m: any) => ({
          id: uid(),
          role: m.role,
          text: contentToText(m.content),
          toolName: m.toolName,
          isError: m.isError,
        })));
      }
    } catch {}
  }, [running]);

  // New session
  const newSession = useCallback(async () => {
    if (running) return;
    setShowHistory(false);
    const newId = await window.desktopAPI.createSession(DEFAULT_SESSION_TITLE);
    setSid(newId);
    setMsgs([]);
    streamText.current = "";
    loadSessions();
  }, [running, loadSessions]);

  // Delete session
  const deleteSession = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    await window.desktopAPI.deleteSession(id);
    loadSessions();
    if (id === sid) {
      const newId = await window.desktopAPI.createSession(DEFAULT_SESSION_TITLE);
      setSid(newId);
      setMsgs([]);
      streamText.current = "";
    }
  }, [sid, loadSessions]);

  // Pick workspace
  const pickWorkspace = useCallback(async () => {
    const info = await window.desktopAPI.pickWorkspace();
    if (info) setWorkspace(info);
  }, []);

  // Save settings
  const saveSettings = useCallback(async (newSettings: SettingsState) => {
    await window.desktopAPI.setSettings(newSettings);
    setSettings(newSettings);
    document.documentElement.setAttribute("data-theme", newSettings.theme || "dark");
    setShowSettings(false);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || running) return;
    setInput("");
    inputRef.current!.style.height = "auto";
    setMsgs((p) => [...p, { id: uid(), role: "user", text }]);
    streamText.current = "";
    let id = sid;
    if (!id) {
      id = await window.desktopAPI.createSession("Kira");
      setSid(id);
    }
    if (/^\/goal(?:\s|$)/.test(text)) {
      try {
        const response = await window.desktopAPI.handleGoal(id, text);
        setMsgs((p) => [...p, { id: uid(), role: "assistant", text: response }]);
        loadSessions();
      } catch (error) {
        setMsgs((p) => [...p, {
          id: uid(),
          role: "system",
          text: error instanceof Error ? error.message : String(error),
          isError: true
        }]);
      }
      return;
    }
    setRunning(true);
    try {
      await window.desktopAPI.sendMessage(id, text);
    } catch (error) {
      setMsgs((p) => [...p, {
        id: uid(),
        role: "system",
        text: error instanceof Error ? error.message : String(error),
        isError: true
      }]);
      setRunning(false);
      streamText.current = "";
    }
  }, [input, running, sid, loadSessions]);

  const cancelCurrentQuery = useCallback(() => {
    if (!running) return;
    void window.desktopAPI.cancelQuery();
  }, [running]);

  useEffect(() => {
    if (!running) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      void window.desktopAPI.cancelQuery();
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [running]);

  const handleKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  const handleInput = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + "px";
  }, []);

  const currentTitle = displaySessionTitle(sessions.find((s) => s.id === sid)?.title, DEFAULT_SESSION_TITLE);
  const workspaceTitle = workspace
    ? `Kira Workspace: ${workspace.root}\nProject: ${workspace.projectDir}`
    : "Kira Workspace";

  return (
    <div className="app">
      {/* ── Titlebar ── */}
      <div className="titlebar">
        <div className="titlebar-left">
          <button className="history-btn" onClick={() => setShowHistory(!showHistory)} title="History">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <rect x="2" y="2" width="12" height="12" rx="2" stroke="currentColor" strokeWidth="1.3"/>
              <line x1="5" y1="6" x2="11" y2="6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
              <line x1="5" y1="9" x2="9" y2="9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </button>
          <span className="titlebar-name">{currentTitle}</span>
        </div>
        <div className="titlebar-status">
          <button className={`workspace-btn ${workspace && !workspace.isProjectInsideWorkspace ? "external" : ""}`} onClick={pickWorkspace} title={workspaceTitle}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 4.5V11a1 1 0 001 1h8a1 1 0 001-1V5.5a1 1 0 00-1-1H7L5.5 3H3a1 1 0 00-1 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="workspace-path">{displayPathName(workspace?.projectDir, "Project")}</span>
            {workspace && !workspace.isProjectInsideWorkspace && <span className="workspace-badge">external</span>}
          </button>
          <button className="settings-btn" onClick={() => setShowSettings(!showSettings)} title="Settings">
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none">
              <path d="M6.5 1.5h3l.4 1.7a5.5 5.5 0 011.3.7l1.6-.6 1.5 2.6-1.2 1.1a5.5 5.5 0 010 1.5l1.2 1.1-1.5 2.6-1.6-.6a5.5 5.5 0 01-1.3.7l-.4 1.7h-3l-.4-1.7a5.5 5.5 0 01-1.3-.7l-1.6.6-1.5-2.6 1.2-1.1a5.5 5.5 0 010-1.5L2.7 5.9l1.5-2.6 1.6.6a5.5 5.5 0 011.3-.7l.4-1.7z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
              <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2"/>
            </svg>
          </button>
          <span className={`status-dot ${running ? "active" : ""}`} />
          <span className="status-text">{running ? "Thinking" : "Ready"}</span>
        </div>
      </div>

      {/* ── History Dropdown ── */}
      {showHistory && (
        <div className="history-panel" ref={historyRef}>
          <button className="history-new" onClick={newSession}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line x1="7" y1="2" x2="7" y2="12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="2" y1="7" x2="12" y2="7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            New conversation
          </button>
          <div className="history-list">
            {sessions.length === 0 ? (
              <div className="history-empty">No conversations yet</div>
            ) : (
              sessions.map((s) => (
                <div
                  key={s.id}
                  className={`history-item ${s.id === sid ? "active" : ""}`}
                  onClick={() => switchSession(s.id)}
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none" className="history-item-icon">
                    <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.3"/>
                    <path d="M4 7l2 2 4-4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  <span className="history-item-title">{displaySessionTitle(s.title)}</span>
                  <button className="history-del" onClick={(e) => deleteSession(e, s.id)} title="Delete">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* ── Settings Panel ── */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          workspace={workspace}
          onWorkspaceChange={setWorkspace}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {activeTab === "chat" && (
      <>
      {/* ── Messages ── */}
      <div className="messages-wrap">
        {msgs.length === 0 ? (
          markdownSampleMode ? (
            <div className="messages">
              <div className="msg msg-assistant">
                <div className="avatar avatar-ai">
                  <img src={kiraLogo} alt="" aria-hidden="true" />
                </div>
                <div className="msg-body">
                  <MessageMarkdown text={MARKDOWN_SAMPLE} />
                </div>
              </div>
            </div>
          ) : (
            <div className="empty">
            <div className="empty-logo">
              <img src={kiraLogo} alt="Kira" />
            </div>
            <h2 className="empty-title">Kira</h2>
            <p className="empty-sub">你的全能 AI 搭子，随时待命</p>
            <div className="suggestions">
              {["打开浏览器访问指定网址", "搜索一下竞品信息", "帮我整理今天的工作"].map((s) => (
                <button key={s} className="suggestion" onClick={() => setInput(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
          )
        ) : (
          <div className="messages">
            {msgs.map((m) => (
              <div key={m.id} className={`msg msg-${m.role}`}>
                {m.role === "assistant" && (
                  <div className="avatar avatar-ai">
                    <img src={kiraLogo} alt="" aria-hidden="true" />
                  </div>
                )}
                <div className="msg-body">
                  {m.role === "tool" && <span className="tool-label">{m.toolName}</span>}
                  <MessageMarkdown text={m.text} isError={m.isError} />
                </div>
                {m.role === "user" && <div className="avatar avatar-user">You</div>}
              </div>
            ))}
            {running && msgs[msgs.length - 1]?.role !== "assistant" && (
              <div className="msg msg-assistant">
                <div className="avatar avatar-ai">
                  <img src={kiraLogo} alt="" aria-hidden="true" />
                </div>
                <div className="msg-body">
                  <div className="typing"><span/><span/><span/></div>
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {/* ── Input ── */}
      <div className="input-area">
        <div className={`input-box ${running ? "disabled" : ""}`}>
          <textarea
            ref={inputRef}
            className="input-field"
            placeholder="发消息给 Kira…"
            value={input}
            onChange={handleInput}
            onKeyDown={handleKey}
            disabled={running}
            rows={1}
          />
          <div className="input-actions">
            {running ? (
              <button className="btn-stop" onClick={cancelCurrentQuery} title="Stop">
                <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor">
                  <rect x="2" y="2" width="10" height="10" rx="1"/>
                </svg>
              </button>
            ) : (
              <button className="btn-send" onClick={send} disabled={!input.trim()} title="Send">
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M2 8h12M8 2l6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
            )}
          </div>
        </div>
        <p className="input-hint">Enter 发送 · Shift+Enter 换行</p>
        <p className="ai-disclaimer">Kira 可能会犯错，请核查重要信息；允许电脑操作前请确认。</p>
      </div>
      </>
      )}

      {activeTab === "tasks" && <TasksView />}

      {/* ── Tab Bar ── */}
      <div className="tab-bar">
        <button className={`tab-item ${activeTab === "chat" ? "active" : ""}`} onClick={() => setActiveTab("chat")}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <path d="M3 4a2 2 0 012-2h8a2 2 0 012 2v7a2 2 0 01-2 2H7l-3 3v-3a2 2 0 01-1-1.7V4z" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Chat</span>
        </button>
        <button className={`tab-item ${activeTab === "tasks" ? "active" : ""}`} onClick={() => setActiveTab("tasks")}>
          <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1.3"/>
            <path d="M9 5v4l3 2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          <span>Tasks</span>
        </button>
      </div>
    </div>
  );
}

/** Settings Panel */
function SettingsPanel({ settings, workspace, onWorkspaceChange, onSave, onClose }: {
  settings: SettingsState;
  workspace: WorkspaceInfo | null;
  onWorkspaceChange: (workspace: WorkspaceInfo) => void;
  onSave: (s: SettingsState) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(settings);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [refreshingModels, setRefreshingModels] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [remote, setRemote] = useState<{ running: boolean; publicUrl: string | null; accessUrl: string | null; token: string | null; clients: number; qrSvg: string | null }>({ running: false, publicUrl: null, accessUrl: null, token: null, clients: 0, qrSvg: null });
  const [remoteLoading, setRemoteLoading] = useState(false);
  const provider = form.provider ?? "anthropic";
  const availableModels = form.availableModels ?? [];
  const selectedModelExists = form.model === "auto" || availableModels.some((model) => model.id === form.model);
  const showCustomModelInput = Boolean(form.model && !selectedModelExists);
  const baseUrlPlaceholder = provider === "anthropic"
    ? "https://api.anthropic.com"
    : provider === "openai"
      ? "https://api.openai.com/v1"
      : "https://your-provider.example.com/v1";
  const modelPlaceholder = provider === "anthropic" ? "claude-sonnet-4-6" : "gpt-4.1-mini";

  const pickRoot = async () => {
    const info = await window.desktopAPI.pickKiraWorkspaceRoot();
    if (!info) return;
    onWorkspaceChange(info);
    setForm((current) => ({
      ...current,
      kiraWorkspaceRoot: info.root,
      workspace: info.projectDir,
    }));
  };

  const pickProject = async () => {
    const info = await window.desktopAPI.pickWorkspace();
    if (!info) return;
    onWorkspaceChange(info);
    setForm((current) => ({
      ...current,
      kiraWorkspaceRoot: info.root,
      workspace: info.projectDir,
    }));
  };

  useEffect(() => {
    (window.desktopAPI as any).getRemoteStatus?.().then((s: any) => s && setRemote(s));
  }, []);

  const changeProvider = (nextProvider: SettingsState["provider"]) => {
    const nextBaseUrl = nextProvider === "anthropic"
      ? "https://api.anthropic.com"
      : "https://api.openai.com/v1";
    const nextModel = nextProvider === "anthropic" ? "claude-haiku-4-5" : "gpt-4.1-mini";
    setForm({
      ...form,
      provider: nextProvider,
      baseUrl: nextBaseUrl,
      model: nextModel,
      openAiEndpoint: nextProvider === "anthropic" ? form.openAiEndpoint : "chat",
      availableModels: undefined,
      autoRoutes: undefined,
      modelsUpdatedAt: undefined,
    });
    setTestResult(null);
  };

  const testConn = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await window.desktopAPI.testConnection(form);
    if (result.discovery) {
      setForm((current) => ({
        ...current,
        availableModels: result.discovery!.models,
        autoRoutes: result.discovery!.auto,
        modelsUpdatedAt: result.discovery!.updatedAt,
      }));
    }
    setTestResult(result);
    setTesting(false);
  };

  const refreshModels = async () => {
    setRefreshingModels(true);
    setTestResult(null);
    const result = await window.desktopAPI.discoverModels(form);
    setForm((current) => ({
      ...current,
      availableModels: result.models,
      autoRoutes: result.auto,
      modelsUpdatedAt: result.updatedAt,
    }));
    setTestResult({ ok: result.ok, message: result.message });
    setRefreshingModels(false);
  };

  const toggleRemote = async () => {
    setRemoteLoading(true);
    if (remote.running) {
      await (window.desktopAPI as any).stopRemote();
      setRemote({ running: false, publicUrl: null, accessUrl: null, token: null, clients: 0, qrSvg: null });
    } else {
      const result = await (window.desktopAPI as any).startRemote();
      if (result.error) {
        setTestResult({ ok: false, message: result.error });
      } else {
        setRemote({ running: true, publicUrl: result.publicUrl, accessUrl: result.accessUrl, token: result.token, clients: 0, qrSvg: result.qrSvg });
      }
    }
    setRemoteLoading(false);
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3>Settings</h3>
          <button className="settings-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <line x1="3" y1="3" x2="11" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              <line x1="11" y1="3" x2="3" y2="11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
          </button>
        </div>

        <div className="settings-body">
          <label className="settings-label">
            <span>Theme</span>
            <div className="settings-theme-row">
              <button
                className={`theme-btn ${form.theme === "dark" ? "active" : ""}`}
                onClick={() => setForm({ ...form, theme: "dark" })}
              >Dark</button>
              <button
                className={`theme-btn ${form.theme === "light" ? "active" : ""}`}
                onClick={() => setForm({ ...form, theme: "light" })}
              >Light</button>
            </div>
          </label>

          <div className="settings-section compact">
            <div className="settings-section-header">
              <span>Kira Workspace</span>
            </div>
            <div className="workspace-settings-grid">
              <div>
                <b>Workspace Root</b>
                <code title={workspace?.root || form.kiraWorkspaceRoot}>{workspace?.root || form.kiraWorkspaceRoot || "Not set"}</code>
                <button className="settings-mini-btn" onClick={pickRoot}>Choose Root</button>
              </div>
              <div>
                <b>Project Directory</b>
                <code title={workspace?.projectDir || form.workspace}>{workspace?.projectDir || form.workspace || "Not set"}</code>
                <button className="settings-mini-btn" onClick={pickProject}>Choose Project</button>
              </div>
            </div>
            {workspace && !workspace.isProjectInsideWorkspace && (
              <span className="settings-note">This is an external project. Runtime assets, installs, downloads, logs, and backups stay in Kira Workspace.</span>
            )}
            {workspace?.isProjectInsideWorkspace && (
              <span className="settings-note">New projects are recommended under Kira Workspace/projects. Runtime assets stay outside the project folder.</span>
            )}
          </div>

          <label className="settings-label">
            <span>Provider</span>
            <select
              className="settings-input settings-select"
              value={provider}
              onChange={(e) => changeProvider(e.target.value as SettingsState["provider"])}
            >
              <option value="anthropic">Anthropic / Claude</option>
              <option value="openai">OpenAI</option>
              <option value="openai-compatible">OpenAI-compatible</option>
            </select>
          </label>

          <label className="settings-label">
            <span>API Base URL</span>
            <input
              className="settings-input"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder={baseUrlPlaceholder}
            />
            {provider === "openai-compatible" && (
              <span className="settings-note">Use the third-party provider's OpenAI-compatible /v1 endpoint.</span>
            )}
          </label>

          <label className="settings-label">
            <span>API Key</span>
            <div className="settings-key-row">
              <input
                className="settings-input"
                type={showKey ? "text" : "password"}
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."}
              />
              <button className="settings-eye" onClick={() => setShowKey(!showKey)}>
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          {provider !== "anthropic" && (
            <label className="settings-label">
              <span>OpenAI Endpoint</span>
              <select
                className="settings-input settings-select"
                value={form.openAiEndpoint || "chat"}
                onChange={(e) => setForm({ ...form, openAiEndpoint: e.target.value as SettingsState["openAiEndpoint"] })}
              >
                <option value="chat">Chat Completions</option>
                <option value="responses">Responses</option>
              </select>
            </label>
          )}

          <label className="settings-label">
            <span>Model</span>
            <select
              className="settings-input settings-select"
              value={showCustomModelInput ? "__custom__" : form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value === "__custom__" ? "" : e.target.value })}
            >
              <option value="auto">Auto (dynamic)</option>
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label} {model.source === "fallback" ? "(default)" : ""}
                </option>
              ))}
              <option value="__custom__">Custom model...</option>
            </select>
            <div className="model-actions">
              <button className="settings-mini-btn" onClick={refreshModels} disabled={refreshingModels || !form.apiKey}>
                {refreshingModels ? "Refreshing..." : "Refresh Models"}
              </button>
              {form.modelsUpdatedAt && (
                <span className="model-updated">Updated {new Date(form.modelsUpdatedAt).toLocaleString()}</span>
              )}
            </div>
            {(showCustomModelInput || form.model === "") && (
              <input
                className="settings-input"
                value={form.model}
                onChange={(e) => setForm({ ...form, model: e.target.value })}
                placeholder={modelPlaceholder}
              />
            )}
            {form.model === "auto" && form.autoRoutes && (
              <div className="auto-routes">
                <div><span>Fast</span><b>{form.autoRoutes.fast}</b></div>
                <div><span>Main</span><b>{form.autoRoutes.main}</b></div>
                <div><span>Deep</span><b>{form.autoRoutes.deep}</b></div>
                <div><span>Vision</span><b>{form.autoRoutes.vision}</b></div>
              </div>
            )}
          </label>
        </div>

        {/* MCP Servers */}
        <McpSection />

        {/* Remote Access */}
        <div className="settings-section">
          <div className="settings-section-header">
            <span>Remote Access</span>
            <button className={`remote-toggle ${remote.running ? "active" : ""}`} onClick={toggleRemote} disabled={remoteLoading}>
              {remoteLoading ? "..." : remote.running ? "ON" : "OFF"}
            </button>
          </div>
          {remote.running && remote.accessUrl && (
            <div className="remote-info">
              <div className="remote-qr" dangerouslySetInnerHTML={{ __html: remote.qrSvg || "" }} />
              <p className="remote-url">{remote.accessUrl}</p>
              <p className="remote-hint">{remote.publicUrl ? "公网可访问" : "仅局域网（手机需在同一 WiFi）"}</p>
            </div>
          )}
          {remote.running && !remote.accessUrl && (
            <p className="remote-hint">启动中...</p>
          )}
        </div>

        {testResult && (
          <div className={`test-result ${testResult.ok ? "test-ok" : "test-fail"}`}>
            {testResult.ok ? "✓ " : "✗ "}{testResult.message}
          </div>
        )}

        <div className="settings-footer">
          <button className="settings-test" onClick={testConn} disabled={testing || !form.apiKey}>
            {testing ? "Testing..." : "Test Connection"}
          </button>
          <button className="settings-save" onClick={() => onSave(form)}>Save</button>
        </div>
      </div>
    </div>
  );
}

/** Tasks View */
function TasksView() {
  const [tasks, setTasks] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const t = await window.desktopAPI.listScheduledTasks();
    setTasks(t);
    const h = await window.desktopAPI.getTaskHistory();
    setHistory(h);
  }, []);

  useEffect(() => {
    load();
    const unsub = window.desktopAPI.onTaskEvent(() => load());
    return unsub;
  }, [load]);

  const toggle = async (task: any) => {
    if (task.enabled) {
      await window.desktopAPI.pauseTask(task.id);
    } else {
      await window.desktopAPI.resumeTask(task.id);
    }
    load();
  };

  const remove = async (id: string) => {
    await window.desktopAPI.deleteScheduledTask(id);
    load();
  };

  const taskHistory = (cronJobId: string) =>
    history.filter((h: any) => h.metadata?.cronJobId === cronJobId);

  return (
    <div className="tasks-view">
      {tasks.length === 0 ? (
        <div className="tasks-empty">
          <svg width="40" height="40" viewBox="0 0 18 18" fill="none">
            <circle cx="9" cy="9" r="7" stroke="currentColor" strokeWidth="1"/>
            <path d="M9 5v4l3 2" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
          </svg>
          <p>还没有定时任务</p>
          <p className="tasks-empty-hint">在对话中告诉 AI 你想定时做什么，它会自动创建</p>
        </div>
      ) : (
        <div className="tasks-list">
          {tasks.map((task) => (
            <div key={task.id} className="task-card">
              <div className="task-header" onClick={() => setExpandedId(expandedId === task.id ? null : task.id)}>
                <div className="task-info">
                  <span className={`task-status ${task.enabled ? "enabled" : "paused"}`} />
                  <div className="task-meta">
                    <span className="task-prompt">{task.prompt.slice(0, 50)}</span>
                    <span className="task-schedule">{cronToDisplay(task.cron)}</span>
                  </div>
                </div>
                <div className="task-actions">
                  <button className="task-toggle" onClick={(e) => { e.stopPropagation(); toggle(task); }}>
                    {task.enabled ? "Pause" : "Resume"}
                  </button>
                  <button className="task-del" onClick={(e) => { e.stopPropagation(); remove(task.id); }}>
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                      <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
                    </svg>
                  </button>
                </div>
              </div>
              {expandedId === task.id && (
                <div className="task-history">
                  {taskHistory(task.id).length === 0 ? (
                    <p className="task-history-empty">尚未执行过</p>
                  ) : (
                    taskHistory(task.id).slice(0, 5).map((h: any) => (
                      <div key={h.id} className="task-run">
                        <span className={`task-run-status ${h.status}`}>{h.status}</span>
                        <span className="task-run-time">{new Date(h.updatedAt).toLocaleString("zh-CN")}</span>
                        <p className="task-run-result">{(h.result ?? "").slice(0, 100)}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** MCP Servers Section */
function McpSection() {
  const [servers, setServers] = useState<Record<string, any>>({});
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newCmd, setNewCmd] = useState("");

  useEffect(() => {
    (window.desktopAPI as any).listMcpServers?.().then((s: any) => s && setServers(s));
  }, []);

  const add = async () => {
    if (!newName.trim() || !newCmd.trim()) return;
    const parts = newCmd.trim().split(/\s+/);
    const command = parts[0];
    const args = parts.slice(1);
    const result = await (window.desktopAPI as any).addMcpServer(newName.trim(), { command, args });
    setServers(result);
    setNewName("");
    setNewCmd("");
    setAdding(false);
  };

  const remove = async (name: string) => {
    const result = await (window.desktopAPI as any).removeMcpServer(name);
    setServers(result);
  };

  const names = Object.keys(servers);

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <span>MCP Servers</span>
        <button className="remote-toggle" onClick={() => setAdding(!adding)}>
          {adding ? "Cancel" : "+ Add"}
        </button>
      </div>
      {adding && (
        <div className="mcp-add-form">
          <input className="settings-input" placeholder="Server name (e.g. notion)" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input className="settings-input" placeholder="Command (e.g. npx @notionhq/mcp-server)" value={newCmd} onChange={(e) => setNewCmd(e.target.value)} />
          <button className="settings-save" style={{ width: "100%" }} onClick={add}>Add Server</button>
        </div>
      )}
      {names.length === 0 && !adding && (
        <p className="remote-hint">No MCP servers configured</p>
      )}
      {names.map((name) => (
        <div key={name} className="mcp-server-item">
          <div className="mcp-server-info">
            <span className="mcp-server-name">{name}</span>
            <span className="mcp-server-cmd">{servers[name].command} {(servers[name].args || []).join(" ")}</span>
          </div>
          <button className="task-del" onClick={() => remove(name)}>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <line x1="2" y1="2" x2="10" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
              <line x1="10" y1="2" x2="2" y2="10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
