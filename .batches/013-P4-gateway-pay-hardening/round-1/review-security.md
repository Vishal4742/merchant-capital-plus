VERDICT: PASS

# Security review: 013-P4-gateway-pay-hardening, round 1 (phase mode, Money: yes, one pass)

**Scope.** The batch commit `e77dcf4`: `lib/server/vouchers.ts`, `lib/server/events.ts`, `test/gw-{vouchers,events}.test.mjs` and the new `test/gw-vouchers-paid-race.test.mjs`. `7d4c586` after it adds only `round-1/ci.md`.

**What I read.** The whole of `vouchers.ts` and `events.ts` at HEAD, `db/005_checkouts.sql`, `lib/relay.ts:26-89`, `lib/settle.ts:15-25`, `contracts/src/MerchantPay.sol:161-185,241`, the batch-012 security review (N1-N6) and the batch-009 review's F1-F3.

**Commands run** (from `apps/web`, at `7d4c586`):
- `node --experimental-test-module-mocks --test test/gw-*.test.mjs` → `tests 124, pass 124, fail 0`.
- `npm test` → `tests 357, pass 354, fail 0, skipped 3`.
- `npx tsc --noEmit` → exit 0. `npx eslint` on the five changed files → exit 0.
- I didn't run `next typegen` or `next build`, because they load env files. `round-1/ci.md` records both green.
- **Mutation runs** on copies of `app/ lib/ db/ test/` (no `.env*` copied) in `/private/tmp/claude-501/-Users-vg890-ethglobal-contracts/c6b19a0f-dc4e-4bc4-b19c-2f27badbf70b/scratchpad/mut013/`. Each run covered gw-vouchers-paid-race, gw-vouchers and gw-events (38 tests):

| Copy | Change | Result |
|---|---|---|
| orig | none | 38/38 pass |
| m1 | INSERT … SELECT `NOT EXISTS` removed | 1 fails: "N2: a fresh insert on a paid checkout" |
| m2 | DO UPDATE `NOT EXISTS` removed | 38/38 pass (see P3) |
| m3 | both removed | both N2 tests fail |
| m4 | `releaseHold`'s `c.paid_at IS NULL` removed | the F1 test fails |
| m5 | m4, with the `releaseHold(s) === false` assert dropped | the F1 test still fails, on the post-HOLD_MS check |
| m6 | m5, with the batch-012 timing (`t + 1000`) put back | passes, so the old check never bit |

No route calls `onSessionPaid`, `onRefund`, `releaseHold` or `claimAmountDue` yet. A grep of every `.ts`, `.tsx`, `.mjs` and `.js` file outside tests finds only the definitions. No HIGH or CRITICAL finding.

## N1-N6 status

| # | Status | Evidence |
|---|---|---|
| N1 | **Closed** | `events.ts:45`: `paidAmount: bigint` has no default and is followed by an optional `now`. A call with only the session fails `tsc` with TS2554. An old-order call `(session, now)` passes a number where a bigint is expected, which is TS2345. The docstring (`:43-44`) ties the value to the claimed and relayed price. Every test call passes the amount. |
| N2 | **Closed** (see P3, P4) | `vouchers.ts:216` adds the guard to the INSERT … SELECT WHERE and `:220` adds it to the DO UPDATE WHERE. Both read `c.session_id = $1`, and `$1` is `sessionId` (params at `:225`, first element). Alias `c` doesn't clash with the unaliased `app_gw_redemptions` or `EXCLUDED`. `session_id` is the PK of `app_gw_checkouts` (`005_checkouts.sql:4`), so each check is one index probe. Under READ COMMITTED the INSERT takes its snapshot after the advisory-lock statement, so any upsert that starts after `paid_at` commits is refused. The test at `gw-vouchers-paid-race.test.mjs:21-33` stubs `checkoutOf` to return a stale unpaid view while the row in Postgres is paid, and shows the code is not switched. `:35-42` covers the fresh-insert path. m1 and m3 show the tests catch a missing guard. |
| N3 | **Closed** (see P1, P2) | `vouchers.ts:265-274` matches batch-009 F1 (2)-(3): only the attempt that made the claim may release, under its lock. Allowed: (i) a stop before relaying; (ii) BUSY or a 4xx, and a 422 only after `findPayment` returned exactly null, with the reason given; (iii) settle's "open" branch. Never on unknown (timeout, 5xx, dropped connection), a 409, STILL_PENDING or paid. It is written as an allow-list ("ONLY … and only when"), so anything not listed is excluded. |
| N4 | **Closed** | `events.ts:52,54`: `onRefund(session, amount, totalRefunded, paidAmount, now?)` sends `eventData(session, paidAmount)`, so `data.amount` is the price paid. The test at `gw-events.test.mjs:94-97` checks `amount` and `refunded` are both "12.50". The old 4th argument `now` (a number) is now a bigint slot, so `tsc` flags stale callers. |
| N5 | **Closed** | `gw-vouchers.test.mjs:376-380` applies at `t + HOLD_MS + 60_001`. The hold's `created_at` is `t`, which is not greater than `now - HOLD_MS = t + 60_001`, so only `frozen_at IS NOT NULL` can make it count. HALF's expiry is 30 days out, so "expired" can't make the assert pass by accident. m5 and m6 show the new check bites and the old one didn't. |
| N6 | **Closed** | `round-1/ci.md` records typecheck 0 errors, lint 0 problems and a successful build. My reruns of tsc and the test suites agree. |

