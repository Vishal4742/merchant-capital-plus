VERDICT: PASS

# Security review: 005-P4-sdk-core, round 1 (fast mode, PIPELINE §3a)

**Scope:**
- the diff `1fbf647..HEAD` (packages/sdk/{index.ts, README.md, package*.json, tsconfig.json, test/sdk.test.ts} and .github/workflows/ci.yml);
- the untracked packages/sdk/test/edges.test.ts;
- for context, the real handlers in ~/ethglobal/apps/web/app/api/v1/sessions/ and `shopAuthorized` in apps/web/lib/config.ts.

**Method:** I read the code and ran probes. The probe script is in the scratchpad (`secprobe/probe.ts`, `secprobe/inspect.ts`). It imports index.ts on Node v26.10.0 and talks to local HTTP servers with made-up keys only. No .env was read.

**Result:** I found no HIGH or CRITICAL issue.
- A webhook can't be forged without the secret.
- The comparison is constant-time on fixed 32-byte buffers.
- The default replay window holds.
- The secret key never goes into a URL or a log line from the SDK, and it doesn't show in `util.inspect` or `JSON.stringify`.
- Node 26's fetch drops `Authorization` on cross-origin 301/302/307/308.
- The currency guard fails closed for every non-USDT input.
- A retried POST can't double-charge anyone.

Nine MEDIUM/LOW items follow; they go to the lane's next batch.

## Checks that passed (with evidence)
| Area | Result |
|---|---|
| Forgery | You need the HMAC key. `v1` must match `^[0-9a-f]{64}$` before `timingSafeEqual` (index.ts:96, :101). The buffers are always 32 bytes, so a length mismatch can't throw a RangeError. A zeroed or prepended bad `v1` is rejected (edges.test.ts:21). |
| Timing | The regex and tolerance checks depend only on attacker input, never on the secret. The HMAC work doesn't depend on `v1`. |
| Replay outside the window | Rejected by default (±300 s, index.ts:98). With duplicate `t` keys the last one wins: `t=1,t=<now>` passes and `t=<now>,t=1` is rejected. Either way the HMAC must match the `t` that is used, so the window can't be extended. |
| Header tricks | `t` is 1 to 12 ASCII digits, so it can't overflow (13 digits are rejected). Non-hex, uppercase, 63-char `v1`, spaces around `=`, and an empty, `null`, `undefined` or garbage header are all rejected. Leniencies that are safe: `v1=<hex>=junk` (`split("=", 2)` drops the tail) and a leading zero on `t` (the HMAC uses `Number(t)`). Both still need a valid MAC for the same instant. |
| Raw body | The SDK takes a string or `Uint8Array` and HMACs it as given. A re-serialized body fails closed. An object passed from JS throws a TypeError, which also fails closed. |
| Empty secret (receiver) | Refused (index.ts:93). |
| Key exposure | `#key` is a true private field: `inspect` with `showHidden`, `JSON.stringify` and `Object.keys` don't show it. The key appears only in the `authorization` header, never in a URL or query. The SDK has no logging. |
| Cross-origin redirect | Probed with a 127.0.0.1 → localhost redirect: `Authorization` was absent on the second hop for 301, 302, 307 and 308. |
| Browser guard | It catches mistakes, not attackers. The top-level `import "node:crypto"` already breaks browser bundles at build time. `pk_` / `pk_test_` keys are refused (index.ts:125). |
| FR-GW-11 guard (index.ts:139) | `EUR` on today's server is refused (live run in test.md). `"usdt"` and `""` are refused, so it fails closed. `null` and `undefined` mean USDT. On today's code path a shop can't get back a `url` for a checkout priced in the wrong unit. |
| Retries and double charge | Each attempt makes a separate unpaid session. Its signature is bound to that session's random 32-byte `orderRef` (apps/web/lib/sessions.ts:46, lib/pay.ts:46), and `paySale` accepts each `(merchant, orderRef)` once. Only the last session's URL reaches the customer. Orphaned sessions are unguessable UUIDs and expire. So no double charge. |
| PII | `reference`, `items` and `returnUrl` stay in the web app. On-chain there is only the random `orderRef`, and nothing goes to Arkiv (grep). |
| CI job (ci.yml:61-75) | No `${{ }}` interpolation in `run:`. Top-level `permissions: contents: read`. The trigger is `pull_request`, not `pull_request_target`. No secrets are used. `npm ci` installs from a lockfile with registry.npmjs.org `resolved` + `integrity` and no `hasInstallScript` entries. |

