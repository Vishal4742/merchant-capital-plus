VERDICT: CHANGES

Tester round 1, batch 005. Fork E2E re-run independently: my own scratch copy of apps/web (RPC and explorer pointed at a local anvil fork of 1874 running the real 0xab81 bytecode, a stand-in relayer, and a mock Blockscout getLogs backed by the fork). Scripts in the session scratchpad (t005-*.mjs). Nothing was sent to the real chain, apps/web was not touched. Shots: round-1/shots/ (the first-run files named `*-375-*` from the builder's kit were 1280 px wide; mine in `pay-*`, `m-*`, `receipt-*` use true 375/1440 viewports).

## DONE (PASS, with proof)
- `npm test` in apps/web: tests 125, pass 123, fail 0, skipped 2 (LIVE). invoice-pay.test.mjs covers: fee on top, partial payment, fully-paid, InvoiceNotOpen 422, fee-read failure 503 with nothing sent, fresh salt, consumer rule, one in flight, demo message.
- Fee on top (fork, real bytecode): 7.50 invoice, guest paid 7,600,000 units, merchant got 7,500,000, invoice paid=7,500,000 status Paid, receipt /r/16 = 7.60 USDT. Relayer saw `amount` = credited only.
- Partial then rest (kit run): 4.00 then 6.00, gross 4.10 and 6.10, invoice 10.00 paid, status 2. Page shows "You pay 6.10" after a part payment (shot pay-part-paid).
- Cancel through the merchant UI: on-chain status 3 for the cancelled invoice. Cancel is hidden when part paid.
- Create: refHash on chain is random, not keccak(label) (false for both); labels only in localStorage `mcplus.invoiceLabels`. Copy link puts `http://localhost:3110/pay/16` on the clipboard. List (ids from log index, status from chain) shows every invoice, newest first, with paid text and Receipt links.
- Refund through the UI: 26 of 25 and 0 rejected inline ("Refund between 0.000001 and 25.00 USDT."); refund 7.50 approved exactly 7,500,000, allowance back to 0, payer received 7,500,000, payments().refunded=7.5e6; then the rest to refunded == gross 25,000,000; the receipt shows "25.00 USDT refunded". Merchant allowance after: 0.
- API replays: paid invoice 409 with receiptId, cancelled 410, missing 404.
- `/r/<paymentId>` reads chain (survives restart, receipt /r/16 on a fresh server read); `/r/<uuid>` works; unknown id, unknown uuid and garbage show "No receipt here yet".
- FR-PAY-7 / FR-PRIV-1: 32 page states (pay open/cancelled/missing/paid/reload/demo, receipts invoice/missing/unknown/garbage, sale refunded; 375 and 1440, light and dark): 0 crypto words (sign, gas, chain, wbt, nonce, hex), 0 other origins, 0 securitypolicyviolation events. The kit run added 18 more states: same result.
- NFR-12: /pay as Chrome downloads it (CDP encodedDataLength, 12 scripts, incl. the idle-loaded signer): 190,920 B, under 204,800.
- Speed: Lighthouse is not installed here. Substitute: Chromium mobile, 4x CPU, slow 4G, PerformanceObserver: LCP /pay/<open> 640 ms; /pay/<missing> 1,724 ms. INP not measured. (Not a Lighthouse number; the missing-invoice page is the slower one.)
- Demo message: an unfunded guest on both the checkout and /pay sees "This is a demo: paying needs a test wallet funded with test USDT, and there isn't enough in this browser's test wallet. Nothing was charged."
- Privacy: no `claude.ai/artifact` or `[private design-system link, redacted]` anywhere in apps, docs, packages, contracts, batches (grep). tokens.css line 1 now "generated from our design system tokens (tokens.json)".
- Carried: F1 in-flight at expiry (checkout-edges.test.mjs:269 passes; `!isInFlight(id)` in pay/route.ts:24 and page.tsx:44, invoice page.tsx:51); F3 checkout not-found no longer says "Nothing was charged"; L1 "Check again" is an underlined link (Confirming.tsx:13); L2 expired uses text-warning (Checkout.tsx:154); outcome.ts is pure with an 11-row test.
- Env: scratch config used 0xab81; the live :3100 server answers /pay/1 200. Real-chain vectors in onchain.live.test.mjs not re-run (LIVE reads the real chain; builder reports 2/2).

## OPEN (owner claude-frontend)
1. **Merchant page at 375 is wider than the screen** (document 589 px, `scrollWidth > innerWidth` true). The Invoices table loses Status and Actions, and the Payments table loses Status and the Refund button (shots m-final-375-light.png, m-final-375-dark.png). On a phone the Refund and Cancel buttons are off screen. Fix: stack the rows as cards below ~640 px or make each table scroll inside its own container with the action visible.
2. **Refund form keeps a stale amount.** components/merchant/Refund.tsx:25 sets `amount` once; after a successful partial refund, reopening shows the typed 7.5 while the label says "Up to 17.50 USDT" (shot m-refund-stale-prefill-1440-light.png). One more click refunds 7.50 again, not the remainder. Reset `amount` to the new `left` when the form opens or on a new `refundable` prop.
3. Low: entering a due date in the past (2020-01-01) with amount 5 shows the previous message "Invoices are between 1.00 and 10,000.00 USDT." (stale error; the form probably stopped on the date's native min). Clear the error on a new submit and say what is wrong with the date.
4. Low: invoice receipts say "Refund None" (/r/16); say "No refund" or hide the row.

## Not verified
- Expired checkout (30 min), the Confirming panel and a pending invoice as screenshots: not reachable without waiting or a hung relayer; covered by unit tests only.
- Real relayer `payInvoice` (still `pull` only), real Blockscout index, the demo merchant key (H2), funded customer (H1). Fork used an auto-impersonated stand-in relayer.
- Lighthouse proper and INP.

## NEEDS THE USER
- None for this round beyond the existing H1, H2, H5.
