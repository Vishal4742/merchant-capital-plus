# Spec: 008-P4-web-review-fixes

Request: the batch 006 round-2 follow-ups (review-code 1, 4, 8, 10; review-security R2-F1, F3, F5, F7, F8), the human's 06:18 gate decision (FX bands ±15% of today), the G2 run's redirect bug, and claude-relayer's 06:06 heads-up (x-relay-secret). Phase mode (PIPELINE §3b): build + ci. Money: yes (relayer auth, payment cap), so one reviewer-security pass.

## Requirements (cite docs/SRS.md v2.0 IDs)
- FR-GW-11 / ARCHITECTURE §4b: the FX sanity band is ±15% of today's rate for EUR, GBP, INR and SGD, in units per USD, the same numbers as claude-contracts' quotes module. AED stays at its peg ±1%.
- §4b: at most 1,000 USDT per payment on every session path, and on invoices.
- FR-PAY-4 / FR-PAY-7: "Try a checkout" lands on the same host it was pressed on (relative 303), and is rate-limited per IP.
- FR-GW-5: `GET /api/v1/sessions/:id` only shows this shop's own checkouts.
- FR-REL / NFR-14: every POST /relay carries `x-relay-secret` when `RELAY_API_SECRET` is set (server-only), so web works before and after relayer batch 006.
- NFR-6: /docs sends no prerender error, and its wordmark is a full page load.

## Acceptance criteria
- [ ] `lib/fx.ts`: bands in units per USD:
  - EUR 0.7554–1.0221
  - GBP 0.6309–0.8536
  - SGD 1.0858–1.4690
  - INR 80.33–108.68
  - AED 3.635775–3.709225
  
  Tests: a flipped EUR/GBP/SGD rate is refused; today's rates pass.
- [ ] Sessions route: amounts are capped at `MAX_PAYMENT` (1,000 USDT) from `lib/server/http.ts`. The message reads "amount must be between 1.00 and 1,000.00 USDT"; tests are updated.
- [ ] `components/merchant/Invoices.tsx`: the 1,000 USDT cap.
- [ ] Idempotency: the `finally` deletes only its own entry. Test: an evicted, then failed, request doesn't delete a newer entry.
- [ ] `/api/demo-checkout`: a relative `Location`, and at most 10 checkouts per IP per minute (429 with a plain line). Test the 303 Location and the 429.
- [ ] `GET /api/v1/sessions/:id`: 404 for a checkout of another merchant. Test it.
- [ ] `lib/relay.ts`: sends `x-relay-secret` when `RELAY_API_SECRET` is set; no header when unset. The secret never appears in a returned message. Tests for both.
- [ ] `/docs`: `headers()` is read before `currentMerchant()`; the wordmark is a plain `<a href="/">`.
- [ ] The stale "22.50" comment in `app/checkout/[sessionId]/page.tsx` is fixed.
- [ ] **Sign-in on 127.0.0.1 (human 06:30, "That signature didn't check out").** `next start` reports request.url as localhost, so a message signed on 127.0.0.1:3100 failed the domain check. `signInDomains()` (lib/auth.ts) accepts the request's host, its loopback spellings under localhost, and PUBLIC_ORIGIN's host. Any other domain is refused. Tests included.
- [ ] **Security 008 F2.** The relay fetch uses `redirect: "manual"`, and the secret is sent only to an https or loopback relayer URL. Tests included.
- [ ] ci: typecheck, lint, `npm test`, build.

## Files (claude-frontend)
- `apps/web/lib/fx.ts`
- `apps/web/app/api/v1/sessions/route.ts`
- `apps/web/app/api/v1/sessions/[id]/route.ts`
- `apps/web/app/api/demo-checkout/route.ts`
- `apps/web/lib/relay.ts`
- `apps/web/app/docs/page.tsx`
- `apps/web/components/merchant/Invoices.tsx`
- `apps/web/app/checkout/[sessionId]/page.tsx`
- tests under `apps/web/test/`
