VERDICT: PASS

## Commands
- `npm test` (packages/sdk): 17 tests, 17 pass, 0 fail (13 builder + 4 tester probes in test/edges.test.ts). `npx tsc --noEmit`: exit 0.
- CI: run https://github.com/Vishal4742/merchant-capital-plus/actions/runs/42112329778 on 199fa00: `sdk` success (web, secrets, contracts, relayer also success).
- `grep -n import index.ts` -> only line 4 `node:crypto`. package.json has no `"dependencies"` (devDependencies only).

## Acceptance criteria
- create request shape/headers/body omissions: PASS (test "sessions.create posts..." and "sends a number amount as a string...").
- retrieve URL-encodes id; payments.list builds query only from given params: PASS (retrieve + payments.list tests).
- 4xx no retry; 5xx/network retried with same idempotency key then throw (status 0); non-JSON 200 throws: PASS. Timeout via timeoutMs retried then GatewayError 0: PASS (new probe, 2 calls with maxRetries 1).
- EUR guard: PASS (unit test + live run below).
- Constructor throws (missing key, pk_, bad baseUrl, window): PASS (constructor test).
- constructEvent: valid string/Buffer body PASS (new); wrong secret/body/header/empty secret/tolerance PASS; uses timingSafeEqual (index.ts:95); custom toleranceSec PASS (new).
- signWebhook vector c6ef4734...8b5146: PASS (pinned test; builder also checked openssl).
- No runtime deps, test+typecheck pass, CI green: PASS.
- Integration against real apps/web handlers (just re-run):
  - create -> {"id":"1d293650-...","url":".../checkout/1d293650-...","amount":"25.00","expiresAt":"..."}
  - retrieve -> status open, amount 25.00, reference order-42
  - wrong key -> GatewayError 401: Missing or wrong API key.
  - bad amount -> GatewayError 400: amount must be between 1.00 and 10,000.00 USDT.
  - items mismatch -> GatewayError 400: Items add up to 1.00, but amount is 25.00.
  - unknown id -> GatewayError 404: No such checkout.
  - EUR -> GatewayError 200: This gateway doesn't price in EUR yet; ... Don't send the customer to it.

## DONE
Added packages/sdk/test/edges.test.ts (Buffer body, spaces after comma, uppercase hex, `t=12ab`, zeroed v1, empty/undefined/garbage header, custom tolerance, timeout -> retry -> status 0). All pass.

## OPEN
None blocking.

## NEEDS THE USER
Nothing.

## FOLLOW-UP (MEDIUM/LOW, owner claude-sdk)
- LOW index.ts:140ff (`new URL(path, base)`): a baseUrl with a path ("https://g.test/prefix/") loses the prefix (-> https://g.test/api/v1/sessions). README says origin only; either document it (it is, in the option doc) or reject non-root paths in the constructor.
- LOW index.ts:97: after a valid signature, malformed JSON throws SyntaxError, not WebhookSignatureError. Only reachable with the secret, so harmless; wrap if handlers catch by class.
- LOW index.ts:92: a duplicate `v1` or `t` in the header takes the last value; safe (still must HMAC-match) but Stripe accepts any v1. Matters only if the sender ever emits two v1 values for secret rotation.
- LOW: uppercase-hex v1 is rejected as malformed; fine given the sender emits lowercase.
- LOW: `payments.list` will 404 until GET /api/v1/payments ships (known; claude-frontend).
