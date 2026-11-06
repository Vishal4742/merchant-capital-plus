VERDICT: PASS

# Security review: 012-P4-gateway-pay-integration, round 1 (phase mode, Money: yes, one pass)

**Scope.** The batch commit `6b99ec3`: `lib/server/vouchers.ts`, `lib/server/events.ts`, `test/gw-{vouchers,events}.test.mjs`.

`a83a63b..HEAD -- apps/web` lists 66 files. The other 62 came in with the merges of frontend batches 008-011 and relayer batch 009, and each was reviewed in its own batch. I only re-checked them for secrets and for client imports of these server modules.

**What I read.** The current `vouchers.ts`, `events.ts`, `checkouts.ts`, `quotes.ts`, `links.ts:64-100`, `sessions.ts`, `settle.ts`, `webhooks.ts:162-165` and `db/005_checkouts.sql`, plus the batch-009 security review (F1-F7).

**Commands run** (at `6b99ec3`, from `apps/web`):
- `node --experimental-test-module-mocks --test test/gw-*.test.mjs` → `tests 121, pass 121, fail 0`.
- `npm test` → `tests 354, pass 351, fail 0`.
- `npx tsc --noEmit` → exit 0.
- I did not run `next typegen` or `next build`, because they load env files. `round-1/ci.md` still reports 1 type error, 1 failed test and a failed build (see N6).
- A PoC against PGlite, run sequentially against the shipped code: `/private/tmp/claude-501/-Users-vg890-ethglobal-contracts/c6b19a0f-dc4e-4bc4-b19c-2f27badbf70b/scratchpad/poc-012.mjs`. Its output is quoted below as "PoC n".

No route calls `onSessionPaid`, `releaseHold`, `claimAmountDue` or `onRefund` yet (grep of `app/` and `lib/`). No HIGH or CRITICAL finding is reachable.

## F1, F3 and F4: closed on the contracts side

### F1 is closed (contracts half)
- **The guard.** `releaseHold` (`vouchers.ts:268-273`) now joins `app_gw_checkouts` on `c.paid_at IS NULL`.
  - `session_id` is the table's primary key (`db/005_checkouts.sql:4`), so the join matches at most one row.
  - A redemption row exists only for a link or page checkout, because `applyVoucher` requires `checkoutOf` (`:183-184`). So the join never stops a legitimate release.
- **After the payment is recorded.** `onSessionPaid` runs `markCheckoutPaid` first (`events.ts:45`). From that commit on, every release is refused, including when `confirmRedemption` then returns null.
  - PoC 1, paid with the wrong amount: `releaseHold on that paid session: false` and `HALF on s4 after HOLD_MS: false`. The use stays frozen, so it fails closed. That is the batch-009 F2 lock, not an oversell.
  - PoC 3 (paid, past `HOLD_MS`): `releaseHold after paid: false`, the row stays frozen, and `HALF on s5 after HOLD_MS (frozen keeps counting): false`.
- **Race between `markCheckoutPaid` and `releaseHold`.**
  - `UPDATE r … FROM c` locks only `r`, and `markCheckoutPaid` writes only `c`, so Postgres never re-checks the join. A release whose statement started before `paid_at` committed still unfreezes.
  - That case is the same as a release before the payment was recorded, which only the pay route can prevent (batch-009 F1 (2)-(3)). PoC 4: `release pre-paid: true | re-apply ONE: true`, then `onSessionPaid(50)` → `HALF times_redeemed 0 | HALF on s2: true`.
  - `confirmRedemption` doesn't need `frozen_at`, so a release that slips through doesn't lose the count on its own. It only does if a re-apply switches the code in the same window, and `applyVoucher`'s paid check is a read made before the upsert (N2).

### F3 is closed (contracts half)
- `paidAmount` reaches both `confirmRedemption` (`events.ts:46`) and the webhook `data.amount` (`:16`, `:21`), and `gw-events.test.mjs` checks both.
- PoC 2, `onSessionPaid(session, claimed)`: `times_redeemed 1 | releaseHold: false | HALF on s2: false`.
- The default is only safe for some callers (N1).
- The signature changed from `(session, now)` to `(session, paidAmount, now)`. A caller written for the old order would pass a number where a bigint is expected, and `tsc` rejects that.

