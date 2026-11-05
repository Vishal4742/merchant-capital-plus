VERDICT: PASS

# Security review: 001-P1-web-rail-proofs, round 3 (reviewer-security)

Scope: `apps/web/` without `node_modules` and `.next` (`app/`, `lib/`, `test/`, `package.json`, `package-lock.json`, `next.config.ts`, `.gitignore`, `eslint.config.mjs`, `AGENTS.md`), plus `docs/FRONTEND-PLAN.md`. I re-read the harness code our pin depends on: `@anon-rpc/harness-core` 0.4.0 `dist/specifier.js` and `@anon-rpc/browser-harness` 0.4.0 `dist/host.js`. I made read-only `eth_call`s to the Nym specifier on mainnet and downloaded the jsDelivr worker bundle into its own empty directory. I only hashed it and never ran it. I did not print any `.env` value; the presence check below prints counts only.

Round 1 findings: S1 and S2 are resolved, and S5 is handled. Tester item 2 (the orphan worker) breaks no security property, so it doesn't block (N1). Nothing here has to be fixed before the human gate.

## DONE (verified)

### S1 resolved: the Nym worker hash is pinned
- **Code:**
  - `apps/web/lib/anon.ts:13` sets `NYM_WORKER_HASH = 0xf13a448a…1fceb8`.
  - `:26-38` (`pinWorkerHash`) throws when an `eth_call` whose data starts with `0x3898587d` returns anything else.
  - `:46` wraps the bootstrap provider with it.
  - The pin is in the served chunk `.next/static/chunks/1qi0gsu6e4f0u.js`, which contains the wrapper and the literal hash.
- **It matches what the harness sends:**
  - `harness-core/dist/specifier.js:22-26` sends `{ method: "eth_call", params: [{ to, data }, "latest"] }`, with `data` exactly the selector.
  - `:15` reads the hash before the resolvers, so a refused hash stops the boot before any bundle GET.
  - The comparison is on the whole string, so an answer with trailing bytes is refused too. The harness's `decodeBytes32` would have taken the first 32 bytes.
- **It covers both attackers from round 1:**
  - `specifier.js:81-82` checks the downloaded bytes against the hash that came through our wrapper.
  - So neither a lying bootstrap RPC nor the specifier owner's `setWorker` can get a different bundle to run. Both now fail closed.
- **The pinned value is genuine:**
  - `workerHash()` from `ethereum-rpc.publicnode.com` and from `eth.drpc.org` (an independent provider) both return `0xf13a448a…1fceb8`.
  - keccak256 of the jsDelivr bundle (`@nymproject/anon-rpc-worker@0.1.0`, 18,283,862 bytes, fetched 21:52) equals the pin.
- **Tests:**
  - `npm test`: 11 pass, 0 fail. Three cover the pin: accepted in any case, a different hash refused, other calls passed through.
  - The tester's browser walk badhash-375 forged the hash answer. The page refused it with 0 bundle fetches and 0 iframes, then recovered on retry.
- **Ceiling:** the comment at `:10-12` says it. When Nym ships a new bundle, DEP-6 stops until someone reviews the bundle and updates the pin (NEEDS THE USER).

### S2 resolved: exact pins
- **package.json:** all 13 direct dependencies are exact, and `@arkiv-network/sdk` is gone.
- **Lockfile:**
  - the root entry and the installed versions match package.json for every package (`npm ls --depth=0`, no errors);
  - all 448 lock entries resolve from `registry.npmjs.org` with integrity;
  - 0 have `hasInstallScript`;
  - `npm audit --omit=dev` reports 0 vulnerabilities.
- **Still to do, not in this batch:** use `npm ci` as the install command when CI and the Vercel project are set up.

### S5 handled: a saved value is never echoed
- **Code:** `apps/web/lib/guest-wallet.ts:17-21` catches the `privateKeyToAccount` error and throws the fixed `UNREADABLE` copy.
- **Probe** (scratchpad `sec3/s5.mjs`, public non-keys only): I saved `0x00…00`, n (the secp256k1 order), `0xff…ff` and `0xFF…FF`.
  - Each gave "The saved guest wallet is unreadable."
  - No message contained the saved value.
  - The stored value was left in place.
- **One gap:** no unit test reaches the catch branch, because every value in `test/guest-wallet.test.mjs:56` fails the shape check at `:16` first (N4).

