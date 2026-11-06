VERDICT: PASS

# Code review: G4 phase review, part 2 (reviewer-code)

No HIGH or CRITICAL finding. Under PIPELINE §3a.1 that makes the verdict PASS. Two MEDIUM and four LOW findings are listed under FOLLOW-UP below. §3b.3 asks for them to be fixed in one batch before G4 is claimed. Part 1's H1, M2, M3 and M4 are closed (see "Part 1 findings"). Nothing in this range changes the ABI in ARCHITECTURE §2.

## How this was checked
- **Range.**
  - `c719cef..e079204` under `apps/web` and `apps/relayer`, plus `apps/shop`.
  - origin/main moved while I worked: a7e7bae, then d9228ea (PR #19 with the shop, and frontend batch 018, the private-reads meter), then e079204 (docs only). batch.md takes origin/main at review time and lists 018 "if merged", so I reviewed it as well.
  - `apps/shop` on origin/main is identical to origin/relayer.
- **Batches read** (spec, batch.md, BUILDERS-015, build-relayer.md):
  - backend 012, 013, 015
  - frontend 012 to 018
  - relayer 010 and 015-P4-demo-shop
  - part 1's round-1/review-code.md
- **Read in full:**
  - `lib/server/{vouchers,checkouts,links,quotes,keys,webhooks,events}.ts`
  - `app/api/v1/sessions/{route,[id]/route,[id]/pay/route,[id]/voucher/route}.ts`
  - `lib/{settle,sessions,relay,announce-paid,shop-auth,gateway-server,gateway-money,gateway-dev}.ts`
  - `apps/relayer/src/relayer.ts` (the fund path, checks, simulate, send)
  - all of `apps/shop`, and the vendored SDK's `constructEvent`
- **Diffs read:** everything else in the range, including 018 (`merchant-wallet.ts`, `read-meter.ts`, `anon.ts`, `next.config.ts`, `Shell.tsx`, `PrivateReads.tsx`).
- **Commands, run in scratch copies made with `git archive` (no `.env*` files; node_modules linked read-only):**
  - apps/web at d9228ea:
    - `npm test`: **451 tests, 449 pass, 0 fail, 2 skipped** (the two live chain tests). At a7e7bae it was 444 / 442 / 0 / 2.
    - `npx next typegen && npx tsc --noEmit`: **exit 0**.
  - apps/relayer: `node --test` gives **53/53 pass**. That is the spec's 53, with its 3 new fund tests.
  - apps/shop: `node --test` gives **5/5 pass** (webhook 200 and 400, checkout 303 and 502, the SDK copy pin).
  - I didn't run tsc for the relayer or the shop (their TypeScript 7.0.2 isn't installed in any scratch). Their ci.md covers it.
- **No probe files this time.** The pipeline gate hook refuses any write under an `apps/` path while no batch is active, even in the scratchpad, and AGENTS.md says not to work around it. Every finding below comes from reading the code, with file:line references.

