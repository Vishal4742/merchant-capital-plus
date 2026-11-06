VERDICT: PASS

# reviewer-security: 026-P4-web-sessions-neon, round 1 (phase mode, Money: yes, one pass)

Scope: `git diff -- apps/web` (34 files), plus the untracked `db/050_web_sessions.sql` and `test/sessions-db.test.mjs`. I also read the current `lib/{sessions,settle,auth,announce-paid,onchain}.ts`, `lib/server/{db,http,vouchers}.ts`, every changed route and page, `MerchantPay.paySale`, and the money contract: the batch-009 security review F1-F3, and the 015, 021 and 022 reviews.

No HIGH or CRITICAL finding is reachable by an attacker. Every one of the four moves (the lock, pending and payment, idempotency, nonces) is a single SQL statement, and on real Postgres each produces exactly one winner under 40 parallel connections. Everything fails closed when the database is missing. Finding 1 (MEDIUM) is the one to fix next. It only fires during an RPC hang, but on Vercel the lock-held path can run past the 300 s function cap, and a relay can then land with no pending row.

## Commands run
The scratch copy was made with `.env*` excluded. I did not touch :3100, ran no migrations on Neon, sent no requests to the live site, and read or printed no `.env*` file.
- `rsync -a --exclude='.env*' --exclude=.next --exclude=node_modules apps/web/ <scratch>/sec026/web/`. The copy has 0 `.env*` files.
- `npm test`: `tests 560 · pass 558 · fail 0 · skipped 2`.
- `next typegen && tsc --noEmit`: exit 0. `npx eslint` on the 22 changed `.ts`/`.tsx` files: exit 0.
- **Real Postgres 18.6** (local throwaway cluster, not Neon). I applied `050_web_sessions.sql` twice: the second run printed 8 `already exists, skipping` notices, so it is idempotent. Then I ran each statement from 40 parallel `psql` connections, each statement autocommitted, the same way Neon's HTTP driver sends it:
  - `claimPayment` on a free lock: **1 winner**. On a lapsed lock: **1 winner**. On a live lock: **0**.
  - `recordPayment`, with 40 different payments at once: **1 writer won**, and `pending` was cleared.
  - `consumeNonce`, with one nonce: **1 winner**. The idempotency slot INSERT: **1 taker**.
  - The jsonb compare that `clearPending` uses: key order doesn't matter (`t`); `"123"` vs `123` is `f`; `"0123"` vs `"123"` is `f`; `0xAb` vs `0xab` is `f`.
- **Vercel project config** (one read-only `vercel api /v9/projects/<id>` call, filtered to these fields with jq, and the dump deleted afterwards): `fluid: true`, `functionDefaultTimeout: 300`, no override. No route exports `maxDuration`, and `vercel.json` sets none.
- **PoCs** (PGlite, in scratch only): `zz-sec026-poc.test.mjs` and `zz-sec026-nodb.test.mjs`. Output is quoted below.

## What is verified OK (checks 1-10)

1. **The lock** (`lib/sessions.ts:156-176`).
   - **Atomic:** yes. `INSERT … ON CONFLICT (key) DO UPDATE … WHERE until < now() RETURNING` is one statement, so on Neon HTTP it runs as one implicit transaction. Postgres locks the conflicting row and evaluates the `WHERE` against its latest version, so two instances can't both get a row back (see the 40-way race above).
   - **Clock:** `now()` is the database's clock, so instance clock skew doesn't matter.
   - **Who releases:** only the attempt that won the lock. Every `claimPayment` loser returns before its `try` (`pay/route.ts:76,109`, `invoices/[id]/pay/route.ts:76`), and `reopen` releases only `if (lockedHere)` (`settle.ts:75`).
   - **The release isn't owner-checked.** It deletes by key alone (`sessions.ts:167-171`). The builder's comment at `:148` says so; finding 1 covers it.
   - **Lock length:** 300 s matches the platform cap (fluid, 300 s default, no override). The lock is taken after the request starts, so it outlives any invocation that Vercel actually stops at 300 s. The code's own lock-held path does not fit in 300 s, though (finding 1).
2. **`recordPayment`** (`:185-190`): first write wins in one `UPDATE … WHERE payment IS NULL`. **`clearPending`** (`:198-201`) compares by jsonb value in the same statement. Both sides are built by the same `pendingJson` from a database read, so they always match:
   - bigints are decimal strings on both sides, never numbers;
   - `amount` is left out on both sides when absent;
   - `from` is the stored string.

   `reopen` now checks `samePending` by value and refuses a paid session (`settle.ts:70`), where the old code compared object identity. `clearInvoicePending` uses the same compare-and-clear.
3. **Idempotency** (`sessions/route.ts:58-87`):
   - **Owner:** `first()` updates or deletes only `WHERE slot AND owner`, so a request frees or fills only its own row.
   - **A waiting duplicate** gets the stored 201, a 422 for a different body, or a 409 after 100 × 100 ms. The loop is bounded.
   - **An abandoned slot** frees once it is 60 s old (but see finding 4).
   - **No cross-merchant replay:** the slot is `<40-hex address>:<key>`. The address has a fixed length and no colon, so two merchants can't produce the same slot.
