#!/usr/bin/env bash
# Local supermemory server for this folder: data in .supermemory/, keys in .env (both git-ignored).
# DeepSeek (OpenAI-compatible) does extraction; embeddings run locally. http://localhost:6767
# Loads ONLY its own keys: .env also holds wallet keys this process must never see.
cd "$(dirname "$0")/.." || exit 1
set -a; eval "$(grep -E '^(SUPERMEMORY_API_KEY|OPENAI_[A-Z_]*)=' .env)"; set +a
SUPERMEMORY_DATA_DIR="$PWD/.supermemory" SUPERMEMORY_DISABLE_TELEMETRY=1 SUPERMEMORY_NO_OPEN=1 \
  SUPERMEMORY_HIDE_API_KEY_IN_LOGS=1 exec "$HOME/.local/bin/supermemory-server" "$@"
