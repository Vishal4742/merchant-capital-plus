# Spec: 006-P4-web-gateway-shell

Request (verbatim): "The plan has changed. Check the new plan for frontend and start us building." (human, 02:44) · PLAN v2.0 (human 02:31, via claude-research): stablecoin payment gateway, strictly Whitechain testnet · UI backlog: research_notes/gateway_rea/BACKLOG.md §claude-frontend

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-GW-14: every page shows a "Test mode · Whitechain testnet" badge; no mainnet path exists.
- FR-GW-8: a `/docs` page with a 3-step integration (button, SDK, webhooks), copyable test keys, and a "simulate payment" button in test mode.
- FR-GW-11: the merchant prices in USD, EUR, GBP, INR, AED or SGD. Checkout converts to USDT at a public FX rate (display and quote only), shows the rate and its time, and locks it for the session.
- FR-GW-5 (server side, ours): `GET /api/v1/payments` (Bearer) so the SDK can list payments. The session fields `currency` and `returnUrl` were agreed with claude-sdk at 02:46.
- FR-GW-1 (shared plumbing): the sessions API v2 that links and pages will call (claude-contracts' backend routes create sessions through it).
- NFR-12: /checkout stays ≤ 204,800 B of JS as Chrome downloads it; the FX line is server-rendered.
- NFR-6 / FR-PAY-7: plain words for customers.

## Decisions taken (with sources)
- **FX source: Frankfurter v2,** `https://api.frankfurter.dev/v2/rates?base=usd&quotes=aed,eur,gbp,inr,sgd` (no key; "free to use"; rates update daily; the response row is `{date, base, quote, rate}`).
  - Rejected open.er-api: its terms forbid redistributing rates, which a gateway serving quotes does.
  - Cache per day.
  - **1 USDT = 1 USD**, shown on the checkout ("1 USDT = 1 USD").
  - If the rate can't be fetched, creating a non-USDT session answers 503 "Prices in EUR are unavailable right now" and nothing is created.
- **The quote locks for the session's 30 min:** the session stores `{currency, amount, rate, rateDate, fetchedAt, source}`, and the USDT amount is fixed at creation, **rounded up to the cent** (round 2: matches claude-contracts' quotes module, the single FX source per the human at 05:4x, so the merchant is never short; at most 0.01 USDT above the exact conversion). The stored USDT amount is exactly what the contract charges.

