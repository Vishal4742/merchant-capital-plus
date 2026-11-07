# Spec: 058-P5-ai-connect-remote-mcp

Branch `wf/ai-connect` (worktree `P:\wf-ai`), from `wf/int-testnet-e2e@d87d3ac` (local, never pushed to main; PR only).
Mode: phase. Money: yes (the remote tools create payment links and read payments; OAuth grants guard them).

## Selected base (recorded 2026-11-07, no secrets)
- Revision d87d3ac = origin/main e7e41bf + PR #48 (gateway routes) + PR #45 (packages/mcp). Last verified payment: tx 0x2715…3754 (1.00 gross / 0.10 fee / 0.90 net, paymentId 18).
- Chain Whitechain Testnet (1874). Asset: Tether test USDT (`lib/usdt.ts`). Contract: main's MerchantPay (from `apps/web/.env.local`, `payConfig()`).
- Auth on this base: SIWE session cookie (verified merchant address). No workspaces, no roles: not claimed anywhere in the UI.
- NOT imported: `P:\wf-051` (USDC / second MerchantPay, a literal test-key fallback in its config), Privy (#44), cutover branches.
- Real gateway capabilities (`/api/v1/account` flags): links, payments, reports, operations. customers, invoices, reminders: false.

## Requirements (cite docs/SRS.md IDs)
- FR-GW-1 payment links (the assistant creates a link and reads its record; the customer pays at the hosted checkout).
- FR-GW-9 reports (collection summary: gross, fees, net).
- FR-GW-14 test mode everywhere: every new page and every remote response says Whitechain Testnet; no mainnet path.
- FR-MCP-1, FR-MCP-2, FR-MCP-3 the connector's rules carry over: no tool moves money, signs, refunds or changes keys, wallets or webhooks; credentials never appear in output or logs.
- FR-MCP-4 (S): connection instructions, now prompt-led.
- SRS-CHANGE proposals (not "approved" until the human says yes; claude-research owns the SRS):
  - FR-MCP-18 remote Streamable HTTP MCP endpoint, testnet only, fail-closed.
  - FR-MCP-19 OAuth 2.1 delegated authorization (PKCE S256, audience-bound, scoped, revocable) for that endpoint.
  - FR-MCP-20 connection states and grant management (/merchant/ai), honest verification.
  - FR-WEB-AI /connect public guide and the prompt generator.
  Until approved, code and tests cite FR-MCP-1..4, FR-GW-1 and FR-GW-14 only.

## Phases (each ends in a commit; only phase C needs outside accounts)
**A. Frontend + prompts + connector reliability (no new dependency, no DB change).**
- A1 Typed prompt generator `apps/web/lib/ai-connect.ts`: `buildSetupPrompt({client, setupUrl, mcpUrl})` for ChatGPT, Claude app and Claude Code (advanced). Validates both URLs (https, no credentials/query/fragment, no localhost/private host); returns `{ok:false, reason}` when the service is not provisioned. A secret scanner test runs every output.
- A2 `/connect` (public, server-rendered, no merchant data, no cookies read) and `/merchant/ai` (SIWE-gated). Selector, Copy setup prompt, endpoint copy, three steps, examples limited to real capabilities, state, scopes, last verified, disconnect (disabled with its reason until phase C exists), clipboard-failure fallback (selectable textarea), 375px + desktop, keyboard.
- A3 Shell + Nav rebrand to WhiteFlow; primary nav Overview, Payment links, Payments, Reports, AI connections; Pages, Vouchers, Settlements, Capital, API keys, Webhooks, Docs under "More". Existing routes unchanged. CSP/softNav rules respected (`next.config.ts`).
- A4 Overview: Whitechain Testnet label, settlement asset from config, gross / fee / net, primary actions Create payment link + Connect your AI, loading/error/empty states, no invented figures.
- A5 packages/mcp reliability fixes (shared by stdio and later remote): reconciliation + retry-age guards also for explicit idempotency keys; an operation-lookup 404 never counts as "the write did not happen"; recovered successful results pass the normal semantic check; drop the mandatory `search_customers` rule from the payment-link prompts; invoice prompts respect unsupported capabilities and pending approval; write identity survives uncertain results.

**B. Remote MCP transport + durable storage (new tables, tests on PGlite only).**
- B1 Extract tool registration so it takes a per-request `ToolContext` (no shared mutable merchant state). stdio keeps its file journal; MCPB behaviour unchanged (the existing 43 tests stay green).
- B2 `apps/web/app/mcp/route.ts` (Node runtime, stateless `WebStandardStreamableHTTPServerTransport` from the installed SDK 1.32.2): fresh server + transport per request, Origin validation, protocol-version header, 401 with a `WWW-Authenticate` resource-metadata challenge. Why: Vercel functions are multi-instance and stateless, and the app already deploys there; session ids are never credentials.
- B3 In-process gateway adapter: the tools' `fetch` calls the existing `/api/v1/*` route handlers in-process; the principal is attached through a module-private `WeakMap<Request, Principal>` consulted by `callerMerchant()` (no header can forge it, no global key, no process.env mutation). Scope is checked in the tool wrapper at call time AND by method+path in the adapter.
- B4 Tenant-scoped Postgres journal (`db/051_mcp_journal.sql`, primary key `(merchant, op_key)`), insert-first transactional claim. Concurrency test: N parallel creates with one key yield one link.
- B5 Remote config fails closed: `WHITEFLOW_MCP_PUBLIC_URL` and the OAuth settings must be present and https, else the route answers 503 `not_configured`. No sandbox fallback.

**C. OAuth authorization server, grants, connection states.** BLOCKED on the decision below before any code.
- C1 Discovery: `/.well-known/oauth-protected-resource` (RFC 9728) and `/.well-known/oauth-authorization-server` (RFC 8414); `resource` = the MCP URL; tokens carry `aud` = that URL and are rejected otherwise (RFC 8707).
- C2 Authorization code + PKCE S256 only; exact redirect-URI match; DCR and/or CIMD per host support; each host's callback is read from that host's own settings screen at registration time, never hard-coded from a search result; SSRF-safe metadata fetch for CIMD.
- C3 Consent page (SIWE session required): client, merchant (from the session, never the prompt), Whitechain Testnet, scopes `account:read links:read payments:read reports:read`; `links:write` is a separate, unchecked-by-default permission. CSRF token + `frame-ancestors 'none'`.
- C4 Access tokens 10 min, rotating refresh tokens with reuse detection (reuse revokes the grant), credentials stored hashed, `app_mcp_grants` row per grant (owner, client, merchant, scopes, created, expires, revoked, last_tool_ok_at, last_error_category).
- C5 States: Setup required → Authorized, awaiting verification → Verified → Reauthorization required / Revoked / Service unavailable. Only an authenticated successful tool call tied to the grant writes `last_tool_ok_at`; copying a prompt, finishing consent and a frontend health check never do.
- C6 Disconnect revokes the grant and its refresh family; the next tool call and refresh fail.

## Decision needed before phase C (PIPELINE §11: new dependency, auth code)
Options checked 2026-11-07: (1) Better Auth `mcp` plugin: Next-native, DCR + PKCE, documented as beta, brings its own user/session tables that must be bridged to SIWE; (2) the installed MCP SDK's `server/auth` (`OAuthServerProvider` + handlers): already a dependency and supported, but Express-only; (3) Cloudflare `workers-oauth-provider`: Workers-only; (4) hand-written endpoints: rejected, the brief requires a supported library. Recommendation: (2) in a small dedicated Node service sharing the Postgres store, or (1) if the human accepts a beta dependency plus the SIWE bridge. Needs the human's choice and the public hosting target.

## Acceptance criteria
- [ ] A: prompt output for each client contains no secret-shaped text (api key, bearer, `0x`+64 hex, mnemonic, `code=`, `token=`); invalid or localhost URLs give the unavailable result and the UI says setup isn't available.
- [ ] A: `/connect` renders with no cookie and shows no merchant data; `/merchant/ai` shows SignedOut without a session.
- [ ] A: Nav shows the five primary items; every old route still answers for a signed-in test merchant.
- [ ] A: Overview shows gross, fee, net and "Whitechain Testnet"; empty/error states are tested.
- [ ] A: the A5 tests fail first, then pass; the existing packages/mcp suite (43) stays green.
- [ ] B: unauthenticated POST /mcp → 401 + challenge; a tool omitted from discovery still refuses direct calls without scope; two merchants never see each other's links or journal rows; parallel creates with one key → one link; a retry across a simulated restart returns the original reply.
- [ ] `npx tsc --noEmit`, `npm run lint`, `npm run build`, `npm test` for apps/web and packages/mcp, output reported.
- [ ] C (after the decision): denial, code replay, expired code/token, wrong audience, PKCE mismatch, insufficient scope, cross-merchant, revoke, refresh-reuse tests; ChatGPT and Claude verified separately in `client-verification.md`.
- [ ] Final journey (only if separately authorized): connector installed → consent → get_business_profile → create link → customer pays THAT link → chain receipt + dashboard + MCP status agree. No deployer key, no payment started by us.

## Files to touch
- apps/web: `lib/ai-connect.ts` (new), `app/connect/page.tsx` (new), `app/merchant/ai/page.tsx` (new), `components/ai/*` (new), `components/dashboard/{Shell,Nav}.tsx`, `app/merchant/page.tsx`, landing copy and `app/layout.tsx` where they say Merchant Capital+, `next.config.ts` (CSP routes), `apps/web/test/*`; phase B: `app/mcp/route.ts`, `lib/server/mcp-*.ts`, `lib/server/keys.ts` (principal seam), `db/051_mcp_journal.sql`.
- packages/mcp: `src/tools/*`, `src/prompts.ts`, `src/server.ts` (factory), `src/journal.ts` (adapter interface), tests.
- Not touched: contracts, relayer signing/settlement, `P:\wf-051` config, workspaces/Privy.

## Ponytail ladder
- Needed at all? Yes: the goal is a real connection. Already in the repo: the six tools, WhiteflowClient, `callerMerchant`, `db.ts` + PGlite, `CopyButton`, Shell/Nav. Platform: Web Standard Request/Response, WeakMap, crypto. Installed dependency: MCP SDK 1.32.2 (web-standard Streamable HTTP transport, zod). A new dependency only for the OAuth server, after the decision above. Rejected: a second HTTP client, per-merchant processes, a global key.

## Out of scope
Marketplace/directory listing, cross-chain, full invoicing and customer records, remote UI widgets, contract/relayer changes, merging, deploying, migrating the shared database, any payment we initiate. Public hosting, provider/account settings and the shared-DB migration are owner actions: prepared, not performed.
