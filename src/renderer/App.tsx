import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, KeyboardEvent, MouseEvent } from "react";
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
  computerUseDeniedBundleIds?: string;
}

interface WorkspaceInfo {
  root: string;
  projectDir: string;
  projectsRoot: string;
  isProjectInsideWorkspace: boolean;
}

interface TrustStatus {
  platform: string;
  arch: string;
  model: {
    provider: string;
    configured: boolean;
    model: string;
  };
  workspace: WorkspaceInfo;
  permissions: {
    screen: "granted" | "denied" | "restricted" | "not-determined" | "unknown" | "unsupported";
    accessibility: "granted" | "denied" | "unsupported";
  };
  browserAutomation: {
    playwrightEnabled: boolean;
    message: string;
  };
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
      getTrustStatus: () => Promise<TrustStatus>;
      openPermissionSettings: (pane: "screen" | "accessibility") => Promise<void>;
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

type ActiveView = "chat" | "tasks" | "workspace";
type SettingsSection = "model" | "workspace" | "computer-use" | "remote" | "appearance" | "advanced";
type IconName =
  | "activity"
  | "attach"
  | "chat"
  | "check"
  | "close"
  | "computer"
  | "folder"
  | "gear"
  | "history"
  | "memory"
  | "network"
  | "plus"
  | "remote"
  | "send"
  | "shield"
  | "spark"
  | "stop"
  | "tasks"
  | "tools"
  | "trash"
  | "warning";

let mid = 0;
const uid = () => `m_${++mid}`;
const DEFAULT_SESSION_TITLE = "Kira";
const DISCLAIMER = "Kira may make mistakes. Review important information and confirm actions before allowing computer control.";

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

function trustTone(ok: boolean | undefined): "ok" | "warn" | "muted" {
  if (ok === true) return "ok";
  if (ok === false) return "warn";
  return "muted";
}

function permissionOk(value: string | undefined): boolean | undefined {
  if (!value || value === "unsupported") return undefined;
  return value === "granted";
}

function permissionLabel(value: string | undefined): string {
  switch (value) {
    case "granted": return "Ready";
    case "denied": return "Needs permission";
    case "restricted": return "Restricted";
    case "not-determined": return "Needs permission";
    case "unsupported": return "Unsupported";
    default: return "Needs review";
  }
}

function providerText(settings: SettingsState, trustStatus: TrustStatus | null): string {
  const provider = settings.provider ?? trustStatus?.model.provider ?? "provider";
  const model = settings.model || trustStatus?.model.model || "not configured";
  return `${provider} / ${model}`;
}

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

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  const common = {
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  const paths: Record<IconName, React.ReactNode> = {
    activity: <path d="M3 9h3l2-5 3 10 2-5h2" {...common} />,
    attach: <path d="M13 8.5 8.4 13.1a3 3 0 0 1-4.2-4.2l5.2-5.2a2 2 0 0 1 2.8 2.8L7 11.7a1 1 0 0 1-1.4-1.4l4.5-4.5" {...common} />,
    chat: <path d="M3.5 4.5A2.5 2.5 0 0 1 6 2h4a2.5 2.5 0 0 1 2.5 2.5v3A2.5 2.5 0 0 1 10 10H7l-3.5 3.5V4.5Z" {...common} />,
    check: <path d="m3.5 8.2 3 3L12.5 5" {...common} />,
    close: <><path d="M4 4l8 8" {...common} /><path d="M12 4l-8 8" {...common} /></>,
    computer: <><rect x="2.5" y="3" width="11" height="8" rx="1.5" {...common} /><path d="M6 13h4" {...common} /></>,
    folder: <path d="M2.5 5.2V12a1.5 1.5 0 0 0 1.5 1.5h8a1.5 1.5 0 0 0 1.5-1.5V6.5A1.5 1.5 0 0 0 12 5H8.2L6.7 3.5H4A1.5 1.5 0 0 0 2.5 5.2Z" {...common} />,
    gear: <><path d="M6.7 2h2.6l.4 1.6c.4.1.8.3 1.1.5l1.5-.6 1.3 2.3-1.2 1.1a5 5 0 0 1 0 1.2l1.2 1.1-1.3 2.3-1.5-.6c-.3.2-.7.4-1.1.5L9.3 14H6.7l-.4-1.6c-.4-.1-.8-.3-1.1-.5l-1.5.6-1.3-2.3 1.2-1.1a5 5 0 0 1 0-1.2L2.4 6.8l1.3-2.3 1.5.6c.3-.2.7-.4 1.1-.5L6.7 2Z" {...common} /><circle cx="8" cy="8" r="2" {...common} /></>,
    history: <><path d="M3 8a5 5 0 1 0 1.5-3.6" {...common} /><path d="M3 3.5v3h3" {...common} /><path d="M8 5.5V8l1.8 1.1" {...common} /></>,
    memory: <><rect x="3" y="3" width="10" height="10" rx="2" {...common} /><path d="M6 3v10M10 3v10M3 6h10M3 10h10" {...common} /></>,
    network: <><circle cx="4" cy="8" r="1.5" {...common} /><circle cx="12" cy="4" r="1.5" {...common} /><circle cx="12" cy="12" r="1.5" {...common} /><path d="M5.4 7.2 10.6 4.8M5.4 8.8l5.2 2.4" {...common} /></>,
    plus: <><path d="M8 3v10" {...common} /><path d="M3 8h10" {...common} /></>,
    remote: <><rect x="3" y="2.5" width="10" height="11" rx="2" {...common} /><path d="M7 11h2M6 5.5h4" {...common} /></>,
    send: <path d="M2.5 8h10M8.5 4l4 4-4 4" {...common} />,
    shield: <path d="M8 2.5 13 4v3.8c0 3-1.9 5.1-5 6.2-3.1-1.1-5-3.2-5-6.2V4l5-1.5Z" {...common} />,
    spark: <path d="M8 2.5 9.4 6.6 13.5 8l-4.1 1.4L8 13.5 6.6 9.4 2.5 8l4.1-1.4L8 2.5Z" {...common} />,
    stop: <rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor" />,
    tasks: <><path d="M5 4h8M5 8h8M5 12h8" {...common} /><path d="M2.8 4h.1M2.8 8h.1M2.8 12h.1" {...common} /></>,
    tools: <path d="m9.8 3.2 3 3L6.2 12.8H3.2v-3L9.8 3.2Z" {...common} />,
    trash: <><path d="M3 4.5h10" {...common} /><path d="M6 4.5V3h4v1.5M5 6.5l.4 6h5.2l.4-6" {...common} /></>,
    warning: <><path d="M8 3 14 13H2L8 3Z" {...common} /><path d="M8 6.5v3M8 11.8h.1" {...common} /></>,
  };
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  );
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
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialSection, setSettingsInitialSection] = useState<SettingsSection>("model");
  const [activeTab, setActiveTab] = useState<ActiveView>("chat");
  const [workspace, setWorkspace] = useState<WorkspaceInfo | null>(null);
  const [settings, setSettings] = useState<SettingsState>({ provider: "anthropic", baseUrl: "", apiKey: "", model: "", openAiEndpoint: "chat", theme: "dark" });
  const [trustStatus, setTrustStatus] = useState<TrustStatus | null>(null);
  const streamText = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const markdownSampleMode = new URLSearchParams(window.location.search).has("markdown-sample");

  const loadSessions = useCallback(async () => {
    try {
      const list = await window.desktopAPI.listSessions();
      setSessions(list ?? []);
    } catch {}
  }, []);

  const loadTrustStatus = useCallback(async () => {
    try {
      const status = await window.desktopAPI.getTrustStatus();
      setTrustStatus(status);
      setWorkspace(status.workspace);
    } catch {}
  }, []);

  useEffect(() => {
    if (markdownSampleMode) return;

    (async () => {
      const info = await window.desktopAPI.getWorkspace();
      setWorkspace(info);

      const s = await window.desktopAPI.getSettings();
      setSettings(s);
      document.documentElement.setAttribute("data-theme", s.theme || "dark");
      await loadTrustStatus();

      const list = await window.desktopAPI.listSessions();
      if (list && list.length > 0) {
        const latest = list[0];
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
        const newId = await window.desktopAPI.createSession(DEFAULT_SESSION_TITLE);
        setSid(newId);
      }
    })();
  }, [loadTrustStatus, markdownSampleMode]);

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
          streamText.current = "";
          setMsgs((p) => [...p, {
            id: uid(),
            role: "tool",
            text: `Running ${ev.toolUse?.name ?? "tool"}...`,
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

  const switchSession = useCallback(async (id: string) => {
    if (running) return;
    setSid(id);
    setActiveTab("chat");
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

  const newSession = useCallback(async () => {
    if (running) return;
    const newId = await window.desktopAPI.createSession(DEFAULT_SESSION_TITLE);
    setSid(newId);
    setActiveTab("chat");
    setMsgs([]);
    streamText.current = "";
    loadSessions();
  }, [running, loadSessions]);

  const deleteSession = useCallback(async (e: MouseEvent, id: string) => {
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

  const pickWorkspace = useCallback(async () => {
    const info = await window.desktopAPI.pickWorkspace();
    if (info) {
      setWorkspace(info);
      void loadTrustStatus();
    }
  }, [loadTrustStatus]);

  const saveSettings = useCallback(async (newSettings: SettingsState) => {
    await window.desktopAPI.setSettings(newSettings);
    setSettings(newSettings);
    document.documentElement.setAttribute("data-theme", newSettings.theme || "dark");
    await loadTrustStatus();
    setShowSettings(false);
  }, [loadTrustStatus]);

  const openSettings = useCallback((section: SettingsSection = "model") => {
    setSettingsInitialSection(section);
    setShowSettings(true);
  }, []);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || running) return;
    setInput("");
    if (inputRef.current) inputRef.current.style.height = "auto";
    setMsgs((p) => [...p, { id: uid(), role: "user", text }]);
    streamText.current = "";
    let id = sid;
    if (!id) {
      id = await window.desktopAPI.createSession(DEFAULT_SESSION_TITLE);
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
          isError: true,
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
        isError: true,
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
    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      void window.desktopAPI.cancelQuery();
    };
    window.addEventListener("keydown", handleEscape, true);
    return () => window.removeEventListener("keydown", handleEscape, true);
  }, [running]);

  const handleKey = useCallback((e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }, [send]);

  const handleInput = useCallback((e: ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 168) + "px";
  }, []);

  const clearVisibleMessages = useCallback(() => {
    if (running) return;
    setMsgs([]);
    streamText.current = "";
  }, [running]);

  const currentTitle = displaySessionTitle(sessions.find((s) => s.id === sid)?.title, DEFAULT_SESSION_TITLE);
  const workspaceTitle = workspace
    ? `Kira Workspace: ${workspace.root}\nProject: ${workspace.projectDir}`
    : "Kira Workspace";
  const recentSessions = sessions.slice(0, 8);
  const recentActivity = useMemo(() => (
    msgs
      .filter((m) => m.role === "tool" || m.role === "system")
      .slice(-6)
      .reverse()
  ), [msgs]);
  const computerUseReady = permissionOk(trustStatus?.permissions.screen) === true && permissionOk(trustStatus?.permissions.accessibility) === true;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <img src={kiraLogo} alt="Kira" />
          <div>
            <strong>Kira</strong>
            <span>Local Agent</span>
          </div>
        </div>

        <button className="primary-action" onClick={newSession} disabled={running}>
          <Icon name="plus" />
          <span>New Chat</span>
        </button>

        <nav className="side-nav" aria-label="Main navigation">
          <button className={activeTab === "chat" ? "active" : ""} onClick={() => setActiveTab("chat")}>
            <Icon name="chat" />
            <span>Chat</span>
          </button>
          <button className={activeTab === "tasks" ? "active" : ""} onClick={() => setActiveTab("tasks")}>
            <Icon name="tasks" />
            <span>Tasks</span>
          </button>
          <button className={activeTab === "workspace" ? "active" : ""} onClick={() => setActiveTab("workspace")}>
            <Icon name="folder" />
            <span>Workspace</span>
          </button>
          <button className={showSettings ? "active" : ""} onClick={() => openSettings("model")}>
            <Icon name="gear" />
            <span>Settings</span>
          </button>
        </nav>

        <section className="recent-sessions">
          <div className="section-kicker">Recent Sessions</div>
          {recentSessions.length === 0 ? (
            <p className="empty-note">No conversations yet</p>
          ) : (
            recentSessions.map((session) => (
              <div
                key={session.id}
                className={`session-row ${session.id === sid ? "active" : ""}`}
                role="button"
                tabIndex={0}
                onClick={() => switchSession(session.id)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  event.preventDefault();
                  switchSession(session.id);
                }}
              >
                <span>{displaySessionTitle(session.title)}</span>
                <button className="session-delete" onClick={(e) => deleteSession(e, session.id)} title="Delete session">
                  <Icon name="trash" size={13} />
                </button>
              </div>
            ))
          )}
        </section>

        <div className="sidebar-footer">
          <button onClick={() => openSettings("remote")}>
            <Icon name="remote" />
            <span>Remote</span>
          </button>
          <button onClick={() => openSettings("computer-use")}>
            <Icon name="shield" />
            <span>Status</span>
          </button>
          <button className="workspace-chip" onClick={pickWorkspace} title={workspaceTitle}>
            <Icon name="folder" />
            <span>{displayPathName(workspace?.projectDir, "Workspace")}</span>
          </button>
        </div>
      </aside>

      <main className="workbench-main">
        <header className="appbar">
          <div className="appbar-title">
            <span className={`status-dot ${running ? "active" : ""}`} />
            <div>
              <h1>{activeTab === "tasks" ? "Scheduled Tasks" : activeTab === "workspace" ? "Workspace" : currentTitle}</h1>
              <p>{providerText(settings, trustStatus)}</p>
            </div>
          </div>
          <div className="appbar-actions">
            {running ? (
              <button className="toolbar-button danger" onClick={cancelCurrentQuery} title="Stops the current request">
                <Icon name="stop" />
                <span>Stop</span>
              </button>
            ) : (
              <button className="toolbar-button" onClick={clearVisibleMessages} disabled={msgs.length === 0 || activeTab !== "chat"}>
                <Icon name="close" />
                <span>Clear</span>
              </button>
            )}
            <button className="toolbar-button" onClick={() => openSettings("model")}>
              <Icon name="gear" />
              <span>Settings</span>
            </button>
          </div>
        </header>

        <TrustStatusBar
          settings={settings}
          trustStatus={trustStatus}
          workspace={workspace}
          onOpenSettings={openSettings}
          onRefresh={loadTrustStatus}
        />

        {activeTab === "chat" && (
          <section className="chat-shell">
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
                  <ChatEmpty onPrompt={setInput} onSetup={() => openSettings("model")} needsSetup={Boolean(trustStatus && !trustStatus.model.configured)} />
                )
              ) : (
                <div className="messages">
                  {msgs.map((m) => (
                    <MessageRow key={m.id} message={m} />
                  ))}
                  {running && msgs[msgs.length - 1]?.role !== "assistant" && (
                    <div className="msg msg-assistant">
                      <div className="avatar avatar-ai">
                        <img src={kiraLogo} alt="" aria-hidden="true" />
                      </div>
                      <div className="msg-body">
                        <div className="typing"><span /><span /><span /></div>
                      </div>
                    </div>
                  )}
                  <div ref={bottomRef} />
                </div>
              )}
            </div>

            <div className="input-area">
              <div className={`input-box ${running ? "disabled" : ""}`}>
                <textarea
                  ref={inputRef}
                  className="input-field"
                  placeholder="Message Kira..."
                  value={input}
                  onChange={handleInput}
                  onKeyDown={handleKey}
                  disabled={running}
                  rows={1}
                />
                <div className="input-footer-row">
                  <div className="input-tools">
                    <button type="button" className="input-tool model-switch" title="Switch model" onClick={() => openSettings("model")}>
                      <Icon name="spark" />
                      <span>{settings.model || "Model"}</span>
                    </button>
                    <button type="button" className={`input-tool ${computerUseReady ? "ready" : ""}`} title="Computer Use" onClick={() => openSettings("computer-use")}>
                      <Icon name="computer" />
                      <span>Computer Use</span>
                    </button>
                  </div>
                  {running ? (
                    <button className="btn-stop" onClick={cancelCurrentQuery} title="Stops the current request (Esc)">
                      <Icon name="stop" />
                    </button>
                  ) : (
                    <button className="btn-send" onClick={send} disabled={!input.trim()} title="Send">
                      <Icon name="send" />
                    </button>
                  )}
                </div>
              </div>
              <p className="ai-disclaimer">{DISCLAIMER}</p>
            </div>
          </section>
        )}

        {activeTab === "tasks" && <TasksView />}
        {activeTab === "workspace" && (
          <WorkspaceView
            workspace={workspace}
            trustStatus={trustStatus}
            onPickWorkspace={pickWorkspace}
            onOpenSettings={() => openSettings("workspace")}
          />
        )}
      </main>

      <Inspector
        running={running}
        workspace={workspace}
        trustStatus={trustStatus}
        recentActivity={recentActivity}
        onOpenSettings={openSettings}
      />

      {showSettings && (
        <SettingsPanel
          initialSection={settingsInitialSection}
          settings={settings}
          workspace={workspace}
          trustStatus={trustStatus}
          onWorkspaceChange={setWorkspace}
          onTrustRefresh={loadTrustStatus}
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}

function TrustStatusBar({ settings, trustStatus, workspace, onOpenSettings, onRefresh }: {
  settings: SettingsState;
  trustStatus: TrustStatus | null;
  workspace: WorkspaceInfo | null;
  onOpenSettings: (section: SettingsSection) => void;
  onRefresh: () => Promise<void>;
}) {
  const modelReady = trustStatus?.model.configured ?? Boolean(settings.apiKey && settings.model);
  const screenReady = permissionOk(trustStatus?.permissions.screen);
  const accessibilityReady = permissionOk(trustStatus?.permissions.accessibility);
  const workspaceReady = Boolean(workspace?.projectDir);
  const macPermissionsRequired = !trustStatus || trustStatus.platform === "darwin";
  const macPermissionsReady = !macPermissionsRequired || (screenReady === true && accessibilityReady === true);
  const needsSetup = !modelReady || !workspaceReady || !macPermissionsReady;

  return (
    <section className={`trust-bar ${needsSetup ? "needs-setup" : ""}`}>
      <div className="trust-bar-main">
        <span className="section-kicker">Quick Setup</span>
        <strong>{needsSetup ? "Set up Kira" : "Kira is ready"}</strong>
      </div>
      <div className="trust-bar-grid">
        <TrustPill
          label="Model"
          value={modelReady ? providerText(settings, trustStatus) : "Not configured"}
          ok={modelReady}
          onClick={() => onOpenSettings("model")}
        />
        <TrustPill
          label="Workspace"
          value={workspaceReady ? displayPathName(workspace?.projectDir) : "Not set"}
          ok={workspaceReady}
          onClick={() => onOpenSettings("workspace")}
        />
        <TrustPill
          label="Mac Permissions"
          value={`Screen Recording: ${permissionLabel(trustStatus?.permissions.screen)} / Accessibility: ${permissionLabel(trustStatus?.permissions.accessibility)}`}
          ok={macPermissionsReady}
          onClick={() => onOpenSettings("computer-use")}
        />
      </div>
      <button className="settings-mini-btn" onClick={() => void onRefresh()}>Refresh</button>
    </section>
  );
}

function TrustPill({ label, value, ok, onClick }: {
  label: string;
  value: string;
  ok: boolean;
  onClick: () => void;
}) {
  return (
    <button className={`trust-pill ${ok ? "ok" : "warn"}`} onClick={onClick}>
      <span className={`permission-dot ${ok ? "ok" : "warn"}`} />
      <span>{label}</span>
      <b>{value}</b>
    </button>
  );
}

function ChatEmpty({ needsSetup, onSetup, onPrompt }: {
  needsSetup: boolean;
  onSetup: () => void;
  onPrompt: (prompt: string) => void;
}) {
  return (
    <div className="empty">
      <div className="empty-logo">
        <img src={kiraLogo} alt="Kira" />
      </div>
      <h2 className="empty-title">What should Kira do?</h2>
      <p className="empty-sub">A local-first agent for workspace tasks, web work, scheduled jobs, and controlled computer use.</p>
      {needsSetup && (
        <button className="setup-cta" onClick={onSetup}>Set up model</button>
      )}
      <div className="suggestions">
        {["Open a browser and visit a website", "Summarize files in this workspace", "Create a recurring task for tomorrow"].map((suggestion) => (
          <button key={suggestion} className="suggestion" onClick={() => onPrompt(suggestion)}>
            {suggestion}
          </button>
        ))}
      </div>
    </div>
  );
}

function MessageRow({ message }: { message: Msg }) {
  const label = message.role === "tool"
    ? message.toolName || "Tool"
    : message.role === "system"
      ? message.isError ? "Error" : "System"
      : message.role === "user"
        ? "You"
        : "Kira";

  return (
    <div className={`msg msg-${message.role} ${message.isError ? "is-error" : ""}`}>
      {message.role !== "user" && (
        <div className={`avatar ${message.role === "assistant" ? "avatar-ai" : "avatar-tool"}`}>
          {message.role === "assistant" ? <img src={kiraLogo} alt="" aria-hidden="true" /> : <Icon name={message.isError ? "warning" : "tools"} size={15} />}
        </div>
      )}
      <div className="msg-body">
        <span className="msg-label">{label}</span>
        <MessageMarkdown text={message.text} isError={message.isError} />
      </div>
      {message.role === "user" && <div className="avatar avatar-user">You</div>}
    </div>
  );
}

function Inspector({ running, workspace, trustStatus, recentActivity, onOpenSettings }: {
  running: boolean;
  workspace: WorkspaceInfo | null;
  trustStatus: TrustStatus | null;
  recentActivity: Msg[];
  onOpenSettings: (section: SettingsSection) => void;
}) {
  const screenReady = permissionOk(trustStatus?.permissions.screen);
  const accessibilityReady = permissionOk(trustStatus?.permissions.accessibility);
  const workspaceReady = Boolean(workspace?.projectDir);
  const networkEnabled = trustStatus?.browserAutomation.playwrightEnabled === true;

  return (
    <aside className="inspector">
      <InspectorSection title="Current Task" icon="activity">
        <div className={`task-state-card ${running ? "running" : ""}`}>
          <span className={`status-dot ${running ? "active" : ""}`} />
          <div>
            <strong>{running ? "Running" : "Idle"}</strong>
            <p>{running ? "Kira is executing the current request." : "No active task."}</p>
          </div>
        </div>
      </InspectorSection>

      <InspectorSection title="Permissions" icon="shield">
        <PermissionRow label="Computer Use" ok={screenReady === true && accessibilityReady === true} detail={screenReady === false || accessibilityReady === false ? "Needs review" : "Screen + control"} />
        <PermissionRow label="Workspace" ok={workspaceReady} detail={workspaceReady ? displayPathName(workspace?.projectDir) : "Not set"} />
        <PermissionRow label="Network" ok={networkEnabled} detail={networkEnabled ? "Browser automation allowed" : "Controlled mode"} />
        <button className="inline-link" onClick={() => onOpenSettings("computer-use")}>Review permissions</button>
      </InspectorSection>

      <InspectorSection title="Workspace" icon="folder">
        <div className="workspace-card">
          <strong>{displayPathName(workspace?.projectDir, "No workspace")}</strong>
          <code title={workspace?.projectDir}>{workspace?.projectDir || "Choose a workspace to give Kira project context."}</code>
          {workspace && !workspace.isProjectInsideWorkspace && <span className="soft-warning">External project</span>}
        </div>
        <button className="inline-link" onClick={() => onOpenSettings("workspace")}>Open workspace settings</button>
      </InspectorSection>

      <InspectorSection title="Memory Drafts" icon="memory">
        <div className="empty-panel">
          <p>No drafts waiting for review.</p>
          <span>Long-term memory updates should be reviewed before they are saved.</span>
        </div>
      </InspectorSection>

      <InspectorSection title="Recent Activity" icon="history">
        {recentActivity.length === 0 ? (
          <p className="empty-note">Tool and status events will appear here.</p>
        ) : (
          <div className="activity-list">
            {recentActivity.map((item) => (
              <div key={item.id} className={`activity-row ${item.isError ? "error" : ""}`}>
                <span>{item.toolName || (item.isError ? "Error" : "Status")}</span>
                <p>{item.text}</p>
              </div>
            ))}
          </div>
        )}
      </InspectorSection>
    </aside>
  );
}

function InspectorSection({ title, icon, children }: {
  title: string;
  icon: IconName;
  children: React.ReactNode;
}) {
  return (
    <section className="inspector-section">
      <h2><Icon name={icon} />{title}</h2>
      {children}
    </section>
  );
}

function PermissionRow({ label, ok, detail }: { label: string; ok: boolean; detail: string }) {
  return (
    <div className="permission-row">
      <span className={`permission-dot ${ok ? "ok" : "warn"}`} />
      <div>
        <strong>{label}</strong>
        <p>{detail}</p>
      </div>
    </div>
  );
}

function WorkspaceView({ workspace, trustStatus, onPickWorkspace, onOpenSettings }: {
  workspace: WorkspaceInfo | null;
  trustStatus: TrustStatus | null;
  onPickWorkspace: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <section className="workspace-view">
      <div className="workspace-hero">
        <div>
          <span className="section-kicker">Workspace</span>
          <h2>{displayPathName(workspace?.projectDir, "Choose a workspace")}</h2>
          <p>Kira uses the workspace to scope file access, local assets, tasks, and project context.</p>
        </div>
        <div className="workspace-actions">
          <button className="toolbar-button" onClick={onPickWorkspace}><Icon name="folder" />Choose Project</button>
          <button className="toolbar-button" onClick={onOpenSettings}><Icon name="gear" />Settings</button>
        </div>
      </div>
      <div className="workspace-grid">
        <InfoCard label="Workspace Root" value={workspace?.root || "Not set"} />
        <InfoCard label="Project Directory" value={workspace?.projectDir || "Not set"} />
        <InfoCard label="Projects Root" value={workspace?.projectsRoot || "Not set"} />
        <InfoCard label="Model" value={trustStatus?.model.configured ? `${trustStatus.model.provider} / ${trustStatus.model.model}` : "Not configured"} />
      </div>
    </section>
  );
}

function InfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-card">
      <span>{label}</span>
      <code title={value}>{value}</code>
    </div>
  );
}

