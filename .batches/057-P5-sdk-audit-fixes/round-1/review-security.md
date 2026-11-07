VERDICT: PASS

# Security review: 057-P5-sdk-audit-fixes, round 1 (phase mode, Money: yes)

Diff: `git -C /Users/vg890/ethglobal-sdk diff e5a0364..15dcdef`. Reviewer: security. No code edited.

## Evidence

- `cmp apps/shop/lib/sdk.ts packages/sdk/index.ts`: no output, so the files are byte-identical.
- `packages/sdk npm test`: pass 48, fail 0. `npm run typecheck` (`tsc --noEmit`): clean. `apps/shop npm test`: fail 0.
- Secret grep (`grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` on every file in the diff): no 64-hex value. The hits are only env var names (`GATEWAY_SECRET_KEY`, `GATEWAY_WEBHOOK_SECRET` in README.md:37, :48, :76 and index.ts:235) and the test fixture `SECRET = "whsec-test-0123456789abcdef"` (sdk.test.ts:8), which is made up. Nothing to report.

## Checks

**1. `sameAmount` (index.ts:96): can two different amounts compare equal, so an underpaid order gets credited? No.**
I ran 34 adversarial pairs through the real function on Node 26:
- **Unicode digits** (fullwidth `１０００`, Arabic-Indic `١٠٠٠`), Arabic thousands sign `٬`, fullwidth comma `，`, zero-width space, NUL, `_`, inner space, `+`, `0x`, `1e21`, `.5`, `1.`, more than 6 decimals, `null`/`undefined`: all refused (false). JS `\d` is ASCII-only, and `$` without the `m` flag anchors at the true end of the string.
- **Whitespace** (NBSP, em space, `\n` at either end): `trim()` removes it. The same value is still compared, so this is harmless.
- **Leading zeros** (`"0100"` = `"100"`, `"01,000"` = `"1000"`): these are the same money, so a match is correct.
- **Commas:** `"10,00"`, `"1,0,0,0"`, `"1,00"`, `"1.000,00"`, `"1,000,0"`, `",100"` and Indian `"1,00,000"` are now refused. That fails closed: no credit.
- **Direction of ambiguity:** reading `X,YYY` as thousands always gives a value at least as large as reading it with a decimal comma. Gateway webhook amounts never contain commas (`events.ts:14` `plain()`), so a misread shop string can only make the customer overpay. It can never make an underpayment match. Rounding never favours the payer.
- Neither input is attacker-controlled anyway: one side is HMAC-signed by the gateway, the other comes from the shop's own DB.

**2. `sessions.create` always sends `idempotency-key` (index.ts:183, :213), checked against `apps/web/app/api/v1/sessions/route.ts`.**
- **Another shop's session:** not possible. The slot is `${merchant}:${key}` (route.ts:48), and the merchant comes from the authenticated key (`shop-auth.ts`), not from anything the request claims.
- **Stale session for a new order:** not possible with the default key. Each `create` call draws a fresh `randomUUID()` (122 bits, no realistic collision), and only that call's own retries reuse it. A test asserts this. A caller who passes their own key and reuses it within 24 h gets the first session back, which may have expired. That was already true before this diff and is documented ("returns the same session for a repeated key").
- **422 on a legitimate retry:** not possible. `init.body` is stringified once, outside the retry loop, so every retry hashes identically (route.ts:66).
- **Abort mid-create:** a retry waits for the stored reply. Past 10 s the server answers 409, which the SDK doesn't retry: no duplicate is created and no money moves.
- **Replay scope:** only a 201 reply is stored. A failed create frees the slot.
- **No regression for DB-less servers:** sessions already need the DB (`createSession` INSERT), and the table exists in `apps/web/db/050_web_sessions.sql`.

**3. README webhook test guard (README.md:53): the `if (event.data.test) return 200` line runs after `constructEvent`, so only a correctly signed body reaches it.**
- Real event data has a fixed server-built shape (`events.ts` `eventData`, plus `refunded`/`refund_amount`). No user- or customer-controlled object is spread into it, so a real `payment.succeeded` or `payment.refunded` can't carry `test`.
- The only effect of `test` is skipping the credit. That fails closed: an attacker gains nothing, even by replaying a real test event within the 300 s window.

**4. Key scrubbing:** every new or changed throw path either goes through `#scrub` (index.ts:188, :225, :236) or contains no key (the orderId 400). The idempotency key isn't secret.

## Findings

No CRITICAL or HIGH findings.

## FOLLOW-UP (non-blocking)

- **F1 LOW, index.ts:183 + :213, owner claude-sdk:** an explicit `idempotencyKey: ""` slips past `??`, and then `if (idempotencyKey)` drops the header. So "always sends a key" is false for an empty string, and retries can create extra open sessions. That is the pre-batch behaviour: no money moves, and the sessions expire. **Fix:** use `opts.idempotencyKey || randomUUID()`, or refuse an empty key with a 400 like `orderId`.
- **F2 LOW, index.ts:96, owner claude-sdk:** the first thousands group may start with zero, so `"0,001"` matches `"1"` and `"000,000"` matches `"0"`. That is not an underpay path (see check 1). **Fix, if strictness is wanted:** use `[1-9]\d{0,2}(?:,\d{3})+` for the first group.
- **F3 INFO, README.md:74-ish, owner claude-sdk:** consider one clause saying that a key *you* pass is remembered for 24 h, so reusing it for a new order returns the old, possibly expired, session. The current text implies this but doesn't say it.
