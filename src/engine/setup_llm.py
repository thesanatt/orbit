"""Set up LLM API keys for byllm / litellm before any by llm() call.

The GROQ_API_KEY must be set in the environment before starting the server.
This module reads it from a local .env file if present, or from the environment.
"""

import os
from pathlib import Path


def _load_env_file() -> None:
    """Read key=value pairs from .env file in project root."""
    for candidate in [Path.cwd() / ".env", Path(__file__).resolve().parents[2] / ".env"]:
        if candidate.exists():
            for line in candidate.read_text().splitlines():
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    key, _, value = line.partition("=")
                    os.environ.setdefault(key.strip(), value.strip().strip("\"'"))
            break


def ensure_llm_keys() -> None:
    """Ensure LLM API keys are in the environment so litellm can find them."""
    _load_env_file()
    # Gemini (primary)
    gemini_key = os.environ.get("GEMINI_API_KEY", "")
    if gemini_key:
        os.environ.setdefault("GEMINI_API_KEY", gemini_key)
    # Groq (fallback)
    groq_key = os.environ.get("GROQ_API_KEY", "")
    if groq_key:
        os.environ.setdefault("GROQ_API_KEY", groq_key)


# Keep old name for backward compat
ensure_groq_key = ensure_llm_keys

# Auto-run on import
ensure_llm_keys()
