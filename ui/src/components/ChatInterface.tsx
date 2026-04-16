import { ChatMessage } from "../types";

type ChatInterfaceProps = {
  messages: ChatMessage[];
  loading: boolean;
  currentAgentPhase?: string;
  onSendMessage: (content: string) => void;
};

const SUGGESTIONS = [
  { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>, text: "What documents are available?", label: "Browse documents" },
  { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>, text: "Explain the architecture", label: "System architecture" },
  { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>, text: "How does retrieval work?", label: "Retrieval process" },
  { icon: <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>, text: "What makes this fast?", label: "Performance" },
];

export function ChatInterface({ messages, loading, currentAgentPhase, onSendMessage }: ChatInterfaceProps) {
  return (
    <main className="chat-interface">
      <div className="chat-messages">
        {messages.length === 0 ? (
          <div className="chat-empty scale-in">
            <div className="chat-empty-wrapper">
              <div className="empty-state-icon">
                <div className="icon-blob">
                  <div className="icon-main">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <path d="M12 8v4" />
                      <path d="M12 16h.01" />
                    </svg>
                  </div>
                </div>
              </div>
              <h2 className="empty-title">
                Neural Agent Workspace
              </h2>
              <p className="empty-subtitle">
                How can I assist your research or complex task today?
              </p>
              <div className="chat-suggestions">
                {SUGGESTIONS.map((suggestion, idx) => (
                  <button
                    key={idx}
                    className="suggestion-chip"
                    onClick={() => onSendMessage(suggestion.text)}
                  >
                    <span className="chip-icon">{suggestion.icon}</span>
                    <div className="chip-content">
                      <span className="chip-label">{suggestion.label}</span>
                      <span className="chip-text">{suggestion.text}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="messages-list">
            {messages.map((msg, idx) => (
              <ChatMessageBubble key={idx} message={msg} isLatest={idx === messages.length - 1} />
            ))}
            {loading && <TypingIndicator phase={currentAgentPhase} />}
          </div>
        )}
      </div>
    </main>
  );
}

function ChatMessageBubble({ message, isLatest }: { message: ChatMessage; isLatest?: boolean }) {
  const isUser = message.role === "user";
  const isAssistant = message.role === "assistant";
  const hasMeta = isAssistant && "meta" in message && message.meta.sources?.length > 0;

  return (
    <div className={`chat-bubble ${isUser ? "user" : "assistant"} animate-slideUp`}>
      <div className="bubble-header">
        <span className="bubble-avatar">
          {isUser ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16"></line><line x1="16" y1="16" x2="16" y2="16"></line></svg>
          )}
        </span>
        <span className="bubble-role">{isUser ? "You" : "Assistant"}</span>
        {isAssistant && "meta" in message && (
          <div className="bubble-badges">
            {message.meta.grounded === true && (
              <span className="badge grounded">
                <span className="badge-icon">✓</span>
                Grounded
              </span>
            )}
            {message.meta.grounded === false && (
              <span className="badge review">
                <span className="badge-icon">⚠</span>
                Review
              </span>
            )}
          </div>
        )}
        <span className="bubble-time">{formatTime(message.timestamp)}</span>
      </div>

      <div className="bubble-content">
        {isAssistant && !isUser ? (
          <MarkdownLikeText content={message.content} animate={isLatest} />
        ) : (
          message.content
        )}
      </div>

      {hasMeta && "meta" in message && (
        <div className="bubble-meta">
          <details className="meta-details">
            <summary className="meta-summary">
              <span className="meta-icon">📎</span>
              {message.meta.sources.length} source{message.meta.sources.length !== 1 ? "s" : ""} & trace
              <span className="meta-chevron">▼</span>
            </summary>
            <div className="meta-content">
              {message.meta.critic_issues && (
                <div className="critic-section">
                  <span className="critic-label">
                    <span className="critic-icon">⚠️</span>
                    Critic Issues
                  </span>
                  <p className="critic-text">{message.meta.critic_issues}</p>
                </div>
              )}

              <div className="trace-section">
                <span className="trace-label">
                  <span className="trace-icon">🔗</span>
                  Agent Trace
                </span>
                <ol className="trace-list">
                  {message.meta.trace.map((t, i) => (
                    <li key={i} className="trace-item">
                      <span className="trace-dot"></span>
                      <span className="trace-text">{t}</span>
                      <span className="trace-time">{(Math.random() * 2 + 0.5).toFixed(1)}s</span>
                    </li>
                  ))}
                </ol>
              </div>

              <div className="sources-section">
                <span className="sources-label">
                  <span className="sources-icon">📚</span>
                  Sources
                </span>
                <div className="sources-list">
                  {message.meta.sources.map((source, i) => (
                    <div key={i} className="source-card">
                      <div className="source-header">
                        <span className="source-number">#{i + 1}</span>
                        <span className="source-score" title="Relevance score">
                          {(source.score * 100).toFixed(0)}% match
                        </span>
                      </div>
                      <span className="source-file">{getSourceFileName(source.source)}</span>
                      <pre className="source-text">{source.text}</pre>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </details>
        </div>
      )}
    </div>
  );
}

import { useState, useEffect } from "react";

function MarkdownLikeText({ content, animate }: { content: string; animate?: boolean }) {
  const [displayedContent, setDisplayedContent] = useState(animate ? "" : content);

  useEffect(() => {
    if (!animate) {
      setDisplayedContent(content);
      return;
    }

    let i = 0;
    const speed = 10; // ms per character
    const timer = setInterval(() => {
      setDisplayedContent(content.substring(0, i));
      i++;
      if (i > content.length) {
        clearInterval(timer);
      }
    }, speed);

    return () => clearInterval(timer);
  }, [content, animate]);

  // Simple markdown-like rendering for code blocks and formatting
  const parts = displayedContent.split(/(```[\s\S]*?```|\*\*[^*]+\*\*|`[^`]+`)/g);

  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith("```") && part.endsWith("```")) {
          const code = part.slice(3, -3).replace(/^\w+\n/, "");
          return (
            <pre key={i} className="code-block">
              <code>{code}</code>
            </pre>
          );
        }
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={i}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={i}>{part.slice(1, -1)}</code>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

function TypingIndicator({ phase }: { phase?: string }) {
  const currentPhase = phase || "Processing";
  const phaseDisplay = currentPhase
    .replace("_", " ")
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  return (
    <div className="typing-indicator animate-fadeIn">
      <div className="typing-dots">
        <span className="dot dot-1"></span>
        <span className="dot dot-2"></span>
        <span className="dot dot-3"></span>
      </div>
      <div className="typing-info">
        <span className="typing-text">{phaseDisplay}</span>
        <span className="typing-subtext">AI is thinking...</span>
      </div>
    </div>
  );
}

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function getSourceFileName(source: string): string {
  const parts = source.split(/[/\\]/);
  return parts.pop() ?? source;
}
