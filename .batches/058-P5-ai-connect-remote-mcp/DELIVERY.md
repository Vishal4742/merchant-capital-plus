# Batch 058 delivery: prompt-led AI connection, hosted MCP, OAuth

Branch `wf/ai-connect` (worktree `P:\wf-ai`), 9 local commits on `wf/int-testnet-e2e@d87d3ac`. **Nothing is pushed, merged, deployed or migrated.**

## 1. What is verified and what is not

| Item | Status |
|---|---|
| Frontend: `/connect`, `/merchant/ai`, consent screen, nav, rebrand, Overview net | Built, browser-checked at 375 and 1440 (screenshots in `shots/`) |
| Typed secret-free prompt generator | Built, 19 tests |
| Remote MCP (Streamable HTTP, stateless) + OAuth server + grants + durable journal | Built, tested over real HTTP + real Postgres (PGlite) with the SDK's own MCP client |
| Connector reliability fixes (explicit keys, 404, recovered results, prompts) | Built, 9 tests (7 failed first) |
| stdio / MCPB compatibility | Verified: the package test builds and launches the .mcpb; `packages/mcp` 67/67 |
| **ChatGPT acceptance** | **NOT DONE.** Needs a public HTTPS deployment (section 9) |
| **Claude acceptance** | **NOT DONE.** Same |
| **Final journey** (consent → profile → link → customer pays THAT link → receipt/dashboard/MCP agree) | **NOT RUN.** No payment was started, no deployer key used. Needs the above plus your separate authorization |
| Vercel runtime of `apps/mcp` | **NOT VERIFIED.** The bundle starts under Node 26 here; Vercel's Express runtime must be proven on a preview |
| Grant-list screenshot on `/merchant/ai` | Not captured (needs a database; the dev server ran with `DATABASE_URL` removed on purpose). The list is covered by tests, not by a picture |

## 2. Selected base (no secrets)

`wf/int-testnet-e2e@d87d3ac` = origin/main e7e41bf + PR #48 + PR #45. Whitechain Testnet (1874), Tether test USDT, main's MerchantPay. Auth: verified SIWE session; no workspaces or roles are claimed anywhere. Not imported: `P:\wf-051` (USDC / second contract / a literal test-key fallback), Privy, cutover branches. I did not touch contracts, relayer or settlement code, and did not re-run the earlier real payment.

## 3. Architecture

```
ChatGPT / Claude ──OAuth (PKCE S256, audience = MCP URL)──► apps/mcp  (Express, own Vercel project)
        │  POST /mcp  Bearer <opaque 10-min token>              │  /authorize → signed consent request
        ▼                                                       ▼
 apps/mcp: verify token against app_mcp_grants (live, scopes,   apps/web /merchant/ai/authorize
 audience) → fresh McpServer + stateless transport per request   (SIWE session, CSRF) → grant + 60 s code
        │ tool call → wfi1 assertion (grant, merchant, 5 min)           │ redirect to the client with code + iss
        ▼                                                               ▼
 apps/web /api/v1/*  re-reads the grant row on EVERY request (revoked? expired? merchant? scope for this path?)
 Postgres (shared): app_mcp_clients / grants / codes / tokens / journal   ← migration apps/web/db/051_mcp_remote.sql
```

Why a dedicated service: the SDK's OAuth handlers are Express, and apps/web's production build imports nothing from `packages/` (it copies code and pins it with tests), so a route there would have needed a `turbopack.root` and Vercel root-directory change I cannot verify. You chose this option on 2026-11-07.

Authorization-server library: the installed `@modelcontextprotocol/sdk` 1.32.2 (`mcpAuthRouter`, `requireBearerAuth`, `OAuthServerProvider`). I implemented only the provider (storage and rules); the endpoints, PKCE S256 enforcement, redirect matching and metadata are the SDK's.

## 4. Scopes → tools → gateway routes

| Scope | Tool | Gateway route the assertion may use |
|---|---|---|
| `account:read` | `get_business_profile` | `GET /api/v1/account` (also read internally by every tool; allowed under any scope, output only shown to this scope) |
| `links:read` | `get_payment_link`, `get_operation_status` | `GET /api/v1/links/{id}`, `GET /api/v1/operations/{key}` |
| `payments:read` | `list_payments` | `GET /api/v1/payments` |
| `reports:read` | `get_collection_summary` | `GET /api/v1/reports` |
| `links:write` (separate, unticked by default) | `create_payment_link`; `get_operation_status` with `acknowledge` | `POST /api/v1/links` |

