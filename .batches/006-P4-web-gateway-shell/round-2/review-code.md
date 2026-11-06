VERDICT: PASS

# Code review: 006-P4-web-gateway-shell, round 2 (reviewer-code)

Fast mode (PIPELINE §3a): nothing here is HIGH or CRITICAL, so the verdict is PASS. The MEDIUM and LOW items go under FOLLOW-UP. Under the new phase mode (§3b, 06:03), they are fixed in one batch before the P4 gate is claimed. Items 1 to 3 should be fixed before AT-13 and the gate.

## How this was checked
- I diffed the 17 files against my round-1 snapshot (`scratchpad/rc006/web`), so the changes below are round 2's only. I read `lib/fx.ts`, `lib/sessions.ts`, the sessions and payments routes, `lib/config.ts` and the four changed tests in full. I also read the PR #11 code that calls into them: `lib/server/links.ts`, `lib/server/quotes.ts`, `lib/server/http.ts` and `lib/server/checkouts.ts`.
- I checked the code against spec.md (including the 05:52 round-2 line), SRS v2.0 (FR-GW-5, 8, 11 and 14, NFR-12, AT-13) and ARCHITECTURE §4b, including the **Conventions (agreed 05:4x)** paragraph that claude-research recorded at 05:58.
- I ran everything in a scratch copy (`scratchpad/rc006r2`, no `.env*`, node_modules linked):
  - `npm test`: **293 tests, 290 pass, 0 fail, 3 skipped**, matching build.md.
  - `tsc --noEmit` (after `next typegen`): 0. `eslint` on the 17 files: 0.
  - `LIVE=1 fx.live.test.mjs` passes against the real Frankfurter v2. Today's rows are AED 3.6725, INR 94.5 and SGD 1.2774 dated 2026-11-05, and EUR 0.88875 and GBP 0.74225 dated 2026-11-06. Every one is inside its band.
- Mutation run: 37 mutants on the round-2 logic, **33 killed and 4 survived**. One survivor is equivalent; the others are items 5 and 6.

| Killed | Survived |
|---|---|
| Rounding: half up, up to the micro-unit, `(n+d)/d`, floor · Bands: direction inverted, no band, strict edges, AED ±2%, EUR high edge 2.6 · Date: no round-trip, 8 days, 6 days, 2 days ahead, tomorrow refused, no age check, no date check, no base check · returnUrl: raw text stored, any scheme, createSession unchecked · Idempotency: no cap, cap 1,001, newest evicted, always deleted, never deleted, stored after the await · publicOrigin: env ignored, path kept, any scheme · fingerprint = start of the key · Payments: partial list on a chain failure (P6), amount from the index (P8), no gross-0 filter | W2 the length is measured on the raw text, not the href · W4 `< 200` (S9) · P4 `next` with `>=` · I7 the route keeps the raw returnUrl (equivalent: createSession normalises it again) |

## The checks you asked for
- **Round-1 MEDIUMs 1 and 2 are fixed, and the tests now fail without the fixes.**
  - M1: `payments-api.test.mjs:106-114` sets both flags on each pass and asserts that the chain reads were reached. Mutant P6 (failed reads turned into a partial or empty 200) is now killed.
  - M2: payment 4 has 99.00 in the index and 25.00 on chain, and the test asserts "25.00" (`:54-55,73`). P8 is killed. The new gross-0 test (`:117-121`) kills the mutant that drops the filter.
- **The round-up is exact bigint maths**, at `fx.ts:57-58`: ⌈n/d⌉ = ⌊(n+d−1)/d⌋.
  - The amount goes through viem's `parseUnits`, which works on strings.
  - The only float is the JSON number the source sends. `String()` gives its shortest decimal form, and `DECIMAL` refuses `1e-7`-style text.
  - The vectors tell up from half up: 10.004, 1.2345, 0.209999/2 and 1/3 each give a different cent under half up. "Exact 25.00 stays put" kills the off-by-one, and "10.004 → 10.01" kills rounding up to 6 dp. All four rounding mutants die in both `fx.test` and `sessions-v2.test`.
- **`inBand` gets the direction right.** The rows are units per USD, the table is USD per unit, and the code compares `1 / rate` with the band.
  - AED's band is [1/(peg·1.01), 1/(peg·0.99)], which is exactly ±1% of 3.6725 AED per USD.
  - The edges are inclusive and tested (1/200 and 1/2.5 are exact in binary floating point).
  - The inverted-direction mutant fails 14 tests.
