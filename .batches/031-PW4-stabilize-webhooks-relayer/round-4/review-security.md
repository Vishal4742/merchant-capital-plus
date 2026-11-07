VERDICT: PASS
# Batch 031 · round 4 (final) · reviewer-security (phase mode §3b, Money: yes; only HIGH/CRITICAL block)

No author is the sole reviewer of their own code:
| Part | Author | Independent reviewer(s) | Result |
|---|---|---|---|
| A rounds 1–2 (outbox atomicity, lease, DNS deadline) | whiteflow-ef | subagent panels (3 lenses + skeptics) ×2; whiteflow-b7 cross-review | PASS (findings fixed; round-1/2 files) |
| A rounds 3–4 (DNS deferral, c-ares + pinned HTTPS, fair dispatch, cooldown/replay messages, tx reference, unknown-payment recovery) | whiteflow-ef | independent reviewer agent (read-only), then a re-review of its fixes | PASS — 0 critical/high; F1/F2/F4 fixed and re-reviewed correct; F3 + stale comments → FOLLOW-UP |
| B rounds 1–3 (relayer lease/fence, write-ahead, idempotent DB retry, cooldown, unblock) | whiteflow-b7 | subagent panels (round 1–2; incl. a 40-session real-PG race); whiteflow-ef (round 3, `round-3/review-security-partB.md`) | PASS |
| B10 relayer real-PG harness | whiteflow-b7 | whiteflow-ef (ran it: 8/8) | PASS |
| C durable web rate limits | whiteflow-fb | whiteflow-ef (`round-4/review-partC.md`) | PASS |
| D webhook real-PG harness | whiteflow-0f | whiteflow-ef (ran it: 6/6) | PASS |
| Lead's round-4 fixes: PGlite teardown (docs-limits hang), gw-refunds shared-limit reset, production-adapter runners `tools/stage2/*` | whiteflow-ef | — test-only/tooling; behaviour verified by runs (docs-limits exit 0; gw-refunds 18/18; runners 8/8 + 8/8) | recorded |

## Round-4 independent review of Part A (summary of the reviewer's report)
Checked sound: tenant scoping (replay owner check; `pendingTxHash` only to the owning shop key); SSRF (v4-mapped and normalised literals blocked; POST pinned to `vetAddresses()[0]`; lookup override handles `all:true` and single lookups with the address's own family; `agent:false`; no redirects; SNI/Host = hostname; `ca` only in tests); timeouts/cleanup (5 s destroy timer; per-attempt c-ares resolver cancelled on abort; worst case ≈ 3 s + 5 s; pool 30 claims × concurrency 10 ≈ 24 s < 60 s lease); SQL under READ COMMITTED (enqueue-once, claims, fair dispatch claim without SKIP LOCKED via the outer re-check, fence uniqueness, deferral never on `succeeded`, 2 h window); customer messages (cooldown checked after replay in the relayer; replay → ALREADY_SUBMITTED, no lock; relayer 503 = nothing broadcast); tests not vacuous (overlap test verified genuine).

| # | Sev | Finding | Disposition |
|---|---|---|---|
| F1 | low–medium | A family that never answers (e.g. broken AAAA) discarded the other's answer until the 3 s deadline → deferrals → eventually `failed` | **Fixed**: after the first family answers, 300 ms grace then cancel; re-review: correct (7 edge cases probed, no unhandled rejections; SSRF unchanged) + test |
| F2 | low | Invoice route dropped the relayer's tx hash on relayed-200 + failed confirmation | **Fixed** (`markPending(result.txHash)`) + test; re-review: correct |
| F3 | low | When a pending attempt later settles from the chain, `payment.txHash` is null (the relayer's reference isn't carried forward) | **FOLLOW-UP** (Stage 4/5: carry as a separate unverified `relayTxHash` or after receipt verification) |
| F4 | low (pre-existing; money UX) | Shop-session path: relayer refusal + failed chain read told the customer to start a new checkout (possible second charge with a new orderRef) | **Fixed** (keep pending, 504 "Don't pay again", as payCheckout) + test; re-review: correct |
| — | info | Stale comments (webhooks.ts assertPublicUrl/threadpool/SKIP LOCKED mentions); grace may exceed the remaining deadline in the last 300 ms (deferred, as before) | FOLLOW-UP |

## Carried FOLLOW-UP
Dedicated least-privilege Neon role for the relayer; FR-OPS-4 Unknown→reconcile with a nonce floor from `rel_sent.tx_nonce`; FR-OPS-6 full transactional outbox with the business state change; re-measure NFR-4/NFR-14 after deploy (extra Neon round trips in the relayer and rate limits); breaker vs cooldown thresholds (owner limits decision); V1 wrong-amount order consumption (Stage 4 contract change); outbound/deployed HTTPS smoke test (only a controlled local fixture so far).
