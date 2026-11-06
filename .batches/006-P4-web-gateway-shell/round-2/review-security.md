VERDICT: PASS

# Security review: 006-P4-web-gateway-shell, round 2 (reviewer-security)

Fast mode (PIPELINE §3a): only HIGH or CRITICAL findings block. I found none. All seven round-1 findings (F1, F3–F7) are fixed as the spec's round-2 decisions describe. One MEDIUM residual (the FX bands are wide enough to pass an inverted rate) needs the human. The rest are LOW or INFO and go under FOLLOW-UP.

Scope: the 17 files in round-2/build.md, read in `/Users/vg890/ethglobal/apps/web`, plus the callers they touch. I did not read `.env` or `.env.local`, and I did not restart :3100. I sent only GET requests to `:3100/docs`. All mutants and probes ran in a scratch copy that left out the env files.

## How it was checked
- **Tests:** in the scratch copy, **293 tests: 290 pass, 0 fail, 3 skipped (LIVE)**, the same as build.md. `gw-sdk-compat` imports `../../packages/sdk` by relative path, so the copy needed a `packages` symlink.
- **Mutants:** 29 in the scratch copy (`sec006r2/mutate.sh`, run one at a time). 23 were killed and 5 survived (listed under R2-F6). One more was equivalent: M6e, the date regex removed, is still covered by the round-trip check.
- **FX probe** (`sec006r2/fx-probe.mjs`): 40 faked Frankfurter answers, plus a rounding property check over 20,000 random amounts and rates.
- **Sessions probe** (`sec006r2/sessions-probe.mjs`): 42 returnUrl values through the route, 8 through `createSession` directly, and idempotency (replay, 422, a 503 then a retry, a 400 then a corrected retry, the cap, two requests at once, a wrong Bearer token, a 256-character key).
- **Live /docs** (GET only): headers and `GATEWAY_URL` with the real Host header, a forged `Host`, a forged `X-Forwarded-Host` and a forged `X-Forwarded-Proto`.

Scratchpad: `/private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/sec006r2/`

## Secret grep
I ran `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over the 17 round-2 files and over every modified or untracked file under apps/web, excluding `.env*`. Every hit is harmless:
- `app/docs/page.tsx:20,44,172`: env var **names** inside the snippet template strings and copy (`GATEWAY_SECRET_KEY`, `GATEWAY_WEBHOOK_SECRET`). There is no `${}`, so nothing is inlined.
- `test/checkout-api.test.mjs:252,258`, `test/invoice-pay.test.mjs:107`: nonce test vectors (public keccak outputs). These were there before this batch.
- `test/checkout-edges.test.mjs:12`: a fake `AUTH_SECRET` fixture. Also there before this batch.

## Round-1 findings: verified

### F1 (FX sanity bands, stale or future date): FIXED as specified, with a MEDIUM residual (R2-F1)
`lib/fx.ts:25-31,64-75,89-90`. The code refuses each of these with `FxUnavailableError` (503, nothing created, nothing cached):
- 10× and 100× EUR
- `1e-7`, `1e21`, a string rate, `null`, a negative rate
- base `EUR` or `usd`
- AED at 1.0 or 3.75 (+2.1%)
- INR inverted (0.0106)
- dates `2019-01-02`, 8 days old, the day after tomorrow, `2099-12-31`, `9999-99-99`, `2026-02-30`, `2026-11-31` (V8 reads it as 1 Dec), an ISO timestamp, a leading space, a number
- a non-array body, HTTP 500, bad JSON

What passes:
- 7 days old and tomorrow pass, as the spec says.
- A `__proto__` quote row is ignored (`USD_PER_UNIT["__proto__"]` has no `[0]`, so the band compare is false).
- A null row is skipped.

Cache behaviour:
- One currency out of band fails every currency, so the check fails closed.
- Within 15 minutes a bad answer never replaces a good cache (0 fetches).

Mutants: M4 (base check) and M6 (date check) **survived in round 1 and are now killed**. M6b (round-trip), M6c (no future bound), M6d (30-day age), B1 (no band), B2 (band compared on `rate`, not `1/rate`), B3 (AED ±5%) and B4 (EUR 0.25–4) are all killed too.

**Can an attacker-shaped Frankfurter reply still set a price? Yes, inside the band.** See R2-F1.

### F3 (/docs CSP): FIXED
`next.config.ts:44`. Live `GET :3100/docs` carries the full strict CSP, and so does `/docs?x=1`. `/docs/` answers 308 to `/docs`. No test pins it: mutant C1 (the line removed) survives, see R2-F6. Side effect: R2-F3.

### F4 (returnUrl): FIXED
`lib/sessions.ts:15-19,72-73`, `app/api/v1/sessions/route.ts:73-74`.

Refused (400 from the route; `createSession` throws):
- `javascript:` in any case, with a leading space, `\t` or `\n` inside it, or a leading `\u0000` or `\u0001`
- `data:`, `vbscript:`, `file:`, `blob:`, `ftp:`, `ws:`
- `//evil.example`, `/\evil.example`, `\\evil.example`
- `%6Aavascript:`, `javascript%3A`, `https%3A%2F%2F…`, `&#106;avascript:`
- 201 characters; a raw 61-character URL whose href is 261 characters (40 × `é`); port 99999
- `""`, `null`, `42`, an array, an object

