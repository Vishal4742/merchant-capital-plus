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

## Batch 003-P1-arkiv-probe (DEP-5)

Branch `main` · SRS DEP-5, NFR-3, NFR-8, SR-ARK-1 (evidence). Requested by claude-research at 22:46 after Rabdi came back from a 2.5 h outage.

### What was built
- `@arkiv-network/sdk` **1.0.1** (exact pin; 1 package, no runtime dependencies, no install scripts, SLSA provenance from Arkiv-Network/arkiv-sdk-js CI; the tarball is byte-identical to the registry's).
- `lib/arkiv.ts` (server-only):
  - `arkivClients(env)` returns the Rabdi 7794095 reader + writer + the public writer address.
  - The key is validated by `privateKeyToAccount` inside a try/catch that rethrows a fixed message with no cause. noble's own error prints an out-of-range key in decimal.
  - An empty or whitespace-only access key is refused, because the SDK would otherwise fall back silently to the rate-limited public endpoint.
  - `redactArkivError` strips the access key, raw and URL-encoded. The SDK puts it in the RPC URL path, and viem copies that URL into error messages.
- `scripts/arkiv-probe.ts`: creates one `mcplus.probe.v1` entity (30-minute expiry), queries it back with `ownedBy`, and prints only the 7 public fields. It exits 1 if the entity isn't found or on any error.
- `tsconfig.json`: `allowImportingTsExtensions`, so Node's type stripping runs the probe's `.ts` import and tsc still checks it.

### Verified
- **Live (round 1):**
  - Run 1, 23:34 IST: tx `0x2d651b87c027419949d12cb650c7ca70ce7b65246e802fc44e213b0fc42b771e`, block 258050, create 3.2 s + query 285 ms, found.
  - Run 2 (tester), 23:36: tx `0xf604d899622385782ab905b4f20f31230241f6face49dfb87524ad81a9fcb89d`, block 258117, create 7.2 s + query 309 ms.
  - The Rabdi explorer shows the CREATE, the schema, the attributes (`at`, `note` = "dep-5 probe") and expiry at block 259017 (900 blocks = 30 min).
  - The schema query `arkiv.schema = str('mcplus.probe.v1')` returns 2 entities in 304 ms.
- **Round 2:** tester, code, security and ux all PASS. Tests 23/23, including 7 Arkiv tests. Mutations caught:
  - try/catch removed, cause passed on, value echoed
  - `.trim()` dropped
  - only the raw form, or only the encoded form, redacted
  - the probe printing an extra field
- The client bundle has no `ARKIV_`, Rabdi host or SDK reference.

### Decisions (human gate, batch 003)
- `@arkiv-network/sdk` 1.0.1 approved.
- Keep the current Arkiv access key. It was pasted into chat and so captured by shared memory; the human accepts that exposure for a testnet, rate-limited key.
- The source-level redaction (security LOW-2) lands with the Phase 4 writer route, where server logs first become possible.

### Open (Phase 4 writer route, owner claude-frontend)
- security LOW-2: redaction only covers the message string. A route that logs the whole error would put the access key in server logs, so sanitize at the source (a redacting transport that throws a fresh Error with no cause) and add `server-only`.
- security I-2: redact the URL-encoded form before the raw one, so a key containing `%` leaves no fragment.
- code L2 / security I-1: `privateKeyToAccount` doesn't check the `0x` prefix (`0X…` and `zz…` load the same address; nothing leaks).
- Process: testers mutate a scratch copy, never the repo file, while reviewers run in parallel. In round 2 two reviewers briefly loaded a mutant.
