# Multi-Agent RAG

A production-ready multi-agent retrieval-augmented generation (RAG) system built with **LangGraph**, **FastAPI**, **Qdrant**, and **Redis**. The system uses a pipeline of specialised agents (retriever → coder/tools → critic → memory) to deliver grounded, verified answers from your enterprise documents.

---

## ✨ Features

- **Multi-agent pipeline** — Supervisor orchestrates Retriever → Coder → Critic → Memory agents via LangGraph
- **Hybrid RAG** — Dense vector search (Qdrant + sentence-transformers) with BM25 sparse retrieval
- **Groq-first LLM** — Uses Groq (blazing fast cloud inference) by default; automatically falls back to local Ollama when Groq is unavailable
- **Session memory** — Per-session conversation history stored in Redis
- **Document ingest** — Upload PDF, DOCX, and other file types via REST API
- **React UI** — Vite + React frontend with real-time chat
- **Health endpoint** — `/health` reports status of Redis, Qdrant, Ollama, and Groq

---

## 📁 Project Layout

```
multi-agent-rag/
├── agents/
│   ├── supervisor.py        # LangGraph graph builder
│   ├── coder_agent.py       # Answer synthesis (LLM + tools)
│   ├── critic_agent.py      # Grounding & revision
│   ├── retriever_agent.py   # Vector search → context
│   ├── memory_agent.py      # Redis session history
│   ├── tools.py             # Calculator, internal_metric_lookup
│   └── state.py             # MultiAgentState TypedDict
├── core/
│   ├── config.py            # Pydantic Settings (reads .env)
│   ├── clients.py           # Qdrant client factory
│   └── llm.py               # LLM factory — Groq-first, Ollama fallback
├── rag/
│   ├── ingest.py            # Document loading + chunking + embedding
│   └── retriever.py         # Hybrid dense + BM25 retrieval
├── api/
│   └── main.py              # FastAPI app (chat, ingest, health)
├── ui/                      # Vite + React frontend
├── eval/                    # RAGAS evaluation scripts
├── data/uploads/            # Uploaded documents (auto-created)
├── docker-compose.yml       # Qdrant + Redis stack
├── requirements.txt
└── .env                     # Local secrets (never commit this)
```

---

## ⚡ Quick Start

### 1. Prerequisites

| Service | Purpose | Install |
|---------|---------|---------|
| Python 3.11+ | Runtime | [python.org](https://python.org) |
| Node 18+ | UI dev server | [nodejs.org](https://nodejs.org) |
| Docker (optional) | Qdrant + Redis | [docker.com](https://docker.com) |
| Ollama (optional) | Local LLM fallback | [ollama.com](https://ollama.com) |

### 2. Clone & Install

```bash
git clone <your-repo-url>
cd multi-agent-rag

# Python dependencies
python -m venv venv
venv\Scripts\activate          # Windows
# source venv/bin/activate     # macOS / Linux
pip install -r requirements.txt
```

### 3. Configure `.env`

Copy the example and fill in your values:

```env
# ── LLM ───────────────────────────────────────────────
# PRIMARY: Groq (fast cloud inference — free tier available)
# Get your key at https://console.groq.com
GROQ_API_KEY=gsk_xxxxxxxxxxxxxxxxxxxxxxxx
GROQ_MODEL=llama3-8b-8192

# FALLBACK: Local Ollama (used when Groq is unavailable)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=mistral

# ── Vector DB ──────────────────────────────────────────
QDRANT_HOST=localhost
QDRANT_PORT=6333
QDRANT_MODE=memory   # or "remote" when using Docker

# ── Memory ─────────────────────────────────────────────
REDIS_HOST=localhost
REDIS_PORT=6379
```

> **LLM Priority:** Groq is used first (faster). If `GROQ_API_KEY` is missing or invalid, the system automatically falls back to local Ollama.

### 4. Start Infrastructure

**Option A — Docker (recommended):**
```bash
docker compose up -d
```

**Option B — No Docker (dev mode):**
```env
# Set in .env:
QDRANT_MODE=memory
```
Then start Redis manually or use a Redis cloud instance.

### 5. (Optional) Pull Ollama Model for Fallback

```bash
ollama serve
ollama pull mistral
```

### 6. Start the API

```bash
cd multi-agent-rag
venv\Scripts\activate
uvicorn api.main:app --reload --host 0.0.0.0 --port 8000
```

API docs: [http://localhost:8000/docs](http://localhost:8000/docs)

### 7. Start the UI

```bash
cd ui
npm install
npm run dev
```

UI: [http://localhost:5173](http://localhost:5173)

---

## 🔌 API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/` | Service info |
| `GET` | `/health` | Status of all dependencies + active LLM |
| `POST` | `/chat` | Send a query, get a grounded answer |
| `POST` | `/ingest` | Upload a document for indexing |
| `GET` | `/docs` | Interactive Swagger UI |

### Chat Example

```bash
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"query": "What is our Q3 revenue?", "session_id": "user-123"}'
```

**Response:**
```json
{
  "answer": "Based on Source 1, Q3 revenue was $4.2M ...",
  "grounded": true,
  "sources": [{"score": 0.92, "text": "...", "source": "q3_report.pdf"}],
  "trace": ["memory_load", "retriever_agent", "coder_agent", "critic_agent", "finalize", "memory_save"],
  "critic_issues": ""
}
```

---

## 🤖 Agent Pipeline

```
User Query
    │
    ▼
memory_load      ← Load session history from Redis
    │
    ▼
retriever_agent  ← Hybrid vector + BM25 search in Qdrant
    │
    ▼
coder_agent      ← LLM synthesis with tool calling (Groq → Ollama fallback)
    │
    ▼
critic_agent     ← Grounding check + answer revision (Groq → Ollama fallback)
    │
    ▼
finalize         ← Assemble final response
    │
    ▼
memory_save      ← Save turn to Redis
```

---

## 🔄 LLM Fallback Strategy

| Priority | Backend | Condition |
|----------|---------|-----------|
| 1st | **Groq** | `GROQ_API_KEY` is set in `.env` |
| 2nd | **Ollama** | Groq unavailable; Ollama responds to ping |
| Error | — | Both unavailable → clear error message returned |

Check active LLM at runtime:
```bash
curl http://localhost:8000/health | python -m json.tool
# "active_llm": "groq/llama3-8b-8192"   (or "ollama/mistral (fallback)")
```

---

## 📄 Licence

MIT

