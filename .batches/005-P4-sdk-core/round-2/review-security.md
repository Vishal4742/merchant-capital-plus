VERDICT: PASS

# Security review: 005-P4-sdk-core, round 2 (fast mode, PIPELINE §3a; last allowed round)

**Scope:** `git diff bf648a6..3c131b4` (packages/sdk/{index.ts, README.md, test/sdk.test.ts, test/edges.test.ts}, build-claude-sdk.md, round-1/ci.md) plus the untracked packages/sdk/test/round2.test.ts. For context I read the real `POST /api/v1/sessions` and `GET /api/v1/sessions/:id` handlers, `shopAuthorized`, and ARCHITECTURE.md §4b on main.

**Method:** I read the code and ran probes. The probe script is `/private/tmp/claude-501/-Users-vg890-ethglobal/4b071a41-5a21-45c1-83b9-fc92c8c6526c/scratchpad/secprobe2/probe.ts`. It imports index.ts from the worktree on Node 26 and uses a local HTTP server with made-up keys only. I read no .env.
- `npm test`: `ℹ tests 28 · ℹ pass 28 · ℹ fail 0`.
- `npx tsc --noEmit`: exit 0.

**Result:** I found no HIGH or CRITICAL issue.
- All four round-1 MEDIUMs are closed in the SDK.
- Every bypass the caller asked about is refused, except two LOW leftovers: a `user:pass@` baseUrl, and a key the server echoes back.
- The README no longer lets a customer get an order credited by paying a cheaper session. One MEDIUM gap is left: it never compares amounts, which matters once an order total can change or the hosted checkout gets vouchers (batch 007).

Contracts, relayer, Arkiv and web UI: not in this diff (no change to CI either).

## Round-1 findings: status
| # | Round-1 finding | Status | Evidence |
|---|---|---|---|
| 1 (MED) | Key leaks into `GatewayError` via the header-validation error | **Closed** | index.ts:135 refuses anything outside `^[\x21-\x7e]+$`. Probe: trailing `\n`, `\r\n`, leading `\n`, `\t`, NUL, DEL, `é`, U+2028 and a space are all refused, and the message doesn't echo the key. JS `$` without `m` doesn't match before a trailing newline, so `key\n` fails. index.ts:195 also replaces the key with `[secret key]` on the network-error path. Probe: with the key in the URL's userinfo, the message reads `http://[secret key]@127.0.0.1…`. |
| 2 (MED) | `toleranceSec` NaN/Infinity turns off the replay window | **Closed** | index.ts:96-97 throws unless finite and ≥ 0; index.ts:102 is written fail-closed (`!(… <= tol)`). Probe on a 10-year-old event: NaN, ±Infinity, -1 and the string `"300"` are refused; `-0` and `0` reject it; `null` falls back to 300. |
| 3 (MED) | Cleartext key over `http://` | **Closed** | index.ts:121, :136-139. See the bypass table. |
| 4 (MED) | README credits by `status`/`reference` | **Closed for the reported attack** | README.md:13-14 stores the session id with the order. README.md:26 looks the order up by `event.data.id` from the signed event. README.md:32 polls with the stored id, and README.md:36 says never to take the id from the browser. Paying a 1 USDT session no longer credits a 1,000 USDT order. The amount gap is item M1 below. |
| 5 (MED) | `orderId` truncated/trimmed by the server | **Closed in the SDK** | index.ts:151 `^\S(.{0,38}\S)?$`. Probe: NBSP, BOM and a leading/trailing space are refused, and so are 41 characters and an inner `\n`/U+2028. JS `\s` and `String.trim` use the same whitespace set, and both count UTF-16 units (20 emoji accepted, 21 refused), so the server's `trim().slice(0,40)` never changes an accepted id. The server-side 400 belongs to claude-frontend (sent). |
| 6 (LOW) | `retrieve("..")` escapes the path | **Closed** | index.ts:163 `^[\w-]{1,64}$` (ASCII `\w`, no `u` flag). Probe: `..`, `.`, `%2e%2e`, `a%2Fb`, `a\b`, `a/b`, `abc\n` and `İ` are refused before any fetch. |
| 7 (LOW) | SDK follows redirects | **Closed** | index.ts:185 sets `redirect: "error"`. Probe with real fetch and a 302: `GatewayError 0 "Couldn't reach the gateway: fetch failed"`, with no Location in the text. |
| 8 (LOW) | Currency guard one-directional | **Closed** | index.ts:156-158. See the bypass table. |
| 9 (LOW) | `signWebhook("")`; dedupe on `event.id`; default idempotency key; CI hardening | **Mostly closed** | index.ts:88 throws on an empty secret. README.md:25 dedupes on `event.id`. Default `randomUUID()` idempotency key: not done; the human accepted retries on create at the 03:05 gate. CI pinning and `--ignore-scripts`: unchanged, because CI isn't in this diff. |

