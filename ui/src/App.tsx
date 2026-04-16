import { useCallback, useEffect, useRef, useState } from "react";
import { HistorySidebar } from "./components/HistorySidebar";
import { ChatInterface } from "./components/ChatInterface";
import { SettingsPanel } from "./components/SettingsPanel";
import { ToastContainer } from "./components/Toast";
import {
  ChatMessage,
  ChatResponse,
  Health,
  AgentTrace,
  ConversationSession,
  AppSettings,
  Toast,
  ToastType,
} from "./types";

function apiUrl(path: string): string {
  const base = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
  return base ? `${base}${path}` : path;
}

async function errorTextFromResponse(r: Response): Promise<string> {
  const raw = await r.text();
  if (!raw.trim()) return `Request failed (HTTP ${r.status})`;
  try {
    const j = JSON.parse(raw) as { detail?: unknown };
    const d = j.detail;
    if (typeof d === "string") return d;
    if (Array.isArray(d)) {
      return d
        .map((item) =>
          typeof item === "object" && item !== null && "msg" in item
            ? String((item as { msg: string }).msg)
            : JSON.stringify(item)
        )
        .join("; ");
    }
  } catch {
    /* not JSON */
  }
  return raw;
}

function friendlyNetworkError(context: string, e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  const target = import.meta.env.VITE_API_URL || "Vite dev proxy → API :8000";
  if (
    m === "Failed to fetch" ||
    m.includes("NetworkError") ||
    m.includes("Load failed") ||
    m.includes("ECONNREFUSED")
  ) {
    return `${context}: connection failed (${m}). Target: ${target}. Keep uvicorn running.`;
  }
  return `${context}: ${m}`;
}

function loadSessionId(): string {
  try {
    const k = "mar-session-id";
    const existing = localStorage.getItem(k);
    if (existing?.trim()) return existing.trim();
    const id = crypto.randomUUID();
    localStorage.setItem(k, id);
    return id;
  } catch {
    return crypto.randomUUID();
  }
}

function loadSessions(): ConversationSession[] {
  try {
    const stored = localStorage.getItem("mar-sessions");
    if (stored) {
      return JSON.parse(stored) as ConversationSession[];
    }
  } catch {
    /* ignore */
  }
  return [];
}

function saveSessions(sessions: ConversationSession[]) {
  try {
    localStorage.setItem("mar-sessions", JSON.stringify(sessions));
  } catch {
    /* ignore */
  }
}

function loadSettings(): AppSettings {
  try {
    const stored = localStorage.getItem("mar-settings");
    if (stored) {
      return JSON.parse(stored) as AppSettings;
    }
  } catch {
    /* ignore */
  }
  return {
    theme: "dark",
    showAgentPanel: true,
    autoScroll: true,
    streamResponses: true,
    maxHistorySessions: 50,
  };
}

function saveSettings(settings: AppSettings) {
  try {
    localStorage.setItem("mar-settings", JSON.stringify(settings));
  } catch {
    /* ignore */
  }
}

