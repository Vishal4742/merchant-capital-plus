#!/usr/bin/env bash
# PreToolUse gate (PIPELINE.md): product code may change only inside an active pipeline batch.
# Product code = any path containing /contracts/, /apps/ or /packages/ in a repo that has PIPELINE.md.
# Active batch = .batches/ACTIVE names a folder that has batch.md and a spec.md citing SRS IDs.
# Blocks Edit/Write/MultiEdit/NotebookEdit, and Bash commands that redirect or sed -i into product paths.
# ponytail: Bash detection is a heuristic (redirects, tee, sed/perl -i, cp/mv into product paths);
#           CI + reviewer-code catch anything it misses.
set -u
input=$(cat)
read_field() { printf '%s' "$input" | python3 -c '
import json,sys
d=json.load(sys.stdin); t=d.get("tool_input") or {}
k=sys.argv[1]
print(d.get("tool_name","") if k=="tool" else (t.get("file_path") or t.get("notebook_path") or "") if k=="path" else t.get("command",""))' "$1" 2>/dev/null; }

tool=$(read_field tool)
deny() {
  python3 -c 'import json,sys; print(json.dumps({"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":sys.argv[1]}}))' "$1"
  exit 0
}
is_product() { set -- "${1//\\//}"; case "$1" in */contracts/*|*/apps/*|*/packages/*|contracts/*|apps/*|packages/*) return 0;; esac; return 1; }

# Which repo? Walk up from the target (or cwd) to the folder that holds PIPELINE.md.
find_root() {
  local d="$1"
  [ -d "$d" ] || d=$(dirname "$d")
  while [ -n "$d" ] && [ "$d" != "/" ]; do
    [ -f "$d/PIPELINE.md" ] && { printf '%s' "$d"; return; }
    d=$(dirname "$d")
  done
}

case "$tool" in
  Edit|Write|MultiEdit|NotebookEdit)
    path=$(read_field path); path=${path//\\//}   # Windows: C:\a\b -> C:/a/b
    [ -n "$path" ] && is_product "$path" || exit 0
    case "$path" in /*|[A-Za-z]:/*) ;; *) path="$PWD/$path";; esac
    root=$(find_root "$path")
    ;;
  Bash)
    cmd=$(read_field cmd)
    printf '%s' "$cmd" | grep -Eq '(>>?|\btee\b|sed -i|perl -pi|\bcp\b|\bmv\b|\brm\b)[^|;&]*(^|[ /"])(contracts|apps|packages)/' || exit 0
    root=$(find_root "$PWD")
    ;;
  *) exit 0;;
esac
[ -n "${root:-}" ] || exit 0   # not a pipeline repo: no gate

why="Read PIPELINE.md. Start a batch with: bash tools/batch-start.sh <phase> <slug>  (then write spec.md citing SRS IDs from docs/SRS.md)."
act="$root/.batches/ACTIVE"
[ -f "$act" ] || deny "PIPELINE GATE: no active batch, so product code can't change. $why"
name=$(head -1 "$act" | tr -d '[:space:]')
b="$root/.batches/$name"
[ -n "$name" ] && [ -f "$b/batch.md" ] && [ -f "$b/spec.md" ] || deny "PIPELINE GATE: .batches/ACTIVE points to '$name', which has no batch.md + spec.md. $why"
grep -Eq '\b(FR|NFR|SR|AT|CON|DEP)-[A-Z0-9]+(-[0-9]+)?\b' "$b/spec.md" || deny "PIPELINE GATE: $name/spec.md cites no SRS requirement IDs (FR-/NFR-/SR-/AT-). Every change must trace to docs/SRS.md."
grep -q 'TODO-SPEC' "$b/spec.md" && deny "PIPELINE GATE: $name/spec.md is still the template (TODO-SPEC). Fill in requirements, acceptance criteria and files before coding."
exit 0
