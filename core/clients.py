"""Shared service clients (construction only)."""

from qdrant_client import QdrantClient

from core.config import Settings


def make_qdrant_client(settings: Settings) -> QdrantClient:
    """Remote Qdrant (Docker) or embedded in-process store (`QDRANT_MODE=memory`)."""
    mode = (settings.qdrant_mode or "remote").strip().lower()
    if mode == "memory":
        return QdrantClient(location=":memory:", check_compatibility=False)
    return QdrantClient(
        host=settings.qdrant_host,
        port=settings.qdrant_port,
        check_compatibility=False,
    )
