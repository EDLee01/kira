import { useState, useRef, useCallback } from "react";

interface InputBarProps {
  onSend: (text: string) => void;
  onCancel: () => void;
  streaming: boolean;
  disabled?: boolean;
}

export default function InputBar({ onSend, onCancel, streaming, disabled }: InputBarProps) {
  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (!text.trim() || streaming || disabled) return;
        onSend(text.trim());
        setText("");
      }
    },
    [text, streaming, disabled, onSend]
  );

  const handleClick = useCallback(() => {
    if (!text.trim() || streaming || disabled) return;
    onSend(text.trim());
    setText("");
  }, [text, streaming, disabled, onSend]);

  // Auto-resize
  const handleInput = useCallback(() => {
    const el = inputRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = Math.min(el.scrollHeight, 200) + "px";
    }
  }, []);

  return (
    <div className="input-bar">
      {streaming ? (
        <button className="btn-cancel" onClick={onCancel}>
          Cancel
        </button>
      ) : (
        <>
          <textarea
            ref={inputRef}
            className="input-field"
            placeholder="Type a message... (Enter to send, Shift+Enter for newline)"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              handleInput();
            }}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            rows={1}
          />
          <button className="btn-send" onClick={handleClick} disabled={!text.trim() || disabled}>
            Send
          </button>
        </>
      )}
    </div>
  );
}
