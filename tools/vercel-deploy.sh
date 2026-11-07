#!/usr/bin/env bash
# Run by .github/workflows/deploy.yml. For each project whose paths changed since the last
# successful deploy run, builds main here and deploys it to production (prebuilt).
# FORCE=1 deploys all. No previous run, or its commit is gone: deploys all.
set -euo pipefail
[ -n "${VERCEL_TOKEN:-}" ] || { echo "::error::VERCEL_TOKEN secret is not set"; exit 1; }
export VERCEL_ORG_ID=team_f3vbqdrWJjxwwM7g2dphSQcM # arthurgreycode-2623's projects
vercel() { npx --yes vercel@65.12.1 "$@" --token "$VERCEL_TOKEN"; }

base=$(gh run list --workflow deploy.yml --branch main --status success --limit 1 --json headSha -q '.[0].headSha // empty')
if [ -n "$base" ] && ! git cat-file -e "$base^{commit}" 2>/dev/null; then base=; fi
echo "last deploy: ${base:-none}"

deploy() { # name project-id paths...
  local name=$1
  export VERCEL_PROJECT_ID=$2
  shift 2
  if [ "${FORCE:-0}" != 1 ] && [ -n "$base" ] && git diff --quiet "$base" HEAD -- "$@"; then
    echo "$name: unchanged, not deployed"
    return 0
  fi
  rm -rf .vercel
  vercel pull --yes --environment=production
  vercel build --prod
  echo "$name: deployed $(vercel deploy --prebuilt --prod)"
}

status=0
deploy web prj_qf25l7Cwd8u2Ye9tL1Rlfi6dBjNS apps/web packages || status=1
deploy relayer prj_UyTxbpvs4friw4Jt2JsQv6EadHY0 apps/relayer packages || status=1
deploy shop prj_KpTcfBJexGJA6yP2EeIxIC9xFmmv apps/shop packages || status=1
# The hosted MCP service (batch 058) deploys only once its Vercel project exists and the repository variable
# VERCEL_MCP_PROJECT_ID names it; until then merging changes nothing for it. It imports packages/mcp, so both paths count.
if [ -n "${VERCEL_MCP_PROJECT_ID:-}" ]; then
  deploy mcp "$VERCEL_MCP_PROJECT_ID" apps/mcp packages/mcp || status=1
else
  echo "mcp: no VERCEL_MCP_PROJECT_ID, not deployed"
fi
exit $status
