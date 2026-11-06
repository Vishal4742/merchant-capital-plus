# 006-P4-web-gateway-shell
Phase: 4 (PHASES.md v2.0)   Round: 2   Owner lane: claude-frontend
Request (verbatim): "The plan has changed. Check the new plan for frontend and start us building." (02:44) · "ya ggod nedded some naimations and other things ill tell you" (03:08, approving the gateway v2 design demo)
Agent ids (builders, for SendMessage resumes): developer subagent (phase A built in scratch b009)
Log:
- 03:14 batch started after 005 closed. Phase A (lib/fx.ts with live FX, the test-mode badge, the dashboard Shell/Nav, /docs, GET /api/v1/payments; 139 tests in scratch) is done; phase B (layout badge, sessions v2, checkout upgrades, the merchant page in the shell, the approved v2 design, carried 005 follow-ups) starts now on a fresh copy of main.
- 03:45 phase B copied in (diff empty) + payments route uses plainUsdt; typecheck/lint 0, tests 179 + 3 live skipped, build 0; EUR session live on :3100. Round 1 launched.
- 05:48 round 1: tester PASS, code PASS (6 MEDIUM follow-ups), security PASS (F1 FX sanity band, F2 FX definition), ux CHANGES (F1-F5). HUMAN DECISIONS: (1) FX single source = claude-contracts' backend quotes module; lib/fx.ts is the bridge until their PR merges, then deleted; (2) add the FX sanity limit now (per-currency band, AED near its peg, rate date not stale or future). Round 2 to the builder.
- 05:58 round 2 copied in (17 files; package.json/lock from main after PR #11 + #9 merged; npm ci): typecheck/lint 0, tests 293 (290 pass, 3 live skipped), build 0; :3100 restarted. Round 2 launched.
- 06:18 round 2: tester PASS, code PASS, security PASS, ux PASS, ci PASS. AT-1 live on this build (tx 0x7e03…7a11). Follow-ups for the P4 fix batch: 1,000 USDT cap (§4b), lib/fx.ts -> quotes.ts switch, link sessions with priced + 10 min, demo-checkout relative redirect, /docs headers-before-merchant, /docs wordmark <a>, idempotency delete-by-entry, demo-checkout rate limit, sessions GET merchant check, x-relay-secret header. Waiting on the human gate.
