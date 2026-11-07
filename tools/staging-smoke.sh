#!/usr/bin/env bash
# Smoke checks of the hosted STAGING deployment, run at the end of .github/workflows/staging.yml (and by hand with the same
# two variables). Reads nothing secret and changes nothing: GETs, plus one unauthenticated POST that must be refused.
# This proves the hosted runtime is up and fails closed; it does NOT prove ChatGPT or Claude can connect (client-verification.md).
set -uo pipefail
: "${STAGING_MCP_URL:?STAGING_MCP_URL (the staging MCP origin, https) is not set}"
: "${STAGING_WEB_URL:?STAGING_WEB_URL (the staging web origin, https) is not set}"
mcp=${STAGING_MCP_URL%/}; web=${STAGING_WEB_URL%/}
case "$mcp$web" in https://*https://*) ;; *) echo "FAIL: both staging URLs must be https"; exit 1;; esac
fail=0
check() { # name expected-status command...
  local name=$1 want=$2; shift 2
  local got; got=$("$@" 2>/dev/null) || got=000
  if [ "$got" = "$want" ]; then echo "ok   $name ($got)"; else echo "FAIL $name: wanted $want, got $got"; fail=1; fi
}
status() { curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$@"; }
body_has() { curl -s --max-time 25 "$1" | grep -q "$2" && echo 200 || echo missing; }

check "mcp liveness"                 200 status "$mcp/health"
check "mcp readiness (database)"     200 status "$mcp/ready"
check "oauth server metadata"        200 status "$mcp/.well-known/oauth-authorization-server"
check "S256 is the only PKCE method" 200 body_has "$mcp/.well-known/oauth-authorization-server" '"code_challenge_methods_supported":\["S256"\]'
check "protected-resource metadata"  200 status "$mcp/.well-known/oauth-protected-resource/mcp"
check "unauthenticated MCP is 401"   401 status -X POST -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$mcp/mcp"
check "garbage token is 401"         401 status -X POST -H 'authorization: Bearer not-a-token' -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' "$mcp/mcp"
check "foreign Origin is refused"    403 status -X POST -H 'origin: https://evil.example' -H 'content-type: application/json' -d '{}' "$mcp/mcp"
check "web setup guide"              200 body_has "$web/connect" 'Copy setup prompt'
check "consent needs sign-in"        200 status "$web/merchant/ai/authorize?request=invalid"
check "consent route needs a session" 401 status -X POST -H 'content-type: application/json' -d '{}' "$web/api/mcp/consent"
exit $fail
