VERDICT: PASS

# Security review: 006-P2-neon-limits (LEAN), round 1 (reviewer-security, fast mode §3a)

Code: `git diff e88665e~1 84dd5af -- apps/relayer` (`api/relay.ts`, `dev.ts`, `src/relayer.ts`, `test/dev.test.ts`, `test/relayer.test.ts`). Line numbers are for `84dd5af`.
Safety: no transaction, no request to :8787 or :8788. Chain access was read-only (`eth_getBalance` / `eth_getTransactionCount` on the hot wallet `0xdd02…a651`: **0.498377508835749934 WBT, nonce 3**, unchanged since batch 007). No `.env` value printed: I compared the secrets as sha256 hashes and printed only their length and character class.

No HIGH or CRITICAL in this diff. The deploy batch has one item that is **CRITICAL if skipped** (D1 below).

## DONE (checked)

- **Auth can't be bypassed.** `api/relay.ts:7-11,14` runs before the media-type check and before `request.text()`. An unset or empty `RELAY_API_SECRET` returns `false`, so every request gets 401 (fail closed). A missing header becomes `''`, which never matches. `/relay` is the only path into `relay()`: `src/` isn't a function and there's no `vercel.json` rewrite.
- **Timing.** Both sides are hashed with sha256, so `timingSafeEqual` always compares 32 bytes and never throws on a length mismatch. Hashing time depends only on the length of the attacker's own header. The secret is 64 hex = 256 bits, in both `.env` files, and the two copies are equal (hash compare).
- **Header handling.** Fetch `Headers.get` is case-insensitive and trims the value. Duplicate headers join with `", "`, so they get 401. `dev.ts:29` forwards only this header and stays on 127.0.0.1 with the Host allowlist. The 401 body is a fixed string and doesn't echo the header.
- **Failure modes.** A missing or malformed `RELAYER_PRIVATE_KEY` throws only after auth (`relayer.ts:80,85`, fixed strings, test `dev.test.ts:38`). An unauthenticated caller can't learn the config. The web maps 401 to "Nothing was charged" (`apps/web/lib/relay.ts:78` on main), which is a safe failure.
- **No secret leakage.** The diff adds one log line (`relayer.ts:155`: txHash and payer address, both public). The secret isn't in any response, error or `/health`. `round-1/test-secret.txt` differs from the real secret (hash compare). It's untracked and not git-ignored, so committing it is harmless as long as it's never used as a deployed secret.
- **Budget, breaker and limits are in the right places.** `ledgerChecks` runs last in `localChecks` (`:281`, no RPC) and again inside the lock after the nonce read, right before signing (`:326-327`). `spentWei` only changes inside the lock (`recordSend` from `send()`), so queued requests can't overshoot it in one process. Unknown outcomes are booked at the 0.0024 cap (`:336,349`). The L1 fee is included (`:340-341`). Rollover resets only the spend (`:127`).
- **Required grep** (5 diff files, the batch `.md`s, `notes/phase-2-relayer.md`; 64-hex masked). The hits are env-var names, the test literal `'test-relay-secret-not-a-real-one'` (`dev.test.ts:9`) and two public constants: the USDT DOMAIN_SEPARATOR (`relayer.test.ts:205`) and secp256k1 n (`:547`). No key and no real secret.

## Drain and abuse paths that remain (multi-instance Vercel, secret required)

The web server is now the only caller, but it relays for anyone who opens a checkout (`apps/web/app/api/v1/sessions/[id]/pay/route.ts`). It rebuilds the payment from its own session and checks the signature first, so bad signatures never reach us. Each path below is bounded **per instance**. The only global cap is the hot wallet's 0.498 WBT.

