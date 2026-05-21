interface SessionListProps {
  sessions: Array<{ id: string; title: string; updatedAt: string; message_count: number }>;
  activeId: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

export default function SessionList({ sessions, activeId, onSelect, onNew, onDelete }: SessionListProps) {
  return (
    <div className="session-list">
      <div className="session-list-header">
        <span className="session-list-title">Sessions</span>
        <button className="btn-new-session" onClick={onNew} title="New session">
          +
        </button>
      </div>
      <div className="session-items">
        {sessions.length === 0 && (
          <div className="session-empty">No sessions yet</div>
        )}
        {sessions.map((s) => (
          <div
            key={s.id}
            className={`session-item ${s.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(s.id)}
          >
            <div className="session-item-title">{s.title || "Untitled"}</div>
            <div className="session-item-meta">
              {s.message_count ?? 0} messages
            </div>
            <button
              className="session-item-delete"
              onClick={(e) => {
                e.stopPropagation();
                if (confirm("Delete this session?")) onDelete(s.id);
              }}
              title="Delete"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
