STATUS: READY

# Build report: 005-P2-web-invoices-refunds (claude-frontend), round 2

Round 1: tester CHANGES, ux CHANGES, security PASS (FOLLOW-UP), code PASS (FOLLOW-UP). The developer subagent built round 2 in scratch p005 while the round-1 tester finished. claude-frontend copied it in (22 files, `diff -rq` now empty) and ran the checks in apps/web.

## Must
- **[ux F1 HIGH, security F1] Server-side USDT balance check before the lock** in both pay routes (invoices use the same multicall as the invoice and fee reads).
  - Too low → 400: "This is a demo: paying needs test USDT, and this browser doesn't have enough yet. Nothing was charged." Nothing is locked, relayed or marked pending.
  - If the read fails, the route carries on (the relayer checks too).
  - The relayer's `insufficient_funds` maps to the same copy.
- **[ux F2 HIGH, tester 2] 375:** the payments table and the invoice list are stacked cards below `sm`, and the refund form wraps. `scrollWidth <= innerWidth` on all 12 merchant shots (true 375×812 contexts).
- **[security F2, code F2]** The refund stops before any approval when the dry run says "exceeds balance". The fake wallet now reverts like TetherTokenV2 (balance first, then allowance), which kills W4.
- **[tester 1] Stale refund amount:** the form resets to what's left on every open (keyed by the refundable figure). A refund above what's left on chain is refused before sending. Fork: after 7.50 of 25.00 the field showed 17.5.
- **Human decisions (02:3x):**
  - a "Customer (only you see it)" field, kept in localStorage only, under `mcplus.invoiceNotes.<MerchantPay>`; the on-chain customer stays zero
  - `/pay` and its route serve only MERCHANT_ADDRESS's invoices (anything else gets the not-found sheet and a 404 before any relay; checked on the fork)

## Also
- **Invoice actions:** two-step Cancel, away from Copy link; "Copied" in `aria-live`; 44 px links and wordmark.
- **Pay hint:** visible on /pay and the checkout.
- **Invoice form:** errors clear on change; the date has its own message; the amount label shows the range.
- **Copy:** "Part paid" pill; "No refunds yet".
- **Security F4:** a test for the S5 race.
- **Security F5:** row amounts from `payments(id)`, other merchants' rows dropped; the Today total sums those.
- **Security F6:** no `name` on private inputs.
- **Security F8 + code F8:** the CSP on /merchant, and the pay link as a plain `<a>`.
- **Code F7:** the fee is read from `relayFee()` everywhere; "Paid by customers (invoice fees included)".
- **Code F9:** notes keyed by MerchantPay.
- **Code F10:** stale comments.
- **Code F5:** "Reload this page and try again."
- **Extras:** fresh salt in `signSale` tested; `pageState`/`invoiceLock` helpers tested.

## Deferred (reasons)
- security F3 (Paid-log tie): no money moves; best when RL2 defines the relayer's response
- code F3 (a landed pending invoice has no receipt link): needs a Paid-log lookup by payer
- code F6 (shared `usePay`): a refactor of both money sheets, for a quiet batch
- code F11: a process item for claude-research
- UX overdue state: LOW

## Verified (apps/web)
- typecheck 0 · lint 0 · `npm test` **133 pass**, 2 skipped (LIVE), 0 fail · build 0.
- Live :3100: /, /merchant (with the CSP header), /pay/1 and /r/1 all return 200.
- Builder's fork E2E:
  - invoices created with private notes; the two-step cancel turned one Cancelled on chain
  - a 502 gave the Confirming panel, which survives a reload
  - refund → allowance back to 0
  - 0 other origins; 0 forbidden words in 24 customer states
  - 42 shots in `scratchpad/p005-r2-shots/`

# Round 1 report (kept)

# Build report: 005-P2-web-invoices-refunds (claude-frontend), round 1

Built by a developer subagent in scratch (b006), then replayed onto batch 004's final code (40f596c) under this batch and retargeted to the **final Phase 3 MerchantPay `0xab817593253a0a37de723072827d88fe0ca54251`**. claude-frontend ran the checks in apps/web.

## DONE
- **Invoices:**
  - **Customer page.** `/pay/[invoiceId]` is a server-read page: no browser chain reads, a static scene, the signer loaded at idle, and the strict CSP. It shows the amount still owed plus the 0.10 USDT "payment fee" (on top, per Phase 3) and the open, part-paid, paid, cancelled and missing states.
  - **Pay route.** `POST /api/v1/invoices/:id/pay` follows the 004 money rules: the server rebuilds the authorization from chain data, verifies before relaying, allows one in flight, keeps unknown outcomes pending until the approval expires, checks the chain on any 422, and uses a fresh salt per attempt.
    - Phase 3 invoice rules: `value = amount + relayFee()` (the fee is read on the server); the nonce covers the credited amount only.
    - Invoice consumer rule: gross == amount + fee, payer == the signer, merchant == the invoice's merchant, and `invoices(id).paid` rose by exactly `amount`.
  - **Merchant side.** On /merchant the merchant creates invoices (random refHash; the label stays in localStorage), lists them (ids from the Blockscout log index, state from the chain) and cancels them. Their own wallet sends these, simulated first.
