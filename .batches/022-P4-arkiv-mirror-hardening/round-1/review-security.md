VERDICT: PASS

# Security review: 022-P4-arkiv-mirror-hardening, round 1 (phase mode, Money: yes, one pass)

Reviewer: security. Scope: `git diff c590d58~1..d54eabb` on branch `backend` (c590d58 tests, d54eabb fix): apps/web/lib/server/vouchers.ts, apps/web/lib/server/webhooks.ts, apps/web/test/gw-{vouchers,webhooks}.test.mjs and the batch folder.
From apps/web I ran `node --experimental-test-module-mocks --test test/gw-vouchers.test.mjs test/gw-webhooks.test.mjs`: 67 tests, 67 pass, 0 fail.
I also built the new query offline with the real SDK (not the mock), with no network call. It renders as `arkiv.schema = str('mcplus.voucher.v1') AND code_hash = str('…') AND $owner = addr(0x…)`.

There are no HIGH or CRITICAL findings, so nothing blocks (PIPELINE §3a.1). I found one MEDIUM and four LOW. All of them are under FOLLOW-UP. M1 is a one-word fix, and I recommend making it before the PR.

## Answers to the lane's questions

1. **Can someone else's Arkiv entity be adopted?** Yes, through an ownership transfer (M1). `$owner` is transferable and `$creator` is not.
   - The SDK says so at builderBase.ts:121: "The creator never changes; the owner does".
   - `changeOwnership` is one tx sent by the current owner alone (actions/wallet/changeOwnership.ts:29-36, entity/operations.ts:113-124). The new owner doesn't have to accept.
   - Forging a code_hash for a voucher that was never published is not possible, because the HMAC needs `VOUCHER_HASH_SECRET`.
   - Adopting another merchant's entity is not possible either, because the hash binds `merchant:code` (vouchers.ts:99).
2. **Can the CASE guard or the `arkiv_entity_key IS NULL` guard leave a voucher stuck, or let one attempt overwrite another?**
   - **Stuck: no.**
     - Exactly one attempt sets each lease value, and each value is unique: a new lease needs the old one to be ≤ now − 5 min, so two values can't be equal.
     - The column is BIGINT (db/049_arkiv_status.sql:5), so `= $n` with a JS number compares correctly. The tests run real SQL and check that the lease is released (gw-vouchers.test.mjs:712, 744, 772).
     - The error UPDATE skips its row only when an entity key is already recorded. In that case publish returns at vouchers.ts:206 before the lease matters, and nothing else reads `arkiv_attempted_at` (grep of apps/web).
     - A crashed attempt, or a failed `recordMirror` UPDATE, holds the lease for at most 5 min. The next publish then adopts the entity that landed, so the M1 fix helps here too.
   - **Overwrites:**
     - A failure can't overwrite a success, which is good.
     - A success can overwrite an earlier success (L3).
     - An older failure can overwrite a newer failure's reason. That is cosmetic.
3. **Anything secret logged or stored? No.**
   - A query error is passed through `redactArkivError` before it is cut to 200 chars (vouchers.ts:178). viem's message carries `URL: …/<access key>` plus `Request body:`, which holds the query text: a public HMAC and the public writer address. The test at gw-vouchers.test.mjs:726 checks that the key is removed.
   - The reason stored after a client-build failure names variables only, and it is redacted anyway (vouchers.ts:164).
   - The webhook log line contains the delivery id and `err.name` only (webhooks.ts:174).
4. **Is the race named in the `ponytail:` note acceptable? Yes, for now** (L2).
   - The worst case is a second entity with identical content, written by our own writer, with the DB pointing at one of them.
   - No USDT is involved, nothing gets stuck, and nothing secret is exposed.
   - The fix is cheap (L2).

## FOLLOW-UP

