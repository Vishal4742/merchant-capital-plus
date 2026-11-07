VERDICT: PASS

# CI + deploy evidence: 009-P2-vercel-deploy (phase mode, PIPELINE.md §3b)
- Own checks: `npx tsc --noEmit` exit 0; `npm test` 50/50 (incl. the contracts-copy test).
- GitHub Actions on `e82f484`: https://github.com/Vishal4742/whiteflow/actions/runs/42141158571 — success (changes, secrets, relayer).
- Preview (no secrets, 06:33): `merchant-capital-relayer-lyx3wehf6-…vercel.app` via `vercel curl`: /.env, /src/relayer.ts, /package.json 404; /health 500 (no key: fail closed); POST /relay 401 from the app itself (so the `.ts` imports and the vendored contracts resolve on Vercel).
- Production (06:37): https://merchant-capital-relayer.vercel.app — `vercel env ls`: RELAYER_PRIVATE_KEY, RELAY_API_SECRET = Secret, **Production only** (added via stdin, never printed); /.env, /.env.local, /src/relayer.ts, /package.json, /vercel.json 404; /health 200 (relayer 0xdd02…a651, 0.4963 WBT); POST without header 401.
- From the production URL: AT-10 every code (replay of the NFR-4 sale 0xd1a71cb5…987a → 422 replay via on-chain authorizationState), relayer nonce 5 → 5; NFR-14 p95 /health 280 ms, local reject 280 ms, RPC reject 363 ms.
- NFR-4 on the local new build (same code): sale 0xd1a71cb5…987a sign-to-receipt 4.40 s (claude-frontend).
