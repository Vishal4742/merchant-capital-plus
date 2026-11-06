VERDICT: PASS

# Security review: 021-P4-refund-sync-webhook-ids, round 1 (phase mode, Money: yes, one pass)

Reviewer: security (claude-contracts lane review). Scope: `git diff 645a75d..HEAD -- apps/web`, three commits (2dd0084, 2738e9e, b664fe6) on branch `backend`.
I ran `node --experimental-test-module-mocks --test test/gw-refunds.test.mjs test/gw-events.test.mjs test/gw-webhooks.test.mjs test/gw-vouchers.test.mjs` from apps/web: 89 tests, 89 pass, 0 fail.
No HIGH or CRITICAL findings, so nothing blocks. One MEDIUM and four LOW, all non-blocking.

## 1. Refund sync (lib/server/refunds.ts, app/api/v1/payments/[id]/refunds/sync/route.ts): no blocking issue

I checked each way to forge a `payment.refunded` and found none that works:
- **Forged or unrelated tx hash.** The hash only says which receipt to read. The receipt comes from our RPC (refunds.ts:33-42). A log counts only if it was emitted by `payConfig().merchantPay` (case-insensitive), its topic0 is the `Refunded` selector, and its decoded `paymentId` equals this payment's id (refunds.ts:47-50, `strict: true`). If no log passes, the route returns 400. The test at gw-refunds:122 checks that a `Paid` log from MerchantPay carrying the same id is not read as a refund.
- **Log from another contract.** Dropped by the address check. The client uses the same chain and RPC as lib/onchain.ts (whitechainSepolia, Ankr 1874), and an attacker cannot deploy a contract at the configured address there.
- **Reverted tx.** `status !== "success"` returns 400 (refunds.ts:67). A refund inside a reverted subcall (for example a smart-wallet try/catch) leaves no log in a successful receipt, so that returns 400 too.
- **Another merchant's payment.** `listPayments(merchant)` uses the merchant from the SIWE cookie, so another merchant's payment returns 404 before the chain is read (refunds.ts:61-62). Because the 404 check comes first, a freshly signed-in wallet with no payments cannot use the route to make RPC calls.
- **Refund of an invoice payment.** Invoice and sale payments share MerchantPay's `paymentCount` (MerchantPay.sol:253-255), so ids are unique. An invoice refund's log carries the invoice payment's id, which matches no checkout session, so the route returns 400. Syncing with the invoice payment's own id returns 404, because no session holds it. `session.payment.paymentId` comes from the chain (`saleSettled`, pay/route.ts:150 and settle.ts:44), not from the client.
- **Refund that didn't happen.** On chain, `refund()` requires `payment.merchant == msg.sender` and emits only when the USDT transfer succeeds in the same tx (MerchantPay.sol:193-201). Every log that passes the filter is a real refund by this payment's merchant.
- **Firing twice.** Deduplication uses `refund:<session>:<totalRefunded>`. `totalRefunded` only grows for a payment on chain, and `amount == 0` reverts, so each refund has its own key. A re-sync, or a concurrent sync of the same tx, hits `ON CONFLICT DO NOTHING`. If one refund in a multi-refund tx fails to enqueue, its key is deleted and a re-sync delivers it with the same id.
- **Leaks.** Logs show only `error.name` (refunds.ts:64), and a 5xx returns a fixed message. The reply contains only the merchant's own amounts and their tx hash. The webhook data holds no PII (session id, reference, payment id, tx hash, link/page id). The cookie is `SameSite=Lax` (lib/auth.ts:116), so cross-site POSTs carry no session. A CSRF could only sync a refund that really happened anyway.
- **Input checks.** The id must match `^[1-9]\d{0,77}$` and the tx hash must pass `isHash`. Rate limit: 30 per minute per merchant, applied before any work.

## 2. Event ids, sendOnce, deliver(eventId), and the inline-attempt `.catch`: no blocking issue

