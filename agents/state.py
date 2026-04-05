"""Shared LangGraph state for the multi-agent workflow."""

from __future__ import annotations

from typing import Any, TypedDict


class MultiAgentState(TypedDict, total=False):
    """State passed between supervisor nodes."""

    session_id: str
    query: str
    history_text: str
    retrieved: list[dict[str, Any]]
    context_text: str
    draft_answer: str
    critic_grounded: bool
    critic_issues: str
    revised_answer: str
    final_answer: str
    trace: list[str]
