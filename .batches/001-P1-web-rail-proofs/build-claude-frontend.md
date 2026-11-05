STATUS: READY

# Build report: 001-P1-web-rail-proofs (claude-frontend), round 3

## DONE in round 3 (round 2 tester: CHANGES; reviewers not run in round 2)
- [tester R2-1, MEDIUM] Focus: the retry button uses `aria-disabled` + ignores clicks while running (`page.tsx`), so Chromium no longer drops focus to the body; styles moved to `aria-disabled:`.
- [tester R2-2, MEDIUM] Boot deadline: `connect()` races `worker.ready` against `BOOT_DEADLINE_MS = 90_000`; on expiry the worker is `close()`d and the boot is forgotten, so "Read block again" starts fresh. New test (`node:test` mock timers): a never-ready boot rejects at the deadline and closes worker 1.
- [tester R2-4/5, LOW] spec wording: 2 WSS per boot; shots path per round.
- [tester R3 from round 1] done by the tester: the digest check against the on-chain type hash and domain separator.
- Verified: `npx tsc --noEmit` exit 0 · `npm run lint` exit 0 · `npm test` 11 pass / 0 fail · `npm run build` exit 0 · served again on :3100.
- OPEN, not fixed: 2 of 16 cold reads failed about 45–50 s after "nym tunnel ready" (cause unknown, Nym side). The deadline + retry now always lets the user recover; pre-warming the worker in Phase 2 is the demo mitigation (NEEDS THE USER).

# Round 2 report (kept)

Round 1 verdicts were CHANGES from the tester, reviewer-code, reviewer-security and reviewer-ux-ui; ci was not run. Every CHANGES finding is handled below, with the finding id in brackets. The round 1 report is summarised at the end.

## DONE in round 2
- **Retry recovers from a failed Nym boot** [tester 1, code R1a/b/c]: `lib/anon.ts`.
  - `connect()` now does `await worker.ready.catch((e) => { worker.close(); throw e; })`. A failed boot rejects, closes its iframe and worker, and is forgotten, so the next call boots a fresh worker.
  - A `shortcut:` comment covers a worker dying after `ready` (no public signal in harness 0.4.0).
  - Verified by `test/anon.test.mjs`: the first boot fails and closes worker 1, the next call boots worker 2, and the client is reused.
- **Worker hash pinned** [security S1]: `NYM_WORKER_HASH = 0xf13a448a…1fceb8`, and `pinWorkerHash()` wraps the bootstrap provider so the `workerHash()` answer (selector `0x3898587d`, checked with viem's `toFunctionSelector`) must match. On-chain value re-read at 21:15 via publicnode: same hash. Tests cover accept (any hex case), refuse a different hash, and pass-through for other calls.
- **Timeout is real** [code R2]: `retryCount: 1`, so the worst case is about 2 × 60 s, matching the "one to two minutes" copy. `cacheTime: 0`, so "Read block again" re-reads instead of returning viem's cached block [tester low].
- **Failed state** [tester 2, ux MEDIUM]: shows one plain line (viem `shortMessage`, first line only), never the URL or request body. The paragraph has `break-words`, so no 375 overflow.
- **Focus and progress** [ux MEDIUM]:
  - the retry button stays mounted and is `disabled` while running, so focus is kept
  - a live seconds counter (`aria-hidden`, so screen readers aren't spammed), with "still working" after 60 s
  - specific labels "Read block again" / "Sign again"
  - focus ring `outline-blue-600`
  - `tabular-nums` on the block number and times
  - the DEP-3 card shows "Signing…", not the Nym text
  - times under 1 s are hidden
- **Guest wallet** [code R7, security S5]: `zeroHash` and `whitechainSepolia.id` instead of literals. An out-of-range stored key now throws our own "unreadable" message, because the library's message would echo the stored value.
- **Dependencies** [security S2, code R4/R5]:
  - every devDependency is now exact
  - tailwindcss and @tailwindcss/turbopack moved from 4.3.4 (1–3 days old) to **4.3.3**
  - `@arkiv-network/sdk` was removed until batch 002 uses it (tester low)
  - `"test": "node --experimental-test-module-mocks --test test/"` and `engines.node >=22.18` were added
- **Boilerplate** [code R8]: `apps/web/README.md` deleted.
- **Docs in my lane** [code R5, tester 3]:
  - spec criteria now list all plain traffic: bootstrap calls, bundle and fallbacks, Nym directory GETs to validator.nymtech.net, one Nym gateway WSS
  - `test/` and `docs/FRONTEND-PLAN.md` added to the spec's file list
  - FRONTEND-PLAN pins corrected (react 19.3.0 is the template's pin, released Sep 9; tailwind 4.3.3); status says round 2, not done

## Verified (apps/web, round 2)
- `npx tsc --noEmit` → exit 0 (after deleting a stale `tsconfig.tsbuildinfo`)
- `npm run lint` → exit 0
- `npm test` → 9 pass, 0 fail (5 tester guest-wallet tests + 4 new anon tests)
- `npm run build` → exit 0
- Served again at http://localhost:3100 (`next start`) for the round 2 tester. **Not re-walked in a browser by the builder this round.**

## OPEN
- [code R3, tester-owned] Add a type-hash digest check to `test/guest-wallet.test.mjs` against the on-chain `RECEIVE_WITH_AUTHORIZATION_TYPEHASH` `0xd099cc98…3de8`.
- [security S3] CSP, frame-ancestors and Referrer-Policy before any screen where the guest key signs money (Phase 2). The Nym iframe inherits the CSP, so it must allow the Nym directory and gateway hosts, plus `blob:` workers.
- [security S7] Check whether the Nym exit sees the JSON-RPC body before Phase 2 reads addresses.
- One of the tester's 6 cold reads timed out at 120 s. Nym reliability is a demo risk; pre-warm the worker on app load in Phase 2.
- Sent to claude-research: FR-PRIV-4 exclusions (Nym directory, gateway WSS, bundle fallbacks) and ARCHITECTURE §4 line 112, which says `custom` while the code uses `http(…, { fetchFn })` [code R6].

## NEEDS THE USER
- **New dependencies** (PIPELINE §11): viem 2.57.13, @anon-rpc/browser-harness 0.4.0 (prototype-grade, per its README), Next 16.4.3, Tailwind 4.3.3.
- **Who controls the Nym bundle:** the specifier owner can call `setWorker`. We pinned the hash, so a swap now fails closed (no private reads) instead of running new code.
- **FR-PRIV-4:** approve listing the extra plain Nym connections as disclosed exclusions (an SRS change).
- **Guest key in localStorage:** any XSS on our origin can read it. Accepted for the demo and stated in the README limitations.
- **Public copy:** the site meta description "Get paid in USDT and raise cash from your future sales." (`app/layout.tsx`).
- **ARKIV_ACCESS_KEY** was pasted in chat; restrict it to our origins on hub.arkiv.network or rotate it.

## Round 1 (summary)
Scaffold with create-next-app 16.4.3, Nym read through `http(ANKR, { fetchFn: worker.fetch })`, and the guest-wallet typed-data proof. tsc, lint and build exit 0. In Chrome: block 12,295,764 via Nym in 25.2 s, then 73.9 s after a reload; zero direct requests to rpc.ankr.com.
