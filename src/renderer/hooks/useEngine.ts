import { useState, useEffect, useCallback, useRef } from "react";

export interface StreamEvent {
  type: string;
  text?: string;
  toolUse?: any;
  toolName?: string;
  content?: string;
  error?: string;
  usage?: any;
  [key: string]: unknown;
}

export interface DisplayMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  toolName?: string;
  toolCallId?: string;
  isError?: boolean;
  timestamp: number;
}

let msgCounter = 0;
function nextId(): string {
  return `msg_${Date.now()}_${++msgCounter}`;
}

declare global {
  interface Window {
    desktopAPI: {
      listSessions: () => Promise<any[]>;
      createSession: (title?: string) => Promise<string>;
      deleteSession: (id: string) => Promise<boolean>;
      renameSession: (id: string, title: string) => Promise<boolean>;
      getSession: (id: string) => Promise<any>;
      sendMessage: (sessionId: string, text: string) => Promise<void>;
      cancelQuery: () => Promise<void>;
      getEngineStatus: () => Promise<{ running: boolean; sessionId: string | null }>;
      getConfig: () => Promise<any>;
      getAppInfo: () => Promise<{ version: string; platform: string; arch: string; nodeVersion: string }>;
      onStreamEvent: (callback: (event: StreamEvent) => void) => () => void;
      onEngineStatus: (callback: (status: any) => void) => () => void;
      onEngineError: (callback: (err: any) => void) => () => void;
    };
  }
}

export function useEngine() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamingText = useRef("");

  // Subscribe to stream events
  useEffect(() => {
    const unsubEvents = window.desktopAPI.onStreamEvent((event) => {
      switch (event.type) {
        case "text_delta":
          streamingText.current += event.text ?? "";
          setMessages((prev) => {
            const copy = [...prev];
            const last = copy[copy.length - 1];
            if (last && last.role === "assistant") {
              copy[copy.length - 1] = { ...last, text: streamingText.current };
            } else {
              copy.push({ id: nextId(), role: "assistant", text: streamingText.current, timestamp: Date.now() });
            }
            return copy;
          });
          break;

        case "tool_use":
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: "tool",
              text: `Using ${event.toolUse?.name ?? "tool"}...`,
              toolName: event.toolUse?.name,
              toolCallId: event.toolUse?.id,
              timestamp: Date.now(),
            },
          ]);
          break;

        case "tool_result":
          setMessages((prev) => {
            const copy = [...prev];
            // Update the matching tool call
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].toolCallId === event.toolCallId) {
                const content = event.content ?? "";
                const isError = event.isError ?? false;
                const prefix = isError ? "✗" : "✓";
                const display = content.length > 500 ? content.slice(0, 500) + "..." : content;
                copy[i] = { ...copy[i], text: `${prefix} ${event.toolName}: ${display}`, isError };
                break;
              }
            }
            return copy;
          });
          break;

        case "done":
          setStreaming(false);
          streamingText.current = "";
          break;

        case "error":
          setError(event.error ?? "Unknown error");
          setStreaming(false);
          streamingText.current = "";
          break;

        case "cancelled":
          setMessages((prev) => [...prev, { id: nextId(), role: "system", text: "Query cancelled", timestamp: Date.now() }]);
          setStreaming(false);
          streamingText.current = "";
          break;
      }
    });

    const unsubError = window.desktopAPI.onEngineError((err) => {
      setError(err.error ?? "Engine error");
      setStreaming(false);
    });

    return () => {
      unsubEvents();
      unsubError();
    };
  }, []);

  const sendMessage = useCallback(async (sid: string, text: string) => {
    setError(null);
    setStreaming(true);
    streamingText.current = "";

    // Add user message immediately
    setMessages((prev) => [...prev, { id: nextId(), role: "user", text, timestamp: Date.now() }]);
    setSessionId(sid);

    await window.desktopAPI.sendMessage(sid, text);
  }, []);

  const cancelQuery = useCallback(async () => {
    await window.desktopAPI.cancelQuery();
    setStreaming(false);
  }, []);

  const loadSession = useCallback(async (sid: string) => {
    setSessionId(sid);
    const session = await window.desktopAPI.getSession(sid);
    if (session?.messages) {
      setMessages(
        session.messages.map((m: any) => ({
          id: nextId(),
          role: m.role as "user" | "assistant",
          text: typeof m.content === "string" ? m.content : JSON.stringify(m.content),
          timestamp: new Date(m.createdAt).getTime(),
        }))
      );
    } else {
      setMessages([]);
    }
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    streamingText.current = "";
  }, []);

  return {
    messages,
    streaming,
    sessionId,
    error,
    setError,
    sendMessage,
    cancelQuery,
    loadSession,
    clearMessages,
  };
}
