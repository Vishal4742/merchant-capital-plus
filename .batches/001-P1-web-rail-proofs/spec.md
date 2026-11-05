# Spec: 001-P1-web-rail-proofs

## Requirements (cite docs/SRS.md IDs)
- NFR-11: `apps/web` Next.js skeleton passes `npx tsc --noEmit`, `npm run lint` and `npm run build`
- DEP-6 / FR-PRIV-1 (first read only): one chain-1874 read made in the browser through Anon-RPC (Nym specifier), with viem `http(ANKR, { fetchFn: worker.fetch, timeout: 60_000 })`
- DEP-3 (decided 20:31: guest wallet, no Privy): a browser-held guest key signs EIP-712 typed data for chain 1874 (the USDT `ReceiveWithAuthorization` shape, domain "Tether USD" / "1" / 1874 / USDT), verified locally with viem `verifyTypedData`
- NFR-8: no third-party trackers or analytics in the client
- FR-PAY-7 / NFR-6 groundwork: nothing customer-facing yet; the proof page is internal

## Acceptance criteria (each checkable)
- [ ] `cd apps/web && npx tsc --noEmit && npm run lint && npm run build` all exit 0 (output in build-claude-frontend.md)
- [ ] `/` (rail-proof page) shows the latest 1874 block number read through the Nym worker. The page labels it "via Anon-RPC (Nym)" and makes **no** direct request to rpc.ankr.com (checked in the network tab). Plain traffic is limited to what Anon-RPC itself needs, all disclosed under FR-PRIV-4: the 2 bootstrap mainnet `eth_call`s, the worker bundle (jsDelivr, falling back to unpkg or raw.githubusercontent), Nym's directory GETs to validator.nymtech.net and WSS connections (2 per boot) to one Nym entry gateway. The worker hash is pinned in code, so the bootstrap RPC can't swap the bundle
- [ ] The guest wallet is created once, persists across reloads (localStorage), and its typed-data signature verifies (`verifyTypedData` → true) for the 1874 / USDT domain
- [ ] The page shows clear states for each proof: running (with a live seconds counter) / ok / failed (one plain line that wraps at 375). The retry button stays mounted, keeps keyboard focus, and recovers from a failed or stalled (90 s deadline) Nym boot without a reload
- [ ] `npm test` passes (guest wallet, retry after a failed boot, pinned worker hash)
- [ ] No key or `.env` value appears in source, logs or the page; the guest key never leaves the browser
- [ ] Screenshots at 375 and 1440 in the round's shots/ folder

## Files to touch (owner lane: only these)
- `apps/web/**` (create-next-app 16.4.3 scaffold, TypeScript + App Router + Tailwind + ESLint; pins per docs/FRONTEND-PLAN.md)
- `apps/web/lib/anon.ts` (Nym worker + viem client), `apps/web/lib/guest-wallet.ts`, `apps/web/app/page.tsx` (proof page)
- `apps/web/test/*.test.mjs` (Node's built-in test runner, no new dependency)
- `docs/FRONTEND-PLAN.md` (this lane's plan: pins and status)

## Ponytail ladder
- Needed: DEP-6 and DEP-3 are Phase 1 exit checks (gate G1). Already in repo: nothing (first app code). Platform: localStorage for the guest key, `crypto.getRandomValues` through viem `generatePrivateKey`. Installed deps: viem does chain reads, signing and verification, so no wagmi, no react-query, no Privy. Anon-RPC: `@anon-rpc/browser-harness` 0.4.0, loaded with a dynamic import on the client only (it touches `document`). Minimum code: one lib file per proof plus one page.

## Out of scope
- Arkiv create + query (DEP-5): batch 002, once `ARKIV_ACCESS_KEY` is in `.env`
- Tor fallback, the private-reads meter (FR-PRIV-3), CSP and `iframeUrl` (no CSP yet)
- Vercel project and Neon (human + frontend, separate step)
- Design system (v7 confirm in Phase 2); the proof page uses plain Tailwind
- Any customer, merchant or investor screen (Phase 2+)
