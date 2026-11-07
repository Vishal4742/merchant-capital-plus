VERDICT: PASS

# Batch 051 round 2: CI

## GitHub CI on draft PR #47 (head fe2059a, base wf/stage3-identity)
| Check | Result |
|---|---|
| changes | pass (6 s) |
| secrets | pass (5 s) |
| web | pass (3 m 8 s), run 42290815370 |
| contracts, relayer, sdk, mcp | skipped (this branch changes none of them) |
| CodeRabbit | skipped (draft) |
| Vercel (web, relayer, shop) | fail: "Deployment rate limited — retry in 24 hours" (the account's build limit, not the code; the same on #44). No preview was deployed. |

## Local, on a clean detached worktree at 04266ce (the final code; fe2059a adds docs only)
These ran away from P:/wf-051, whose working tree holds another party's uncommitted edits to batch-050 files and lib/config.ts.

| Command | Result |
|---|---|
| `next typegen && tsc --noEmit --incremental false` | 0 errors |
| `npm run lint` | clean |
| `node --experimental-test-module-mocks --test test/` (Node 26.13.0) | 813 tests, 811 pass, 0 fail, 2 skipped |
| `npm run build` | exit 0 (60/60 static pages; two "shop key check: Error" lines from lib/shop-auth.ts at build time with no database; not this batch, and the exit code is 0) |
| `node tools/stage3/legacy-neon.mjs P:/Whiteflow/.env` (Neon production driver, wf_s2_web) | 6/6: schema; 3a one claim ×3; 3b two workspaces × one wallet; 3c claim vs removal (free); 3d claim vs removal (staged); 3e claim vs demotion (staged) |
| pre-push hook (push of fe2059a from the clean worktree) | web typecheck, lint, tests, relayer typecheck and tests: all passed |

## Reviews and walks
- Round 1:
  - review-security PASS;
  - review-code FAIL (C-H1, fixed in 646adc6);
  - browser walk PASS (a–i, independent).
- Round 2:
  - review-security PASS;
  - review-code PASS;
  - targeted browser re-walk 30/30, after one more overflow fix in 04266ce.

## Flakes seen (not caused by this batch)
- **invoice-pay S5** ("read 'open' before another paid it") uses an 80 ms wall-clock margin. It failed once in the hook's parallel run and once in five isolated runs under background `npm ci` load. Idle: HEAD 8/8, base d8a99ef 8/8. **Follow-up:** make it event-driven.
- **invoice-pay "without MerchantPay or a relayer configured…" and "only the shop's own invoices…"** fail deterministically (2/2, every run) **in P:/wf-051's dirty working tree only.** There, another party's uncommitted lib/config.ts adds hard-coded MERCHANT_ADDRESS/SHOP_API_KEY/MERCHANT_PAY_ADDRESS fallbacks. On the clean worktree at the same commit: 5/5 runs, 0 failures (base: 5/5, 0 failures).
