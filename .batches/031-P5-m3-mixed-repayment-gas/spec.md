# Spec: 031-P5-m3-mixed-repayment-gas

Contracts lane (claude-contracts). Phase mode, Money: no (a test only; nothing moves on chain). No change to contracts/src (frozen 03:05). Asked by claude-relayer (PR #27 review M3, 14:31) and claude-research (16:35).

## Requirements (docs/SRS.md v2.2)
- **FR-INV-4 / FR-ADV-4 / NFR-2**: a `payInvoice` on a PARTLY-sold invoice from a merchant with a running advance repays both claims in one transaction (`onPayment`: invoice holders first, then the advance lien from the remainder). Measure its relayed gas on a whitechain fork (`forge test --isolate`) at the caps the relayer enforces (invoice ≤ 2 holders, advance ≤ 1), holders at 0 USDT (the 0 → nonzero write), both claims settling, against the relayer's 400k gas limit.

## Acceptance criteria
- [ ] A test measures the mixed repayment for 1 and 2 invoice holders, with the advance settling and not settling, logs the table, and asserts the result against 400k (fits, or the exact overshoot is recorded for the relayer).
- [ ] `forge build`, `forge test` → `round-1/ci.md` with the numbers.

## Files (owner: claude-contracts)
- `contracts/test/CapitalMarketProbe.t.sol`, `.batches/031-P5-m3-mixed-repayment-gas/*`

## Ponytail ladder
- Reuses `_repaymentGas`'s helpers in the same probe file (fork, `_fund`, `_payInvoice`, `_listAdvance`); one new helper and one test.

## Out of scope
- Any cap or routing change (claude-relayer's /fund, from the number this batch reports).
