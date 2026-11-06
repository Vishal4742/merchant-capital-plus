VERDICT: PASS

Batch 006-P4-web-gateway-shell, round 1, tester. Server :3100 (not rebuilt). Probes and raw output: `round-1/probes/` (test-walk.mjs/.json, test-merchant.mjs/.json, sessions-v2.txt, sessions-idem.txt, payments.txt). Shots: `round-1/shots/` (true 375 and 1440, light and dark).

## DONE (PASS, with proof)
- **Suite:** `npm test` = 182 tests, 179 pass, 0 fail, 3 skipped. `npx tsc --noEmit` and `npm run lint` clean.
- **LIVE FX:** `LIVE=1 node --test test/fx.live.test.mjs` passes. 100 EUR = 112.51, GBP = 134.71, INR = 1.06, AED = 27.23, SGD = 78.28 USDT, rates dated 2026-11-05.
- **Test-mode strip (FR-GW-14):** on /, /docs, /merchant, /checkout (EUR and USDT), /r/7, /proofs, /pay/99999, /checkout/none and a 404. That is 10 routes x 375/1440 x light/dark. `[role=note][aria-label^="Test mode"]` count is exactly 1 on every one, text count 1. Not clipped, 28 px tall, at the top. The text is rgb(237,237,243) on rgb(23,35,226), contrast 7.58:1. 375 reads "Test mode · Whitechain testnet", 1440 adds "· no real money moves". `scrollWidth <= innerWidth` on every route and theme. The Shell does not repeat it (merchant strips = 1). Source greps for 1875 and viem `whitechain` are tests that pass.
- **/docs:** 4 copy buttons (button snippet 190 chars, server snippet 516, webhook snippet 553, GATEWAY_URL 33). The clipboard holds the right text and the label flips to "Copied". The key never appears: the SHOP_API_KEY value is absent from the HTML and the text, signed in or not. "Simulate a payment" lands on /checkout/<id> as a full load (a `window.__marker` set before the click is gone afterwards, and the strip count is 1).
- **Sessions v2 (real HTTP, probes/sessions-v2.txt):**
  - Every currency returns 201. USDT and USD return `amount "20.00"`. EUR returns `"22.50"`, rate `0.88879`. GBP returns `"26.94"`, AED `"5.45"`, SGD `"15.66"`. INR 200 returns `"2.12"`, rate `94.5`.
  - Reply shape: `currency` is the requested one, `priced {currency, amount, rate, rateAt, source}` is present for USD and the quoted currencies and absent for USDT, amounts are plain strings.
  - Expiry: EUR/GBP/AED/SGD/INR 10 min (22:27), USDT/USD 30 min (22:47).
  - Min 1 USDT after conversion enforced: 400 for INR 20 and EUR 0.50. JPY returns 400.
  - Items add up in the session currency: a match returns 201, a mismatch returns 400 "Items add up to 7.50 EUR, but amount is 20.00 EUR."
  - returnUrl: `javascript:`, `ftp:`, `data:` and "notaurl" return 400. https and http://localhost return 201. 200 chars returns 201, 201 chars returns 400.
  - reference of 41 characters returns 400, 40 returns 201. No auth returns 401.
  - Idempotency-Key: same body returns the same id (201). A different body returns 422. 4 parallel requests return one id. An empty key returns 400. A failed (400) request frees the key for a corrected retry.
  - GET /sessions/:id: 401 without the key. With the key it returns `{id,status,amount,currency,priced,reference,paymentId,txHash,refunded}`. An unknown id also returns 401.
- **GET /api/v1/payments (probes/payments.txt):** no key and a bad key return 401. limit=3 returns 3 rows with `next "6"`. The cursor walk (3, 3, 2, next null) covers ids 8..1 with no duplicates. The default returns 8. limit 0, -1, abc, 1000, 1.5 and cursor zzz, -5 return 400. Amounts are plain ("100.10"). Newest first. Live MerchantPay rows with real tx hashes. sessionId is null for rows whose session was lost on restart, as designed.
- **Checkout (EUR, 375):**
  - The FX line is in the server HTML: "20.00 EUR = 22.50 USDT · rate of 5 Nov 2026 · 1 USDT = 1 USD".
  - The countdown (`role=timer`) reads "8:29 left to pay". "Pay exactly 22.50 USDT, no more and no less. No fees for you." is shown.
  - A guest without funds who holds Enter gets the demo message in the warning colour (rgb(154,91,0)), not red. The one console error is the expected 400 from the pay POST.
  - Expired state with the browser clock shifted 10.6 min (375/1440, light/dark): "Expired", "This checkout has expired. Ask Bandra Beans for a new one.", a "Back to Bandra Beans" link to https://shop.example/thanks, no hold button, no overflow. The countdown ends at 9:30.
  - /r/7 and /r/8 receipt rows: "Network fee None: you paid no network fee", Refund "No refunds yet", Invoice row on 8.
