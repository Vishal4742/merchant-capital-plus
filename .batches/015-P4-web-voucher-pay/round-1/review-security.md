VERDICT: PASS

# Security review: 015-P4-web-voucher-pay, round 1 (phase mode, Money: yes, one pass)

Scope: `git diff HEAD -- apps/web` (12 files) plus the new `app/api/v1/sessions/[id]/voucher/route.ts` and `test/voucher-pay.test.mjs`, including the late change to the claim block (claude-contracts 08:39, 410 from `claimAmountDue`). The FX deletions (`lib/fx.ts`, `test/fx*.test.mjs`) are already on main in 0fa3742 (see finding 1). I read them from `0fa3742^`. Contract: batch-009 security review F1, F2, F3, F5. I also read main's `lib/server/{vouchers,checkouts,events,quotes,http,db}.ts`, `lib/{relay,settle,sessions,announce-paid,usdt,outcome,dashboard}.ts`, the relayer's reject codes (`apps/relayer/src/relayer.ts`), and claude-contracts' unmerged backend branch (f570b2d) for forward compatibility.

No HIGH or CRITICAL finding. The F1 order, the release rules and the one-price-per-attempt rule are met. I found no way to use a discount twice, pay less than the claimed price, or charge the merchant a code use that wasn't paid.

## Commands run (scratch copies, `.env*` excluded; :3100 not touched)
- `rsync -a --exclude='.env*' --exclude=.next --exclude=node_modules apps/web/ <scratch>/sec015/web/`, then the full suite (re-run after the late change): `ℹ tests 396 · pass 394 · fail 0 · skipped 2`.
- `tsc --noEmit` in scratch: the only 8 errors are `Cannot find name 'PageProps'`, because the scratch copy has no `.next` typegen. There are no other type errors.
- **Mutation test**, 32 mutants on the pay route, settle, and the voucher route, run on `test/voucher-pay.test.mjs`: **22 killed, 10 survived** (finding 5). All of these were killed: release on 422 + `undefined`, release before `findPayment`, release on unknown, release on an unconfirmed 200, release on STILL_PENDING, `findPayment` / settle / announce / relay / verify / balance at `session.amount`, pending without `amount`, no release on a bad signature or BUSY/4xx, settle "open" with no release, `reopen` without the lock, the voucher route with no in-flight check, no expiry check or no rate limit, apply at the amount due, and a DB error falling through to the shop path.
- **Forward compatibility:** a second scratch copy with the backend branch's `lib/server/{vouchers,events,links,pages,quotes}.ts` and `db/048_claimed.sql`. Result: `voucher-pay.test.mjs` 17/17 pass, and PoC 410 passes (below).
- **PoCs** (scratch test files, deleted after the run):
  - PoC A: an apply racing a no-hold payment (finding 3).
  - PoC B: a 422 when another payer paid the order (OK 4).
  - PoC 410: a single-use link's second checkout (OK 2).
- **FX differential test:** deleted `toUsdt` vs `quotes.ts` `toUsdtUnits`, 220,000 random amounts × 11 rates (the band edges included): `{ n: 220000, bad: 0 }`. The results are identical, never short, and less than 1 cent over.
- `gh run list --branch main`: `completed failure docs: Record relayer batch 010 … 42154175826` (finding 1).

## What is verified OK

1. **Pay route order for a link or page checkout** (`pay/route.ts`):
   - `:90` validBefore ≤ expiresAt
   - `:91` `claimPayment`
   - `:93` `settlePending(…, { locked: true })`
   - `:94-96` paid → 409 receipt, pending → STILL_PENDING, expired → 410. All of these return before any claim.
   - `:105` claim
   - `:112-114` verify against `price`
   - `:116` balance check against `price`
   - `:119` `relaySale` with `amount: price`

   A shop's own session keeps today's path (`:49-81`). A checkout read that fails returns 503 before anything is locked (`:41-45`; mutant M27 killed).