- **Can the id be guessed?** `eventIdFor` is an unkeyed hash of `paid:<uuid>` / `refund:<uuid>:<total>`, so a payer who knows the session id can compute it. That does not matter. Receivers check the HMAC, so a forged body with that id is rejected. The server is the only one choosing keys, so nobody can plant a signed event first and make a receiver dedupe-drop the real one. No route looks anything up by event id (grep finds nothing). The id is 144 bits, so collisions are not a concern. Test events still get random ids.
- **What `.catch(() => null)` does** (webhooks.ts:171): the delivery row is already inserted with `status 'pending'` and `next_attempt_at = now + LEASE_MS` (webhooks.ts:164-165). If the SELECT fails, nothing is sent and dispatch retries after 60 s. If the status UPDATE fails after a 2xx, the row stays pending with `attempts` unchanged, and dispatch re-sends it after 60 s with the **same event id** (at-least-once delivery, deduped by the receiver). `send()` never throws. Nothing is lost.
- **F4** (events.ts:38-46): `buildData()` now runs inside the `try`, so a failing `checkoutOf` releases the key, and a retry re-sends with the same id.

## 3. deliveredEvents SQL (webhooks.ts:103-111): no issue

Scoped by merchant (`merchant = $1`, lowercased, and `app_gw_deliveries.merchant` is copied from the lowercased webhook row) and parameterised. The interpolated fragments are constants. `data.test` cannot be injected from a real payment: the body is a `JSON.stringify` of server-built fields, and `reference` is a string value, not a key. The function has no route yet, so whoever adds one must use `signedInMerchant`.

## 4. Voucher publish lease (vouchers.ts:140, 174-219): one MEDIUM

Two concurrent publishes now resolve correctly. The conditional `UPDATE … WHERE arkiv_entity_key IS NULL AND (arkiv_attempted_at IS NULL OR arkiv_attempted_at <= now-3m) RETURNING id` is atomic per row, and create takes the lease when the row is inserted. A lease cannot stay stuck: it is time-based and expires within 3 minutes in every case. Deactivated vouchers are refused (vouchers.ts:195). The remaining gap is below.

---

## Findings

