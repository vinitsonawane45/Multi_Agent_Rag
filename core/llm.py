"""LLM factory: Groq-first with automatic Ollama fallback on timeout/error.

Priority:
  1. ChatGroq   — if GROQ_API_KEY is set.
  2. ChatOllama — if Groq times out, fails, or is not configured.

Usage
-----
from core.llm import get_llm_with_fallback, get_ollama_llm, is_timeout_or_connection_error

# Simple: auto-selects best available
llm = get_llm_with_fallback(settings, temperature=0.2)

# In agent loops that call bind_tools — use both so you can fall back if needed:
groq_llm  = get_llm_with_fallback(settings, temperature=0.2)
ollama_llm = get_ollama_llm(settings, temperature=0.2)
"""

from __future__ import annotations

import logging

import httpx
from langchain_core.language_models import BaseChatModel
from langchain_ollama import ChatOllama

from core.config import Settings

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Timeout / connectivity error detection
# ---------------------------------------------------------------------------

def is_timeout_or_connection_error(exc: BaseException) -> bool:
    """Return True for any error that means the LLM endpoint is unreachable or slow."""
    msg = str(exc).lower()
    if any(kw in msg for kw in ("timed out", "timeout", "time out", "connection refused",
                                "connect error", "connection error", "remotedisconnected",
                                "eof occurred", "reset by peer", "broken pipe")):
        return True
    return isinstance(exc, (
        httpx.ConnectError,
        httpx.TimeoutException,       # covers ReadTimeout, WriteTimeout, ConnectTimeout
        httpx.RemoteProtocolError,
        ConnectionRefusedError,
        TimeoutError,
    ))


# ---------------------------------------------------------------------------
# Client builders
# ---------------------------------------------------------------------------

def get_ollama_llm(settings: Settings, **kwargs) -> ChatOllama:
    """Return a ChatOllama client (does NOT ping first — call _ollama_is_reachable if needed)."""
    return ChatOllama(
        base_url=settings.ollama_base_url,
        model=settings.ollama_model,
        sync_client_kwargs={"timeout": float(settings.ollama_request_timeout_sec)},
        **kwargs,
    )


def _groq_is_configured(settings: Settings) -> bool:
    return bool(
        settings.groq_api_key
        and settings.groq_api_key.strip()
        and settings.groq_api_key != "your_groq_api_key_here"
    )


def _ollama_is_reachable(settings: Settings) -> bool:
    try:
        base = settings.ollama_base_url.rstrip("/")
        r = httpx.get(f"{base}/api/tags", timeout=3.0)
        return r.is_success
    except Exception:  # noqa: BLE001
        return False


def _make_groq(settings: Settings, **kwargs) -> BaseChatModel:
    try:
        from langchain_groq import ChatGroq  # noqa: PLC0415
    except ImportError as exc:
        raise RuntimeError("langchain-groq is not installed. Run: pip install langchain-groq") from exc

    return ChatGroq(
        api_key=settings.groq_api_key,
        model=settings.groq_model,
        request_timeout=float(settings.groq_request_timeout_sec),
        **kwargs,
    )


# ---------------------------------------------------------------------------
# Main factory
# ---------------------------------------------------------------------------

def get_llm_with_fallback(settings: Settings, **kwargs) -> BaseChatModel:
    """Return the best available LLM client.

    Order: Groq → Ollama.
    Does NOT make any API calls itself — just builds the client.
    """
    if _groq_is_configured(settings):
        try:
            llm = _make_groq(settings, **kwargs)
            logger.debug("LLM: Groq (%s)", settings.groq_model)
            return llm
        except Exception as exc:  # noqa: BLE001
            logger.warning("Could not build Groq client (%s) — falling back to Ollama.", exc)

    logger.info("LLM: Ollama (%s @ %s)", settings.ollama_model, settings.ollama_base_url)
    return get_ollama_llm(settings, **kwargs)


# ---------------------------------------------------------------------------
# invoke_with_fallback: full Groq → Ollama retry on timeout/connectivity error
# ---------------------------------------------------------------------------

def invoke_with_fallback(settings: Settings, messages, **llm_kwargs):
    """Invoke Groq; if it times out or errors, automatically retry on Ollama.

    Use this for simple (non-tool-calling) invocations.
    For tool-calling loops, use get_llm_with_fallback() + get_ollama_llm() directly
    and call invoke_llm_with_ollama_retry() instead.
    """
    primary = get_llm_with_fallback(settings, **llm_kwargs)
    try:
        return primary.invoke(messages)
    except Exception as exc:  # noqa: BLE001
        if is_timeout_or_connection_error(exc) and not isinstance(primary, ChatOllama):
            logger.warning("Primary LLM timed out (%s) — retrying on Ollama.", exc)
            return get_ollama_llm(settings, **llm_kwargs).invoke(messages)
        raise
