#!/usr/bin/env bash
# Hook: push unread agentbus messages into this Claude session (EVENT = tool | prompt | stop [wait-seconds]).
# Silent unless the session registered its lane with tools/iam.sh. Never blocks a tool.
ev="$1"; d="${AGENTBUS_DIR:-$HOME/.agentbus}/lanes"; p=$PPID; lane=""
for _ in 1 2 3 4 5 6 7 8 9 10; do
  [ -f "$d/$p" ] && { lane=$(cat "$d/$p"); break; }
  p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' '); [ -z "$p" ] || [ "$p" = 1 ] && break
done
[ -n "$lane" ] || { cat >/dev/null 2>&1; exit 0; }
exec python3 -I "$(dirname "$0")/agentbus.py" hook "$ev" --as "$lane" ${2:+--wait "$2"}
