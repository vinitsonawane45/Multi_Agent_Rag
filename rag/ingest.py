"""Chunk documents, embed, and upsert into Qdrant."""

from __future__ import annotations

import uuid
from pathlib import Path

from langchain_community.embeddings import HuggingFaceEmbeddings
from langchain_text_splitters import RecursiveCharacterTextSplitter
from pypdf import PdfReader
from qdrant_client import QdrantClient
from qdrant_client.models import PointStruct

from core.clients import make_qdrant_client
from core.config import Settings
from rag.retriever import ensure_collection


def _embeddings(settings: Settings) -> HuggingFaceEmbeddings:
    return HuggingFaceEmbeddings(
        model_name=settings.embedding_model,
        model_kwargs={"device": "cpu"},
        encode_kwargs={"normalize_embeddings": True},
    )


def _read_text(path: Path) -> str:
    suf = path.suffix.lower()
    if suf == ".pdf":
        reader = PdfReader(str(path))
        parts: list[str] = []
        for page in reader.pages:
            t = page.extract_text()
            if t:
                parts.append(t)
        return "\n\n".join(parts)
    if suf in {".txt", ".md"}:
        return path.read_text(encoding="utf-8", errors="replace")
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return ""


def ingest_paths(
    settings: Settings,
    client: QdrantClient,
    paths: list[Path],
    *,
    clear_collection: bool = False,
) -> int:
    splitter = RecursiveCharacterTextSplitter(
        chunk_size=settings.chunk_size,
        chunk_overlap=settings.chunk_overlap,
    )
    emb = _embeddings(settings)
    probe = emb.embed_query("dimension probe")
    dim = len(probe)
    
    # Handle clear_collection properly
    if clear_collection:
        try:
            client.delete_collection(settings.qdrant_collection)
        except Exception:  # noqa: BLE001 — collection may not exist
            pass
    
    # Ensure collection exists after potential deletion
    ensure_collection(client, settings.qdrant_collection, dim)

    points: list[PointStruct] = []
    for p in paths:
        if not p.is_file():
            continue
        raw = _read_text(p)
        if not raw.strip():
            continue
        source = str(p.resolve())
        chunks = splitter.split_text(raw)
        vectors = emb.embed_documents(chunks)
        for i, (chunk, vec) in enumerate(zip(chunks, vectors)):
            points.append(
                PointStruct(
                    id=str(uuid.uuid4()),
                    vector=list(vec),
                    payload={
                        "text": chunk,
                        "source": source,
                        "chunk_id": i,
                    },
                )
            )

    if points:
        # Batch upsert for better performance
        batch_size = 100
        for i in range(0, len(points), batch_size):
            batch = points[i:i + batch_size]
            client.upsert(collection_name=settings.qdrant_collection, points=batch)
    return len(points)


def ingest_directory(
    settings: Settings,
    client: QdrantClient,
    directory: Path,
    *,
    clear_collection: bool = False,
    extensions: frozenset[str] | None = None,
) -> int:
    exts = extensions or frozenset({".pdf", ".txt", ".md"})
    files = [p for p in directory.rglob("*") if p.is_file() and p.suffix.lower() in exts]
    return ingest_paths(settings, client, files, clear_collection=clear_collection)


if __name__ == "__main__":
    import argparse
    import sys

    from core.config import get_settings

    parser = argparse.ArgumentParser(description="Ingest documents into Qdrant")
    parser.add_argument("path", type=Path, help="File or directory to ingest")
    parser.add_argument("--clear", action="store_true", help="Drop collection before ingest")
    args = parser.parse_args()
    s = get_settings()
    qc = make_qdrant_client(s)
    target = args.path
    if target.is_dir():
        n = ingest_directory(s, qc, target, clear_collection=args.clear)
    else:
        n = ingest_paths(s, qc, [target], clear_collection=args.clear)
    print(f"Upserted {n} chunks.", file=sys.stderr)