## Mandated grep
`grep -rnE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --include=*` on the diff's files, plus edges.test.ts, build-claude-sdk.md and test.md:
- **ci.yml:83:** the secrets job's own detector regex (`PRIVATE_KEY=0x…`). Not a secret.
- **sdk.test.ts:8 and edges.test.ts:6:** `const SECRET = "whsec-test-0123456789abcdef"`, a made-up test fixture. The other hits in both test files only reference that constant.
- **README.md:8 and :19:** the env var names `GATEWAY_SECRET_KEY` and `GATEWAY_WEBHOOK_SECRET`. These are names, not values.
- **0x + 64 hex:** no hits.
- **Real-key shape** (`sk_(test|live)_…{16,}`, `whsec_…{16,}`): no hits.
- `.env` is git-ignored and not tracked.

## FOLLOW-UP (MEDIUM/LOW; not blocking in fast mode)

### 1. MEDIUM: a misconfigured key leaks into `GatewayError.message`
- **Where:** index.ts:173 (key validation is missing at :124).
- **What happens:** if the key has a leading or embedded CR or LF (for example a mis-quoted multi-line `.env` value, or `"\nsk_…"`), undici throws `Headers.append: "Bearer sk_…" is an invalid header value.`. The SDK copies that message verbatim into `Couldn't reach the gateway: …`.
- **Probe:** the message contained the key (`leaks: true`) for `"sk_test_AB\nCD…"` and `"sk_test_AB\rCD"`.
- **Exploit:** shops log errors and ship them to Sentry and similar services, so the secret key lands in third-party logs. A trailing newline is safe (header normalisation strips it); a leading or embedded one leaks.
- **Fix:** in the constructor, refuse a key that doesn't match `/^[\x21-\x7e]+$/`, with a message that doesn't echo the key. As a belt-and-braces step, also run `.replaceAll(this.#key, "[redacted]")` on `err.message` at :173.
- **Owner:** claude-sdk.

### 2. MEDIUM: `toleranceSec: NaN` or `Infinity` silently turns off replay protection
- **Where:** index.ts:98.
- **What happens:** `x > NaN` is false.
- **Probe:** a 10-year-old signed event was accepted with `NaN`, `Infinity` and `Number(undefined)`.
- **Exploit:** a shop writes `{ toleranceSec: Number(process.env.WEBHOOK_TOLERANCE) }` and leaves the variable unset. Any captured delivery can then be replayed forever.
- **Fix:** take `const tol = opts.toleranceSec ?? 300` and throw unless `Number.isFinite(tol) && tol >= 0`. Alternatively write the check as `!(Math.abs(…) <= tol)`, which fails closed on NaN.
- **Owner:** claude-sdk.

### 3. MEDIUM: a plain `http://` baseUrl sends the secret key in cleartext
- **Where:** index.ts:126-128.
- **What happens:** the constructor accepts any URL that parses: `http://merchant-capital.vercel.app`, `ftp://x` and even `javascript:alert(1)`.
- **Exploit:** with `http://` the first request carries `Bearer sk_…` in plaintext. Vercel then answers 308 to https, and fetch strips the header on that hop, so the leak is already done. Anyone on the network path can capture the key.
- **Fix:** require `https:`, except when the hostname is `localhost`, `127.0.0.1` or `[::1]` (needed for the integration test).
- **Owner:** claude-sdk.

