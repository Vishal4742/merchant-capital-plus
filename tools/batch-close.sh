#!/usr/bin/env bash
# Close the active batch (PIPELINE.md §3, step 8): only after every round-N verdict is PASS and the human said ship it.
set -euo pipefail
[ -f .batches/ACTIVE ] || { echo "no active batch"; exit 1; }
name=$(head -1 .batches/ACTIVE | tr -d '[:space:]'); dir=".batches/$name"
last=$(ls -1d "$dir"/round-* 2>/dev/null | sort -V | tail -1)
[ -n "$last" ] || { echo "no rounds in $dir"; exit 1; }
need="test review-code review-security review-ux-ui ci"
# Phase mode (human 2026-11-06 06:03): a batch needs only its ci.md; money batches also need review-security.md.
if grep -q "^Mode: phase" "$dir/batch.md"; then need="ci"; grep -q "^Money: yes" "$dir/batch.md" && need="ci review-security"; fi
for f in $need; do
  [ -f "$last/$f.md" ] || { echo "missing $last/$f.md: the round isn't finished"; exit 1; }
  head -1 "$last/$f.md" | grep -qx 'VERDICT: PASS' || { echo "$last/$f.md is not 'VERDICT: PASS'"; exit 1; }
done
echo "Closed $dir ($(basename "$last") all PASS)." && rm .batches/ACTIVE
# Tell claude-research, which verifies the batch, updates the shared docs and reports to the human.
lane=$(grep -o "Owner lane: claude-[a-z]*" "$dir/batch.md" | head -1 | cut -d" " -f3 || true)
command -v agentbus >/dev/null && agentbus send --as "${lane:-unknown-lane}" --to claude-research \
  "DONE $name ($(basename "$last") all PASS). Verify, update PHASES/README/AI_USAGE, tell the human." >/dev/null \
  || echo "warn: agentbus not reachable; post DONE $name to claude-research by hand"
