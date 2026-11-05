VERDICT: CHANGES

# Security review: 001-P1-web-rail-proofs, round 1 (reviewer-security)

Scope: `apps/web/` without `node_modules` and `.next` (`app/`, `lib/`, `test/`, `package.json`, `package-lock.json`, `next.config.ts`, `.gitignore`, `tsconfig.json`). I also read the shipped dependency code that runs in our origin: `@anon-rpc/browser-harness` 0.4.0, `@anon-rpc/harness-core` 0.4.0 and `@kpstreams/*` 0.2.1. I ran three read-only probes: `eth_call`s to the Nym specifier on mainnet (publicnode) and to USDT on 1874 (Ankr). No `.env` value was read or printed. I don't repeat the tester's findings: the XSS-readable localStorage key, `connect()` never awaiting `worker.ready`, the error overflow, the network-claim wording and the Cloudflare NEL header.

One blocking finding (S1). The rest are LOW or INFO and don't block.

## OPEN (CHANGES findings)

### S1 [MEDIUM, blocking] The Nym bundle hash check trusts one unauthenticated RPC answer and a pointer whose owner can change it
- **Files:** `apps/web/lib/anon.ts:8-10` (the comment says the harness reads the specifier "to find and hash-check the worker bundle") and `apps/web/lib/anon.ts:19-23` (one bootstrap client, passed straight through as `rpcProvider`). Owner: **claude-frontend**.
- **What the harness does:** `harness-core/dist/specifier.js:14-21` reads `workerHash()` and `workerResolvers()` with two `eth_call`s at `"latest"` through the provider we pass. `:60-88` then checks the downloaded bytes against that same answer. The check only catches a tampered CDN. Whoever controls the RPC answer picks both the hash and the URL.
- **The pointer can change:** the specifier `0x3aCD…eD0` has an owner, `owner()` = `0xD8d4…4518`. Its bytecode has `setWorker(bytes32,string[])` and `transferOwnership(address)`. So the owner can swap the bundle at any time, and our app would run the new one with no review.
- **Current values (read 2026-11-05):**
  - `workerHash` = `0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8`
  - resolvers:
    - `cdn.jsdelivr.net/npm/@nymproject/anon-rpc-worker@0.1.0/…`
    - `unpkg.com/…@0.1.0/…`
    - `raw.githubusercontent.com/nymtech/anon-rpc-worker/keccak/f1/3a44…`
- **Exploit sketch:**
  1. publicnode, or anyone who controls its responses, returns `workerHash = keccak(evil.js)` and resolvers `["https://evil.example/evil.js"]`.
  2. The harness fetches `evil.js`. The hash matches, so the harness runs it as the worker.
  3. Every chain-1874 read now goes to `evil.js`. It can send the request bodies, with timing, to its own server, which defeats FR-PRIV-1. It can also answer with forged results. Today that is only a block number. From Phase 2 on it could be balances, invoice status, offers and quotes, for example a dashboard that shows an unpaid invoice as paid.
  4. The specifier owner can do the same thing with `setWorker`.
- **What still holds:** the bundle runs in a `sandbox="allow-scripts"` srcdoc iframe with a null origin (`browser-harness/dist/host.js:598-602`), plus a Web Worker inside it. It can't read `mcplus.guestKey` (the tester's sandbox `localStorage` error confirms this) and it can't sign anything.
- **Fix:** pin the hash in `lib/anon.ts` and check it in the provider wrapper. A lying RPC or a specifier change then fails closed:
  ```ts
  // Nym anon-rpc-worker 0.1.0, the bundle round 1 ran. The harness trusts whatever the bootstrap RPC says
  // the specifier holds, so a lying RPC or a setWorker() upgrade would otherwise run a new bundle unreviewed.
  const NYM_WORKER_HASH = "0xf13a448a8721b9d0b20da3d5b80ffe00bf4c5bb3aae812a38d3d1e3bc81fceb8";
  const WORKER_HASH_SELECTOR = "0x3898587d"; // workerHash()
  // in connect():
  preExisting: { rpcProvider: { request: async (args) => {
    const result = await bootstrap.request(args as never);
    const data = (args as { params?: [{ data?: string }] }).params?.[0]?.data;
    if (data === WORKER_HASH_SELECTOR && String(result).toLowerCase() !== NYM_WORKER_HASH)
      throw new Error("The Nym worker bundle changed. Review it and update NYM_WORKER_HASH.");
    return result;
  } } },
  ```
  - Mark the ceiling with a `ponytail:` comment: a Nym upgrade stops private reads until someone updates the pin. The upgrade path is a second, independent bootstrap RPC that must agree with the first.
  - Correct the comment at `:8-9`.
  - The error surfaces through `worker.ready`, so it depends on the tester's OPEN 1 fix (`await worker.ready` in `connect()`) to show up on the card and to retry.
  - Leave one check behind: a unit test where a wrong `workerHash` answer throws.

