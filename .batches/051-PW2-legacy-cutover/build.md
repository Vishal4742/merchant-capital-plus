# Batch 051 build (whiteflow-ef), 2026-11-07

Branch `wf/stage3-v1-cutover` (stacked on PR #44 @d8a99ef), pushed through the pre-push hook. The hook ran web typecheck, lint, tests, and relayer typecheck + tests, and all passed.

## Commits (TDD order)
| Commit | Step |
|---|---|
| b7493b0 | spec |
| 2abc457 | RED: claim + cutover tests. `signedIn()` becomes a seeded workspace session. RED output: legacy-claim fails (claim routes missing); gw-keys fails 5/6 on the new cookie |
| ba8c9c1 | GREEN, server: 054, `lib/server/legacy.ts`, `/api/v2/legacy/**`, the 18 v1 handlers, keys/http/merchant-session |
| 273a6da | Test infra: gw-reports/gw-settlements open the test DB; gw-outbox seeds explicitly; `PUBLIC_ORIGIN` set lazily |
| 32013ca | UI: `LegacyAccess` panel, Frame `SignedOut`/`Account`, developers/connections pages Owner-only |
| 4cf9712 | Real-Postgres race harness |

## What was built (spec items)
**A. Claim**
- `issueClaimChallenge` and `claimLegacyMerchant`, with `SQL_CLAIM`. One statement does five things:
  - takes the actor's membership `FOR SHARE`;
  - links the business (`legacy_merchant IS NULL`) only if the challenge is still valid;
  - consumes the challenge only if the link happened;
  - moves the wallet's unlinked keys;
  - writes the notices to every Owner and the audit row.
- A wrong signer → 403 and the challenge stays unused. An obligations read that throws → 503 and nothing changes.
- `23505` on `wf_businesses_legacy_merchant_key` → 409, and the statement aborts.
- A used challenge that linked this wallet here → the same 200 (idempotent replay).

**B. Cutover**
- `legacyAccess(request, scope, {secretKey})`:
  - session path: `contextFromRequest`, or `mutationContext` when the session cookie is present on an unsafe method (CSRF only matters when a cookie is sent; with no credentials the answer is 401);
  - `requireScope`;
  - the linked wallet, or 409.
- Key path (webhooks GET/POST only): a live `sk_` key, scope ∈ `SECRET_KEY_SCOPES`, linked to a business whose wallet equals the key's merchant (409 otherwise).
- `signedInMerchant` and `merchantByCookieOrSecretKey` are deleted.
- `createKey` takes `business_id` from the link inside its INSERT.
- `auditV1` runs after each v1 mutation. It is a separate statement; failures are logged, never turned into a 500 after the write.

**C. Dashboard**
- `currentWorkspace()`/`currentMerchant()` resolve `wf_session` → active membership → linked wallet. Any error gives null (fail closed).
- `SignedOut` renders `LegacyAccess`:
  - signed out → sign-in;
  - no workspace → create one;
  - Owner and unlinked → link with one signature;
  - Operator/Viewer and unlinked → "ask an Owner".
- `Account` signs out of WhiteFlow.
- The developers and connections pages show keys and webhooks only with `keys:manage`.

## Evidence (commands run, real output)
- `npm run typecheck` (next typegen + tsc): exit 0. `npm run lint`: exit 0, no warnings.
- `node --experimental-test-module-mocks --test test/` on Node 26.13.0: `ℹ tests 809 · ℹ pass 807 · ℹ fail 0 · ℹ skipped 2`, exit 0.
  - New tests: legacy-claim 8/8, legacy-cutover 8/8.
  - The cutover suite drives every one of the 23 handler×method entries through Owner, Operator, Viewer, signed out, the old cookie, an unlinked workspace, a missing or foreign Origin, removal, demotion, revocation, keys, tenant isolation and audit.
- `node tools/stage3/legacy-neon.mjs P:/WhiteFlow/.env` (Neon production HTTP driver, target `wf_s2_web` checked with `current_database()`, nothing dropped): **5/5**
  - schema: migrations through 054, applied twice.
  - 3a: one signed claim × 3 processes. Lock waits 3; statuses 200,200,200 with the same answer; 1 audit row; key moved.
  - 3b: two workspaces × one wallet. Lock waits 2; statuses 200,409 ("already linked to another workspace"); 1 workspace linked; the loser's challenge unused.
  - 3c: claim vs removal of its Owner, run free. Both outcomes were observed across two runs: run 1 "linked while still Owner" (200/200), run 2 "403, nothing linked".
  - 3d: the same race, staged (the removal already waiting). Lock waits 2; remove 200, claim 403; nothing linked; no claim audit; challenge unused.

## Residual risks (from the spec)
- v1 audit rows are not atomic with the legacy writes.
- The claim proof is EOA-only.
- The SIWE endpoints and component remain but grant nothing (batch 052).
- Checkout routes still accept unlinked `sk_` keys by merchant (Stage 4).
- Rollout ends the old wallet sign-in: every merchant must sign in with Privy and link once. This goes in the gate packet.
