import { useRef, useEffect } from "react";
import { DisplayMessage } from "../hooks/useEngine";

interface ChatViewProps {
  messages: DisplayMessage[];
  streaming: boolean;
}

export default function ChatView({ messages, streaming }: ChatViewProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  if (messages.length === 0 && !streaming) {
    return (
      <div className="chat-empty">
        <div className="chat-empty-content">
          <h2>Magi Desktop</h2>
          <p>你的 AI 运营搭子</p>
          <div className="examples">
            <p className="examples-label">试试：</p>
            <code>帮我看看今天的热榜</code>
            <code>浏览一下我的项目代码</code>
            <code>帮我写个方案</code>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="chat-view">
      {messages.map((msg) => (
        <div key={msg.id} className={`msg msg-${msg.role}`}>
          <div className="msg-label">{msg.role === "user" ? "You" : msg.role === "tool" ? msg.toolName ?? "Tool" : msg.role === "system" ? "System" : "AI"}</div>
          <div className={`msg-text ${msg.isError ? "msg-error" : ""}`}>
            {msg.text}
          </div>
        </div>
      ))}
      {streaming && (
        <div className="msg msg-assistant msg-streaming">
          <div className="msg-cursor" />
        </div>
      )}
      <div ref={bottomRef} />
    </div>
  );
}
