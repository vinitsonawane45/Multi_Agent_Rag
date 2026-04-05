"""Coder / tools agent: synthesizes an answer using retrieval context and tools.

LLM strategy:
  - Tries Groq first (fast cloud inference).
  - If Groq times out or errors, automatically retries the ENTIRE synthesis on Ollama.
"""

from __future__ import annotations

import logging
from typing import Callable

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage, ToolMessage
from langchain_core.language_models import BaseChatModel

from agents.state import MultiAgentState
from agents.tools import all_tools
from core.config import Settings
from core.llm import get_llm_with_fallback, get_ollama_llm, is_timeout_or_connection_error

logger = logging.getLogger(__name__)


def _build_messages(query: str, history: str, context: str):
    sys = SystemMessage(
        content=(
            "You are the research assistant for an enterprise knowledge base.\n"
            "Use SOURCE_SNIPPETS as the primary evidence. If the user needs arithmetic, "
            "call calculator. For fixed internal KPIs not in the snippets, call internal_metric_lookup.\n"
            "Cite which source index (Source 1, 2, …) supports key claims when possible.\n"
            "If sources are empty or irrelevant, say so and rely on tools or careful reasoning."
        )
    )
    hist_block = f"PRIOR_SESSION_TURNS:\n{history}\n\n" if history else ""
    human = HumanMessage(
        content=(
            f"{hist_block}"
            f"USER_QUESTION:\n{query}\n\n"
            f"SOURCE_SNIPPETS:\n{context}\n"
        )
    )
    return [sys, human]


def _run_synthesis(llm_tools: BaseChatModel, tool_by_name: dict, messages: list, backend_name: str) -> str:
    """Run the tool-calling synthesis loop. Returns draft string."""
    max_steps = 8
    for step in range(max_steps):
        ai: AIMessage = llm_tools.invoke(messages)
        messages.append(ai)
        calls = getattr(ai, "tool_calls", None) or []
        if not calls:
            return (ai.content or "").strip()

        for call in calls:
            if isinstance(call, dict):
                name = str(call.get("name") or "")
                args = call.get("args") or {}
                tid = call.get("id") or name
            else:
                name = str(getattr(call, "name", "") or "")
                args = getattr(call, "args", None) or {}
                tid = getattr(call, "id", None) or name

            fn = tool_by_name.get(name)
            if fn is None:
                out = f"unknown tool {name}"
            else:
                try:
                    out = fn.invoke(args)
                except Exception as e:  # noqa: BLE001
                    out = f"tool error: {e}"
            messages.append(ToolMessage(content=str(out), tool_call_id=str(tid)))

    return ""  # exhausted max_steps


def make_coder_node(settings: Settings) -> Callable[[MultiAgentState], MultiAgentState]:
    tools = all_tools()
    tool_by_name = {t.name: t for t in tools}

    def synthesize(state: MultiAgentState) -> MultiAgentState:
        query = (state.get("query") or "").strip()
        history = (state.get("history_text") or "").strip()
        context = (state.get("context_text") or "").strip()
        trace = (state.get("trace") or []) + ["coder_agent"]

        draft = ""

        # ── Attempt 1: primary LLM (Groq if configured, else Ollama) ──────────
        try:
            primary_llm = get_llm_with_fallback(settings, temperature=0.2)
            primary_llm_tools = primary_llm.bind_tools(tools)
            backend = "Groq" if not hasattr(primary_llm, "base_url") else "Ollama"
            logger.info("coder_agent: using %s for synthesis.", backend)

            messages = _build_messages(query, history, context)
            draft = _run_synthesis(primary_llm_tools, tool_by_name, messages, backend)

        except Exception as exc:  # noqa: BLE001
            if is_timeout_or_connection_error(exc):
                logger.warning(
                    "coder_agent: %s timed out / unreachable (%s) — retrying on Ollama.",
                    backend if "backend" in dir() else "Primary LLM",
                    exc,
                )
                # ── Attempt 2: Ollama fallback ─────────────────────────────────
                try:
                    ollama_llm = get_ollama_llm(settings, temperature=0.2)
                    ollama_llm_tools = ollama_llm.bind_tools(tools)
                    messages = _build_messages(query, history, context)  # fresh messages
                    draft = _run_synthesis(ollama_llm_tools, tool_by_name, messages, "Ollama")
                    logger.info("coder_agent: Ollama fallback succeeded.")
                except Exception as ollama_exc:  # noqa: BLE001
                    logger.error("coder_agent: Ollama fallback also failed — %s", ollama_exc)
                    draft = (
                        f"⚠️ Both Groq and Ollama failed to produce an answer.\n\n"
                        f"• Groq error: {exc}\n"
                        f"• Ollama error: {ollama_exc}\n\n"
                        f"**Actions to try:**\n"
                        f"1. Check your GROQ_API_KEY in `.env` at https://console.groq.com\n"
                        f"2. Start Ollama locally: `ollama serve` then `ollama pull {settings.ollama_model}`\n"
                        f"3. Restart the API: `uvicorn api.main:app --reload`"
                    )
            else:
                logger.error("coder_agent: non-timeout LLM error — %s", exc)
                draft = (
                    f"⚠️ Language model returned an unexpected error.\n"
                    f"Technical detail: {exc}"
                )

        if not draft:
            draft = "I could not produce a final answer within the step limit. Please try rephrasing."

        return {"draft_answer": draft, "trace": trace}

    return synthesize
