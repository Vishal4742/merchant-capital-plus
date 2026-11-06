# Spec: 013-P4-web-money-screens

Request: PLAN v2.0 (human 02:31) · "start us building" (02:44) · PHASES P4 `F` · UI backlog (research_notes/gateway_rea/BACKLOG.md §claude-frontend)

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-GW-12: the merchant creates codes (percent or fixed off, expiry, usage limit), and the customer applies one at checkout. Each code is an Arkiv entity that expires with the code (claude-contracts' `vouchers.ts` writes the mirror with `lib/arkiv.ts`). Redemptions are counted on our server (in `onSessionPaid`).
- FR-GW-9: gross, net, fees, refunds and payment count by day for a chosen date range, a sales chart and CSV export.
- FR-GW-10: a page listing each payment's settlement to the merchant wallet with its transaction link, showing that settlement is instant (T+0).
- AT-12 (two items on a page with a code → reduced price, Arkiv entity, use count +1), AT-11 (report + settlement include the payment), AT-15 (report totals and CSV match the chain).
- FR-PAY-7 / NFR-6 on the checkout's code field; NFR-12 (the checkout stays ≤ 204,800 B as Chrome downloads it).

## Contract (claude-contracts' API.md, batch 007; the tz param and amountDue from their 05:51 message)
- Vouchers:
  - `POST /api/v1/vouchers {code, kind, value, expires_at, max_redemptions, min_amount?}` → 201
  - `GET /api/v1/vouchers` → `{vouchers}`
  - `POST /api/v1/vouchers/{id}/deactivate`
  - voucher = `{id, code, kind, value, expires_at, max_redemptions, times_redeemed, min_amount, active, arkiv_entity_key}`
  - Server: `applyVoucher(merchant, code, sessionId, originalUsdtAmount)` → `{ok: true, discount, usdtAmount} | {ok: false, reason}`. Pass `checkoutOf(id).usdtAmount`, never a discounted amount.
- Reports:
  - `GET /api/v1/reports?from&to&tz=Asia/Kolkata` → `{from, to, days: [{date, gross, fees, net, refunds, count}], totals, kpis: {new_payers, returning_payers}}`
  - `GET /api/v1/reports.csv?from&to&tz`
- Settlements: `GET /api/v1/settlements?from&to` → `{balance, settlements: [{payment_id, gross, fee, to_investors, net, tx_hash, settled_at, explorer_url}]}`

## Acceptance criteria
- [ ] **`/merchant/vouchers`:**
  - Create form: code (3–32, A–Z 0–9 _ -, uppercased as typed); percent or fixed USDT off; value; expiry; usage limit; optional minimum order.
  - List: code, "10% off" / "5.00 USDT off", used n of m, expires, active, and the Arkiv entity key (short, with copy). If batch 003 recorded an Arkiv explorer URL, it's linked; otherwise it isn't.
  - Two-step deactivate.
- [ ] **Checkout code field** (link and page sessions only, i.e. `checkoutOf(id)` non-null):
  - "Have a discount code?" disclosure, then a code input and "Apply". The new total is server-rendered: "Discount −2.50 USDT · You pay 22.50 USDT".
  - One code per session; a second code replaces the first, always computed from the original amount; "Remove" restores the original.
  - **Refused while a payment is in flight or pending** (`isInFlight` / `session.pending`): "Finish or wait for the current payment first". The amount the customer signs is the amount the session holds at signing.
  - Plain copy for each `reason` (expired, used up, below the minimum, unknown code), with no crypto words.
- [ ] **`POST /api/v1/sessions/:id/voucher {code}` (mine):**
  - Open sessions only (404 unknown, 410 expired/paid); rate-limited per IP + session.
  - Calls `applyVoucher` with the original USDT amount, then sets the session's amount (and a `discount {code, amount}` field shown in `GET /api/v1/sessions/:id`).
  - `DELETE` removes the code.
  - Tests: ok, each reason, in-flight 409, pending 409, applying twice doesn't stack, remove restores, a shop's own session gets 404 "Codes work on payment links and pages".
- [ ] **The charge is frozen with the price (claude-contracts 06:19, their security S1).**
  - The pay route never reads `amountDue()` and then relays: a second apply could switch the hold mid-payment, so a single-use code is never counted.
  - Use `claimAmountDue(sessionId)` from their batch 009. It reads the price and freezes the hold in one statement.
  - Flow: claim → relay exactly that amount → `onSessionPaid(session)` with `session.amount` = that amount. `applyVoucher` refuses a frozen (paying) checkout.
  - Tests: an apply during a payment is refused, and the relayed amount equals the claimed amount.
- [ ] **`/merchant/reports`:**
  - A date range (default the last 7 days in IST; max 92 days, said before the request); `tz=Asia/Kolkata`.
  - Tiles: gross, fees, net, refunds, count, new and returning payers.
  - A daily chart reusing `components/dashboard/GrossChart.tsx` (one series; follow the dataviz skill); a day table; "Download CSV" → `reports.csv` with the same range and tz.
  - Empty range: "No payments in these days".
- [ ] **`/merchant/settlements`:**
  - The balance, then a list: time, gross, fee, to investors (0.00 unless an advance is open), net to you, and the transaction link.
  - A plain T+0 line: "Each payment settles to your wallet in the same transaction, the moment it's paid."
- [ ] **Nav:** Vouchers, Reports and Settlements become links.
- [ ] Every screen: a 404 → "not available on this server yet"; 401 → sign-in; plain errors otherwise.
- [ ] **Tests (RED first):**
  - client parsing of vouchers, reports and settlements
  - the voucher route (above)
  - the voucher code check
  - the report range check (≤ 92 days, from ≤ to, IST default)
  - CSV link building
  - the tile maths shows what the API sends (no client re-maths)
- [ ] typecheck, lint, `npm test` 0 fail, build; NFR-12 for /checkout in Chrome; the FR-PAY-7 scan of /checkout with the code field open and each reason; screenshots at true 375 and 1440, light and dark.

## Files (claude-frontend)
- **New:**
  - `apps/web/app/merchant/{vouchers,reports,settlements}/page.tsx`
  - `apps/web/app/api/v1/sessions/[id]/voucher/route.ts`
  - `apps/web/components/gateway/{Vouchers,VoucherField,Reports,Settlements}.tsx`
  - tests
- **Edited:** `components/Checkout.tsx`, `app/checkout/[sessionId]/page.tsx`, `lib/sessions.ts` (the `discount` field), `app/api/v1/sessions/[id]/route.ts`, `components/dashboard/Nav.tsx`, `lib/gateway-client.ts`.

## Out of scope
- Gift vouchers (FR-GW-13, C, Phase 5).
- Arkiv reads of the voucher entity on the checkout (the server's count decides).

## claude-contracts batch 009 API (06:40): the checkout voucher field + pay route, after their PR merges
- **Apply route:** `applyVoucher(merchant, code, sessionId, checkout.usdtAmount)` from `lib/server/vouchers.ts`. It refuses "This checkout is being paid." once claimed.
- **Pay route, for link and page sessions:**
  1. `price = await claimAmountDue(sessionId)` freezes the hold and returns the price in one statement; it's idempotent.
  2. Relay EXACTLY that price.
  3. On a definite refusal (nothing sent): `releaseHold(sessionId)`.
  4. On an unknown outcome (timeout, 5xx): never release; the chain decides.
  5. On success: `onSessionPaid(session)` with `session.amount = price`.
- `amountDue` is display-only.
- Fiat link and page sessions carry `priced` and the 10-minute TTL; items hold shop-currency prices.
- Neon has migrations 046 and 047 applied.


## Scope at merge (08:12)
- **In this batch:** the three merchant screens (/merchant/vouchers, /merchant/reports, /merchant/settlements), built in scratch b014.
- **Moved to its own batch:** the checkout voucher field, `POST/DELETE /api/v1/sessions/:id/voucher` and the pay-route claim. They are built to claude-contracts' 009 F1–F3 rules (scratchpad/batch-vouchers-pay-spec.md) and are Money: yes.
- **Nav:** Vouchers, Reports and Settlements become links.
- **FR-GW-10 fee figure (claude-research 06:43):** Settlements shows each settlement's network fee covered, read from its receipt with `readTxFee`, as on /merchant/payments.
