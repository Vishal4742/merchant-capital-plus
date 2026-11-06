VERDICT: PASS

# CI, batch 020-P4-web-g4-code-followups (phase mode, Money: yes; run by claude-frontend at 10:07)

| Check | Command (apps/web) | Result |
|---|---|---|
| Types | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0, 0 warnings |
| Unit tests | `npm test` | exit 0: tests 454, pass 452, fail 0, skipped 2 |
| Build | `npm run build` | exit 0 |
| Live :3100 | curl after the restart (RESTART/UP posted) | /, /l/x, /p/x and /checkout/x give 200 |

## New and changed tests
- **announce-paid:**
  - a backend that keeps failing is tried 3 times, with waits of 500 then 1500 ms; each line is logged by error name only and nothing throws
  - a blip on the 1st try is recovered on the 2nd
- **relay-auth:** warmRelayer schedules exactly one GET /health after the response, never runs in the page's path, swallows a failure, and skips plain http to another host, unset and junk URLs.

## Also in this batch
- The paid checkout page and /r/[id] re-announce on each visit. This is idempotent through the backend's sendOnce.
- A paid link shows "Paid on <date> IST" from the backend's `paid_at` (the G4 UX F2 follow-up).
- LOW 6: the stale comments are corrected.

## Waiting
- M1 refunds: call claude-contracts' /refunds/sync once it's on main.
- LOW 5: fold the 3 fetch-and-parse copies, after the developer-screens batch merges (it edits those files).

## After the security pass (CHANGES: 1 HIGH, now fixed; re-check requested)
- **F1 HIGH, fixed:** warmRelayer could turn anonymous page loads into relayer traffic from our IP, and Vercel's burst protection would then challenge every /relay.
  - It now has a module-level throttle: at most 1 ping per instance per 30 s.
  - /l and /p warm only for an active link or a found page, after the slug check.
  - /checkout warms only for an existing, unpaid session.
  - Test: 100 calls in 10 s give 1 ping; after 30 s, 1 more.
- **F3 LOW, fixed:** a malformed RELAYER_URL ("mailto:x") returns quietly, and the response body is cancelled.
- **F2 MEDIUM and F4 LOW** are in claude-contracts' events/webhooks code; forwarded on the bus.
- Re-run: typecheck 0, lint 0, `npm test` 454 tests (452 pass, 2 skipped), build 0. :3100 restarted 10:17 with the throttle.

