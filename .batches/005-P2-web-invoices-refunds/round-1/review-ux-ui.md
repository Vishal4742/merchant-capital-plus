VERDICT: CHANGES

# UX/UI review, batch 005 round 1

Shots: builder's set in `/private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/p005-shots/` (call it B/), mine in `/private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/ux/` (call it U/). The live app has no invoices, so open, part-paid, paid and cancelled come from B/. Signed in with a throwaway key (the demo-shop banner shows, which is correct for a stranger's wallet). Not seen on screen by anyone: the invoice list rows, Cancel, Copy link, the opened Refund form, the Confirming panel (no data to show them). Those are judged from code and marked so.

## Findings

### F1 (HIGH) The demo message never appears live
- Evidence: U/checkout-demo-375-light.png. A fresh guest wallet with 0 USDT holding to pay on a real session shows "The payment didn't go through. Nothing was charged." It does not show "This is a demo: paying needs a test wallet…". 
- Cause: `lib/relay.ts` shows the demo text only for a relayer reply `422` with `code: "insufficient_funds"`. A grep of `apps/relayer` finds no `insufficient_funds` anywhere, so the branch is unreachable against the real relayer. The human's gate decision ("say plainly it's a demo") is not met on the actual path, and the video flow for an unfunded guest ends on a generic error.
- Wording itself, when shown: "This is a demo: paying needs a test wallet funded with test USDT, and there isn't enough in this browser's test wallet. Nothing was charged." Good on intent, but "test wallet" is said twice and the sentence is long. FR-PAY-7 wording on the customer page is acceptable here (human's decision) but shorten: "This is a demo. To pay, this browser needs test USDT, and it has none yet. Nothing was charged."
- Fix: either the web server checks the guest's USDT balance (`balanceOf(from)` >= total) before relaying and returns the demo message itself, or the relayer returns the agreed code. Add a test that goes through the real status/body the relayer sends.
- Owner: claude-frontend (server pre-check, simplest); claude-relayer if the code is meant to come from them.

### F2 (HIGH) Refund is off-screen at 375
- Evidence: B/merchant-signed-in-375-light.png and -dark. The Payments table is `min-w-[560px]` in an `overflow-x-auto` card; at 375 only Payment and part of Amount show, the Status pill is cut ("10.0") and the Refund column is not visible. Nothing hints that it scrolls. FR-PAY-8 is the never-cut item and the button is hidden by default on a phone.
- Code check (Refund.tsx): the open form is one row, `w-28` input + Refund + Close, about 300 px, inside a right-aligned last cell. It will not fit in view even after scrolling.
- Fix: below `sm`, render each payment as a stacked card (id and time, amount, status, then the Refund control full width), or move Refund under the row. The open form should wrap (`flex-wrap`) with the input at full width.
- Owner: claude-frontend.

### F3 (MEDIUM) Refund amount field and errors
- Code only (not seen open). The label is sr-only, so a sighted merchant sees an unlabelled field with the hint under it: "Up to X USDT. Your wallet may ask to approve this amount first." Hint is fine; keep it visible and also put the visible label "Refund amount (USDT)" above.
- Prefilled with the full refundable amount, good. Error "Refund between 0.000001 and X USDT." is a precision-first message; say "Enter a refund of 0.01 to 25.00 USDT." (show the real max) unless 6 decimals are intended. Error text at `text-xs` is small for the one money error; use `text-sm`.
- Refunding... button disables via aria-disabled: fine. After success the form closes and the row shows "10.00 refunded" (B/merchant-signed-in-1440-dark.png): good and tabular.
- Owner: claude-frontend.

### F4 (MEDIUM) Cancel has no confirmation and sits next to Copy link
- Code only (InvoiceActions): "Copy link" and "Cancel" are two quiet buttons 4 px apart, 44 px tall; Cancel sends a transaction at once and is final. Add a second step ("Cancel invoice 7? Yes, cancel / Keep") or at least separate them. Also the "Receipt" link in the list is `text-xs` with no `min-h-11`: under 44 px. "Copied" has no live region (screen readers hear nothing).
- Owner: claude-frontend.

### F5 (MEDIUM) Pay-hint is screen-reader only on /pay
- B/pay-open-375-light.png. The checkout shows "Press and hold the button, or press Enter, to pay." in view; the invoice page hides it with `sr-only`. The button label "Hold to pay 25.10" carries most of it, but be consistent with 004: show the hint, one line, under the fee line.
- Owner: claude-frontend.

### F6 (LOW) Invoice form: a stale error survives
- U/inv-err-375-dark.png. After "abc" gives "Enter an amount like 25.00", a later submit that the browser blocks (date before today, native validation) leaves that old message on screen next to a now-valid amount. Clear the error on input change. Empty, 0.50 and a missing date show only the browser's native bubbles (no `role=alert`), which is fine but the 1.00 minimum is only explained after a JS submit; add `min`/helper text "1.00 to 10,000.00".
- Owner: claude-frontend.

### F7 (LOW) Part-paid still says "Open"
- B/pay-part-paid-375-dark.png. The row "Already paid 4.00 USDT" explains it, but the pill should read "Part paid" so a customer who reopens the link knows why the figure changed. Also there is no overdue state: a past-due invoice looks the same as one due in a month.
- Owner: claude-frontend.

### F8 (LOW) Receipt page for an invoice payment
- B/receipt-invoice-375-light.png is thin: no date, no explorer link, "Payment number 12 is confirmed." The real chain receipt (B/receipt-real-0xab81-payment1-375-dark.png) has date and an explorer link, so the invoice one is a state mismatch (fork has no Blockscout time). Confirm with the real one; if the date is simply missing from the fork, no change.
- Owner: claude-frontend (verify only).

## Checked and fine
- Money copy (B/pay-open-*, pay-part-paid-*): "You pay 25.10 USDT: the 25.00 due plus a 0.10 USDT payment fee" and the part-paid "You pay 6.10 USDT: the 6.00 due plus a 0.10 USDT payment fee" read plainly; rows Invoice / Already paid / Payment fee agree with the large figure; amounts have 2 decimals and tabular numbers; "Hold to pay 25.10" says what happens and matches the total.
- FR-PAY-7: no gas, WBT, sign, chain or wallet words on /pay, /r or the checkout in any shot. Only the demo message says "test wallet" (human decision). The explorer link text on the receipt ("View this payment on the explorer") is acceptable.
- States present: open, part-paid, paid (receipt link), cancelled, missing ("We can't find this invoice", with a way out), unconfigured ("Payments aren't live yet"). Confirming panel exists in code; not on screen (builder notes this).
- Design: card, pill, dither scene, tokens (`text-warning`, `text-accent`, `bg-accent-soft`, `min-h-11`) all reused; no one-off colours found. Light and dark both hold contrast (muted text #5a5c6e on white, #a2a5b9 on the dark card). 375 layout of /pay, /r and the signed-in header is clean, no horizontal scroll except F2.
- Targets: Hold button 279 x 48 at 375; Create invoice 48 high; the inputs are tall enough. Only small items: the "Merchant Capital+" wordmark link (28 px, same as 004, LOW) and the Receipt link (F4).
- Focus order on /merchant: wordmark, Sign out, Open a test checkout, then the form's four inputs and Create invoice, in reading order. The focus ring on the Hold button is visible (U/checkout-focus-375-light.png was taken; the ring shows in U/checkout-demo-375-light.png as a double outline).
- Round-2 LOW notes from 004: "Check again" now reads as an accent underlined link (`Confirming.tsx`, min-h-11), fixed in code. Expired now uses `text-warning` (Checkout.tsx line 154), fixed in code. Neither is shown on screen in this round; the builder lists both as not screenshot-verified, so please add one shot each in round 2.
- Merchant copy: "Your wallet sends the invoice and pays a small WBT fee. Your customer adds a 0.10 USDT payment fee on top, so you get the invoice amount in full." The cost is shown before anything is signed (FR-ADV-6 spirit); good. The footer "Refunds come from your wallet, in full or in part" is clear.

## Needed for round 2
- F1 and F2 fixed, with a screenshot of the demo message on a real session and of the Refund control at 375 (open and closed).
- Screenshots of the invoice list with rows (open, part-paid, paid), Copy link, Cancel confirm, Confirming panel and expired checkout. A fork run can supply them.