### F4 is closed
- `vouchers.ts:190` uses the same rule as the session TTL in `links.ts:93`: USD and USDT get 30 min, every other currency gets `QUOTE_TTL_MS`.
- `openCheckout` always records `fx`, with rate "1" for USDT (`links.ts:80,95`). `fx` is null only on rows from before batch 008, which are long expired.
- An unexpected currency gets 10 min, so the rule fails closed.
- PoC 5, apply at exactly +10 min: EUR, GBP, INR, SGD and AED are refused; USD, USDT and null fx are accepted.
- `checkout.createdAt` comes at most about 1 ms after `session.createdAt`, and the pay route refuses anything after `expiresAt` anyway.

### Nothing else regressed
- No schema change.
- The new `quotes.ts` import is server-only and adds no cycle. No `"use client"` file imports `server/{vouchers,events,quotes}`.
- No PII, nothing new on chain or on Arkiv, and no relayer change.

## FINDINGS (none blocks; only HIGH/CRITICAL block in phase mode)

| # | Sev | Where | Issue / exploit sketch | Fix | Owner |
|---|---|---|---|---|---|
| N1 | MEDIUM (latent: no caller yet) | `lib/server/events.ts:44` (`paidAmount: bigint = session.amount`), `:16` | **The default is safe for a shop's own session and for a link or page session paid without a voucher. It is wrong for a voucher-priced payment.**<br>For a link/page session, `session.amount` is the price before the voucher. A caller that leaves `paidAmount` out (the relay-success path, the 422 `findPayment` path or `settlePending` in claude-frontend's routes) gets two wrong results:<br>- The voucher is never counted. The frozen hold stays for good: PoC 1 shows `times_redeemed 0`, the row still frozen, HALF refused after `HOLD_MS`. This fails closed, so it costs availability but no money.<br>- The webhook reports `amount: "100.00"` for a 50.00 payment. The merchant's books overstate what was paid, and nothing warns them. | Drop the default and make `paidAmount: bigint` required. `tsc` then flags every call site, and shop-session callers pass `session.amount` explicitly. Keep the docstring rule that it comes only from the server's own claim, never from the request body. | claude-contracts |
| N2 | LOW | `vouchers.ts:185-188` (the paid/frozen checks are reads made before the upsert), `:210-218` (the upsert never checks `paid_at`); `events.ts:45-46` (two statements, each committed on its own) | **The paid guard only holds for statements that start after `paid_at` commits, and only `releaseHold` checks it.** The sequence:<br>1. A release starts just before `markCheckoutPaid` commits.<br>2. A re-apply reads `paidAt` before that commit.<br>3. The re-apply's upsert runs after the release commits. It switches HALF to ONE on the paid session.<br>4. `confirmRedemption(50)` returns null, so HALF is free although the session paid 50.<br>This needs a release running at the same moment the payment is recorded, which batch-009 F1 (2)-(3) already forbids the pay route to do. The same gap lets a re-apply on a paid session with no voucher leave a stray hold for up to `HOLD_MS` (batch-009 F5). | Re-check inside the statement: add `AND NOT EXISTS (SELECT 1 FROM app_gw_checkouts c WHERE c.session_id = $1 AND c.paid_at IS NOT NULL)` to the `INSERT … SELECT` WHERE and to the `DO UPDATE … WHERE`. Each statement takes a fresh snapshot under READ COMMITTED, so every re-apply that starts after `paid_at` commits is refused. Add one test: mark the checkout paid, then call the upsert path directly. | claude-contracts |
| N3 | LOW | `vouchers.ts:261-265` (`releaseHold` docstring) | **The docstring half of batch-009 F1 isn't done.** It still says "after a relay is DEFINITELY refused (nothing was sent on chain)" and lists no allowed call sites. A relayer 422 doesn't prove that nothing was sent: `paySale` has no caller check, and the payer holds every signature they made. A claude-frontend builder who reads only the docstring would release on a 422, which is batch-009 F1 (a). | List the call sites in the docstring:<br>- Only the attempt that claimed may release, and only while it holds the in-flight lock.<br>- Allowed: (i) a refusal after the claim and before `relaySale`; (ii) a relayer answer that isn't `unknown`, and for a 422 only after `findPayment` returned exactly `null`; (iii) `settlePending`'s "open" branch.<br>- Never on `unknown`, an unconfirmed 200, a 409, STILL_PENDING or a paid session. | claude-contracts |
| N4 | LOW (latent: no refund route yet) | `events.ts:52` (`onRefund` → `eventData(session)` defaults to `session.amount`) | **The refund webhook reports the price before the voucher.** For a voucher sale, `payment.succeeded` says `amount: "50.00"` but `payment.refunded` says `amount: "100.00", refunded: "50.00"`. A full refund reads as half of one, so merchant automation could act on a balance that doesn't exist. | Have `onRefund` take the paid amount as well (required, like N1). Or have `eventData` use the confirmed redemption's `usdt_amount` when one exists. | claude-contracts |
| N5 | INFO | `test/gw-vouchers.test.mjs:376-377` | The F1 test's "HALF stays held" assertion runs at `t + 2000`. Inside `HOLD_MS` any hold counts, frozen or not, so this assertion passes even without the guard. Only `releaseHold(s) === false` actually tests the fix. | Run the second apply after `t + HOLD_MS + 1` on a checkout created at that time. PoC 3 shows it is refused there only because the freeze held. | claude-contracts |
| N6 | INFO (CI, not security) | `round-1/ci.md` | ci.md reports a typecheck error, 1 failed test and a failed Turbopack build. My reruns of `tsc --noEmit` and `npm test` pass. I didn't run `next typegen` or `next build`. | The lane re-runs `npm run typecheck` and `npm run build` and records them green in ci.md before the human gate. | claude-contracts |

