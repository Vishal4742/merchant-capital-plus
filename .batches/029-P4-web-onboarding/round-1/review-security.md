VERDICT: PASS

# Security review: 029-P4-web-onboarding, round 1

Reviewer: reviewer-security (Opus). Mode: phase, so only HIGH or CRITICAL findings block (PIPELINE.md §3a/§3b).
Scope: `git diff HEAD~3 HEAD -- apps/web` (206100c, 82ccb79, 6837bd6), 7 files, +545/-97:
lib/onboarding.ts (new), components/merchant/SignIn.tsx, components/gateway/Frame.tsx,
components/dashboard/GetStarted.tsx (new), app/merchant/page.tsx, test/onboarding.test.mjs (new), test/test-mode.test.mjs.
Contracts, relayer, payment and signing code paths: not in the diff.

## Checks

| Check | Result | Evidence |
|---|---|---|
| SIWE message unchanged (domain, nonce, expiry, chain 1874, statement, uri, version) | PASS | The `createSiweMessage({...})` block extracted from HEAD~3 and HEAD diffs to nothing (byte-identical). `SIGN_IN_WINDOW_MS` moved from SignIn.tsx:12 (HEAD~3) to lib/onboarding.ts:16 with the same value, `5 * 60_000`. Server checks are unchanged and not in the diff: lib/auth.ts:91 (chain 1874), :93 (expiry ≤ `MAX_MESSAGE_TTL_S`, 10 min), :95 (domain allowlist), :96 (nonce). |
| wallet_addEthereumChain / switch can't be steered to another chain or RPC | PASS | SignIn.tsx:106-107 pass only the module constant `WHITECHAIN_TESTNET` (lib/onboarding.ts:7-13) and its `chainId`; no user, URL, query or server input reaches the params. test/onboarding.test.mjs pins the whole object with deepEqual: chainId equals `toHex(whitechainSepolia.id)` (0x752), and rpcUrls[0] and the explorer equal viem's. test-mode.test.mjs allows only the `WHITECHAIN_TESTNET.chainId` name. |
| "Install MetaMask" link | PASS | SignIn.tsx:165: a fixed `https://metamask.io/download/` with `target="_blank" rel="noreferrer"` (noreferrer implies noopener). |
| Checklist reads scoped to the signed-in merchant | PASS | page.tsx:155-162: `merchant` comes from `currentMerchant()` (the session cookie, page.tsx:169). `listLinks` (lib/server/links.ts:217-218) and `listKeys` (lib/server/keys.ts:40-43) run SQL `WHERE merchant = $1`. Only `.length` and one slug leave `setupFacts`. Keys never reach the render: no prefix, label or id. GetStarted is a server component and its props hold only static copy and hrefs. `payments` is the existing `confirmed(..., merchant)` set. The invoice gate is unchanged (`pay && isShopWallet`). |
| No new XSS | PASS | No `dangerouslySetInnerHTML`, `innerHTML`, `eval` or `javascript:` in any of the 7 files (grep). Every href in GetStarted (GetStarted.tsx:37) is a fixed path, or `/l/${slug}` where the slug is server-generated 10-char base62 (lib/server/http.ts:124, `newSlug()`). All text renders through React escaping. |
| Error copy doesn't echo raw wallet/server text | PASS (one LOW below) | `walletProblem` (lib/onboarding.ts:81-87) returns only fixed sentences keyed on the EIP-1193 code. It never echoes `e.message`, which HEAD~3 did. Network and parse failures map to fixed `OFFLINE`/`NO_ACCOUNT` copy. `signInProblem` echoes the server's `error` only on a 401, and all of those come from our own verify route as fixed literals (app/api/auth/verify/route.ts:14, :25, :26). |
| Server logs | PASS | The new `logFailure("get started: …")` calls (page.tsx:156-158) log only `error.name` (lib/gateway-server.ts:49), never the message or a DB string. |
| New surface on signed-out pages | PASS | The "Just looking? Try a checkout" form POSTs to the existing /api/demo-checkout. That route was already reachable without a session, is rate-limited per IP (10/min) and only ever creates a checkout for the demo shop. No new endpoint. |
| Third-party trackers / external resources | PASS | No new script, font, image or fetch origin. The only new external URL is the MetaMask anchor (navigation only). |
| Secret scan (required) | PASS, no hits | `grep -nHE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` over each of the 7 files: no output. Same pattern over the added lines of the diff: no output. |
| Tests | PASS | `node --test test/onboarding.test.mjs test/test-mode.test.mjs`: tests 10, pass 10, fail 0. |

## FOLLOW-UP (non-blocking)

### F1 (LOW): signInProblem passes a 401 body's `error` through verbatim
- File: apps/web/lib/onboarding.ts:91 (`return status === 401 && serverError ? serverError : …`), called from components/merchant/SignIn.tsx:130 and :145.
- Exploit sketch: nothing works today. All three 401 bodies are fixed literals in app/api/auth/verify/route.ts, the call is same-origin and React-escaped, and a proxy's 401 HTML fails `json()` and falls back to generic copy. The risk is latent: a future 401 built from an exception message (`{ error: e.message }`) would show raw server text in the UI, and the test (test/onboarding.test.mjs, last test) asserts the pass-through as intended behaviour.
- Fix: allow only known server strings, e.g. `const KNOWN_401 = new Set(["Sign-in expired. Try again.", "That signature didn't check out. Try again."])`, and echo only members of that set. Or keep the pass-through and add a test that reads verify/route.ts and asserts every 401 `error` is a string literal.
- Owner: claude-frontend.

### F2 (INFO): the wallet is given a second RPC outside viem's chain definition
- File: apps/web/lib/onboarding.ts:11, rpcUrls[1] = `https://rpc.ankr.com/whitechain_testnet`.
- Not steerable, and it is the read/send RPC ARCHITECTURE.md documents (§2 reads line, §RPC table). The spec's acceptance line says the RPC URLs are "pinned to viem's whitechainSepolia"; the test pins rpcUrls[0] to viem and the Ankr entry as a literal. No action needed for security. If the spec is meant literally, note the deviation in the spec or drop the second URL.
- Owner: claude-frontend.

### F3 (INFO): the client and server expiry windows are separate constants
- The client's `SIGN_IN_WINDOW_MS` (5 min, lib/onboarding.ts:16) and the server's `MAX_MESSAGE_TTL_S` (10 min, lib/auth.ts:14) are not linked. This is unchanged by this batch (it was already split before). The server bound is the one that matters and it still holds. No action.

## Verdict

No HIGH or CRITICAL findings. The SIWE flow is byte-identical, the chain-add params are a pinned constant, the checklist reads are merchant-scoped SQL that expose only counts and a server-generated slug, there is no new XSS sink, and wallet error text is no longer echoed (an improvement on HEAD~3). PASS, with F1 for the next frontend batch.
