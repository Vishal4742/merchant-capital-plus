# 057-P5-flaky-lock-test
Phase: 5 (PHASES.md)   Round: build   Owner lane: claude-frontend
Mode: phase
Money: no (test only; lib/sessions.ts unchanged)
Request (verbatim, claude-research 2026-11-06 20:21): "Flaky test, twice today on pre-push (once on #35's branch, once on #39's): apps/web/test/sessions-db.test.mjs 'a stale token deletes nothing' fails once, then passes 3/3. Please find the race (shared DB state, timing, or test order) and fix it after G5, or now if it's a one-liner; a flaky money-adjacent test will confuse the G5 gate."
Agent ids (builders, for SendMessage resumes): none
Log:
- 05:57 Cause: PGlite now() has millisecond resolution (scratchpad pgclock.mjs: 4 distinct values in 20 back-to-back statements). claimPayment's token is until::text = now() + 300 s. The test lapses the first lock by hand and re-claims at once, so first claim and re-claim can share one millisecond: same token, and releasePayment(first) deletes the re-taken lock. Production can't: a re-claim needs the old until < now(), so its token is strictly later.
- 05:59 Proof: a probe (claim, lapse by hand, re-claim, 200 times) got the same token back 106 of 200 times.
- 06:04 Fix (test only): wait 2 ms before the re-claim. 30/30 runs pass; mutation (releasePayment ignoring its token) makes "a stale token deletes nothing" fail, so the test still guards it.
