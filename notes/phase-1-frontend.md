# Phase 1, frontend lane (claude-frontend): web rail proofs

Batch `001-P1-web-rail-proofs` · branch `main` · SRS NFR-11, DEP-6 / FR-PRIV-1 (first read), DEP-3 (guest wallet), NFR-8 · gate G1 (frontend half: one private read in our app).

## What was built
- `apps/web`: Next.js **16.4.3** (create-next-app, App Router, Tailwind 4.3.3, ESLint), React 19.3.0, viem **2.57.13**, `@anon-rpc/browser-harness` **0.4.0**. Every pin is exact. No wagmi, react-query or Privy.
- `lib/anon.ts`: the Nym `AnonRpcWorker`, loaded with a dynamic import on the client only, feeding a viem client on `whitechainSepolia` through `http(ANKR, { fetchFn: worker.fetch, timeout: 60_000, retryCount: 1 })`, plus:
  - **pinned worker hash** `0xf13a448a…1fceb8`: the bootstrap RPC can't swap the bundle
  - a **90 s boot deadline**
  - a failed or stalled boot is closed and forgotten, so a retry starts fresh
- `lib/guest-wallet.ts`: a browser-held guest key in localStorage, never overwritten, with unreadable values refused without echoing them. A DEP-3 proof signs the USDT `ReceiveWithAuthorization` shape (domain "Tether USD"/"1"/1874) that can never move funds.
- `app/page.tsx`: the rail-proof page:
  - running / OK / failed states with a live seconds counter
  - one plain failure line
  - retry that keeps keyboard focus (`aria-disabled`)
- `test/`: 11 `node:test` tests with no new dependency:
  - boot deadline, retry after a failed boot, hash pin accept/refuse/pass-through
  - guest key create/keep/refuse
  - the typed-data digest equals the one the deployed USDT computes from its on-chain type hash

## Verified (with which output)
- Round 3, every check PASS: tester, reviewer-code (3 mutation checks caught), reviewer-security (hash confirmed via 2 RPCs plus keccak of the bundle), reviewer-ux-ui, ci (`npm ci`, lint 0, 11/11 tests, build 0, secrets grep clean).
- Live in Chrome: block 12,295,764 via Nym in 25.2 s; later reads 15–74 s; 12 of 13 reads succeeded in round 3.
- **0 requests to rpc.ankr.com from the page.** Plain traffic: 2 bootstrap `eth_call`s (publicnode), the bundle (jsDelivr, then unpkg, then raw.githubusercontent), 7 GETs to validator.nymtech.net, and WSS to a Nym gateway.
- Human gate (2026-11-05 21:58): saw both cards OK.

## Decisions (human, 21:58)
- Guest key in localStorage: OK for the demo; a CSP and security headers come before any screen that signs money (Phase 2).
- Pinned Nym hash: fail closed is OK; claude-frontend updates the pin if Nym ships new code.
- Plain traffic: **reduce, then disclose**. Answer the two specifier reads locally (the hash is already pinned) and serve the bundle from our own origin, so the only plain traffic left is Nym's directory and gateway. Disclose those under FR-PRIV-4.
- Boot deadline stays at **90 s**.
- Meta description and the new packages (viem, Anon-RPC, Next, Tailwind, three.js) approved.

## Open
- Cold-read reliability: 1 to 2 failures in 16 reads, about 45–50 s after the tunnel was ready. Pre-warm the worker on app load in Phase 2.
- Harness 0.4.0 bug: `close()` can't stop a boot whose bundle arrives late, leaving an orphan iframe. Report it upstream; also fix the comment.
- LOW follow-ups (stricter bootstrap request check, one test, comments, a `typecheck` script with `next typegen`) go into batch 002.
- Arkiv (DEP-5) is blocked: Rabdi RPC hangs with and without the access key. The probe moves to batch 003, and every problem is posted on agentbus.
