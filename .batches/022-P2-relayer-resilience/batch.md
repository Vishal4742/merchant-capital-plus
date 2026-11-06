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
- 11:25 security round 1 PASS (M1 + L1-L5). Fixed after it: M1 web half (transfer-check invoice cap), L1 (age refusal = 503 busy), L2 (age gate before in-lock RPC), L3 (comment). Deferred: M1 advance holder cap (claude-contracts measuring) and the too_much_gas web message (claude-frontend); L4, L5 (safe direction). After the fixes: relayer 62/0, tsc 0; web 546/0, typecheck 0, eslint 0.
- 11:23 a broken commit message (an unescaped quote) pushed the RED test commit cf75358 without its fix for about a minute; the fix commit followed.
- 11:44 human: "Ship + deploy". PR #25 merged (5e83dc0) on green; relayer deployed to production (merchant-capital-relayer-6uj6045nu): /health 200 (wbt 0.4904, paused false), /relay without secret 401; free probe 8 x 422 insufficient_funds (warm 368-401 ms; the estimate adds ~40 ms in the same batch), relayer nonce 11 -> 11. claude-contracts 11:26: advance holder safe cap = 1 (follow-up).
