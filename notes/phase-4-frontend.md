# Phase 4, frontend (claude-frontend)

## Batch 006-P4-web-gateway-shell (closed 06:20, 6 Nov)
**What shipped:**
- FR-GW-14: a test-mode strip on every page, from the root layout.
- A dashboard shell (top bar plus a nav with "Soon" items) around the redesigned merchant home: night band, KPI tiles, halftone chart.
- FR-GW-8: `/docs`, with the button, SDK and webhook snippets, a key fingerprint for the shop wallet, and "Simulate a payment".
- FR-GW-11: sessions v2, with `currency` (USDT, USD, EUR, GBP, INR, AED, SGD), `returnUrl` and `Idempotency-Key`.
  - Non-USDT prices convert through Frankfurter v2 and are rounded up to the cent.
  - Each currency has a sanity band, and the rate date must be at most 7 days old.
  - The quote locks for 10 minutes.
- FR-GW-5: `GET /api/v1/payments`. Amounts come from the chain, not the index.
- The checkout gets a rate line, a countdown, "Pay exactly…", "You paid no network fee", and "Back to <shop>".

**Proof:**
- Two rounds; the second was 5/5 PASS.
- 293 tests (290 pass, 3 live-only skipped).
- /checkout ships 191,149 B of JS.
- **AT-1 live on this build:** tx 0x7e03b5d0c52b6b7d941845b364f78875719c481fc7d4b353187038b504b37a11 (block 12329601). The customer paid 0 WBT; the merchant received 24.90 USDT.
- NFR-4 missed: 10.1 s. ~9 s went before inclusion, on the relayer's side.

**Decisions:**
- Human 05:4x: FX has a single source (claude-contracts' quotes module), with `lib/fx.ts` as a bridge until then, plus the sanity limit.
- Human 06:18: narrow the bands to ±15% of today's rate.
- 05:52: round up to the cent, to match the quotes module.
- Human 06:03: phase mode. No per-batch review rounds; one full pass at the P4 gate.

**Follow-ups (the P4 fix batch):**
- The 1,000 USDT cap (§4b)
- The ±15% bands
- The switch to quotes.ts, then delete `lib/fx.ts`
- Link and page sessions with `priced` and a 10-minute expiry (claude-contracts)
- The demo-checkout redirect, made relative (it landed on localhost)
- In `/docs`: read headers() before currentMerchant(), and make the wordmark a plain `<a>`
- Idempotency: delete by entry
- A demo-checkout rate limit
- A merchant check on sessions GET
- The `x-relay-secret` header
