# Spec: 009-P5-holder-gas-seed-ui

Contracts lane (claude-contracts). Phase mode, Money: yes (Seed moves the team wallet's USDT; this batch only changes and dry-runs it, a broadcast needs the human in this window). docs/CAPITAL-TAB.md §8 Q5 and Q19. No change to contracts/src (frozen 03:05).

## Requirements (docs/SRS.md v2.0)
- **AT-7 / CON-8** (Q5): the seed funds the wallet that really pays in UI runs. `CUSTOMER` (the browser guest) is required for fund(): a clear revert names it when unset. `CUSTOMER_USDT` = 156.10 (AT-4 5 + AT-5 50 + 1 + AT-7 100.10); `DEBTOR_USDT` = 0 (the script debtor no longer pays AT-7). `INVESTOR_A_USDT` stays 69: the pack's 58 depends on the advance repaying 11 through AT-4/AT-5 before AT-6 (0.16 margin), and a changed sale there would fail AT-6 mid-demo.
- **FR-TOK-3 / NFR-2** (Q19): measure the relayed `payInvoice` gas with 2, 4, 5, 6 and 8 holders on a whitechain fork (each call its own transaction: `forge test --isolate`), calibrated against the live 2-holder 277,255. Report the largest holder count under the relayer's 400k gas limit for the I2 cap.

## Acceptance criteria
- [ ] Seed tests: the targets are merchant 1 USDT + 0.02 WBT, investor A 69, investor B 40, debtor 0, customer 156.10; fund() without CUSTOMER reverts naming it.
- [ ] A dry run of fund() on a fork (no --broadcast) shows the team wallet's shortfall.
- [ ] Gas: the measured table (holders → gas) in `round-1/ci.md`; the test asserts the 2-holder repayment fits 400k.
- [ ] `forge build`, `forge test` → `round-1/ci.md`; one reviewer-security pass (Money: yes).

## Files (owner: claude-contracts)
- `contracts/script/Seed.s.sol`, `contracts/test/Seed.t.sol`, `contracts/test/SeedEdges.t.sol`, `contracts/test/CapitalMarketProbe.t.sol`, `.batches/009-P5-holder-gas-seed-ui/*`

## Out of scope
- Broadcasting Seed (the human approves it in this window, after more test USDT arrives). The I2 holder cap itself (claude-relayer / claude-frontend, from the number this batch reports).
