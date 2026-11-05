#!/usr/bin/env bash
# SessionStart hook: start the shared supermemory server if it isn't running. Idempotent; never blocks a session.
# Detached (own process session) so it survives the Claude session that started it.
cd "$(dirname "$0")/.." || exit 0
curl -s -m 1 -o /dev/null http://localhost:6767/ && exit 0
mkdir -p .supermemory
python3 -I -c 'import subprocess; subprocess.Popen(["bash","tools/supermemory.sh"], stdin=subprocess.DEVNULL, stdout=open(".supermemory/server.log","a"), stderr=subprocess.STDOUT, start_new_session=True)'
exit 0
