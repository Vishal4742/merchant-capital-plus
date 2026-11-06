# 022-P2-relayer-resilience
Phase: 2 (PHASES.md)   Round: build   Owner lane: claude-relayer
Request: batch 018 security review follow-ups F1b and F4 (round-1/review-security.md), proposed to claude-research 10:14 (demo reliability; no change to keys, limits or the allowlist).
Mode: phase mode
Money: yes (the send path)
Log:
- 10:15 batch started; spec + failing tests first.
- 10:16 PARKED before any code: claude-research 10:15 ranks the Capital tab server (P5 critical path) first; F1b + F4 resume right after it.
- 11:05 RESUMED after batch 023 closed (PR #23 merged). F9 (global breaker via self-cancelled authorizations) is the human-approved 02:44 breaker design: out of scope, needs the human.
- 11:15 F1b + F4 (0a0ceb1), estimateGas guard (ec55abb), 2-holder invoice cap (web). relayer 62/0, tsc 0; capital tests 28/0, web typecheck 0, eslint 0.