Accepted, and stored as the parsed href:
- `"\u0000https://shop.example"`, `"https://shop.example\u0000"` and `"\u001fhttps://…"` are stored as `https://shop.example/`. The round-1 NUL case is gone.
- `"…/\u0007x"` → `%07x`, and `"…/\"><script>"` → `%22%3E%3Cscript%3E`.
- `http:\\evil.example`, `https:evil.example` and `https:/evil.example` normalise to proper http(s) URLs. That is fine: only the key holder sets returnUrl.
- An IDN is stored as punycode.

`createSession` called directly refuses the same set. That closes the bypass for claude-contracts' `lib/server/links.ts:79`, which today passes no returnUrl.

Mutants:
- killed: U1 (createSession skips the check), U2 (raw text stored), U4 (no scheme check), U5 (route check removed; createSession then throws a 500)
- survived: U3 (length measured on the raw text), see R2-F6

### F5 (/docs key display, PUBLIC_ORIGIN / Host): FIXED
`lib/config.ts:35-46`, `app/docs/page.tsx:154-178`.

The key:
- `keyFingerprint` is 8 hex characters of SHA-256. The only `config.apiKey` read on the page is `docs/page.tsx:171`, inside a server component, and only when the SIWE wallet equals `MERCHANT_ADDRESS`.
- Signed out, the live page has no fingerprint.
- The only value passed to the client `CopyButton` is the `GATEWAY_URL=` origin line.
- Mutants killed: K1 (key prefix shown), K2 (16 hex), O1 (PUBLIC_ORIGIN ignored), O2 (any scheme kept).

Host header:
- **A forged Host does reach the snippet, but only in the forger's own response.** Live, with PUBLIC_ORIGIN unset on :3100, `Host: evil.example` plus `X-Forwarded-Proto: https` gave `GATEWAY_URL=https://evil.example`. `X-Forwarded-Host` is ignored.
- A merchant's browser can't be made to send a forged Host.
- The response is `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`, so no shared cache can serve the forged copy to someone else.
- The value renders as escaped text in a `<pre>`, never in an `href`. `X-Forwarded-Proto: javascript` only produces a broken string.
- **Not exploitable for a merchant who copies from their own page.** Hardening is in R2-F4.

### F6 (idempotency cap, delete on failure): FIXED
`app/api/v1/sessions/route.ts:16,36-51`.

What the probes showed:
- Same key and same body: same id. A different body: 422.
- A 503 (FX down), then a retry with the same key: 201. A 400, then a corrected body with the same key: 201. So a failure frees the key.
- Two requests at once: one checkout.
- A wrong Bearer token with a used key: 401. Auth runs before the lookup, so an outsider gets nothing from the store.
- A 256-character key: 400.
- After 1,100 more keys, the store holds at most 1,000. The oldest key is forgotten and makes a new checkout; recent keys still replay.

**Can one caller's key return another caller's session?** No. The only accepted credential is the single `SHOP_API_KEY`, so every authorised caller is the same merchant, and the slot is prefixed with `config.merchant`.

**Can memory grow without bound?** Not through this store: at most 1,000 entries, each holding a ≤255-character key, a 64-character hash and a small reply. The 24 h sweep is O(n) with n ≤ 1,000. Unbounded growth remains elsewhere: the sessions map, through the anonymous demo route (R2-F8).

Mutants:
- killed: I1 (no delete on failure), I2 (no cap), I4 (replay ignores the body hash)
- survived: I3 (slot not per merchant, the round-1 M8, still untestable with one merchant config) and I5 (no 24 h expiry), see R2-F6

