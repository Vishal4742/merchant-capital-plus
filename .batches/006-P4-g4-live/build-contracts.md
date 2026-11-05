STATUS: READY

# Build: 006-P4-g4-live (claude-contracts, rounds 1–2)

Commits: `25b91f5` LiveInvoice.s.sol + EventAbi.t.sol · `ad3918d` live broadcast records. No `src/` change (ABI frozen). Repo root `/Users/vg890/ethglobal-contracts` (branch `contracts`; pushed after PR #5 merges).
Contracts (frozen, batch 005): MerchantPay `0xab817593253a0a37de723072827d88fe0ca54251`, CapitalMarket `0xecd63a369d23dfddc6bfac921e41a86760c20abe`, ClaimToken `0xce9b171a5c485a41dced9d7f043733bddc26c388`, InvestorRegistry `0x293430fae87ca79844c6e3a64e8044078c4d3e74`. RPC for checks: `https://rpc.testnet.whitechain.io`.

## DONE
| Criterion | Evidence |
|---|---|
| LiveInvoice `fund()` (AT-6), from clean commit `25b91f5` | 4 txs all status 1: createInvoice `0xd618dffab00cf68a1eb632b76258c90a4c296e524f890731942787aaa7da7ac1` (merchant), listInvoice `0xd6fcbdf8a5da7921dcca9bbadd7a9473ed0637d2352616f2d050c0bbfa18617c` (merchant; invoice 1 → claim 2, price 98,065,556), fundWithAuthorization A `0x6b346413c77effb7f2084103caf93236a47349681729816bb0a850aa95a9ab3c` **Funded 60,000,000 units, cost 58,839,334**, B `0xab395b1dd7c452229661dfab86f7efee79700d87bc00aaa7957390c7627d9744` **40,000,000 units, cost 39,226,223** (both deployer-submitted). Merchant received 98,065,557 |
| AT-8 read-only (between fund and pay, no tx) | `canTransfer(A, 0x…dEaD, 2, 1)` = **false**; `canTransfer(A, B, 2, 1)` = **true**; `eth_call` `safeTransferFrom(A, 0x…dEaD, 2, 1, 0x)` from A reverts `0x705c1eed…dead` = `ERC7943CannotReceive(0x…dEaD)` |
| LiveInvoice `pay(1)` (AT-7) | 2 txs status 1: merchant tops up the debtor's 0.10 fee `0x7062534ec2d5ddb7c28ee8127c48709184003eb810777aaf187c0a07a22d1cc4`; payInvoice `0xd9172e76c1f19d2152d10283a84732ac0ef14680698f7279cfc2c10dd71003b1` (deployer-submitted): **Paid gross 100,100,000 fee 100,000 toInvestors 100,000,000 toMerchant 0**; A **+60,000,000**, B **+40,000,000**; claim 2 outstanding 0 (Settled); invoice 1 status 2 (Paid): `invoices(1)` → `(0x37F9…42B1, 1799096700, 2, 0x518b…6D9D, 100000000, 100000000)` |
| Payers gasless | debtor `0x518b…6D9D` 0 WBT nonce 0; investors A/B nonce 0, 0 WBT |
| E1 (NFR-10) | `test/EventAbi.t.sol`: 3 tests pin all 20 frozen per-contract event topics (MerchantPay 7, CapitalMarket 8, ClaimToken/IERC7943 4 incl. `MarketSet` (round 2), registry 1; the 8 inherited OZ events are not ours to freeze); PASS |
| Coverage (NFR-10), `forge coverage --ir-minimum` (batch 005 round-2 ci, same `src/`) | CapitalMarket 100% lines · ClaimToken 99.07% · InvestorRegistry 100% · MerchantPay 97.78% · PullStub 100%; 150 tests (+3 E1 = 153) |
| Quality | `forge build` clean, `forge lint` 0, `forge fmt` |

## ROUND 2 (after round 1: 5/5 PASS, follow-ups)
- reviewer-code MEDIUM 1 fixed: `EventAbi.t.sol` now also pins `ClaimToken.MarketSet` (one assert + the `ClaimToken` import). `forge test --match-path test/EventAbi.t.sol` 3/3, `forge fmt --check` and `forge lint` clean.
- Tester gap closed: invoice 1 status decoded above (2 = Paid, paid 100e6).
- AT-8 is now replayable at block 12316357 (commands in `notes/phase-4-contracts.md`, checked: balance 60e6, false/true, revert `0x705c1eed…dead`).
- Not fixed (by design): reviewer-code MEDIUM 2 (`indexed` flags) needs a CI step = human (§11), proposed at the gate; security LOW (top-up cap) and code LOW 3/5: the script has run once and won't run again on frozen contracts.
- ci to re-run coverage fresh (round 1 figures were carried over from batch 005, same `src/`).

## OPEN
- G4 also needs AT-9 (Arkiv offer book + private reads) and the FR-TOK-8 UI reason: claude-frontend.

## NEEDS THE USER
- PIPELINE §11: live script moving demo-wallet money (deployer, demo merchant, investor and debtor keys; testnet demo wallets only).
