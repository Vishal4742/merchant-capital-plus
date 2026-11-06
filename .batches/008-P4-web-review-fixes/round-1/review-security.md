VERDICT: PASS

# Security review: 008-P4-web-review-fixes, round 1 (reviewer-security, phase mode, Money: yes)

No HIGH or CRITICAL findings. Every fix asked for is in place and does what it says. What follows is three LOW items and three INFO items. None of them blocks under §3b.

## How it was checked
- **Read:** the spec, `git diff -- apps/web` (11 files) plus the new `test/relay-auth.test.mjs`, and batch 006 round 2's review-security.md and review-code.md.
- **Client-import closure:** a script followed every `"use client"` module (12 of them) through its relative and `@/` imports. None of them reaches `lib/relay.ts`, `lib/server/*` or `lib/config.ts`. `Invoices.tsx` imports only `merchant-wallet`, `usdt` and `Button`. A search of `.next/static` (built 06:24) for `x-relay-secret` or `RELAY_API_SECRET` found nothing, and `next.config.ts` has no `env:` key that would inline it.
- **Tests, run in a scratch copy** (scratchpad `sec008`, `.env*` excluded, RELAY_API_SECRET unset): **298 tests, 295 pass, 0 fail, 3 skipped**, the same as reported.
- **Six mutants, run one at a time in the scratch copy:**
  - Killed:
    - the merchant check removed from GET :id
    - `.trim()` removed from relayAuth
    - the FX band disabled
    - DEMO_LIMIT raised to 11
    - MAX_PAYMENT raised by one cent
  - **Survived:** the idempotency `finally` going back to deleting by slot. See F5.
- **Redirect probe:** two local servers, with a POST that gets a 307 to another origin. Node 26 `fetch` **forwards `x-relay-secret` and the body** to the new origin. It strips only `Authorization`. See F2.
- **`next start` and x-forwarded-for:** `node_modules/next/dist/server/base-server.js:601` sets `req.headers['x-forwarded-for'] ??= socket.remoteAddress`. Because of the `??=`, a header the client sends is kept as it is. See F1.
- **Env files:** I did not read or print any `.env` file. One early search used `--include='*.example'`, which could have matched `.env.example`. It found nothing. After claude-research's 06:28 rule, every later search left out `.env*`.

## Secret grep (mandated), on the 11 diff files plus relay-auth.test.mjs
`grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` hits:
- `test/relay-auth.test.mjs:2,7,26,27,29,32,35,36,39,42`: the env var's name and a fake test value (`"relay-secret-for-tests-0123456789"`). Not a real secret.
- `test/checkout-edges.test.mjs:12`: an existing fake `AUTH_SECRET` test value.
- `app/docs/page.tsx:19,43,174`: the env var names `GATEWAY_SECRET_KEY` and `GATEWAY_WEBHOOK_SECRET` inside a code snippet shown in the docs. These are names only, with no values.
- `lib/relay.ts:49,52`: the env var name, read with `process.env`.
- **No 64-hex literal** in any of these files: the test fixtures build theirs with `"2".repeat(64)`.

## The checks asked for

**The relayer secret (`lib/relay.ts:51-54, 63`): OK.**
- **Server-side only:**
  - Its only importers are the two pay routes (`app/api/v1/sessions/[id]/pay/route.ts:8`, `app/api/v1/invoices/[id]/pay/route.ts:10`) and the server page `app/merchant/page.tsx:19`, which uses only `relayerHealth`.
  - No client module reaches it, directly or through another module (the closure check above).
  - The name has no `NEXT_PUBLIC_` prefix, so Next never inlines it.
- **Never logged, returned or put in a URL:**
  - `relay()` logs nothing, and every message it returns is a constant.
  - The relay-auth test asserts the secret is not in the result.
  - It travels only as a request header.
  - Its target, `relayerUrl`, comes from `RELAYER_URL` through `payConfig()` (`lib/config.ts:19-22`). It never comes from a request, so a caller can't point the secret at their own host.
- **A blank value sends no header:** `?.trim()` and then a truthiness check. It is tested with an unset value and with `"   "`, and the trim mutant is killed.
- `relayerHealth` (GET /health) sends no secret. That is right for a public health check.