- **The rate-date round-trip is right** (`fx.ts:64-69`).
  - `Number.isNaN` short-circuits before `toISOString`, which would otherwise throw a RangeError.
  - In node 26, V8 rolls 2026-11-31 over to 12-01 and 2026-02-30 over to 03-02, so the round-trip check is what refuses them. The test covers that case (`fx.test.mjs:161-162`).
  - A rate dated exactly 7 days back is accepted, 8 days is refused, tomorrow is accepted and the day after is refused.
- **`webUrl()`** is called in the route (`route.ts:73`, a 400) and in `createSession` (`sessions.ts:72`, a throw). Both store the parsed href, so `\u0000https://…` and `HTTPS://Shop.Example` are kept as parsed.
- **Idempotency:** I found no path where a request gets another request's session. The slot is `merchant:key`, and a reply is replayed only on the same body hash. The `finally` also covers a `create` that throws, which round 1 would have replayed for 24 h. There is one narrow race that loses an entry (item 4, LOW, proven with a probe).
- **`publicOrigin()`** (`config.ts:41-46`) is right: it accepts only http(s), returns `url.origin` only, and falls back to the request otherwise. `javascript:` (origin "null") and `ftp:` fall back. On /docs the fallback is per request, inside the Suspense key box, so there is nothing to cache-poison.
- **Ponytail:** nothing is over-built. The band table, `recent`, `inBand`, the fingerprint and `publicOrigin` are each a few lines and each answers a review finding. The over-building is at the app level: two FX modules (item 2) and two payment caps (item 1).
- **Scope:** every round-2 change traces to the round-2 spec line, security F1, F3, F4, F5, F6 and F7, code M1, M2, L13 and L14, UX F1 to F5, or the tester follow-ups. Some files are outside spec.md's file list: `next.config.ts`, `lib/config.ts`, `CopyButton`, `InvoicePay` and `HoldButton` (a comment). They are review-driven fixes for FR-GW-8 and FR-PAY-7, so this is not scope creep. There are no ABI changes (§2).

