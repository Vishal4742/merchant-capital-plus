# Spec: 036-P5-capital-merchant

The merchant half of the Capital tab at /merchant/capital (docs/CAPITAL-TAB.md §4 M1-M3, §6 AT-3/AT-5/AT-6), on the
batch-023 server (GET /api/v1/capital/merchant's reads, POST /api/v1/capital/offers/{id}/publish). Contracts frozen.

## Requirements (cite docs/SRS.md IDs)
- FR-ADV-1: list an advance (principal, cap, holdback %, term, offer deadline); the form refuses what CapitalMarket's
  BadTerms refuses (principal 0, cap < principal, holdback 0 or > 30%, term 0, deadline not in the future), plus the
  offer-book limits (term at most 180 days, MAX_OFFER_DAYS: the Arkiv entity expires at maturity) and the testnet
  1-1,000 USDT range.
- FR-ADV-2: one active advance: while one runs, M1 shows it instead of the form (open / expired with Cancel, repaying).
- FR-ADV-5: a repaid advance shows "Repaid. Sales now go 100% to you, minus the fee." with the form back.
- FR-ADV-6: the total cost (cap − principal) and the holdback are shown before the wallet opens.
- FR-INV-1: list an open, unpaid invoice below face, offer deadline at most due − 60 s (LOCK_WINDOW), due date at
  most 180 days ahead.
- FR-INV-2: the price comes from a target APR, priceFromApr (CAPITAL-TAB G3, IST calendar days), and both are shown.
- FR-ARK-1: right after the listing receipt, POST publish writes the offer to Arkiv; "Publish again" for an offer that
  isn't in the book yet (G4).

## Acceptance criteria (each must be checkable)
- [ ] AT-3 steps 1-3: principal 10, cap 11, holdback 20, term 30, deadline 1 day → "When investors fund it, you get
      10.00 USDT. You repay 11.00 USDT (cost 1.00 USDT) from 20% of each sale until it's repaid." before signing;
      listAdvance(10000000, 11000000, 2000, 2592000, deadline) then publish.
- [ ] AT-5: with advance null and a settled advance in the merchant's offers, M1 shows the repaid note and the form.
- [ ] AT-6 step 2: a 100 USDT invoice due in 60 IST days at 12% APR prices 98065556 (98.065556 USDT), "60 days",
      "12.00% APR"; listInvoice(id, 98065556, deadline, 0) then publish.
- [ ] test/ui-capital-merchant.test.mjs covers the validation mirror, the cost and price math (bigint) and the publish
      call (mock fetch), and pins the copied ABI fragments and address to packages/shared.
- [ ] States: signed out, loading, empty, read error, wallet errors (wrong network, rejected, contract errors as copy),
      sent-but-unconfirmed (SENT_UNCONFIRMED), publish failed after listing.
- [ ] 375 and 1440 render with no horizontal scroll; /merchant/:path* CSP unchanged.
- [ ] typecheck, lint, web tests, build pass.

## Files to touch (owner lane: only these)
- apps/web/app/merchant/capital/page.tsx
- apps/web/components/capital/merchant/*.ts(x)
- apps/web/test/ui-capital-merchant.test.mjs (new)
- apps/web/components/dashboard/Nav.tsx (capital item gets href /merchant/capital)

## Ponytail ladder
- Reuses connectMerchant, SENT_UNCONFIRMED and walletError from lib/merchant-wallet.ts (not edited; send() is
  private, so the short simulate → write → receipt step is repeated with the same SENT_UNCONFIRMED rule).
- Reads the same functions as GET /api/v1/capital/merchant (merchantAdvance + offerBook) on the server, the repo's
  direct-read pattern (lib/gateway-server.ts); the invoice picker reuses merchantInvoices (lib/onchain.ts).
- priceFromApr doesn't exist in apps/web yet: written once in components/capital/merchant (pure, tested).
- Already-listed invoices aren't filtered server-side (no claimOfInvoice read in lib/server/capital.ts): the dry run
  refuses them with InvoiceNotListable copy before the wallet asks for anything.

## Out of scope
- Investor view (/capital, components/capital/investor/**, lib/capital-wallet.ts): parallel agent.
- app/merchant/page.tsx "Capital · Soon" quick action and the Invoices Cancel rule (other lanes' files).