export default function App() {
  const [sessionId, setSessionId] = useState(loadSessionId);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [health, setHealth] = useState<Health | null>(null);
  const [healthLoading, setHealthLoading] = useState(true);
  const [ingestMsg, setIngestMsg] = useState<string | null>(null);
  const [ingesting, setIngesting] = useState(false);
  const [clearCollection, setClearCollection] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(true);
  const [sessions, setSessions] = useState<ConversationSession[]>(loadSessions);
  const [agentTraces, setAgentTraces] = useState<AgentTrace[]>([]);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Toast helpers
  const addToast = useCallback((message: string, type: ToastType = "info", duration = 5000) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type, duration }]);
    if (duration > 0) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, duration);
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // Apply theme
  useEffect(() => {
    const root = document.documentElement;
    if (settings.theme === "light") {
      root.setAttribute("data-theme", "light");
    } else if (settings.theme === "dark") {
      root.removeAttribute("data-theme");
    } else {
      // System preference
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      if (prefersDark) {
        root.removeAttribute("data-theme");
      } else {
        root.setAttribute("data-theme", "light");
      }
    }
    saveSettings(settings);
  }, [settings.theme]);

  const scrollToBottom = useCallback(() => {
    if (settings.autoScroll) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [settings.autoScroll]);

  const refreshHealth = useCallback(async () => {
    try {
      const r = await fetch(apiUrl("/health"));
      if (!r.ok) throw new Error(`Health ${r.status}`);
      setHealth((await r.json()) as Health);
    } catch {
      setHealth(null);
    } finally {
      setHealthLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
    const ms = health === null ? 45000 : 20000;
    const t = window.setInterval(() => void refreshHealth(), ms);
    return () => window.clearInterval(t);
  }, [refreshHealth, health]);

  useEffect(() => {
    try {
      localStorage.setItem("mar-session-id", sessionId);
    } catch {
      /* ignore */
    }
  }, [sessionId]);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);


  useEffect(() => {
    if (loading) {
      setAgentTraces([]);

      let currentPhase = 0;
      const phaseNames = ["memory_load", "retriever_agent", "coder_agent", "critic_agent", "finalize"];
      const phaseStartTimes = [Date.now(), Date.now(), Date.now(), Date.now(), Date.now()];

      const interval = setInterval(() => {

        setAgentTraces((prev) => {
          const currentPhaseName = phaseNames[currentPhase] ?? "processing";
          const newTraces = [...prev];
          if (!prev.find((t) => t.phase === currentPhaseName)) {
            newTraces.push({
              phase: currentPhaseName,
              status: "running",
            });
          }
          return newTraces.map((t, idx) => {
            const start = phaseStartTimes[idx] ?? Date.now();
            return idx < currentPhase
              ? {
                  ...t,
                  status: "completed" as const,
                  duration: (Date.now() - start) / 1000,
                }
              : t;
          });
        });

        currentPhase = (currentPhase + 1) % 6;
      }, 800);

      return () => clearInterval(interval);
    } else {

      setAgentTraces((prev) =>
        prev.map((t) => ({
          ...t,
          status: "completed" as const,
          duration: t.duration ?? (Math.random() * 2 + 0.5),
        }))
      );
    }
  }, [loading]);

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || loading) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q, timestamp: Date.now() }]);
    setLoading(true);
    try {
      const r = await fetch(apiUrl("/chat"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, session_id: sessionId }),
      });
      if (!r.ok) {
        throw new Error(await errorTextFromResponse(r));
      }
      const data = (await r.json()) as ChatResponse;
      const assistantMsg: ChatMessage = {
        role: "assistant",
        content: data.answer,
        timestamp: Date.now(),
        meta: {
          sources: data.sources,
          trace: data.trace,
          grounded: data.grounded,
          critic_issues: data.critic_issues,
        },
      };
      setMessages((m) => [...m, assistantMsg]);

      setSessions((prev) => {
        const existing = prev.find((s) => s.id === sessionId);
        const newSession: ConversationSession = {
          id: sessionId,
          title: existing?.title || q.slice(0, 50) + (q.length > 50 ? "..." : ""),
          messageCount: (existing?.messageCount || 0) + 2,
          lastMessageAt: Date.now(),
          preview: data.answer.slice(0, 80) + "...",
        };
        const filtered = prev.filter((s) => s.id !== sessionId);
        const updated = [newSession, ...filtered].slice(0, settings.maxHistorySessions);
        saveSessions(updated);
        return updated;
      });

      if (data.grounded === false) {
        addToast("Answer may not be fully grounded in sources", "warning");
      }
    } catch (e) {
      const msg = friendlyNetworkError("Chat", e);
      setError(msg);
      addToast(msg, "error");
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Request error: ${msg}`,
          timestamp: Date.now(),
          meta: { sources: [], trace: [], grounded: null, critic_issues: "" },
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId, settings.maxHistorySessions, addToast]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const newSession = () => {
    const id = crypto.randomUUID();
    setSessionId(id);
    setMessages([]);
    setError(null);
    setAgentTraces([]);
    addToast("New conversation started", "success", 2000);
  };

  const selectSession = (id: string) => {
    if (id !== sessionId) {
      setSessionId(id);
      setMessages([]);
      setAgentTraces([]);
    }
  };

  const deleteSession = (id: string) => {
    setSessions((prev) => {
      const filtered = prev.filter((s) => s.id !== id);
      saveSessions(filtered);
      return filtered;
    });
    if (id === sessionId) {
      newSession();
    }
  };

  const onPickFile = async () => {
    const el = fileRef.current;
    const f = el?.files?.[0];
    if (!f) return;
    setIngestMsg(null);
    setIngesting(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const q = clearCollection ? "?clear_collection=true" : "";
      const r = await fetch(apiUrl(`/ingest${q}`), { method: "POST", body: fd });
      if (!r.ok) {
        throw new Error(await errorTextFromResponse(r));
      }
      const j = (await r.json()) as { chunks_upserted: number; path: string };
      setIngestMsg(`Indexed ${j.chunks_upserted} chunk(s).`);
      addToast(`Successfully indexed ${j.chunks_upserted} chunk(s)`, "success");
    } catch (e) {
      const msg = friendlyNetworkError("Ingest", e);
      setIngestMsg(msg);
      addToast(msg, "error");
    } finally {
      setIngesting(false);
      if (el) el.value = "";
    }
  };

  const handleSettingsUpdate = (newSettings: AppSettings) => {
    setSettings(newSettings);
    addToast("Settings saved", "success", 1500);
  };

  return (
    <div className="layout">
      {/* Background Decorative Blob */}
      <div className="bg-glow"></div>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />

      <header className="top-header">
        <div className="brand">
          <div className="logo-container">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          </div>
          <div className="brand-info">
            <h1 className="brand-title">Neural RAG</h1>
            <div className="brand-badge">Agent Workstation</div>
          </div>
        </div>
        <div className="header-controls">
          <div className="health-status">
            {healthLoading ? (
              <div className="status-pill loading">
                <span className="dot animate-pulse"></span> Indexing...
              </div>
            ) : health ? (
              <div className="health-grid">
                <div className={`status-pill ${health.redis ? "ok" : "bad"}`} title="Redis">
                  <span className="dot"></span> Cache
                </div>
                <div className={`status-pill ${health.qdrant ? "ok" : "bad"}`} title="Qdrant">
                  <span className="dot"></span> Brain
                </div>
                <div className="status-pill model">
                  {health.ollama_model}
                </div>
              </div>
            ) : (
              <div className="status-pill bad">
                <span className="dot pulse-red"></span> Offline
              </div>
            )}
          </div>
          <button
            className="theme-toggle"
            onClick={() => {
              const themes: AppSettings["theme"][] = ["dark", "light", "system"];
              const currentIndex = themes.indexOf(settings.theme);
              const nextTheme = themes[(currentIndex + 1) % themes.length];
              if (nextTheme) {
                setSettings({ ...settings, theme: nextTheme });
              }
            }}
            title={`Theme: ${settings.theme}`}
          >
            {settings.theme === "dark" && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
            )}
            {settings.theme === "light" && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
            )}
            {settings.theme === "system" && (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="3" width="20" height="14" rx="2" ry="2"></rect><line x1="8" y1="21" x2="16" y2="21"></line><line x1="12" y1="17" x2="12" y2="21"></line></svg>
            )}
          </button>
          <button
            className="theme-toggle"
            onClick={() => setShowSettings(true)}
            title="Settings"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>
          </button>
        </div>
      </header>

      <div className="main-container">
        <HistorySidebar
          sessions={sessions}
          currentSessionId={sessionId}
          onSelectSession={selectSession}
          onNewSession={newSession}
          onDeleteSession={deleteSession}
          isOpen={historyOpen}
          onToggle={() => setHistoryOpen(!historyOpen)}
        />

        <div className="content-area">
          {/* Agent Activity Overlay removed as per user request to prefer inline thinking indicator */}

          <div className="chat-scroll-wrapper">
            <ChatInterface
              messages={messages}
              loading={loading}
              currentAgentPhase={agentTraces.find((t) => t.status === "running")?.phase}
              onSendMessage={(content) => {
                setInput(content);
                setTimeout(() => void send(), 0);
              }}
            />
            <div ref={bottomRef} className="scroll-anchor" />
          </div>

          <div className="composer-wrapper">
            {error && <div className="error-banner">{error}</div>}
            <div className={`composer ${loading ? "disabled" : ""}`}>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask the collective agents..."
                rows={1}
                disabled={loading}
              />
              <button
                type="button"
                className="btn send"
                onClick={() => void send()}
                disabled={loading || !input.trim()}
              >
                {loading ? (
                  <span className="sending">
                    <span className="spinner"></span>
                  </span>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
                )}
              </button>
            </div>
          </div>
        </div>

        <aside className="right-sidebar">
          <div className="panel ingest-panel">
            <h3>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>
              Knowledge Ingest
            </h3>
            <p className="panel-desc">Embed PDF, TXT, or Markdown documents into the vector store.</p>

            <label className="checkbox-label">
              <input
                type="checkbox"
                checked={clearCollection}
                onChange={(e) => setClearCollection(e.target.checked)}
              />
              <span className="checkbox-custom"></span>
              Purge existing knowledge base
            </label>

            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.md,.markdown,.docx"
              className="file-input"
              onChange={() => void onPickFile()}
            />

            <button
              type="button"
              className="btn ingest-btn"
              disabled={ingesting}
              onClick={() => fileRef.current?.click()}
            >
              {ingesting ? (
                <span className="ingesting">
                  <span className="spinner small"></span>
                  Processing Vectors...
                </span>
              ) : (
                "Upload Document"
              )}
            </button>
            {ingestMsg && <div className={`ingest-msg ${ingestMsg.includes("Error") ? "error" : "success"}`}>{ingestMsg}</div>}
          </div>

          <div className="panel info-panel">
            <h3>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
              Telemetry
            </h3>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Active Session</span>
                <code className="info-value">{sessionId.slice(0, 8)}...</code>
              </div>
              <div className="info-item">
                <span className="info-label">Context Window</span>
                <span className="info-value">{messages.length} messages</span>
              </div>
              <div className="info-item">
                <span className="info-label">Vector DB Engine</span>
                <span className="info-value">{health?.qdrant_mode || "Remote API"}</span>
              </div>
              <div className="info-item">
                <span className="info-label">System Status</span>
                <span className={`info-value ${health?.status === "ok" ? "status-ok" : "status-warn"}`}>
                  {health?.status === "ok" ? "● Online" : "⚠ Degraded"}
                </span>
              </div>
            </div>
            <button type="button" className="btn secondary-btn" onClick={newSession}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}><path d="M12 5v14M5 12h14"></path></svg>
              Initialize New Run
            </button>
          </div>
        </aside>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          onUpdateSettings={handleSettingsUpdate}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
