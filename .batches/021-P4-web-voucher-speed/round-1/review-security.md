VERDICT: PASS

# Security review: 021-P4-web-voucher-speed, round 1 (phase mode, Money: yes, one pass)

Scope: `git diff -- apps/web` (5 files: the pay route, the voucher route's comment, `components/Checkout.tsx`, `lib/docs-reference.ts`, `test/voucher-pay.test.mjs`). The contract is the batch-009 security review, F1-F3 and F5, plus INFO 8 of the batch-015 review. I also read the current `lib/settle.ts`, `lib/sessions.ts` (the lock), `lib/server/vouchers.ts` (`claimAmountDue`, `releaseHold`, `amountDue`), `lib/server/checkouts.ts`, `lib/pay.ts` (`parseApproval`), `lib/sign-sale.ts`, `lib/outcome.ts`, `lib/usdt.ts`, and `app/checkout/[sessionId]/page.tsx`.

No HIGH or CRITICAL finding. The new `amount` field can't lower the charge. The new 409 releases only this attempt's own claim. The sheet signs exactly the units it shows.

## Commands run (scratch copy, `.env*` excluded; :3100 not touched; no `.env*` read)
- `rsync -a --exclude='.env*' --exclude=.next --exclude=node_modules apps/web/ <scratch>/sec021/web/`. The copy has 0 `.env*` files, and `node_modules` is symlinked.
- Full suite: `ℹ tests 461 · pass 459 · fail 0 · skipped 2`.
- `npx tsc --noEmit`: 17 errors, all `Cannot find name 'PageProps'` or `'LayoutProps'`. They come from the missing `.next` typegen in scratch. There are no other type errors.
- `npx eslint` on the 5 changed files: exit 0.
- **Mutation test**, 19 mutants run on `test/voucher-pay.test.mjs`: **14 killed, 5 survived.**
  - Killed:
    - M1: no release on the amount 409
    - M2: the amount check after the lock
    - M3: release on the lock's 409
    - M4: release on STILL_PENDING
    - M5: the amount check after the verify
    - M6: a missing amount gives 400
    - M7: the regex loosened to `-?\d+`
    - M8: no amount check
    - M9: a wrong `discount`
    - M11: no `.catch` on the early read
    - M13: the 503 checked before the 400
    - M14: the amount compared with the checkout's full price, not the claimed price
    - C1: signing `sale.amount`
    - C2: sending `sale.amount`
  - Survived:
    - M10 (relay `signedFor ?? price`) is equivalent: it is reached only when `signedFor === price`.
    - M12 (read the checkout only after the body): finding 1.
    - C3-C5 (client-side): finding 2.

## What is verified OK

1. **The F1 order is unchanged** (`pay/route.ts`):
   - `:98-99` parses `amount` before anything is locked;
   - `:100` checks validBefore ≤ expiresAt;
   - `:101` takes the lock (`claimPayment`);
   - `:103-106` runs `settlePending(…, { locked: true })`, then the paid, pending and expired checks;
   - `:115-121` claims;
   - **`:125-129` runs the new amount check**;
   - `:130-132` verifies at `price`;
   - `:133-134` checks the balance at `price`;
   - `:137` relays `price`.

   Only the new step is added, and it sits between the claim and the verify.
2. **The 409's release meets F1 (2)(i).** It runs inside the `try`, so it holds this attempt's lock, and the `finally` releases the lock only after `await releaseClaim(id)`. It runs after settle answered "open" and after this attempt's own claim. Nothing has been relayed at that point.
   - **It can't release another attempt's freeze:**
     - The lock is a synchronous check-and-add per session (`sessions.ts:119-123`), so no other attempt on this session is in flight.
     - "open" means no pending attempt: a dead attempt is cleared and released by `reopen` before this claim (`settle.ts:65-77`).
     - `releaseHold` is scoped to this `session_id` and refuses a paid checkout (`vouchers.ts:313-325`).
     - Other checkouts of the same link have their own rows.
   - The release is the same release the MISMATCH refusal already does (`refuse(400)`), just reached one step earlier. The lock being in memory per process is a property of every release path that already existed, not something this batch adds.
3. **`amount` can't make the payer pay less.** It only decides whether to return the 409. `sale.amount` is still `price` (`:130`), the verify is at `price`, and the relay sends `price`.
   - Test "says 50, signed 100": `400 MISMATCH`, nothing relayed, hold released. The verify stays the backstop.
   - M10 is equivalent, which confirms `amount` never reaches the sale unless it equals the claimed price.
4. **Input handling.**
   - A malformed amount is a 400 before the lock. The test covers `50000000` (a number), `"5e7"`, `"-1"`, `""`, `"50.00"` and `null`, and afterwards nothing is frozen or in flight.
   - `\d` without the `u` flag is ASCII-only, and `BigInt` normalises leading zeros (`"050000000"` pays).
   - A missing amount takes the old path, verify only (an older bundle sends none).
   - By `:53`, `body` is a JSON object (`parseApproval` refused anything else). `JSON.parse` makes `__proto__` an own key, so no pollution is possible.
5. **The lock's 409 and STILL_PENDING release nothing.** Both are tested (the other attempt's freeze stands, and a pending hold stays frozen), and M3/M4 are killed. The test also checks that their bodies carry no `amountDue`, so the sheet treats them as "confirming" (`outcome.ts`), never as a new total.
6. **Starting `gatewayCheckout(id)` before the body is parsed** (`:44-52`).
   - It is an `async` function with `.catch` attached in the same tick, so the promise can't reject. A 400 return that leaves it unawaited has nothing unhandled; it at most logs an error name.
   - Behaviour on a bad body is unchanged: a database outage plus a bad body is still a 400 (M13 killed). An outage plus a good body is a 503 before the lock (M11 killed).
   - **No race.** The fields used from the early read (link vs shop, `usdtAmount`) never change after insert: the only `UPDATE app_gw_checkouts` statements set `claimed_at` and `paid_at` (`vouchers.ts:277,318`, `checkouts.ts:89`). `claimAmountDue` re-reads its own checkout under the advisory lock anyway.