2. **The late 410 change is right** (`:105-111`).
   - In the backend's `claimAmountDue`, the claim and the freeze are one statement inside one transaction. The `frozen` CTE runs `FROM claim`, so a refused claim (the 410) freezes nothing.
   - PoC 410 (s1 pending and frozen, then s2 of the same single-use link pays):
     `{"p1":504,"p2":[410,"This payment link has already been paid."],"relays":1, s1 before == after (frozen_at and claimed_at unchanged), s2 frozen_at null, claimed_at null}`.
     The 410 leaves no hold frozen by this attempt, and it doesn't touch the other checkout's claim.
   - Any other throw → `refuse(503)` → `releaseHold`. This is safe: it runs under the lock, after settle said "open" (no pending attempt). Any frozen hold is therefore this attempt's own (committed before the reply was lost) or a stale one that no attempt can still settle, and `releaseHold` refuses a paid checkout.
   - On main, `claimAmountDue` never throws a 410, so the branch stays dead until the backend merges. `HttpError` is the same module instance in both files, so `instanceof` holds.
3. **Release rules (F1 (2)/(3)).**
   - **Releases** (each one by this attempt, under its lock, only after its claim): `null` price, any other claim error, a bad signature, not funded, BUSY (relayer 503/429/mitigated 403/ECONNREFUSED), another 4xx, and a 422 only when `findPayment(price) === null`.
   - **Never releases:** unknown (`:122`), a 422 with `undefined` (`:130`), an unconfirmed 200 (`:155`), our own 409 (`:91`), STILL_PENDING (`:95`), paid (`:94`), or the 410.
   - **Settle's "open" branch** (`settle.ts:57,65-77`) releases only while holding the lock, either the caller's (`locked`) or one it takes. It releases only if `pending` is still the same object, so a payment recorded during the chain read (which clears `pending`) is never released.
   - **Every non-422 relayer 4xx is sent before anything goes on chain** (`relayer.ts` 400/401/415/429; 502 is unknown), so releasing on them is correct.
4. **One price per attempt (F3).**
   - `pending.amount = price` (`:118`).
   - `saleSettled` reads at `sale.amount = price` (`:150`).
   - `findPayment(…, price)` (`:127`) and settle reads at `pending.amount ?? session.amount`.
   - `recordPayment(… amount)` stores the price, and `announcePaid(session, price)` passes it to `onSessionPaid(session, paidAmount)` on all three paths.
   - Re-announces in `GET /sessions/:id` use `payment.amount`.
5. **No double discount.**
   - A price below the full price exists only as the row this claim froze.
   - A frozen row can't be re-applied (`vouchers.ts:187-188`, upsert guard `:218`) or deleted (the DELETE's `frozen_at IS NULL`).
   - It is released only when the chain says this payer didn't pay at that price, or nothing was sent.
   - `confirmRedemption` counts only `usdt_amount = paidAmount`.
   - PoC B (order paid at the claimed 50 by another address, then a 422): `{"pay":400,"frozenAfter":false,"del":200,"otherApply":200,"paid":false}`. The use is freed, but that session is never recorded paid (consumer rule `payer == from`). Getting it recorded later needs a new hold at 50, which the counted holds refuse. The attacker gains nothing.
6. **The payer can't pay less than the claimed price.** The signature's `value` and nonce amount are `price` (`saleAuthorization`), the relayer relays exactly `price`, and `paySale` pulls exactly that amount. **The merchant is never charged a use that wasn't paid:** every discount is greater than 0 (a percent of at least 1 USDT is at least 0.01 USDT; fixed values are greater than 0), so a full-price payment never matches a hold.
7. **F2 (a junk signature freezing a code):** the hold is released (test + mutant M13 killed).
8. **Voucher route.**
   - Link and page checkouts only (404). Paid → 410 (in memory and `paid_at`). In flight or pending → 409. Expired → 410 (F4).
   - The **original** `checkout.usdtAmount` is passed (M23 killed). Rate limited.
   - **The DELETE's raw SQL is safe:**
     - It is one parameterized statement, bound to the path's session id, which exists in the store.
     - Frozen or confirmed rows fail its `WHERE`.
     - Under READ COMMITTED, a concurrent claim's `UPDATE` makes the DELETE wait and re-check the new row version, which is frozen, so the row stays.
     - A committed claim is simply excluded.
     - If the DELETE wins, the claim freezes nothing and charges the full price, so a signature at the old discounted price fails and is released.
