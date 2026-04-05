import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type SourceItem = {
  score: number;
  text: string;
  source: string;
  chunk_id: number | null;
};

type Health = {
  status: string;
  redis: boolean;
  qdrant: boolean;
  ollama_ok?: boolean;
  qdrant_mode?: string;
  ollama_model: string;
  ollama_base_url: string;
  hints?: string[];
};

type ChatResponse = {
  answer: string;
  grounded: boolean | null;
  sources: SourceItem[];
  trace: string[];
  critic_issues: string;
};

type ChatMessage =
  | { role: "user"; content: string }
  | {
      role: "assistant";
      content: string;
      meta: Pick<ChatResponse, "sources" | "trace" | "grounded" | "critic_issues">;
    };

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
    return `${context}: connection failed (${m}). Target: ${target}. Keep uvicorn running; first PDF ingest and each chat can take several minutes (embeddings + Ollama). Start Ollama with \`ollama serve\` and pull your model.`;
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
  const [openMetaId, setOpenMetaId] = useState<number | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

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

  const send = useCallback(async () => {
    const q = input.trim();
    if (!q || loading) return;
    setError(null);
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }]);
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
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: data.answer,
          meta: {
            sources: data.sources,
            trace: data.trace,
            grounded: data.grounded,
            critic_issues: data.critic_issues,
          },
        },
      ]);
    } catch (e) {
      const msg = friendlyNetworkError("Chat", e);
      setError(msg);
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content: `Request error: ${msg}`,
          meta: { sources: [], trace: [], grounded: null, critic_issues: "" },
        },
      ]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, sessionId]);

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
    setOpenMetaId(null);
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
    } catch (e) {
      setIngestMsg(friendlyNetworkError("Ingest", e));
    } finally {
      setIngesting(false);
      if (el) el.value = "";
    }
  };

  const assistantIndex = useMemo(() => {
    let i = 0;
    return messages.map((m) => (m.role === "assistant" ? i++ : -1));
  }, [messages]);

  return (
    <div className="layout">
      <header className="top">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◆
          </span>
          <div>
            <h1>Multi-Agent RAG</h1>
            <p className="tagline">Retrieve · tools · memory · verification</p>
          </div>
        </div>
        <div className="health">
          {health ? (
            <>
              <span className={`pill ${health.redis ? "ok" : "bad"}`}>Redis</span>
              <span className={`pill ${health.qdrant ? "ok" : "bad"}`}>Qdrant</span>
              <span
                className={`pill ${health.ollama_ok === false ? "bad" : health.ollama_ok === true ? "ok" : "warn"}`}
                title={health.ollama_base_url}
              >
                Ollama
              </span>
              {health.qdrant_mode === "memory" ? (
                <span className="pill warn" title="In-process Qdrant; data clears when API restarts">
                  Qdrant: memory
                </span>
              ) : null}
              <span className="pill muted" title={health.ollama_base_url}>
                {health.ollama_model}
              </span>
            </>
          ) : (
            <span className="pill warn">API offline</span>
          )}
        </div>
      </header>

      {health?.hints && health.hints.length > 0 ? (
        <div className="health-hints" role="status">
          {health.hints.map((h, i) => (
            <p key={i}>{h}</p>
          ))}
        </div>
      ) : null}

      <div className="shell">
        <aside className="sidebar">
          {!healthLoading && health === null ? (
            <div className="api-offline" role="status">
              <strong>Backend not reachable</strong>
              <p>
                The UI talks to the API on <code>127.0.0.1:8000</code>. Start it in a <em>second</em> terminal from
                the project root (folder that contains <code>api</code>), not inside <code>ui</code>:
              </p>
              <pre className="cmd">
                cd C:\Users\vinit\multi-agent-rag{"\n"}
                .\venv\Scripts\activate{"\n"}
                uvicorn api.main:app --reload --host 127.0.0.1 --port 8000
              </pre>
              <p className="hint-small">
                If the API is already running, restart <code>npm run dev</code> after changing{" "}
                <code>ui/.env.development</code>. Also run Redis + Qdrant (<code>docker compose up -d</code>) and
                Ollama.
              </p>
            </div>
          ) : null}
          <label className="field">
            <span>Session ID</span>
            <input
              value={sessionId}
              onChange={(e) => setSessionId(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <button type="button" className="btn secondary" onClick={newSession}>
            New session
          </button>

          <div className="panel">
            <h2>Ingest documents</h2>
            <p className="hint">PDF, TXT, or Markdown → Qdrant</p>
            <label className="check">
              <input
                type="checkbox"
                checked={clearCollection}
                onChange={(e) => setClearCollection(e.target.checked)}
              />
              Clear collection first
            </label>
            <input
              ref={fileRef}
              type="file"
              accept=".pdf,.txt,.md,.markdown"
              className="file"
              onChange={() => void onPickFile()}
            />
            <button
              type="button"
              className="btn"
              disabled={ingesting}
              onClick={() => fileRef.current?.click()}
            >
              {ingesting ? "Uploading…" : "Choose file"}
            </button>
            {ingestMsg ? <p className="ingest-msg">{ingestMsg}</p> : null}
          </div>

          <p className="footer-note">
            Dev: run API on <code>:8000</code>, UI proxies <code>/chat</code> from Vite. Override with{" "}
            <code>VITE_API_URL</code>.
          </p>
        </aside>

        <main className="chat">
          <div className="messages">
            {messages.length === 0 ? (
              <div className="empty">
                <h2>Ask your knowledge base</h2>
                <p>
                  Upload documents in the sidebar, then ask questions. The pipeline runs memory → retrieval →
                  tools-aware answer → critic.
                </p>
              </div>
            ) : null}
            {messages.map((m, idx) => {
              if (m.role === "user") {
                return (
                  <div key={idx} className="bubble user">
                    <div className="bubble-label">You</div>
                    <div className="bubble-body">{m.content}</div>
                  </div>
                );
              }
              const aiIdx = assistantIndex[idx] ?? 0;
              const open = openMetaId === aiIdx;
              return (
                <div key={idx} className="bubble assistant">
                  <div className="bubble-label row">
                    <span>Assistant</span>
                    {m.meta.grounded === false ? (
                      <span className="badge warn">Review</span>
                    ) : m.meta.grounded === true ? (
                      <span className="badge ok">Grounded</span>
                    ) : null}
                  </div>
                  <div className="bubble-body answer">{m.content}</div>
                  <button
                    type="button"
                    className="meta-toggle"
                    onClick={() => setOpenMetaId(open ? null : aiIdx)}
                  >
                    {open ? "Hide sources & trace" : "Sources & agent trace"}
                  </button>
                  {open ? (
                    <div className="meta">
                      {m.meta.critic_issues ? (
                        <div className="critic">
                          <strong>Critic</strong>
                          <p>{m.meta.critic_issues}</p>
                        </div>
                      ) : null}
                      <div>
                        <strong>Trace</strong>
                        <ol className="trace">
                          {m.meta.trace.map((t, i) => (
                            <li key={i}>{t}</li>
                          ))}
                        </ol>
                      </div>
                      <div>
                        <strong>Sources ({m.meta.sources.length})</strong>
                        <ul className="sources">
                          {m.meta.sources.map((s, i) => (
                            <li key={i}>
                              <div className="src-head">
                                <span className="src-title">#{i + 1}</span>
                                <span className="src-score">{s.score.toFixed(3)}</span>
                              </div>
                              <div className="src-path" title={s.source}>
                                {s.source.split(/[/\\]/).pop() ?? s.source}
                              </div>
                              <pre className="src-text">{s.text}</pre>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {error ? <div className="banner error">{error}</div> : null}

          <div className="composer">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask a question… (Enter to send, Shift+Enter for newline)"
              rows={3}
              disabled={loading}
            />
            <button type="button" className="btn send" onClick={() => void send()} disabled={loading || !input.trim()}>
              {loading ? "Working…" : "Send"}
            </button>
          </div>
          {loading ? (
            <p className="composer-hint">
              Retrieval + multi-agent + Ollama runs on the server. On a CPU that can take several minutes — leave this
              tab open. If it fails instantly, check the <strong>Ollama</strong> pill above is green.
            </p>
          ) : null}
        </main>
      </div>

      <style>{`
        .layout { display: flex; flex-direction: column; height: 100%; min-height: 100vh; }
        .top {
          display: flex; align-items: center; justify-content: space-between;
          gap: 1rem; padding: 0.75rem 1.25rem;
          border-bottom: 1px solid var(--border);
          background: linear-gradient(180deg, var(--surface) 0%, var(--bg) 100%);
        }
        .brand { display: flex; align-items: center; gap: 0.75rem; }
        .logo { font-size: 1.75rem; color: var(--accent); line-height: 1; }
        .brand h1 { margin: 0; font-size: 1.1rem; font-weight: 600; letter-spacing: 0.02em; }
        .tagline { margin: 0.15rem 0 0; font-size: 0.75rem; color: var(--muted); }
        .health { display: flex; flex-wrap: wrap; gap: 0.35rem; justify-content: flex-end; }
        .pill {
          font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.06em;
          padding: 0.2rem 0.5rem; border-radius: 999px; border: 1px solid var(--border);
          background: var(--surface-2); font-weight: 600;
        }
        .pill.ok { border-color: #1f4a35; color: var(--ok); }
        .pill.bad { border-color: #5c2a2a; color: var(--bad); }
        .pill.warn { border-color: #5c4a1f; color: var(--warn); }
        .pill.muted { color: var(--muted); font-weight: 500; text-transform: none; letter-spacing: 0; }

        .health-hints {
          padding: 0.5rem 1.25rem; border-bottom: 1px solid #5c4a1f;
          background: #1f1a12; font-size: 0.78rem; color: #fde68a; line-height: 1.4;
        }
        .health-hints p { margin: 0.2rem 0; }

        .shell { flex: 1; display: grid; grid-template-columns: minmax(240px, 280px) 1fr; min-height: 0; }
        @media (max-width: 840px) {
          .shell { grid-template-columns: 1fr; }
          .sidebar { border-right: none; border-bottom: 1px solid var(--border); max-height: 42vh; overflow: auto; }
        }
        .sidebar {
          padding: 1rem; border-right: 1px solid var(--border);
          background: var(--surface); display: flex; flex-direction: column; gap: 0.75rem;
        }
        .api-offline {
          padding: 0.75rem; border-radius: 10px; border: 1px solid #5c2a2a;
          background: #1f1212; font-size: 0.78rem; line-height: 1.45; color: var(--muted);
        }
        .api-offline strong { color: #fecaca; display: block; margin-bottom: 0.35rem; }
        .api-offline p { margin: 0.35rem 0; }
        .api-offline code { font-family: var(--mono); font-size: 0.88em; color: var(--accent-dim); }
        .api-offline .cmd {
          margin: 0.4rem 0; padding: 0.5rem 0.55rem; border-radius: 8px;
          background: #0a0d11; border: 1px solid var(--border); color: var(--text);
          font-family: var(--mono); font-size: 0.72rem; white-space: pre-wrap; overflow-x: auto;
        }
        .hint-small { font-size: 0.72rem !important; margin-top: 0.5rem !important; }
        .field { display: flex; flex-direction: column; gap: 0.35rem; font-size: 0.8rem; color: var(--muted); }
        .field input {
          padding: 0.45rem 0.55rem; border-radius: 6px; border: 1px solid var(--border);
          background: var(--bg); color: var(--text);
        }
        .btn {
          border: none; border-radius: 8px; padding: 0.55rem 0.85rem; font-weight: 600;
          background: var(--accent); color: #061018;
        }
        .btn:disabled { opacity: 0.55; cursor: not-allowed; }
        .btn.secondary {
          background: transparent; color: var(--text); border: 1px solid var(--border);
        }
        .panel {
          margin-top: 0.5rem; padding: 0.85rem; border-radius: 10px;
          border: 1px solid var(--border); background: var(--surface-2);
        }
        .panel h2 { margin: 0 0 0.35rem; font-size: 0.85rem; font-weight: 600; }
        .hint { margin: 0 0 0.5rem; font-size: 0.75rem; color: var(--muted); }
        .check { display: flex; align-items: center; gap: 0.4rem; font-size: 0.8rem; margin-bottom: 0.5rem; color: var(--muted); }
        .file { display: none; }
        .ingest-msg { margin: 0.5rem 0 0; font-size: 0.8rem; color: var(--muted); }
        .footer-note { margin-top: auto; font-size: 0.68rem; color: var(--muted); line-height: 1.4; }
        .footer-note code { font-family: var(--mono); font-size: 0.9em; color: var(--accent-dim); }

        .chat { display: flex; flex-direction: column; min-height: 0; background: var(--bg); }
        .messages {
          flex: 1; overflow: auto; padding: 1rem 1.25rem;
          display: flex; flex-direction: column; gap: 0.85rem;
        }
        .empty {
          margin: auto; max-width: 420px; text-align: center; color: var(--muted);
          padding: 2rem 1rem;
        }
        .empty h2 { color: var(--text); font-size: 1.1rem; margin: 0 0 0.5rem; }
        .bubble { max-width: min(720px, 100%); align-self: flex-start; }
        .bubble.user { align-self: flex-end; }
        .bubble-label {
          font-size: 0.65rem; text-transform: uppercase; letter-spacing: 0.08em;
          color: var(--muted); margin-bottom: 0.25rem;
        }
        .bubble-label.row { display: flex; align-items: center; gap: 0.5rem; }
        .badge { font-size: 0.6rem; padding: 0.15rem 0.4rem; border-radius: 4px; font-weight: 700; }
        .badge.ok { background: #143527; color: var(--ok); }
        .badge.warn { background: #3d3514; color: var(--warn); }
        .bubble-body {
          padding: 0.65rem 0.85rem; border-radius: 12px; border: 1px solid var(--border);
          background: var(--surface); line-height: 1.45; font-size: 0.95rem;
        }
        .bubble.user .bubble-body { background: #1a2736; border-color: #2a3e54; }
        .answer { white-space: pre-wrap; word-break: break-word; }
        .meta-toggle {
          margin-top: 0.35rem; background: none; border: none; color: var(--accent);
          font-size: 0.78rem; padding: 0; text-decoration: underline;
        }
        .meta {
          margin-top: 0.5rem; padding: 0.65rem 0.75rem; border-radius: 10px;
          border: 1px dashed var(--border); background: var(--surface);
          font-size: 0.8rem;
        }
        .meta strong { display: block; margin-bottom: 0.35rem; color: var(--text); }
        .trace { margin: 0; padding-left: 1.1rem; color: var(--muted); }
        .sources { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 0.65rem; }
        .sources li {
          border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem 0.55rem;
          background: var(--surface-2);
        }
        .src-head { display: flex; justify-content: space-between; align-items: center; }
        .src-title { font-weight: 700; color: var(--accent); }
        .src-score { font-family: var(--mono); font-size: 0.72rem; color: var(--muted); }
        .src-path { font-size: 0.72rem; color: var(--muted); margin: 0.2rem 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .src-text {
          margin: 0; max-height: 140px; overflow: auto; font-family: var(--mono);
          font-size: 0.72rem; color: var(--text); white-space: pre-wrap;
        }
        .critic { margin-bottom: 0.75rem; color: var(--warn); }
        .critic p { margin: 0.25rem 0 0; color: var(--muted); }

        .banner.error {
          margin: 0 1.25rem; padding: 0.5rem 0.75rem; border-radius: 8px;
          background: #2a1515; border: 1px solid #5c2a2a; color: #fecaca; font-size: 0.85rem;
        }
        .composer {
          display: grid; grid-template-columns: 1fr auto; gap: 0.65rem;
          padding: 0.85rem 1.25rem 1.1rem; border-top: 1px solid var(--border);
          background: var(--surface);
        }
        .composer textarea {
          resize: vertical; min-height: 72px; max-height: 200px;
          padding: 0.6rem 0.75rem; border-radius: 10px; border: 1px solid var(--border);
          background: var(--bg); color: var(--text);
        }
        .composer textarea:focus { outline: 2px solid var(--accent-dim); outline-offset: 1px; }
        .btn.send { align-self: end; min-width: 96px; }
        .composer-hint {
          margin: 0 1.25rem 1rem; padding: 0.5rem 0.75rem; border-radius: 8px;
          font-size: 0.78rem; color: var(--muted); background: var(--surface-2); border: 1px solid var(--border);
        }
      `}</style>
    </div>
  );
}
