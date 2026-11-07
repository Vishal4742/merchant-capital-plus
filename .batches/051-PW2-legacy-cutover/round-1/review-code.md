VERDICT: FAIL

# Batch 051 round 1: code review (independent)

Scope: `git diff origin/wf/stage3-identity...HEAD` on `wf/stage3-v1-cutover` (b7493b0..4cf9712): 40 files, +1562/−156.

Evidence I ran (Node 26.13.0):
- `node --experimental-test-module-mocks --test test/legacy-claim.test.mjs test/legacy-cutover.test.mjs`: 16/16 pass.
- Full `test/` suite: 806 pass, 2 skipped, 1 fail. The failure is the invoice-pay S5 timing race; it passed twice in isolation (see the observation at the end).
- `npx eslint` on every changed source file: exit 0.
- `npm run typecheck` (`next typegen && tsc --noEmit`): **FAILS**; see C-H1.

The verdict is FAIL because of one high finding (C-H1). Security findings are in `review-security.md`. Two of them (S-M1, S-M2) also touch code quality and are only cross-referenced here.

## Findings

### C-H1 (high, CONFIRMED): the web typecheck fails on HEAD, so CI and the pre-push hook are red
- **Error:** `components/merchant/SignIn.tsx(17,5): error TS2717: Subsequent property declarations must have the same type. Property 'ethereum' must be of type 'any', but here has type 'EIP1193Provider | undefined'`.
- **Cause:**
  - `components/gateway/Frame.tsx` no longer imports `components/merchant/SignIn.tsx`, which changes the order in which tsc reads the files.
  - SignIn's `declare global { interface Window { ethereum?: EIP1193Provider } }` is now merged *after* `@privy-io/react-auth`'s `ethereum?: any` (`dist/dts/types-*.d.ts:541`; `cbw-sdk` declares the same).
  - TS2717 is reported at whichever declaration comes later. That is now the project file, and `skipLibCheck` no longer hides it.
- **Evidence:**
  - I exported base (`origin/wf/stage3-identity`) and HEAD `apps/web` with the same node_modules. Base has no TS2717; HEAD has it.
  - In the HEAD copy, adding back `import "@/components/merchant/SignIn";` at the top of Frame.tsx makes the error disappear.
  - `npm run typecheck` in `P:/wf-051/apps/web` fails with exactly this error.
- **Impact:** CI's required `web` check runs `npx next typegen && npx tsc --noEmit` (`.github/workflows/ci.yml:80`), and the pre-push hook runs `npm run typecheck` (`tools/githooks/pre-push:31`). The branch can't be pushed or merged, which fails acceptance 11.
- **Fix:** don't rely on import order. Delete the `declare global` block in `components/merchant/SignIn.tsx`, since Privy already types `window.ethereum`. Alternatively, cast locally the way `LegacyAccess.tsx:45` does, in SignIn.tsx and the few `window.ethereum` users (WalletPay, capital `wallet.ts`, `useInvestor`, Withdraw), and update the comment at `WalletPay.tsx:17`. This needs SignIn.tsx added to the spec's file list (an amendment).

### C-M1 (medium, CONFIRMED by trace): the Settings page still runs the retired SIWE sign-out and copy (see S-M2)
- **Sign-out:** `app/merchant/settings/page.tsx:8,119` renders `SignOut` from `components/merchant/SignIn.tsx`. It clears only `mc_session`, so it does nothing for the `wf_session` that now opens the page.
- **Stale disclosure** on the same card: "Sign-In with Ethereum (SIWE)… Single-wallet SIWE session".
- **Link step hidden:** on the unlinked branch (`:52-61`), the link step (`SignedOut` → `LegacyAccess`, plus a whole `PlainPage` marketing layout) is inside a collapsed `<details>` labelled "Legacy dashboard sign-in (wallet)". Meanwhile the 409 text (`legacy.ts:26`) tells members "An Owner can link it in Settings".
- **Fix:** use `WorkspaceSignOut`, update the disclosure, and give the link panel its own visible section in Settings. This also needs a file-list amendment.

