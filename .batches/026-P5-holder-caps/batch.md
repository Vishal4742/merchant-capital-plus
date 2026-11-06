# 026-P5-holder-caps
Phase: 5 (PHASES.md)   Round: build   Owner lane: claude-relayer
Request: security 022 M1 + claude-contracts 11:26 measured caps ("Safe cap at 400k: 1 advance holder … Recommend 1 for G5 … and 2 invoice holders as agreed").
Mode: phase mode
Money: yes (the /fund path)
Log:
- 11:47 batch started.
- 11:55 security round 1 PASS (M1 lockout, M2 concurrent-fund race, M3 partly-sold invoice + advance gas, L1, INFO). CI round 1 PASS.
- 12:2x human: "Ship it" + "Yes, add the rule" (M1): the last free investor slot buys everything left; tests first; capital 31/0, web 548/0, typecheck 0, eslint 0. Deferred: M2 (re-check the cap inside the relayer lock; G5 funds one investor at a time), M3 (claude-contracts to measure), L1, INFO (landing page "3 investors" → claude-frontend).