### 4. MEDIUM: the README teaches crediting by `status` or `reference` alone
- **Where:** README.md:13-14 and :20.
- **Retrieve example:** it counts an order as paid "when status is paid" for some `id`, and the snippet doesn't say where `id` comes from. A shop that reads it from the return URL (the common Stripe-style `?session_id=`) can be fooled: the customer pays a 1 USDT checkout, then visits the return URL of a 1,000 USDT order with the paid session's id.
- **Webhook example:** `markPaid(event.data.reference)` ignores the amount. Once batch 007's pages with open amounts and links send webhooks carrying a `reference`, a customer-influenced payment could credit a shop order.
- **Why it matters:** this README is what the AT-14 shop copies.
- **Fix:** look the session up by the id stored with the order, never one from the URL. Then check `session.reference === order.id`, `session.amount === order.total` and `status === "paid"`. In the webhook handler, also check the amount and skip events where `link_id`/`page_id` is set.
- **Owner:** claude-sdk (README). Tell claude-contracts that link/page `reference` must never collide with API order references.

### 5. MEDIUM: `orderId` is silently truncated to 40 characters and trimmed by the server
- **Where:** index.ts:136-137; apps/web/app/api/v1/sessions/route.ts:27.
- **What happens:** two orders whose ids share the first 40 characters come back with the same `reference`, so `markPaid(reference)` credits the wrong order.
- **Fix:** in the SDK, throw if `orderId` is longer than 40 characters or has surrounding whitespace. On the server, return 400 instead of truncating.
- **Owner:** claude-sdk for the SDK guard; claude-frontend for the server, in sessions v2.

### 6. LOW: `retrieve("..")` and `retrieve(".")` escape the sessions path
- **Where:** index.ts:144.
- **Probe:** they request `/api/v1/` and `/api/v1/sessions/`. `encodeURIComponent` leaves dots alone, and `new URL` then normalises the segment.
- **Impact:** only a same-origin GET sent with the key, so the impact is small today.
- **Fix:** refuse an id that doesn't match `/^[A-Za-z0-9_-]{1,64}$/` (session ids are UUIDs).
- **Owner:** claude-sdk.

### 7. LOW: the SDK follows redirects
- **Where:** index.ts:163/170.
- **What happens:** the gateway API never redirects, yet a custom `fetch` (the `opts.fetch` hook) might not strip `Authorization` cross-origin. A 301 or 302 on the POST also silently turns it into a GET.
- **Fix:** add `redirect: "error"` to `init`.
- **Owner:** claude-sdk.

### 8. LOW: the currency guard only checks one direction
- **Where:** index.ts:139.
- **What happens:** when the shop asks for USDT (the default), a server that echoes a different currency is not checked.
- **Fix:** use the symmetric form `(session.currency ?? "USDT") !== (params.currency ?? "USDT")`. It also covers the human's 03:02 rule, USD = USDT 1:1, which keeps working because the server echoes `USD`.
- **Owner:** claude-sdk.

### 9. LOW: smaller items
- **`signWebhook` with an empty secret:** index.ts:86 signs happily with `""`; the receiver refuses it, so this is no forgery path. Throw on an empty secret for symmetry, since the gateway's sender imports this function.
- **No idempotency key by default:** when the caller gives none, generate one per `create` call with `randomUUID()` (index.ts:162). Then the retries dedupe automatically once the server honours `Idempotency-Key` (§4b).
- **Replay inside the 300 s window:** tell shops in the README to dedupe on `event.id`. The gateway's 1 m / 5 m / 30 m retries resend the same id.
- **CI:** actions are pinned to major tags, not SHAs (the same as the existing jobs). `npm ci --ignore-scripts` would be a cheap extra hardening.
- **Cross-lane, not in this diff:** when sessions v2 starts honouring `returnUrl`, the server must accept only `http:`/`https:`. Otherwise `javascript:` becomes an XSS on the checkout's "Back to shop" link. Owner: claude-frontend.

## NEEDS THE USER
- PIPELINE §11 flag: the CI workflow changed. It adds one `sdk` job and the `sdk` push branch. I reviewed it as safe (read-only token, no secrets, no injection).
