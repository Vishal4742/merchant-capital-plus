VERDICT: PASS

# Test report: 006-P4-web-gateway-shell, round 2 (tester)

Checked on a separate `next start -p 3101` of the same `.next` build, with a throwaway SHOP_API_KEY and a throwaway MERCHANT_ADDRESS that I set in the process env. I did not read `.env*` (the first attempt to read the shop key was denied, so I used my own key). It is stopped now. :3100 was only hit with GET /docs headers, and was not restarted or rebuilt. No payment was relayed, 20 sessions were created on :3101 (in memory), no product code was edited, and no test file was added.
Probes and raw output: `round-2/probes/` (fx-probe.mjs/.txt, sessions-probe.mjs/.txt, walk.mjs/.json, layout.mjs/.txt, expired.mjs/.txt). Shots: `round-2/shots/` (/merchant as shop and non-shop wallet, /docs, EUR checkout, EUR expired; 375 and 1440, light and dark).

## Full checks
- `npm test`: 293 tests, 290 pass, 0 fail, 3 skipped (LIVE). payments-api + all `gw-*` tests alone: 108 of 108 pass, so PR #11's tests run fine alongside ours.
- `npx tsc --noEmit`: 0 errors. `npm run lint`: 0 problems.
- NFR-12: /checkout (EUR) downloads **191,149 B** of JS in 12 scripts (CDP `encodedDataLength`), the same at 375 and 1440, light and dark. The 2 noModule polyfill scripts are not fetched by Chrome. Budget 204,800 B: 13,651 B spare.

## Round-1 findings
- **FX bands, base, rate date: FIXED.** With mocked fetch (fx-probe.txt):
  - EUR 20 at 0.88877 is 22.51 (rounded up).
  - At each band edge, 1% inside is accepted and 2% outside gives FxUnavailableError (EUR, GBP, SGD, INR). AED accepts the peg ±0.99% and refuses ±1.1%, 3.0 and 4.5.
  - `base` EUR or `usd`, rate as a string, 0, negative, 1e-7, a missing row and a non-array all give FxUnavailableError.
  - With "today" = 6 Nov: 7 Nov and 30 Oct are accepted. 8 Nov, 29 Oct, 2026-02-30, `2026-11-5`, a timestamp string, empty, missing and numeric dates are refused.
  - A failure is not cached (503, then success on the next call). The cache lasts 14 min but not 15. USD and USDT never fetch. A fetch that throws, or an HTTP 500, gives FxUnavailableError.
- **Rounding up: FIXED.** Live rate 0.88875 gave `20.00 EUR = 22.51 USDT` (the session and the checkout agree).
- **503 creates nothing:** covered by unit tests. The live outage was not provoked (no safe way to do that).
- **returnUrl: FIXED.** `javascript:`, `JaVaScRiPt:`, tab or newline inside the scheme, a leading control character or space, `data:`, `ftp:`, `//host`, empty, a number, `http:` and a 201-character URL (or a href that grows past 200 after encoding) all give 400. Accepted values are stored and rendered as the parsed href: `https://shop.example/a<TAB>b` renders `https://shop.example/ab`, `HTTPS://Shop.Example/Thanks` renders `https://shop.example/Thanks`, and `a"><script>1</script>` renders percent-encoded, with no script in the DOM. 200 characters exactly is accepted.
- **Idempotency: FIXED.** The same key and body returns the same id. A different body gets 422. A failed 400 frees the key. A 256-character key gets 400. In a scratch copy, a mutant with no cap, one that drops the wrong key, and one that never deletes on failure each fail 1 test (the 1,000-key cap test and the delete-on-failure test).
- **/docs: FIXED.**
  - The CSP header is sent on :3100 and :3101: `default-src 'self'; script-src 'self' 'unsafe-inline'; ... frame-ancestors 'none'`.
  - No 6-character window of the shop key is in the raw HTML, the text or the clipboard. Signed out and as the shop wallet (fake wallet whose address is MERCHANT_ADDRESS) both give 0. As the shop wallet the 8-hex SHA-256 fingerprint is shown. Against the real :3100 key I did not check for 6-character runs (I may not read it).
  - The 4 code blocks are `role=region` with a label ("Code: the pay button snippet", ...) and tabIndex 0. Tab reaches all four. They wrap on a phone and scroll from md up. No overflow.
  - The 4 Copy buttons are named ("Copy the pay button snippet", ...) at 44 px. A `role=status` region announces "Copied the ...". The clipboard holds 190, 516, 553 and 33 characters.
- **/merchant at 375: FIXED.**
  - The night band is 180 px (150 at 1440), with the dither canvas.
  - The top bar is one row: wordmark y40, address y52, Sign out y40, all in one 44 px row.
  - A non-shop wallet sees exactly one notice card (1 mention of the demo-shop text, and no repeat in the Invoices card). The shop wallet sees none.
  - No overflow, no console errors, on all 8 combinations.
- **Checkout, EUR session:** the button reads "Hold to pay 22.51 USDT". The FX line reads "20.00 EUR = 22.51 USDT · rate of 6 Nov 2026 · 1 USDT = 1 USD". The timer reads "9:17 left to pay" with `role=timer` and `aria-live="off"` (the only polite region is the status section). "Pay exactly 22.51 USDT, no more and no less. No fees for you." is shown. FR-PAY-7 scan (strip allow-listed): no gas, wei, nonce, signature, approve, allowance, relayer or 0x… in the body, at both widths, light and dark. No console errors. The expired state (clock shifted) reads "Expired", has no hold button and shows the "Back to Bandra Beans" link, with no overflow.
- **Neutral "0 vs yesterday": FIXED.** It is in `text-ink-muted` (rgb 90,92,110 light, 162,165,185 dark), with no arrow, on all 8 combinations.
- **/payments: FIXED.**
  - The amount comes from the chain. Killed mutants: amount = gross minus refunded (1 test fails), a zero-gross record kept (1 fails).
  - Payment 4 has 99.00 in the index and 25.00 on chain, and the test asserts "25.00" (payments-api.test.mjs:73).
  - The 503 test runs index-down and chain-down separately (:104-110).
  - Live on :3101: 401 with no key, 400 for limit 0, and `{"data":[],"next":null}` with the key.
- **Mutants run this round:** 14 in a scratch copy, 14 killed (FX base, date, band, rounding, date window, returnUrl length, raw value, scheme, payments amount, zero gross, idempotency cap, wrong key dropped, no delete).

## Not verified
- Lighthouse (LCP, INP) is not installed, so it was not measured. Only the NFR-12 JS size was. There is no relayer change, so no p95 run.
- The paid state of an EUR session was not seen (needs a funded payment, which I may not send). The G2 run covers it.
- The 503 when Frankfurter is really down was not provoked live.
- /docs signed in as the shop wallet used a throwaway MERCHANT_ADDRESS, not the real shop wallet.

## Findings
None at HIGH or MEDIUM severity.

1. (info, owner claude-frontend) The `/merchant` shop-wallet view at 375 and 1440 shows 0.00 and "—" because my fake shop has no payments. Real KPI values are not covered here.
2. (info, carried) The nav still says "Soon" for unbuilt items, not "Coming in this build" (components/dashboard/Nav.tsx:61). Confirm the wording with the spec owner.

**PASS**