Everything else (keys, webhooks, invoices, settlements, withdrawals, pages, vouchers, sessions, any edit or delete) is closed to assistants by `internalScope()`. No tool signs, sends money, refunds, changes a receiving wallet, approves an invoice or manages owners. Customer, invoice and reminder tools do not exist remotely.

Enforced three times: at tool call (`createRemoteServer`, also for tools omitted from discovery), at the gateway by method+path+grant scopes, and by token verification (grant live, audience).

## 5. Authorization design

- Authorization code + PKCE **S256 only**; exact redirect match, except loopback any port (RFC 8252); public clients only (dynamic registration; no stored secrets); redirect URIs https (http only loopback), ≤10, no fragment or credentials.
- Audience: tokens bound to the grant's `resource` (the MCP URL); `requireBearerAuth({expectedResource})` rejects any other. The assistant's token is never forwarded; the gateway is called with a per-request `wfi1` assertion (HMAC, aud `whiteflow-gateway`, 5 minutes, unique jti).
- Code: single use (one atomic UPDATE), 60 s, bound to client, redirect URI, challenge, audience; **a replayed code revokes the grant**. Access token 10 min; refresh rotates, **reuse revokes the grant**. All credentials opaque, stored as SHA-256.
- Consent: the merchant shown is the SIWE session's, never the prompt's; the request is HMAC-signed by the MCP service (10 min); CSRF token bound to merchant + request; JSON-only POST; `frame-ancestors 'none'`; state returned untouched with RFC 9207 `iss`.
- Revocation: Disconnect marks the grant and tokens revoked; the next tool call and refresh fail (tested).
- Fails closed: missing config → 503 `not_configured` on every protocol and OAuth route; gateway rejects assertions without `MCP_INTERNAL_SECRET`.

## 6. Connection states

Setup required → Authorized, awaiting verification → Verified → Reauthorization required / Revoked / Service unavailable. "Verified" is set only by `last_tool_ok_at`, written when an authorized tool call succeeds (the page shows when, never "connected"). Consent, copying a prompt, `tools/list` and the frontend health check do not write it (tested).

## 7. Generated setup prompts (placeholder hosts)

Real output of `buildSetupPrompt`, with `whiteflow.example` placeholders. The page only offers these when `WHITEFLOW_MCP_REMOTE=on` and both URLs are valid public https; otherwise it says setup isn't available.

### ChatGPT

```text
Help me connect WhiteFlow using https://whiteflow.example/connect.
The MCP endpoint is https://mcp.whiteflow.example/mcp.
If WhiteFlow tools are already available, call get_business_profile and show the authorized merchant, network and supported capabilities.
Otherwise guide me through this assistant's supported custom connector setup and WhiteFlow authorization.
If you cannot install connectors, explain the manual steps.
Never claim connection success without a successful tool call.
Never ask me to paste credentials into chat.
Do not create a payment or payment link merely to test setup.

Setup steps for ChatGPT on the web (names as in OpenAI's custom MCP guide; your workspace may restrict this, so ask an admin if an option is missing):
1. In ChatGPT, open Plugins, select the plus button, then choose Add custom MCP server.
2. Enter the name WhiteFlow and, under Connection, the Server URL https://mcp.whiteflow.example/mcp.
3. Set authentication to OAuth, select I understand and want to continue, then Create as a plugin.
4. Install the plugin, enable it for the conversation, and sign in to WhiteFlow when asked. Check the permissions shown on WhiteFlow's consent screen.
```

### Claude app

```text
(the same eight lines, then)
Setup steps for the Claude app (names as in Anthropic's custom connector guide; on Team and Enterprise only an owner can add a connector):
1. Open Customize, then Connectors, click + Add, then Add custom connector.
2. Enter the name WhiteFlow and the remote MCP URL https://mcp.whiteflow.example/mcp, then continue.
3. Choose to sign in now, and finish WhiteFlow's consent screen in the browser. Check the permissions it shows.
```

### Claude Code (under Advanced)

