# 062-P5-mcp-client-readiness
Phase: 5. Status: implemented locally; release gate OPEN.
Request: make MCP page fully working for ChatGPT, Claude and compatible connectors.
Branch: codex/mcp-connect-ready, isolated managed worktree based on wf/ai-connect-058 merged with locally available origin/main.
No commits, pushes, external migrations or deployments performed. All merge conflicts resolved; merge remains uncommitted for review.

Implemented: current workspace authentication for consent and MCP gateway; Owner-only grant management; business/principal-bound grants; removal/demotion invalidation; safe login return to consent; direct URL/OAuth setup and Claude DCR instructions; old placeholder configuration removed; unknown grant-load status fixed.

Validation on Node 26.13.0:
- packages/mcp: 73/73 PASS.
- apps/mcp: 28/28 PASS, including real HTTP SDK client and PGlite (not hosted Neon).
- apps/web full: 949 tests, 942 pass, 6 skip, 1 obsolete page-copy assertion. Assertion updated; affected frontend suite 7/7 PASS. No product failures remaining in this run.
- web typecheck PASS, production build PASS; lint 0 errors and one unused suppression (removed).
- apps/mcp typecheck and deploy bundle build PASS.
- git diff --check PASS; no unresolved merge paths.
- Public /connect browser inspected against production build: correct unavailable state without provisioning. Authenticated/ready/mobile UI not browser-verified.

Review: independent UI/security inspection PASS (two follow-ups fixed). Final independent integrated auth review not completed: reviewer agents hit usage limits. Gate remains OPEN; do not represent as release-approved.

External blockers: owner confirmed staging resources absent. GitHub API confirms push=true admin=false; only production environment exists. Vercel CLI identity builder3base-8480 differs from intended team account. Need owner/admin staging environment plus isolated Neon, web/MCP Vercel projects and Privy config. See STAGING.md. Production remains out of scope.
