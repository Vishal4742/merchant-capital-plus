#!/usr/bin/env bash
# Start a pipeline batch (PIPELINE.md §3): bash tools/batch-start.sh <phase-number> <slug>
# Creates .batches/NNN-P<phase>-<slug>/ with batch.md + spec.md templates and points .batches/ACTIVE at it.
set -euo pipefail
[ $# -eq 2 ] || { echo "usage: bash tools/batch-start.sh <phase-number> <slug>"; exit 1; }
phase=$1; slug=$2
root=$(pwd); [ -f "$root/PIPELINE.md" ] || { echo "run from the repo root (PIPELINE.md not found)"; exit 1; }
mkdir -p .batches
last=$(ls -1 .batches 2>/dev/null | grep -E '^[0-9]{3}-' | sort | tail -1 | cut -c1-3 || true)
n=$(printf '%03d' $(( 10#${last:-0} + 1 )))
name="$n-P$phase-$slug"; dir=".batches/$name"
mkdir -p "$dir/round-1"
cat > "$dir/batch.md" <<EOF
# $name
Phase: $phase (PHASES.md)   Round: spec   Owner lane: <claude-contracts|claude-relayer|claude-frontend>
Request (verbatim):
Agent ids (builders, for SendMessage resumes):
Log:
EOF
cat > "$dir/spec.md" <<EOF
# Spec: $name
TODO-SPEC  (delete this line when the spec is complete; the pipeline gate blocks code until then)

## Requirements (cite docs/SRS.md IDs)
- FR-…

## Acceptance criteria (cite AT-… where one exists; each must be checkable)
- [ ] …

## Files to touch (owner lane: only these)
- …

## Ponytail ladder (why this is the smallest change that works)
- Needed at all? · already in repo? · stdlib/platform? · installed dependency? · minimum code

## Out of scope
- …
EOF
printf '%s\n' "$name" > .batches/ACTIVE
echo "Active batch: $dir (write spec.md, then build). Close with: bash tools/batch-close.sh"
