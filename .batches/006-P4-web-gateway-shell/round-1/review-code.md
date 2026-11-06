VERDICT: PASS

# Code review: 006-P4-web-gateway-shell, round 1 (reviewer-code)

Fast mode (PIPELINE §3a): there are no HIGH or CRITICAL findings, so this is a PASS. The MEDIUM and LOW items below go to the lane's next batch. Cross-lane items are marked as such.

## How this was checked
- I read `git diff -- apps/web`, every new file in full, and these in full: the sessions, payments, status and pay routes, `lib/fx.ts`, `lib/dashboard.ts`, `app/merchant/page.tsx`, the Shell, Nav, GrossChart, Reveal, Checkout, `/docs` and the receipt page.
- I compared the diff with spec.md (including the phase-B decisions), SRS v2.0 FR-GW-5/8/11/14 and NFR-12, ARCHITECTURE §2 and §4b, and `packages/sdk/index.ts`. I also read claude-contracts' `lib/server/quotes.ts`, `links.ts` and `reports.ts` in `~/ethglobal-backend`.
- I copied apps/web to a scratch folder `rc006/` (no `.env*`, with node_modules linked). The baseline `npm test` gives **179 pass, 3 skipped, 0 fail**. `tsc --noEmit` is clean apart from the `PageProps`/`LayoutProps` globals, which are missing only because `.next/` was not copied.
- Live FX: `GET https://api.frankfurter.dev/v2/rates?base=usd&quotes=aed,eur,gbp,inr,sgd` returned 5 rows dated 2026-11-05 (AED 3.6725, EUR 0.88879, GBP 0.74231, INR 94.5, SGD 1.2774). The URL in `lib/fx.ts` works.
- Mutation run: 57 mutants (a few changed after a re-run), **45 killed, 12 survived**. The survivors are below. None of them is in the rounding, the cache, the quote lock, the approval clamp, idempotency, the merchant filter or the cursor.

| Killed | Survived |
|---|---|
| FX: floor or ceil instead of half up; cache 16 min and `<=`; lock 15 min; a partial answer accepted; a failure cached; USD not rounded · Sessions: EUR keeps 30 min; USD gets 10 min; idempotency ignores the body, keeps failures, or stores after the await; any URL scheme; reference cut silently; items checked against USDT; USD without `priced`; bounds checked on the asked amount; 503 becomes 500; currency hidden; commas in amounts · GET: refunded taken from the index · Pay: no clamp; clamp `>=`; clamp before settle; the balance check while pending; no retry on the balance read; signSale without the clamp · indexedLogs without the eventName guard · Payments: no merchant filter; cursor `<=`; reads every id; oldest first; limit cap · Dashboard: UTC days; the index amount wins; another merchant's row kept; an unread index-only row kept; refunded unknown shown as 0; change 0 instead of null · Wallet: no `balanceOf`; the old revert-string logic | P6 a partial list on a chain-read failure · P8 amount from the index · G1 refunded guessed as 0 · B4 invoice balance read without retry · P4 `next` with `>=` · P9 no dedupe · S9 returnUrl `>=` · D5 `dailyGross` `<=` · FX8 `base` not checked · FX11 date not checked · FX5 clock-backwards guard (harmless) · S7 key without the merchant (same result with one merchant) |

## What checks out (no action)
- **`lib/fx.ts`:** the rounding is right: ⌊(2·num + den) / (2·den)⌋ is half up, in exact bigint maths. The 15-minute cache, the 10-minute lock and the failure paths behave as specified. A failure is never cached, and neither is a partial answer (all five rates are required). The 503 message is in plain words, and nothing is created when there is no rate.
- **Sessions v2:**
  - The fields (`currency`, `priced`, `returnUrl`, the 400 for a reference over 40 characters, `plainUsdt` amounts) match the SDK's `CreateSessionParams`, `CreatedSession` and `Session`.
  - Every 400 check runs before the FX fetch.
  - On `Idempotency-Key`, the reply is stored before the await, so two requests at the same moment create one session. A different body gets a 422, and only a 201 is replayed.
  - Adding `createSession`'s new `ttlMs` parameter with a default keeps claude-contracts' existing call in `links.ts:79` compiling.
