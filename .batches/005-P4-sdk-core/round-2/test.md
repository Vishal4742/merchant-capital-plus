VERDICT: PASS

## DONE
- `npm test` (packages/sdk): 28 tests, 28 pass, 0 fail (22 existing plus 6 new in `test/round2.test.ts`). `npx tsc --noEmit`: exit 0.
- Round-1 follow-ups each have a test: key charset and key scrub, toleranceSec NaN/inf/negative, https/localhost baseUrl, currency guard both ways, orderId bounds, retrieve id check, redirect:"error", path prefix kept.
- Probes added (test/round2.test.ts, uncommitted, so CI has not run them):
  - `http://[::1]:3000`, localhost and 127.0.0.1 accepted; remote http, ftp, javascript:, empty and garbage refused.
  - `toleranceSec: 0` accepted and rejects a timestamp 5 s old.
  - orderId of 40 characters and one with an inner space accepted; 41 characters, leading space, trailing space and empty refused.
  - A key containing `"` is accepted and is scrubbed from a fetch error.
  - A redirect rejection becomes GatewayError with status 0.
- Live run against the real apps/web route handlers: create, retrieve, 401, 400 (amount), 400 (items mismatch) and 404 all return the expected GatewayError. The EUR case on a pre-FR-GW-11 server gives: `Checkout aa1339bd-... came back priced in USDT, not EUR: don't send the customer to it. This gateway may not support EUR yet; price in USDT.`
- CI run for 3c131b4: https://github.com/Vishal4742/merchant-capital-plus/actions/runs/42114755143. Jobs: contracts success, web success, sdk success, secrets success, relayer success.

## OPEN
None.

## FOLLOW-UP (LOW, owner: claude-sdk)
- `https://user:pass@host` is accepted by the constructor. Real fetch then throws "Request cannot be constructed from a URL that includes credentials", which surfaces as GatewayError status 0. The user sees an odd error but no key or credential leaks. Refusing userinfo in the constructor (index.ts:136) would give a clearer message.
- The userinfo test only logs; it does not assert.