## Bypass checks the caller asked for
| Attempt | Result |
|---|---|
| `https://user:pass@gw.example`, `http://user:pass@localhost` | Accepted by the constructor. Real fetch then refuses every request, but the error text includes the URL **with the credentials** (FOLLOW-UP L1). |
| `http://localhost.evil.com`, `localhost.`, `localhost%2eevil.com`, `LOCALHOST。evil.com` (ideographic dot), `localhost@evil.com`, `localhost:80@evil.com`, `127.0.0.1.nip.io`, `[::ffff:127.0.0.1]`, `127.0.0.2`, Cyrillic `а` in localhost, `xn--localhost` | **Refused.** The check compares the WHATWG-parsed `hostname`, after IDNA and percent-decoding, against an exact set. |
| `http://evil.com@localhost`, `http://localhost\@evil.com`, `http://localhost#@evil.com`, `0x7f000001`, `127.1`, `[0:0:0:0:0:0:0:1]`, `HTTP://LOCALHOST`, `http:localhost` | Accepted, and each one parses to a loopback host, so the request really goes to localhost. Not a bypass. |
| `ws:`, `file:`, `blob:`, `data:`, `ftp:`, `javascript:` | Refused. |
| Key through another error path | The network path is scrubbed. The redirect and unreachable paths say only `fetch failed`. The **JSON `error` path is not scrubbed**: a server or proxy that echoes `Authorization` puts the key in `GatewayError.message` (probe: `401 "bad Bearer sk_test_FAKE…"`). The real handlers return fixed strings only (sessions/route.ts:10-45, [id]/route.ts:8), so this is FOLLOW-UP L2, not a live leak. |
| Regex that admits `..` or encoded slashes | No. `retrieve` refuses `.`, `%`, `/` and `\`. `payments.list` puts `cursor` and `limit` through `URLSearchParams`, so they stay in the query. |
| Currency guard flipped through `priced` | No. EUR with no `priced`, `priced: null`, or only a top-level `currency: "EUR"` → refused. The default USDT with `priced.currency: "EUR"` → refused. `"usdt"` and `""` → refused. `priced` is set by the gateway, never by the customer. |

## Mandated grep
`grep -rnE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over packages/sdk/{README.md, index.ts, test/*.ts} and the batch's build-claude-sdk.md, batch.md, round-1/ci.md and round-2/test.md:
- **sdk.test.ts:8, edges.test.ts:6:** `const SECRET = "whsec-test-0123456789abcdef"`, a made-up fixture. Every other hit in those files is a use of that constant.
- **README.md:10, :20:** the env var names `GATEWAY_SECRET_KEY` and `GATEWAY_WEBHOOK_SECRET`. Names, not values.
- **0x + 64 hex:** no hits.
- **Real key shapes** (`sk_(test|live)_…{16,}`, `whsec_…{16,}`): no hits.
- round2.test.ts uses `sk_test_abc` and `sk_"x` (made up). `.env` is git-ignored; only `.env.example` is tracked, and it isn't in this diff.

## FOLLOW-UP (MEDIUM/LOW; not blocking in fast mode)

### M1. MEDIUM: the README credits by session id but never checks the amount
- **Where:** README.md:26-27 (webhook) and :32 (poll). README.md:35 says "its amount was set by your server", but nothing checks that the paid amount still matches the order.
- **Exploit sketch:**
  - (a) **Order edit.** A shop lets the cart change after checkout starts. It creates a second session for the new total, and `saveSessionId` adds a row instead of replacing the old one (the README doesn't say which). The customer then pays the old, cheaper session, and `orderBySessionId(old)` returns the now-bigger order, which gets marked paid.
  - (b) **Vouchers (batch 007).** ARCHITECTURE §4b plans a voucher field on the hosted checkout, and has vouchers applied before `POST /api/v1/sessions`. If a voucher can lower the amount of a session the shop created with `sk_`, the customer pays less and the README credits the full order.
  - Neither path works today: the session amount is fixed and apps/web has no voucher code (grep). That is why this is MEDIUM.
- **Fix:**
  - At create, store `session.amount` with the session id.
  - Credit only when `event.data.amount === stored.amount` (the webhook) or `session.amount === stored.amount` (the poll), next to the `status === "paid"` check. One condition each.
  - Say "one session per order; replace the old id" in the step-1 comment.
- **Owner:** claude-sdk (README; AT-14's shop copies it). **Cross-lane:** claude-contracts, batch 007. Vouchers must not change the amount of an `sk_` API session unless the shop opts in. If they do, the webhook has to carry both the created and the paid amount.

### L1. LOW: a `user:pass@` baseUrl puts the credentials in `GatewayError.message`
- **Where:** index.ts:136-139 accept the URL. index.ts:195 copies fetch's text, which is `Request cannot be constructed from a URL that includes credentials: http://user:pass@…/api/v1/sessions/abc`.
- **Impact:** a basic-auth password (for example, for a staging proxy) lands in shop logs and Sentry. It is scrubbed only if it equals the gateway key. Every call fails, so a developer notices in dev. The tester's note that "no credential leaks" is not accurate: the userinfo is in the message.
- **Fix:** refuse `base.username || base.password` in the constructor, with a message that doesn't echo the URL.
- **Owner:** claude-sdk.

### L2. LOW: the key scrub covers only the network-error path
- **Where:** index.ts:205 builds `GatewayError` from the server's `json.error` unscrubbed.
- **Impact:** a gateway, WAF or debug proxy that echoes the `Authorization` header in a JSON error puts `Bearer sk_…` in the shop's error logs (probe: `KEY LEAKED`). Today's handlers never echo it.
- **Fix:** apply `.replaceAll(this.#key, "[secret key]")` to that message too. Better, scrub once in the `GatewayError` construction inside `#call`.
- **Owner:** claude-sdk.

### L3. LOW: the guard checks the quote's currency, not its amount
- **Where:** index.ts:156-158.
- **Impact:** a gateway that returns `priced: { currency: "EUR", amount: "999" }` for a 25 EUR request passes the guard (probe). The gateway is trusted, so this only catches a server bug, not an attack.
- **Fix:** optionally compare `priced.amount` to the requested amount after decimal normalisation. Not needed for the demo.
- **Owner:** claude-sdk.

### L4. LOW (functional, fails closed): `currency: "USD"` is refused unless the server returns `priced.currency: "USD"`
- **Where:** index.ts:156.
- **What happens:** ARCHITECTURE §4b prices USD at USDT 1:1. If sessions v2 treats USD as USDT and returns no `priced`, every USD checkout throws (probe). That is safe, but it breaks USD.
- **Fix:** agree with claude-frontend that USD sessions return `priced: { currency: "USD", rate: "1", … }`.
- **Owner:** claude-sdk with claude-frontend.

### L5. LOW: README webhook handler details
- **Where:** README.md:25.
- **What happens:** `alreadyHandled(event.id)` is only ever checked; nothing records the id.
  - If it's a pure read, the dedupe does nothing.
  - If it records the id before `markPaid` runs and `markPaid` then throws, the gateway's retry is skipped and the order is never credited.
  - Two deliveries at the same moment can both pass the check.
  - None of these lets an attacker gain anything, as long as `markPaid` is idempotent.
- **Fix:** add a comment along the lines of "record `event.id` in the same transaction as `markPaid`; make `markPaid` idempotent".
- **Owner:** claude-sdk.

### Informational (no action)
- `toleranceSec: 1e15` is accepted, which in practice means no window. It's an explicit number the developer chose, so it isn't a silent off like NaN was.
- `retrieve(undefined)` from untyped JS coerces to `"undefined"` and passes the regex. The result is a harmless 404.
- CI pinning and `npm ci --ignore-scripts` (round-1 #9) and the server-side `returnUrl` scheme check (claude-frontend) are still open from round 1. Neither is in this diff.

## NEEDS THE USER
None. This is the last round: PASS, with M1 and L1-L5 going to claude-sdk's next batch (M1's voucher part also to claude-contracts' batch 007).