### M1 (MEDIUM, non-blocking): an Arkiv write that times out or runs long can still produce two entities for one voucher
- **Where:** vouchers.ts:140 (`PUBLISH_LEASE_MS = 3 min`), vouchers.ts:168-169 (a timeout becomes `{error}`), vouchers.ts:180 (the error path sets `arkiv_attempted_at = NULL`), vouchers.ts:183 (the success UPDATE is not tied to the lease). Related: lib/arkiv.ts:8,22 (a 30 s HTTP timeout with viem's default 3 retries), `@arkiv-network/sdk/dist/index.js:637` (`waitForTransactionReceipt({ hash })` with no timeout argument), and viem 2.57.13 `waitForTransactionReceipt.js:58` (`timeout = 180_000` by default).
- **Exploit or failure sketch:** (a) Rabdi accepts the tx but the receipt takes more than 180 s. viem throws `WaitForTransactionReceiptTimeoutError`, `mirrorToArkiv` returns "Arkiv refused or timed out", and `recordMirror` releases the lease. The merchant clicks Publish again, a second `createEntity` is sent, and both txs land: two `mcplus.voucher.v1` entities, with only the second key stored. (b) Gas estimate plus send plus the 180 s receipt wait can take longer than the 3-min lease, so a second publish takes the expired lease while the first tx is still pending. When the first attempt finishes, its `recordMirror` NULLs the second attempt's lease, which lets a third attempt in. No USDT is at risk. The DB stays the authority for redemptions. The effect is duplicate public records and wasted Arkiv gas, which is the 018 M1 problem in a narrower form.
- **Fix:** (1) On a timeout error, keep the lease and store the tx hash; release it only on a definite refusal (estimate or simulate revert). The next publish then checks that tx's receipt instead of writing again. (2) Guard both recordMirror UPDATEs with `AND arkiv_attempted_at = $leaseTs` (the success one also with `AND arkiv_entity_key IS NULL`), so a stale attempt cannot release or overwrite someone else's lease. (3) Make the lease longer than the worst-case attempt (for example 5-10 min), or bound the write with a deadline shorter than the lease. The real idempotency check: before `createEntity`, query Arkiv for `merchant` + `code_hash` (both indexed) and adopt an existing entity. If this is deferred, a `ponytail:` note naming the gap is enough.
- **Owner:** claude-contracts (lane, vouchers.ts).

### L1 (LOW): a config failure after the lease is taken keeps the lease
- **Where:** vouchers.ts:178 (`mirror.config` returns before any UPDATE) and vouchers.ts:214.
- **Sketch:** `arkivConfigProblem()` is null but `arkivClients()` throws (for example a malformed `ARKIV_PRIVATE_KEY`). The lease stays held for 3 min, and during that time publish answers "Publishing to Arkiv already" instead of the real reason. The lease is bounded and has no security impact.
- **Fix:** also release the lease on this path, or call `arkivClients()` before taking the lease. **Owner:** claude-contracts.

### L2 (LOW): the inline-attempt error is swallowed with no log
- **Where:** webhooks.ts:171 `attemptDelivery(id, now).catch(() => null)`.
- **Sketch:** behaviour is correct (see §2), but a DB failure there leaves no trace, and `sendTestEvent` (webhooks.ts:185) can now return `null` to the Developers screen without any explanation.
- **Fix:** `.catch((e) => { console.error("webhook inline attempt failed:", e instanceof Error ? e.name : typeof e); return null; })`. Log the name only, matching http.ts:36. **Owner:** claude-contracts.

### L3 (LOW, pre-existing, window slightly wider): events can still be lost or doubled at the sender
- **Where:** events.ts:39-46 and webhooks.ts:161-168.
- **Sketch:** (a) Lost: the `app_gw_events` key is committed before any delivery row exists. If the function is killed (Vercel maxDuration, a crash) between the key INSERT and the delivery INSERTs, or the `DELETE` in the catch itself fails, the key stays, there are no rows, and nothing ever retries. The `payment.succeeded`/`payment.refunded` event is never sent. F4 puts `checkoutOf` inside this window. (b) Doubled at the sender: if the INSERT for endpoint 2 fails, endpoint 1's row stays pending (dispatch sends it after 60 s), the key is released, and the caller's retry inserts another row for endpoint 1. Endpoint 1 gets the event twice, and only the shared event id saves the receiver.
- **Fix:** do the key INSERT and every delivery INSERT in one `transaction([...])` (db.ts already has it), with the inline attempts after the commit. That makes the sender exactly-once, and the derived id stays as defence in depth. **Owner:** claude-contracts.

### L4 (LOW, latent): a session's payment isn't tied to a MerchantPay address
- **Where:** refunds.ts:60-61 and sessions.ts:37-45.
- **Sketch:** today, changing `MERCHANT_PAY_ADDRESS` needs a redeploy, which wipes the in-memory sessions, so this can't happen. Once sessions move to Neon (the `ponytail:` note in sessions.ts), the old contract's payment id N and the new contract's payment id N are different payments, and a refund of the new N could be synced as a refund of the old session.
- **Fix:** when sessions move to Neon, store `merchantPay` in `Payment` and require it to equal `merchantPayAddress()` in `syncRefund`. **Owner:** whoever moves sessions to Neon (claude-frontend owns sessions.ts), with claude-contracts for refunds.ts.

### Info (no action needed this batch)
- vouchers.ts:201: the lease UPDATE doesn't re-check `active` or `expires_at`. A deactivate racing a publish by the same merchant can still publish. Tiny window, self-inflicted.
- refunds.ts reads the receipt at the latest block with no confirmation depth and trusts Ankr's public RPC. This is the same trust model as the payment path (onchain.ts and settle.ts).
- webhooks.ts:106: `body::jsonb` scans all of a merchant's succeeded deliveries (there is no `merchant` index on `app_gw_deliveries`). Fine at hackathon scale. Add an index if the checklist route ends up polled.

## Secret scan
`git diff --name-only 645a75d..HEAD | xargs grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'`. Every hit is an env var name or a test placeholder. None is key material, and no 64-hex literal appears:
- apps/web/lib/server/vouchers.ts:145, 147, 155 (`VOUCHER_HASH_SECRET` / `ARKIV_PRIVATE_KEY` names in `arkivConfigProblem` / `process.env` reads)
- apps/web/test/gw-vouchers.test.mjs:10, 56, 58, 79, 141, 142, 589, 597, 600, 601, 603, 604 (`"voucher-hash-secret-for-tests"`, `"not-a-key-arkivClients-is-mocked"`, env names)
- apps/web/test/gw-webhooks.test.mjs:52, 211-217, 226 (`CRON_SECRET = "cron-secret-for-tests-0123456789"` and its uses)

refunds.ts hardcodes the public Ankr testnet URL with no key, and logs only `error.name`. I opened no `.env*` file, used no key, and searched no other worktree.