7. **The 409's body.** `discount = usdtAmount − price` is the same formula as the voucher route's `due` (`voucher/route.ts:45`), and it can't go negative. The amounts are `plainUsdt` and `toString`, which never round. The same three fields are already public through `GET /voucher`, so nothing new is disclosed.
8. **The client** (`Checkout.tsx`).
   - **Signs exactly what it shows** (INFO 8 of the batch-015 review is met).
     - The first units are the page's `amount`, which is also `amountText` (`page.tsx:67,75,79`).
     - After that, units change only with a code reply or a 409 that passes `isDue`. `amountUnits` must be all digits, and `amountText` comes from the same reply.
     - `submit` signs (`:146`) and sends (`:149`) `due.amountUnits` from one render closure, so the signed and sent units are always equal.
     - `signSale` returns no `amount` field, so the spread can't be overridden.
   - **On a 409:**
     - **No auto-retry.** A 409 with the due fields runs `setDue`, then throws; `pay()` is single-flight, and the hold button goes back to idle. The payer has to hold again at the new total.
     - **Other 409s** (lock, STILL_PENDING, already paid) carry no due fields. They fall through to `outcome`, which shows "confirming" or the receipt.
   - **The paid view** shows `due.amountText`, which is the amount that was signed.
9. **Docs** (`docs-reference.ts:220-221`): the body (`amount` optional) and the 409 shape match the route. See finding 3 for one qualifier the text leaves out.
10. **Other checks.**
    - **Client bundle and data.** No new imports reach the client bundle, and nothing new goes on chain or to Arkiv. The new log line carries the error name and the session id only.

## FOLLOW-UP (none blocks; phase mode)