### C-M2 (medium, CONFIRMED by trace): gw-helpers' lazy seeding makes test results depend on test order
- **Mechanism:** `wanted` (`test/gw-helpers.mjs:92`) is never cleared by `resetDb()` (`:79-85`). Once any test in a file calls `signedIn(X)`, every later test in that file gets X's *linked* workspace and Owner written on its first database call.
- **Concrete case:** `legacy-cutover.test.mjs:115` creates "a key of a wallet nobody linked" with `createKey(OTHER_MERCHANT, …)` and expects 409. That only holds because the test that calls `signedIn(OTHER_MERCHANT)` (`:134`) runs later. If the two swap, or any earlier test signs in as OTHER_MERCHANT, `createKey`'s subquery sets `business_id`. The key is then linked, and the assertion fails, or a refusal test passes for the wrong reason.
- **Side cost:** every query in a file that called `setupDb()` now pays an extra `await seedWanted()`, even when nothing is wanted.
- **Fix:** in tests that assert "unlinked" or "no workspace", use a dedicated address that is never passed to `signedIn()`. Make `seedWanted` return synchronously when every wanted merchant is already seeded. Optionally document that `wanted` outlives `resetDb()` on purpose.

### C-M3 (medium): the claim has no rate limit and does the RPC read before the uniqueness check (see S-M1)

### Low
- **C-L1, dead or unused exports** (`apps/web/lib/server/legacy.ts`):
  - `NOT_LINKED` (`:26`), `CLAIM_TTL_MS` (`:20`) and `linkedMerchantOf` (`:49`) are used only inside the file.
  - The `SQL_CLAIM` comment (`:118`) says "exported for the real-Postgres harness", but `tools/stage3/legacy-neon.mjs` never imports it; it calls `claimLegacyMerchant`.
  - Fix: drop the exports, or fix the comment.
- **C-L2, test hook in production code:** `setObligationsRead` (`legacy.ts:35-39`) is a mutable, module-level test hook. The suite already runs with `--experimental-test-module-mocks`, so `mock.module("../lib/server/policies.ts", …)` in `legacy-claim.test.mjs` can replace it. The `{obligations}` option stays for direct callers.
- **C-L3, leftover prop and eslint-disable:** `Frame.tsx:94-98` has an eslint-disable and an ignored `available` prop. Nine callers still compute `Boolean(authSecret())` for nothing. Remove the prop at the call sites, here or in the planned SIWE cleanup batch, and record it in that batch's list.
- **C-L4, one name for two things:** `LegacyAccess` is both the `{ctx, merchant}` interface (`legacy.ts:214`) and the React panel (`components/workspace/LegacyAccess.tsx`). Rename the interface (for example `V1Caller`) so code search can tell them apart.
- **C-L5, the code and the spec differ** (fix the code or amend the spec):
  - A malformed nonce answers 409 (`legacy.ts:179`); spec A.3.1 says 400.
  - Wallet errors use `walletError` (`lib/merchant-wallet`); the spec names `walletProblem` (`lib/onboarding`).
  - `createKey` takes the workspace through the `legacy_merchant` subquery instead of a `businessId` parameter. That is equivalent and arguably safer, but the spec should match.
- **C-L6, a 409 for a link that already exists:** if one Owner opens two challenges for the same wallet and submits both, the loser gets 409 "already linked to a merchant account" even though the link it asked for exists. In the fallback (`legacy.ts:208-211`), return the same 200 when `legacy_merchant === c.address`.
- **C-L7, stale developer docs** (outside the file list; hand to the docs lane):
  - `lib/docs-reference.ts:415` still gives the 401 example "Sign in to your merchant dashboard first.".
  - `app/docs/page.tsx:583` still says "Sign in to the dashboard with your shop's wallet".
  - Nothing documents that webhooks GET/POST with a secret key now answer 409 until the merchant wallet is linked. This breaks AT-14 setup scripts until the link is made; it is disclosed in the rollout, but the API reference should say it.
