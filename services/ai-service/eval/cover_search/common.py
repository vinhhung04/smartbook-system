"""Shared paths and environment setup for the cover-search research harness.

Research-only module: nothing in production imports it. It makes the
ai-service package importable (production modules are reused, never copied),
points Hugging Face at the research cache instead of the Docker-mounted
production cache, and loads OPENROUTER_* settings from the repository .env
without ever printing their values.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
AI_SERVICE_DIR = HERE.parent.parent
REPO_ROOT = AI_SERVICE_DIR.parent.parent
DATASET_DIR = REPO_ROOT / "research-inputs" / "cover-search-dataset"
RUNS_DIR = HERE / "runs"
DOCS_DIR = REPO_ROOT / "docs" / "research" / "cover-search"

# Only these keys are read from .env; everything else in it is ignored.
_ENV_KEYS = (
    "OPENROUTER_API_KEY", "OPENROUTER_BASE_URL", "OPENROUTER_TEXT_MODEL",
    "OPENROUTER_VISION_MODEL", "OPENROUTER_EMBED_MODEL", "OPENROUTER_EMBED_DIMENSIONS",
)


def _load_dotenv(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key in _ENV_KEYS and key not in os.environ:
            os.environ[key] = value.strip().strip('"').strip("'")


def setup_environment(load_secrets: bool = True) -> None:
    """Must run before importing any production module: several of them read
    os.environ at import time (embeddings.py, llm_provider.py, cover_embeddings.py)."""
    os.environ.setdefault("HF_HOME", str(HERE / ".hf-cache"))
    # Force the in-memory vector store and a throwaway SQLite URL so that no
    # research call can ever reach the production ai_db / business databases.
    os.environ["DATABASE_URL"] = "sqlite+aiosqlite:///:memory:"
    if load_secrets:
        _load_dotenv(REPO_ROOT / ".env")
    if str(AI_SERVICE_DIR) not in sys.path:
        sys.path.insert(0, str(AI_SERVICE_DIR))
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))


def has_api_key() -> bool:
    return bool(os.environ.get("OPENROUTER_API_KEY", "").strip())
