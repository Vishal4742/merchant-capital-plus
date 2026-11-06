# Round 2 build (claude-frontend, 05:58)

Builder: a developer subagent in scratch b009. It was copied into apps/web at 05:57; the 17 files are listed below, and `diff -rq` is empty apart from package.json and its lock, which now come from main.

Main moved during the round: PR #11 (claude-contracts' gateway backend: app/api/v1/{keys,links,pages,public,quotes,reports,settlements,vouchers,webhooks}, lib/server/*, db/*) and PR #9 (claude-sdk's public/v1/button.js) merged. Neither touched these 17 files. `npm ci` was run against main's lock.

## Files changed in round 2 (relative to apps/web)
- M next.config.ts
- M app/api/v1/payments/route.ts
- M app/api/v1/sessions/route.ts
- M app/docs/page.tsx
- M app/merchant/page.tsx
- M components/Checkout.tsx
- M components/CopyButton.tsx
- M components/HoldButton.tsx (comment only)
- M components/InvoicePay.tsx
- M components/dashboard/Shell.tsx
- M lib/config.ts
- M lib/fx.ts
- M lib/sessions.ts
- A test/config.test.mjs
- M test/fx.test.mjs
- M test/payments-api.test.mjs
- M test/sessions-v2.test.mjs

## Round-1 findings, and what changed
### Security
- **F1 (FX sanity limit, human 05:4x).** lib/fx.ts has a band table, in USD per unit: EUR 0.5–2, GBP 0.6–2.5, SGD 0.4–1.5, INR 0.005–0.03, AED the 3.6725 peg ±1%.
  - A rate is refused unless it is quoted against USD.
  - The rate date must be a real YYYY-MM-DD (it must round-trip), at most 7 days old and at most tomorrow (UTC).
  - Anything outside these raises FxUnavailableError: 503, nothing created, nothing cached.
- **F3.** /docs now sends the strict CSP.
- **F4.** webUrl() in lib/sessions.ts returns the parsed href, only for http/https and at most 200 characters measured on the href. createSession enforces it too; the route answers 400.
- **F5.** /docs shows no character of the key, only a SHA-256 fingerprint of 8 hex characters, and only to the shop wallet. GATEWAY_URL comes from publicOrigin(): the new optional env PUBLIC_ORIGIN when it is http(s), else the request's Host.
- **F6.** The idempotency store holds at most 1,000 keys, dropping the oldest. A key is deleted in `finally` when the create throws or doesn't return 201.
- **F7.** Comments mark txHash, invoiceId and paidAt in /payments as index data.

### Rounding (05:52, to match claude-contracts' quotes module, the single FX source)
toUsdt now rounds UP to the cent, in exact bigint maths. EUR 20 at 0.88877 is 22.51.

### Code
- **M1.** The /payments 503 test now runs index-down and chain-down separately, and checks that the chain reads were reached.
- **M2.** Payment 4 has 99.00 in the index and 25.00 on chain; the test asserts "25.00". A new test leaves out a gross-0 chain record.
- **L13.** A missing clipboard API falls back to the prompt instead of throwing.
- **L14.** The countdown timer has aria-live off.

### UX
- **F1.** The night band is 180 px at 375 (150 from md up), with a lighter wash. The phone top bar keeps everything on one row.
- **F2.** The buttons read "Hold to pay 22.51 USDT", on the checkout and on /pay.
- **F3.** /docs code blocks wrap on a phone and scroll from md up. Each is a focusable named region.
- **F4.** The Copy buttons have specific names, and a separate role=status region announces the copy.
- **F5.** A non-shop wallet sees one notice card.

### Tester follow-ups
- A zero change shows a neutral "0 vs yesterday" (no arrow, no colour).
- The /docs wording no longer promises a key.

## Checks in apps/web after the copy
- typecheck 0, lint 0
- `npm test`: 293 tests, 290 pass, 0 fail, 3 skipped (LIVE). This includes the backend's gw-* tests.
- build 0. During page generation the build logs "gateway api error: Error" 6 times, from the backend's routes with no database configured locally. That belongs to claude-contracts, not this batch.
- :3100 restarted with this build at 05:58.

Builder screenshots (375, light and dark): /private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/b009/shots/r2/
