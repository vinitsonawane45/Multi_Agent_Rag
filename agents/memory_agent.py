"""Session memory: load and persist conversation turns in Redis."""

from __future__ import annotations

import json
from typing import Callable

import redis

from agents.state import MultiAgentState
from core.config import Settings


def _key(session_id: str) -> str:
    return f"mar:sess:{session_id}"


def load_history_text(r: redis.Redis, settings: Settings, session_id: str) -> str:
    key = _key(session_id)
    max_msgs = settings.session_history_max_messages
    raw = r.lrange(key, -max_msgs, -1)
    if not raw:
        return ""
    lines: list[str] = []
    for item in raw:
        try:
            obj = json.loads(item)
            role = obj.get("role", "?")
            content = (obj.get("content") or "").strip()
            if content:
                lines.append(f"{role.upper()}: {content}")
        except json.JSONDecodeError:
            continue
    return "\n".join(lines)


def append_turn(r: redis.Redis, session_id: str, role: str, content: str) -> None:
    key = _key(session_id)
    r.rpush(key, json.dumps({"role": role, "content": content}))


def make_memory_load_node(
    r: redis.Redis,
    settings: Settings,
) -> Callable[[MultiAgentState], MultiAgentState]:
    def memory_load(state: MultiAgentState) -> MultiAgentState:
        sid = state.get("session_id") or "default"
        hist = load_history_text(r, settings, sid)
        trace = (state.get("trace") or []) + ["memory_load"]
        return {
            "history_text": hist,
            "trace": trace,
        }

    return memory_load


def make_memory_save_node(
    r: redis.Redis,
) -> Callable[[MultiAgentState], MultiAgentState]:
    def memory_save(state: MultiAgentState) -> MultiAgentState:
        sid = state.get("session_id") or "default"
        q = (state.get("query") or "").strip()
        final = (state.get("final_answer") or "").strip()
        if q:
            append_turn(r, sid, "user", q)
        if final:
            append_turn(r, sid, "assistant", final)
        trace = (state.get("trace") or []) + ["memory_save"]
        return {"trace": trace}

    return memory_save