### Tester item 2 assessed: a closed worker keeps booting if the CDN answers late (LOW, N1 below)
The tester's reading of harness 0.4.0 is correct:
- `host.js:589-615`: `#boot()` never checks `#failure` after `await fetchAndVerifyBundle(…)`.
- `close()` (`:737-742`) removes only an iframe and listener that already exist.
- So after our deadline closes worker 1, a late bundle still gets an iframe, a KPS bridge and a Nym tunnel.

What still holds:
- **No unreviewed code runs.** The late bundle passed the same pinned hash check (`specifier.js:81-82`) before the orphan was built.
- **None of our reads go through the orphan.** `#fetch` throws once `#failure` is set (`host.js:694`), and `getChainClient()` has already dropped the client (`lib/anon.ts:75-78`).
- **The orphan can't read the guest key or sign.** Its iframe is still `sandbox="allow-scripts"` with a null origin (`host.js:599`).
- **Its traffic is already disclosed.** It makes Nym directory GETs and gateway WSS, the categories listed under FR-PRIV-4. It carries no user data.

What it costs:
- one more Nym client per late boot (CPU, sockets, and a listener that is never removed);
- a second client with the same IDB namespace (`host.js` storage handlers are keyed by the specifier address), which may explain the tester's OPEN 3 interference;
- someone on the network who can delay CDN answers can create one orphan per user retry. Blocking the CDN would already deny the service, so this adds no new attack.

### Secrets, trackers, data
- **Mandated grep:** `grep -rnE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' '--include=*'` over apps/web (without node_modules and .next), docs/FRONTEND-PLAN.md and this batch folder. In zsh, `--include=*` has to be quoted. Every hit is a public on-chain constant or my own round 1 text:
  - `apps/web/lib/anon.ts:13`: Nym `workerHash` (public, on-chain)
  - `apps/web/test/guest-wallet.test.mjs:9`: USDT `DOMAIN_SEPARATOR()` on 1874 (public)
  - `apps/web/test/guest-wallet.test.mjs:87`: USDT `RECEIVE_WITH_AUTHORIZATION_TYPEHASH()` (public)
  - batch files: `round-1/review-security.md` (the worker hash ×2, and the words `PRIVATE_KEY` and `SECRET` where it quotes the grep), `round-1/test.md` (domain separator), `round-1/review-code.md` and `round-2/test.md` (type hash)
  - no `PRIVATE_KEY` or `SECRET` in any code file
