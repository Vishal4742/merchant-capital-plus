VERDICT: PASS

# Batch 051 round 1: security review (independent)

Scope: `git diff origin/wf/stage3-identity...HEAD` on `wf/stage3-v1-cutover` (b7493b0..4cf9712). I treated the base branch's files (auth-sessions, identity, businesses, policies, privy-token) as context and checked how this batch uses them.
Evidence I ran:
- `node --experimental-test-module-mocks --test test/legacy-claim.test.mjs test/legacy-cutover.test.mjs`: 16/16 pass.
- Full web suite: 806 pass, 2 skipped, 1 timing flake outside this batch (see the code review).
- Node check that an invalid `new URL()` echoes its input.

I traced the SQL by hand against Postgres READ COMMITTED, EvalPlanQual (EPQ) and row-lock rules. I connected to no remote database and read no `.env` file.

There are no critical or high security findings. Two are medium.

## Findings

### S-M1 (medium, CONFIRMED by trace): the claim has no rate limit, and a failing claim can be repeated without limit, with a chain read each time
- **Where:** `apps/web/lib/server/legacy.ts:172-204` (`claimLegacyMerchant`) and `apps/web/app/api/v2/legacy/claim/route.ts`. Only the challenge endpoint is rate limited (legacy.ts:87).
- **Scenario:**
  1. The attacker creates workspace W1 and links their own wallet X.
  2. They create workspace W2 (Owner, unlinked) and ask for a challenge for X. This is allowed, because only *this* workspace's link is checked at legacy.ts:93.
  3. X signs it.
  4. They loop `POST /api/v2/legacy/claim {nonce, signature}`. Each request runs `recoverMessageAddress`, then `readV1Obligations(X)`: 1 to 3 `eth_call`s on the shared public Ankr RPC, with `retryCount: 2`. Then `SQL_CLAIM` fails with 23505 and returns 409.
  5. The challenge stays unconsumed by design (spec A.3.6), so the same request works for 10 minutes. A 503 from a failed read is also retryable forever.
- **Scale:** principals are free (Privy), and each one can mint 10 challenges a minute.
- **Impact:** the gateway's shared RPC quota can be exhausted, which breaks checkout, capital and refund reads for everyone. House rule F4 rate-limits every chain-reading route (for example `capital-merchant`: 30 a minute); this route skips it.
- **Fix:**
  1. Call `await sharedRateLimit(\`legacy-claim:${owner.principalId}\`, CLAIMS_PER_MINUTE, 60_000, "closed")` (or a separate claim bucket) right after `ownerContext`.
  2. Before the RPC read, add a cheap check: `SELECT 1 FROM wf_businesses WHERE legacy_merchant = $1`, returning 409 `TAKEN`. The unique index stays the real guard.

### S-M2 (medium, CONFIRMED by trace): the Settings "Sign out" button no longer signs out
- **Where:** `apps/web/app/merchant/settings/page.tsx:8,119` still renders the SIWE `SignOut` from `components/merchant/SignIn.tsx:206-218`. That component calls `POST /api/auth/logout` (`app/api/auth/logout/route.ts:6`), which only clears `mc_session`.
- **What changed:** after this batch, the signed-in branch of that page is reached through `wf_session` (`currentMerchant()` → `dashboardWorkspace`). The button leaves the server session live and the HttpOnly cookie in place, then `router.refresh()` re-renders the user as signed in.
- **Scenario:** on a shared computer, a member clicks "Sign out" in Settings and walks away. The next person keeps that member's workspace role (Owner: keys, webhooks, Capital publish) for up to 8 h.
- **Mitigation:** the Shell header's `Account` now renders the working `WorkspaceSignOut`, and the failed sign-out is visible after the refresh, so this is medium, not high.
- **Also stale on the same card:** "Authentication Mechanism: Sign-In with Ethereum (SIWE)… Single-wallet SIWE session".
- **Fix:** render `WorkspaceSignOut` there and update the disclosure. This adds `app/merchant/settings/page.tsx` to the batch file list.

### S-L1 (low, CONFIRMED by trace): the idempotent replay never checks the signature
- **Where:** `legacy.ts:186`. A consumed challenge for this principal and business returns `replay()` for *any* well-formed 65-byte hex signature.
- **Impact:** nothing new is revealed. The caller must be the same current Owner, and the answer equals what `GET /api/v2/legacy` already shows them. Noted only so the replay rule is a deliberate choice.
- **Optional fix:** recover from `c.message` and compare before replaying. It is cheap and makes "same request" literal.

