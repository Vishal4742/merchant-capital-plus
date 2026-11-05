VERDICT: PASS

Tester round 2, batch 005. Setup as round 1: :3100 untouched (not rebuilt); my own anvil fork of 1874 (real 0xab81 bytecode), a scratch copy of the round-2 apps/web on :3110, a stand-in relayer and a mock Blockscout. Nothing was sent to the real chain. The only write to :3100 was one `POST /api/v1/sessions` (an in-memory checkout, via SHOP_API_KEY held in a shell variable). All fork processes are stopped; :3100 still answers 200.
Proof: `round-2/shots/e2e-run-log.txt` (full fork run), `round-2/shots/ui-log.txt` (same, written by the script), `round-2/shots/mutation-run.txt`, 47 screenshots in `round-2/shots/`. Every merchant, pay and receipt shot uses a true 375x812 or 1440x900 context.

## DONE (PASS, with proof)

### Round-1 items
1. **375 overflow on both merchant tables: fixed.** `m-final-375-light` and `m-final-375-dark` (merchant page with 12 invoices and 11 payments): scrollWidth 375, innerWidth 375. All 32 `overflow checks` lines in e2e-run-log.txt are OK, none say OVERFLOW (1440 too). The tables become cards at 375. Cancel, Copy link, Receipt and Refund are all on screen, and the refund form wraps.
2. **Stale refund amount: fixed.**
   - A 25.00 sale was refunded 7.50: approval 7,500,000, allowance back to 0, payer +7,500,000, `payments().refunded` = 7.5e6.
   - Reopen after a reload prefilled **17.5**.
   - A further 2.50 was refunded in the same page session, and the reopen prefilled **15**, which is 25 − 10 and correct.
   - Accepting the prefill as-is refunded **15,000,000** (the remainder, not 17.5 or 7.5). `refunded` = 25,000,000 = gross, allowance 0.
   - A refund of 26 is refused inline: "Enter an amount above 0, up to 25.00 USDT."
3. **Past-date message: fixed, with one browser caveat.**
   - Entering 2020-01-01 is blocked first by the date field's own `min`: "Value must be 06/11/2026 or later." No stale amount error is shown.
   - With `min` removed to reach the app's check, it says "Pick a due date from today on."
   - An amount of 0.5 says "Enter an amount from 1.00 to 10,000.00 USDT."
   - The alert clears on edit. Shot: `m-past-date-1440-light.png`.
4. **"No refunds yet": fixed.** `/r/14` (invoice) and `/r/<uuid>` (sale) both read "Refund No refunds yet". After the full refund the sale receipt reads "Refund 25.00 USDT refunded".

### Round-2 changes
- **Real :3100, unfunded guest, relayer not called: PASS.**
  - A checkout was created by API on :3100 and a fresh guest held it (375 light and 1440 dark). The page showed "This is a demo: paying needs test USDT, and this browser doesn't have enough yet. Nothing was charged." No overflow.
  - A request logger stood in as the relayer on 127.0.0.1:8787, the `RELAYER_URL` port from `.env.local` (nothing else was listening there). It recorded **0 hits**.
  - Same on the fork for `/pay`: the demo message appeared, and the stand-in relayer count did not change.
  - Shots: `checkout-real-demo-375-light.png`, `checkout-real-demo-1440-dark.png`, `pay-demo-unfunded-375-light.png`.
- **Two-step cancel: PASS.**
  - Clicking Cancel shows "Cancel invoice? Yes, cancel / No". On chain the status was still 1 (Open).
  - "No" restores Cancel, status still 1.
  - Cancel then "Yes, cancel" gives status 3 (Cancelled) on chain.
  - Cancel sits apart from Copy link. Shot: `m-cancel-confirm-1440-light.png`.
- **Private customer field: PASS.**
  - Customer and label inputs have no `name` attribute (the inputs are named amount, due, then two without).
  - Only one localStorage key exists: `mcplus.invoiceNotes.0xab817593253a0a37de723072827d88fe0ca54251`. It holds the customer and label text.
  - The text appeared in no request URL, and the page URL stayed `/merchant`.
  - On chain, `invoices(id).customer` = `0x000…000` for the new invoices. The list shows the private customer after a reload.
