VERDICT: PASS

# Code review: 005-P4-sdk-core, round 1 (reviewer-code, fast mode §3a)

Scope: `git diff 1fbf647..HEAD` (daaaed6 RED, 199fa00 GREEN) plus the untracked `packages/sdk/test/edges.test.ts`.
I checked it against the real route handlers on main (`apps/web/app/api/v1/sessions/route.ts`, `[id]/route.ts`, `shopAuthorized` in `lib/config.ts`), against claude-frontend's sessions v2 announcement (agentbus 02:46:12) and against ARCHITECTURE.md §4b on main (the SDK surface).

No HIGH or CRITICAL findings, so the verdict is PASS. Five MEDIUM and nine LOW findings are listed under FOLLOW-UP.

## What I verified
- **Traceability:** every change maps to FR-GW-5, FR-PAY-4, FR-GW-7 or the FR-GW-11 guard. The CI job is in the spec's file list. The only extra surface is `webhooks.sign` (LOW below).
- **Surface vs ARCHITECTURE.md §4b:** matches exactly: `new Gateway(sk, {baseUrl, fetch, timeoutMs, maxRetries})`, `sessions.create(params, {idempotencyKey})`, `sessions.retrieve`, `payments.list`, `webhooks.constructEvent(raw, header, secret, {toleranceSec})`, `WebhookSignatureError`, `signWebhook`. `SIGNATURE_HEADER` was asked for by claude-contracts (agentbus 02:45:55).
- **Wire contract vs today's server:**
  - auth sends `Bearer <key>`, which `shopAuthorized` requires (it is case-sensitive on `"Bearer "`);
  - `amount` is always a string, so the server's `typeof body.amount !== "string"` check passes. A number is sent as `String(n)`, and `"25"` passes `parseUsdt`'s `^\d+(\.\d{1,6})?$`; values like `1e21` or `0.30000000000000004` are rejected server-side with a 400, never charged wrong;
  - `items` matches the server's `{name, qty, price}`;
  - `reference` is left out when `orderId` is absent (JSON.stringify drops `undefined`);
  - GET goes to `/api/v1/sessions/<encodeURIComponent(id)>`;
  - `paymentId: string | null` and `txHash: string | null` match `lib/sessions.ts:15,17` (`txHash` can be null even when the session is paid).
- **Retry loop (index.ts:166-181):**
  - `retry = attempt < maxRetries`, so the default 2 means 3 calls. A targeted probe confirmed this: 3 calls, then `GatewayError` 503;
  - only network errors, timeouts and 5xx retry, and 4xx never does;
  - the timeout is per attempt (`AbortSignal.timeout` is built inside the try, so a timeout counts as a network error, then status 0);
  - on the final 5xx the server's JSON `error` comes through with the real status;
  - the same headers object (and so the same `idempotency-key`) goes out on every attempt;
  - backoff is 250 ms, then 500 ms.
- **EUR guard (index.ts:139):** today's route ignores `currency` and leaves it out of the reply, so `undefined !== "EUR"` makes the guard throw. This fails closed: explicit `USDT` skips the guard, and a lowercase `eur` from a JS caller throws.
- **constructEvent:**
  - both buffers are 32 bytes (the hex is regex-checked to 64 chars), so `timingSafeEqual` can't throw on a length mismatch;
  - `t` is limited to 12 digits, so a millisecond timestamp is rejected;
  - an empty secret is refused.
- **Test vector:** `printf '%s' '1700000000.{}' | openssl dgst -sha256 -hmac k` gives `c6ef4734033cee2367414a0939385eca0397754aa7a59716da7463a9298b5146`, the same value test/sdk.test.ts:140 pins.
- **Tests vs acceptance criteria:**
  - every acceptance criterion has an assertion, except `timingSafeEqual`, which is checked by reading index.ts:101;
  - the `window` test restores the global in `finally`, and node:test runs each file in its own process.
- **Ponytail ladder:**
  - 185 lines, no runtime dependencies, platform APIs only. Nothing to delete except the `webhooks.sign` alias;
  - the `GatewayError` and `WebhookSignatureError` classes, the `Map` header parse and `#call` are each as small as they can be.

## FOLLOW-UP (MEDIUM/LOW; fix in the lane's next batch)

### MEDIUM
1. **`toleranceSec: NaN` or `Infinity` turns off the replay window without any warning** (`packages/sdk/index.ts:98`, owner: claude-sdk).
   - **What:** `Math.abs(now - t) > NaN` is always false. A probe accepted a signature 115 days old with `{ toleranceSec: Number(undefined) }`. That is a likely integration pattern: `Number(process.env.WEBHOOK_TOLERANCE)` with the variable unset.
   - **Why:** a security check that fails open on bad config. Signatures are still checked, so it is MEDIUM, not HIGH.
   - **Fix:** fail closed with `if (!(Math.abs(now - timestamp) <= tol)) throw …`, or reject a non-finite or negative `toleranceSec`. Add one test line.
