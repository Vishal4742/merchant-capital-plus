#!/usr/bin/env bash
# Run by .github/workflows/staging.yml. Builds this checkout and deploys it (prebuilt) to the two STAGING Vercel projects:
# the web app and the hosted MCP service. A staging project's own "production" environment holds the staging settings,
# which is why --prod / --environment=production is used here: it is production OF THE STAGING PROJECT, a different project
# from the three real ones. It refuses outright to touch any of the real ones.
set -euo pipefail
[ -n "${VERCEL_TOKEN:-}" ] || { echo "::error::VERCEL_TOKEN secret is not set"; exit 1; }
: "${VERCEL_STAGING_WEB_PROJECT_ID:?VERCEL_STAGING_WEB_PROJECT_ID (variable of the staging environment) is not set}"
: "${VERCEL_STAGING_MCP_PROJECT_ID:?VERCEL_STAGING_MCP_PROJECT_ID (variable of the staging environment) is not set}"
export VERCEL_ORG_ID=team_f3vbqdrWJjxwwM7g2dphSQcM # the same team as the real projects (tools/vercel-deploy.sh)

# the real projects: web, relayer, shop (tools/vercel-deploy.sh). Staging must never deploy to these.
PRODUCTION_PROJECTS="prj_qf25l7Cwd8u2Ye9tL1Rlfi6dBjNS prj_UyTxbpvs4friw4Jt2JsQv6EadHY0 prj_KpTcfBJexGJA6yP2EeIxIC9xFmmv"
for id in "$VERCEL_STAGING_WEB_PROJECT_ID" "$VERCEL_STAGING_MCP_PROJECT_ID"; do
  for real in $PRODUCTION_PROJECTS; do
    [ "$id" != "$real" ] || { echo "::error::a staging project id is a production project: refusing"; exit 1; }
  done
done
[ "$VERCEL_STAGING_WEB_PROJECT_ID" != "$VERCEL_STAGING_MCP_PROJECT_ID" ] || { echo "::error::the staging web and MCP project ids must differ"; exit 1; }

vercel() { npx --yes vercel@65.12.1 "$@" --token "$VERCEL_TOKEN"; }

deploy() { # name project-id
  export VERCEL_PROJECT_ID=$2
  rm -rf .vercel
  vercel pull --yes --environment=production
  vercel build --prod
  echo "$1: deployed $(vercel deploy --prebuilt --prod)"
}

deploy staging-mcp "$VERCEL_STAGING_MCP_PROJECT_ID"
deploy staging-web "$VERCEL_STAGING_WEB_PROJECT_ID"