- **Refunds (FR-PAY-8, AT-2):** a Refund column. It approves exactly the refund amount when the allowance is short, then calls `refund(paymentId, amount)`. The refundable figure comes from `payments(id)`; MerchantPay's errors become plain merchant copy before any approval is spent.
- **Receipts:** `/r/<paymentId>` reads `payments(id)` and its Paid log on chain, so it survives restarts. `/r/<uuid>` is unchanged.
- **Payments table:** sessions merged with the Paid log index, so invoice payments and sales from before a restart appear.
- **Shared code:**
  - `parseApproval` (the pay routes' input checks)
  - `relay()` (sale and invoice share one error mapping)
  - `lib/outcome.ts` (the Checkout and invoice status mapping as a pure function, 11-row test; code R2 F2)
  - `components/Confirming.tsx`
- **Carried items:**
  - security R2 F1: an in-flight payment at expiry is pending; `!isInFlight` in the early 410 and in the page's pending prop; test RED → GREEN
  - security R2 F3: the not-found copy no longer promises "Nothing was charged"
  - ux R2 L1: "Check again" reads as a link
  - ux R2 L2: expired uses the warning colour, not red
  - code R2 F5: one-line tests N20, N21, M26, M45, N26
  - code R2 F6: WBT units on the gas rows
- **Human gate 004 (demo flow):** `insufficient_funds` gives "This is a demo: paying needs a test wallet funded with test USDT…".
- **Privacy (human via claude-research):** the private design-system link is removed from `app/tokens.css`, `docs/FRONTEND-PLAN.md` and the batch 002 build report.
- **Vectors:** `saleNonce` and `invoiceNonce` read live from `0xab81…4251`, next to the 0x83b5 vector.

## Verified
- In apps/web: typecheck 0 · lint 0 · `npm test` **123 pass**, 2 skipped (LIVE), 0 fail · build 0. New routes: `◐ /pay/[invoiceId]`, `ƒ /api/v1/invoices/[id]/pay`.
- Builder: `LIVE=1 node --test test/onchain.live.test.mjs` 2/2.
- **Builder's fork E2E** (local anvil fork of chain 1874 running the real 0xab81 bytecode; a stand-in relayer copying the relay contract; no real funds):
  - a merchant created invoices through the UI
  - the guest paid a 10.00 invoice with press-and-hold, was charged exactly 10.10, and the invoice turned Paid with receipt `/r/12`
  - a partial payment of 4.00 + 0.10 left "You pay 6.10", which then cleared it
  - cancelled showed the closed state
  - a refund of 10.00 of 25.00 used an exact approval (allowance back to 0), and the receipt shows "10.00 USDT refunded"
  - /pay JS as Chrome downloads it: 190,912 B ≤ 204,800
  - 0 forbidden words in 18 states; 0 other origins on /pay and /r
- **Live :3100:** /, /merchant, /pay/1, /r/1 and an unknown checkout all return 200; /pay sends the CSP header. Config: MerchantPay 0xab81…4251, merchant 0x37F9…42B1.

## Judgement calls (for the reviewers and the human)
1. "Payment fee", not "network fee", to avoid crypto words.
2. The demo message says "test wallet", per the human's gate decision (FR-PAY-7 bans "wallet" on the checkout; the SRS doesn't ban it in this message).
3. The invoice page always pays the full amount still owed. A concurrent payment by someone else makes ours read as pending, never a false receipt.
4. The `payInvoice` args mirror the function, `{invoiceId, from, amount (credited), validAfter, validBefore, salt}`. The relayer must add `relayFee` itself for its balance check (claude-relayer RL2).
5. The merchant page's simulation, allowance and receipt reads go through the merchant's own wallet provider, not Anon-RPC (a ponytail note; FR-PRIV-1 is Phase 4).
6. Cancel is hidden for part-paid invoices, because the contract refuses to cancel them.

## Not verified
- Anything live on the real chain that needs H1/H2: a funded customer and the merchant key.
- The relayer's real `payInvoice`: it still supports only `pull`.
- On the real chain, the invoice list depends on Blockscout's index (not checkable on the fork).
- Screenshots of the Confirming panel and the expired checkout under the new markup.
