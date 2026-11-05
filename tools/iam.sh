#!/usr/bin/env bash
# Register this Claude session's lane so agentbus pushes its messages into it: bash tools/iam.sh claude-contracts
name="${1:?usage: tools/iam.sh <lane-name>}"; d="${AGENTBUS_DIR:-$HOME/.agentbus}/lanes"; mkdir -p "$d"
p=$PPID
for _ in 1 2 3 4 5 6 7 8 9 10; do
  case "$(basename "$(ps -o comm= -p "$p" 2>/dev/null)")" in claude) printf '%s\n' "$name" > "$d/$p"; echo "registered $name (claude pid $p)"; exit 0;; esac
  p=$(ps -o ppid= -p "$p" 2>/dev/null | tr -d ' '); [ -z "$p" ] || [ "$p" = 1 ] && break
done
echo "no claude process above this shell; not registered" >&2; exit 1
