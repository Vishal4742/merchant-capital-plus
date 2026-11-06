#!/usr/bin/env bash
# Run by .github/workflows/deploy.yml. Starts a Vercel build of main (deploy hook) for each
# project whose paths changed since the last successful deploy run; FORCE=1 deploys all.
# No previous run, or its commit is gone: deploys all.
set -euo pipefail
base=$(gh run list --workflow deploy.yml --branch main --status success --limit 1 --json headSha -q '.[0].headSha // empty')
if [ -n "$base" ] && ! git cat-file -e "$base^{commit}" 2>/dev/null; then base=; fi
echo "last deploy: ${base:-none}"

deploy() { # name hook paths...
  local name=$1 hook=$2
  shift 2
  if [ -z "$hook" ]; then
    echo "::error::$name: deploy hook secret is not set"
    return 1
  fi
  if [ "${FORCE:-0}" != 1 ] && [ -n "$base" ] && git diff --quiet "$base" HEAD -- "$@"; then
    echo "$name: unchanged, not deployed"
    return 0
  fi
  curl -fsS -X POST "$hook" >/dev/null
  echo "$name: deploy started"
}

status=0
deploy web "${HOOK_WEB:-}" apps/web packages || status=1
deploy relayer "${HOOK_RELAYER:-}" apps/relayer packages || status=1
deploy shop "${HOOK_SHOP:-}" apps/shop packages || status=1
exit $status