## No regression in H1 / S1
- **H1** (the usage limit counts live holds): the count subquery at `vouchers.ts:212-215` and the advisory lock at `:208` are unchanged. The new predicate only removes rows, and only for a paid checkout, so it can't let a hold through that wasn't let through before.
- **S1** (no switching while a payment is in flight): the frozen pre-read at `:187-188` and `frozen_at IS NULL` in the DO UPDATE WHERE at `:219` are unchanged. The S1 PoC test, the race test at `:396-408` and the idempotent-claim tests all pass.
- `confirmRedemption`, `claimAmountDue`, `amountDue` and `releaseHold`'s SQL are unchanged. No schema change.
- No client import: no `"use client"` file under `app/`, `lib/` or `components/` imports `server/{vouchers,events,checkouts}`. Nothing new goes on chain or to Arkiv, there's no PII and no relayer change.

## FINDINGS (none blocks; only HIGH/CRITICAL block in phase mode)

| # | Sev | Where | Issue / exploit sketch | Fix | Owner |
|---|---|---|---|---|---|
| P1 | LOW (docstring; latent until the pay route exists) | `vouchers.ts:268-270` vs `lib/relay.ts:80,82,89` | **The docstring talks in relayer HTTP codes, but the pay route sees `relaySale`'s mapped result.**<br>- A relayer 422, including an `OrderPaid` revert, comes back as `{ status: 400, refused: true }` (`relay.ts:80,82`). A plain 4xx also comes back as `status: 400`, without `refused` (`:89`).<br>- A builder who reads "the relayer answers BUSY / 4xx" and checks `status === 400` would release on a 422 before `findPayment`. That is batch-009 F1 (a): pay S1 on chain at the HALF price, POST a second signature, the claim freezes HALF, the simulation reverts with OrderPaid, the route releases, a concurrent apply of ONE switches the hold, `confirm(50)` returns null, and HALF is free again.<br>- The `RelayResult` comment (`relay.ts:28-29`) does say "refused … the caller checks the chain first", which lowers the odds. | Name the result shape in the docstring:<br>- `refused: true` → release only after `findPayment(…)` returned exactly `null`;<br>- `!ok && !unknown && !refused` (a 400 or 503 BUSY) → release;<br>- `unknown` → never. | claude-contracts (docstring), claude-frontend (route) |
| P2 | INFO | `vouchers.ts:272` | The NEVER line drops N3's "an unconfirmed 200" (batch-009 F1 (3), a 200 the chain hasn't confirmed). The allow-list already excludes it, and `relay.ts:88` maps a 200 without a valid txHash to `unknown`. A 200 with a txHash that `saleSettled` hasn't confirmed is the case to name. | Add "a 200 the chain hasn't confirmed" to the NEVER line. | claude-contracts |
| P3 | INFO | `vouchers.ts:220` | **The DO UPDATE guard never runs on its own.**<br>- If the INSERT … SELECT's `NOT EXISTS` is false, no row is proposed, so ON CONFLICT never fires.<br>- If a row is proposed, the DO UPDATE WHERE's subquery reads `app_gw_checkouts` with the same statement snapshot. ON CONFLICT locks the latest conflicting row but doesn't take a new snapshot for subqueries, and the statement doesn't write `app_gw_checkouts`. So the subquery gives the same answer as the INSERT's.<br>m2 confirms this: no test fails without it. It is harmless (one PK probe) and the spec asked for it. | Keep it as cheap insurance. No test can isolate it, so none is needed. | — |
| P4 | INFO | `vouchers.ts:216,220`; `events.ts:46-47` | **Residual window, the same class batch 012 accepted.** An upsert whose snapshot was taken before `markCheckoutPaid` committed sees `paid_at` NULL. If a release that also started before that commit has already unfrozen the row, the upsert can still switch it.<br>That needs a release while the payment is in flight, which F1 forbids the route to do. The in-SQL guard now refuses every re-apply that starts after the payment is recorded, which is what N2 asked for. | Nothing more on the contracts side. A full fix would mean `SELECT … FOR UPDATE` on the checkout row in both `markCheckoutPaid` and the apply transaction. Not worth it while F1 holds. | claude-frontend (F1) |
| P5 | INFO (UX) | `vouchers.ts:228` | When the in-SQL guard refuses a paid checkout, the payer reads "That code has been used up.", and the comment "(a paid checkout returned above)" is no longer the whole story. No security impact. | Optional: return the paid reason when `reserved` is empty and a fresh `checkoutOf` shows `paidAt`, or just fix the comment. | claude-contracts |
| P6 | INFO | `events.ts:51`, `:16` | **Where `onRefund`'s `paidAmount` comes from isn't stated.** It should be the amount the payment was recorded at, the same value `payment.succeeded` reported, and never the refund request body. `eventData` still defaults to `session.amount`. Both callers pass the amount now, so this is internal only. | Add that rule to the `onRefund` docstring, and optionally drop `eventData`'s default. | claude-contracts |
| P7 | INFO (test) | `test/gw-vouchers-paid-race.test.mjs:36` | `UPDATE … SET session_id = 'ses_race' WHERE session_id = 'ses_race'` is a no-op. The test is still correct. | Drop the line. | claude-contracts |

