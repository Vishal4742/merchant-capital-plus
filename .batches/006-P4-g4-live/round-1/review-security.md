VERDICT: PASS

# Security review: 006-P4-g4-live, round 1 (claude-security)

Scope: `git diff 3495cd4..HEAD -- contracts` (HEAD ad3918d): `script/LiveInvoice.s.sol`, `test/EventAbi.t.sol`, `broadcast/LiveInvoice.s.sol/1874/{fund,pay}-latest.json`. No `src/` change. Live checks were read-only `cast` against https://rpc.testnet.whitechain.io. I did not read .env, run forge script or use a key.

## Secret grep (`PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64}`) on the 4 diff files
- `LiveInvoice.s.sol:31-33,42-43,50-51,57`: only `vm.envUint("…_PRIVATE_KEY")` names. No values. Keys are never logged: the only `console.log` calls (lines 44-45) print `invoiceId` and `claimId`. Nothing is written to disk (no `vm.writeFile`, `writeJson` or `toString` on a key).
- `EventAbi.t.sol:48,50`: the ERC-7943 `ForcedTransfer` and `Frozen` event topics, which are public constants.
- Broadcast JSONs: I sorted every 64-hex value by its JSON path. They are tx, block and log hashes, event topics, log `data` amounts, `logsBloom`, the createInvoice `refHash`, the salt `"g4"` (`0x6734…00`), the signature `r`/`s` (already public in calldata and consumed on chain, so they can't be replayed), and forge's `recovery_generation`. That last field also appears in earlier committed records and differs between the fund and pay runs, which used the same key set, so it is not a key. No RPC URL or key in either file. `*.lock`, `run-<ts>.json`, `dry-run/` and `cache/` are git-ignored (`contracts/.gitignore:3-4`, root `.gitignore:23`).
- **No secret hits.**

## Signature binding (script vs src)
- Funding (`LiveInvoice.s.sol:67-78`): the digest uses ReceiveWithAuthorization with `to = address(market)`, `value = market.quote(claimId, units)`, validAfter 0, and `nonce = market.fundingNonce(claimId, investor, units, "g4")`. This matches `CapitalMarket.fundWithAuthorization` (src/CapitalMarket.sol:176-202), which pulls `cost` to `address(this)` with the same nonce. On chain, the `AuthorizationUsed` nonces equal live `fundingNonce(2, A, 60e6, g4)` = `0xd6df99f7…16b1` and `fundingNonce(2, B, 40e6, g4)` = `0xa8b574bf…0232`.
- Invoice payment (`LiveInvoice.s.sol:53-64`): `to = address(mp)`, `value = FACE + relayFee`, and `nonce = mp.invoiceNonce(invoiceId, FACE, "g4")`, which is bound to the credited amount, not the gross. This matches `MerchantPay.payInvoice` (src/MerchantPay.sol:135-157). On chain, the nonce equals live `invoiceNonce(1, 100e6, g4)` = `0xe709f348…5943`.
- The fixed salt `"g4"` can't be replayed. Funding nonces are unique per (claim, investor, units), and a re-run of `fund()` makes a new invoice and claim. A second `pay(1)` reverts `InvoiceNotOpen`. If the owner changed `relayFee` between simulation and inclusion, the tx reverts on the signature (fails closed).
- `vm.broadcast` / `startBroadcast` scoping is correct. Only createInvoice and listInvoice go out under the merchant key, plus the one USDT transfer. The two funds and the payInvoice go out under the deployer key, and all views run outside the broadcast. This matches the 6 txs in the records.

## Live verification (read-only cast)
| Claim in build-contracts.md | On chain |
|---|---|
| 6 txs status 1 | createInvoice 0xd618…, listInvoice 0xd6fc…, fund A 0x6b34…, fund B 0xab39…, top-up 0x7062…, payInvoice 0xd917…: all `status 0x1` (blocks 0xbbeebc to 0xbbeefd) |
| A cost 58,839,334, B 39,226,223, merchant +98,065,557 | Transfer A→market 58,839,334 → merchant 0x37f9…; B→market 39,226,223 → merchant. Market forwards in the same tx and holds nothing |
| AT-8 between fund and pay | At block 12316357 (A holds 60e6 of claim 2): `canTransfer(A, 0x…dEaD, 2, 1)` = false, `canTransfer(A, B, 2, 1)` = true, and `eth_call safeTransferFrom(A, dEaD, 2, 1, 0x)` from A reverts `0x705c1eed…dead`, where `cast sig ERC7943CannotReceive(address)` = `0x705c1eed` |
| Top-up = exact shortfall | merchant → debtor 100,000 (= relayFee). The debtor's USDT is now 0, so the top-up was exact and nothing is left over |
| Paid gross 100.10, fee 0.10, toInvestors 100, toMerchant 0 | debtor → MP 100,100,000; MP → feeRecipient 0xdd02… 100,000; MP → market 100,000,000; burns A 60e6 and B 40e6 (before the pushes, CEI); market → A 60,000,000, → B 40,000,000. Σ = gross |
| Settled, invoice Paid | `outstanding(2)` = 0; invoice 1 status 2, paid = amount = 100e6; A and B claim-2 balances 0 |
| Payers gasless | A, B and debtor: 0 WBT, nonce 0 |
| Nothing stuck | USDT held by MerchantPay 0, CapitalMarket 0, `totalOwed` 0 |

## Findings
1. **LOW** (non-blocking): `contracts/script/LiveInvoice.s.sol:55-58`, uncapped top-up. `topUp = value - held` is the exact shortfall, as required. But if the debtor wallet is empty (seed lost, or a re-run against a fresh invoice), the merchant key silently sends the full 100.10 USDT and pays its own invoice to the investors. This needs no attacker and only touches testnet demo wallets, but it would make a run look like an AT-7 pass when it isn't one. Fix: `require(topUp <= mp.relayFee(), "debtor underfunded")`. Owner: claude-contracts. This run was not affected: the top-up was 100,000.
2. **INFO**: `quote` rounds up, so the merchant receives 98,065,557 against an offer price of 98,065,556 (1 unit in the merchant's favour, from investors, as documented in src/CapitalMarket.sol:248). That is within the stated ≤0.000001 USDT per funding and doesn't favour an attacker.

No CRITICAL, HIGH or MEDIUM issues.