4. **Nonces** (`auth.ts:69-73`):
   - Single use: `ON CONFLICT DO NOTHING RETURNING` (40 racers, 1 winner), and the nonce is spent only after the signature verifies.
   - Database unreachable: `verify/route.ts:18-25` answers 503 and clears the cookie, so it fails closed. With no `DATABASE_URL`, `consumeNonce` rejects with `DbUnavailable`.
5. **Every caller awaits.** I grepped all 20 store and settle functions for calls without `await`. The only hits are four `return openCheckout(...)` lines (a returned promise) and `gatewayCheckout(id).catch(...)`, which is awaited at `pay/route.ts:59`. No Promise is used as a boolean. Inside `try` blocks the routes use `return await`, except for `refuse` (finding 2).
6. **No float for money.**
   - `amount` is BIGINT, read back as `::text`, then `BigInt`.
   - The `json()` replacer turns every bigint into a decimal string, in `items`, `priced`, `payment`, `pending` and the invoice attempt.
   - Only times (`paidAt`, `fetchedAt`) and `qty` are JSON numbers.
   - The sessions-db test round-trips `2n ** 255n + 7n`.
7. **SQL injection:** every value is a `$n` parameter. The only interpolations are the constants `${LOCK_S}` and `${COLUMNS}`.
8. **No `DATABASE_URL`:** PoC output `{"pay":503,"status":503,"create":503,"createIdem":503,"demo":503,"nonce":"DbUnavailable","relayed":0}`. The checkout, pay and receipt pages show their "can't open this right now" notices. The dashboards still show the chain's rows.
9. **LOW 3:** `DELETE /voucher` runs `assertChangeable` and then claude-contracts' `removeVoucher` (`voucher/route.ts:70-71`). `removeVoucher` refuses, inside its own statement, a paid checkout, a confirmed hold, and a hold frozen within `FREEZE_MS`. **LOW 4:** `GET /api/v1/sessions/:id` reports `payment.amount ?? session.amount` (`[id]/route.ts:45`), and the test at `sessions-db.test.mjs:174` covers it.
10. **Secrets:** see the grep at the end. Nothing new.

`announcePaid` runs its work in Next's `after()`, so `onSessionPaid` survives the response on Vercel. The contract's `OrderPaid` (`MerchantPay.sol:181`) still allows one sale per `(merchant, orderRef)`. No lock failure below can charge a customer twice. What is at risk is voucher accounting and the single-use-link sibling check.

## Findings

### 1. MEDIUM: the lock-held path can outlive LOCK_S and the 300 s cap, and after a relay that can leave no `pending`
- **Where:**
  - `lib/sessions.ts:148-171` (unowned release);
  - `pay/route.ts:109-161` (lock-held path), `:176-182` (pending is written only after the post-relay read);
  - `lib/onchain.ts:11-13,33,40-49` (each read is 10 s × 3 viem attempts; `saleSettled` makes 5 tries of 2 sequential calls);
  - `lib/settle.ts:54`.
- **Worst case under the lock** while Ankr hangs (it accepts connections but doesn't answer; viem retries `TimeoutError`):
  - one `saleSettled` ≈ 5 × 61 s + 4 s ≈ **309 s**;
  - `payCheckout` without a pending attempt: balance (≈62 s) + relay (35 s) + post-relay `saleSettled` (≈309 s) ≈ **406 s**;
  - with a pending attempt to settle first: ≈ **715 s**.

  The cap is 300 s.
- **(a) Vercel stops the invocation at 300 s.** If that happens during the post-relay read, the relay may have landed, but `markPending` never runs and `finally` never runs. The lock lapses, and the checkout reads as open with the hold still frozen.
  - **Exploit:** the payer applies HALF on S1 during the hang, and the paid relay lands. They then POST a junk signature. `claimAmountDue` returns the frozen 50, the verify fails, and `refuse` runs `releaseHold`, which succeeds because `paid_at` is still NULL. Now `DELETE /voucher` passes `assertChangeable` (not in flight, not pending), and `removeVoucher` deletes the hold, because `frozen_at` is NULL again. HALF is free for S2 while S1 was paid at 50. That is batch 007's H1. A DB error from `markPending` or `recordPayment` after the relay leaves the same state.
- **(b) Vercel's docs say only that a timed-out invocation gets a 504.** They don't say whether its promise chain keeps running inside a fluid instance that is serving other requests. If it keeps running, attempt B can take the lapsed lock while A is still alive, and A's `finally` then deletes B's lock.
  - PoC A output: `B still in flight, isInFlight = false | C claims = true`.
  - Two attempts in the critical section is F1 (b): one releases the other's in-flight freeze.
- **Why MEDIUM:** both paths need an RPC hang that an attacker can't cause, and the most a hit costs is one extra discount use. This becomes HIGH if the project's max duration is ever raised above 300 s (Pro allows 800 s in the dashboard) while LOCK_S stays at 300.
- **Fix (claude-frontend):**
  1. **Owner token.** `claimPayment` stores a `randomUUID()` in a new `owner` column and returns it. `releasePayment(key, owner)` deletes `WHERE key = $1 AND owner = $2`. Put the column in 050 if 050 isn't on Neon yet; otherwise add `ALTER TABLE app_web_locks ADD COLUMN IF NOT EXISTS owner TEXT` in 051.
  2. **Bound the path under the lock.** Pass `tries: 2` to `findPayment`/`saleSettled` inside the pay routes, which brings the worst case to about 160 s. Export `maxDuration = 300` from both pay routes, so a dashboard change can't lift the cap above LOCK_S (code settings take precedence over the dashboard, per Vercel's docs).
  3. **Write-ahead pending.** Call `markPending(id, attempt)` before `relaySale`. If that write fails, answer 503 and release the claim; nothing was sent. On a definite "nothing sent" (BUSY or a non-refused 4xx), `clearPending(attempt)` first, then release. A kill or a DB error after the relay then reads as "pending" (fail closed), not "open". The invoice route can do the same with `setInvoiceAttempt`.

