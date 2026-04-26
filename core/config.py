"""Application settings from environment / .env."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    ollama_base_url: str = "http://localhost:11434"
    ollama_model: str = "mistral"
    # httpx/Ollama client timeout (seconds) — local models can be slow on CPU
    ollama_request_timeout_sec: float = 120.0
    # Groq (primary LLM — cloud inference)
    groq_api_key: str = ""
    groq_model: str = "llama3-8b-8192"
    groq_request_timeout_sec: float = 30.0   # Groq is fast; 30 s is generous
    enable_groq_fallback: bool = True
    max_upload_bytes: int = 25 * 1024 * 1024
    qdrant_host: str = "localhost"
    qdrant_port: int = 6333
    # remote = Docker/server at host:port; memory = embedded Qdrant (no Docker; data lost on API restart)
    qdrant_mode: str = "remote"
    qdrant_collection: str = "company_docs"
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_db: int = 0
    embedding_model: str = "sentence-transformers/all-MiniLM-L6-v2"
    sparse_embedding_model: str = "prithivida/Splade_PP_en_v1"
    chunk_size: int = 512
    chunk_overlap: int = 64
    retrieval_top_k: int = 6
    session_history_max_messages: int = 24
    max_retries: int = 2
    # Comma-separated origins for browser UI (dev/preview). Empty disables CORS middleware.
    # Include 5174+ — Vite picks the next free port when 5173 is taken.
    cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:5174,http://127.0.0.1:5174,"
        "http://localhost:5175,http://127.0.0.1:5175,"
        "http://localhost:5176,http://127.0.0.1:5176,"
        "http://localhost:4173,http://127.0.0.1:4173"
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
