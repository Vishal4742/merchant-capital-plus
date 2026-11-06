VERDICT: PASS

# Security review: 006-P4-web-gateway-shell, round 1 (reviewer-security)

Fast mode (PIPELINE §3a): I found nothing HIGH or CRITICAL. Two MEDIUM and six LOW findings are listed under FOLLOW-UP for the lane's next batch. Two items need the human.

Scope: the uncommitted diff under `apps/web`, which is 26 modified files plus the new `lib/fx.ts`, `lib/dashboard.ts`, `app/api/v1/payments/route.ts`, `app/docs/page.tsx`, `components/{TestModeBadge,CopyButton}.tsx`, `components/dashboard/*` and the new tests. I did not read `.env`. I ran no build and sent no transactions; the only chain access was two read-only `eth_call`s on 1874. Mutants were run in a scratch copy.

## How it was checked
- `npm test` in apps/web: **179 pass, 3 skipped (LIVE), 0 fail**. A scratch copy gave the same result, and `git status` was unchanged afterwards.
- **14 mutants** in a scratch copy (`scratchpad/mutate.sh`). 11 were killed: no clamp check (M1), no merchant filter on /payments (M2), no auth on /payments (M3), floor instead of half-up (M5), FX cache never expiring (M7), EUR session at 30 min (M9), balance check while pending (M10), refund approving on any dry-run error (M11), returnUrl accepting any scheme (M12), no `signSale` clamp (M13), index-only dashboard rows shown (M14). **Three survived:** M4 (FX `base === "USD"` check removed), M6 (FX date check removed) and M8 (idempotency slot not per merchant; it can't be tested with one merchant config).
- **FX probes** with faked Frankfurter answers (`scratchpad/probes/fx-probe.mjs`), plus a real-undici stall test against a local server (`fx-timeout.mjs`).
- **Sessions probes** (`sessions-probe.mjs`): 14 returnUrl variants, the reference limit, idempotency (same body, different body, two at once, whitespace).
- **USDT revert text, read-only on 1874** (`usdt-revert.mjs`). `transferFrom` with a short allowance answers `"ERC20: transfer amount exceeds allowance"` when the owner is funded, and `"ERC20: transfer amount exceeds balance"` when the owner is empty. This confirms F-N5's assumption.
- **Live Frankfurter v2 shape** (one public GET): `[{date:"2026-11-05", base:"USD", quote:"AED", rate:3.6725}, …]`, which matches the parser.

Scratchpad: `/private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/`

## Secret grep
I ran `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over all 42 changed or new files. Every hit is harmless:
- `app/docs/page.tsx:21,45,172`: env var **names** in the snippets (`GATEWAY_SECRET_KEY`, `GATEWAY_WEBHOOK_SECRET`). No values.
- `test/checkout-api.test.mjs:252,258` and `test/invoice-pay.test.mjs:107`: nonce test vectors (public keccak outputs). Pre-existing.
- `test/checkout-edges.test.mjs:12`: a fake `AUTH_SECRET` test fixture. Pre-existing.
- `git diff -U0 apps/web/test` adds no matching line.

## What holds (per question asked)

**FX (`lib/fx.ts`)**
- Neither a shop nor a customer can make the charge differ from the locked quote. The USDT amount is fixed in the session at creation (`sessions/route.ts:106-119`). The pay route rebuilds the sale from the session and verifies the signature against `session.amount` (`[id]/pay/route.ts:34-37`). The checkout shows exactly `formatUsdt(session.amount)`.
- Rounding is exact bigint half up to the cent (M5 killed). The error is at most 0.005 USDT per checkout, with a 1 USDT minimum checked after conversion. A priced checkout converts once in total, not per item, so nothing accumulates.
- A failed or partial answer is never cached. Missing currencies throw, and the route answers 503 with nothing created.
- The 5 s `AbortSignal.timeout` also covers a body that stalls after the headers (probe: FxUnavailableError at 5005 ms).
- Rates in exponent form (`1e-7`, `1e21`) are rejected, as are non-numbers, zero and negatives.
- Priced checkouts expire at 10 min (M9 killed).
- The FX fetch carries no customer data: a fixed URL from our server.

**Sessions v2**
- returnUrl: `javascript:`, `JaVaScRiPt:`, `" javascript:"`, `"java\tscript:"`, `"\u0001javascript:"`, `data:` and `//host` all get 400. The WHATWG parser used for validation is the same one the browser uses for `href`.
- It renders as a same-tab `<a href>`. The link text is `merchantName` from the server config, never the URL. `Referrer-Policy: strict-origin-when-cross-origin` keeps the session id out of the shop's logs.
- Only the shop holding the key sets returnUrl, so it is not an open redirect for third parties.
- Idempotency-Key is keyed `${config.merchant}:${key}`, so it is per merchant. Two identical requests at once create one checkout with one FX call (the check and the set are in one synchronous step). A different body gets 422, and a failed create isn't kept.
- Reference: 40 chars → 201, 41 → 400.

**GET /api/v1/payments**
- Bearer auth (M3 killed). Merchant filter on both the index topic and the chain record (M2 killed). `gross == 0` is dropped.
- limit is 1–100 and the cursor is digits only. A read failure gives 503, never a partial list.
- No payer address in the reply.

**Approval clamp**
- `signSale` clamps `validBefore` to the checkout expiry (M13 killed). The route refuses `validBefore > expiresAt` after settle and the 410, and before relaying (M1 killed).
- USDT requires `block.timestamp < validBefore`. So nothing relayed through our route can settle after the checkout reads "expired".

**Carried 005 items**
- R2-F1 / F-N1: the balance check is skipped while pending (M10 killed). An unfunded payer then reaches the relayer's simulate, which costs no gas.
- F-N3: `readUsdtBalance` is retried at the same block.
- F-N5: the refund reads `balanceOf` first, then approves only on the allowance revert (M11 killed). The revert string was verified on chain.

**/docs**
- It never shows the key. The 6-char prefix appears only for the signed-in shop wallet, rendered on the server and never passed to a client component (see F5).
- Links to /merchant are plain `<a>`.

**Test-mode strip**
- Presentational only. The test asserts that no source names chain 1875 or viem's `whitechain`.

**Merchant home**
- Data is scoped to the SIWE wallet: `listPayments(merchant)`, `paidLogs({merchant})`, and `confirmed()` drops rows that are another merchant's or only in the index (M14 killed).
- The invoices UI is shown only to the shop wallet. No other merchant's data reaches the page.

**Client and third parties**
- No `"use client"` file imports `lib/config`, `lib/sessions`, `lib/fx` or `node:crypto`.
- No `NEXT_PUBLIC_`, no `dangerouslySetInnerHTML`, no new third-party origins or trackers.
- The session cookie is `HttpOnly; SameSite=Lax`.

## FOLLOW-UP (MEDIUM / LOW: not blocking under §3a)

### F1 MEDIUM: FX answers have no sanity bounds on the rate or its date
`lib/fx.ts:59-63`. Owner: claude-frontend (claude-contracts if quotes move to `/api/v1/quotes`).

**Problem.** One outside host now sets prices, and any positive decimal rate and any `YYYY-MM-DD`-shaped date is accepted. The only backstop is the 1–10,000 USDT range.

**Probes:**
- EUR rate 8.8877 (10× off): 20 EUR → **2.25 USDT**
- EUR rate 0.0088877 (100× off): 20 EUR → **2,250.30 USDT**
- an inverted rate (1.125 instead of 0.889) would short the merchant about 21% and pass
- dates `2019-01-02`, `2099-12-31` and `9999-99-99` are accepted; the checkout would show "rate of 2 Jan 2019" or "rate of Invalid Date"
- a duplicated EUR row: the later one silently wins

**Exploit sketch.** A Frankfurter compromise, an upstream bug or a semantics change (base and quote swapped) misprices every non-USD checkout. The customer only sees the converted figure, and the shop's API reply carries it too.

**Fix:**
1. Reject a rate outside a per-currency band (for example 0.5×–2× of a pinned reference table, or ±10% of the last good cached rate).
2. Check AED against its 3.6725 peg (±0.5%), as ARCHITECTURE §4b says.
3. Reject a `date` more than 7 days old or later than tomorrow (UTC).
4. Reject duplicate quotes.
5. Add tests for the `base` and `date` checks (mutants M4 and M6 survive today).

### F2 MEDIUM, NEEDS THE USER: two FX definitions in the shared docs
**Problem.** ARCHITECTURE §4b says Frankfurter **v1**, AED via its **fixed 3.6725 peg**, and FX owned by claude-contracts (`POST /api/v1/quotes`). The spec's phase-B decisions and `lib/fx.ts` use **v2**, with AED from Frankfurter.

The money effect today is nil: the live AED rate is 3.6725. But two FX code paths in one gateway could price the same item differently (a link through contracts' quote, a session through `lib/fx.ts`). PIPELINE §2 says to stop and ask when the documents disagree.

**Fix.** Have one FX module, the one build-claude-frontend.md already proposes, and have the human confirm v2 or v1 and the AED peg or Frankfurter.

Owner: claude-research and the human (docs), then the FX owner lane.

### F3 LOW: /docs is outside the CSP
**Problem.** `next.config.ts:37-42` covers /checkout, /pay, /r and /merchant but not /docs. /docs loads nothing third-party, hosts the "Simulate a payment" form and shows the key prefix to the shop wallet. I found no injection vector (the Host value is rendered as escaped text), so this is defence in depth.

**Fix:** add `{ source: "/docs", headers: csp }` to `next.config.ts`.

Owner: claude-frontend.

### F4 LOW: returnUrl is stored as given, and its check lives only in the route
`app/api/v1/sessions/route.ts:49-53,114`. Owner: claude-frontend.

**Problem.** Validation parses the URL but stores the raw string. For example, `"\u0000https://shop.example"` is accepted. React then writes the NUL into the `href`, the HTML parser turns it into U+FFFD, and the link becomes relative to our own origin. That is broken, not exploitable: no scheme bypass was found.

**Fix:**
1. Store `new URL(value).href`.
2. Move the http/https and ≤ 200 check into `createSession` (`lib/sessions.ts:58`). That way the links and pages routes that claude-contracts builds (spec: they "create sessions through it") can't skip it by calling the lib directly.

### F5 LOW: /docs shows 6 characters of the real secret, and builds GATEWAY_URL from request headers
`app/docs/page.tsx:171,156`. Owner: claude-frontend.

**Problem.** The spec allows a prefix. But unless `SHOP_API_KEY` starts with a fixed public prefix such as `sk_test_`, those 6 characters are secret material, shown to the shop wallet only. GATEWAY_URL comes from `Host` / `X-Forwarded-Proto`, which reflects only to the requester; the render is dynamic, so there is no cache poisoning today.

**Fix:** show a SHA-256 fingerprint or a fixed public prefix, and take the origin from a configured public URL before deploying behind a CDN.

### F6 LOW: the idempotency store has no cap, and a rejected create would be replayed
`app/api/v1/sessions/route.ts:23,37,40-43`. Owner: claude-frontend.

**Problem:**
- An authenticated shop can add unlimited keys for 24 h, and each request scans the whole map.
- If `create` ever rejects, `replies.delete` never runs, so the same key returns 500 for 24 h. `create` can't throw today, so this isn't reachable now.
- The hash is over the raw body, so the same JSON with different spacing gets 422. That is fine for the SDK.

**Fix:**
1. Wrap the `await reply` in try/finally to delete the slot on a throw.
2. Cap the map.
3. Add a two-merchant test when FR-GW-6 lands (M8 survives today).

### F7 LOW: /api/v1/payments trusts Blockscout for txHash, invoiceId and paidAt
`app/api/v1/payments/route.ts:47-51`. Owner: claude-frontend.

**Problem.** Amount, refunded and merchant are read on chain, but the label fields come from the index. A wrong index could call a sale an invoice, or link the wrong transaction.

**Fix:** document these fields as index data in the API docs, or confirm them from `eth_getTransactionReceipt(txHash)` logs.

### F8 LOW: FX failures aren't negative-cached, and a cache miss isn't deduplicated
`lib/fx.ts:52-55`. Owner: whoever exposes `/api/v1/quotes`.

**Problem.** Today only authenticated session creation reaches it. Once a public quotes route wraps `quote()`, every request during a Frankfurter outage starts a 5 s outbound fetch.

**Fix:** keep one in-flight promise, and cache a failure for about 30 s.

### F9 INFO: the reference limit counts UTF-16 units
40 emoji count as 80 units and get 400. Align the count with claude-sdk's client-side check.

Owner: claude-frontend + claude-sdk.

## NEEDS THE USER
1. F2: which FX definition is right, ARCHITECTURE §4b (v1, AED peg, contracts-owned) or the batch spec (v2 for all five, `lib/fx.ts`)?
2. F1 (PIPELINE §11, a spec assumption that is a product decision): do we accept one outside FX host setting non-USD prices with no sanity band for the demo, or add the band now?