9. **Client.**
   - `currentTerms` signs `amountUnits` from the same GET reply whose `amountDue` text matched the button. `formatUsdt`/`plainUsdt` never round, so the text comparison is exact.
   - A GET failure means no signature.
   - If the page's `codeTerms` read fails, the code field is hidden and the client signs `session.amount`. The server then refuses if a hold exists.
   - **The UI can't make the payer approve an amount other than the one on the button and in "You pay".**
10. **FX switch.**
    - USDT is charged exactly. USD is 1:1, rounded up to the cent.
    - Bands are within 0.00006 of the old 0.85×/1.15× limits (INR ±0.005): negligible.
    - The 7-day date rule is the same, and it is now re-checked on cached rates (stronger).
    - No rate → 503 and nothing is created. The 10-minute TTL is kept.
    - Two behaviour changes, both accepted in batch-009 S3:
      - a stale cached rate (still band- and date-checked) is served during an outage;
      - an answer with one currency missing fails only that currency.
    - Nothing from the deleted `lib/fx.ts` protections is lost.
11. **Other checks.** No new client-bundle imports (`Checkout.tsx` imports only `react`, `next/link`, `viem` types, `@/lib/outcome`, `@/lib/usdt`). No PII, nothing on chain or on Arkiv. Logs carry error names and session ids only, and the read RPC URL is Ankr's public endpoint without a key.

## FOLLOW-UP (none blocks; phase mode)

