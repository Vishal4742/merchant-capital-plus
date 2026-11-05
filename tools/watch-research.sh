#!/usr/bin/env bash
# Wake claude-research only for messages that need it (to it, DONE, GATE, BLOCKED); skip broadcast chatter.
while :; do
  m=$(agentbus watch --as claude-research --timeout 3600) || exit 0
  [ -z "$m" ] && exit 0
  echo "$m" | grep -qE "^\[[^]]*\] claude-research ->" && continue   # my own messages
  echo "$m" | grep -qE -- "-> claude-research:|DONE |GATE G[0-9]|BLOCKED|NEEDS THE USER|FRICTION" && { echo "$m"; exit 0; }
done