- **NFR-12:** /checkout EUR downloads 191,141 B of JS in 12 scripts (CDP `encodedDataLength`) against the 204,800 B limit. No third-party requests. The CSP header is present.
- **FR-PAY-7 / FR-PRIV-1 scan:** with the strip allow-listed, customer routes (/, /checkout, /r, /pay) show no 0x… addresses and none of gas, wei, nonce, calldata, signature, hex, allowance or approve. Only /docs ("MC-Signature", developer page) and /proofs (untouched, pre-existing "Guest wallet signature") match. No cross-origin requests from /checkout.
- **/merchant signed in (fake injected wallet, throwaway key, localhost):**
  - v2 design: night band with "Tonight at your shop.", 6 KPI tiles (Gross today 0.00, Payments 0, Fees 0.00, Refunds "—", Settled T+0, Vouchers "—"), the chart with a working 7/30 switch (radio `gross-30` checks and the label changes), quick actions, sidebar at 1440 and a `<details>` Menu at 375.
  - No console errors, no overflow. Reduced motion renders the same page with 0 running animations.
  - Sign-out works.
  - The demo-shop note is shown because the throwaway wallet is not MERCHANT_ADDRESS.
- **Carried 005 items:** R2-F1 (a mutant that restores the pending balance check is killed), R2-F2 (revert string "ERC20: transfer amount exceeds allowance" in lib/merchant-wallet.ts:111 and the fake wallet test), N1 (`plainUsdt` prefill, Refund.tsx:24), N2 ("Keep it", Invoices.tsx:298), N3 (warning tone, verified above), F-N3 (`readUsdtBalance` uses `retried`, onchain.ts:98), F-N4 (/merchant links are plain `<a>`; no `<Link>` to /merchant in app/ or components/), F-N5 (dry-run guard at merchant-wallet.ts:108-111), F-N6 (dashboard filter mutants G1, P1, P2 are killed, below).
- **Mutation run (35 mutants in a scratch copy, `apps/web` untouched): 32 killed, 3 survived.** Killed: FX rounding, direction, cache TTL, lock, USD 1:1, zero rate, a missing currency; the reference, returnUrl, item-sum, idempotency, TTL, min and 503 paths; the payments auth, merchant filter, cursor, limit, next and ordering; the pay-route balance and validBefore clamps; the sign-sale clamp; the dashboard filters and IST offset. Survivors are under FOLLOW-UP.

## OPEN
None blocking.

## FOLLOW-UP (MEDIUM/LOW, fix in the next batch; owner claude-frontend)
1. **Test gap, payments amount:** mutating `amount` to gross minus refunded (`app/api/v1/payments/route.ts`, `usdt(record.gross)`) passes all tests. test/payments-api.test.mjs:72 asserts only `refunded "5.00"` for payment 4. Add `assert.equal(data.data[1].amount, "25.00")`. (I tried to add it; the edit was denied by the permission classifier, so it is not applied.)
2. **Test gap, zero-gross filter:** the `record.gross === 0n` drop (payments/route.ts, record filter) has no test. Add a log id with no chain record.
3. **Idempotency slot per merchant** (`${config.merchant}:${key}`) survived because the server has one merchant. It is an equivalent mutant today, so add a test once there are several.
4. **Spec wording:** unbuilt nav items say "Soon", not "Coming in this build" (components/dashboard/Nav.tsx:61), following the approved v2 demo. They are not links, as required. Confirm with the spec owner. The nav is also grouped as Home/Payments/Links/Pages/Invoices/Vouchers, Money, Developers (API keys, Webhooks, Docs), not the flat list in the spec.
5. Cosmetic: the Payments tile shows a green "▲ 0 vs yesterday" at zero.
6. /docs "Test keys" says "Sign in … to see your secret key" but then shows only a 6-character prefix. Wording only.

## Not verified (needs another lane, a tx, or a tool)
- **Lighthouse is not installed.** LCP and INP were not measured. Only the NFR-12 JS size was, as Chrome downloads it. No relayer change, so no p95 run.
- **Paid state of an EUR session** (receipt "Price" row, paid-state "Back to <shop>") needs a real payment, which I may not send. It was not seen in a browser. The builder's code and the unit tests cover it, and the /r receipts above show the "Network fee" row.
- **Halftone fill and KPI tiles with real data.** A throwaway wallet sees "0.00" and "—" (the demo-shop wallet note). The builder reports real values for MERCHANT_ADDRESS (gross today 156.10, payments 8). I confirmed the same rows through the live /api/v1/payments call, not in the dashboard.
- **Live fall-back when Frankfurter is down** (the 503 path) is covered by the unit mutant "503 swallowed" (killed), not by a live outage.
