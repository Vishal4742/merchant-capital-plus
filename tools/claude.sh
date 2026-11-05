#!/usr/bin/env bash
# Start Claude Code in this folder with supermemory on: passes ONLY the supermemory key from .env (never the wallet keys).
cd "$(dirname "$0")/.." || exit 1
SUPERMEMORY_CC_API_KEY="$(grep -m1 '^SUPERMEMORY_CC_API_KEY=' .env | cut -d= -f2- | tr -d "\"'")"
export SUPERMEMORY_CC_API_KEY
bash tools/memory-up.sh
exec claude "$@"
