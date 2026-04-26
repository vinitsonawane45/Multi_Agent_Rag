"""Supervisor: linear multi-agent graph (memory → retrieve → tools+LLM → critic → finalize → memory)."""

from __future__ import annotations

import redis
from langgraph.graph import END, START, StateGraph
from qdrant_client import QdrantClient

from agents.coder_agent import make_coder_node
from agents.critic_agent import make_critic_node
from agents.memory_agent import make_memory_load_node, make_memory_save_node
from agents.retriever_agent import make_retriever_node
from agents.state import MultiAgentState
from core.config import Settings


def _finalize(state: MultiAgentState) -> MultiAgentState:
    draft = (state.get("draft_answer") or "").strip()
    revised = (state.get("revised_answer") or "").strip()
    grounded = state.get("critic_grounded", True)
    issues = (state.get("critic_issues") or "").strip()

    body = revised if revised else draft
    if not body:
        body = "No answer generated."

    if not grounded:
        note = "[Verification: not fully grounded in retrieved document snippets]"
        if issues:
            note = f"{note} — {issues}"
        body = f"{note}\n\n{body}"

    trace = (state.get("trace") or []) + ["finalize"]
    return {"final_answer": body, "trace": trace}


def make_route_after_critic(settings: Settings):
    def route(state: MultiAgentState) -> str:
        grounded = state.get("critic_grounded", True)
        retry_count = state.get("retry_count", 0)
        if not grounded and retry_count < settings.max_retries:
            return "coder_agent"
        return "finalize"
    return route


def build_graph(settings: Settings, redis_client: redis.Redis, qdrant_client: QdrantClient):
    g = StateGraph(MultiAgentState)
    g.add_node("memory_load", make_memory_load_node(redis_client, settings))
    g.add_node("retriever_agent", make_retriever_node(settings, qdrant_client))
    g.add_node("coder_agent", make_coder_node(settings))
    g.add_node("critic_agent", make_critic_node(settings))
    g.add_node("finalize", _finalize)
    g.add_node("memory_save", make_memory_save_node(redis_client))

    g.add_edge(START, "memory_load")
    g.add_edge("memory_load", "retriever_agent")
    g.add_edge("retriever_agent", "coder_agent")
    g.add_edge("coder_agent", "critic_agent")
    
    g.add_conditional_edges(
        "critic_agent",
        make_route_after_critic(settings),
        {"coder_agent": "coder_agent", "finalize": "finalize"}
    )
    
    g.add_edge("finalize", "memory_save")
    g.add_edge("memory_save", END)
    return g.compile()