```text
(the same eight lines, then)
Advanced setup for Claude Code (a terminal client; the Claude app steps are the usual way):
1. Run: claude mcp add --transport http whiteflow https://mcp.whiteflow.example/mcp
2. In Claude Code run /mcp, choose WhiteFlow and follow the browser sign-in and WhiteFlow consent.
3. To disconnect, run: claude mcp logout whiteflow
```

Step names come from the vendors' own pages read on 2026-11-07 (OpenAI custom-MCP guide and auth page; Claude help article 11175166; code.claude.com/docs/en/mcp). No install deep link, chat-prefill URL, npm installer or marketplace listing is used. Vendors change UI names: re-check before launch.

## 8. Test evidence (Node 26.13.0, Windows)

| Suite | Command | Result |
|---|---|---|
| apps/web | `npm run typecheck` · `npm run lint` · `npm test` · `npm run build` | tsc clean · eslint clean · **771 pass, 0 fail, 2 skipped** · build succeeds (`/connect`, `/merchant/ai`, `/merchant/ai/authorize` in the route table) |
| packages/mcp | `npm run typecheck` · `npm test` | clean · **67 pass, 0 fail** (43 original + 9 reliability + 6 Postgres journal + 9 remote) |
| apps/mcp | `npm run typecheck` · `npm test` · `npm run build` | clean · **21 pass, 0 fail** · bundle `dist/index.mjs`; started unconfigured it answers `/health` 200 and everything else 503 `not_configured` |
| Browser (Chrome, Playwright) | `/connect` copy flow, 375 + 1440 | 14/14: no overflow, arrow-key client change, Enter copies, clipboard read-back has endpoint + host steps and no secret shapes, forced clipboard failure shows a focused fully selected text box |
| Browser | consent screen, 375 + 1440 | defaults ok (read ticked, `links:write` off), Tab reaches `links:write` and Space toggles it, approve failure shows a plain message and stays on the page, Approve disabled with nothing ticked, tampered request shows "expired" with no form |
| Secret scan | CI's `git grep` | clean, no `.env` tracked |

Security-relevant cases covered by named tests: consent denial; code replay (revokes grant); PKCE mismatch (code left unspent); expired code; wrong redirect URI; wrong client; wrong audience; expired access token; refresh rotation and reuse; Disconnect → next call and refresh refused; scope denial with zero gateway calls; cross-merchant (assertions, grants, journal documents, link reads, revoke → 404); origin allow-list; session id is not a credential; `/health` vs `/ready`; assertion tampering/expiry/wrong audience/missing secret; CSRF missing/wrong/other-merchant; 20 concurrent identical creates on separate instances → one key, one entry; retry after restart resumes the same key; explicit-key guards.

Honesty notes on process: the prompt-generator state tests, the Overview net test and the connector tests were run red first; the `ai-config` tests, the gateway principal tests, the grant tests and the consent-route tests were written before the code but I did not run them red separately.

## 9. External prerequisites (owner actions, nothing done)

1. **Approve the SRS-CHANGE** (FR-MCP-18 remote endpoint, FR-MCP-19 OAuth, FR-MCP-20 connection states; the `/connect` guide). Until then code cites FR-MCP-1..4, FR-GW-1, FR-GW-14. claude-research owns the SRS.
2. **Database:** an owner applies `apps/web/db/051_mcp_remote.sql` (new tables only, `IF NOT EXISTS`) with `apps/web/db/migrate.mjs`. Do **not** run it from this branch against the shared database before reading section 10 and the earlier #43 incident (memory `whiteflow-testnet-e2e-057`).
3. **New Vercel project** `merchant-capital-mcp`, connected to the repo, root directory `apps/mcp`, deployed from GitHub only, with "include source files outside the Root Directory" ON (it imports `packages/mcp`; the build runs `npm run build` and must serve `dist/index.mjs`'s default export). **Unverified on Vercel**: prove it on a preview. `tools/vercel-ignore.sh` needs an entry for it.
4. **Environment** (values never in git): on `apps/mcp`: `WHITEFLOW_MCP_PUBLIC_URL` (https, ends `/mcp`), `WHITEFLOW_WEB_ORIGIN`, `MCP_INTERNAL_SECRET` (≥32 chars), `DATABASE_URL`, optional `WHITEFLOW_MCP_ALLOWED_ORIGINS`. On `apps/web`: the **same** `MCP_INTERNAL_SECRET`, `WHITEFLOW_MCP_PUBLIC_URL`, and last `WHITEFLOW_MCP_REMOTE=on` (the page offers setup only when this is on).
5. **CI job for `apps/mcp`** (CI is yours to approve, PIPELINE §11): the existing `mcp` job covers only `packages/mcp`. Proposed: a job gated on `apps/mcp/**`, `packages/mcp/**`, `apps/web/lib/server/mcp-*`, running `npm ci && npm run typecheck && npm test && npm run build` in `apps/mcp`; add it to the required checks.
6. **New dependencies to approve** (PIPELINE §11): `apps/mcp`: express 5.3.0 (already an SDK dependency, now direct), @types/express 5.0.6, @neondatabase/serverless 1.2.0, esbuild 0.28.2, @electric-sql/pglite 0.5.11 (dev); `packages/mcp`: @electric-sql/pglite 0.5.11 (dev). All pinned.
7. **Host registration:** read each host's callback from its own screen when registering (ChatGPT shows it on the connector draft; the Claude help page I read doesn't state one). Dynamic registration accepts https callbacks, so no pre-registration is needed unless a host requires a fixed client.