## FOLLOW-UP (MEDIUM)
1. **The sessions API allows up to 10,000 USDT, but §4b says "max 1,000 USDT per payment (testnet) on every session path"** (the human's decision, HANDOFF line 37).
   - Where: `app/api/v1/sessions/route.ts:10-11,102-104`. The tests that pin 10,000 are `test/sessions-v2.test.mjs:119-124` and `:147-152`; the second uses 1,234.50 USD, which would then be over the cap.
   - Why: ARCHITECTURE outranks spec.md (PIPELINE §2). Links, pages, vouchers and quotes already refuse anything over 1,000 (`lib/server/http.ts:10-11`). So an SDK checkout can be 10× what a link checkout can, and the error texts disagree.
   - Exposure: none today. Nobody on testnet holds that much USDT, and the relayer's cost doesn't depend on the amount. That is why this is MEDIUM.
   - Fix (Ponytail rung 2): import `MIN_PAYMENT` and `MAX_PAYMENT` from `lib/server/http.ts`, change the message to "between 1.00 and 1,000.00 USDT", and move the two tests under the cap (for example 9,000 GBP becomes 900 GBP, and 1234.50 becomes 999.50). "Every session path" points at `createSession` as the single guard. `openCheckout` already checks before calling it, so the guard there would only be a backstop.
   - Sibling: `components/merchant/Invoices.tsx:38,164,190` has the same 10,000 ceiling for invoices.
   - Owner: claude-frontend.
2. **The app now has two FX sources, and §4b says one.**
   - Where: `lib/fx.ts` (the sessions API) and `lib/server/quotes.ts` (links, pages and `/api/v1/quotes`). §4b: "the web app's `lib/fx.ts` is a bridge until PR #11, then deleted". PR #11 has merged.
   - `quotes.ts` doesn't follow the conventions yet:
     - it rounds up to the micro-unit, not the cent (`quotes.ts:65-68`)
     - it has no band and no date check
     - it stores the rate as USD per unit (`"1.1251"`), not currency per USD
     - it uses v1 with the currency as base, and AED is a fixed peg
   - So today 20 EUR is 22.51 USDT through the SDK and about 22.502 on a link. Two comments say otherwise and are wrong: `test/fx.test.mjs:51-52` ("a link checkout and a direct one at the same rate charge the same cent") and the spec's "matches claude-contracts' quotes module".
   - Fix, in order:
     1. claude-contracts brings `quotes.ts` to the §4b conventions. It can port `toUsdt`, `inBand`, `recent` and the band table from `lib/fx.ts`, which this round's mutation run covers.
     2. claude-frontend switches `route.ts:97` to it, maps `HttpError(503)` to the same plain-words 503, and deletes `lib/fx.ts`, `fx.test.mjs` and `fx.live.test.mjs`.
   - Until then, don't delete `lib/fx.ts`: it is the only path that has the bands the human asked for.
   - Owner: claude-contracts, then claude-frontend.
3. **AT-13 through a link or page is still not covered (round-1 item 4, still open).**
   - Where: `lib/server/links.ts:79` calls `createSession` with no `priced` and with the 30-minute default.
   - The checkout's FX line comes only from `session.priced` (`app/checkout/[sessionId]/page.tsx:26-27`). `lib/server/checkouts.ts:3` says the checkout reads `app_gw_checkouts.fx`, but it doesn't, and per §4b lanes don't read each other's tables.
   - Effect: an EUR link or page checkout shows no rate and keeps a 10-minute quote for 30 minutes.
   - Fix (in `links.ts`): pass `priced` with the item prices kept in the shop's currency, as the sessions route does, because the page labels items with `priced.currency`. Also pass `ttlMs = QUOTE_LOCK_MS`, or the quote's `expiresAt`.
   - Owner: claude-contracts; claude-frontend to send them the message.

Also still open from round 1, not in these 17 files: item 5 (IST vs UTC day boundaries, home vs Reports; claude-research to decide) and item 6 (prove one refund from allowance 0 in a real wallet at the human gate).

## FOLLOW-UP (LOW)
4. **`app/api/v1/sessions/route.ts:41,50`: a failed request can delete a newer request's slot.**
   - Sequence: A's slot is evicted by the cap while A is still waiting on FX. C sends the same key and body and creates a checkout. A then fails, and its `finally` deletes C's slot. D, the same key again, gets a second checkout.
   - I reproduced it with a scratch probe (1,000 filler keys during a slow FX fetch): **C and D got different ids**.
   - It needs 1,000 keys inside the 5-second FX timeout, using the shop's own key. The result is a duplicate checkout, never someone else's.
   - Fix: `if (done?.status !== 201 && replies.get(slot)?.reply === reply) replies.delete(slot);`
5. **Untested boundaries (from round-1 item 9, still open).**
   - W2: no returnUrl whose href is longer than its raw text, for example `https://shop.example/` plus spaces or non-ASCII characters that get percent-encoded.
   - W4 (S9): exactly 200 characters is accepted.
   - P4: a page of exactly `limit` rows returns `next: null`.
   - One line each.
6. **`lib/fx.ts:92-93`: one bad currency makes all five unavailable.** Today's live rows carry two different dates, so they come from different providers. If AED's provider stalls for more than 7 days, EUR pricing stops too. That is conservative and matches "a partial answer is never cached". Accept it unless it bites, or keep the good rows.
7. **Ponytail:** `URL.parse` (node 26) returns null on bad input, so one call can replace the `URL.canParse` + `new URL` pair in `lib/sessions.ts:16-17` and `lib/config.ts:43-44`. Optional.
8. **`app/docs/page.tsx:74`: the wordmark is a `<Link href="/">`, a soft navigation out of a page that now has the strict CSP.**
   - Home loads only same-origin code today (three.js as a local chunk), so nothing breaks.
   - The rule elsewhere is a plain `<a>` at CSP boundaries (`Shell.tsx`, home), and `next.config.ts:36` says home needs Nym's origins. Use `<a href="/">` so home never runs under /docs' CSP.
9. **Doc wording:** §4b says the rate date is "not in the future", while the spec and code accept tomorrow (UTC). Tomorrow is the right call, since live rows already carry a 2026-11-06 date at about 00:40 UTC. claude-research should reword §4b to "at most tomorrow (UTC)".
10. **Round-1 LOWs not touched this round** (their files aren't in the 17): 7 (G1, `refunded` when the chain read fails), 8 (B4, invoice read retry), 10 (the Fees tile), 11 (`txHash: string | null` in the SDK, claude-sdk), 12 (the `NOT_FUNDED` re-export), the clock-skew half of 14, 15 (the invoice receipt's fee row) and 16 (spec text). There is also a stale example in a comment: `app/checkout/[sessionId]/page.tsx:25` says "22.50", which is now 22.51.

## NEEDS THE USER
- Nothing new. Item 1 was already decided by the human (1,000 USDT); it only needs applying. Item 2 is the sequencing the human chose at 05:4x ("one FX source = backend quotes"). Each lane has its part to do.