**The 1,000 USDT cap: OK on every session path.**
- **Sessions API:** `app/api/v1/sessions/route.ts:102` checks against `MIN_PAYMENT`/`MAX_PAYMENT` after the FX conversion. Tests cover 1000.00 (201), 1000.01 (400) and 900 GBP (400). The +1 cent mutant is killed.
- **Links and pages:** `lib/server/links.ts:77` uses the same cap.
- **Demo checkout:** a fixed 25 USDT.
- **Vouchers and quotes:** they also cap at MAX_PAYMENT (`lib/server/vouchers.ts:96`, `lib/server/quotes.ts:74`).
- **No other caller of `createSession`** exists (searched every `.ts` and `.tsx` file under app, lib and components).
- **Invoices:** the client cap is in place (`components/merchant/Invoices.tsx:38,164`). It is a local constant, so no server code reaches the bundle. The invoice pay route has no server-side cap; see F3.

**FX bands (`lib/fx.ts:27-34, 75-78`): OK.**
- **Direction:**
  - Frankfurter's `rate` is units of the currency per 1 USD (`base=usd`).
  - `inBand` compares that raw rate with the band, and `toUsdt` divides by it.
  - Both read the rate the same way, so the band and the conversion agree.
- **Flipped rates are refused:**

  | Currency | Flipped rate | Band |
  |---|---|---|
  | EUR | 1.1252 | at most 1.0221 |
  | GBP | 1.3473 | at most 0.8536 |
  | SGD | 0.7828 | at least 1.0858 |
  | INR | 0.0106 | at least 80.33 |

  The test covers all four (`test/fx.test.mjs:122-125`), plus 16% off (refused) and 14% off (used). The band-off mutant is killed by 3 tests.
- **The edges compared with claude-contracts' numbers:**

  | Currency | Computed edges | claude-contracts |
  |---|---|---|
  | EUR | 0.7554375–1.0220625 | 0.7554–1.0221 |
  | GBP | 0.6309125–0.8535875 | 0.6309–0.8536 |
  | SGD | 1.08579–1.46901 | 1.0858–1.4690 |
  | INR | 80.325–108.675 | 80.33–108.68 |
  | AED | 3.635775–3.709225 | 3.635775–3.709225 (exact) |

  The two sets differ only in rounding at the 5th significant digit (at most 0.006%). This is INFO and can't be exploited. Pick one set for both modules when lib/fx.ts is deleted (PR #11).
- **No other currency gets through:** a currency with no band is refused, because `band !== undefined` fails.

**The idempotency `finally` (`app/api/v1/sessions/route.ts:50`): OK.**
- `replies.get(slot)?.reply === reply` compares the promise this request created itself. A newer entry under the same slot holds a different promise, so it is never deleted.
- When the request throws, `done` is undefined, and it still deletes only its own entry.
- **The test the spec asks for is missing** (F5).

**`/api/demo-checkout` (`app/api/demo-checkout/route.ts:17-22`): no open redirect.**
- `to()` is only ever called with the literal `"/merchant"` or `` `/checkout/${session.id}` ``.
- `session.id` is `randomUUID()` (`lib/sessions.ts:76`), made on the server, so nothing from the request reaches `Location`.
- The 429 body is a plain string (text/plain), with no HTML.
- The rate limit works as tested. Its key can be spoofed; see F1.

**`GET /api/v1/sessions/:id` (`:19`): OK.** Another merchant's checkout gets the same 404 as a missing one, so the reply doesn't reveal whether the id exists. The test is at `test/sessions-v2.test.mjs`, and the mutant is killed.

**/docs: OK.**
- The wordmark is a plain `<a href="/">` (`app/docs/page.tsx:75`), with the eslint-disable on `:74`.
- `headers()` is awaited before `currentMerchant()` (`:156-157`).
- Nothing in it touches security beyond R2-F3, which is now fixed.

## Findings

### F1 LOW: the demo rate limit can be bypassed by spoofing X-Forwarded-For off Vercel, and neither the limiter nor the sessions map ever evicts
`app/api/demo-checkout/route.ts:19`, `lib/server/http.ts:127-137,143`, `lib/sessions.ts:67,82`. Owners: claude-frontend (demo route), claude-contracts (`lib/server/http.ts`).

