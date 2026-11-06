# Spec: 015-P4-web-voucher-pay

Request: PLAN v2.0 (human 02:31), claude-research 06:46 list ("vouchers, FX switch to the backend quotes module"), claude-contracts 07:56 (batch 009 on main, PR #14, with the F1–F3 rules from their security review). Phase mode, **Money: yes**.

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-GW-12: the customer applies a discount code at checkout. Redemptions are counted on our server: the use is frozen at pay time and confirmed when paid. AT-12.
- FR-GW-11: one FX source. The sessions route prices through claude-contracts' `lib/server/quotes.ts` (±15% bands, 7-day date, rounding up to the cent). `lib/fx.ts` and its tests are deleted (human 05:4x: "lib/fx.ts as a bridge until their PR merges, then deleted"). AT-13.
- FR-PAY-7 / NFR-6 on the code field; NFR-4/NFR-12 unchanged.

## Sources (read them before writing code)
- `/Users/vg890/ethglobal-backend/.batches/009-P4-gateway-s1-fx-priced/round-1/review-security.md`: F1, F2, F3, F5. This is the contract you build to.
- `apps/web/lib/server/vouchers.ts`: `applyVoucher`, `claimAmountDue`, `releaseHold`, `amountDue`. `lib/server/checkouts.ts`: `checkoutOf`. `lib/server/events.ts`: `onSessionPaid`; claude-contracts' batch 010 adds a 2nd `paidAmount` parameter, so call it as `onSessionPaid(session, amount)` and if the current signature has one param, pass through `lib/announce-paid.ts` in a way that works with both. `lib/server/quotes.ts`.
- The current pay route `app/api/v1/sessions/[id]/pay/route.ts`, `lib/settle.ts`, `lib/sessions.ts`, `lib/relay.ts`, `lib/announce-paid.ts`, `components/Checkout.tsx`, `app/checkout/[sessionId]/page.tsx`.

## Acceptance criteria
- [ ] **Pay route order, for a link/page checkout** (`checkoutOf(id)` non-null; a shop's own session keeps today's path):
  1. session checks
  2. `parseApproval`
  3. `validBefore ≤ expiresAt`
  4. `claimPayment` (the in-flight lock)
  5. `settlePending` must be "open"
  6. `price = await claimAmountDue(id)`
  7. `verifyTypedData` against the claimed `price`
  8. balance check against `price`
  9. `relaySale` with exactly `price`
- [ ] **`releaseHold(id)` only while holding the in-flight lock, by the attempt that claimed, and only:**
  - (i) on a refusal after the claim but before the relay: bad signature, not funded
  - (ii) on a relayer answer that isn't unknown: BUSY 503/429, other 4xx. For a refused 422, only after `findPayment(…)` with the attempt's price returned exactly `null`. `undefined` is a failed read: keep it frozen. A found payment: keep it frozen and record it.
  - (iii) in `settlePending`'s "open" branch (validBefore + 60 s has passed, and the chain says not paid)
- [ ] **Never release on:** unknown, a 200 without chain confirmation, a 409, STILL_PENDING, or a paid session.
- [ ] **One charged price per attempt.**
  - `session.pending` stores `amount: price`.
  - `saleSettled` and `findPayment` compare against `pending.amount` (or `session.amount` when there is no claim), never a re-claimed price.
  - `recordPayment` stores the paid amount.
  - `announcePaid(session, price)` → `onSessionPaid(session, price)` on the relay success path, the 422 `findPayment` path, and `settlePending`.
- [ ] **`POST /api/v1/sessions/:id/voucher {code}`** (and `DELETE` to remove):
  - Link/page checkouts only; others get 404 "Codes work on payment links and pages".
  - Open checkouts only: 410 for expired or paid.
  - Refused with 409 "Finish or wait for the current payment first" while `isInFlight(id) || session.pending || session.payment` (F5).
  - Rate-limited per IP + session.
  - Calls `applyVoucher(merchant, code, id, checkoutOf(id).usdtAmount)` with the ORIGINAL amount. The reply holds the new amount due and the discount.
  - Plain copy for each `reason`.
- [ ] **Checkout UI** (`components/Checkout.tsx` + the page):
  - "Have a discount code?" disclosure, then a code input and "Apply" / "Remove".
  - Server-rendered "Discount −2.50 USDT · You pay 22.50 USDT". The hold button shows the amount due.
  - The amount the customer signs is the current amount due: fetch it from the server right before signing, never from stale client state.
  - No crypto words. NFR-12 stays ≤ 204,800 B for /checkout.
- [ ] **FX switch:**
  - `app/api/v1/sessions/route.ts` prices non-USDT sessions with `lib/server/quotes.ts`; read it for the exact server-use function.
  - `priced` = its `pricedJson` shape; the 10-minute lock is kept.
  - Delete `lib/fx.ts`, `test/fx.test.mjs` and `test/fx.live.test.mjs`. Move any still-needed session-level assertions into sessions-v2.
  - The checkout FX line still renders.
- [ ] **Tests (RED first), including F1's named test:**
  - apply A → claim → 422 with the order paid on chain → no release → apply B is refused → confirm counts A
  - a bad signature after the claim releases the hold
  - unknown (5xx) never releases
  - BUSY releases
  - 422 + `findPayment` null releases; `findPayment` undefined keeps it frozen
  - settle "open" releases; settle "paid" records with the claimed price
  - an apply during in-flight or pending gives 409
  - the signed amount must equal the claimed price
  - the FX route on quotes.ts (bands, 503 on no rate)
  
  Use PGlite through `test/gw-helpers.mjs`, like the backend's tests.
- [ ] typecheck, lint, `npm test`, build; Playwright on a link checkout with a code (preview fixtures or PGlite), at 375 and 1440.

## Files
- `app/api/v1/sessions/[id]/pay/route.ts`
- `app/api/v1/sessions/[id]/voucher/route.ts` (new)
- `app/api/v1/sessions/route.ts`
- `lib/settle.ts`, `lib/sessions.ts`, `lib/announce-paid.ts`
- `components/Checkout.tsx`, `app/checkout/[sessionId]/page.tsx`
- deletes: `lib/fx.ts`, `test/fx*.test.mjs`
- tests

## Out of scope
- Invoices (no vouchers on invoices).
- The merchant Vouchers screen (batch 013).

## Added during the build
- The checkout FX line shows the rate itself (G4 code review LOW): "20.00 EUR = 22.51 USDT · 1 USD = 0.88875 EUR, rate of 6 Nov 2026 · 1 USDT = 1 USD".
- `onSessionPaid` takes `paidAmount` (claude-contracts PR #16/#17). `announcePaid(session, paidAmount)` passes it, and `Payment.amount` stores it for re-announces and receipts. This also unblocks claude-contracts' PR #17, whose CI fails on the old one-argument call.
- The receipt (/r/[id]) shows the paid amount, so a discounted payment isn't shown at full price.
