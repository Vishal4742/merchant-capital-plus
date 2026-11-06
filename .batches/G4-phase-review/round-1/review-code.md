VERDICT: CHANGES

# Code review: G4 phase review, part 1, round 1 (reviewer-code)

One HIGH (finding 1: link and page checkouts round each line up to the cent, so the customer pays more than the locked quote). Three MEDIUM and four LOW go into the same fix batch before G4 is claimed (PIPELINE §3b.3). Nothing here touches the ABI in ARCHITECTURE §2.

## How this was checked
- **Range.** `7b32902..c719cef` under `apps/web` (109 files). c719cef is the commit that opened this review. After `git fetch`, origin/main is at 9c6efc1, which adds batch 012 (0da9b60, b4d4f94, 5bde836, e2f5893). batch.md puts 012 out of scope, so I reviewed c719cef and not the moving HEAD.
- **Read in full at c719cef:**
  - `lib/server/{vouchers,quotes,links,pages,checkouts,events,http}.ts`
  - `lib/{fx,sessions,usdt,qr,gateway-client,gateway-forms,gateway-server,dashboard}.ts` and `readTxFee` in `lib/onchain.ts`
  - `app/api/v1/sessions/{route,[id]/route,[id]/pay/route}.ts`, `app/api/v1/payments/route.ts`
  - `app/checkout/[sessionId]/page.tsx`, `app/{l,p}/[slug]/*`, `app/qr/…`, `app/counter/…`, `app/merchant/{links,payments}/page.tsx`
  - `components/gateway/{Links,Hosted,Share}.tsx`, plus the diffs of everything else
- **Prior reviews read:** 006 round-2 review-code, 009 review-security and 010 ci.md (its security F2).
- **Commands, in a scratch copy of c719cef** (`git archive`, no `.env*`, node_modules linked):
  - `npm test`: **349 tests, 348 pass, 0 fail, 3 skipped**. The first run failed gw-sdk-compat only because my copy lacked `packages/sdk`; with it, that file passes 3/3.
  - `npx tsc --noEmit` (after `next typegen`): exit 0.
- **Probes:** `/private/tmp/claude-501/-Users-vg890-ethglobal/c228f97f-b195-421b-9239-2d869ad69e8e/scratchpad/g4p1/apps/web/test/zz-probe.test.mjs`. All 5 pass, confirming P1–P5 below. Output:
  ```
  PROBE P1 page: 22520000n quote: 22510000n
  PROBE P2 link amount: 10.123456 session amount: 10130000n
  PROBE P3 statuses: 303 303 true
  PROBE P4 a week later: { ok: false, reason: 'That code has been used up.' } HOLD_MS 2700000
  PROBE P5 expired at true apply: true
  ```

## HIGH

### 1. Link and page checkouts round each line up, not the total, so the customer pays more than the quote (P1). USDT prices also get rounded (P2).
- **Where:** `lib/server/links.ts:48-52` (`inUsdt`), `:76-77` (`amount = Σ ceil(price_i) × qty_i`), `:89`. The test that pins the wrong number is `test/gw-pages.test.mjs:181-182`.
- **What:**
  - **P1.** A page with 2 × 10.00 EUR at 0.88875 charges **22.52 USDT**, but `createQuote("20.00", "EUR")` gives **22.51**.
  - The pages test asserts 20.96 USDT for 16.75 EUR at 0.8. The exact value is 20.9375, which rounds up to 20.94.
  - The overcharge grows with quantity. One item priced "0.001" × 100 is about 0.11 USD of goods and is charged 1.00 USDT, which also lifts a cart below the 1 USDT minimum over it.
  - **P2.** Since batch 008, `toUsdtUnits` rounds up to the cent, and `usdRate("USDT")` is 1/1. So a USDT link priced 10.123456 now charges 10.13. Before 008 it rounded to the micro-unit, which was a no-op. The SDK path charges USDT exactly (`lib/fx.ts:105`).
- **Why:**
  - §4b says amounts round up to the cent and "the customer pays at most 1 cent more".
  - AT-13 says "the USDT paid matches the locked quote".
  - The checkout's FX line then reads "16.75 EUR = 20.96 USDT · rate of …", which implies a different rate from the one it was charged at.
  - This is wrong money, so it blocks (§3a.1).