**Exploit.**
- Under `next start` (the :3100 demo, or behind a tunnel that adds to XFF), `clientIp` takes the first XFF hop. The client controls that hop: Next keeps an existing header (`??=`), and proxies that add to XFF keep the client's value first.
- A loop that sends `X-Forwarded-For: <random>` gets past the 10-per-minute limit.
- Each request adds one entry to `hits`, keyed by an XFF value of up to about 16 KB, and one session to `sessions`. Neither map ever drops an expired entry.
- The result is memory exhaustion of the demo server. On Vercel this doesn't work: Vercel overwrites XFF.
- It is test mode and no money moves, hence LOW. It is the remaining half of R2-F8, whose fix part 2 ("drop sessions that expired more than 24 h ago") is not in this batch.

**Fix.**
1. In `rateLimit`, drop expired entries when the map passes a size, or cap it the way `replies` is capped (oldest first).
2. In `clientIp`, cut the key to 64 characters. Prefer `x-real-ip` or the last hop when not on Vercel.
3. In `lib/sessions.ts`, sweep sessions that expired more than 24 h ago on `createSession`.

### F2 LOW: `x-relay-secret` follows a cross-origin redirect and can travel over plain http
`lib/relay.ts:61-66`. Owner: claude-frontend.

**Exploit.**
- The POST /relay `fetch` uses the default `redirect: "follow"`.
- In the probe, Node 26 sent `x-relay-secret` and the signed body on to the new origin after a 307. It strips only `Authorization`.
- So if the relayer host, or anyone on an http path to it, answers with a 307 or 308 to their own origin, they receive the shared secret.
- Nothing checks that `RELAYER_URL` is https, so on a plain-http remote URL the secret is readable on the wire anyway.
- This needs a compromised relayer host or a man-in-the-middle position, hence LOW. Today's relayer, which asks for no secret, is unaffected.

**Fix.**
1. Add `redirect: "manual"` to the POST /relay fetch. A 3xx then falls through to the existing "didn't go through. Nothing was charged." branch at `:85`, which is true: the relayer never processed the request.
2. Attach the header only when `new URL(relayerUrl).protocol === "https:"` or the host is loopback.

### F3 LOW: no server-side 1,000 USDT cap on invoice payments
`app/api/v1/invoices/[id]/pay/route.ts:59,75`. Owner: claude-frontend (or claude-contracts in MerchantPay or the relayer, if the cap should live on chain).

**Problem.**
- The cap on invoices is only in the dashboard form (`Invoices.tsx:164`).
- The shop's wallet can call `MerchantPay.createInvoice` directly with 5,000 USDT. The pay route reads `invoice.amount - invoice.paid` from the chain and relays it without checking.
- Only the configured shop's own invoices get through (`isShopInvoice`), and the customer signs the exact amount, so no one is cheated. Still, the §4b testnet safety cap ("per payment") isn't enforced on this path.

**Fix.** Add one line after `:59`:
```ts
if (terms.amount + terms.fee > MAX_PAYMENT) return fail(400, "...");
```
Or enforce the cap in the relayer's allowlist checks.

### F4 INFO: R2-F2 (a repeated quote row silently wins) is still open
`lib/fx.ts:93`. Owner: claude-frontend. With the ±15% band, a repeated row can now move a price by at most ±15%, not about 2×. The fix stays one line: refuse the whole answer when `rates.has(row.quote)`.

### F5 INFO: the spec's idempotency test is missing
The spec asks for "Test: an evicted, then failed, request doesn't delete a newer entry." No such test exists, and the mutant that goes back to `replies.delete(slot)` survives all 298 tests. The code is correct. Owner: claude-frontend (tester).

### F6 INFO: the FX band edges differ from claude-contracts' numbers only in rounding
The table above has the computed edges. Both modules should use one set of numbers.

## Outside this batch
- claude-research's 06:28 rule asks claude-relayer to rotate RELAY_API_SECRET. The web side needs no code change, only the new value in `.env.local` and on Vercel.
- The secret-hygiene note from 006 R2 (`.shopkey` and `.authsecret` in a session scratchpad) is not tracked here. I did not open those files.
