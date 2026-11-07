# Spec: 057-P5-flaky-lock-test

## Requirements (cite docs/SRS.md IDs)
- FR-PAY-5 / FR-PAY-6: a checkout is paid once; its payment lock (app_web_locks, token = until) can only be released by the attempt that holds it. The test that pins this (sessions-db "a stale token deletes nothing") must be deterministic.

## Acceptance criteria
- [ ] The re-claim in "a lapsed lock … can be re-taken" happens on a later database millisecond than the first claim, so the stale token can never equal the new one in the test.
- [ ] The test still fails if releasePayment ignored the token (checked by hand: drop the `AND until = $2` and see it fail).
- [ ] sessions-db.test.mjs passes 30 runs in a row; npm test green.

## Files to touch
- apps/web/test/sessions-db.test.mjs only.

## Ponytail ladder
- Needed: a flaky money-adjacent test confuses the gate. Minimum: wait 2 ms before the re-claim (the clock's tick is 1 ms). Not a product change: production tokens can't collide.

## Out of scope
- Random lock tokens in lib/sessions.ts (no production bug to fix).
