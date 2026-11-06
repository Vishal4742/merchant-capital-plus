# 044-P5-page-latency
Phase: 5 (PHASES.md)   Round: 1   Owner lane: claude-research (agent)
Mode: phase
Money: no (navigation links, read ordering and a cache on a display-only fee read; no pay, signing, key or contract code)
Request (verbatim): human 17:17: "optimize the latency or the load when we switch the pages in Vercel"
Agent ids (builders, for SendMessage resumes): none (built inline by the performance session)
Log:
- Do-not-edit (other batches): components/Checkout.tsx, InvoicePay.tsx, WalletPay.tsx, lib/payer-wallet.ts, lib/sign-sale.ts,
  app/api/v1/sessions/**, app/api/v1/invoices/**, lib/capital-wallet.ts, lib/server/capital-fund.ts,
  components/capital/investor/**, lib/withdraw.ts, components/merchant/Withdraw.tsx, app/merchant/settlements/page.tsx,
  lib/merchant-wallet.ts, contracts/, apps/relayer/. app/merchant/page.tsx and components/merchant/Invoices.tsx were freed
  by the coordinator after batch 041 merged (main 4cdfd17); merged before touching them.
- Measured production first (spec.md §Measurements), then fixed.
- Red → green: test/dashboard-soft-nav.test.mjs failed (f9b5cff), then Nav soft links (0b44bb4).
- Next 16 keeps up to 3 visited routes in React Activity, so the phone menu came back open: FoldedMenu folds it on hide
  (1372c08, Next docs "Preserving UI state").
- Payments: index + records in parallel, fees via 'use cache' by tx hash (49beb89). Home: records alongside the chain,
  Shell fallback (30b8502).
- ci PASS (round-1/ci.md): typecheck, lint, 674 tests (672 pass, 0 fail, 2 skipped), build. Local: a dashboard switch
  goes from 45–46 requests + an Anon-RPC reboot to 1 request; Payments 1596 ms cold → ~590 ms with fees cached.
- Not touched (other batches' files): settlements' per-row readTxFee (`app/merchant/settlements/page.tsx:30-33`) can
  switch to `cachedTxFee` in one line.