### S2 [LOW] devDependencies use caret ranges, and build-time code runs where server secrets will live
- **File:** `apps/web/package.json:19-28` (`^4`, `^20`, `^19`, `^9`, `^5`). Owner: **claude-frontend**.
- The Tailwind Turbopack loader, ESLint and TypeScript run at build time: today on the laptop, later on Vercel, where the server env vars will be present.
- The lockfile does the real pinning, and it looks clean:
  - all 456 entries resolve from `registry.npmjs.org` with sha512 integrity (the 6 without one are bundled deps inside `@tailwindcss/oxide-wasm32-wasi`);
  - no package sets `hasInstallScript`;
  - `npm audit --omit=dev` reports 0 vulnerabilities.
- **Fix:** pin the devDependencies exactly, as the runtime ones already are, and install with `npm ci` in CI and on Vercel (Install Command), so a lockfile drift fails instead of resolving fresh.

### S3 [LOW, forward; not blocking because the spec defers CSP] No security headers
- **File:** `apps/web/next.config.ts:3-15`. Owner: **claude-frontend**, in the CSP batch.
- There is no `headers()`, so the app sends no CSP, no `frame-ancestors` and no `Referrer-Policy`, and `X-Powered-By: Next.js` stays on.
- This must land before any screen where the guest key signs money. A framing site could trick a click on a sign button, and any injected script reads the key.
- When writing it:
  - The Nym iframe is `srcdoc`, so it and its blob worker inherit the page CSP. `connect-src` therefore has to allow the Nym directory and the dynamic `wss://…:9001` gateways the tester saw, and `worker-src` needs `blob:`. Test the read with the CSP on.
  - Add `poweredByHeader: false`.

### S4 [INFO] Runtime code in our origin, which can read the guest key
- This is everything except the Nym bundle:
  - next, react and react-dom;
  - viem, with ox, `@noble/*`, `@scure/*` and abitype;
  - `@anon-rpc/browser-harness` and `harness-core`;
  - `@kpstreams/webrtc-client` and `core` 0.2.1 (privacy-ethereum/kps, 8 KB + 62 KB; I found no storage, cookie or `fetch` calls).
- Every new client dependency is one more way to read the key. Keep this list short, and put each addition through PIPELINE §11.

### S5 [INFO] An out-of-range saved key prints its value on the page
- **Files:** `apps/web/lib/guest-wallet.ts:15-16` and `apps/web/app/page.tsx:13-15`, `:71`.
- A saved `0x…` value that has 64 hex digits but is 0 or ≥ n passes the shape check. noble then throws `expected valid private key: 1 <= n < N, got <value>`, and the page shows that text.
- Such a value can't be a usable key, so nothing secret leaks today.
- Once keys hold funds, map guest-wallet errors to fixed copy instead of `error.message`. Owner: claude-frontend.

### S6 [INFO, forward] viem's default chain RPCs ship in the client bundle
- `.next/static` contains `rpc.testnet.whitechain.io` (the `whitechainSepolia` default) and viem's mainnet default RPC.
- Any future `http()` call without a URL, or a wallet client on these chains, would read directly and bypass Nym (FR-PRIV-1).
- Rule for later batches: browser chain clients come only from `getChainClient()`. Owner: claude-frontend.

### S7 [INFO, unverified] Does the Nym exit see the JSON-RPC body?
- I couldn't tell from the harness whether TLS to `rpc.ankr.com` ends inside the worker or at the Nym exit; the worker bundle isn't in `node_modules`.
- Today the body is `eth_blockNumber`, with no user data.
- Before Phase 2 reads addresses, check the `nym-anon-rpc-worker` source and state the answer in the FR-PRIV-4 disclosure. Owners: claude-frontend (check), claude-research (disclosure).

