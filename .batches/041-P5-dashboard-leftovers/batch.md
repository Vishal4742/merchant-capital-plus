# 041-P5-dashboard-leftovers
Phase: 5 (PHASES.md)   Round: 1   Owner lane: claude-frontend
Mode: phase
Money: no (links and a read-only tile; no amount, signature or relay path)
Request (verbatim): claude-research 17:14: "app/merchant/page.tsx:257 still shows 'Get paid early · Capital · Soon' (make it a link to /merchant/capital, drop 'Soon' — the page exists now), :109 'Vouchers used — Soon' (fill it from the vouchers module or remove the tile), and the invoice view's 'Sell this invoice' → /merchant/capital?invoice=<id>. Small batch, rides the deploy."
Agent ids (builders, for SendMessage resumes): none (built inline)
Log:
- 17:20 /merchant/capital is PR #32 (not merged yet; its page reads ?invoice= as the preselected invoice), so the links
  land with it in the one deploy.
- Red → green: test/home-tiles.test.mjs 5 of 5 failed, then pass. tsc 0, lint 0. Commit bb6dfde.
- The voucher read logs by error name only (logFailure), not the page's `logged` (it prints the message; a DB message
  can hold SQL).
- Build exit 0, 0 error lines. :3100 as the demo merchant, 375/1440 light+dark: Vouchers used "1 · all time · 1 of 1
  code live", "Get paid early" → /merchant/capital, 0 CSP violations, no horizontal scroll. The remaining "Soon" on the
  page is the Nav (Capital, Webhooks), which PR #32 flips.
- The demo merchant's only invoice is paid, so "Sell this invoice" was checked on a scratch fixture page (outside the
  repo) rendering the real Invoices component: only the open unpaid row (7) links to /merchant/capital?invoice=7;
  part-paid, paid, cancelled rows don't; 375 and 1440 lay out cleanly (scratchpad/b041-shots/fx-invoices-*).
- 17:24 ci PASS (tsc, lint, 637 tests 635 pass 0 fail 2 skipped, build 0 errors). Money: no, so no security pass.
