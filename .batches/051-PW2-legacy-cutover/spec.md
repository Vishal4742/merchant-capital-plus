# Spec: 051-PW2-legacy-cutover

Lead lane: whiteflow-ef. Stacked on PR #44 (`wf/stage3-identity` @d8a99ef). Uses f3's batch-050 exports without editing them: `contextFromRequest`, `mutationContext`, `publicOrigin`, `newId`, `requestIdOf` (auth-sessions.ts); `requireScope`, `Forbidden`, `notFound`, `concurrencyConflict`, `SECRET_KEY_SCOPES` (identity.ts); `readV1Obligations` (policies.ts; its L4 fix `advanceOf != 0n` is f3's round-2 work); `v2`, `body` (v2.ts).

## Problem
After batch 050, WhiteFlow sign-in (Privy), workspaces and roles exist, but the legacy gateway beside them still trusts the old self-contained wallet cookie (`mc_session`) in the 21 v1 handlers and 13 dashboard pages: no roles, no server-side revocation, no workspace. API keys belong to a wallet, not a business. The 032 backfill plan (one principal per legacy wallet) no longer works: a Privy principal is a Privy user id, not a wallet, so the server can't know which person owns a legacy merchant wallet. The link must be **claimed**: a signed-in Owner proves control of the legacy merchant wallet with a fresh, purpose-bound signature, and only then does their workspace take over that wallet's gateway records.

