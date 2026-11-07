# Staging plan for batch 058 (isolated; nothing here has been created, pushed or run)

Written for: the owner, who must create or approve the resources below. No secret value appears in this file.

## What I found about hosting (inspected 2026-11-07, read-only)

- **Vercel Git deploys are off** for the three real projects (`git.deploymentEnabled:false`, #46/#50). The only deployer is `.github/workflows/deploy.yml`: on a push to `main`, after a 10-minute quiet spell, it builds `main` and deploys the changed projects to production with the repo secret `VERCEL_TOKEN`. **Pushing a branch therefore creates no preview or deployment.** It does run CI on a pull request.
- **There is no preview environment to inherit from**, so staging must be its own pair of Vercel projects and its own database, deployed by its own workflow. `apps/mcp` has no Vercel project at all yet.
- Repo access: I am a collaborator with WRITE. I can push branches and open PRs; I cannot create repository secrets, variables or environments, or change branch protection. The repo has secrets `VERCEL_TOKEN` and `NEON_API_KEY`, a variable `NEON_PROJECT_ID`, and one environment, `production`. No workflow uses the Neon ones.
- The local `vercel` CLI is logged in as a different Vercel account than the team the deploy script targets (`team_f3vbq…`), and no Neon CLI is installed, so I created nothing and used neither.
- I cannot list Vercel projects, read their env, or check plan limits from here.

## Topology

| Piece | Staging value | Never |
|---|---|---|
| Git branch | `wf/ai-staging` (fast-forwarded from `wf/ai-connect`); the PR itself comes from `wf/ai-connect` | `main`; any other branch triggers nothing |
| Workflow | `.github/workflows/staging.yml`, runs only for a push to `wf/ai-staging`, job environment `staging` | `deploy.yml`, which stays main-only |
| Web project | Vercel `whiteflow-staging-web`, root `apps/web`, Git integration not connected | `merchant-capital-web` |
| MCP project | Vercel `whiteflow-staging-mcp`, root `apps/mcp`, Git integration not connected | any existing project |
| Public URLs | `https://whiteflow-staging-web.vercel.app`, `https://whiteflow-staging-mcp.vercel.app` (MCP endpoint `…/mcp`); Vercel assigns these if the names are free, otherwise use what it assigns | localhost, the sandbox, a production host |
| Database | a **new Neon project** `whiteflow-staging`, one database, its own credentials | the shared Neon database (`NEON_PROJECT_ID`) |
| Migration | `node db/migrate.mjs` (all `db/NNN_*.sql`, idempotent) from `apps/web`, in the workflow, after `db/staging-guard.mjs` | any run against a database without the staging marker |
| GitHub scope | environment `staging` holds `STAGING_DATABASE_URL` (secret) and the project-id and URL variables; production secrets are not copied there | |
| Remote switch | `WHITEFLOW_MCP_REMOTE=on` only in `whiteflow-staging-web`; production web never gets it | |

### Isolation guarantees, and how each is enforced

1. Staging projects are not the production projects and are not Git-connected: `tools/staging-deploy.sh` refuses the three production ids and refuses identical ids.
2. Staging receives its own `DATABASE_URL`. The workflow reads only `secrets.STAGING_DATABASE_URL` (environment `staging`). Production `DATABASE_URL` lives in the production Vercel projects, which staging never reads.
3. `apps/web/db/staging-guard.mjs` (tested on PGlite) stops before migrating any database that holds gateway tables but no `app_staging_marker`, so a wrong URL pasted into the secret cannot migrate the shared database.
4. A push to any branch other than `wf/ai-staging` does not start the staging workflow; a push to `main` does not start it either.
5. Production `deploy.yml` deploys `apps/mcp` only if the repository variable `VERCEL_MCP_PROJECT_ID` is set. It is not set, so merging this work deploys web (as any web change does) but never the MCP service. That variable is the production go-live switch and is **not** part of staging.

Residual risk, stated plainly: `VERCEL_TOKEN` is a repository-level secret, so a workflow on any branch a collaborator pushes could read it. Staging reuses it and the guard above is what keeps staging off production. A token scoped to the two staging projects would be stronger; I cannot create one.

## Environment variables by project (names only; values never in git)

**whiteflow-staging-mcp** (all Production scope of that project):
| Name | Source |
|---|---|
| `WHITEFLOW_MCP_PUBLIC_URL` | the staging MCP URL ending `/mcp` |
| `WHITEFLOW_WEB_ORIGIN` | the staging web origin |
| `MCP_INTERNAL_SECRET` | fresh random, 32+ chars; **identical** in staging web |
| `DATABASE_URL` | the staging Neon database |
| `WHITEFLOW_MCP_ALLOWED_ORIGINS` | optional; default allows claude.ai, claude.com, chatgpt.com |
| `WHITEFLOW_MCP_ALLOW_LOOPBACK` | **never set** |

**whiteflow-staging-web** (Production scope of that project):
| Name | Source |
|---|---|
| `DATABASE_URL` | the staging Neon database (not the shared one) |
| `AUTH_SECRET` | fresh random, 32+ chars (not the production value) |
| `PUBLIC_ORIGIN` | the staging web origin (SIWE domain) |
| `MCP_INTERNAL_SECRET` | the same value as the MCP project |
| `WHITEFLOW_MCP_PUBLIC_URL` | the staging MCP URL ending `/mcp` |
| `WHITEFLOW_MCP_REMOTE` | `on` (staging only) |
| `MERCHANT_PAY_ADDRESS`, `RELAYER_URL` | public config copied from production web (testnet MerchantPay and relayer URL) |
| `MERCHANT_ADDRESS`, `MERCHANT_NAME`, `SHOP_API_KEY` | only if the Overview should render; the demo-shop identity |
| `VOUCHER_HASH_SECRET` | fresh random (vouchers aren't used in acceptance) |
| `RELAY_API_SECRET` | **only for the final payment journey**, and it is the production relayer's secret: see the decision in the approval packet. Leave unset until then |

Generate secrets without printing them, for example `openssl rand -hex 32 | vercel env add MCP_INTERNAL_SECRET production` (once per project; the two values must match, so generate once and pipe it twice).

**GitHub environment `staging`:** secret `STAGING_DATABASE_URL`; variables `VERCEL_STAGING_WEB_PROJECT_ID`, `VERCEL_STAGING_MCP_PROJECT_ID`, `STAGING_WEB_URL`, `STAGING_MCP_URL`. The existing repo secret `VERCEL_TOKEN` is reused.

## Order of operations (after approval)

1. Owner (or me, if authorised to run provisioning) creates the Neon project and the two Vercel projects, sets the env above, and creates the GitHub environment `staging` with its secret and variables.
2. Push `wf/ai-connect-058` (058 only, merged with current main; see DELIVERY.md §0.3) and open the PR (CI runs; no deployment).
3. Point `wf/ai-staging` at the same commit and push: the staging workflow guards, migrates, deploys, smoke-checks.
4. Hosted verification (section below), then client acceptance. `WHITEFLOW_MCP_REMOTE=on` was already staging-only.

## Hosted verification to run (and record) on staging, not substituted by PGlite

`tools/staging-smoke.sh` covers liveness, readiness (database connectivity), discovery, S256-only, the 401 challenge, the origin refusal and consent-route protection. Beyond it, on the hosted runtime: the full OAuth flow with a real browser sign-in (PKCE, consent redirect, code exchange, refresh rotation and reuse, wrong audience, scope denial, Disconnect), and a **concurrency check against the hosted Neon database**: 20 simultaneous identical `create_payment_link` calls with one idempotency key must produce one link and one journal entry (`apps/mcp/scripts/staging-concurrency.mjs`, run with a staging access token; it prints counts only).

## Migration procedure (staging database only)

```
cd apps/web
DATABASE_URL=<staging url, never the shared one> node db/staging-guard.mjs   # must print OK
DATABASE_URL=<staging url> node db/migrate.mjs                              # applies 001..051, prints table names
```
Expected: `staging-guard: OK` first (empty database claimed), then `applied 001_keys.sql … applied 051_mcp_remote.sql`. Anything else, stop. The workflow does exactly this with `STAGING_DATABASE_URL`.

## Rollback (staging)

Delete or pause `whiteflow-staging-mcp` (no assistant can connect), or unset `WHITEFLOW_MCP_REMOTE` on staging web (the page stops offering setup). Revoke everything instantly with `UPDATE app_mcp_grants SET revoked_at = <ms> WHERE revoked_at IS NULL` on the staging database. Delete the Neon project to remove all staging data. Production is untouched at every step.