- **C-L8, a fake Request:** `dashboardWorkspace` builds a dummy `Request("http://dashboard.invalid/")` to reuse `contextFromRequest`. It works, but a token-taking variant in auth-sessions (f3's file) would be cleaner; leave a note for f3.
- **C-L9, test gaps a broken implementation would pass:**
  1. No test covers keyAccess's "key merchant ≠ business link" check (`legacy.ts:241`); deleting it stays green.
  2. Audit is asserted only for `v1.links.create`; any of the other 13 mutation handlers could drop `auditV1` and stay green. I checked by hand that all 14 call it.
  3. In the R2-1 matrix, "allowed" means anything except 401/403/409, so a 500 counts as allowed. That is needed for the capital routes with the network off, but it would also hide a crash in `legacyAccess` for an allowed role. Assert `< 500` for the routes that don't touch the network.
  4. Operators and Viewers being refused keys and webhooks on the dashboard pages is untested; only `dashboardWorkspace` scopes are tested.
  5. The claim racing a *demotion* isn't in the harness. Removal is, and it is symmetric by trace.

### Observation (not attributed)
- The invoice-pay S5 test (an 80 ms timing race, `test/invoice-pay.test.mjs:370`) failed once during the full-suite run and passed twice alone. It isn't in this batch's files. It does go through gw-helpers' DB wrapper, which now awaits `seedWanted()` on every query, so the extra await may shift the interleaving (PLAUSIBLE). The fix in C-M2 removes that variable.

## Sound (what I checked)
- **`legacy.ts`** (282 lines; every function under 50 lines):
  - `SQL_CLAIM` is one statement. `b` depends on `actor` and on a valid challenge; `c` depends on `b`; `k`, `n` and `a` depend on `c`.
  - The outcome mapping is correct: claimed → 200; `is_owner 0` → 403; nothing claimed → re-read the challenge, then replay 200 if consumed, else 409.
  - 23505 is mapped by constraint name. 40P01/40001 go through `concurrencyConflict`. Other errors fall through to `v2` (503 if the database is down) or `handle` (500 with the name only).
- **`legacyAccess`, `keyAccess`, `dashboardWorkspace` and `auditV1`** behave as specified, and their error messages are clear.
- **The 18 route handlers:** the scope matches R2-1 everywhere. Auth runs before param, body and rate-limit work. Each mutation is audited after success. No leftover imports of the deleted helpers.
- **Supporting files:**
  - `keys.ts`: `createKey` sets `business_id` from the unique `legacy_merchant`; `authenticateKey` returns `businessId`.
  - `http.ts` loses only `signedInMerchant`.
  - `merchant-session.ts` fails closed.
- **UI:**
  - `LegacyAccess.tsx` (180 lines): the panel states (signed out / no workspace / linked / non-Owner / Owner link flow), errors worded for people, and the server enforces every rule. The eslint-disable for the location-assign rule refers to a rule that exists.
  - `developers` and `connections` show keys and webhooks to Owners only.
- **Migration 054:** additive, `IF NOT EXISTS`, splitter-compatible (2 statements; the `;` inside comments is stripped first), CHECKs on address and message length, expiry index for the prune. The rollback is correct.
- **Real-Postgres harness** (`tools/stage3/legacy-neon.mjs`, `legacy-child.mjs`): it checks the target with `current_database()` first and gates each race on `pg_stat_activity` Lock waits. 3a–3d cover acceptance 3(a)–(c) in both orders of the removal race. The child prints only status and SQLSTATE. One logging nit is in S-L4.
- **Tests:** acceptance 1, 2, 4, 5, 6, 7, 8, 9, 10 and 12 are exercised against the real route handlers with real viem signatures, apart from the gaps in C-L9.