## Part 1 findings: closed or not
| Part 1 | Status | Evidence |
|---|---|---|
| **H1** per-line rounding, USDT rounded | **Closed** | `links.ts:89-91`: one `toUsdtUnits` on the total. `quotes.ts:118,131`: USDT `exact`. Tests: `gw-pages.test.mjs:184` (20.94), `:200-202` (22.51 = `createQuote("20.00","EUR")`), `gw-links.test.mjs:246-250` (10.123456 exact). USD still rounds up to the cent. The 015 spec had said "USD exact"; batch 015's 09:2x log records the deliberate reversal, and the sessions route, links and the SDK all agree (`sessions-v2.test.mjs:248`). |
| **M2** two FX modules | **Closed** | `lib/fx.ts` and `test/fx*.test.mjs` are deleted. `sessions/route.ts:110-112` uses `usdRate` + `toUsdtUnits`. `lib/sessions.ts:5` takes `Currency` from `server/http.ts`. One small gap: the live Frankfurter check wasn't carried over to quotes.ts (INFO 4). |
| **M3** pays-once link paid twice | **Closed, with a ceiling** | `vouchers.ts:267-295`: an advisory lock per link, then one claim + freeze statement that refuses (410) when a sibling is paid or claimed within `FREEZE_MS`. `releaseHold` clears `claimed_at`. The pay route shows the 410 and releases nothing (`pay/route.ts:109`). Tests in `gw-single-use.test.mjs` (9), including "four at once: exactly one wins". The ceiling is in FOLLOW-UP 2. |
| **M4** self-HTTP, preview scaffolding | **Closed** | grep finds no `selfOrigin`, `transportFor`, `gatewayFor`, `GATEWAY_PREVIEW`, `previewFetch` or `VERCEL_URL`. `gateway-preview.ts` and `gateway-dev-preview.ts` are deleted. `gateway-server.ts:73-91` calls `payLink`/`payPage` with the payer's `x-forwarded-for`, which is what `clientIp` reads (`http.ts:143`). The browser clients still carry duplicate code (FOLLOW-UP 5). |
| L5 rate not shown | Closed | `checkout/[sessionId]/page.tsx:29-35`: "1 USD = 0.88875 EUR, rate of …". |
| L6 fee line | Closed | `merchant/payments/page.tsx:70-89` counts failed reads only and says "fees shown for the newest 50". Settlements reuses `readTxFee` and `formatWbt`. The SRS wording is still claude-research's. |
| L7 unpayable fiat links/pages | Closed | `links.ts:51-64` `payablePrices` runs at link and page creation. It is skipped during an FX outage, deliberately. |
| L8 stale comments | Mostly closed | `gateway-client.ts:165` remains (FOLLOW-UP 6). |
| 009 F1/F3 (no callers), F2 (frozen forever), F4 (10-min apply), F6 (no back-off) | Closed | The pay route's order matches 015's spec steps 1-9 (`pay/route.ts:89-137`). `FREEZE_MS` is in `vouchers.ts:52,192,220,226`. The TTL pick is at `:195`. The back-off after a timeout is at `quotes.ts:78-103`. |

## Money paths checked and OK
- **The claimed price is the signed price.**
  - `pay/route.ts:105-119`: one `price` from `claimAmountDue` feeds `verifyTypedData`, the balance check, `relaySale` and `attempt.amount`.
  - The chain is read at that price: `recordRelayed`'s `saleSettled` at `:150`, `findPayment` at `:127`, and `settlePending` reads `pending.amount` (`settle.ts:54`).
  - The paid amount is recorded and announced: `recordPayment` gets `amount: sale.amount`, and `announcePaid(…, price)` is at `:158`.
  - The receipt and the paid sheet show `payment.amount` (`r/[id]/page.tsx:56`, `checkout/[sessionId]/page.tsx:61`).
  - The browser re-reads the amount due right before signing and stops if it moved (`Checkout.tsx` `currentTerms`).
- **Release rules.**
  - Release happens on the pre-relay refusals, on BUSY and other 4xx, and on a 422 only after `findPayment` returns exactly `null`.
  - It never happens on an unknown outcome, an unconfirmed 200, a 409 or STILL_PENDING. The 410 from a sibling's claim releases nothing.
  - `reopen` takes the in-flight lock before releasing (`settle.ts:65-77`). 015's voucher-pay tests (17) assert each branch.
