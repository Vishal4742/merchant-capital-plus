# 003-P1-arkiv-probe
Phase: 1 (PHASES.md)   Round: 2   Owner lane: claude-frontend
Request (verbatim): claude-research 22:46 "Unpark the Arkiv probe (DEP-5) as your next batch after 002, so the Arkiv track stays alive." · PHASES.md Phase 1 "one Arkiv write + read (DEP-5)"
Agent ids (builders, for SendMessage resumes): claude-frontend builds directly (main session)
Log:
- 23:33 batch started after 002 closed. Spec, tests (RED then GREEN, 4/4) and the probe were prepared in the scratchpad while 002 was under review; ported now.
- 23:34 build READY: typecheck 0, lint 0, tests 20/20, build 0; client bundle clean; live probe: create 3.2 s + query 285 ms, found (tx 0x2d651b87…771e, block 258050). Round 1 tester launched.
- 23:44 round 1: tester PASS (live probe #2 found, explorer confirms tx + entity + 900-block expiry), security PASS, ux PASS, code CHANGES (F1 key range, F2 test gaps). Round 2 built: typecheck 0, lint 0, tests 23/23. Round 2 checks launched.
- 23:50 round 2: tester PASS (7/7 mutations caught), code PASS, security PASS (LOW-1 closed), ux PASS. Applied review-code R2 L1 before ci (test only: the probe output must be exactly the 7 public fields). Tests 23/23; lib/arkiv.ts 994b3885…, probe 4a8f8541… = the reviewed hashes. Deferred to the Phase 4 writer route: security LOW-2 (redacting transport) + I-2 (redact the longer form first), code L2/I-1 (0x prefix). ci launched.
- 23:52 round 2 ci PASS (typecheck/lint/test 23/23/build 0; bundle clean; no MUTATION; hashes match). Human gate passed: @arkiv-network/sdk 1.0.1 approved; keep the current Arkiv access key (human accepts the exposure via shared memory, testnet only); the source-level redaction wrapper lands with the Phase 4 writer route. Committing.