function SettingsPanel({ initialSection, settings, workspace, trustStatus, onWorkspaceChange, onTrustRefresh, onSave, onClose }: {
  initialSection: SettingsSection;
  settings: SettingsState;
  workspace: WorkspaceInfo | null;
  trustStatus: TrustStatus | null;
  onWorkspaceChange: (workspace: WorkspaceInfo) => void;
  onTrustRefresh: () => Promise<void>;
  onSave: (s: SettingsState) => void;
  onClose: () => void;
}) {
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
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

  useEffect(() => {
    setActiveSection(initialSection);
  }, [initialSection]);

  const pickRoot = async () => {
    const info = await window.desktopAPI.pickKiraWorkspaceRoot();
    if (!info) return;
    onWorkspaceChange(info);
    void onTrustRefresh();
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
    void onTrustRefresh();
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
    try {
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
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  const refreshModels = async () => {
    setRefreshingModels(true);
    setTestResult(null);
    try {
      const result = await window.desktopAPI.discoverModels(form);
      setForm((current) => ({
        ...current,
        availableModels: result.models,
        autoRoutes: result.auto,
        modelsUpdatedAt: result.updatedAt,
      }));
      setTestResult({ ok: result.ok, message: result.message });
    } catch (error) {
      setTestResult({ ok: false, message: error instanceof Error ? error.message : String(error) });
    } finally {
      setRefreshingModels(false);
    }
  };

  const toggleRemote = async () => {
    setRemoteLoading(true);
    try {
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
    } finally {
      setRemoteLoading(false);
    }
  };

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <div>
            <h3>Settings</h3>
            <p>Configure Kira without leaving the current workspace.</p>
          </div>
          <button className="settings-close" onClick={onClose} title="Close">
            <Icon name="close" />
          </button>
        </div>

        <div className="settings-layout">
          <nav className="settings-tabs" aria-label="Settings sections">
            <SettingsTab id="model" active={activeSection} onClick={setActiveSection} icon="spark" label="Model" />
            <SettingsTab id="workspace" active={activeSection} onClick={setActiveSection} icon="folder" label="Workspace" />
            <SettingsTab id="computer-use" active={activeSection} onClick={setActiveSection} icon="computer" label="Computer Use" />
            <SettingsTab id="remote" active={activeSection} onClick={setActiveSection} icon="remote" label="Remote" />
            <SettingsTab id="appearance" active={activeSection} onClick={setActiveSection} icon="gear" label="Appearance" />
            <SettingsTab id="advanced" active={activeSection} onClick={setActiveSection} icon="tools" label="Advanced" />
          </nav>

          <div className="settings-body">
            <div className="setup-strip">
              <div className={form.apiKey ? "ok" : "warn"}><span>Model</span><b>{form.apiKey ? "Ready" : "Needs key"}</b></div>
              <div className={workspace?.projectDir ? "ok" : "warn"}><span>Workspace</span><b>{workspace?.projectDir ? "Ready" : "Choose"}</b></div>
              <div><span>Computer Use</span><b>{permissionOk(trustStatus?.permissions.screen) && permissionOk(trustStatus?.permissions.accessibility) ? "Ready" : "Optional"}</b></div>
            </div>

            {activeSection === "model" && (
              <SettingsGroup title="Model Provider">
                <label className="settings-label">
                  <span>Provider</span>
                  <select className="settings-input settings-select" value={provider} onChange={(e) => changeProvider(e.target.value as SettingsState["provider"])}>
                    <option value="anthropic">Anthropic / Claude</option>
                    <option value="openai">OpenAI</option>
                    <option value="openai-compatible">OpenAI-compatible</option>
                  </select>
                </label>
                <label className="settings-label">
                  <span>API Base URL</span>
                  <input className="settings-input" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} placeholder={baseUrlPlaceholder} />
                  {provider === "openai-compatible" && <span className="settings-note">Use the provider's OpenAI-compatible /v1 endpoint.</span>}
                </label>
                <label className="settings-label">
                  <span>API Key</span>
                  <div className="settings-key-row">
                    <input className="settings-input" type={showKey ? "text" : "password"} value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."} />
                    <button className="settings-eye" onClick={() => setShowKey(!showKey)}>{showKey ? "Hide" : "Show"}</button>
                  </div>
                </label>
                {provider !== "anthropic" && (
                  <label className="settings-label">
                    <span>OpenAI Endpoint</span>
                    <select className="settings-input settings-select" value={form.openAiEndpoint || "chat"} onChange={(e) => setForm({ ...form, openAiEndpoint: e.target.value as SettingsState["openAiEndpoint"] })}>
                      <option value="chat">Chat Completions</option>
                      <option value="responses">Responses</option>
                    </select>
                  </label>
                )}
                <label className="settings-label">
                  <span>Model</span>
                  <select className="settings-input settings-select" value={showCustomModelInput ? "__custom__" : form.model} onChange={(e) => setForm({ ...form, model: e.target.value === "__custom__" ? "" : e.target.value })}>
                    <option value="auto">Auto (dynamic)</option>
                    {availableModels.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label} {model.source === "fallback" ? "(default)" : ""}
                      </option>
                    ))}
                    <option value="__custom__">Custom model...</option>
                  </select>
                  <div className="model-actions">
                    <button className="settings-mini-btn" onClick={refreshModels} disabled={refreshingModels || !form.apiKey}>{refreshingModels ? "Refreshing..." : "Refresh Models"}</button>
                    {form.modelsUpdatedAt && <span className="model-updated">Updated {new Date(form.modelsUpdatedAt).toLocaleString()}</span>}
                  </div>
                  {(showCustomModelInput || form.model === "") && (
                    <input className="settings-input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} placeholder={modelPlaceholder} />
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
              </SettingsGroup>
            )}

            {activeSection === "workspace" && (
              <SettingsGroup title="Workspace">
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
                {workspace && !workspace.isProjectInsideWorkspace && <span className="settings-note">This is an external project. Runtime assets, installs, downloads, logs, and backups stay in Kira Workspace.</span>}
                {workspace?.isProjectInsideWorkspace && <span className="settings-note">New projects are recommended under Kira Workspace/projects. Runtime assets stay outside the project folder.</span>}
              </SettingsGroup>
            )}

            {activeSection === "computer-use" && (
              <SettingsGroup title="Computer Use">
                <div className="permission-grid">
                  <div>
                    <b>Screen Recording</b>
                    <span className={`permission-state ${trustTone(permissionOk(trustStatus?.permissions.screen))}`}>{permissionLabel(trustStatus?.permissions.screen)}</span>
                    <button className="settings-mini-btn" onClick={() => window.desktopAPI.openPermissionSettings("screen")}>Open</button>
                  </div>
                  <div>
                    <b>Accessibility</b>
                    <span className={`permission-state ${trustTone(permissionOk(trustStatus?.permissions.accessibility))}`}>{permissionLabel(trustStatus?.permissions.accessibility)}</span>
                    <button className="settings-mini-btn" onClick={() => window.desktopAPI.openPermissionSettings("accessibility")}>Open</button>
                  </div>
                </div>
                <button className="settings-mini-btn fit" onClick={() => void onTrustRefresh()}>Refresh permission status</button>
                <span className="settings-note">Restart Kira after changing macOS permissions if the status does not update immediately.</span>
                <label className="settings-label">
                  <span>Computer Use Deny List</span>
                  <input className="settings-input" value={form.computerUseDeniedBundleIds ?? ""} onChange={(e) => setForm({ ...form, computerUseDeniedBundleIds: e.target.value })} placeholder='["com.example.App"] or comma-separated bundle IDs' />
                  <span className="settings-note">Apps in this list cannot be granted Computer Use access. Use bundle IDs, for example com.apple.Music.</span>
                </label>
              </SettingsGroup>
            )}

            {activeSection === "remote" && (
              <SettingsGroup title="Remote Access">
                <div className="remote-row">
                  <div>
                    <strong>{remote.running ? "Remote access is on" : "Remote access is off"}</strong>
                    <p>{remote.running ? "Use the URL or QR code to continue from another device." : "Start a temporary remote session when you need mobile access."}</p>
                  </div>
                  <button className={`remote-toggle ${remote.running ? "active" : ""}`} onClick={toggleRemote} disabled={remoteLoading}>{remoteLoading ? "..." : remote.running ? "ON" : "OFF"}</button>
                </div>
                {remote.running && remote.accessUrl && (
                  <div className="remote-info">
                    <div className="remote-qr" dangerouslySetInnerHTML={{ __html: remote.qrSvg || "" }} />
                    <p className="remote-url">{remote.accessUrl}</p>
                    <p className="remote-hint">{remote.publicUrl ? "Public URL" : "LAN only"}</p>
                  </div>
                )}
                {remote.running && !remote.accessUrl && <p className="remote-hint">Starting...</p>}
              </SettingsGroup>
            )}

            {activeSection === "appearance" && (
              <SettingsGroup title="Appearance">
                <label className="settings-label">
                  <span>Theme</span>
                  <div className="settings-theme-row">
                    <button className={`theme-btn ${form.theme === "dark" ? "active" : ""}`} onClick={() => setForm({ ...form, theme: "dark" })}>Dark</button>
                    <button className={`theme-btn ${form.theme === "light" ? "active" : ""}`} onClick={() => setForm({ ...form, theme: "light" })}>Light</button>
                  </div>
                </label>
                <span className="settings-note">The interface uses system fonts and local assets only.</span>
              </SettingsGroup>
            )}

            {activeSection === "advanced" && (
              <SettingsGroup title="Advanced">
                <McpSection />
              </SettingsGroup>
            )}

            {testResult && (
              <div className={`test-result ${testResult.ok ? "test-ok" : "test-fail"}`}>
                {testResult.ok ? "OK: " : "Error: "}{testResult.message}
              </div>
            )}
          </div>
        </div>

        <div className="settings-footer">
          <button className="settings-test" onClick={testConn} disabled={testing || !form.apiKey}>{testing ? "Testing..." : "Test Connection"}</button>
          <button className="settings-save" onClick={() => onSave(form)}>Save</button>
        </div>
      </div>
    </div>
  );
}