## Still open for claude-frontend (unchanged from batches 009/012; these gate the apply and pay routes)
- **F1 (1)-(3):** the order of steps in the pay route and the release rules now in the docstring (read with P1).
- **F2:** claim only after `claimPayment`, the open-state check and the signature check; every refusal before the relay releases.
- **F3, route half:**
  - `settle.ts:16`'s `findPayment` still compares against `session.amount`.
  - Use each attempt's claimed amount everywhere and pass it to `onSessionPaid` on every recording path.
  - **A released price is void.** After any allowed release the payer still holds a valid authorization at that price. `paySale` has no caller check and its nonce binds only (merchant, orderRef, amount, salt) (`MerchantPay.sol:163-185,241`), so the payer can submit it on chain later.
  - Recording paths must accept only the amount of a live claim. Recognizing a later on-chain payment at a released price marks the session paid while `confirmRedemption` returns null (another session took the use), which is a +1 oversell.
- **F5:** the apply route refuses while a payment is in flight, pending or recorded.

Older items still open: R2-M2's second half, R2-L3, M1, M3. INFO with claude-contracts: F6 and F7.

## Secret grep
`git show --name-only --format= e77dcf4 | grep -v '\.env' | xargs grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` on the 7 files of the batch commit. Every hit is an env-var name or a test fixture, all on lines this batch didn't add:
- `lib/server/vouchers.ts:128,130` (`VOUCHER_HASH_SECRET`, name only);
- `test/gw-vouchers.test.mjs:10,56,78,140,141` (the `HASH_SECRET` test fixture and the env-var name).

Added lines of `e77dcf4`: the same pattern plus `sk_(test|live)_`, `whsec_` and `postgres(ql)?://` gives 0 hits. No `.env*` file is in either commit (count 0). `7d4c586` adds only `ci.md`, which has 0 hits.
