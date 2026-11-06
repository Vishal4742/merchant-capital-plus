# 008-P2-nfr4-async-send
Phase: 2 (PHASES.md)   Round: build   Owner lane: claude-relayer
Mode: phase
Money: yes
Request (verbatim):
Agent ids (builders, for SendMessage resumes):
Log:
Log:
- 06:25 started: G2 measured NFR-4 10.08 s (AT-1); ~7 s inside Ankr eth_sendRawTransactionSync; read rounds 0.35 s warm / 0.9 s cold (batching: 0.35 cold)
- 06:33 GREEN 4c41f5b (49/49); CI green 42140223700 → ci.md; reviewer-security running
- 06:30 reviewer-security PASS (F1 MEDIUM for deploy: maxDuration >= 45 s; F2-F4 LOW). Closing in phase mode; live <= 5 s proof = next relayed sale on this build