- **Approval clamp:** `signSale` takes min(now + 465 s, expiry), the route refuses `validBefore > ⌊expiresAt/1000⌋` after `settlePending` and the 410, and the countdown stops 30 s early, which matches the relayer's `MIN_REMAINING_S`.
- **Payments list:** paging is correct (`< cursor`, newest first, `next` only when there are more). Only the page's ids are read on chain, and `Promise.all` turns any failed read into a 503.
- **`lib/dashboard.ts`:** the chain's gross wins over the index, rows that belong to another merchant or are only in the index (unconfirmed) are dropped, unknown refunds show as `null` and display "—", and the IST offset is correct (no DST).
- **React 19 / Next 16:**
  - `useSyncExternalStore` with a server snapshot of `null` avoids a clock mismatch on hydration.
  - `Date.now()` in `home()` runs after `connection()`.
  - The `/docs` key box reads `headers()` inside a Suspense boundary.
  - Reveal starts from the real text, cancels its rAF on cleanup, skips the animation under reduced motion, and screen readers always get the real figure.
  - The `.lift` spring is covered by the global reduced-motion rule.
  - GrossChart's 7/30 switch is radio buttons plus CSS, with no client JS.
- **Carried 005 items:** R2-F1, R2-F2, F-N3, F-N4, F-N5, F-N6, N1, N2 and N3 are all present. All of them are pinned by a killed mutant except F-N4, which is a source pin.
- **ABI:** no contract interface changes. The reads (`payments`, `Paid`, `balanceOf`, `allowance`, `approve`, `refund`) match §2. The button uses `data-session`/`data-link`, `MC-Signature` is used, and `Idempotency-Key` is only on sessions, as §4b says.
- **Scope:** every change traces to FR-GW-14/8/11/5/1, the carried 005 findings or the human-approved v2 design (03:08; §4b UI lists "6 KPI tiles + gross chart").

## FOLLOW-UP (MEDIUM)
1. **`apps/web/test/payments-api.test.mjs:104` (test bug, mutant P6).**
   - What: the 503 loop never resets `indexDown`, so the "chain down" case also has the index down.
   - Why it matters: a version that turned failed chain reads into a partial 200 list passes. The "503 rather than a partial list" property from the build report is unproven.
   - Fix: reset both flags at the top of each iteration, or split it into two tests.
   - Owner: claude-frontend.
2. **`apps/web/test/payments-api.test.mjs:53-54` (test gap, mutant P8).**
   - What: the index `gross` always equals the chain's `gross`, so `amount: usdt(log.gross)` survives at `app/api/v1/payments/route.ts:48`.
   - Why it matters: the index is untrusted (ids only), and the money amount the SDK reconciles against isn't pinned to `payments(id)`.
   - Fix: give one row an index gross of 99.00 and a chain gross of 25.00, and assert "25.00", as dashboard.test already does.
   - Owner: claude-frontend.
3. **Cross-lane: agree the FX contract before switching to `createQuote` (`app/api/v1/sessions/route.ts:96`, `lib/fx.ts`).**
   - The switch itself is easy: there is one call site, plus one error mapping (`FxUnavailableError` → `HttpError`), and `session.expiresAt` could take the quote's `expiresAt`.
   - What makes it harder is that this batch's public reply fixes semantics that `createQuote` doesn't share:
     - (a) **direction of `priced.rate`:** ours is currency per USD (EUR 0.88879); `quotes.ts` gives USD per unit of the currency (≈ 1.1251). Switching would silently invert a field the SDK already types.
     - (b) **`priced.rateAt`:** ours is the source's publish date, which the checkout shows as "rate of 5 Nov 2026"; `quotes.ts` has only `fetched_at`, with the date inside the `source` text.
     - (c) **rounding:** ours is half up to the cent (the spec); theirs is up to 6 dp, so 20 EUR would show as 22.502813 USDT on link checkouts and 22.50 on SDK ones.
     - (d) **maximum:** ours is 10,000 USDT; theirs is 1,000.
     - (e) **AED:** we use Frankfurter v2's AED row, which today equals the 3.6725 peg; ARCHITECTURE §4b says v1 plus the peg.
   - Fix: claude-research records one rule for each of (a)–(e) in §4b before either lane ships `priced` in the SDK docs, then the switch.
   - Note on claude-contracts' 03:55 agentbus message: their 404 came from `/v2/latest`, which is not the endpoint `lib/fx.ts` uses. `/v2/rates?...` answers 200 (see above).
   - Owner: claude-frontend with claude-contracts, decided via claude-research.
