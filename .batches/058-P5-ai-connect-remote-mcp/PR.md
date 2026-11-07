feat: Connect ChatGPT and Claude to WhiteFlow: hosted MCP endpoint with OAuth, consent and connection states (batch 058)

## What this adds

- **`apps/mcp`**, a new deployable service. It serves a stateless Streamable HTTP `/mcp` endpoint with the six real merchant tools (profile, create/read payment link, payments, collection summary, operation status) and its own OAuth 2.1 authorization server, built on the installed MCP SDK's handlers over Postgres.
- **Authorization:**
  - authorization code with PKCE S256 only;
  - dynamic registration of public clients only;
  - tokens bound to the endpoint URL as audience;
  - 10-minute opaque, hashed access tokens;
  - rotating refresh tokens with reuse detection;
  - single-use codes, where a replay revokes the grant.
- **Consent screen** (`/merchant/ai/authorize`): the app is named from where access is sent, never from the name it registered. The page shows the destination host and warns on unverified apps. The merchant is the signed-in SIWE wallet. Permissions are tick boxes, and creating links is off by default.
- **Gateway seam:** the service calls `/api/v1` with a 5-minute signed assertion per request. The gateway re-reads the grant (merchant, scopes, expiry, revocation) every time and allows only the tool routes.
- **`/merchant/ai`** lists each connection with an honest state. "Verified" is set only by a successful authenticated tool call, shown with its time. Disconnect revokes the grant.
- **`/connect`** is a public setup guide with secret-free prompts for ChatGPT, Claude and Claude Code.
- **Durable journal:** a tenant-scoped Postgres write journal (compare-and-swap). Connector reliability fixes: explicit-key guards; a 404 isn't proof; a journal hiccup never causes a duplicate.
- **CI:** an `mcp-service` job. Production deploy of `apps/mcp` is gated on the repository variable `VERCEL_MCP_PROJECT_ID` (unset, so this merge deploys nothing for it). An isolated staging pipeline (`staging.yml`) runs only for `wf/ai-staging`.
- **Migration** `apps/web/db/051_mcp_remote.sql` (new tables only), **not applied anywhere**.

Requirements: FR-MCP-18, 19, 20 (approved 2026-11-07; SRS text in `.batches/058-…/srs-change-058.md` for claude-research), FR-MCP-1..4, FR-GW-1, FR-GW-14.

## Merge effects

Merging deploys `apps/web` to production, as any web change does. On production:
- nothing offers setup, because `WHITEFLOW_MCP_REMOTE` is unset;
- the consent and grant routes answer 503 without `MCP_INTERNAL_SECRET`;
- the MCP service isn't deployed, because `VERCEL_MCP_PROJECT_ID` is unset.

The migration must be applied by the owner before production use.

## Test plan

- [ ] CI green: web, mcp, **mcp-service**, secrets, plus the other required checks.
- [ ] Locally (Node 26):
  - `apps/web`: tsc, lint, test, build;
  - `packages/mcp`: tsc, test;
  - `apps/mcp`: tsc, test, build.
- [ ] Hosted staging per `STAGING.md`:
  - smoke checks;
  - full OAuth flow in a browser;
  - concurrency against hosted Postgres.
- [ ] Real clients per `client-verification.md`: ChatGPT and Claude separately.
- [ ] Final payment journey (separately authorised).

Reviews: round 1 found one HIGH each in security and code, both fixed with tests. Round 2 is in `.batches/058-…/round-2/`.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
