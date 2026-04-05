"""Retriever agent: turns the user question into grounded document context."""

from __future__ import annotations

from typing import Callable

from qdrant_client import QdrantClient

from agents.state import MultiAgentState
from core.config import Settings
from rag import retriever as rag_retriever


def format_context(chunks: list[dict]) -> str:
    if not chunks:
        return "(No indexed documents matched this query. Answer from general reasoning and tools only.)"
    parts: list[str] = []
    for i, c in enumerate(chunks, 1):
        src = c.get("source") or "unknown"
        text = (c.get("text") or "").strip()
        parts.append(f"--- Source {i}: {src} ---\n{text}")
    return "\n\n".join(parts)


def make_retriever_node(
    settings: Settings,
    qdrant: QdrantClient,
) -> Callable[[MultiAgentState], MultiAgentState]:
    def retrieve(state: MultiAgentState) -> MultiAgentState:
        q = (state.get("query") or "").strip()
        chunks = rag_retriever.retrieve(settings, qdrant, q)
        ctx = format_context(chunks)
        trace = (state.get("trace") or []) + ["retriever_agent"]
        return {
            "retrieved": chunks,
            "context_text": ctx,
            "trace": trace,
        }

    return retrieve
