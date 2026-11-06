#!/usr/bin/env bash
# claude-research edits and commits tracked docs in its own worktree (~/ethglobal-docs, detached at origin/main),
# never in ~/ethglobal: that tree's index is shared with claude-frontend, and a commit there once swept the
# frontend's staged deletions into main (0fa3742, 2026-11-06 08:33).
#   tools/docs-commit.sh sync                 # before editing: move the docs worktree to the latest origin/main
#   tools/docs-commit.sh "message" path...    # commit only these paths there and push to main
set -euo pipefail
W=$HOME/ethglobal-docs
if [ "${1:-}" = sync ]; then
  git -C "$W" fetch -q origin
  git -C "$W" diff --quiet && git -C "$W" diff --cached --quiet || { echo "docs-commit: uncommitted edits in $W; commit them first" >&2; exit 1; }
  git -C "$W" checkout -q --detach origin/main && git -C "$W" log --oneline -1; exit 0
fi
msg=$1; shift
git -C "$W" add -- "$@"
git -C "$W" diff --cached --quiet && { echo "docs-commit: nothing changed"; exit 0; }
git -C "$W" commit -q -m "$msg" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>" -- "$@"
for i in 1 2 3; do git -C "$W" push -q origin HEAD:main && break; git -C "$W" fetch -q origin && git -C "$W" rebase -q origin/main; done
git -C "$W" log --oneline -1