- **Fix:** convert the total once and leave USDT exact. Then `inUsdt` can be deleted.
  ```ts
  const rate = await usdRate(currency);
  const fiatTotal = priced.reduce((sum, item) => sum + item.price * BigInt(item.qty), 0n);
  const amount = currency === "USDT" ? fiatTotal : toUsdtUnits(formatUnits(fiatTotal, 6), rate);
  // items: always `priced` (USDT items are already exact)
  ```
  Tests:
  - `gw-pages.test.mjs:182` → `20_940_000n`
  - add "2 × 10 EUR equals `createQuote` of 20 EUR (22.51)"
  - add "a 10.123456 USDT link charges 10.123456"
- **Owner:** claude-contracts.

## MEDIUM

### 2. There are still two FX modules (006 round-2 item 2, still open), and they have drifted.
- **Where:**
  - `lib/fx.ts` serves `app/api/v1/sessions/route.ts:6,97` (the SDK path) and `lib/sessions.ts:5` (types).
  - `lib/server/quotes.ts` serves links, pages and `/api/v1/quotes`.
- **What differs today:**
  - **Band edges.** EUR is 0.7554375–1.0220625 in `fx.ts:27-33` and 0.7555–1.0221 in `quotes.ts:22`. SGD is 1.08579–1.46901 against 1.0858–1.469. GBP and INR differ the same way.
  - **Partial answers.** `fx.ts:95-96` makes all five currencies unavailable if one row is bad; `quotes.ts` decides per currency.
  - **Outages.** `quotes.ts:88` serves the stale cache; `fx.ts` answers 503.
  - **`priced.source`.** "frankfurter.dev" and "1 USDT = 1 USD" on one path, "Frankfurter (ECB and central-bank reference rates)" and "USD = USDT 1:1" on the other.
  - **Fetches.** Two caches mean two Frankfurter fetches.
  - **The test can't catch it.** `test/gw-quotes.test.mjs:131` is titled "the same numbers claude-frontend uses", but it asserts a literal, so the drift goes unnoticed.
- **Why:** §4b says one FX source, and that `lib/fx.ts` "is a bridge until PR #11, then deleted". PR #11 is the base of this range.
- **Fix (Ponytail rung 2: the module already exists):**
  1. The sessions route calls `usdRate` + `toUsdtUnits` and passes `HttpError(503).message` through as its 503. Combined with finding 1, both paths then charge the same cent.
  2. `lib/sessions.ts` takes `Currency` from `lib/server/http.ts`.
  3. Delete `lib/fx.ts`, `test/fx.test.mjs` and `test/fx.live.test.mjs`, after moving the live check onto `quotes.ts`.
- **Owner:** claude-contracts for the sessions route; claude-frontend for deleting `lib/fx.ts` and its tests and for the `lib/sessions.ts` import.

### 3. A "pays once" link can still be paid twice (007 security L7, still open) (P3).
- **Where:** `lib/server/links.ts:207-215`. `payLink` checks `linkStatus` only when a checkout opens. Nothing checks it again at pay time.
- **What:** two posts to the same single-use link both get a 303 to two separate live sessions. A customer who goes back and presses "Continue to pay" again ends up with two payable checkouts.
- **Why:**
  - FR-GW-1 is "single or reusable".
  - The README's AT-11 line showcases "a 25 USD pays-once link".
  - The money can be refunded, but it is a duplicate charge.