## 10. Rollout and rollback

Rollout (nothing before 1 is irreversible; 1–4 touch nothing users see):
1. Review and open the PR from `wf/ai-connect`. **It contains PR #45 and #48's content** (the base branch is the unpushed integration branch): decide whether to land those first and rebase, or to review this as a stack.
2. Owner applies migration 051 (additive).
3. Create the Vercel project and env (section 9); deploy `apps/mcp` preview; `GET /health` 200, `/ready` 200, `/.well-known/oauth-authorization-server` shows S256 only.
4. Deploy web with `WHITEFLOW_MCP_REMOTE` **unset**: the rebrand, nav, Overview and `/connect` ship; `/connect` says setup isn't available.
5. Run ChatGPT and Claude acceptance separately against the preview (section 11), then set `WHITEFLOW_MCP_REMOTE=on`.

Rollback: unset `WHITEFLOW_MCP_REMOTE` (the page stops offering setup); to cut access instantly, run `UPDATE app_mcp_grants SET revoked_at = <ms> WHERE revoked_at IS NULL` or remove `MCP_INTERNAL_SECRET` from web (the gateway then refuses every assertion) or delete the apps/mcp project. The migration is additive; leave the tables, or `DROP TABLE app_mcp_tokens, app_mcp_codes, app_mcp_grants, app_mcp_clients, app_mcp_journal` once nothing depends on them. Reverting the web deploy restores the old nav and name; no stored data depends on them.

## 11. Client acceptance procedure (run separately for each; record results in `client-verification.md`)

For ChatGPT, then Claude app (then optionally Claude Code): on the preview with `WHITEFLOW_MCP_REMOTE=on`, copy the prompt from `/merchant/ai`; add the connector as the prompt says; confirm the OAuth redirect lands on the consent screen with the right assistant name, your merchant and Testnet; approve read access only; ask "Show my WhiteFlow business profile" → expect the tool call, then the grant reads **Verified** with that time on `/merchant/ai`; separately re-authorize with `links:write` and ask for a link; Disconnect and confirm the next request fails. Pay the created link only with your explicit authorization, from a wallet you choose; then compare the chain receipt, the dashboard and `get_payment_link`/`list_payments`. Do not use the deployer key.

## 12. Known gaps and limits

- No CIMD: the installed SDK has no server-side support. Registration is dynamic only (ChatGPT's auth page lists DCR; Claude says "Register automatically"). If a host requires CIMD, that is a follow-up.
- DCR and token rate limits are the SDK's in-memory ones, per instance (serverless): upgrade to a shared limiter if abused. Registered clients are not capped or expired.
- Grants live 30 days; a refresh can't narrow scopes; changing scopes means a new consent.
- `PgJournal` is one JSON document per merchant (capped by pruning); fine at this scale, upgrade trigger noted in the migration.
- Workspace roles are not integrated: identity is the verified SIWE merchant only.
- "Open setup instructions" as a secondary link on `/merchant/ai` is not added (the guide is on the same page and at `/connect`).
- The Overview's data paths are unchanged (chain + DB reads); I did not re-verify them with live data in this session. The gross/fee/net maths is unit-tested.
- Next dev showed the app's own "4 issues" only because `DATABASE_URL` was deliberately removed.