- **`/pay` refuses another merchant's invoice: PASS.** Invoice 12 (created by another address on the fork): `/pay/12` shows the "We can't find this invoice" sheet. `POST /api/v1/invoices/12/pay` returns **404** `{"error":"This invoice doesn't exist…"}`. **0 relay calls.**
- **Refund stop on low merchant balance: PASS.** The merchant was drained to 3.00 USDT, then a refund of 25.00 was attempted. The message was "Your wallet doesn't have enough USDT for this refund." Approvals sent: **none** (Approval logs from the block before the click: empty). `payments().refunded` stayed 0. Shot: `m-refund-lowbalance-1440-light.png`.
- **CSP on /merchant: PASS.** The header is present: `default-src 'self'; script-src 'self' 'unsafe-inline'; … connect-src 'self'; object-src 'none'; … frame-ancestors 'none'`. A full merchant session (create, cancel, refund) fired 0 `securitypolicyviolation` events.
  - My injected wallet stub had to be moved out of page `fetch` (it was blocked by `connect-src 'self'`). A real extension is not bound by the page CSP, as the code comment says. This is a property of the stub, not a bug.
- **Fee on top, partial and cancelled flows re-checked.** A 7.50 invoice cost the guest 7,600,000 and the merchant got 7,500,000. The receipt `/r/14` reads 7.60 USDT. Invoice 12 (cancelled) and 99999 (missing) pages render. The paid page shows "This invoice is paid" with "View receipt".
- **FR-PAY-7 / FR-PRIV-1:** 28 customer and receipt states (pay open, cancelled, missing, foreign, demo, paid, and the receipts; 375 and 1440, light and dark): 0 crypto words (sign, gas, chain, wbt, nonce, hex), 0 hex strings, 0 CSP violations, **0 requests to other origins**.
- **NFR-12 for /pay (CDP encodedDataLength of Script resources, incl. the idle-loaded signer):** `/pay/3` **190,936 B**; `/pay/99999` **178,064 B**. Both are under 204,800.
- **Speed, substitute for Lighthouse (not installed here):** Chromium mobile 375, 4x CPU, slow 4G. LCP on `/pay/<open>` is 668 ms and on `/pay/<missing>` 1,732 ms. INP was not measured. The missing page is the slower one, but within budget.
- **`npm test` in apps/web:** tests 135, pass **133**, fail 0, skipped 2 (LIVE). This is the expected count.
- **Mutation run, round-2 money code:** 93 lines in `mutation-run.txt`; 14 new mutants (N1-N14) were aimed at the new code. **13 of 14 killed:**
  - N1 and N2: the invoice balance check (dropped, or `amount` without the fee)
  - N3: the shop-only check on the route
  - N4 and N5: the sale balance check (dropped, and `<=`)
  - N6: the invoice balance check disabled
  - N7 and N14: the refund "exceeds balance" stop and its copy
  - N8, N9, N11, N12: `isShopInvoice` and `pageState`
  - N13: `invoiceLock`
  - Survivor: N10 (`status !== "missing"` inside `isShopInvoice`) is an equivalent mutant, because a missing invoice has the zero merchant, which never equals the shop.
  - Several of the round-1 survivors are also killed now: I6, I18, N6.
- **Screenshots:** `pay-{open,cancelled,missing}-{375,1440}-{light,dark}`, `pay-foreign-375-light`, `pay-paid-375-dark`, `receipt-{invoice,missing,garbage}-{375,1440}-{light,dark}`, `receipt-sale-norefund-1440-light`, `m-final-{375,1440}-{light,dark}`, `m-refund-open`, `m-refund-reopen`, `m-refund-lowbalance`, `m-cancel-confirm`, `m-past-date` (1440 light), `checkout-real-demo-*`.

## OPEN (all LOW, none blocking; owner claude-frontend unless stated)
1. Older survivors from the round-1 mutation sets that still survive: `lib/merchant-wallet.ts` W1 (`allowance <= amount` sends one extra exact approval, harmless), W5 (receipt status check), W8 (log filter by MerchantPay address); `lib/settle.ts` S1, S2, S4; `lib/onchain.ts` O11; `lib/pay.ts` P8 and P9; `route.ts` I7 (redundant with I5). One-line tests, for a quiet batch (code lane).
2. The past-date refusal on desktop browsers is the native `min` bubble ("Value must be 06/11/2026 or later."), which is not styled. The app message only fires where `min` is not enforced. Acceptable.
3. A fully refunded payment on the merchant page reads "Fully refunded" in the cell, and the pill reads "Refunded". Both are fine, just noting the duplicate.
4. Tooling: Lighthouse and INP are still not measured here (substitute above). Say so at the gate.

## NOT VERIFIED
- Real relayer `payInvoice` (still `pull` only, RL2), the real Blockscout index, the funded customer (H1) and the demo merchant key (H2). The fork used an auto-impersonated stand-in relayer.
- The Confirming panel and the expired checkout as screenshots; unit tests only.
- On :3100, only the unfunded-guest path was exercised, as asked. The real chain was read only, through Ankr, by the guest balance check.

## NEEDS THE USER
- None beyond the existing H1, H2, H5.
