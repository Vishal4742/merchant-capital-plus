# Spec: 006-P4-g4-live

No contract change: the ABI is frozen (G3) and Phase 5 contract items stay cut (human 02:02). This batch proves gate G4's contract scenarios live and closes NFR-10.

## Requirements (docs/SRS.md)
- **AT-6** two investors fund a 100 USDT invoice at 12% APR, 60 days, 60/40 (÷100): prices ≈ 58.84 and ≈ 39.23 exact from the contract; merchant receives their sum (FR-INV-1, FR-INV-3).
- **AT-7** the debtor pays the invoice: investors receive 60 and 40 in the same tx; claim settled (FR-INV-4). Fee on top (human, G3 gate): the debtor pays 100.10.
- **AT-8** (contract side) a claim transfer to a non-eligible wallet reverts, and `ClaimToken.canTransfer` reports false beforehand (FR-TOK-2, FR-TOK-8 contract half; the UI half is claude-frontend's).
- **NFR-10** E1 event-ABI snapshot test; coverage report recorded.

## Acceptance criteria
- [ ] `contracts/script/LiveInvoice.s.sol`: `fund()` (merchant creates + lists the invoice; investors A/B fund 60e6/40e6 units, deployer submits) and `pay(uint256)` (debtor signs 100e6 + relayFee, deployer submits); simulated before broadcast.
- [ ] Live AT-6: `Funded` events with costs 58,839,334 and 39,226,223; merchant +98,065,557 USDT units.
- [ ] Live AT-8 (between fund and pay, read-only, no gas): `canTransfer(A, stranger, claimId, 1)` = false and an `eth_call` of `safeTransferFrom(A, stranger, …)` from A reverts `ERC7943CannotReceive(stranger)`; `canTransfer(A, B, claimId, 1)` = true (both eligible).
- [ ] Live AT-7: `Paid` toInvestors 100e6, toMerchant 0, fee 1e5; A +60e6, B +40e6; `Settled(claimId)`; claim outstanding 0; invoice status Paid; debtor and investors 0 WBT, nonce 0.
- [ ] `contracts/test/EventAbi.t.sol` pins every event topic of the four contracts; the debtor's missing 0.10 fee is topped up by the merchant inside `pay()` (no seed change); `forge test -j 1` green; coverage summary in build-contracts.md.

## Files
- `contracts/script/LiveInvoice.s.sol`, `contracts/test/EventAbi.t.sol`, `contracts/broadcast/LiveInvoice.s.sol/1874/*-latest.json`, `.batches/006-P4-g4-live/*`, `notes/phase-4-contracts.md`

## Ponytail ladder
- Reuses the LiveAdvance signing pattern and the deployed contracts; AT-8 needs no transaction (a revert is shown by simulation, so no WBT is spent and investors keep 0 WBT).

## Out of scope
- Any contract change, the Arkiv offer book (AT-9, claude-frontend), the UI reason display (FR-TOK-8 UI half).

## NEEDS THE USER
- PIPELINE §11: a live script moving demo-wallet money with the deployer, merchant, investor and debtor keys (all testnet demo wallets).
