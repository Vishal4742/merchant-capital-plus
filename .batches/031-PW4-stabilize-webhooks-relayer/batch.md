# 031-PW4-stabilize-webhooks-relayer
Phase: W4 (Whiteflow roadmap; proposed PHASES row in docs/SRS-v3.0-Whiteflow-PROPOSAL.md §F — this batch cites only already-approved v2.2 IDs)   Round: build   Owner lane: claude-contracts (apps/web/lib/server, apps/web/db) + claude-relayer (apps/relayer)
Mode: phase
Money: yes
Request (verbatim): "BUILD and VERIFY the product … Implement in dependency order … E. Durable financial processing, reconciliation and webhook delivery." (owner, 2026-11-06) · "you have a one more session present do the tassks in parallel" (owner, 2026-11-06)
Why now: PRD §16 gate G0 "stabilize — durable relay, outbox, write-ahead attempts … do not add payment automation before this"; PRD §16 practical order #1 "fix existing reliability blockers". Two HIGH defects from the W0 inventory (notes/phase-W0-baseline.md): webhook events can be lost permanently (apps/web/lib/server/events.ts:91), and relayer send lock/nonce/budget/limits/breaker are per process on a multi-instance deploy (apps/relayer/src/relayer.ts:141).
Builders (disjoint files, PIPELINE §3.3 / §7):
- whiteflow-ef (this session, lead) — web part: apps/web/lib/server/events.ts, apps/web/lib/server/webhooks.ts, apps/web/db/051_webhook_outbox.sql, apps/web/test/gw-outbox.test.mjs → build-web.md
- whiteflow-b7 (peer session) — relayer part: apps/relayer/** only → build-relayer.md
Claims (agentbus unavailable on this Windows host — fcntl; claims recorded here instead): CLAIM apps/web/lib/server/events.ts, apps/web/lib/server/webhooks.ts, apps/web/db/051_webhook_outbox.sql, apps/web/test/gw-outbox.test.mjs (whiteflow-ef) · CLAIM apps/relayer/** (whiteflow-b7)
Log:
- 2026-11-06 batch started by whiteflow-ef; spec written; relayer part handed to whiteflow-b7 via SendMessage.
- Part A built (whiteflow-ef); RED→GREEN; round-1 review (3 lenses + skeptics) → crash-test fix (proven guard) + rollout note; peer cross-review → round-2 fixes M1/L1/L2/T1.
- Part B built (whiteflow-b7); RED (16 failing) → GREEN; round-1 review: no crit/high/med; round 2 (first resume of whiteflow-b7): R2-1 migrate secret leak, R2-2 lease-expiry mutation test, R2-3 settle retry.
- Round 2: ci.md PASS, review-security.md PASS (1 LOW follow-up: DNS-deadline threadpool trade-off). Round: human gate. NOT closed — waiting for the owner's "prove it works" + grill-me answers (PIPELINE §3 step 6). No commit possible (not a git checkout).
- Round 4 (owner: supervision prompt + "use all the 4 active chats"): CLAIMs — whiteflow-ef: A11–A13 files; whiteflow-b7: apps/relayer/** (B10); whiteflow-fb: Part C files; whiteflow-0f: apps/web/test-pg/** + apps/web/package.json test:pg line (Part D). Round-3 subagent review failed (credit balance); cross-session reviews replace it (round-3/review-security-partB.md by whiteflow-ef).
- CLAIM (whiteflow-fb, Part C, approved by whiteflow-ef): apps/web/lib/server/links.ts (limitCheckouts + payLink await) and apps/web/lib/server/pages.ts (payPage await) — those 3 lines only.
- CLAIM (whiteflow-ef, Part C follow-up while whiteflow-fb is interrupted): apps/web/test/gw-refunds.test.mjs beforeEach clears app_web_rate_limits; apps/web/test/gw-helpers.mjs PGlite teardown (docs-limits hang root cause).
- CLAIM (whiteflow-ef while whiteflow-b7 is interrupted): apps/relayer/test/relayer.test.ts 'local pre-checks' — per-case times (Node 26 second-boundary flake; guard unchanged).
- HUMAN GATE PASSED (owner, 2026-11-06): "Close it". Decisions: breaker stays 3 mined reverts/hour (testnet); rollout rule accepted — never run the pre-031 relayer and the new relayer against the same RELAYER_PRIVATE_KEY at the same time (drain old first; rollback stops new first); keep wf_s2_* test databases for Stage 3, drop at end of Stage 3. No deployment authorized by this gate. Not committed (not a git checkout).