| # | Sev | Where | Issue / exploit sketch | Fix | Owner |
|---|---|---|---|---|---|
| 1 | LOW (test quality, not money) | `test/voucher-pay.test.mjs` (the "checkout read runs while the body is still arriving" test, `seen.some(text.includes("FROM app_gw_checkouts"))`) | **The overlap test passes even when there is no overlap, if the whole file runs.** Mutant M12 reads the checkout only after the body arrives. It is killed when the test runs alone (`--test-name-pattern`: "timed out", 2.0 s), but it survives the full file.<br>The cause: an earlier test's background `onSessionPaid` runs `checkoutOf` (`SELECT … FROM app_gw_checkouts`) on another session during the wait, so the check matches. Captured at send time under M12: `["UPDATE app_gw_checkouts SET paid_at …", "WITH claimed AS ( UPDATE app_gw_redemptions …", "SELECT session_id, kind, ref_id, … FROM app_gw_checkouts …", …]`.<br>The NFR-4 overlap is therefore unpinned. This doesn't affect money: the order and the releases are pinned elsewhere. | Record `[text, values]` in `pgDb` and wait for `text.includes("FROM app_gw_checkouts") && values?.[0] === id`. Or drain earlier announcements before `setTestDb(pgDb(seen))`. | claude-frontend |
| 2 | INFO | `components/Checkout.tsx:72-73,128,153` | **Client mutants C3-C5 survive.** C3 lets any status with due fields update the sheet. C4 drops `isDue` on code replies. C5 drops the digit check on `amountUnits`. The source pin covers only signing, sending, and `409 && isDue`.<br>No money impact. The server never sends due fields on another status. A missing or non-numeric `amountUnits` makes `BigInt` throw in `signSale`, so nothing is signed, and the server's verify at the claimed price refuses any other amount. | Optionally extend the source pin with `!res.ok \|\| !isDue(data)` and the `/^\d+$/` test. | claude-frontend |
| 3 | INFO | `lib/docs-reference.ts:220-221` | **The docs don't say the 409 is for link and page checkouts only.** A shop's own session ignores `amount`: `payShopSession` never reads it, so a wrong amount there gives the usual 400 MISMATCH, not the 409. The `400 "amount must be USDT units."` isn't listed either. | Add "Link and page checkouts only" to the 409 sentence, like the voucher rows do. | claude-frontend |
| 4 | INFO | `pay/route.ts:125-129`, `:44` | **The 409 runs before the signature is checked**, so anyone with a session id can trigger a claim → release cycle without a valid signature. This adds no new exposure:<br>- A junk signature already does the same cycle through `refuse(400, MISMATCH)`.<br>- The due fields are public on `GET /voucher`.<br>- A bad body now costs one `checkoutOf` read, where a well-formed junk body already cost that read plus the claim transaction.<br>The pay route still has no per-IP limit; this predates the batch (batch-015 finding 2 covers the apply route). | None for this batch. Consider a per-IP limit on `POST /pay` together with batch-015 finding 2. | claude-frontend |
| 5 | INFO | `pay/route.ts:6`, `Checkout.tsx:6`, `voucher/route.ts:3`, test header comment | **The code comments say "Batch 020 (NFR-4)", but this is batch 021.** Batch 020 is `020-P4-web-g4-code-followups`. Later reviews cite batch numbers, so the label misleads anyone tracing a change. | Change the label to "batch 021" before committing. | claude-frontend |

Still open from earlier batches (outside this batch's scope): batch-015 findings 2, 3 and 6.

## Secret grep
- `git diff --name-only -- apps/web | xargs -0 grep -nE --exclude='.env*' '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over the 5 changed files: **no hits** (exit 1).
- Over the diff's added lines, the same pattern plus `sk_(test|live)_`, `whsec_` and `postgres://`: **no hits**.
- No `.env*` file is in the diff, and none was read.
