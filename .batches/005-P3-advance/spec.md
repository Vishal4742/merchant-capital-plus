# Spec: 005-P3-advance

Human 00:34: build the FULL CapitalMarket now (advance + invoice financing) plus the final MerchantPay; InvestorRegistry/ClaimToken by a parallel developer subagent; default/recourse out (cut list #5). The ABI freezes at G3.

## Requirements (docs/SRS.md)
- **FR-ADV-1–6**: list an advance (principal, cap ≥ principal, holdback ≤ 30%, term, offer deadline); one active advance per merchant; gasless DvP funding; every later payment sends `min(gross × bps / 10_000, owed, net)` to holders in the same tx; lien ends at the cap; total cost readable (`quote`).
- **FR-INV-1, 3, 4, 5**: list an unpaid invoice below face with offer deadline ≤ dueDate − LOCK_WINDOW; several investors fund parts (DvP); debtor payments pay holders pro-rata first and burn covered units, partial payments allowed; transfers locked from dueDate − LOCK_WINDOW.
- **FR-TOK-1–4, 6, 7**: ERC-1155 claim ids; mint/burn market-only, burn never blocked; transfers only between eligible investors; ≤ 8 holders; frozen claims/amounts don't move; ERC-7943 views + interface id `0x41c4fbad` (so `forcedTransfer`/`setFrozenTokens` exist, admin-only); a revoked investor still receives repayments.
- **FR-KYC-1**: InvestorRegistry owner list.
- **NFR-1**: CEI, guarded routing, failed pushes fall back to a pull balance (`withdrawOwed`; USDT has a blocklist). **NFR-2**: Σ payouts + merchant + fee == gross; market USDT == Σ owed.
- **MerchantPay v2 (the last one)**: one-time `setMarket`; human 23:40: no self-merchant / self-fee-recipient, owner-only `sweep`; review items: fee read once, invoice amount ≤ uint96, `Ownable2Step`, partial invoice payments (amount ≥ 1 USDT or the exact remainder), `cancelInvoice` refuses financed or part-paid invoices.
- Gate **G3**: AT-3, AT-4, AT-5 at ÷100 (advance 10, cap 11, holdback 20%; a 5 USDT sale → 1 to the investor, outstanding 10; cap reached → lien removed, the next sale pays the merchant 100% minus the fee). AT-6/AT-7 numbers (100 face, 60/40 at 12% APR, 60 days) proven in tests.

## Interfaces (written first, `contracts/src/interfaces/`)
- `IInvestorRegistry`: `isEligible(address) view`, `setEligible(address, uint64 expiry)`, event `EligibilitySet`.
- `IClaimToken`: `mint`, `burn`, `setClaimState(id, lockFrom, frozen)`, `holdersOf(id)`, `totalSupply(id)`, `balanceOf(a, id)`, `LOCK_WINDOW()`.
- `ICapitalMarket` (for MerchantPay): `onPayment(merchant, invoiceId, gross, net, paymentId) → toInvestors`, `hasClaimsOn(merchant, invoiceId) view` (MerchantPay skips the market, and its extra transfer, when false), `isFinanced(invoiceId) view`.
Money flow: MerchantPay pulls gross, pays the fee; if `hasClaimsOn` it sends `net` to the market and calls `onPayment` (market pays the invoice's holders first, then the advance lien, then the merchant); otherwise it pays the merchant directly.

## Acceptance criteria
- [ ] Fork tests (pinned block, real USDT): C1 list rules (both kinds) · C2 DvP + ineligible investor reverts · C3 pro-rata push, rounding leftover never exceeds a balance, no dust left, `Settled` · C4 partial invoice payments burn covered units · C5 lien on gross, capped by owed and net, one per merchant, removed at cap · T1 transfer rules (ineligible, locked, frozen claim, partial freeze, 9th holder; revoked still paid) · ERC-7943 views + interface id · M1–M3 green on MerchantPay v2 + new guards + sweep · F1 fuzz (Σ == gross, market balance == Σ owed) · AT-3/4/5 and AT-6/7 as tests with exact numbers.
- [ ] Live: four contracts from a clean commit, **full** Blockscout matches, wired; AT-3/4/5 run live with the demo wallets (investor A's `fundWithAuthorization` and the sales submitted by the deployer, payers at 0 WBT); old MerchantPay `0x83b5…73b7` paused.
- [ ] `packages/shared` regenerated for all four (export script fixed: `forge inspect` + temp file) and announced as the frozen ABI.

## Files
- claude-contracts: `src/interfaces/*.sol`, `src/CapitalMarket.sol`, `src/MerchantPay.sol` (v2), `test/CapitalMarket.t.sol`, `test/MerchantPay*.t.sol` (updated), `script/DeployPhase3.s.sol`, `script/export-abi.sh`, `packages/shared/*`.
- developer subagent (disjoint): `src/InvestorRegistry.sol`, `src/ClaimToken.sol`, `test/ClaimToken.t.sol`.

## Ponytail ladder
- OZ v5.7.0: `ERC1155Supply`, `Ownable2Step`, `ReentrancyGuardTransient`, `SafeERC20.trySafeTransfer` (push fallback), `Math.mulDiv` (ceil cost), `IERC3009`. One active lien per merchant (no lien array until recourse exists); `liensOf` keeps the array shape for the ABI.

## Out of scope
- `markDefault`, `repay`, recourse liens, EAS (FR-KYC-2/3), acknowledgements (FR-PAY-13): Phase 5 / cut list.

## NEEDS THE USER
- PIPELINE §11: four money-moving contracts, deploy + wiring script, the frozen ABI.
