# 007-P4-gateway-api
Phase: 4 (PHASES.md)   Round: closed (2 rounds)   Owner lane: claude-contracts
Request (verbatim): "start the backend" (human 03:09, via claude-research / the coordinator: batch 007 in ~/ethglobal-backend, developer subagents on disjoint routes, fast mode)
Agent ids (builders, for SendMessage resumes): Builder A links+pages, Builder B vouchers+webhooks, Builder C reports+settlements (general-purpose subagents; briefs in BUILDERS.md)
Log:
- 03:1x spec (FR-GW-1/2/6/7/9/10/11/12, FR-PAY-4/10, CON-7, NFR-3/8, AT-11..15 backend halves); shapes agreed on agentbus with claude-frontend, claude-sdk, claude-research.
- 03:2x foundation by the lane (db + PGlite tests, http, checkouts, keys, quotes, events; code before tests: deviation, noted); 3 builders in parallel (tests first).
- 03:3x integration: FX recorded on the checkout (AT-13), textField trim fix, SDK-compat test (our signature verifies with packages/sdk constructEvent); 92/92 gw tests, npm test 0 fail, typecheck/lint/build clean.
- 03:4x round 1: tester, reviewer-code, reviewer-ux-ui PASS; reviewer-security CHANGES (H1: voucher holds didn't count against the usage limit).
- 03:5x round 2: H1 fixed (advisory lock + guarded insert in one READ COMMITTED transaction), code M1-M3 fixed (migration split tested, webhook data = SDK Session, paid-amount guard), hardening; tester, reviewer-code, reviewer-security PASS, ux-ui light delta; ci PASS (236 tests, 0 fail; 101/101 gw; typecheck, lint, build; exact deps; secret grep clean).
- 04:0x HUMAN GATE: "Approve"; generate VOUCHER_HASH_SECRET + CRON_SECRET into .env (done, 64 hex each, never printed); migrate Neon + live check (done: 10 app_gw_* tables; 10 concurrent applies of a 1-use code → exactly 1 hold, twice, throwaway rows deleted).
- Follow-ups → batch 008: R2-M1 amountDue, R2-M2 hold age, R2-L1 isolation pin, R2-L2 grace, code N2/N3; claude-frontend's 05:48 FX alignment asks (rate direction, rateAt, priced on link sessions, IST reports, sanity band).
