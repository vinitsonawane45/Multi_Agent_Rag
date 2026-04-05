"""FastAPI entrypoint: chat (multi-agent graph), ingest, health."""

from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

import httpx
import redis
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from qdrant_client import QdrantClient

from agents.supervisor import build_graph
from core.clients import make_qdrant_client
from core.config import Settings, get_settings
from rag.ingest import ingest_paths

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    s = get_settings()
    app.state.settings = s
    app.state.redis = redis.Redis(
        host=s.redis_host,
        port=s.redis_port,
        db=s.redis_db,
        decode_responses=True,
    )
    app.state.qdrant = make_qdrant_client(s)
    app.state.graph = build_graph(s, app.state.redis, app.state.qdrant)
    Path("data/uploads").mkdir(parents=True, exist_ok=True)
    yield
    app.state.redis.close()


app = FastAPI(title="Multi-Agent RAG", version="0.1.0", lifespan=lifespan)

_s = get_settings()
_origins = [o.strip() for o in _s.cors_origins.split(",") if o.strip()]
if _origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


@app.get("/")
def root() -> dict:
    return {"service": "multi-agent-rag", "docs": "/docs", "health": "/health"}


class ChatRequest(BaseModel):
    query: str = Field(..., min_length=1)
    session_id: str = "default"


class SourceItem(BaseModel):
    score: float
    text: str
    source: str
    chunk_id: int | None = None


class ChatResponse(BaseModel):
    answer: str
    grounded: bool | None = None
    sources: list[SourceItem]
    trace: list[str]
    critic_issues: str = ""


@app.get("/health")
def health() -> dict:
    s: Settings = app.state.settings
    redis_ok = False
    qdrant_ok = False
    try:
        redis_ok = bool(app.state.redis.ping())
    except redis.exceptions.RedisError:
        redis_ok = False
    try:
        app.state.qdrant.get_collections()
        qdrant_ok = True
    except Exception:  # noqa: BLE001
        qdrant_ok = False

    ollama_ok = False
    try:
        base = s.ollama_base_url.rstrip("/")
        r = httpx.get(f"{base}/api/tags", timeout=3.0)
        ollama_ok = r.is_success
    except Exception:  # noqa: BLE001
        ollama_ok = False

    # ── Groq fallback check ───────────────────────────────────────────────────
    groq_configured = bool(
        s.enable_groq_fallback
        and s.groq_api_key
        and s.groq_api_key != "your_groq_api_key_here"
    )

    if groq_configured:
        active_llm = f"groq/{s.groq_model} (primary)"
    elif ollama_ok:
        active_llm = f"ollama/{s.ollama_model} (fallback)"
    else:
        active_llm = "none"

    hints: list[str] = []
    if not redis_ok:
        hints.append(
            "Redis is unreachable. Start Redis (e.g. `docker compose up -d` from the project root; default port 6379)."
        )
    if not qdrant_ok:
        hints.append(
            f"Qdrant is unreachable at {s.qdrant_host}:{s.qdrant_port}. "
            "Install/start Docker and run `docker compose up -d`, or set `QDRANT_MODE=memory` in `.env` "
            "to use in-process Qdrant (good for dev; vectors reset when the API restarts)."
        )
    if not ollama_ok:
        hints.append(
            f"Ollama is not reachable at {s.ollama_base_url}. Install from https://ollama.com and run "
            f"`ollama serve`, then `ollama pull {s.ollama_model}`."
        )
        if not groq_configured:
            hints.append(
                "Groq fallback is also not configured. Set GROQ_API_KEY in .env to enable automatic "
                "fallback to Groq when Ollama is unavailable. Get a free key at https://console.groq.com"
            )

    core_ok = redis_ok and qdrant_ok
    llm_ok = ollama_ok or groq_configured
    return {
        "status": "ok" if (core_ok and llm_ok) else "degraded",
        "redis": redis_ok,
        "qdrant": qdrant_ok,
        "ollama_ok": ollama_ok,
        "groq_configured": groq_configured,
        "active_llm": active_llm,
        "qdrant_mode": (s.qdrant_mode or "remote").strip().lower(),
        "ollama_model": s.ollama_model,
        "ollama_base_url": s.ollama_base_url,
        "groq_model": s.groq_model if groq_configured else None,
        "hints": hints,
    }


@app.post("/chat", response_model=ChatResponse)
def chat(body: ChatRequest) -> ChatResponse:
    try:
        graph = app.state.graph
        out = graph.invoke(
            {
                "session_id": (body.session_id or "default").strip() or "default",
                "query": body.query.strip(),
            }
        )
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        logger.exception("chat pipeline failed")
        raise HTTPException(
            status_code=503,
            detail=(
                "The AI pipeline crashed or could not reach Ollama. "
                "Confirm `ollama serve` is running and `ollama pull "
                f"{app.state.settings.ollama_model}` completed. Technical detail: {e!s}"
            ),
        ) from e

    raw_sources = out.get("retrieved") or []
    sources = [
        SourceItem(
            score=float(x.get("score", 0.0)),
            text=str(x.get("text", "")),
            source=str(x.get("source", "")),
            chunk_id=x.get("chunk_id"),
        )
        for x in raw_sources
    ]
    return ChatResponse(
        answer=str(out.get("final_answer") or ""),
        grounded=out.get("critic_grounded"),
        sources=sources,
        trace=list(out.get("trace") or []),
        critic_issues=str(out.get("critic_issues") or ""),
    )


@app.post("/ingest")
async def ingest_file(
    file: UploadFile = File(...),
    clear_collection: bool = False,
) -> dict:
    s: Settings = app.state.settings
    qc: QdrantClient = app.state.qdrant
    if not file.filename:
        raise HTTPException(status_code=400, detail="Missing filename")
    safe_name = Path(file.filename).name
    dest = Path("data/uploads") / f"{uuid.uuid4().hex}_{safe_name}"
    max_b = s.max_upload_bytes
    parts: list[bytes] = []
    total = 0
    while True:
        chunk = await file.read(1024 * 1024)
        if not chunk:
            break
        total += len(chunk)
        if total > max_b:
            raise HTTPException(
                status_code=413,
                detail=f"File too large (max {max_b // (1024 * 1024)} MB).",
            )
        parts.append(chunk)
    data = b"".join(parts)
    if not data:
        raise HTTPException(status_code=400, detail="Empty file")
    try:
        dest.write_bytes(data)
        n = ingest_paths(s, qc, [dest], clear_collection=clear_collection)
    except Exception as e:  # noqa: BLE001
        logger.exception("ingest failed")
        raise HTTPException(
            status_code=500,
            detail=f"Ingest or embedding failed: {e!s}",
        ) from e
    return {"chunks_upserted": n, "path": str(dest.resolve())}
