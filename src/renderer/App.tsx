import { useState, useCallback, useRef, useEffect } from "react";

declare global {
  interface Window {
    desktopAPI: {
      sendMessage: (sessionId: string, text: string) => Promise<void>;
      cancelQuery: () => Promise<void>;
      createSession: (title?: string) => Promise<string>;
      listSessions: () => Promise<Array<{ id: string; title: string | null; createdAt: string }>>;
      deleteSession: (id: string) => Promise<void>;
      renameSession: (id: string, title: string) => Promise<void>;
      getSession: (id: string) => Promise<any>;
      getWorkspace: () => Promise<string>;
      pickWorkspace: () => Promise<string | null>;
      getSettings: () => Promise<{ baseUrl: string; apiKey: string; model: string }>;
      setSettings: (s: Record<string, string>) => Promise<Record<string, string>>;
      testConnection: (s: { baseUrl: string; apiKey: string; model: string }) => Promise<{ ok: boolean; message: string }>;
      onStreamEvent: (callback: (event: any) => void) => () => void;
      onEngineStatus: (callback: (status: any) => void) => () => void;
      onEngineError: (callback: (err: any) => void) => () => void;
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

export default function App() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [sid, setSid] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [workspace, setWorkspace] = useState("");
  const [settings, setSettings] = useState({ baseUrl: "", apiKey: "", model: "", theme: "dark" });
  const streamText = useRef("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  // Load sessions
  const loadSessions = useCallback(async () => {
    try {
      const list = await window.desktopAPI.listSessions();
      setSessions(list ?? []);
    } catch {}
  }, []);

  // Init: load latest session or create one
  useEffect(() => {
    (async () => {
      // Load workspace
      const cwd = await window.desktopAPI.getWorkspace();
      setWorkspace(cwd);

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
        const newId = await window.desktopAPI.createSession("Magi");
        setSid(newId);
      }
    })();
  }, []);

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
  }, [loadSessions]);

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
    const newId = await window.desktopAPI.createSession("Magi");
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
      const newId = await window.desktopAPI.createSession("Magi");
      setSid(newId);
      setMsgs([]);
      streamText.current = "";
    }
  }, [sid, loadSessions]);

  // Pick workspace
  const pickWorkspace = useCallback(async () => {
    const dir = await window.desktopAPI.pickWorkspace();
    if (dir) setWorkspace(dir);
  }, []);

  // Save settings
  const saveSettings = useCallback(async (newSettings: typeof settings) => {
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
    setRunning(true);
    streamText.current = "";
    let id = sid;
    if (!id) {
      id = await window.desktopAPI.createSession("Magi");
      setSid(id);
    }
    await window.desktopAPI.sendMessage(id, text);
  }, [input, running, sid]);

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

  const currentTitle = sessions.find((s) => s.id === sid)?.title ?? "Magi";

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
          <button className="workspace-btn" onClick={pickWorkspace} title={workspace}>
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
              <path d="M2 4.5V11a1 1 0 001 1h8a1 1 0 001-1V5.5a1 1 0 00-1-1H7L5.5 3H3a1 1 0 00-1 1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            <span className="workspace-path">{workspace.split("/").pop() || workspace}</span>
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
                  <span className="history-item-title">{s.title ?? "Untitled"}</span>
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
          onSave={saveSettings}
          onClose={() => setShowSettings(false)}
        />
      )}

      {/* ── Messages ── */}
      <div className="messages-wrap">
        {msgs.length === 0 ? (
          <div className="empty">
            <div className="empty-logo">
              <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                <path d="M28 4l4 16h-8l4-16z" fill="url(#hat1)"/>
                <path d="M10 42c0-2 4-14 18-14s18 12 18 14H10z" fill="url(#hat2)"/>
                <path d="M8 42h40v4H8v-4z" fill="url(#hat3)" rx="2"/>
                <circle cx="28" cy="20" r="3" fill="#ffd700"/>
                <circle cx="26" cy="28" r="1.5" fill="#ffd700" opacity="0.7"/>
                <circle cx="32" cy="32" r="1.5" fill="#ffd700" opacity="0.7"/>
                <circle cx="22" cy="35" r="1" fill="#ffd700" opacity="0.5"/>
                <defs>
                  <linearGradient id="hat1" x1="28" y1="4" x2="28" y2="20" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#8b5cf6"/>
                    <stop offset="1" stopColor="#6c5ce7"/>
                  </linearGradient>
                  <linearGradient id="hat2" x1="28" y1="28" x2="28" y2="42" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#6c5ce7"/>
                    <stop offset="1" stopColor="#4c3ed1"/>
                  </linearGradient>
                  <linearGradient id="hat3" x1="8" y1="42" x2="48" y2="46" gradientUnits="userSpaceOnUse">
                    <stop stopColor="#4c3ed1"/>
                    <stop offset="1" stopColor="#6c5ce7"/>
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <h2 className="empty-title">Magi Desktop</h2>
            <p className="empty-sub">你的全能 AI 搭子，随时待命</p>
            <div className="suggestions">
              {["帮我打开知乎热榜", "搜索一下竞品信息", "帮我整理今天的工作"].map((s) => (
                <button key={s} className="suggestion" onClick={() => setInput(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="messages">
            {msgs.map((m) => (
              <div key={m.id} className={`msg msg-${m.role}`}>
                {m.role === "assistant" && (
                  <div className="avatar avatar-ai">
                    <svg width="18" height="18" viewBox="0 0 56 56" fill="none">
                      <path d="M28 4l4 16h-8l4-16z" fill="#a78bfa"/>
                      <path d="M10 42c0-2 4-14 18-14s18 12 18 14H10z" fill="#7c5cfc"/>
                      <path d="M8 42h40v4H8v-4z" fill="#6c5ce7" rx="2"/>
                      <circle cx="28" cy="20" r="3" fill="#ffd700"/>
                    </svg>
                  </div>
                )}
                <div className="msg-body">
                  {m.role === "tool" && <span className="tool-label">{m.toolName}</span>}
                  <div className={`msg-text ${m.isError ? "msg-error" : ""}`}>{m.text}</div>
                </div>
                {m.role === "user" && <div className="avatar avatar-user">You</div>}
              </div>
            ))}
            {running && msgs[msgs.length - 1]?.role !== "assistant" && (
              <div className="msg msg-assistant">
                <div className="avatar avatar-ai">
                  <svg width="18" height="18" viewBox="0 0 56 56" fill="none">
                    <path d="M28 4l4 16h-8l4-16z" fill="#a78bfa"/>
                    <path d="M10 42c0-2 4-14 18-14s18 12 18 14H10z" fill="#7c5cfc"/>
                    <path d="M8 42h40v4H8v-4z" fill="#6c5ce7" rx="2"/>
                    <circle cx="28" cy="20" r="3" fill="#ffd700"/>
                  </svg>
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
            placeholder="发消息给 Magi…"
            value={input}
            onChange={handleInput}
            onKeyDown={handleKey}
            disabled={running}
            rows={1}
          />
          <div className="input-actions">
            {running ? (
              <button className="btn-stop" onClick={() => window.desktopAPI.cancelQuery()} title="Stop">
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
      </div>
    </div>
  );
}

/** Settings Panel */
function SettingsPanel({ settings, onSave, onClose }: {
  settings: { baseUrl: string; apiKey: string; model: string; theme: string };
  onSave: (s: typeof settings) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState(settings);
  const [showKey, setShowKey] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  const testConn = async () => {
    setTesting(true);
    setTestResult(null);
    const result = await window.desktopAPI.testConnection(form);
    setTestResult(result);
    setTesting(false);
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

          <label className="settings-label">
            <span>API Base URL</span>
            <input
              className="settings-input"
              value={form.baseUrl}
              onChange={(e) => setForm({ ...form, baseUrl: e.target.value })}
              placeholder="https://api.anthropic.com"
            />
          </label>

          <label className="settings-label">
            <span>API Key</span>
            <div className="settings-key-row">
              <input
                className="settings-input"
                type={showKey ? "text" : "password"}
                value={form.apiKey}
                onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                placeholder="sk-..."
              />
              <button className="settings-eye" onClick={() => setShowKey(!showKey)}>
                {showKey ? "Hide" : "Show"}
              </button>
            </div>
          </label>

          <label className="settings-label">
            <span>Model</span>
            <select
              className="settings-input settings-select"
              value={form.model}
              onChange={(e) => setForm({ ...form, model: e.target.value })}
            >
              <option value="claude-haiku-4-5">Claude Haiku 4.5 (Fast)</option>
              <option value="claude-sonnet-4-6">Claude Sonnet 4.6</option>
              <option value="claude-opus-4-7">Claude Opus 4.7</option>
              <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
              <option value="gemini-2.5-pro">Gemini 2.5 Pro</option>
              <option value="auto">Auto (Proxy decides)</option>
            </select>
          </label>
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
