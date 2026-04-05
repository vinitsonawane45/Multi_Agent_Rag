"""Critic agent: checks grounding against retrieved sources and suggests fixes.

LLM strategy:
  - Uses invoke_with_fallback() — Groq first, automatic Ollama retry on timeout.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Callable

from langchain_core.messages import HumanMessage, SystemMessage

from agents.state import MultiAgentState
from core.config import Settings
from core.llm import invoke_with_fallback

logger = logging.getLogger(__name__)

_SKIP_PREFIX = "⚠️"


def _parse_critic_json(text: str) -> dict[str, Any]:
    text = text.strip()
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return {}
    try:
        return json.loads(m.group())
    except json.JSONDecodeError:
        return {}


def make_critic_node(settings: Settings) -> Callable[[MultiAgentState], MultiAgentState]:
    def critic(state: MultiAgentState) -> MultiAgentState:
        query = (state.get("query") or "").strip()
        context = (state.get("context_text") or "").strip()
        draft = (state.get("draft_answer") or "").strip()
        trace = (state.get("trace") or []) + ["critic_agent"]

        # Skip critic when coder already failed — avoid double-error messages
        if draft.startswith(_SKIP_PREFIX):
            return {
                "critic_grounded": False,
                "critic_issues": "Skipped — coder_agent did not produce a valid draft.",
                "revised_answer": draft,
                "trace": trace,
            }

        sys = SystemMessage(
            content=(
                "You verify enterprise answers against provided SOURCE_SNIPPETS only for factual claims "
                "about the company or documents. Tool outputs (calculator, internal_metric_lookup) are "
                "trusted. Reply with ONLY a JSON object, no markdown fences, keys: "
                'grounded (boolean), confidence (0-1 number), issues (string), '
                'revised_answer (string — full answer user should see).'
            )
        )
        human = HumanMessage(
            content=(
                f"USER_QUESTION:\n{query}\n\n"
                f"SOURCE_SNIPPETS:\n{context}\n\n"
                f"DRAFT_ANSWER:\n{draft}\n"
            )
        )

        # invoke_with_fallback handles Groq → Ollama retry automatically on timeout
        try:
            out = invoke_with_fallback(settings, [sys, human], temperature=0.0)
            raw = (out.content or "").strip()
        except Exception as exc:  # noqa: BLE001
            logger.error("critic_agent: all LLM backends failed — %s", exc)
            return {
                "critic_grounded": False,
                "critic_issues": f"Critic unavailable (all backends failed): {exc}",
                "revised_answer": draft,  # pass the raw coder draft through unchanged
                "trace": trace,
            }

        data = _parse_critic_json(raw)

        # Model returned non-JSON — use raw text as the revised answer
        if not data:
            logger.warning("critic_agent: could not parse JSON from model output; using raw text.")
            return {
                "critic_grounded": True,
                "critic_issues": "Critic returned non-JSON; raw output used.",
                "revised_answer": raw if raw else draft,
                "trace": trace,
            }

        grounded = bool(data.get("grounded", True))
        issues = str(data.get("issues", "") or "")
        revised = str(data.get("revised_answer", "") or "").strip() or draft

        return {
            "critic_grounded": grounded,
            "critic_issues": issues,
            "revised_answer": revised,
            "trace": trace,
        }

    return critic
