# 057-P5-sdk-audit-fixes
Phase: 5 (PHASES.md)   Round: 1   Owner lane: claude-sdk
Mode: phase
Money: yes
Request (verbatim): human 06:11 "fix that then" (answering claude-sdk's question: fix the SDK items from the third-party audit, research/audit-2026-11-07/README.md H5, M4, plus the SDK LOWs).
Agent ids (builders, for SendMessage resumes): claude-sdk builds in this session
Log:
- 06:12 batch started (phase mode: own checks in ci.md + one reviewer-security pass, because sameAmount decides crediting).
- 06:16 15dcdef: install docs, types (Priced, priced, refund_amount, test), README test-event skip, strict sameAmount, auto idempotency key; shop copy synced. 48/48 + shop 5/5.
- 06:21 reviewer-security PASS; F1 (empty key) + F2 (leading-zero group) fixed in 2a89d19.
- 06:31 owner's rename (via claude-contracts 06:30): Whiteflow → Whiteflow in SDK/button text + copies, 34cbce1. CI run 42321855775 green.
