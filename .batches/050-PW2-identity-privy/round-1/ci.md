VERDICT: PASS

# 050-PW2-identity-privy — round 1 ci (phase mode, lane-run; Money: yes → review-security.md from the lead's independent reviewer still required)

Branch `wf/stage3-identity` @3984984 (stacked on `wf/stage2-port` @535fffd). Node v26.13.0 (checksum-verified), Windows 11.

| Check | Command | Result |
|---|---|---|
| web typecheck | `npm run typecheck` | pass |
| web lint | `npm run lint` | 0 errors, 0 warnings |
| web tests | `npm test` | 793 tests: **791 pass, 0 fail, 2 skipped** (incl. identity-privy-token 8/8, identity-flow 12/12, csp-privy-scope 4/4) |
| web build | `npm run build` | exit 0; `/sign-in` static, `/merchant/settings` partial prerender |
| relayer | `npm run typecheck && npm test` | unchanged by this batch; 102/102 at 535fffd |
| real Postgres, Stage 3 races | `node tools/stage3/identity-neon.mjs P:/Whiteflow/.env` (wf_s2_web only) | **5/5**: schema ×2; two self-demotions 200/409; mutual removal 200 + 403 (lead ruling R2-2); two activations 200/409; one signed pair ×3 → one activation |
| browser walk | tester, round-1/test.md | VERDICT PASS (375/1440/360, focus, Viewer disabled actions) |
| pre-push hook | web typecheck + lint + tests, relayer, secret scan | "all checks passed" on every push |
| GitHub CI on PR #44 | changes, secrets, web | pass (relayer/contracts/sdk/mcp skipped: unchanged) |

Not run (needs the owner): acceptance 18 with a real Privy login — needs `PRIVY_VERIFICATION_KEY`, identity tokens enabled, and the app's allowed origins.
