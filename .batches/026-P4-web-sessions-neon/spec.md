# Spec: 026-P4-web-sessions-neon

Request: security review 022 finding 1 (10:25): on Vercel, checkout sessions live in one instance's memory, so the page and the API (different instances) can't see them, and every live checkout says "This checkout link doesn't work". The human approved the deploy at 10:12. claude-contracts approved the 050 / app_web_ naming at 10:27. Phase mode, **Money: yes** (the pay lock, the pending state, idempotency, sign-in nonces), so one reviewer-security pass. Batch 022's notes call this "batch 023"; numbers are assigned in order.

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-PAY-4 / FR-GW-1/2/5: checkout sessions live in Postgres (`app_web_sessions`), so any instance reads the one the shop, link or page created.
- FR-PAY-5 / F1–F3 (claude-contracts 009): the pay lock is atomic across instances (`app_web_locks`, `INSERT … ON CONFLICT DO UPDATE … WHERE until < now() RETURNING`, 300 s, the function's maximum duration). recordPayment is first-write-wins in SQL. clearPending compares and clears. The F1 order and the release in finally are unchanged.
- FR-GW-5: Idempotency-Key is cross-instance (`app_web_idempotency`, with an owner; a waiting duplicate gets the first reply or a 409 "still being processed").
- FR-PAY-15: a SIWE nonce is single use across instances (`app_web_nonces`).
- G4 code review LOW 3: the voucher DELETE uses claude-contracts' `removeVoucher`. LOW 4: GET /api/v1/sessions/:id reports the paid amount.
- NFR-6: with no database, pages show their plain "can't open this right now" notices and APIs answer 503.

## Acceptance criteria
- [ ] `db/050_web_sessions.sql` (8 idempotent statements), applied to Neon with `db/migrate.mjs` before the deploy.
- [ ] No in-memory session, lock, idempotency or nonce state is left (grep). Every caller awaits; no store call is left un-awaited in an `if`.
- [ ] Tests: 519 / 517 pass, including `sessions-db` (cross-instance races, lock expiry, first-write-wins, compare-clear, idempotency across instances, single-use nonces, bigint round-trips).
- [ ] typecheck, lint, `npm test`, build. The live site (Vercel): "Try a checkout" renders its checkout. One confirm payment there, with the human's yes.

## Files
- `apps/web/db/050_web_sessions.sql` (new)
- `apps/web/lib/{sessions,settle,auth}.ts`
- the session/pay/invoice/payments/demo/auth routes
- the checkout, receipt, pay and merchant pages
- one await each in claude-contracts' `lib/server/{links,refunds}.ts`
- tests (17 files, plus the new sessions-db)
