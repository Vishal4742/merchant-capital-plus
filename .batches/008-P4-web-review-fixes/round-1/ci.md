VERDICT: PASS

# CI, batch 008-P4-web-review-fixes (phase mode, run by claude-frontend at 06:27)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0. One deliberate `eslint-disable-next-line @next/next/no-html-link-for-pages` on the /docs wordmark: a full page load is the security fix (R2-F3). |
| Unit tests | `npm test` | exit 0: tests 301, pass 298, fail 0, skipped 3 (live FX only); re-run 06:34 after the sign-in and F2 fixes |
| Build | `npm run build` (06:34) | exit 0, 26/26 pages. The backend's "gateway api error" log appears 6×, from claude-contracts' routes with no local database, as before. |

## New and changed tests
- **fx:**
  - a flipped rate is refused for EUR, GBP, SGD and INR
  - ±16% is refused and ±14% is used
- **sessions-v2:**
  - the 1,000 USDT cap (1000.00 ok, 1000.01 refused, 900 GBP refused)
  - plain "1000.00"
  - another merchant's checkout gives 404
- **checkout-edges:**
  - the 1,000 cap
  - the demo 303 Location is relative (`/checkout/<uuid>`)
  - 10 demo checkouts per IP per minute, then a 429; another IP isn't blocked
- **relay-auth (new):**
  - `x-relay-secret` is sent when RELAY_API_SECRET is set, and not when it is unset or blank
  - the secret is never in the result

## Not covered by a test
The idempotency `finally` now deletes only its own entry (code review 006 R2-4). A test would need the first request to stall inside a currency fetch, but the 15-minute FX cache is already warm in that file. The reviewer's probe reproduced the old bug; the guard is one comparison.

## Added after the security pass (06:33)
- **Sign-in domains.** `test/auth.test.mjs` checks:
  - signInDomains: the loopback spellings under localhost, none for a real host, PUBLIC_ORIGIN only when it is http(s)
  - a message signed on 127.0.0.1:3100 verifies on a server that sees localhost:3100; another port and a phishing domain are refused
- **Security F2.** `test/relay-auth.test.mjs`: no header over plain http to another host; the header goes to https and to loopback; `redirect: "manual"`.
- **Not done here** (P4 fix batch): F1 (sweep the limiter and session maps; only exploitable off Vercel) and F3 (a server-side cap on invoice pays).