### F7 (index fields in /payments): FIXED (documented)
`app/api/v1/payments/route.ts:3-4,49,52,53` mark txHash, invoiceId and paidAt as index data. Amount, refunded and the merchant are still read on chain (`record.gross`, `record.refunded`, and `same(record.merchant, …)` at :43). The public /docs page doesn't say this yet. That is fine for now.

## Also checked

**Round-up never under-charges.** `toUsdt` (`lib/fx.ts:52-59`) is ⌈units·10^f / (R·10^4)⌉·10^4 in bigint maths. Over 20,000 random amounts (1–10,000) and rates (0.3–120, 1–6 decimals), it **never under-charged and never over-charged by more than one cent**, and every result was a whole number of cents.

Examples:
- 20 EUR at 0.88877 → 22.51 USDT
- USD 0.995 → 1.00 USDT
- USD 20.000001 → 20.01 USDT

The conversion runs once on the total, not per item. The 1–10,000 USDT range is checked after rounding. The checkout signs `session.amount`, which is the stored rounded value. Mutants R1 (floor) and R2 (half up) are killed.

**No secret in logs, URLs or pages.**
- Logs: `lib/fx.ts:108` and `payments/route.ts:61` log error messages from fixed public URLs (`api.frankfurter.dev`, `rpc.ankr.com/whitechain_testnet`; neither carries a key). No Bearer token, API key or Idempotency-Key is logged.
- URLs: no key travels in a URL.
- Client code: no `"use client"` file imports `lib/config`, `lib/sessions`, `lib/fx`, `lib/server`, `node:crypto` or `process.env`. The built client chunks in `.next/static` contain none of `SHOP_API_KEY`, `keyFingerprint`, `PUBLIC_ORIGIN` or `frankfurter`.
- Other: no `NEXT_PUBLIC_` and no new third-party origins.

**Other round-2 files.**
- `Checkout.tsx`: returnUrl is a same-tab `<a href>`; the link text is the server's merchantName; the referrer policy keeps the session id from the shop.
- `merchant/page.tsx`: data stays scoped to the SIWE wallet. A non-shop wallet sees only the shop's public address, truncated.
- `CopyButton`, `Shell`, `HoldButton` (comment only) and `InvoicePay`: UI only.

## FOLLOW-UP (MEDIUM / LOW / INFO: not blocking under §3a)

### R2-F1 MEDIUM, NEEDS THE USER: the bands still pass an inverted rate for EUR, GBP and SGD, and any price inside about 0.5× to 2×
`lib/fx.ts:25-31,72-75`. Owner: the human (band widths), then claude-frontend and claude-contracts (`BANDS` in their quotes.ts).

**Exploit.** Frankfurter, compromised or buggy, answers with `base:"USD"` but the rate the other way round (USD per unit instead of units per USD). The probes show:

| Answer | Result | Effect |
|---|---|---|
| EUR 1.1251 | 20 EUR → **17.78 USDT** instead of 22.51 | merchant short 21% |
| GBP 1.347 | 20 GBP → **14.85 USDT** instead of ≈26.94 | merchant short 45% |
| SGD 0.783 | 20 SGD → **25.55 USDT** instead of ≈15.66 | customer over-charged 63% |
| EUR 2 (a band edge) | 20 EUR → **10.00 USDT** | merchant short 55% |

The EUR band [0.5, 2] maps onto itself when inverted, so it can never catch an EUR swap. That swap is the case round-1 F1 named. INR and AED inversions are caught.

**Fix (pick one):**
- Narrow each band to about ±20–25% of today's rate, in USD per unit: EUR 0.9–1.4, GBP 1.05–1.7, SGD 0.6–0.98, INR 0.0085–0.013. Every inversion then fails, with room for normal FX moves over the event.
- Or refuse a rate that moved more than about 5% from the last good one.

Mirror the change in claude-contracts' `BANDS`.