1. **Same signature on two instances, MEDIUM.** This is batch 002 P2, the case the spec's "nonce too low" reasoning misses. Instance B reads nonce n+1 while A's tx is pending and simulates on `latest`, so the simulation passes and B's tx is mined and reverts. Cost: about 30–80k gas, ≤ 0.0024 WBT. Each relayer instance bans the payer after 1 revert and opens its breaker after 3 per hour. The web's `claimPayment` dedupes within one web instance only.
2. **State change after the in-lock simulation, LOW now.** This is P1: the payer empties or delegates their EOA (EIP-7702) before inclusion, and `getCode` is still not in the in-lock round. Each payer can cause 1 revert per instance, and the gas cap holds each one to ≤ 0.0024 WBT.
3. **The breaker as a DoS lever, MEDIUM, availability only.** 3 reverts (3 funded throwaway payers, or path 1) turn one instance into 503 `breaker_open` for an hour or until it recycles. Honest buyers see "busy".
4. **The budget, bans and rate limits aren't global.** Each instance (and every cold start) gets a fresh 0.1 WBT, ban list and counters. Honest sales are about fee-neutral (the 0.10 USDT fee goes to the hot wallet, batch 007 F2), so only reverts cost us net, and paths 1–3 bound those. Accepted by the human at 05:51 for the demo.

## NEEDS THE USER: what the deploy batch must do

- **D1, CRITICAL if missed: keep `.env` out of the upload.** I checked the installed Vercel CLI 64.3.1 (`/opt/homebrew/lib/node_modules/vercel/dist/chunks/chunk-GWZ4VPU3.js`, `getVercelIgnore2`). Its default ignore list has `.env.local` and `.env.*.local` but **not `.env`**. It reads `.vercelignore`/`.nowignore` and **not `.gitignore`**. So `vercel deploy` from `apps/relayer` would upload `apps/relayer/.env` (the relayer key and the secret). From the repo root it would upload the root `.env`, which holds about 10 private keys plus `DATABASE_URL`. With no framework, the "Other" preset serves `public/` if it exists and otherwise the project root as static files, so `/.env` and `/src/relayer.ts` may become downloadable (verify; don't assume they're safe). Fix: add `apps/relayer/.vercelignore` (`.env`, `.env*`, `test/`, `*.md`) plus an empty `public/` or an explicit `outputDirectory` before any CLI deploy, or deploy only through the Git integration. After deploying, `curl -sI <url>/.env`, `<url>/src/relayer.ts` and `<url>/package.json` should all return 404. Owner: claude-relayer (deploy batch).
- **D2: production-only env.** Set `RELAYER_PRIVATE_KEY`, `RELAY_API_SECRET` and `RPC_URL` (if set) for **Production only**, marked Sensitive. Nothing goes in Preview or Development. Every preview then fails closed (401, and the key is missing). With a key in Preview, every branch would be another relayer with its own 0.1 WBT ledger. Keep Deployment Protection on for previews. Don't `vercel env pull` the production values to disk.
- **D3: the web must send the header** (cross-lane; claude-code's review flagged it too). `apps/web/lib/relay.ts:54-58` (main) sends no `x-relay-secret`, so every payment gets 401 until the web reads `RELAY_API_SECRET` from its server env. Don't use `NEXT_PUBLIC_`, and never log request headers. Keep the web's value Production-only too. Owner: web lane.
- **D4: keep the hot wallet small.** The per-instance budget isn't global, so the wallet balance is the real cap. 0.5 WBT is fine for the demo. Don't top it up past what you're willing to lose.
- **D5:** rewrites `/relay` → `/api/relay` and `/health` → `/api/health` (`dev.ts:2`), and a `maxDuration` above the web's 35 s wait, so a function killed after broadcast doesn't drop the txHash (P2 note).

## FOLLOW-UP (MEDIUM/LOW, owner claude-relayer unless noted)

- **MEDIUM:** paths 1 and 3 above. Real fix: the Postgres lock + `rel_sent` after G2 (already marked `ponytail:` at `relayer.ts:120,168`). Cheap stopgap: the web dedupes by `(from, nonce)` in its DB before forwarding (web lane).
- **LOW, `api/relay.ts:9`:** nothing enforces the secret's strength. Refuse (401) when `RELAY_API_SECRET.length < 32`, so a short value pasted into Vercel can't weaken auth.
- **LOW, P1(b) still open:** add `getCode` to the in-lock `Promise.all` (`relayer.ts:316-319`).
- **LOW, carried:** P5 (no queue cap; now reachable only through the web), P9 (`content-length` before `request.text()`; auth now runs first, so outsiders don't get parsed), P10 (20% gas headroom). `/health` exposes spend and budget unauthenticated (low sensitivity).