- **Voucher concurrency.**
  - `applyVoucher` takes a per-voucher advisory lock before counting holds.
  - Its upsert re-checks the freeze and paid state on the conflicting row under READ COMMITTED, so a claim racing an apply leaves the code unswitched (`vouchers.ts:213-236`, `gw-vouchers-paid-race.test.mjs`).
  - `confirmRedemption` moves a hold into `times_redeemed` in one statement.
  - The worst interleaving (an apply's insert racing a claim that sees no row) charges the full price the payer signed and never counts the code.
- **FX.**
  - `toUsdtUnits` is an exact bigint ceiling to the cent, with `exact` for USDT.
  - The sessions route, links and pages share one rate source and one cache, and `freshDate` is re-checked at use.
- **Webhook signing.**
  - `webhooks.ts:16-17` is unchanged. `gw-sdk-compat` passes against `packages/sdk`.
  - `data.amount` is the paid price (`events.ts:21,45-49`). `onSessionPaid` and `onRefund` take it as a required argument.
- **API keys.**
  - Only `sha256(key)` is stored (`keys.ts:35`). Revoked keys are filtered at lookup (`:61`). `pk_` gets 403 on the shop routes (`shop-auth.ts:27`).
  - The Developers page renders `keyJson` rows only and runs under the strict CSP (`next.config.ts`, 018 F1).
  - Tests: `shop-keys.test.mjs` covers sk ok, pk 403, revoked 401 and other merchants invisible.
- **Relayer fund action (010).**
  - `parseFunding` builds exactly §2's `fundWithAuthorization(claimId, investor, units, validAfter, validBefore, salt, v, r, s)`, and the action is §3's `fund`.
  - The value and nonce come from the chain (`quote`, `fundingNonce`, in one batched read), never the body.
  - The signature must recover to `investor`, with `to = CapitalMarket` (a MerchantPay-targeted signature gets 422 `bad_signature`, tested).
  - A quote under 1 USDT is refused before any simulation or send (tested).
  - The usual payer checks apply to the investor: no code, balance ≥ quote, `authorizationState`, the window, bans and budget.
  - It is simulated against `CapitalMarket` before the send and again inside the send lock. The tx `to` is `p.target`. Nothing else was added to the allowlist.
- **Shop (AT-14).**
  - `api/webhook.ts:7` passes `new Uint8Array(await request.arrayBuffer())` to `constructEvent`: the exact signed bytes. A bad or missing signature gets 400; an unset secret gets 500, so the gateway retries.
  - `api/checkout.ts` creates the session server-side with the sk key, and the amount is fixed on the server.
  - Integration code excluding comments and blank lines: checkout.ts 9 + webhook.ts 11 = **20 lines**, which meets AT-14's ≤ 20.
  - `lib/sdk.ts` is byte-identical to `packages/sdk/index.ts`, pinned by a test.

## FOLLOW-UP

### MEDIUM

**1. FR-GW-7: `payment.refunded` is never sent. `onRefund` has no caller.**
- **Where:** `lib/server/events.ts:52` is defined and tested (`gw-events.test.mjs:82-97`). Grep over `app/` and `lib/` finds no call. 017's ci.md says so too: "onRefund has no caller yet".
- **What happens:** a refund goes from the merchant's wallet to the chain (`components/merchant/Refund.tsx`), and the gateway never hears about it.
- **Why it matters:**
  - FR-GW-7 (M, Phase 4) promises `payment.succeeded` and `payment.refunded`, and so do ARCHITECTURE §4b and API.md.
  - /docs only documents `payment.succeeded`, so the docs are honest. But G4 can't claim FR-GW-7 as built.
- **Fix (cheapest):** call `onRefund` wherever our server already reads the chain's refunded total after a refund. That is the Payments page that Refund.tsx refreshes (`merchant/payments/page.tsx`, which already reads `readPayment(...).refunded` per row) and `GET /api/v1/sessions/:id` (`route.ts:33-39`).
  - `onRefund`'s key is the running total (`refund:<id>:<total>`), so calling it on every read sends each new total once.
  - `refund_amount` needs the previous total: keep the last announced total on the in-memory session.
  - `paidAmount` = `session.payment.amount`.
  - If there's no time: claude-research records `payment.refunded` as cut for G4 (an SRS change: NEEDS THE USER).
- **Owner:** claude-frontend (Payments page). claude-contracts for the GET route (`app/api/v1/**`).

**2. A link or page checkout's `onSessionPaid` runs once and nothing retries it. One transient database error leaves the payment half-recorded.**
- **Where:** `lib/announce-paid.ts:14-22` runs it once inside `after()` and only logs a failure.
  - The only re-announce is `GET /api/v1/sessions/:id` (`route.ts:27`). That needs the merchant's key and the session id, so it covers a shop's own sessions and never a link or page checkout.
  - The paid checkout page and `/r/[id]` read `session.payment` but don't re-announce.
- **What happens if `markCheckoutPaid` or `confirmRedemption` fails** (a Neon blip, the only way `onSessionPaid` can throw: `send()` swallows network errors):
  - (a) The single-use link never turns "paid". `claimAmountDue`'s sibling guard then lets a second checkout of it pay once `FREEZE_MS` has passed (`vouchers.ts:281`).
  - (b) The frozen hold of a paid checkout stops counting after `FREEZE_MS`, because `paid_at` is null. A 1-use code is then usable again.
  - (c) The merchant's `payment.succeeded` is never sent.
- **The same ceiling with an unknown relay outcome:** an attempt that went pending keeps `claimed_at`. If it landed but its customer never reloads (so `settlePending` never runs for it), a sibling can claim after `FREEZE_MS`.
- **Fix (root cause: every caller routes through `announcePaid`):**
  - Retry inside `announcePaid`'s `run`, for example 3 tries at 1 s / 5 s. Every step of `onSessionPaid` is idempotent.
  - Also re-announce where the customer lands, as the GET poll does: `if (session.payment) announcePaid(session, session.payment.amount)` in `CheckoutLoader` (`checkout/[sessionId]/page.tsx`, after line 61) and in `/r/[id]` (`page.tsx:52`).
  - Add a `ponytail:` comment on the sibling guard (`vouchers.ts:276-282`) naming the unknown-outcome ceiling and the upgrade (settle sibling pending sessions before a single-use claim).
- **Owner:** claude-frontend (`lib/announce-paid.ts`, the two pages). claude-contracts (the comment in `vouchers.ts`).

### LOW

**3. The voucher route's DELETE runs its own SQL on `app_gw_redemptions` although `removeVoucher` now exists.**
- **Where:** `app/api/v1/sessions/[id]/voucher/route.ts:71-73`. The comment says "vouchers.ts has no remove yet".
- **Why:**
  - Batch 015 (claude-contracts) added `removeVoucher` (`vouchers.ts:333-342`) for exactly this, "so claude-frontend's route stops running SQL on app_gw_redemptions" (ARCHITECTURE §4b).
  - The two disagree on a lapsed freeze. The route keeps a hold whose `frozen_at` is older than `FREEZE_MS` (an abandoned claim whose release failed), so "Remove" silently does nothing. `removeVoucher` removes it.
- **Fix:** `await removeVoucher(found.id);` (Ponytail rung 2). Then drop the `query` import and the comment.
- **Owner:** claude-contracts (`app/api/v1/**`).

**4. After a discounted payment, `GET /api/v1/sessions/:id` reports the pre-discount `amount`, but the webhook reports the paid one.**
- **Where:** `app/api/v1/sessions/[id]/route.ts:40` sends `amount: plainUsdt(session.amount)`.
- **Why:**
  - /docs defines the webhook `amount` as "The USDT the customer paid, after any voucher" (`docs/page.tsx:337`).
  - SDK spec 005 says the event `data` is the GET object.
  - A merchant whose sk key reads one of its own discounted link checkouts sees 100.00 from `sessions.retrieve` and 50.00 in `payment.succeeded`. Shop sessions carry no codes, so the demo shop is unaffected.
- **Fix:** `amount: plainUsdt(session.payment?.amount ?? session.amount)`.
- **Owner:** claude-contracts (`app/api/v1/**`).

**5. Ponytail: there are three copies of the browser `call()`, and two copies each of `plainError` and the wire parsers.**
- **Where:**
  - `gateway-client.ts:179` (`call`), `:162` (`plainError`), `:97-…` (`bad`, `record`, `text`, `nullable`, `count`), exported as `wire` at `:210`.
  - `gateway-money.ts:108`. Its own `ponytail:` at `:106` says "fold the two into one exported call at merge".
  - `gateway-dev.ts:72-82` and `:135-165` re-declare the same helpers.
- **Fix:**
  - `gateway-dev.ts` takes `wire` like `gateway-money.ts` does.
  - Export one `call(method, path, what, body?)` from `gateway-client.ts` and use it in all three.
  - That is about 60 lines fewer, and one 404/401/429 mapping to keep right.
- **Owner:** claude-frontend.

**6. Stale comments.**
- `apps/relayer/src/relayer.ts:51` says "exactly these two functions on this one contract", and `:431` says "only MerchantPay paySale/payInvoice are called". It is three functions on two contracts now (FR-REL-2). Owner: claude-relayer.
- `app/l/[slug]/page.tsx:45` says "the public link has no paid time". `publicLinkJson` has had `paid_at` since backend 015 (`links.ts:194`). Show "Paid on …" or drop the comment. Owner: claude-frontend.
- `lib/gateway-client.ts:165` says "claude-contracts' routes aren't on this server yet". They are on main now. Owner: claude-frontend.

### INFO (already tracked, or optional)
1. **Webhook retries need a caller of `/api/v1/webhooks/dispatch`.** This was 007's code review, and it is still open. There is no `vercel.json` cron, and the gateway runs on 127.0.0.1:3100. A failed first attempt sits at "pending" until someone presses Resend, so FR-GW-7's "with retries" depends on that.
2. **Relayer security 010 is still open.**
   - LOW-1: `prepareFunding`'s two reads run before the free window and expiry checks (`relayer.ts:438`). Check `validAfter`, `validBefore` and the 15-min window in `parseFunding` or before the reads.
   - LOW-2: there is no per-claim rate key.
3. **Holds on fiat checkouts last longer than needed.** `HOLD_MS` (`vouchers.ts:48`) is 45 min for every checkout. A fiat checkout's payment can't land after its 10-min `expiresAt` (validBefore ≤ expiresAt), so a 1-use code applied to an abandoned EUR checkout stays unavailable about 35 min longer than it has to. Optional: a per-checkout TTL + 15 min. Owner: claude-contracts.
4. **The live Frankfurter check went with `fx.live.test.mjs`.** Part 1's M2 fix step 3 asked to move it onto `quotes.ts`. Optional.
5. **`SHOP_API_KEY` can be removed now.** Frontend 012's spec says to remove it "in its own small change" once the shop uses its own key. The shop now uses `GATEWAY_SECRET_KEY` (an `sk_` key), so the condition is met. Owner: claude-frontend.

## ABI and scope
- **ABI §2 / §3:**
  - The relayer's fund call matches §2 line 74 exactly, and `action: "fund"` matches §3.
  - No contract, event or argument changes.
  - The web side still builds `saleAuthorization` and `paySale` args unchanged.
- **Scope:** every change traces to a spec ID:
  - backend 012 (FR-GW-12/7), 013 (FR-GW-12/7, NFR-11), 015 (FR-GW-1/2/11/12)
  - frontend 012 (FR-GW-5/6/7/8), 013 (FR-GW-9/10/12), 014 (FR-GW-1/2, NFR-6), 015 (FR-GW-11/12), 016 (FR-GW-1/2/3 + M4), 017 (FR-GW-8), 018 (FR-PRIV-1/3/4, NFR-13)
  - relayer 010 (FR-ADV-3, FR-REL-1/2)
  - shop (AT-14, FR-GW-5/7)
- Small items folded in are listed in their own specs' "Added at merge / during the build" sections: `x-vercel-mitigated` as BUSY, the receipt's paid amount, sk_ polling, `WBT_HINT`. No scope creep found.
- 018's CSP and private-read path is the security reviewer's to judge. The code reads correctly: writes always go through the wallet, a Nym failure or hang falls back to the wallet for that read and the rest of the page, and `/merchant/developers` keeps the strict policy as the last matching rule.

## Tests vs acceptance criteria
- H1: the three asserted figures above. M3: 9 tests. F2: `gw-vouchers.test.mjs:482-530`. The F1 named test: `voucher-pay.test.mjs`. N2: `gw-vouchers-paid-race.test.mjs`. Keys: `shop-keys.test.mjs`. Fund: 3 relayer tests. Shop: 4 + the copy pin. Docs drift: `docs-reference` (12) + `docs-limits` (13).
- One limit: the "four at once" single-use test runs on single-connection PGlite, so it proves the SQL logic but not real lock contention.
- No acceptance test covers `payment.refunded` (FOLLOW-UP 1) or a failed `onSessionPaid` (FOLLOW-UP 2).

## NEEDS THE USER
- FOLLOW-UP 1: build `payment.refunded` for G4, or cut it from FR-GW-7 (an SRS change, so the human decides; claude-research records it).
