VERDICT: PASS

# 009-P2-vercel-deploy, round 1: security review (phase mode, Money: yes)

Scope: `git diff a53bc2e~1 e82f484 -- apps/relayer`, the staging dir `scratchpad/deploy-relayer`, and the live deployment at https://merchant-capital-relayer.vercel.app. Read-only. No transactions, no valid payment POSTs, no key or secret value printed. I found no HIGH or CRITICAL issues.

## Live checks (06:40-06:46 IST, plain curl, no secret header)
- 404: `/.env`, `/.env.local`, `/.env.production`, `/src/relayer.ts`, `/src/contracts.ts`, `/package.json`, `/package-lock.json`, `/vercel.json`, `/.vercelignore`, `/dev.ts`, `/test/relayer.test.ts`, `/tsconfig.json`, `/.git/config`, `/.vercel/project.json`. I rechecked `/.env`, `/src/relayer.ts`, `/package.json`, `/vercel.json` and `/dev.ts` after the checkpoint cleared (F2): still 404.
- `/api/health.ts` returns 200 with the health JSON, and `/api/relay.ts` returns 405. Both route to the functions. Neither serves source.
- `/health` returns 200: relayer `0xdd02…a651`, wbt 0.496, budgetLeft 0.1. `GET /relay` returns 405.
- `POST /relay` returns 401 `unauthorized` with no header, and 401 again with `x-relay-secret: wrong`.
- `OPTIONS /relay` with a foreign Origin returns 405 and no `access-control-*` headers, so cross-site calls get no CORS.
- `/.gitkeep` returns 200 with an empty body (it is `public/.gitkeep`). Harmless.

## Batch 006 deploy requirements
| | Status | Evidence |
|---|---|---|
| D1 `.env` never uploaded | Met | `apps/relayer/.vercelignore:1-5`, `public/` exists (project inspect: output dir is `public` if it exists). The staging dir matches `git archive e82f484:apps/relayer` exactly, apart from the CLI-made `.vercel/` and a `.gitignore` (`.vercel`, `.env*`). It holds no `.env*` file, so the `.env.local` with the OIDC token is gone. The live 404s are listed above. |
| D2 Production-only, Sensitive | Met | `vercel env ls` lists only `RELAY_API_SECRET` and `RELAYER_PRIVATE_KEY`, type "Secret", environments Production. CLI 64.3.1 `isSecretEnvVar` labels `type==="sensitive"` as "Secret". `RPC_URL` is unset and there are no Preview or Development vars. `vercel ls` shows no preview deployments. Both generated deployment URLs return 302 to Vercel Authentication, so protection is on. |
| D3 web sends header, server-only | Met (main, web lane) | `main:apps/web/lib/relay.ts:49-56` reads `RELAY_API_SECRET` from the server env and sends it only over https or loopback. `git grep NEXT_PUBLIC_RELAY main -- apps/web` has no hits. |
| D4 small hot wallet | Met | 0.496 WBT live. |
| D5 rewrites + maxDuration | Met | `apps/relayer/vercel.json:3-7` has `maxDuration` 60 (≥ 45 s per batch 008 F1), region iad1, and both rewrites. |

Other checks:
- `src/contracts.ts` is byte-identical to `packages/shared/contracts.ts` in the working tree, at e82f484 and in the staging dir.
- `api/` and `src/relayer.ts` contain no `console.*`, so no headers or bodies get logged.

## Secret grep (`PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64}` on the 8 diff files)
- `src/relayer.ts:83,84,89`: the env var name and its error messages. No values.
- `test/relayer.test.ts:738-747`: the test saves and restores the env var name.
- `test/relayer.test.ts:218`: the USDT EIP-712 domain separator, a public hash.
- `test/relayer.test.ts:563`: `SECP256K1_N`, the public curve order.
- `src/contracts.ts`, `vercel.json`, `.vercelignore`, `package.json`, `test/contracts-copy.test.ts`: no hits.

None of the hits is a key.

## Findings

### F1 MEDIUM: two key-holding relayers share one EOA until the web switches
- Where: `apps/relayer/src/relayer.ts:333-351`. The nonce comes from `getTransactionCount('pending')` inside a lock that serializes sends within one process only. `sentAuthorizations` is per process (line 351).
- Fact: `127.0.0.1:8787` (node PID 28514, loopback only) reports the same address `0xdd02…a651` as Vercel prod. Its ledger shows 0.00106 WBT spent, while Vercel's shows 0.
- Exploit sketch (operational, no attacker needed): a web test against local and a sale on prod, or two Vercel instances, send at the same moment and both sign nonce N. The node rejects or drops one of them. That instance returns 502 with a txHash that never mines, and a re-POST to the same instance gets REPLAY. Nothing is lost and nothing is paid twice, because the on-chain EIP-3009 nonce prevents it and the authorization stays unused until `validBefore`. The demo would still show a failed payment.
- Budget: each process keeps its own ledger, so the daily cap is 0.1 WBT per process. The wallet balance (0.496) is the real cap, as D4 accepts.
- Fix: stop the local :8787 relayer, or restart it with a separate throwaway testnet key, as soon as claude-frontend switches `RELAYER_URL` to prod. Don't run web tests against local while prod takes sales.
- Owner: claude-relayer, with claude-frontend confirming the switch.

### F2 LOW: Vercel burst mitigation can return 403 HTML in front of `/relay`
- Fact: about 25 probes in a few seconds got my IP challenged at about 06:41. Responses were `403` with `x-vercel-mitigated: challenge` and the "Vercel Security Checkpoint" HTML. It cleared by itself by 06:44.
- Risk: availability only. A challenged request never reaches the function, so nothing is broadcast and a retry is safe.
- Fix (web): treat a non-JSON 403 or `x-vercel-mitigated` as "relayer busy, retry". Never treat it as a payment rejection, and never render the HTML. The human decided to keep protection on. If the problem recurs, bypass it for `/health` and `/relay` only, never project-wide. The `x-relay-secret` check still guards `/relay` without it.
- Owner: claude-frontend.

### F3 LOW (process): step 1 went to Production, not Preview
- Fact: `vercel ls` shows two Production deployments and no Preview. `lyx3wehf6` was created about 6 min ago, before the env vars (about 4 min ago), so it holds no secrets. A rollback to it would fail closed (no key, and 401 for every request). Both deployment URLs sit behind Vercel Authentication (302).
- Spec item 5 said `vercel deploy` (preview).
- Fix: none needed. Record the deviation in `batch.md`.
- Owner: claude-relayer.