## Still open for claude-frontend (unchanged from batch 009; these gate the apply and pay routes)
- **F1 (1)-(3):** the order of steps in the pay route, and the release rules listed in N3.
- **F2:** claim only after `claimPayment`, the open-state check and the signature check; every refusal before the relay releases.
- **F3, route half:**
  - `settle.ts:16`'s `findPayment` and `saleSettled` still compare against `session.amount`, and `sessions.ts:61`'s `pending` has no amount.
  - Use the amount each attempt claimed everywhere, never re-claim to recognize a payment, and pass that amount to `onSessionPaid` on every recording path.
- **F5:** the apply route refuses while a payment is in flight, pending or recorded.

Older items still open: R2-M2's second half, R2-L3, M1 and M3. Two INFO items stay with claude-contracts: F6 (back off after a failed rate fetch) and F7 (re-centre the FX bands if the event runs longer).

## Secret grep
`git diff --name-only a83a63b..HEAD -- apps/web | grep -v .env | xargs grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'`: every hit is an env-var name or a test fixture, none in this batch's commit:
- `app/docs/page.tsx:19,43,174` (`GATEWAY_SECRET_KEY` / `GATEWAY_WEBHOOK_SECRET`, names in the docs sample);
- `lib/auth.ts:17,19` (`AUTH_SECRET`, name only);
- `lib/relay.ts:49,52` (`RELAY_API_SECRET`, name only);
- `lib/server/vouchers.ts:128,130` (`VOUCHER_HASH_SECRET`, name only);
- test fixtures in `test/auth.test.mjs`, `test/checkout-edges.test.mjs`, `test/gw-vouchers.test.mjs:10,56,78,140,141` and `test/relay-auth.test.mjs`.

In the added lines of `6b99ec3`, the same pattern plus `sk_(test|live)_`, `whsec_` and `postgres://` has 0 hits. Across all added lines in `a83a63b..HEAD`, `0x` + 64 hex, `sk_live_` and `postgres://` have 0 hits. No `.env*` file is in the diff.
