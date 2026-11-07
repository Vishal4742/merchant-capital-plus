# Batch 051 (Stage 3): human gate packet

**Requirements:** FR-BIZ-1, FR-BIZ-2, FR-BIZ-3 (pattern), FR-AUTH-1, FR-AUTH-2, FR-AUTH-3, FR-AUTH-5, CON-11, NFR-17 (SRS v3.1); 032 R2-1.

**Last round:** `round-2/ci.md` VERDICT: PASS and `round-2/review-security.md` VERDICT: PASS. This is phase mode with Money: yes, so `tools/batch-close.sh` needs both. Draft PR #47 is stacked on #44, which is stacked on #43.

## What you are approving
1. **Legacy merchant claim.**
   - A workspace Owner links an existing merchant wallet by signing one fresh EIP-4361 message: single use, 10 minutes, bound to the principal, workspace, wallet and domain.
   - One statement links the wallet, consumes the challenge, moves the wallet's API keys into the workspace, notifies every Owner and writes the audit row.
   - One workspace per wallet.
   - A failed V1 obligations read refuses the claim (CON-11).
   - Refused claims are rate-limited.
2. **The v1 cutover.**
   - The 18 merchant handlers and the dashboard pages answer to Whiteflow sessions and workspace roles (R2-1 map).
   - The old wallet cookie (`mc_session`) is accepted nowhere.
   - API keys and webhooks are Owner-only.
   - Secret keys manage webhooks only once their wallet is linked.
3. **The dashboard way in** for people without a linked workspace: sign in → create a workspace → an Owner links the wallet.

## Acceptance (spec) → result
| # | Result | Evidence |
|---|---|---|
| 1 Claim links, moves keys, audits, notifies; no other row changes | verified locally | legacy-claim test 1 |
| 2 Proof can't be forged or reused | verified locally | legacy-claim tests 2–4, 9 |
| 3 Claim races | **verified on real Postgres** (6/6) | `tools/stage3/legacy-neon.mjs`, round-2/ci.md |
| 4 CON-11 fail closed / AT-47 | verified locally | legacy-claim test 5 (+ the rate-limit test: no chain read after the limit) |
| 5 Only Owners on our site claim | verified locally | legacy-claim test 6 |
| 6 R2-1 matrix | verified locally | legacy-cutover: 23 handler×method entries × roles |
| 7 No legacy bypass | verified locally + browser | legacy-cutover; walk g |
| 8 Removal/demotion take effect on the next request | verified locally + real PG | legacy-cutover; races 3c–3e |
| 9 Keys | verified locally | legacy-cutover keys test (linked, unlinked, pk_, mismatched) |
| 10 Tenant isolation | verified locally | legacy-cutover + existing OTHER_MERCHANT suites |
| 11 No regressions | verified (CI + local) | PR #47 CI web pass; 811/813 local |
| 12 NFR-17 | verified locally | legacy-claim NFR-17 test |
| 13 Browser journey with real Privy login | **NEEDS YOU** | panel states walked (rounds 1 and 2); the real login needs your Privy app id + verification key and a wallet |

## Decisions for you
1. **Rollout impact (approve or hold).** At deploy, the old wallet sign-in stops working for every existing merchant. Each must sign in with Privy and link their wallet once. Shops that manage webhooks with a secret key get 409 until their wallet is linked; their checkout keeps working.
2. **Merge order with batch 052** (whiteflow-8b, merchant MCP bundle, branch from main). 052 lets secret keys create and read links and read /account and the report, which amends R2-1 (keys currently can't draft). That needs your explicit OK. Whichever lands second gets rebased: if 052 merges to main first, 051 ports its key paths onto `legacyAccess` at rebase (agreed with 8b).
3. **Uncommitted edits by another party in P:/wf-051** (not in any commit and not mine): batch-050 Privy files (privy-token.ts, auth-sessions.ts, privy-config.ts, PrivySignIn.tsx) and lib/config.ts. lib/config.ts includes a hard-coded `SHOP_API_KEY` fallback. If that is a real key, rotate it, and move this work to its own branch.

## Migrations, rollout, rollback
- **Migration `054_legacy_claim.sql`:** additive and re-run safe (applied ×2 on wf_s2_web through the production driver).
- **Rollout:** apply 053 (batch 050), then 054; then deploy web with the #43 → #44 → #47 stack.
- **Rollback:** redeploy the previous build. It reads `mc_session` again and ignores `legacy_merchant` and `app_gw_keys.business_id`. The 054 table may stay.

## Known follow-ups (not blocking 051)
- **Settings page** (batch 050's file): still shows the old SIWE sign-out and copy. The 051 review requires this fixed before or with the merge to main, or listed here. Batch 050 round 2 (now led by ef) includes it.
- **Developer docs** still describe the old sign-in, and don't mention the 409 for unlinked secret keys (batch 053).
- **Capital routes** answer 500, not 502, when the RPC is unreachable (capital.ts, capital-arkiv.ts).
- **invoice-pay S5** depends on timing under parallel load.
- **Viewers are offered create forms** on links and overview (the server refuses them); role-aware forms are a Stage 4 UI task.
- **The pre-push hook** should typecheck with `--incremental false` (a stale cache hid C-H1 locally).
