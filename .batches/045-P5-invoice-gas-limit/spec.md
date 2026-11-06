# Spec: 045-P5-invoice-gas-limit (phase mode, Money: yes; deploy after G5)

## Requirements (cite docs/SRS.md IDs)
- **FR-REL-5 (gas limit cap) / FR-INV-1..5 (an invoice stays payable) / FR-ADV-4:** a `payInvoice` relay is signed with a gas limit of `clamp(ceil(estimate × 1.2), 400k, 600k)`.
  - The minimum is 400k, so no invoice that fits today gets a lower limit than it has today.
  - The 1.2 margin covers state that changes between the estimate and the block, for example a holder's USDT balance going from 0 to non-zero.
  - An estimate above 600k is still `422 too_much_gas`.
  - A failed estimate uses 600k, and the gas-capped simulation decides. That covers an RPC error and also a reverting estimate (security 045 INFO-2: the simulation is still the judge, as in batch 022).
  - Measured by claude-contracts: up to 504,115 gas for 2 invoice holders plus a 1-holder advance, all holders at 0 USDT.
- `paySale` and `fundWithAuthorization` don't change: they keep a fixed 400k limit, and an estimate above 400k is `too_much_gas`.
- **Budget and worst case (FR-REL-5, FR-REL-10):**
  - a send's worst-case fee is its own gas limit × 6 gwei: up to 0.0036 WBT for an invoice, 0.0024 WBT for everything else;
  - the pre-lock budget check uses the kind's maximum (600k for invoices);
  - the in-lock check and the `rel_sent` reservation use the chosen limit;
  - the receipt fee replaces it as today. The daily budget stays at 0.1 WBT.
- **Simulations:** before the lock, at the kind's maximum; inside the lock, at the chosen limit, so the limit the tx is signed with is exactly the one that was simulated.
- **Known cost (the human accepted it, 19:1x):** at a 6 gwei gas price, a 500k-gas invoice repayment costs about 0.003 WBT (≈0.22 USDT), more than the 0.10 USDT relay fee. This only happens on a partly-sold invoice while an advance is running.

## Acceptance criteria
- [ ] Tests first (RED commit), in the relayer tests:
  - invoice estimates of 457,214 → limit 548,657; 504,115 → 600,000; 310,000 → 400,000; 610,000 → 422 too_much_gas with nothing sent;
  - a failed estimate → 600,000;
  - the in-lock simulation runs at the chosen limit;
  - sale and funding at an estimate of 421,338 are still too_much_gas;
  - an invoice that is never mined reserves limit × 6 gwei in `rel_sent`;
  - the budget refuses an invoice when spent + 0.0036 > 0.1.
- [ ] All existing relayer tests pass. The one that changes on purpose: a 421,338-gas invoice now relays at limit 505,606 instead of being refused.
- [ ] `npm test` and `npx tsc --noEmit`; reviewer-code, reviewer-security and ci all PASS.
- [ ] After G5 only: redeploy the relayer and post the deploy.

## Files
apps/relayer/src/relayer.ts, apps/relayer/test/relayer.test.ts.

## Ponytail ladder
One gas-limit function and a `gas` field on the payment; `FEES` loses `gas`. No new config or dependency.

## Out of scope
- Raising the invoice relay fee to cover the gas: that's a contract setting, and the contracts are frozen.
- Changing the limits for sales or funding.