## Acceptance criteria
- [ ] **Test-mode badge** on every page (root layout), customer pages included: "Test mode · Whitechain testnet", visible at 375 and 1440, contrast-checked, `aria-label`. No config path points at a mainnet chain id (a test greps for 1875 and chain-id configs).
- [ ] **Dashboard shell** for the merchant pages: a top bar with the wordmark, badge and account, and a nav with Home, Payments, Links, Pages, Invoices, Vouchers, Reports, Settlements, Capital and Developers. Items whose screens aren't built yet show "Coming in this build" and are not links. It works at 375 (collapsible) and 1440.
- [ ] **`/docs`** (static, public):
  1. a payment button snippet (`<script src=…>` per claude-sdk's FR-GW-4 plan; marked "available when the SDK ships" until claude-sdk publishes it)
  2. an SDK server snippet (create a session with `currency` and `returnUrl`)
  3. webhook verification with claude-sdk's `MC-Signature: t=…,v1=…` format
  - Copy buttons.
  - A "Test keys" box that, for a signed-in merchant, links to the API keys screen. Until FR-GW-6 lands, it shows the local dev key's prefix only, never the key.
  - "Simulate payment" in test mode: creates a demo checkout (the existing `/api/demo-checkout`).
- [ ] **Sessions API v2**:
  - `POST /api/v1/sessions` accepts `currency` (USDT | USD | EUR | GBP | INR | AED | SGD) and `returnUrl` (http/https, ≤ 200 chars; refuses `javascript:` and others with 400).
  - Non-USDT: item prices and the amount are in that currency, converted with the locked quote. The response is `{id, url, amount (USDT), currency, priced:{currency, amount, rate, rateAt, source}, expiresAt}`.
  - `GET /api/v1/sessions/:id` adds `currency`, `priced` and `refunded`.
- [ ] **`GET /api/v1/payments?limit&cursor`** (Bearer): `{data:[{paymentId, sessionId|null, invoiceId|null, amount, refunded, txHash, paidAt, reference}], next}`, from the Paid log index plus `payments(id)` on chain, for MERCHANT_ADDRESS only.
- [ ] **Checkout upgrades** (backlog):
  - the FX line ("20.00 EUR = 22.47 USDT · rate of 5 Nov 2026 · 1 USDT = 1 USD")
  - an expiry countdown (session `expiresAt`, and never past the approval's `validBefore`)
  - "You paid no network fee" on the receipt (plain words for "0 gas")
  - "Pay exactly this amount" note
  - "Back to <shop>" when `returnUrl` is set (paid, confirming and expired states)
  - clear state names
- [ ] Tests (RED first):
  - FX: parse the v2 rows, cache per day, convert and round, the 503 path, every currency
  - sessions v2: currency + returnUrl validation + locked quote
  - payments list: auth, merchant filter, cursor
  - badge on every route (a render test or a build-output grep)
- [ ] typecheck, lint, `npm test` 0 fail, build; NFR-12 for /checkout in Chrome; the FR-PAY-7 / FR-PRIV-1 scan of /checkout and /docs; screenshots at 375 and 1440, light and dark.

## Files (claude-frontend)
- **New:** `apps/web/lib/fx.ts`, `apps/web/components/{TestModeBadge,dashboard/Shell,dashboard/Nav}.tsx`, `apps/web/app/docs/page.tsx`, `apps/web/app/api/v1/payments/route.ts`, tests.
- **Edited:** `apps/web/app/layout.tsx`, `apps/web/app/api/v1/sessions/route.ts`, `apps/web/app/api/v1/sessions/[id]/route.ts`, `apps/web/lib/sessions.ts`, `apps/web/components/Checkout.tsx`, `apps/web/app/checkout/[sessionId]/page.tsx`, `apps/web/app/merchant/page.tsx` (wrapped in the shell).

## Ponytail ladder
- No new dependency: fetch + JSON for FX; a CSS-only collapsible nav; static docs.
- No chart yet: that's the Reports batch (against the reports API).

## Out of scope (later batches)
- Links/Pages/QR (FR-GW-1/2/3), vouchers (FR-GW-12), reports/settlements screens (FR-GW-9/10), API keys and webhooks screens (FR-GW-6/7): all built against claude-contracts' API (shapes proposed at 02:46).
- Private reads + meter (FR-PRIV, scratch b008).
- The Capital tab (P5; scratch b007 + b008).

## Decisions for phase B (03:06, from ARCHITECTURE §4b, the human's 03:02 FX ruling, claude-sdk's review and the phase A builder's questions)
- **FX:** USD = USDT 1:1, said on the checkout. EUR/GBP/INR/AED/SGD use Frankfurter v2, **cached ≤ 15 min** (§4b), with the **quote locked 10 min** (human 03:02). A session priced in a non-USDT currency expires at its quote lock (10 min); USDT/USD sessions keep 30 min. claude-contracts' `/api/v1/quotes` route wraps `lib/fx.ts`.
- **One badge:** a slim test-mode strip in the root layout on every page; the Shell doesn't repeat it. The FR-PAY-7 scan allow-lists the badge text (FR-GW-14 requires it on every page, checkout included).
- **API amounts are plain decimal strings with no thousands separators** (`"1234.50"`, never `"1,234.50"`) in every `/api/v1` response; `formatUsdt` is for display only.
- **`reference` over 40 chars gets a 400** ("reference must be at most 40 characters"), never silent truncation (claude-sdk).
- **`Idempotency-Key` on `POST /api/v1/sessions`** (§4b: sessions only): the same key within 24 h returns the first session; per process until Neon.
- **The create reply's `currency` is the requested currency;** `amount` is always USDT; `priced` is always present for non-USDT.
- **The button snippet uses `data-session` / `data-link`** (§4b); the browser never sets the amount.
- **Carried from 005 round 2** (they touch the same files):
  - code R2-F1: the balance check is skipped while a session is pending (`&& !session.pending`), so a landed earlier attempt shows its receipt
  - code R2-F2: the fake wallet's revert string is TetherTokenV2's "ERC20: transfer amount exceeds allowance"
  - ux N1: the refund prefill uses 2 dp
  - ux N2: the cancel confirm reads "Keep it" and wraps
  - ux N3: the demo message isn't error red
- **Visual direction:** apply the approved gateway v2 demo (design-refs/gateway-v2-demo.html, pending the human's yes) to the Shell and the merchant home.
- **Carried from 005 round-2 security** (owner claude-frontend):
  - F-N1 = code R2-F1, above
  - F-N3: `readUsdtBalance` gets the same at-a-block retry as the other reads
  - F-N4: the home page's `/merchant` links become plain `<a>`, so the CSP applies
  - F-N5: the refund reads `balanceOf` before approving, and any dry-run error it doesn't recognise stops it
  - F-N6: tests for the /pay shop check and the dashboard amount/merchant filter (mutants G1, P1, P2)
- **Round 2 (05:52):** FX sanity bands (security F1, human 05:4x) in USD per unit: EUR 0.5–2, GBP 0.6–2.5, SGD 0.4–1.5, INR 0.005–0.03, AED = the 3.6725 peg ±1%; the rate date is at most 7 days old and never later than tomorrow (UTC). The same limits went to claude-contracts in their convention (units per USD) for their quotes module.