## Requirements (cite docs/SRS.md IDs)
- FR-BIZ-1 (business resolved on the server from the session's active membership, never from a client id), FR-BIZ-2 (v1 routes enforced by role via the R2-1 map), FR-BIZ-3 (pattern reused for the claim proof: fresh, single-use, short-lived, domain-bound EIP-4361 challenge; EOA only).
- FR-AUTH-1 (one AuthContext for every v1 entry point; guessed/foreign ids → 404), FR-AUTH-2 (old cookie no longer accepted; removal effective next request), FR-AUTH-3 (keys belong to a business: `business_id` set at creation in a linked workspace and backfilled at claim), FR-AUTH-5 (audit rows for the claim and every v1 mutation).
- CON-11 (`v1_obligations` from the V1 CapitalMarket read at claim; a failed read refuses the claim), NFR-17 (no signature, challenge message or token in logs, audit detail or responses beyond the challenge itself).
- Spec 032 items 4, 12, 13, 19 (as adapted below for Privy) and R2-1.

## Design

### A. Legacy claim (new; `lib/server/legacy.ts`, `app/api/v2/legacy/**`, migration `054`)
1. `GET /api/v2/legacy` (session; any role): `{ workspace: null }` without an active workspace, else `{ workspace: { id, displayName, role }, linked: "0x…"|null, v1Obligations }`. 401 signed out; 503 DB down (`v2`).
2. `POST /api/v2/legacy/challenge {address}` (session, `business:manage` = Owner, same-origin). Refused 409 if the active workspace is already linked. `sharedRateLimit("legacy-claim:<principal>", 10/min, "closed")`. Server-built EIP-4361 message like f3's receiving proof: `domain`/`uri` from `PUBLIC_ORIGIN`, chain 1874, viem nonce, 10-min expiry, statement "WhiteFlow merchant-account link: this wallet's existing gateway records (links, pages, vouchers, keys, webhooks, payments) will be managed by the members of "<name>" by role. It moves no funds.", `resources: [urn:whiteflow:business:<id>, urn:whiteflow:principal:<id>]`. Stored in `wf_legacy_claim_challenges` bound to principal + business + address (a new table on purpose: it doesn't touch `wf_challenges.purpose`, which f3's H1 work may extend in 053). Returns `{ nonce, message, expiresAt }`.
3. `POST /api/v2/legacy/claim {nonce, signature}` (session, Owner, same-origin):
   1. Nonce format, 65-byte signature format (400).
   2. Load the challenge bound to `(nonce, principal, business)`; unknown/used/expired → idempotent-replay check (below) else 409 "expired or already used".
   3. `recoverMessageAddress(stored message)` must equal the bound address; otherwise refused and the **challenge stays unconsumed**.
   4. CON-11 read `readV1Obligations(address)`; a throw → 503, nothing linked (fail closed).
   5. One statement `SQL_CLAIM` (lock order membership → business, same as f3's member changes, so no new deadlock pair): `actor` = caller's Owner membership `FOR SHARE`; `b` = `UPDATE wf_businesses SET legacy_merchant, v1_obligations WHERE id AND legacy_merchant IS NULL AND actor AND challenge valid`; `c` = consume the challenge only if `b` updated; `k` = `UPDATE app_gw_keys SET business_id WHERE merchant = address AND business_id IS NULL`; `n` = notify every Owner (actor included); `a` = audit `legacy.claim` with detail `{v1Obligations, keysLinked}` (no signature/message).
   6. Outcomes: `23505` on the unique `legacy_merchant` index → 409 "That merchant account is already linked to another workspace" (statement aborted: challenge unused); `40P01/40001` → 409 (`concurrencyConflict`); `is_owner = 0` → 403; nothing claimed but business already linked to this address by this consumed challenge → the same 200 (idempotent replay); else 409.
   7. Response `{ merchant, v1Obligations }` read from the business row (identical on replay).
4. Migration 054 (additive, re-run safe, splitter-compatible): `wf_legacy_claim_challenges` + expiry index. Rollback: `DROP TABLE IF EXISTS wf_legacy_claim_challenges` (053 columns stay).

### B. v1 cutover (R2-1 map; helper `legacyAccess(request, scope, {secretKey})` in `lib/server/legacy.ts`)
- Session path: `contextFromRequest` (GET) or `mutationContext` (any other method: CSRF) → `requireScope(ctx, scope)` (no workspace 401, wrong role 403) → the business's `legacy_merchant`; unlinked → 409 "This workspace isn't linked to a merchant account yet. An Owner can link it in Settings." Returns `{ ctx, merchant }`; the existing service is called with `merchant` exactly as before.
- Key path (`secretKey: true` only where a key works today: webhooks GET/POST): `authenticateKey` → must be `sk_` (pk_/invalid → 401 as today) → `scope ∈ SECRET_KEY_SCOPES` (else 403) → key `business_id` must be set (unlinked key → 409: it can't manage) → that business's `legacy_merchant`.
- The old cookie is accepted nowhere: `signedInMerchant` is deleted from http.ts, `merchantByCookieOrSecretKey` from keys.ts; `lib/merchant-session.ts` reads `wf_session` via `contextFromRequest` (Request built from the cookie) + the business link and exports `currentWorkspace()` → `{merchant, role, scopes, businessId} | null` (any error → null: fail closed, no data rendered; the dashboard's `GET /api/v2/legacy` then explains a 503).

| Route | Scope | Who |
|---|---|---|
| keys GET/POST, keys/[id] DELETE | keys:manage | Owner |
| webhooks GET/POST | webhooks:manage | Owner, or a linked `sk_` key |
| webhooks/[id] DELETE, webhooks/[id]/test, webhooks/deliveries/[id]/replay | webhooks:manage | Owner (no new key powers in 051) |
| capital/offers/[id]/publish | business:manage | Owner |
| links POST, links/[id]/cancel, pages POST, vouchers POST, vouchers/[id]/deactivate, vouchers/[id]/publish | invoices:draft | Owner, Operator |
| payments/[id]/refunds/sync | refunds:propose | Owner, Operator |
| links GET, pages GET, vouchers GET | invoices:read | all roles |
| reports, reports.csv, settlements | payments:read | all roles |
| capital/merchant | account:read | all roles |

- Unchanged: sessions POST, sessions/[id] GET, payments GET keep resolving a live `sk_` key (or `SHOP_API_KEY`) by its merchant: requiring a linked key there would break unclaimed shops (a Stage 4 decision). Public/checkout/pay/funds/quotes/capital investor routes are not merchant-authenticated.
- Keys: `createKey(merchant, label, kind, businessId)` stores `business_id`; `authenticateKey` also returns `businessId`.
- Audit: every v1 mutation writes `wf_audit_events` after success (action `v1.<route>`, actor, role, source, credential, request id, target id). A separate statement, not atomic with the legacy write (atomic with the Stage 4 services); disclosed as a residual risk.

### C. Dashboard (minimal UI)
- `components/workspace/LegacyAccess.tsx` (new, client): the signed-out/unlinked panel driven by `GET /api/v2/legacy`: signed out → "Sign in to WhiteFlow" (`/sign-in`); no workspace → "Create your workspace" (`/merchant/settings`); Owner + unlinked → "Link your merchant wallet" (`eth_requestAccounts` → challenge → `personal_sign` → claim → reload); Operator/Viewer → "Ask an Owner of <name> to link it". Errors worded with `lib/onboarding` `walletProblem`. Also exports `WorkspaceSignOut` (`POST /api/v2/auth/signout` → `/sign-in?out=1`).
- `components/gateway/Frame.tsx`: `SignedOut` renders `LegacyAccess` instead of the SIWE `SignIn` (copy to match); `Account` renders `WorkspaceSignOut`.
- `app/merchant/developers/page.tsx`, `app/merchant/connections/page.tsx`: API keys and webhooks render only with `keys:manage` (Owner); other roles see "Only Owners can see API keys and webhooks."

## Acceptance criteria (cite AT-… where one exists; each must be checkable)
- [ ] 1 Claim: an Owner links a legacy wallet with a valid signature → `legacy_merchant` + `v1_obligations` set, the wallet's existing keys get `business_id`, one `legacy.claim` audit row without signature/message, every Owner notified; no `app_gw_*`/`app_web_*` row changes except `app_gw_keys.business_id` (032 item 19 "no row lost").
- [ ] 2 Claim proof can't be forged or reused (FR-BIZ-3 pattern): wrong signer → refused and challenge unconsumed; another principal's or business's challenge → 409; expired → 409; message altered → refused; used challenge → 409 except the replay rule.
- [ ] 3 Claim races on real Postgres (independent processes, gated on `pg_stat_activity` Lock waits): (a) same challenge twice → one link, the other the same 200, one audit row; (b) two workspaces claim one wallet → one wins, the other 409 and its challenge unused; (c) claim vs the actor's removal → either linked by a still-Owner or 403 with nothing linked.
- [ ] 4 CON-11 / AT-47: obligation read true → flag set; read throws → 503, nothing linked or consumed.
- [ ] 5 Only Owners claim (AT-28): Operator/Viewer → 403; API key → 401; signed out → 401; cross-origin POST → 403.
- [ ] 6 R2-1 matrix (AT-27, AT-28): every cut-over handler × {Owner, Operator, Viewer, signed out, old `mc_session` cookie} gives the table's result; unlinked workspace → 409.
- [ ] 7 No legacy bypass: a valid old `mc_session` cookie → 401 on every cut-over handler and `currentWorkspace()` null.
- [ ] 8 Removal/demotion loses v1 access on the next request (FR-AUTH-2).
- [ ] 9 Keys: linked `sk_` manages webhooks of its own business only; unlinked `sk_` → 409; `pk_` → 401; keys created after linking carry `business_id`; checkout routes keep working with linked and unlinked keys.
- [ ] 10 Tenant isolation (AT-27): a guessed/foreign link, voucher, webhook, delivery or key id in another workspace → 404 (existing OTHER_MERCHANT tests run through workspaces).
- [ ] 11 No regressions: full web suite with `signedIn()` re-pointed to a seeded workspace session; `tsc`, `lint`, `build`.
- [ ] 12 NFR-17: captured logs, audit detail and API responses (beyond the challenge) never hold a signature, challenge message or session token.
- [ ] 13 Browser: signed-out dashboard → sign-in → link → dashboard data visible. NEEDS THE USER for a real Privy login; otherwise the server journey test stands in, plus a screenshot of the signed-out panel states.

## Files to touch (owner lane whiteflow-ef: only these)
- `apps/web/db/054_legacy_claim.sql` (new)
- `apps/web/lib/server/legacy.ts` (new)
- `apps/web/app/api/v2/legacy/route.ts`, `.../legacy/challenge/route.ts`, `.../legacy/claim/route.ts` (new; carve-out sent to f3)
- `apps/web/app/api/v1/{keys,keys/[id],webhooks,webhooks/[id],webhooks/[id]/test,webhooks/deliveries/[id]/replay,links,links/[id]/cancel,pages,vouchers,vouchers/[id]/deactivate,vouchers/[id]/publish,payments/[id]/refunds/sync,reports,reports.csv,settlements,capital/merchant,capital/offers/[id]/publish}/route.ts` (the 18 files that call the old helpers)
- `apps/web/lib/server/keys.ts`, `apps/web/lib/server/http.ts` (remove `signedInMerchant` only)
- `apps/web/lib/merchant-session.ts`
- `apps/web/components/gateway/Frame.tsx`, `apps/web/components/workspace/LegacyAccess.tsx` (new)
- `apps/web/app/merchant/developers/page.tsx`, `apps/web/app/merchant/connections/page.tsx`
- `apps/web/test/gw-helpers.mjs` (`signedIn()` → seeded workspace session), `apps/web/test/legacy-claim.test.mjs`, `apps/web/test/legacy-cutover.test.mjs` (new); existing tests only where they assert the old cookie or the `merchantByCookieOrSecretKey` wording
- `tools/stage3/legacy-neon.mjs` (new; real-Postgres races on the isolated Stage 3 databases)
- `.batches/051-PW2-legacy-cutover/**`

## Ponytail ladder (why this is the smallest change that works)
- Needed at all? Yes: without it the roles of batch 050 don't protect the gateway, which still answers to one wallet cookie.
- Already in repo? The services stay as they are; only who-is-calling changes. Session validation (`contextFromRequest`), scopes (`requireScope`), the obligations read (`readV1Obligations`) and the EIP-4361 builder (viem/siwe as in policies.ts) are reused.
- Stdlib/platform? viem `recoverMessageAddress`, `createSiweMessage`, `generateSiweNonce`; Postgres CTE + unique index for the race-free claim.
- Installed dependency? No new dependency.
- Minimum code: one helper replaces two; one claim statement; one client panel; pages keep calling `currentMerchant()` and only the two Owner-only pages change.

## Rollout / rollback
- Rollout: apply 054, deploy web (with the 050 stack). Every existing merchant must sign in with Privy and link their wallet once: the old wallet sign-in stops working at deploy (gate packet + release note for the owner).
- Rollback: redeploy the previous build (it reads `mc_session` again and ignores `legacy_merchant` / `app_gw_keys.business_id`); the 054 table may stay.

## Residual risks (disclosed)
- v1 audit rows are not atomic with the legacy writes (Stage 4 services make them atomic).
- EOA-only claim proof: a contract-wallet merchant can't link until EIP-1271 is tested (FR-BIZ-3).
- The SIWE endpoints `/api/auth/{nonce,verify,logout}` and the SIWE `SignIn` component stay in the tree but grant nothing (cleanup batch below).
- Checkout routes still accept unlinked `sk_` keys by merchant (Stage 4).

## Out of scope
- Deleting the retired SIWE endpoints, `lib/auth.ts` SIWE helpers and `components/merchant/SignIn.tsx` (it also holds the `window.ethereum` global `WalletPay` relies on): a cleanup batch.
- Idempotency keys for v1 writes (FR-AUTH-4 arrives with the Stage 4 services); unlinking or re-linking a merchant account (no path; an operator SQL change, audited); WhiteFlow invoices (Stage 4); MCP OAuth (Stage 6); email invites.
