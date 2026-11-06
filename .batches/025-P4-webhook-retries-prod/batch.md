# 025-P4-webhook-retries-prod
Phase: 4 (PHASES.md)   Round: 1 (phase mode)   Owner lane: claude-contracts
Mode: phase
Money: no
Request (verbatim): claude-frontend 10:26 "webhook retries never run in production (no cron calls /api/v1/webhooks/dispatch; a Vercel Hobby cron runs only daily). Your call: a daily cron in vercel.json, or dispatch opportunistically."
Agent ids (builders, for SendMessage resumes): lane-built
Log:
- 10:3x spec + failing tests (test/gw-dispatch.test.mjs, 6 red: dispatchSoon not exported). Numbered after the 023s of claude-relayer and claude-frontend.
- 10:4x built (6a7e5a2 tests, 9245a90 code); ci PASS (192 gw / 519 total, 0 fail). Money: no, so no security pass (batch-close §3b).
