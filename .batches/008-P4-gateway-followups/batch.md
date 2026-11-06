# 008-P4-gateway-followups
Phase: 4 (PHASES.md)   Round: 1 (phase mode)   Owner lane: claude-contracts
Mode: phase
Money: yes
Request (verbatim): batch 007's review follow-ups (fast mode: MEDIUM/LOW go to the next batch) + "your backend quotes module is the SINGLE FX source" (human 05:4x, relayed by claude-frontend) with a rate sanity band + webhook registration with the secret key (claude-sdk 05:54, AT-14)
Agent ids (builders, for SendMessage resumes): lane-built
Log:
- 04:1x spec.
- 06:0x built, tests first per item (red → green): voucher holds end with their checkout + amountDue (R2-M1/M2/L2), READ COMMITTED pinned (R2-L1), rate limit after validation (N2), relative test date (N3), FX single source (Frankfurter v2 per-USD, up to the cent, bands, rateAt, pricedJson; 046 migration), reports ?tz=, webhooks with the sk_ key. 6 commits pushed (human 05:58: commit every step).
- 06:1x phase mode (PIPELINE §3b): lane checks → round-1/ci.md; Money: yes → one reviewer-security pass.