## DONE (verified)

- **The proof signature can't move funds.** Code: `lib/guest-wallet.ts:40-53` (value 0, `from == to ==` signer, `validBefore` 0, nonce 0). On-chain `eth_call` to USDT `0xcedf…55a7` on 1874, `receiveWithAuthorization(from=to=X, 0, 0, 0, 0x0…, sig)` sent from X:
  - with `validBefore` 0, it reverts `TetherToken: auth expired`, and expiry is checked before the signature;
  - with `validBefore` 2^255, it gets as far as `ECRecover: invalid signature`, so the window check really runs.
- **The signature can't be reused anywhere else:**
  - Payee == caller is enforced on 1874 (`TetherToken: to != msg.sender`, research_notes build_H1 line 35). So only the guest EOA could ever submit it, and it would move 0 to itself.
  - The typehash differs from `TransferWithAuthorization`, `CancelAuthorization` and `Permit`, so the signature isn't valid for those calls.
  - The signature stays in memory: it is never sent and never logged.
  - The domain's `chainId` is the constant 1874, not the RPC's answer, so a lying worker can't point signatures at another chain.
  - The tester's invariant test (value 0, from == to, validBefore 0) guards against anyone loosening the message. Keep it.
- **The key is created safely.** `generatePrivateKey` uses noble's `randomPrivateKey`, which uses `crypto.getRandomValues`. An existing saved value is never overwritten. `lib/guest-wallet.ts` does no network I/O.
- **The Nym bundle is isolated.** It runs in a null-origin sandboxed iframe (`host.js:599`, `sandbox="allow-scripts"`, no `allow-same-origin`). The host accepts messages only from that iframe's `contentWindow` (`host.js:606`).
- **What leaves the browser in plain** (the tester gave the hosts; this is what each request carries):
  - **2 × POST `ethereum-rpc.publicnode.com`:** the body is only `eth_call` to the specifier with `0x3898587d` / `0x1c67ff29`. The request reveals IP, user agent and our `Origin`, and no user data.
  - **The bundle GET:** made from the page context (`specifier.js:65-67`, host side), so it carries IP and `Origin`. Not observed but possible: the 3rd fallback, `raw.githubusercontent.com`, belongs in the FR-PRIV-4 list next to unpkg.
  - **Never in any request:** the guest address, key or signature.
  - **Fonts:** self-hosted at build time (no `fonts.googleapis` or `fonts.gstatic` in `.next`).
  - **Trackers:** none in the client bundle. Its only external URLs are docs links inside error strings and the three RPC URLs.
- **Secrets:**
  - No `process.env` and no `NEXT_PUBLIC` in `app/` or `lib/`.
  - `.env` is git-ignored at the root (`.gitignore:29`) and in apps/web (`apps/web/.gitignore:34`).
  - `round-1/walk.mjs` redacts the key from console lines and only compares it in code.
- **Mandated grep:** `grep -rnE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over the diff files gives one hit, `apps/web/test/guest-wallet.test.mjs:9` = `0xcdcfac…3d2a25`, the USDT `DOMAIN_SEPARATOR()` (also in `round-1/test.md:17`). It is a public on-chain value, not a secret. No `PRIVATE_KEY` or `SECRET` hits. The test key (`test/guest-wallet.test.mjs:12`) is derived from a public phrase, so anyone can derive it. Never fund it.

## NEEDS THE USER

- **PIPELINE §11 (keys and new dependencies):**
  - The guest key lives in localStorage in plain hex.
  - S1 decides who can change the code that sees every private read. Today that is the Nym specifier owner `0xD8d4…4518` and our single bootstrap RPC. The fix pins it to the bundle we ran.
  - New runtime dependencies are listed in S4.
- **`ARKIV_ACCESS_KEY` was pasted in chat at 20:47.** Supermemory captures chat text. The SDK calls it a public, origin-restricted key. Confirm on hub.arkiv.network that it is restricted to localhost and our Vercel domain; rotate it if it isn't.