### S-L2 (low, PLAUSIBLE): the workspace name the Owner chose is quoted in the signed statement with only `\r\n` removed
- **Where:** `legacy.ts:97`. `createBusiness` (base) refuses C0 control characters and DEL only. So C1 NEL (U+0085), U+2028/U+2029 and bidi controls (U+202A–U+202E, U+2066–U+2069) reach the wallet's signing prompt.
- **Scenario:** an attacker who phishes a legacy merchant into signing a claim for the attacker's workspace can visually reorder or hide the statement, or fake line breaks in wallets that render them. The domain line still binds, so SIWE origin checks still warn.
- **Fix:** when building the message, replace `/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu` with a space (or refuse those characters in `createBusiness`, which is f3's file).

### S-L3 (low, CONFIRMED by trace): `WorkspaceSignOut` hides a failed sign-out
- **Where:** `apps/web/components/workspace/LegacyAccess.tsx:170-174`. It swallows a failed `POST /api/v2/auth/signout` (for example a 503 when the database is down) and goes to `/sign-in?out=1`.
- **Effect:** the server session isn't revoked, and the cookie isn't cleared, because Set-Cookie is only sent on success. The person believes they signed out.
- **Note:** this copies batch 050's `WorkspaceSettings` pattern.
- **Fix:** on a non-OK answer, stay on the page and show "We couldn't sign you out. Try again."

### S-L4 (low, CONFIRMED): the harness can print the database password
- **Where:** `tools/stage3/legacy-neon.mjs:33`. If `DATABASE_URL` is malformed, `new URL(raw)` throws an uncaught `TypeError`, and Node prints its `input` property: the full connection string with the password. I reproduced this with a fake URL.
- **Note:** `tools/stage2/web-neon.mjs` has the same pattern.
- **Fix:** wrap the parse in try/catch and print only "DATABASE_URL isn't a valid URL".

### Informational (no change required)
- **I1 (lock mode):** `b` updates `legacy_merchant`, which has a UNIQUE index usable by a foreign key. So Postgres takes **FOR UPDATE** on the business row, not the FOR NO KEY UPDATE that the member changes take.
  - FOR UPDATE conflicts with the FK `KEY SHARE` locks taken by inserts that reference the business: `wf_memberships`, `wf_sessions.active_business_id` (sign-in, `setActiveBusiness`), `wf_notifications`, `wf_challenges`, `wf_settlement_policies` and `wf_legacy_claim_challenges`.
  - I traced each one. None holds a lock the claim needs later: the claim's later needs are the challenge row, key rows, and KEY SHARE on principals, and nobody holds FOR UPDATE on principals. So this is brief blocking, and there is no new deadlock pair; the spec's conclusion holds.
  - Suggest one line in the `SQL_CLAIM` comment saying so.
- **I2 (in-flight sign-out):** `SQL_CLAIM` re-checks the Owner membership but not that the session is still live. A sign-out during the RPC read (up to about 30 s with retries) doesn't stop a claim already in flight. Membership is what R2-2 needs, and FR-AUTH-2 is "next request", so this is acceptable.

## What I checked and found sound
1. **Challenge binding.** The row binds principal, business, address (lowercase, CHECK) and expiry. The lookup is keyed on `(nonce, principal, business)`, so another Owner, another workspace or an unknown nonce gets the same 409. `SQL_CLAIM`'s `b` re-checks nonce, principal, business, address, unconsumed and expiry. Domain and URI come from `PUBLIC_ORIGIN`, the chain is 1874, and the resources name the business and principal. The message is built and stored by the server, so the client never supplies it, and an altered message recovers another address.
2. **Signature recovery.** `recoverMessageAddress` (EIP-191) runs over the stored message and is compared, lowercase, to the bound address. A wrong signer gets 403 before any write, and the challenge stays unconsumed (tested). A malformed signature gets 400 and a recovery throw gets 400.
3. **Unique link.** 053 has `UNIQUE legacy_merchant`, and `b` adds `legacy_merchant IS NULL`. A 23505 is matched by constraint name (`wf_businesses_legacy_merchant_key`, the inline default). The whole statement aborts, so the loser's challenge stays unused (PGlite test plus harness 3b).
4. **Concurrency.**
   - Same challenge sent N times: the claims serialize on the business row lock. EPQ re-checks `legacy_merchant IS NULL`, which is false, so the loser gets `claimed 0`, re-reads the challenge (consumed) and replays 200. One audit row.
   - Two workspaces, one wallet: the second waits on the unique index entry, then gets 23505.
   - Claim against removal or demotion: the claim's `FOR SHARE` on the actor's membership conflicts with the remover's DELETE or the demoter's UPDATE. I traced both orders: either the claim links while the actor is still Owner, or `actor` is empty after EPQ and the claim gets 403 with nothing written (harness 3c/3d).
   - The lock order (membership → business) matches `businesses.ts`.
   - The planner evaluates the uncorrelated `EXISTS (actor)` and `EXISTS (b)` InitPlans before the dependent ModifyTable locks.
   - Nothing consumes without linking: `c` needs `b` in the same statement.
   - Nothing links without consuming: only a claim for the same business can consume that nonce, and it is serialized by `b`'s row lock, so `c` can't lose EPQ after `b` won.
5. **CON-11.** The obligations read is on the only path that can link. A throw returns 503 before any SQL, and nothing is consumed (tested). `readV1Obligations` → `merchantAdvance` throws on RPC failure; `readOffer` returns null only for an unknown offer kind (f3's L4 item).
6. **Authorization.**
   - All 18 handlers match the R2-1 table:
     - `keys:manage` ×3
     - `webhooks:manage` ×5, of which GET and POST also accept a key
     - `business:manage` (capital publish)
     - `invoices:draft` ×6
     - `refunds:propose`
     - `invoices:read` ×3
     - `payments:read` ×3
     - `account:read`
   - CSRF: `mutationContext` runs whenever the `wf_session` cookie is present on an unsafe method. Without a cookie the caller gets 401 and is never acted on. The cookie is SameSite=Lax, a second layer.
   - Order: 403 CSRF → 401 → 403 role → 409 unlinked.
   - Membership is re-read on every request: a removed member gets 401, a demoted one 403, and a revoked or expired session 401 (tested).
7. **Old cookie.** No route or page reads `mc_session`: `signedInMerchant` and `merchantByCookieOrSecretKey` are deleted, and `currentMerchant()` resolves `wf_session`. `/api/auth/verify` still mints `mc_session`, but nothing accepts it. There are no server actions anywhere in `app/` or `components/`.
8. **Key path.**
   - Only webhooks GET and POST take a key.
   - The key must be `sk_`, and the scope must be in `SECRET_KEY_SCOPES`.
   - `business_id` must be set, and the business's link must equal the key's merchant.
   - `pk_` or an invalid key gets 401; an unlinked key gets 409.
   - A Bearer header on any other route takes the session path and gets 401 (tested).
   - `createKey` takes the workspace from the unique `legacy_merchant`.
9. **Tenant isolation.** The services still filter by the linked merchant, so a foreign or guessed id gets 404 (tested for links).
10. **Dashboard.** `currentWorkspace()` re-reads membership and fails closed. Developers and Connections show keys and webhooks only with `keys:manage`. The other pages show only data every role may read under R2-1; the home page shows Viewers a key *count*, which is negligible.
11. **NFR-17.**
    - Logs print `err.name` only: the obligations failure, `dashboardWorkspace`, `auditV1` and `handle`.
    - Audit detail is `{v1Obligations, keysLinked}`, notification detail is `{merchant}`, and the claim answer is `{merchant, v1Obligations}` (tested).
    - The token in `dashboardWorkspace` is never logged. Undici's header errors echo the value, but only the error name is logged.
12. **Audit.** All 14 mutation handlers call `auditV1` after success, with the right actor, role, source, credential, request id and target. A failed audit write is logged, never thrown, so it can't trigger a client retry that acts twice. Double-acting on a network retry is the legacy services' existing non-idempotency (FR-AUTH-4 is deferred, as disclosed).
13. **Migration 054.** It is additive (IF NOT EXISTS), splits into 2 statements with no DO blocks or functions, has FKs and CHECKs, is safe to re-run, and its rollback (`DROP TABLE IF EXISTS`) is correct.