- **Fix:** add one guard in the gateway's pay-time call, the place every pay path goes through. In `claimAmountDue`, or a sibling the pay route calls first, refuse with a 410 ("This payment link has been paid.") when the session's link is `single_use` and another checkout of the same link has `paid_at`. Test: open two checkouts, mark one paid, and the other is refused.
- **Owner:** claude-contracts (the guard, plus the pay route's mapping of the refusal).

### 4. The hosted pages and dashboard lists call our own API over HTTP. The preview scaffolding and response parsing built for that can now go (010 security F2, still open).
- **Where:**
  - `lib/gateway-server.ts:3-5,20-34`: its own ponytail note gives the upgrade trigger "once it is on main", and that happened at 7b32902.
  - `lib/gateway-preview.ts` (98 lines of fixtures "before claude-contracts' backend is on main").
  - `lib/gateway-client.ts`: 226 lines that re-validate our own JSON. The 404 mapping at `:173` ("routes aren't on this server yet") is stale.
- **Why:**
  - **(a)** Every `/l`, `/p` and `/counter` view, and every dashboard list, costs a second request to ourselves.
  - **(b)** On Vercel the public routes see our server's address, so every payer shares one `checkout:<ip>` bucket of 20 a minute (`links.ts:29,55`). The 21st checkout site-wide in a minute gets "Lots of people are paying right now".
  - **(c)** `selfOrigin()` calls `https://$VERCEL_URL`, the per-deployment URL. If Deployment Protection covers that URL on the web project, the self-call gets Vercel's login page, and every hosted page says "We can't open this link right now". I did not check the project settings; whoever owns the web project should check before the demo.
- **Fix (rung 2: `lib/server` already has the functions):**
  - Server components call `linkBySlug`/`publicLinkJson`, `pageBySlug`/`publicPageJson`, `listLinks`/`linkJson` and `listPages`/`pageJson` directly.
  - `/l/[slug]/checkout` and `/p/[slug]/checkout` call `payLink`/`payPage` with the incoming request, so `clientIp` sees the payer.
  - Then delete `gateway-preview.ts`, `previewOn`, `previewFetch`, `selfOrigin`, `gatewayFor`, and the response parsers only the server used. Keep the browser's create and cancel calls.
- **Owner:** claude-frontend.

## LOW
5. **FR-GW-11 "shows the rate": the checkout shows the converted amounts and the rate's date, but not the rate.**
   - Where: `app/checkout/[sessionId]/page.tsx:26-33`.
   - The line "20.00 EUR = 22.51 USDT · rate of 6 Nov 2026" never says 0.88875.
   - Fix: add `· 1 USD = ${p.rate} ${p.currency}` to the line.
   - Owner: claude-frontend.
6. **FR-GW-10 as written vs as built.**
   - The SRS puts the merchant-only network-fee column on Settlements, taken "from the `/relay` response's `gasCostWei`".
   - What was built is a column on `/merchant/payments`, read from the receipt (`lib/onchain.ts:56-65`: gasUsed × effectiveGasPrice + l1Fee). `whitechainSepolia` spreads viem's OP-stack `chainConfig`, so `l1Fee` is filled. The receipt is the better source, since the chain is the truth and it works for log-index rows.
   - No Settlements screen exists at c719cef (`components/dashboard/Nav.tsx:20` is a placeholder).
   - Fix: claude-research rewords FR-GW-10 ("from the transaction receipt"), and the Settlements screen (part 2) reuses `readTxFee`/`formatWbt`.
   - Separately, `app/merchant/payments/page.tsx:27,70,85`: rows past the newest 50 get no fee by design, but the line says their fee "couldn't be read just now". Say "the fee of N older payments isn't shown".
   - Owner: claude-frontend, plus claude-research for the SRS.
7. **A fiat link or page can be created that can never be paid.**
   - `createLink` and `createPage` accept fiat prices up to 100,000,000 (`links.ts:27,176`). The 1–1,000 USDT rule runs only at checkout.
   - A fixed link's 400 then maps to "This can't be paid any more. Ask the shop for a new link." (`lib/gateway-forms.ts:139`), although the link was never payable.
   - The dashboard form checks the range for USD only (`gateway-forms.ts:65`).
   - Fix: at create, when a rate is available, refuse a fixed fiat price whose USDT is outside 1..1,000, using the same `usdRate` + `toUsdtUnits` call the checkout makes.
   - Owner: claude-contracts, with claude-frontend for the form message.
8. **Stale comments.**
   - `components/Checkout.tsx:37` still says "22.50 USDT · rate of 5 Nov".
   - `lib/gateway-client.ts:173`.
   - `lib/gateway-server.ts:3-5`.
   - Owner: claude-frontend.

## Already tracked and still open at c719cef (no new finding; listed so the fix batch has one list)
- **Security 009 F2 (P4):** a frozen hold whose payment never lands keeps a 1-use code "used up" with 0 redemptions; in my probe it was still blocked a week later. I agree with that review that `vouchers.ts` should keep the rule and the routes should release the hold (`settlePending`'s "open" branch, and every refusal before the relay).
- **Security 009 F4 (P5):** a code still applies to a 10-min EUR checkout 15 minutes in, because `vouchers.ts:188` uses the 30-min `SESSION_TTL_MS`. The apply route should check `session.expiresAt`.
- **Security 009 F6:** the stale-cache fallback (`quotes.ts:87-89`) doesn't back off, so each fiat checkout during an outage waits for the 5 s timeout.
- **Security 009 F1 and F3:** nothing calls `claimAmountDue`, `releaseHold` or `onSessionPaid` at c719cef (grep over `app/` and `lib/`). At the part-1 head:
  - a single-use link never turns "paid" and every link and page shows 0 payments (FR-GW-1 "status and payments"; AT-11 "the link shows Paid");
  - no customer can apply a voucher at checkout (FR-GW-12).

  origin/main's batch 012 covers part of this (b4d4f94 `announcePaid`; `events.ts` now takes `paidAmount`). Part 2 has to verify it end to end.

## Checked and OK
- **Vouchers (FR-GW-12):**
  - `claimAmountDue` freezes and prices in one `UPDATE … RETURNING`. It is idempotent through `COALESCE(frozen_at, $2)`.
  - `applyVoucher`'s pre-check plus the `frozen_at IS NULL` guard on the upsert refuse a switch while the hold is frozen.
  - `releaseHold`'s `WHERE` is narrow.
  - `HOLD_MS` = TTL + 15 min.
  - The tests assert the S1 PoC, idempotency, the lapsed hold, null for a shop session, and that a frozen hold still counts.
  - `db.ts` pins READ COMMITTED. The vouchers route rate-limits after validation.
- **Rounding and bands (FR-GW-11):**
  - `toUsdtUnits` = ⌈A·den / (num·10⁴)⌉·10⁴ is an exact bigint ceiling to the cent, the same formula as `fx.ts` `toUsdt`.
  - 20 EUR at 0.88875 → 22.51, and 36.725 AED → 10.00.
  - The bands are inclusive and refuse flipped EUR, GBP and SGD rates.
  - `freshDate` is re-checked at use (S3).
- **The 10-minute lock:**
  - The sessions route (`QUOTE_LOCK_MS`) and `openCheckout` (`QUOTE_TTL_MS`) both give 600,000 ms for EUR, GBP, INR, AED and SGD, and 30 min for USD and USDT. The tests assert `expiresAt − createdAt`.
  - `getQuote` expires at exactly 10 min.
  - The pay route refuses `validBefore > expiresAt` (`pay/route.ts:53`).
- **006 round-2 follow-ups:**
  - Fixed: 1 (the 1,000 USDT cap: `sessions/route.ts:102-105`, `Invoices.tsx:39`), 3 (priced link and page sessions), 4 (idempotency `finally`, `sessions/route.ts:50`), 8 (/docs wordmark is now `<a>`), and the "22.50" comment in `page.tsx`.
  - Still open: 2 (finding 2).
- **QR (FR-GW-3):**
  - `uqr` is server-only; `Share.tsx` imports a type only.
  - `qrTarget` allow-lists l, p and pay with the slug and invoice regexes.
  - The SVG is served with `default-src 'none'`.
  - The counter page reads every figure on our server, and its invoice total (owed + fee) matches `InvoicePay`.
- **Network fee:** `formatWbt` never shows an exponent and shows dust as "<0.000001". The fee appears on merchant pages only.
- **CSP:**
  - /l, /counter and /merchant/:path* get the strict CSP.
  - /p and /merchant/pages get `img-src https:` last, and in Next the last match wins.
  - The `replace` target string exists in `PAY_PAGE_CSP`.
- **ABI §2:** no contract, event or argument changes. The `indexedLogs` `eventName` check is a correctness fix.
- **Scope:** every change traces to the spec's IDs or to the 006/008 review follow-ups, with one exception. Batch 009-P4-web-landing (`components/landing/*`, `app/page.tsx`, `lib/dither.ts`) is in the commit range but not in this spec's IDs or batch.md's list. I did not review it for correctness; it has no money code, so it belongs to the UX reviewer.

## NEEDS THE USER
- None. Finding 4(c) needs whoever owns the web Vercel project to look at Deployment Protection for the `VERCEL_URL` deployment URL.