### 2. LOW: `return refuse(...)` inside `try` lets `finally` free the lock before the hold release commits (not new in this batch; it matters across instances now)
- **Where:** `pay/route.ts:127,129,140,142,151,155`. `refuse` is async (`:116-119`), and `finally { await releasePayment(id) }` (`:161`) starts before refuse's `releaseHold` has finished. Both statements are then in flight to Neon, and either can commit first. The code before this batch had the same shape (`git show HEAD`: `:119-147`, sync release at `:153`).
- **PoC B** (`releaseHold` delayed 50 ms, a second attempt run in the gap): `status 400 | completion order: lock DELETE -> releaseHold | attempt B in the gap: { lock: true, price: 50000000n } | B's hold frozen after A's release: false | B's lock live: true`.
  - B's freeze and `claimed_at` are cleared while B relays. So for a single-use link, a sibling checkout can claim and pay during B's relay. For a voucher, the hold still confirms by `usdt_amount`.
  - The gap is roughly one Neon round trip against B's four or more, so it is very unlikely to be hit. It breaks F1 (2) ("only while holding the in-flight lock"), and the 021 review's note held only for the amount-409 path.
- **Fix:** `return await refuse(...)` at all six sites. Add a test that delays `releaseHold` and asserts it completes before the lock DELETE. **Owner:** claude-frontend.

### 3. LOW: `app_web_sessions` is never pruned, and public routes write to it
- **Where:** `db/050_web_sessions.sql:5-19`; `lib/sessions.ts:103-121`.
- **Problem:** before this batch, memory was bounded by each instance's lifetime. Now every demo, link and page checkout is a permanent row (about 0.4 KB). The limits on those routes (demo 10/min/IP, links/pages 20/min/IP) are still counted per instance (022 F2). Many IPs over days could fill a small Neon plan. After that, writes fail and checkouts are refused (fails closed), but a failed write after a relay lands in finding 1's state.
- **Fix:** in `createSession`, delete rows `WHERE payment IS NULL AND pending IS NULL AND expires_at < $1` (now minus 1 day), with an index on `expires_at`. Move the rate limits to the database when convenient. **Owner:** claude-frontend.

### 4. LOW: Idempotency-Key, an abandoned slot frees after 60 s, but a live request can run for 300 s
- **Where:** `sessions/route.ts:21,61`.
- **Problem:** a first request that stalls past 60 s has its slot deleted by a duplicate (Neon fetches have no timeout). The duplicate then creates a second checkout. The owner check stops the first request from overwriting it, and no money moves. The worst outcome is an extra unpaid checkout for the same key.
- **Fix:** set `ABANDONED_MS` to at least the 300 s function cap. **Owner:** claude-frontend.

### 5. INFO: `app/api/v1/payments/route.ts:62` logs `error.message`
- `listPayments`, a database call, now runs inside this `try`. NFR-8 and the rest of the batch log the error name only. Change it to `error.name`. **Owner:** claude-frontend.

### 6. INFO: 022's live probe is still open
- 022 asked this pass to re-run the five-checkout probe and one confirm payment on the live URL. Both need POSTs, and this review was limited to read-only requests. The spec's acceptance criterion 4 (the deploy, with the human's yes) owns them. Run them after `migrate.mjs` has applied 050 on Neon.

## Secret grep
`grep -nE --exclude='.env*' '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over the 39 files (34 changed in `apps/web`, the 2 untracked ones, and the batch's `spec.md`/`batch.md`) gives these hits:
- `lib/auth.ts:18,20`: the env var name `AUTH_SECRET`;
- the test fixtures `test/{auth,checkout-edges,docs-limits}.test.mjs` and `test/gw-helpers.mjs:7-8,53` (test secrets and `SECRET` constants);
- `test/checkout-api.test.mjs:255,261` and `test/invoice-pay.test.mjs:110`: EIP-3009 nonce test vectors (public hashes, not keys).

Over the **added** lines plus the two new files, the same pattern plus `sk_(test|live)_…`, `whsec_`, `postgres(ql)://` and `npg_` has **no hits**. No `.env*` file is in the diff, and none was read.