function SettingsTab({ id, active, label, icon, onClick }: {
  id: SettingsSection;
  active: SettingsSection;
  label: string;
  icon: IconName;
  onClick: (section: SettingsSection) => void;
}) {
  return (
    <button className={active === id ? "active" : ""} onClick={() => onClick(id)}>
      <Icon name={icon} />
      <span>{label}</span>
    </button>
  );
}

function SettingsGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="settings-group">
      <h4>{title}</h4>
      {children}
    </section>
  );
}

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
          <Icon name="tasks" size={42} />
          <p>No scheduled tasks yet</p>
          <p className="tasks-empty-hint">Ask Kira to create recurring work when you need it.</p>
        </div>
      ) : (
        <div className="tasks-list">
          {tasks.map((task) => (
            <div key={task.id} className="task-card">
              <div className="task-header" onClick={() => setExpandedId(expandedId === task.id ? null : task.id)}>
                <div className="task-info">
                  <span className={`task-status ${task.enabled ? "enabled" : "paused"}`} />
                  <div className="task-meta">
                    <span className="task-prompt">{task.prompt.slice(0, 70)}</span>
                    <span className="task-schedule">{cronToDisplay(task.cron)}</span>
                  </div>
                </div>
                <div className="task-actions">
                  <button className="task-toggle" onClick={(e) => { e.stopPropagation(); toggle(task); }}>
                    {task.enabled ? "Pause" : "Resume"}
                  </button>
                  <button className="task-del" onClick={(e) => { e.stopPropagation(); remove(task.id); }}>
                    <Icon name="trash" size={13} />
                  </button>
                </div>
              </div>
              {expandedId === task.id && (
                <div className="task-history">
                  {taskHistory(task.id).length === 0 ? (
                    <p className="task-history-empty">No runs yet</p>
                  ) : (
                    taskHistory(task.id).slice(0, 5).map((h: any) => (
                      <div key={h.id} className="task-run">
                        <span className={`task-run-status ${h.status}`}>{h.status}</span>
                        <span className="task-run-time">{new Date(h.updatedAt).toLocaleString()}</span>
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
    <div className="mcp-section">
      <div className="settings-section-header">
        <span>MCP Servers</span>
        <button className="settings-mini-btn" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "Add"}</button>
      </div>
      {adding && (
        <div className="mcp-add-form">
          <input className="settings-input" placeholder="Server name, e.g. notion" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <input className="settings-input" placeholder="Command, e.g. npx @notionhq/mcp-server" value={newCmd} onChange={(e) => setNewCmd(e.target.value)} />
          <button className="settings-save" onClick={add}>Add Server</button>
        </div>
      )}
      {names.length === 0 && !adding && <p className="remote-hint">No MCP servers configured</p>}
      {names.map((name) => (
        <div key={name} className="mcp-server-item">
          <div className="mcp-server-info">
            <span className="mcp-server-name">{name}</span>
            <span className="mcp-server-cmd">{servers[name].command} {(servers[name].args || []).join(" ")}</span>
          </div>
          <button className="task-del" onClick={() => remove(name)}>
            <Icon name="trash" size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
