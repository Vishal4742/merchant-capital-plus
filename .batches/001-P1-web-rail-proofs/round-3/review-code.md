VERDICT: PASS

# Code review: 001-P1-web-rail-proofs, round 3 (reviewer-code)

Scope: everything under `apps/web/` except node_modules, .next and the git-ignored `tsconfig.tsbuildinfo` / `next-env.d.ts` (the whole folder is untracked), plus the tracked edit to `docs/FRONTEND-PLAN.md`. I read every source, config and test file in full. I also re-read the harness host and specifier source and viem's http timeout path wherever a fix depends on them. The tester's round 3 OPEN items 1–5 stand and are not repeated here. No `.env` value was read or printed.

## Round 1 findings: all resolved
| ID | Round 1 finding | Now | Evidence |
|---|---|---|---|
| R1a | Close the worker on a failed boot | Fixed | `lib/anon.ts:53-57`: the `catch` calls `worker.close()` and rethrows, and the same path now covers the 90 s deadline. Harness `close()` (host.js:737-741) removes the iframe and the message listener, then `#fail`s. |
| R1b | Mark the dead-after-ready ceiling | Fixed (see L1 for the marker word) | `lib/anon.ts:73-74` names the ceiling and the upgrade trigger. |
| R1c | One check for retry-after-failure | Fixed | `test/anon.test.mjs:38-47`, plus the deadline test at `:25-36`. Mutation checks below. |
| R2 | Effective timeout of about 4 min | Fixed | `lib/anon.ts:65` sets `retryCount: 1`. I checked that the 60 s timeout really fires through `fetchFn`: viem's `withTimeout(…, { signal: true })` only aborts, so it depends on the fetch honouring `init.signal`. Harness `#fetch` (host.js:693-716) does honour it: it listens for `abort`, removes the call and rejects with an AbortError, which viem turns into `TimeoutError`. |
| R3 | DEP-3 test misses the struct type | Fixed | `test/guest-wallet.test.mjs:86-104` rebuilds the digest from the on-chain type hash and domain separator. |
| R4 | Node version for the tests | Fixed | `package.json:29-31` `engines.node >=22.18`. |
| R5 | FRONTEND-PLAN outside the spec; stale pins | Fixed except (b) | (a) the file is in the spec's file list. (c) every dependency is exact in `package.json` and in the lockfile root; the plan's table matches it (react 19.3.0, tailwind + `@tailwindcss/turbopack` 4.3.3); `@arkiv-network/sdk` and Privy are absent from the lockfile. (b) the status line is still stale: L2. |
| R6 | ARCHITECTURE §4 transport row | Fixed (by claude-research) | `ARCHITECTURE.md:112` now reads `http(ANKR, { fetchFn: worker.fetch, timeout: 60_000, retryCount: 1 })`, with the pinned hash. |
| R7 | Reuse `zeroHash` and `whitechainSepolia.id` | Fixed | `lib/guest-wallet.ts:2,46,55`. |
| R8 | Boilerplate README | Fixed | `apps/web/README.md` is deleted. `apps/web/AGENTS.md` stays, because `next dev` rewrites it (its own comment says so). |

## Checks on the code as it stands
1. **Traceability.** `lib/anon.ts` maps to DEP-6/FR-PRIV-1, `lib/guest-wallet.ts` to DEP-3, `app/page.tsx` to the proof-page criteria, the scaffold to NFR-11, and the tests to the `npm test` criterion. No Tor, CSP, meter, Arkiv or design code is in `apps/web`, as the spec requires. The `next.config.ts` and `globals.css` defaults are unedited template, as checked in round 1. Product code has no scope creep. For the docs diff see L3.
2. **ABI / constants.** No ARCHITECTURE §2 function is called in this batch. The constants match §7: Ankr URL (`anon.ts:7` = ARCH:129), USDT and its EIP-712 name/version (`guest-wallet.ts:8,46` = ARCH:131), the Nym specifier (`anon.ts:9` = ARCH:136), and the worker hash (`anon.ts:13` = ARCH:112).
3. **Logic (new code since round 1), checked with no finding:**
   - **Deadline race** (`anon.ts:49-60`): the timer is cleared in `finally` on every path. If `ready` loses the race and rejects later, the harness's own `ready.catch` (host.js:568) absorbs it. If the deadline loses, its promise never settles, so it leaves no unhandled rejection.
   - **Hash pin** (`anon.ts:26-38`): it fails closed. Harness `readSpecifier` (harness-core specifier.js:14-29) sends `{ to, data: selector }` and decodes the first 32 bytes of the same string we compare. Because we require the whole string to equal the pinned hash, a longer or altered return can't pass our check and then decode to something else. Upper-case hex passes on both sides.
   - **Retry button** (`page.tsx:99-107`): while running, `onClick` is unset, so no second run can overlap. The `aria-disabled:` variant matches only `"true"`. `Elapsed` remounts on each run, so its count restarts from 0.
   - **Error line** (`page.tsx:16-20`): it uses viem's `shortMessage` or the first line of our own message, so no URL or request body appears.
   - **Guest key** (`guest-wallet.ts:12-26`): it is never overwritten. An out-of-range key throws our own message. A blocked `localStorage` surfaces as one failed line and never echoes the key.