### M1 (MEDIUM): `ownedBy` lets an attacker plant the entity we adopt; use `createdBy`
- **Where:** vouchers.ts:169 (the comment's claim "only our writer's entities count") and vouchers.ts:171-173.
- **Sketch:**
  1. Voucher V's write times out but lands, which is the batch 021 M1 case this fix exists for. V's code_hash is now public, and the DB has no key for V.
  2. An attacker watches Rabdi for new `mcplus.voucher.v1` entities created by our writer. For each one they create E′ with the same tag and code_hash, any `value`/`kind`/`expires_at`/`merchant`, and any expiration. Then they `changeOwnership(E′, ourWriter)`. This costs two testnet txs per voucher. They don't need to know which DB rows lack a key, so they can do this for every voucher.
  3. The merchant clicks Publish. `code_hash = h AND $owner = us`, `limit(1)`, matches both our entity and E′. The node chooses which one comes back. If it returns E′, we store E′'s key.
- **Impact:** the dashboard shows "on_arkiv" with a link to data the attacker wrote, for example a 100 % discount, or an entity set to expire in minutes.
  - The voucher can't be repaired from the UI, because `publishVoucher` returns early once a key is stored (vouchers.ts:206). A dead key stays forever.
  - No USDT moves: `applyVoucher` and `confirmRedemption` read only the DB, and nothing reads `mcplus.voucher.v1` back.
  - This is the first server-side read that trusts `$owner`.
- **Fix:**
  - Change the query to `.createdBy(clients.address)`. Checked offline with the real builder: it renders `$creator = addr(0x…)`, and `$creator` is a system attribute (query/expression.ts:142).
  - Fix the comment at :169.
  - Add `createdBy` to the test mock (gw-vouchers.test.mjs:18). Without it, the change throws "chain.createdBy is not a function".
- **Owner:** claude-contracts.

### L1 (LOW): an adopted entity's content isn't compared with the voucher
- **Where:** vouchers.ts:171-173. The hash binds only merchant + code (vouchers.ts:99).
- **Sketch:** this needs no attacker, even with `createdBy`.
  - Local dev, a preview deploy, or a Neon reset can reuse the same `ARKIV_PRIVATE_KEY` and `VOUCHER_HASH_SECRET`.
  - Example: SAVE10 at 10 %, expiring Dec 1, is created from dev. Later the same wallet creates SAVE10 at 20 %, expiring Nov 10, on prod or after the reset. Create's mirror adopts the dev entity.
  - Arkiv then shows 10 % / Dec 1 for a 20 % / Nov 10 voucher. The entity can also expire before the voucher does, or outlive it.
- **Fix:**
  - Add `eq("kind", v.kind)` and `eq("expires_at", u64(…))` to the `where`. Both are indexed.
  - Select `value` and `merchant` and compare them in JS. If no entity matches, write a new one.
  - Vouchers are immutable apart from `active`/`times_redeemed`, so an entity that timed out and then landed still matches. This also backs up M1.
- **Owner:** claude-contracts.

### L2 (LOW): the 5-min lease doesn't bound an attempt, and a timeout frees the lease at once (the `ponytail:` race)
- **Where:** vouchers.ts:141-142, :170, :193; lib/arkiv.ts:8,22.
- **Sketch:**
  - **(a)** `createEntity` times out (the SDK's 180 s receipt wait, or a send `TimeoutError` after the node took the tx). The error path then releases this attempt's own lease immediately (:193). The merchant clicks again, and the query runs before the pending tx is mined, so a second entity is written.
  - **(b)** viem retries `TimeoutError` 3 times, because buildRequest.ts:296-335 returns true for an error with no code and no status. Each try waits 30 s, so one RPC can take about 2 min. An attempt makes a query, gas estimate, nonce and fee reads, a send and a 180 s receipt wait, so it can run well past 5 min when Rabdi is slow, which is exactly when people retry.
  - With the CASE guard, an overlap can no longer free another attempt's lease, which is good. The only result left is the duplicate.
  - On Vercel the function's `maxDuration` caps the attempt. No route sets one, so the project default applies. If that default is 300 s, it ties with the lease.
- **Fix (cheap):**
  - When `createEntity` itself threw, it may have sent the tx: store the reason but keep the lease. Release it at once only when the query or the client build failed.
  - Skip the write when less than about 200 s of lease is left (`Date.now() - lease > PUBLISH_LEASE_MS - 200_000`), or set `retryCount: 0` on the writer's transport.
  - The 409 text "try again in a minute" (:217) can now mean a wait of up to 5 min.
- **Owner:** claude-contracts.

### L3 (LOW): the success UPDATE isn't first-writer-wins
- **Where:** vouchers.ts:196 (`WHERE id = $1` only).
- **Sketch:** a later attempt's outcome replaces a key that is already stored.
  - Example: attempt B adopts A's entity and writes `arkiv_tx_hash = NULL` over A's real tx hash.
  - Example: B's duplicate replaces A's key.
  - With M1 and L1 fixed, both keys are ours and their contents are identical, so this is cosmetic. Without M1 fixed, a planted entity can replace a correct key.
  - Related: when the error UPDATE matches nothing because another attempt already succeeded, the caller is still answered `not_on_arkiv`. The DB is right, and a reload shows it.
- **Fix:** add `AND arkiv_entity_key IS NULL ... RETURNING ${COLUMNS}`, and return the stored row. This was suggested in the 021 review. The lease left behind on a skipped row is harmless, per answer 2.
- **Owner:** claude-contracts.

### L4 (LOW, test quality): the reader mock ignores its arguments
- **Where:** gw-vouchers.test.mjs:17-25.
- **Sketch:** the mock's `where`/`ownedBy`/`limit` accept anything. A mutant that drops `.where(eq("code_hash", hash))`, hashes the wrong input, or drops the owner/creator filter passes all 67 tests. M1 and L1 are therefore not pinned by any test.
- **Fix:**
  - Record each builder call.
  - Assert that `where` received `eq("code_hash", codeHash(MERCHANT, code, HASH_SECRET))` and that `createdBy` received the writer address.
  - Add one case where `existing` is returned only for a different creator, and check that it is not adopted.
- **Owner:** claude-contracts.

### Info (no action needed)
- L1 of 021 is fixed. A client-build failure stores the reason and frees the lease. The test at :772 shows the next publish isn't told to wait.
- L2 of 021 is fixed. The log line is the delivery id plus `err.name`. The test at gw-webhooks.test.mjs:340 asserts that neither the URL nor the message appears.
- Pre-existing:
  - Leases use each instance's `Date.now()`. An instance with a fast clock sets a lease that other instances treat as fresh for 5 min plus the skew. It is bounded and can't get stuck.
  - The `rateLimit` at publish/route.ts:10 is per instance.

## Secret scan
I ran `git diff --name-only c590d58~1..d54eabb | xargs grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --exclude='.env*'`. Every hit is an env var name or a test placeholder. None is key material, and no 64-hex literal appears (`ENTITY_KEY` is built with `"ab".repeat(32)`).
- apps/web/lib/server/vouchers.ts:147, 149, 157: the `VOUCHER_HASH_SECRET` and `ARKIV_PRIVATE_KEY` names.
- apps/web/test/gw-vouchers.test.mjs:10, 73, 75, 96, 158, 159, 606, 614, 617, 618, 620, 621, 774, 782, 785: `"voucher-hash-secret-for-tests"`, `"not-a-key-arkivClients-is-mocked"`, env names, and the fixed reason string.
- apps/web/test/gw-webhooks.test.mjs:52, 211-213, 216, 217, 226: `CRON_SECRET = "cron-secret-for-tests-0123456789"` and its uses.
- The batch folder's batch.md and spec.md have no hits.
