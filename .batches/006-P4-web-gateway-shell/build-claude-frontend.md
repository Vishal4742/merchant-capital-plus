STATUS: READY

# Build report: 006-P4-web-gateway-shell (claude-frontend), round 1

Built by a developer subagent in scratch b009 in two phases. Phase A: new files only. Phase B: on fresh main 572054b, after 005 merged. claude-frontend copied it in (`diff -rq` empty), switched `/api/v1/payments` to the shared `plainUsdt`, and ran the checks.

## DONE
- **FR-GW-14:** a "Test mode · Whitechain testnet" strip in the root layout on every page, rendered once (the Shell doesn't repeat it). A test greps sources for mainnet (1875 / viem `whitechain`); the only non-1874 chain is lib/anon.ts's Nym bootstrap read on Ethereum mainnet.
- **FR-GW-8:** `/docs`, partially prerendered.
  - 3 steps with copy buttons: the button with `data-session`/`data-link` at `/v1/button.js` (claude-sdk's file); the SDK server snippet with `currency` + `returnUrl`; webhook verification with `MC-Signature`.
  - The Test keys box never shows a key.
  - "Simulate a payment" is a POST to `/api/demo-checkout`.
- **FR-GW-11:** `lib/fx.ts`.
  - Frankfurter v2, no key, cached ≤ 15 min.
  - 1 USDT = 1 USD.
  - The quote locks 10 min; non-USDT checkouts expire at 10 min, USD/USDT at 30.
  - Exact bigint maths, rounded half up to the cent.
  - The 503 path: "Prices in EUR are unavailable right now"; nothing is created.
- **Sessions v2** (agreed with claude-sdk):
  - `currency`, echoed as the requested currency; `amount` is always USDT; `priced {currency, amount, rate, rateAt, source}` for every non-USDT currency including USD.
  - Item prices in that currency.
  - `returnUrl` (http/https, ≤ 200, else 400).
  - A `reference` over 40 characters is a 400.
  - Plain amounts from one formatter (`plainUsdt`: never rounded, at least 2 dp, no separators).
  - `Idempotency-Key`: per process, 24 h; the same key and body returns the first session; a different body gets 422; two at once create one.
  - GET adds `currency`, `priced` and `refunded` (on chain).
- **FR-GW-5:** `GET /api/v1/payments?limit&cursor` (Bearer). Ids from the Paid index; only the page's ids are read on chain; other merchants' rows are dropped; 503 rather than a partial list.
- **Checkout upgrades:**
  - the FX line (server-rendered)
  - a countdown (`role=timer`, ends 30 s before expiry)
  - the states Expired / Paying / Confirming / Paid
  - "Pay exactly …"
  - "You paid no network fee", and Network fee / Price rows on `/r`
  - "Back to <shop>"
  - the approval never outlives the checkout: `signSale` clamps `validBefore`, and the route refuses later ones (after settle and the 410)
- **Merchant home in the approved v2 design** (design-refs/gateway-v2-demo.html, human 03:08):
  - the sidebar Shell (a details-menu top bar at 375)
  - the dithered night band (2D StaticScene) with "Tonight at Bandra Beans."
  - 6 KPI tiles from real data, or "—"
  - the ASCII reveal (off under reduced motion)
  - the gross-volume SVG with the halftone fill and a CSS-only 7/30-day switch
  - quick actions
  - the CSS `linear()` spring on cards
  - `lib/dashboard.ts` with tests
- **Carried from 005 round 2:**
  - R2-F1: the balance check is skipped while pending
  - R2-F2: TetherTokenV2's revert string
  - F-N3: balance retry
  - F-N4: plain `<a>` to /merchant
  - F-N5: `balanceOf` before approving; only the allowance revert proceeds
  - F-N6: dashboard filter tests, plus a /pay gate source-order test
  - N1: 2-dp prefill
  - N2: "Keep it" and wrapping
  - N3: the warning tone for the demo message
- **claude-contracts' indexedLogs bug** (viem's `decodeEventLog` ignores `eventName`): fixed, with a test that fails without the guard.

## Verified
- apps/web: typecheck 0 · lint 0 · `npm test` **179 pass**, 3 skipped (LIVE), 0 fail · build 0 (`◐ /docs`, `ƒ /api/v1/payments`).
- Builder: live FX passes (100 EUR → 112.51 USDT, rate 0.88879 of 2026-11-05).
- **On :3100, an EUR session:** amount "22.50", currency "EUR", priced `{amount "20.00", rate "0.88879", rateAt "2026-11-05", source "frankfurter.dev"}`, expires in 10 min. `GET /api/v1/payments` 200.
- **Builder's browser run:**
  - 16/16 shots fit at 375 and 1440 (scrollWidth, plus every card's right edge)
  - no console errors
  - the strip shows once on every route
  - /checkout EUR JS 191,141 B ≤ 204,800
  - the FR-PAY-7 scan clean, with the strip allow-listed
  - the merchant home with real chain data (gross today 156.10, payments 8, fees 0.80)
  - the expired state with "Back to Bandra Beans"

## Open, with other lanes
- **FX ownership:** claude-contracts (03:17) wants quotes in their backend. Proposed at 03:43: sessions keep `currency` and call their `createQuote` once lib/server/quotes.ts is on main; `lib/fx.ts` is deleted then.
- **API casing:** contracts' routes are snake_case; mine are camelCase. Raised with claude-research.
- **Not in this batch:** `source?`/`voucher?` session fields (claude-contracts keys by session id).

## Not verified
- Lighthouse isn't installed (lab substitute).
- Real-device assistive tech.
- Sign-in on 127.0.0.1 (pre-existing: the SIWE domain is the request's host; use localhost).
