import { ConversationSession } from "../types";

type HistorySidebarProps = {
  sessions: ConversationSession[];
  currentSessionId: string;
  onSelectSession: (id: string) => void;
  onNewSession: () => void;
  onDeleteSession: (id: string) => void;
  isOpen: boolean;
  onToggle: () => void;
};

export function HistorySidebar({
  sessions,
  currentSessionId,
  onSelectSession,
  onNewSession,
  onDeleteSession,
  isOpen,
  onToggle,
}: HistorySidebarProps) {
  const groupedSessions = groupSessionsByDate(sessions);

  return (
    <>
      <button className="history-toggle" onClick={onToggle} title={isOpen ? "Close Explorer" : "Open Explorer"}>
        {isOpen ? "◀" : "▶"}
      </button>
      <aside className={`history-sidebar ${isOpen ? "open" : "closed"}`}>
        <div className="history-header">
          <h2>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            Explorer
          </h2>
          <button className="btn-new-session" onClick={onNewSession} title="New Session">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </button>
        </div>

        <div className="history-search">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="search-icon"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          <input
            type="text"
            placeholder="Search runs..."
            className="search-input"
          />
        </div>

        <div className="history-sessions">
          {sessions.length === 0 ? (
            <div className="history-empty">
              <div className="empty-blob"></div>
              <p className="empty-title">Clean Workspace</p>
              <p className="empty-hint">Your session history is empty.</p>
            </div>
          ) : (
            Object.entries(groupedSessions).map(([dateLabel, dateSessions]) => (
              <div key={dateLabel} className="history-group">
                <div className="history-group-label">{dateLabel}</div>
                {dateSessions.map((session) => (
                  <div
                    key={session.id}
                    className={`history-session-item ${session.id === currentSessionId ? "active" : ""}`}
                    onClick={() => onSelectSession(session.id)}
                  >
                    <div className="session-main">
                      <div className="session-icon-wrapper">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                      </div>
                      <div className="session-info">
                        <span className="session-title">{session.title}</span>
                        <span className="session-preview">{session.preview}</span>
                        <div className="session-meta">
                          <span className="session-time">{formatTimeAgo(session.lastMessageAt)}</span>
                        </div>
                      </div>
                    </div>
                    <button
                      className="session-delete"
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteSession(session.id);
                      }}
                      title="Delete run"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>

        <div className="history-footer">
          <span className="session-count">{sessions.length} runs saved</span>
          <button className="btn-toggle-sidebar" onClick={onToggle} title="Collapse Explorer">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M15 18l-6-6 6-6"/></svg>
          </button>
        </div>
      </aside>
    </>
  );
}

function groupSessionsByDate(sessions: ConversationSession[]): Record<string, ConversationSession[]> {
  const grouped: Record<string, ConversationSession[]> = {};
  const now = Date.now();
  const oneDay = 24 * 60 * 60 * 1000;

  sessions.forEach((session) => {
    const date = new Date(session.lastMessageAt);
    const diffDays = Math.floor((now - session.lastMessageAt) / oneDay);

    let label: string = "Older";
    if (diffDays === 0) {
      label = "Today";
    } else if (diffDays === 1) {
      label = "Yesterday";
    } else if (diffDays <= 7) {
      label = "This week";
    } else if (diffDays <= 30) {
      label = "This month";
    } else {
      label = date.toLocaleDateString([], { month: "short", year: "numeric" });
    }

    if (!grouped[label]) {
      grouped[label] = [];
    }
    const currentGroup = grouped[label];
    if (currentGroup) {
      currentGroup.push(session);
    }
  });

  // Sort each group by recency
  Object.values(grouped).forEach((group) =>
    group.sort((a, b) => b.lastMessageAt - a.lastMessageAt)
  );

  return grouped;
}

function formatTimeAgo(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
