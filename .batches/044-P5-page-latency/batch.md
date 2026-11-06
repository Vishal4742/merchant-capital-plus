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