2. **The FR-GW-11 guard reads `session.currency`, whose meaning on v2 is ambiguous** (`packages/sdk/index.ts:139`, owner: claude-sdk; confirm with claude-frontend).
   - **What:** v2's 201 is `{amount (USDT), currency, priced?: {currency, …} (present when currency != USDT)}`. If claude-frontend fills `currency` with the settlement currency (`"USDT"`, the unit of `amount`), every EUR checkout through the SDK throws.
   - **Why:** this fails closed, so no money is at risk, but it would break FR-GW-11 for SDK users once v2 lands. `priced` is also the real evidence that a quote was applied: a half-built server could echo `currency` without converting.
   - **Fix:** check `session.priced?.currency !== params.currency`. The test fixture at sdk.test.ts:57 already carries `priced`.
3. **`orderId` does not always "come back as `reference`"** (`packages/sdk/index.ts:14` doc; server `apps/web/app/api/v1/sessions/route.ts:27`, owners: claude-frontend for the route, claude-sdk for the doc).
   - **What:** the server runs `trim().slice(0, 40)` on `reference` without saying so. A probe sent a 45-character `orderId` unchanged; the server would store 40 characters.
   - **Why:** a shop that marks orders paid by `event.data.reference` (the README does exactly this) never finds a longer or space-padded order id. The customer pays and the order is never fulfilled.
   - **Fix:** the route returns 400 for more than 40 characters instead of truncating (the root cause), and the SDK doc states the 40-character, no-whitespace limit.
4. **API `amount` is a display string with thousands separators** (`apps/web/lib/usdt.ts:30-33`, used by sessions `route.ts:48` and `[id]/route.ts:22`, owner: claude-frontend).
   - **What:** 1000 USDT comes back as `"1,000.00"`, and the probe showed `Number(s.amount)` is `NaN`. The webhook `data` is the same object, so it has the same problem.
   - **Why:** v2 promises "USDT, 6dp string". Any shop that compares or parses `amount` breaks above 999.99.
   - **Fix:** API JSON uses `formatUnits(units, 6)` (a plain decimal) and keeps `formatUsdt` for the UI. The SDK needs no code change; when it lands, the SDK doc says "plain decimal string".
5. **`test/edges.test.ts` is untracked, so the green CI run (42112329778) never ran it** (owner: claude-sdk).
   - **What:** the file isn't committed, and the spec's file list names only `test/sdk.test.ts`.
   - **Why:** "17/17" is a local result. CI proved only 13.
   - **Fix:** commit the file with this batch (or fold its cases into sdk.test.ts) and fix its labels:
     - line 1 promises a "baseUrl path" probe that doesn't exist;
     - lines 15 and 20-21 call a single all-zero `v1` a "duplicate-v1 forgery".

### LOW
- `packages/sdk/index.ts:157`: `webhooks.sign` is neither in the spec nor in §4b, and `signWebhook` is already exported. Delete the alias (ladder rung 1).
- `packages/sdk/index.ts:175`: a 5xx response body is not consumed before the retry, so undici holds that connection until GC. Fix: `await res.body?.cancel()` before `continue`.
- `packages/sdk/index.ts:176-178`: if `timeoutMs` fires while the body is being read, the error says "answered 201 without a JSON body", and on a POST the session was really created. Rare; at least the message should say it may have timed out.
- `packages/sdk/index.ts:170`: `new URL("/api/…", base)` drops a path prefix in `baseUrl` (the tester's finding). Fix: reject a `baseUrl` whose pathname isn't `/`, or join the paths.
- `packages/sdk/index.ts:37`: `Session.currency` is required, but today's GET leaves it out. build-claude-sdk.md notes this only for `CreatedSession`. Make it optional until v2 lands.
- `packages/sdk/index.ts:103`: malformed JSON behind a valid signature throws `SyntaxError`, not `WebhookSignatureError` (the tester's finding). Only reachable by someone who holds the secret.
- `packages/sdk/index.ts:94`: with a duplicate `t=` or `v1=`, the last one wins (the tester's finding). Safe, but blocks secret rotation that sends two `v1` values.
- `packages/sdk/README.md`:
  - line 13 uses `id`, which is never defined (line 10 destructures only `url`);
  - lines 20-23 `catch {}` turns a `markPaid` failure into 400 "bad signature". Catch only `WebhookSignatureError` and let real failures return 500, so the sender retries them.
- `packages/sdk/package.json:7`: `"exports": "./index.ts"` ships raw TS. apps/shop (batch 3) and claude-contracts' sender in apps/web will need `transpilePackages` or an import from inside the Turbopack root. Check this when the first consumer imports it.
- Suggestion for the next spec, not a defect: once the server dedupes on `Idempotency-Key` (§4b), default it to `randomUUID()` on `create`, so retried POSTs are safe without the caller passing one. The current spec and sdk.test.ts:49 say no header when none is given, so this needs a spec change first.

## Probe used (read-only; scratchpad, outside the repo)
`/private/tmp/claude-501/-Users-vg890-ethglobal/4b071a41-5a21-45c1-83b9-fc92c8c6526c/scratchpad/rc/probe.ts`
```
tol NaN -> evt_1 ACCEPTED 115-day-old signature
tol Infinity -> evt_1 ACCEPTED 115-day-old signature
tol -1 -> rejected: Webhook timestamp is outside the tolerance window (possible replay).
default retries calls: 3 503
sent {"amount":"1000","reference":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"} amount back 1,000.00 Number() NaN
```
