# Spec: an invoice buy must leave a fundable remainder (phase mode, Money: yes)

Source: claude-frontend's UX review on PR #33 (batch 035), MEDIUM 1-4.

## Requirements
- **FR-INV-3 / FR-TOK-3 (MEDIUM 1):** several investors fund parts of an invoice, at most 2 per claim (batch 026), and the
  investor taking the last slot buys everything left. A first buy may therefore never leave a remainder that costs less than
  the 1.00 USDT minimum, or the invoice can never fill. `POST /api/v1/capital/fund` refuses, before any relay, a buy with
  `units < left` unless `left − units ≥ minUnits(price, face)` (the smallest units whose quote is at least 1.00 USDT).
  The fund panel mirrors the rule in `amountBlocker` with "Buy all X, or leave at least Y for the next investor."
- **MEDIUM 2:** the first investor of an invoice is told the 2-investor rule (the second buys everything left); each offer
  row says "1 investor" (advance) or "Up to 2 investors" (invoice).
- **MEDIUM 3:** amounts on the investor pages show 2 decimals; the exact 6-decimal cost stays only on the line the investor
  approves (the "Hold to pay" button and its "Sign once to pay" line).
- **MEDIUM 4:** at 375 px the wallet chip comes before the Offers / Your claims nav in the tab order, matching what is seen.

## Acceptance criteria
- [ ] AT-6: 60 then 40 of a 100 USDT invoice still passes on the server and in the panel (60 leaves 40, which costs 39.23).
- [ ] Tests first: test/capital-fund.test.mjs refuses a 99.50 first buy of 100.00 (0.50 left) with 400 and no relay;
      test/ui-capital-investor.test.mjs gets the "Buy all … or leave at least …" message, and the same rule's boundary.
- [ ] apps/web: npm run typecheck, npm run lint, npm test, npm run build pass.

## Files
apps/web/lib/server/capital-fund.ts, apps/web/lib/capital-wallet.ts, apps/web/components/capital/investor/{FundPanel,OfferBook,InvestorApp}.tsx,
apps/web/test/capital-fund.test.mjs, apps/web/test/ui-capital-investor.test.mjs.
