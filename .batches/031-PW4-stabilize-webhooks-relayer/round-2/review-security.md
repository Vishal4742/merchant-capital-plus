VERDICT: PASS
# Batch 031 · round 2 · reviewer-security (phase mode §3b; only HIGH/CRITICAL block)

Method: one independent reviewer per part over the round-2 changes, every finding sent to a separate refuting skeptic. Reviewers were read-only on the repo (probes and mutation runs in temp dirs outside it).

## Part A round 2 (web) — 1 LOW confirmed, no HIGH/CRITICAL/MEDIUM
Checked and correct: DNS race (late rejection handled, sync throw handled, timer always cleared, 0 unhandled rejections, SSRF blocklists and IP-literal path unchanged, DNS timeout fails closed — no fetch); inline path still sends test sends and direct enqueues (rows start pending/attempts 0/lease NULL); no stuck deliveries (refused claims leave rows pending and due after the lease); worker pool never handles a row twice, never rejects, each attempt ≈ 8 s + DB → ≈ 24 s per worker < 60 s lease; signature timestamps ≤ ~24 s old (SDK tolerance 300 s); L1 fails on round-1 code, M1 would hang, L2 fails without firstAttemptOnly, T1 hits ON CONFLICT. Tests: gw-outbox 12/0, gw-webhooks 21/0, gw-dispatch 6/0, gw-events 10/0, dev-screens 6/0, docs-endpoints 9/0, docs-limits 13/0, gw-tester-webhooks 3/0; tsc 0.

| Sev | Finding | Disposition |
|---|---|---|
| LOW (introduced by the M1 fix) | The 3 s DNS deadline doesn't cancel `getaddrinfo`; with libuv's 4-thread pool saturated by one merchant's hanging DNS, other merchants' healthy lookups can time out in the queue and burn retry attempts (final `failed` after 4; manual replay remains). Reproduced in a temp probe (pool busy → 400 at 3008 ms; raw lookup succeeds at ~4.4 s). | **FOLLOW-UP** (next W4 batch, FR-OPS-6) and raised to the human at the gate as a trade-off vs round 1's duplicate-POST risk. Candidate fixes listed in build-web.md. |
Nits fixed after the review (comments only, no behaviour change; tsc/lint/4 suites re-run green): `dispatchDue` docstring, `attemptInline` docstring, build-web.md open list. Not covered by a test: the 10-concurrency cap itself.

## Part B round 2 (relayer) — no confirmed defects
Checked and correct: settle retry cannot produce a duplicate or conflicting settle (SET-only UPDATE by primary key, one timestamp before try 1; a committed-but-unanswered try followed by a retry writes identical values; budget sums `fee_wei`, breaker/ban count rows; no other writer; success returns immediately; response unchanged; ≤ 3 tries within the 90 s lease); `errorLabel` can only return a 5-char SQLSTATE, an identifier-like class name, or `error` — never message/stack; `migrate.ts` wraps connect, every statement and the listing; harness changes weaken no assertion. Mutation runs (temp copy): no retry → both settle tests fail; settle repeated after success → `settles === 1` fails; migrate printing `e.message` → migrate.test fails. `npm run typecheck` clean; `npm test` 84/83/1 (the known host-timer flake).
Refuted: "settle retry can push worst-case `/relay` past maxDuration" (verifier: not real).

## Carried FOLLOW-UP (from round 1, unchanged)
Dedicated least-privilege Neon role for the relayer; FR-OPS-4 Unknown→reconcile and nonce floor; FR-OPS-6 full outbox; re-measure NFR-4/NFR-14 on the deployed relayer.