4. **Cross-lane: link and page checkouts created by claude-contracts (`~/ethglobal-backend/apps/web/lib/server/links.ts:79`, `app/checkout/[sessionId]/page.tsx:49`).**
   - What: `openCheckout` calls `createSession` without `priced` and with the default 30-minute lifetime.
   - Why it matters: those EUR checkouts get no FX line (their comment cites AT-13), and they outlive the 10-minute lock. Also, if they now add `priced`, our page labels every item price with `priced.currency`, while their items are already converted to USDT, so the items would be mislabelled.
   - Fix: tell claude-contracts that `priced` means items are in `priced.currency`, and that `ttlMs` should be `QUOTE_LOCK_MS`. Or add an explicit currency for the items.
   - Owner: claude-frontend to notify claude-contracts.
5. **Cross-lane: day boundaries (`lib/dashboard.ts:48-50` vs `~/ethglobal-backend/apps/web/lib/server/reports.ts:46,55`).**
   - What: the home uses IST days, and the Reports API uses UTC days.
   - Why it matters: from 00:00 to 05:30 IST, "Gross today" on the home and "today" in Reports disagree.
   - Fix: pick one boundary (IST suits a Mumbai demo), and switch the home chart to the reports API when that batch lands, then delete `dailyGross`/`figures`.
   - Owner: claude-research to decide; both lanes apply it.
6. **`lib/merchant-wallet.ts:110-112` (F-N5 allow-list, not verified in a real wallet).**
   - What: a first refund always needs an approval, so the dry run always reverts. The approval now goes ahead only if the injected wallet's `eth_call` error carries the decoded "exceeds allowance" reason.
   - Why it matters: if the wallet drops the revert data, every first refund stops with the misleading "Check it has a little WBT" message.
   - Fix: at the human gate, prove one refund starting from allowance 0 in the browser wallet on chain 1874. If it fails, map the bare-revert case to an honest message.
   - Owner: claude-frontend (tester, then the human gate).

## FOLLOW-UP (LOW)
7. **`app/api/v1/sessions/[id]/route.ts:31` (G1):** nothing tests that `refunded` is left out when the chain read fails. Add a test where `readPayment` rejects.
8. **`app/api/v1/invoices/[id]/pay/route.ts:50` (B4):** the invoice route's `{ tries: READ_TRIES }` is untested. Copy the `balanceReads` assertion from checkout-api.
9. **One-line boundary tests:** a page with exactly `limit` rows gives `next: null` (P4); duplicate ids are deduped (P9); a returnUrl of exactly 200 characters is accepted (S9); a row exactly `days` back is dropped (D5); FX rows with the wrong `base` or a bad `date` are refused (FX8, FX11).
10. **`app/merchant/page.tsx:91`:** the Fees tile is the current `relayFee` × today's count. It is wrong if the owner changed the fee today, and on invoices the payer pays the fee, not the merchant. Label it "at the current fee", or drop invoices from the count.
11. **`app/api/v1/payments/route.ts:50` vs `packages/sdk/index.ts:51`:** `txHash` can be null (`PaidLog.txHash: Hex | null`), but the SDK types it as `string`. Owner: claude-sdk (`string | null`).
12. **`lib/relay.ts:47` (ponytail):** the `export { NOT_FUNDED }` re-export exists only so the routes keep their import path. Import from `lib/outcome.ts` in the two pay routes and delete it.
13. **`components/CopyButton.tsx:12`:** on a non-secure origin (a LAN IP) `navigator.clipboard` is undefined. The call throws synchronously, so the `prompt` fallback never runs. Fix: `(navigator.clipboard?.writeText(text) ?? Promise.reject()).then(...)`.
14. **`components/Checkout.tsx:117,178`:** the countdown compares the phone's clock with the server's `expiresAt`. A phone clock ahead by more than what is left shows "Expired" on a 10-minute EUR checkout that can still be paid. Optional fix: pass the server's `now` and count down by the offset. Also put an explicit `aria-live="off"` on the `role="timer"` pill, since it sits inside the sheet's `aria-live="polite"` section (ux to confirm).
15. **`app/r/[id]/page.tsx:137-140`:** invoice receipts say "Network fee: None", while the invoice sheet charged a "payment fee" on top. The receipt total includes it. Show the payment fee row on invoice receipts (ux to word it).
16. **Spec text (claude-research):** the spec's ladder says "No chart yet" while phase B says "apply the approved v2 design" (which has the chart). The spec says Frankfurter v2, but ARCHITECTURE §4b says v1 plus the AED peg. Nav items say "Soon" where the spec says "Coming in this build" (ux call).

## NEEDS THE USER
- The FX rules in item 3 (rate direction, rounding to the cent vs up to 6 dp, the 1,000 vs 10,000 USDT cap, the AED source) are product decisions that two lanes currently implement differently.
