# Spec: 004-P2-seed

## Requirements (cite docs/SRS.md IDs)
- **CON-8**: demo wallets are funded by a one-off seed script from the team wallet (key in `.env`); the app has no faucet.
- **CON-4**: payers (customer, investors, debtor) never need WBT; only the demo merchant gets a little WBT for its own admin txs (SRS §2.2 U1 "may hold WBT").
- **CON-7**: keys only in `.env`, never printed. Serves the demo scenarios **AT-1 – AT-7** at the ÷100 amounts the human chose 23:58 (AT-1/AT-2 keep 25 USDT) and **G5** (the demo runs twice in a row), which needs the money back between runs.

## Behaviour
`contracts/script/Seed.s.sol`, deployer key only, two entry points:
- `fund()`: tops each demo wallet up **to** its target, never above; checks first that the team wallet holds the total shortfall and reverts with the missing amount before sending anything; prints a table.
- `reclaim()`: every script wallet (DEMO_MERCHANT, DEMO_INVESTOR_A, DEMO_INVESTOR_B, DEMO_DEBTOR, PAYER) signs an EIP-3009 `TransferWithAuthorization` of its whole USDT balance to the team wallet and the **deployer submits it**, so those wallets stay at 0 WBT and nonce 0.
- Optional `CUSTOMER` env address (the browser guest wallet, created at demo time): funded by `fund()`, never reclaimed (its key lives in the browser).

Targets (÷100 demo, each cites its scenario):
| Wallet | USDT | WBT | Why |
|---|---|---|---|
| DEMO_MERCHANT | 1 | 0.02 | covers the 0.10 fee when refunding AT-1's full 25 (AT-2); WBT for createInvoice/listAdvance/approve/refund |
| DEMO_INVESTOR_A | 69 | 0 | AT-3 advance 10 + AT-6 share of 60 face ≈ 58.84 |
| DEMO_INVESTOR_B | 40 | 0 | AT-6 share of 40 face ≈ 39.23 |
| DEMO_DEBTOR | 100 | 0 | AT-7 pays the 100 invoice |
| CUSTOMER (optional) | 56 | 0 | AT-1 25 (refunded in AT-2), then AT-4 5 + AT-5 ≈ 50 + 1 |
Total ≈ 266 USDT with a customer, 210 without. Team wallet now 110.62 USDT + 1.99 WBT: see NEEDS THE USER.

## Acceptance criteria
- [ ] Fork tests (`contracts/test/Seed.t.sol`, real USDT, pinned block): `fund` brings each wallet exactly to target; a second `fund` sends nothing; a wallet above target is left alone; payers get 0 WBT, the merchant gets exactly 0.02; with the team wallet short, `fund` reverts naming the shortfall and moves nothing.
- [ ] `reclaim` returns every script wallet's USDT to the team wallet; their WBT balance and nonce don't change (the deployer submits); wallets at 0 are skipped; a reclaim signature can't be redirected (token rejects a changed `to`).
- [ ] Live, read-only: `forge script … --sig "fund()"` **without** `--broadcast` against 1874 prints the real plan and, while the float is short, the exact shortfall. Live with `--broadcast` (deployer key): `reclaim()` returns the PAYER's 1 USDT, PAYER stays at 0 WBT / nonce 0 (tx hash in build-contracts.md).
- [ ] `forge build` 0 warnings, `forge lint` clean, `forge fmt --check`; tests 100% of the script's money paths.

## Files to touch
- `contracts/script/Seed.s.sol`, `contracts/test/Seed.t.sol`, `contracts/test/SeedEdges.t.sol` (round-1 tester), `contracts/broadcast/Seed.s.sol/1874/{reclaim,fund}-latest.json` (live records), `.batches/004-P2-seed/*`, `notes/phase-2-contracts.md`

## Ponytail ladder
- Needed: yes (CON-8; G5 needs repeatable runs). Already in repo: the signing pattern of `SmokeMerchantPay`, OZ `IERC3009` + `MessageHashUtils`.
- Minimum: one script, fixed targets as named constants, no config file, no new dependency. Reclaim uses the token's own `transferWithAuthorization` (no WBT to the wallets, no new contract).

## Out of scope
- Moving money between demo wallets during a scene (the app does that), faucet claims and swaps (human), the guest wallet's key.

## NEEDS THE USER
1. **Float**: the ÷100 demo needs ≈ 266 USDT funded at once (210 without the customer); the team wallet has 110.62 USDT + 1.99 WBT (≈ 140 USDT if swapped, keeping 0.09 WBT for gas). Options: (a) one faucet claim into COLLECTOR1 (2 WBT ≈ 146 USDT) then I sweep + swap; (b) swap the team wallet's spare WBT now and run scenes with `reclaim` between them; (c) both.
2. PIPELINE §11: script moving team-wallet money with the deployer key and signing with five script-wallet keys.