### R2-F2 LOW: a repeated quote row silently wins
`lib/fx.ts:90`. Owner: claude-frontend (and the same loop in claude-contracts' `fetchRates`).

**Problem.** The normal rows plus a second in-band `EUR 0.5` price 20 EUR at **40.00 USDT**.

**Fix.** Refuse the whole answer when a quote repeats: `if (rates.has(row.quote)) throw new Error("sent EUR twice")`.

### R2-F3 LOW: the /docs wordmark is a `next/link`, so after F3 home can run inside the /docs CSP
`app/docs/page.tsx:74`. Owner: claude-frontend.

**Problem.** Clicking "Merchant Capital+" on /docs soft-navigates to `/` without a new document, so the strict CSP stays. Home then `<Link>`s to `/proofs`, whose Nym CDNs and gateways are blocked. This fails closed, so it is not a hole. It is the 005 F-N4 pattern, and the Shell already avoids it (`dashboard/Shell.tsx:14-16`).

**Fix.** Use a plain `<a href="/">`.

### R2-F4 LOW: GATEWAY_URL follows the Host header until PUBLIC_ORIGIN is set, and no template lists PUBLIC_ORIGIN
`app/docs/page.tsx:156`, `lib/config.ts:41-46`, `/Users/vg890/ethglobal/.env.example`. Owner: claude-frontend (the `.env.example` line through whoever owns that file).

**Problem.** Today the forged Host reaches only the forger (see F5). If a future CDN cached the streamed part despite `no-store`, it could be served to others.

**Fix:**
1. Add `PUBLIC_ORIGIN=` to `.env.example` and set it on Vercel.
2. Optionally, build the sessions reply `url` (`sessions/route.ts:121`) and the demo-checkout redirect with `publicOrigin()` too, so the gateway has one origin rule.

### R2-F5 LOW: GET /api/v1/sessions/:id doesn't check the checkout's merchant
`app/api/v1/sessions/[id]/route.ts:17-18`. Owner: claude-frontend.

**Problem.** claude-contracts' links and pages now create sessions for any merchant (`lib/server/links.ts:79`). The demo shop's key can then read another merchant's checkout (reference, amount, txHash, refunded) by id. UUIDv4 ids can't be guessed, hence LOW.

**Fix:**
```ts
if (!found || found.merchant.toLowerCase() !== config.merchant.toLowerCase()) return fail(404, "No such checkout.");
```

### R2-F6 LOW: surviving mutants (the code is right; nothing pins it)
Owner: claude-frontend.

| Mutant | What it changes | Test to add |
|---|---|---|
| U3 | returnUrl length measured on the raw text, not the href | `"https://shop.example/" + "é".repeat(40)`: 61 characters raw, 261 as href, must be 400 |
| C1 | the /docs CSP line removed | import `next.config.ts`, call `headers()`, assert `/docs` has the CSP |
| I3 (round-1 M8) | the idempotency slot not per merchant | a two-merchant test when FR-GW-6 keys reach this route; the slot must then use the key's merchant, not `config.merchant` |
| I5 | no 24 h expiry | a replay test at 24 h + 1 ms |

### R2-F7 INFO: the idempotency `finally` deletes by slot, not by entry
`app/api/v1/sessions/route.ts:50`. Owner: claude-frontend.

**Problem.** Suppose an in-flight entry is evicted by the cap and the same key is used again. If the first request then fails, it deletes the second request's entry, so a later retry makes a duplicate checkout. This needs 1,000 new keys inside one 5 s FX timeout, so it is negligible.

**Fix (one line):**
```ts
if (done?.status !== 201 && replies.get(slot)?.reply === reply) replies.delete(slot);
```

### R2-F8 LOW, carried (005 S6): anonymous checkout creation, unbounded sessions map
`app/api/demo-checkout/route.ts:5,16`, `lib/sessions.ts:67`. Owner: claude-frontend.

**Problem.** /docs adds a second public "Simulate a payment" form. Anyone can grow the in-memory sessions map with a POST loop, and nothing evicts it.

**Fix before any deploy:**
1. Reuse `rateLimit` / `clientIp` from `lib/server` on the demo route, as `links.ts` `limitCheckouts` does.
2. Drop sessions that expired more than 24 h ago.

## Outside this batch (for the owners; not part of this verdict)
- **claude-contracts:** the `backend` branch's `lib/server/quotes.ts` (84107ae, not on main yet) has the same bands, correctly converted to units per USD. But on a fetch failure it serves the last cache with no limit (`:82`, "a stale-but-checked rate beats none"). During an outage a rate can then outlive both the 15-minute cache and the 7-day rule. Cap the stale use, for example at 1 h or at the rate date plus 7 days. Until that branch merges, main's quotes.ts (v1, no bands) still prices links and pages.
- **Secret hygiene:** the session scratchpad holds `.shopkey` and `.authsecret` (mode 600, written 5 Nov 22:41). By their names they are secret material outside `.env`, which AGENTS.md forbids. I did not open them. Whoever wrote them should check that `.env.local` has the values, then delete the files.

## NEEDS THE USER
1. R2-F1: keep the 0.5×–2× bands (an inverted EUR, GBP or SGD rate passes), or narrow them to about ±20–25% of today's rate (or a ±5% move from the last good rate) in both FX modules?

**PASS**
