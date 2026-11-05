#!/usr/bin/env bash
# Close the active batch (PIPELINE.md §3, step 8): only after every round-N verdict is PASS and the human said ship it.
set -euo pipefail
[ -f .batches/ACTIVE ] || { echo "no active batch"; exit 1; }
name=$(head -1 .batches/ACTIVE | tr -d '[:space:]'); dir=".batches/$name"
last=$(ls -1d "$dir"/round-* 2>/dev/null | sort -V | tail -1)
[ -n "$last" ] || { echo "no rounds in $dir"; exit 1; }
for f in test review-code review-security review-ux-ui ci; do
  [ -f "$last/$f.md" ] || { echo "missing $last/$f.md: the round isn't finished"; exit 1; }
  head -1 "$last/$f.md" | grep -qx 'VERDICT: PASS' || { echo "$last/$f.md is not 'VERDICT: PASS'"; exit 1; }
done
echo "Closed $dir ($(basename "$last") all PASS)." && rm .batches/ACTIVE