4. **Ponytail.** Nothing to delete. viem does the transport, timeout, retry and signing, and the harness does the bundle check. The new code adds only the deadline race and the pin wrapper, each about 10 lines, and each has a test.
5. **Tests assert the criteria.** I ran three mutations on scratch copies (`scratchpad/rc3/`), and each one is caught:
   - swap `validAfter`/`validBefore` in `receiveTypes` → `✖ the signed digest is the one the deployed USDT contract computes…` (pass 10, fail 1)
   - drop `worker.close()` → both boot tests fail (pass 9, fail 2)
   - drop `client = undefined` → `✖ a failed boot closes its worker, and the next call boots a fresh one` (pass 10, fail 1)

   The tester's own mutation check covers the deadline race.

## Verified here (apps/web, Node v26.10.0)
- `npx tsc --noEmit` → exit 0
- `npm run lint` → exit 0
- `npm test` → `ℹ tests 11 ℹ pass 11 ℹ fail 0`

I did not run `npm run build`, so the tester's live :3100 `.next` stays untouched. The tester built a clone (exit 0), and ci runs the build too.

## OPEN (all LOW, non-blocking)
**L1 [LOW] The shortcut markers use the wrong word.** `apps/web/lib/anon.ts:73` and `apps/web/lib/guest-wallet.ts:10` say `shortcut:`. PIPELINE §3.3 says to mark deliberate shortcuts with `ponytail:`, and that is the word phase-close (`/ponytail-audit`) and a grep look for. Fix: rename the word in both comments. Owner: claude-frontend.

**L2 [LOW] The FRONTEND-PLAN status line is stale (R5b leftover).** `docs/FRONTEND-PLAN.md:25` says "Built in batch 001 (open: round 2)". Round 3 is under way. Fix: write the final status when the batch closes. Owner: claude-frontend.

**L3 [LOW] The FRONTEND-PLAN diff carries work that isn't this batch's.**
- What: the design section (`docs/FRONTEND-PLAN.md:58-71`, human decisions 21:30–21:37) and the three.js pin row (`:15`, human 21:43). Neither is batch 001 work, and the spec allows this file for "pins and status".
- Fix: commit them as their own `docs:` commit, so the batch commit holds only batch 001 (PIPELINE §3.7).
- Related, worth a decision before the next batch starts: HANDOFF_LOG (21:50) says three.js "ports to apps/web in batch 002", while `batch.md` and the plan's Arkiv row give 002 to the Arkiv probe (DEP-5). three.js is also a new dependency (PIPELINE §11).
- Owner: claude-frontend.

**L4 [LOW] The worst-case cold read is longer than the copy says.**
- What: the comment at `apps/web/lib/anon.ts:18` ("with one retry the worst case is about two minutes") covers the read alone. A cold first read can take the 90 s boot plus 2 × 60 s of read, about 3.5 minutes. The page says "one to two minutes" (`app/page.tsx:123`).
- Fix: say "per read, after the boot" in the comment. Settle the copy together with the human's deadline decision (tester OPEN 1).
- Owner: claude-frontend.

## NEEDS THE USER (carried, nothing new from code review)
- Public copy: the `app/layout.tsx:17` meta description. I see no approval recorded in HANDOFF_LOG.
- The new dependencies, the boot deadline value, the DEP-6 demo pre-warm and the localStorage key, as listed in the tester's round 3 report.
