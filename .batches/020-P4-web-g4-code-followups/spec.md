# Spec: 020-P4-web-g4-code-followups

Request: claude-research 09:43 (G4 code review part 2, round-2/review-code.md: M2, LOW 6) and claude-relayer 09:42 (warm the relayer when a checkout opens). Phase mode, **Money: yes** (the payment announcement path), so one reviewer-security pass.

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-GW-7 / FR-GW-12 / AT-14 (M2): a paid checkout's announcement survives a transient database error. `announcePaid` retries (3 tries, 0.5 s then 1.5 s, inside after()). The paid checkout page and /r/[id] re-announce (idempotent through the backend's sendOnce), so a single-use link is marked paid, a code is counted, and payment.succeeded is sent.
- NFR-4 (claude-relayer 09:42): when a checkout opens (/checkout, /l, /p, /pay), our server fires `GET <RELAYER_URL>/health` in after(): no await, a 3 s timeout, errors ignored. This warms the Vercel relayer instance the sale will use (measured 7.31 s cold → 4.32 s warm).
- LOW 6: stale comments in `app/l/[slug]/page.tsx` (paid_at exists now) and `lib/gateway-client.ts`.

## Acceptance criteria
- [ ] `announcePaid(session, amount, send)` retries a failing send up to 3 times with backoff, logging each failure by error name only. Tests use fake send functions: success on the 2nd try; 3 failures stop with no throw.
- [ ] The paid checkout page and /r/[id] call `announcePaid(session, payment.amount ?? session.amount)` when `session.payment` exists.
- [ ] `warmRelayer()` in lib/relay.ts: fire-and-forget through after(), with an https/loopback-only URL as for the secret, and no header (health is public). Called from the 4 checkout entry pages. Test: it never throws and never awaits the fetch in the request path.
- [ ] typecheck, lint, `npm test`, build.

## Files
- `apps/web/lib/{announce-paid,relay}.ts`
- `apps/web/app/checkout/[sessionId]/page.tsx`, `apps/web/app/r/[id]/page.tsx`, `apps/web/app/{l,p}/[slug]/page.tsx`, `apps/web/app/pay/[invoiceId]/page.tsx`
- `apps/web/lib/gateway-client.ts` (comment only)
- tests