- **`.env` presence check** (scratchpad `sec3/envcheck.mjs`, counts only): 16 values against 344 files (apps/web without node_modules, with `.next`; this batch folder; FRONTEND-PLAN), 0 hits.
- **Ignore rules:** `git check-ignore` confirms `.env` (root `.gitignore:29`), `apps/web/.env*` (`apps/web/.gitignore:34`), `.next` and `tsconfig.tsbuildinfo` are ignored.
- **app/ and lib/:**
  - no `process.env`, `NEXT_PUBLIC`, `console.*`, `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `fetch(`
  - `localStorage` is used only in `guest-wallet.ts:13,24`
  - error text is rendered as React text, so it is escaped
- **No trackers (NFR-8):** no analytics or tracker host in `.next/static`. The other hosts in the bundle are viem/ox library strings: docs links, chain defaults, ENS/IPFS gateways, 4byte. None is called on our paths (S6).
- **The proof signature still can't move funds:** value 0, from == to, validBefore 0, and chainId the constant 1874. The tester's invariant and digest tests guard all of this (round 1 DONE still holds).

## OPEN (none blocking)

### N1 [LOW] The orphan Nym worker after a late CDN answer (tester item 2)
- **Files:**
  - `apps/web/lib/anon.ts:48-57`. The comment at `:48` implies `close()` always removes the boot's iframe, but it can't for a boot still waiting on the bundle.
  - Upstream: `@anon-rpc/browser-harness` 0.4.0 `host.js:589-615` and `:737-742`.
- **Owner:** claude-frontend. Fit it into the Phase 2 pre-warm batch, which revisits the worker lifecycle anyway.
- **Exploit sketch:** a network attacker holds the jsDelivr response past 90 s, and the user presses retry. Each round leaves one orphan Nym client in the tab. The cost is resources only. There is no data exposure and no foreign code.
- **Fix:**
  1. Correct the comment at `:48`.
  2. Report upstream: `#boot()` should stop after each `await` once `#failure` is set.
  3. Optional, about 4 lines: keep the timed-out workers in a module array and call `close()` on each again before the next boot. A second `close()` removes the iframe, listener and KPS bridge once the late boot has created them (`#fail` is one-shot, so the call is safe).
  - Ceiling (`ponytail:`): a bundle that arrives after the retry still leaves an orphan until the next retry or reload.

### N2 [LOW] The pin depends on harness 0.4.0's exact call shape, so a harness change would bypass it silently
- **File:** `apps/web/lib/anon.ts:30-31`. Owner: claude-frontend.
- **Problem:** `isHashRead` matches only `eth_call` with `params[0].data`. Suppose a future harness sends `input` instead of `data`, a JSON-RPC batch, or a multicall. Then the wrapper passes the answer through unchecked, and the round 1 S1 attack works again.
- **Why it doesn't block today:** the harness is pinned exactly, with lockfile integrity, and the badhash walk proves the pin works on 0.4.0.
- **Fix:** make the wrapper an allowlist that fails closed. Refuse any bootstrap request that isn't `eth_call` to `NYM_SPECIFIER` with selector `0x3898587d` or `0x1c67ff29`. Then a changed harness stops booting instead of skipping the check. At least rerun the badhash walk on any harness version bump.

### N3 [INFO] The resolver list still comes from one unpinned RPC answer
- **File:** `harness-core/dist/specifier.js:62-68`, called through `lib/anon.ts:46`.
- **Problem:** a lying bootstrap RPC can't run code, because the hash is pinned. It can still make the page `fetch()` any http(s) or blob URL it names. That request leaves from our origin, with same-origin credentials, and reads up to 64 MB per resolver (`MAX_BUNDLE_BYTES`). It leaks IP, Origin and timing to that host and wastes bandwidth.
- **Fix:** the S3 CSP (`connect-src` limited to the jsDelivr, unpkg and raw.githubusercontent bundle hosts) closes this without code. Also, never add a GET route with side effects on our origin. Owner: claude-frontend, in the CSP batch.

### N4 [LOW] No test covers the S5 catch branch
- **File:** `apps/web/test/guest-wallet.test.mjs:56`.
- **Fix:** add `` `0x${"0".repeat(64)}` `` to the list of bad values. That value passes the shape check and reaches `privateKeyToAccount`. Also assert that the message doesn't contain the value. Owner: tester or claude-frontend.

### Carried forward from round 1 (deferred by the spec, unchanged)
- **S3, CSP and headers:**
  - `apps/web/next.config.ts:3-15` still has no `headers()`: no CSP, no `frame-ancestors`, no `Referrer-Policy`, and `poweredByHeader` is still on.
  - This must land before any Phase 2 screen where the guest key signs money. Include N3's `connect-src` hosts, the Nym directory and gateway `wss:` hosts, and `worker-src blob:`.
- **S4, client dependencies:** no new client dependency since round 1, and the Arkiv SDK was removed. Every future client dependency can read the guest key.
- **S6:** browser chain clients come only from `getChainClient()`. viem's default RPCs (`rpc.testnet.whitechain.io`, the mainnet default) are still in the bundle.
- **S7:** before Phase 2 reads addresses, check whether the Nym exit sees the JSON-RPC body. The bundle can now be checked against the pin, so review that exact file.
- **Tester OPEN 1 (deadline 90 s vs 120 s):** this has no security effect either way.

## NEEDS THE USER (PIPELINE §11)
- **Pin governance:** if Nym upgrades the worker during the event, private reads (DEP-6) stop with "The private-read worker changed on-chain". They come back only after we review the new bundle and update `NYM_WORKER_HASH`. That is the intended fail-closed behaviour. Decide who reviews and how fast.
- **Guest key in localStorage (carried):** any XSS on our origin can read it. CSP (S3) must land before the key signs anything with value.
- **New dependencies (carried):** viem 2.57.13, @anon-rpc/browser-harness 0.4.0 (prototype-grade, with the orphan bug in N1), Next 16.4.3, Tailwind 4.3.3.
- **`ARKIV_ACCESS_KEY` (carried):** it was pasted in chat at 20:47. Restrict it to our origins on hub.arkiv.network, or rotate it.
