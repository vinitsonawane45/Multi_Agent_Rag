"""Dense vector retrieval against Qdrant."""

from __future__ import annotations

from typing import Any

from langchain_community.embeddings import HuggingFaceEmbeddings
from qdrant_client import QdrantClient
from qdrant_client.models import FieldCondition, Filter, MatchValue

from core.config import Settings


def _embeddings(settings: Settings) -> HuggingFaceEmbeddings:
    return HuggingFaceEmbeddings(
        model_name=settings.embedding_model,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )


def ensure_collection(client: QdrantClient, collection: str, vector_size: int) -> None:
    names = {c.name for c in client.get_collections().collections}
    if collection not in names:
        client.create_collection(
            collection_name=collection,
            vectors_config={"size": vector_size, "distance": "Cosine"},
        )


def embed_query(settings: Settings, text: str) -> list[float]:
    emb = _embeddings(settings)
    v = emb.embed_query(text)
    return list(v)


def retrieve(
    settings: Settings,
    client: QdrantClient,
    query: str,
    top_k: int | None = None,
    source_prefix: str | None = None,
) -> list[dict[str, Any]]:
    k = top_k if top_k is not None else settings.retrieval_top_k
    vector = embed_query(settings, query)
    query_filter = None
    if source_prefix:
        query_filter = Filter(
            must=[
                FieldCondition(
                    key="source",
                    match=MatchValue(value=source_prefix),
                )
            ]
        )
    
    # FIXED: Use query_points() instead of search()
    # OLD: hits = client.search(...)
    search_result = client.query_points(
        collection_name=settings.qdrant_collection,
        query=vector,  # FIXED: 'query_vector' -> 'query'
        limit=k,
        with_payload=True,
        query_filter=query_filter,
    )
    
    # FIXED: Access results via .points attribute
    hits = search_result.points
    
    out: list[dict[str, Any]] = []
    for h in hits:
        payload = h.payload or {}
        out.append(
            {
                "score": float(h.score),
                "text": payload.get("text", ""),
                "source": payload.get("source", ""),
                "chunk_id": payload.get("chunk_id"),
            }
        )
    return out