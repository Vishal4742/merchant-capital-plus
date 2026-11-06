# Spec: 009-P2-vercel-deploy (phase mode, Money: yes)

## Requirements
- Research queue item 4 / G2 plan RL6: deploy `apps/relayer` to the existing Vercel project `merchant-capital-relayer` (iad1, Node 26.x, Root Directory `.`) so the web app reaches it. Human 06:10: step 1 preview with **no secrets**; step 2 `RELAYER_PRIVATE_KEY` + `RELAY_API_SECRET` in **Production only**, Sensitive, once the web sends `x-relay-secret`.
- **NFR-3 / CON-7**: no key ever uploaded as a file (batch 006 security D1: Vercel CLI 64.3.1 ignores neither `.gitignore` nor a plain `.env`); keys only in Vercel env (Production).
- **FR-REL-1 / FR-REL-6**: `POST /relay`, `GET /health` at the deployed URL; **NFR-14** measured from it (human 23:27).

## Changes
1. `apps/relayer/src/contracts.ts`: a byte-for-byte copy of `packages/shared/contracts.ts` (generated, claude-contracts); `src/relayer.ts` and tests import it. A test fails if the copy differs from `packages/shared/contracts.ts` (when that file exists, i.e. in the repo/CI). Reason: the deploy uploads only `apps/relayer`.
2. `apps/relayer/vercel.json`: rewrites `/relay` → `/api/relay`, `/health` → `/api/health`; `functions` `maxDuration` 60 (≥ 45 s: batch 008 security F1); region `iad1`.
3. `apps/relayer/public/.gitkeep` (empty static output, so the source tree is never served) and `apps/relayer/.vercelignore` (`.env`, `.env.*`, `test`, `dev.ts`, `node_modules`).
4. `package.json` `engines.node` → `"26.x"`.
5. Deploy procedure (no code): `git archive HEAD:apps/relayer` into an empty staging dir (committed files only: a `.env` cannot be in it), `vercel link --project merchant-capital-relayer`, `vercel deploy` (preview, no env vars). Verify: `GET /.env`, `/src/relayer.ts`, `/package.json` → 404; `GET /health` answers without secrets (500: no key); `POST /relay` → 401 (no `RELAY_API_SECRET`).
6. Step 2 (after the web sends the header): `vercel env add RELAYER_PRIVATE_KEY production --sensitive` and `RELAY_API_SECRET` the same way, values piped from `apps/relayer/.env` (never printed); `vercel deploy --prod`; verify `/health` (relayer address, WBT) and AT-10 + NFR-14 from the URL; send the URL to claude-frontend.

## Acceptance criteria
- [ ] `npx tsc --noEmit && npm test` pass; the copy test passes.
- [ ] Preview: the 404/500/401 checks above, recorded with the URL.
- [ ] Production: `/health` shows `0xdd02…a651`; AT-10 rejects + nonce unchanged; NFR-14 p95 from the URL; one relayed sale ≤ 5 s (NFR-4) with the web app.
- [ ] `vercel env ls` shows the two variables in Production only.

## Out of scope
- Postgres-backed state (per-instance ledger accepted, human 05:51), fee swap.