| # | Sev | Where | Issue / exploit sketch | Fix | Owner |
|---|---|---|---|---|---|
| 1 | **MEDIUM (process; act now)** | origin/main 0fa3742 ("docs: Record relayer batch 010"); main's `app/api/v1/sessions/route.ts:6`, `lib/sessions.ts:5` | **Main is red.** The docs commit included this batch's staged deletions (`lib/fx.ts`, `test/fx*.test.mjs`) from the shared `~/ethglobal` index. Main's sessions route and `sessions.ts` still import `./fx.ts`. CI run 42154175826 failed.<br>Effects:<br>- every `next build` of main fails;<br>- every lane's pre-push hook fails after merging main;<br>- a deploy from main fails.<br>No money impact. | Commit this batch as soon as it closes: its diff removes both imports. Until then, restore the three files on main (`git checkout 0fa3742^ -- apps/web/lib/fx.ts apps/web/test/fx.test.mjs apps/web/test/fx.live.test.mjs`). In the shared worktree, don't leave deletions staged, and commit with explicit paths (`git commit <paths>`). | claude-frontend (commit), claude-research (the docs commit) |
| 2 | MEDIUM | `voucher/route.ts:38`; `lib/server/http.ts:143`; `links.ts:55` | **The apply route is public now. R2-M2's second half becomes reachable.**<br>(a) Code guessing: the limit is 10 tries per IP **per checkout**, and checkouts are free to open (20/min/IP), so about 200 tries/min/IP. `clientIp` trusts the first `x-forwarded-for` hop. Only Vercel sets it; behind a tunnel or on :3100 directly, the client sends it.<br>(b) Hold griefing: N checkouts lock an N-use code for `HOLD_MS` (45 min).<br>The discount leak is bounded by `max_redemptions`. No funds move without a merchant's code. | Add a second, cross-checkout limit (e.g. `voucher-ip:${ip}` 30/min) and a cap on live holds per IP or link. Off Vercel, take the IP from the proxy's own header. | claude-frontend |
| 3 | LOW | `voucher/route.ts:54-59` (check, then awaits) | **F5 residual (time-of-check to time-of-use).** `assertChangeable` runs before `readJson` and `applyVoucher` await. A pay POST that claims with no hold in that gap relays the full price while the apply lands a live hold.<br>PoC A: `{"apply":200,"pay":200,"relayed":["100000000"],"paidAmount":"100000000","hold":[{"usdt_amount":"50000000","frozen_at":null}],"times":0,"otherApply":[400,"That code has been used up."]}`.<br>No money impact: confirm(100) never counts the 50 hold, and the paid page shows 100. One use is locked for up to 45 min, and the apply reply says "You pay 50" during a 100 payment. This needs two tabs or a script, because the sheet is inert while paying. | After `applyVoucher`, re-check `isInFlight(id) \|\| getSession(id)?.pending \|\| payment`; if set, remove the new hold and answer 409. Alternatively, after the backend merge, have `applyVoucher` refuse while `claimed_at` is inside `FREEZE_MS`. | claude-frontend / claude-contracts |
| 4 | LOW | `voucher/route.ts:73`; `pay/route.ts:109` | **Forward compatibility with the backend branch (verified, see above).** When it merges:<br>- swap the DELETE's raw SQL for `removeVoucher`, which also refuses a paid checkout inside the statement;<br>- add a 410 test to `voucher-pay` (mutants M31/M32 survive today because main can't throw a 410).<br>The 410 shows as the sheet's "expired" state (`lib/outcome.ts:30`), so the server's text is dropped. That is the UX reviewer's call. | As stated | claude-frontend |
| 5 | LOW | `test/voucher-pay.test.mjs` | **Correct code without a pinning test** (10/32 mutants survive):<br>- M6/M7: release on our own 409, and a claim before `claimPayment`. This is F1(b), the misuse that reopens H1.<br>- M29: the link path's `validBefore ≤ expiresAt` check removed.<br>- M30: `reopen`'s identity check.<br>- M22: the DELETE without `frozen_at IS NULL`, which is the guard against a claim racing the in-memory check.<br>- M21/M25: equivalent mutants; `vouchers.ts` refuses too.<br>- M28/M31/M32: claim throws, which PGlite can't produce today. | Add tests:<br>(a) hold the lock with `claimPayment(id)`, POST pay → 409, and the hold stays unfrozen (kills M7) or stays frozen (kills M6);<br>(b) `validBefore > expiresAt` → 400 with no claim;<br>(c) a claim that throws → released;<br>(d) a DELETE racing a claim leaves the frozen row. | claude-frontend |
| 6 | LOW | `lib/dashboard.ts:29`; `app/api/v1/sessions/[id]/route.ts:40` | **A discounted payment shown at full price in two merchant views.**<br>- The dashboard row uses `session.amount`. The chain's gross replaces it only when `payments(id)` was read; on a failed read, the row and `grossToday` show the full price.<br>- `GET /sessions/:id` returns `amount: session.amount`, while the webhook reports the paid amount.<br>The figures are wrong; no funds move. | Use `payment.amount ?? session.amount` in both, or add an `amount_paid` field. | claude-frontend |
| 7 | LOW | `lib/settle.ts:56-57` | **A frozen hold is released only when someone visits** (the checkout page, the status poll, or the next pay POST). An unknown or `undefined`-read attempt that nobody revisits keeps its use until the voucher expires (on main). An attacker can cause this only during an RPC read outage: a valid signature from an unfunded key → relayer 422 `insufficient_funds` → `findPayment` undefined → pending and frozen. Availability only. | The backend's `FREEZE_MS` (20 min, unmerged) bounds it. Keep it when merging. | claude-contracts |
| 8 | INFO | `components/Checkout.tsx:134-152` | **On claude-research's 08:50 note about dropping the pre-sign GET for latency:** money stays safe as long as the client signs the exact units it displays (`amountUnits` from the last apply/remove reply, or the server-rendered `sale.amount`), never a re-parse of the display text. The server's verify at the claimed price (`pay/route.ts:112-114`) refuses any other amount and releases. | Keep `amountUnits` as the signed value, and keep the server's refusal as the backstop. | claude-frontend |

Still open from earlier batches: R2-M2's second half (now finding 2), R2-L3, M1, M3. INFO items with claude-contracts: F6, F7.

## Secret grep
`grep -nE --exclude='.env*' '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over the 14 changed and new files under `apps/web`. The only hits are `lib/relay.ts:49,52` (the env var name `RELAY_API_SECRET`, both lines from before this batch). Over the **added** lines, the same pattern plus `sk_(test|live)_…`, `whsec_` and `postgres://` has no hits. No `.env*` file is in the diff, and none was read.
