# Spec: 002-P2-merchantpay

## Requirements (cite docs/SRS.md IDs)
- **FR-PAY-1** merchant creates an invoice (customer, amount, due date, reference) · **FR-PAY-2** merchant cancels an unpaid invoice · **FR-PAY-3** customer pays an invoice with one signature, relayer submits · **FR-PAY-5** customer pays a checkout sale with one signature · **FR-PAY-6** each payment bound to its invoice/order by a nonce the contract recomputes; a signature can't pay anything else · **FR-PAY-8** merchant refunds all or part from its own wallet, never from investors.
- **FR-REL-4** relay fee 0.10 USDT inside the payment (contract cap 0.25), minimum payment 1 USDT · **FR-REL-7** pay functions are permissionless · **FR-REL-9** owner can pause.
- **NFR-1** checks-effects-interactions + reentrancy guard · **NFR-2** `fee + toMerchant (+ toInvestors) == gross`, MerchantPay keeps no USDT · **CON-2** prize USDT only · **CON-3** deployed and **fully** verified (human rule 21:52: full Blockscout match from Phase 2) · **CON-4** payer never signs a gas-costing tx · ARCHITECTURE §9 item 2: measure a routed payment's gas.
- Supports gate **G2** (AT-1 gasless sale, AT-2 refund); the relayer (claude-relayer) and pages (claude-frontend) finish those ATs on top of this contract.

## Interface (ARCHITECTURE.md §2 MerchantPay, with these decisions)
```
constants  KIND_INVOICE = 1, KIND_SALE = 2 (uint8), MIN_PAYMENT = 1_000_000, MAX_FEE = 250_000
constructor(IERC20 usdt, address feeRecipient)        owner = deployer, relayFee = 100_000
createInvoice(address customer, uint128 amount, uint64 dueDate, bytes32 refHash) → uint256 id     (merchant = msg.sender)
cancelInvoice(uint256 id)                                                                         (that invoice's merchant)
payInvoice(uint256 id, address from, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 salt, uint8 v, bytes32 r, bytes32 s) → uint256 paymentId
paySale(address merchant, bytes32 orderRef, address from, uint256 amount, uint256 validAfter, uint256 validBefore, bytes32 salt, uint8 v, bytes32 r, bytes32 s) → uint256 paymentId
refund(uint256 paymentId, uint256 amount)                                                         (that payment's merchant)
setRelayFee(uint256 fee, address recipient) · pause() · unpause()                                 (owner)
views      invoices(id) · payments(id) · saleOf(merchant, orderRef) → paymentId (0 = unpaid) · saleNonce(merchant, orderRef, amount, salt) · invoiceNonce(id, amount, salt) · relayFee · feeRecipient · paused
events     InvoiceCreated · InvoiceCancelled · Paid · Refunded · RelayFeeSet, exactly as ARCHITECTURE §2 (+ OZ Paused/Unpaused/OwnershipTransferred)
nonce      keccak256(abi.encode(block.chainid, address(this), uint8 kind, uint256 ref, bytes32 orderRef, uint256 amount, bytes32 salt))
           sale: ref = uint256(uint160(merchant)); invoice: ref = id, orderRef = 0. Sent to claude-frontend + claude-relayer 22:55.
```
Pinned after plan review (these are ABI too): `invoices(id) → (address merchant, uint64 dueDate, uint8 status [0 None, 1 Open, 2 Paid, 3 Cancelled], address customer, uint128 amount, uint128 paid)`; `payments(id) → (address merchant, uint96 gross, address payer, uint96 refunded)`; errors `ZeroAddress, WrongAmount, InvalidDueDate, InvoiceNotOpen, NotMerchant, InvalidOrder, OrderPaid, FeeTooHigh, RefundTooLarge`; invoice and payment ids start at 1, so `Paid.invoiceId == 0` means a sale and `saleOf == 0` means unpaid. Constructor `(usdt, feeRecipient)` differs from ARCHITECTURE §2's `MerchantPay(usdt)`: claude-research updates §2. `via_ir = true` (the 10-argument `paySale` is stack-too-deep under legacy codegen; keeps the ABI). A shop or relayer counts an order as paid only if `payments(saleOf(merchant, orderRef)).gross` equals the session amount (a stranger paying a guessable orderRef first only gifts the merchant ≥ 1 USDT). A full refund returns the gross, so the merchant bears the 0.10 fee; the first refund needs `approve` first.
Rules: invoice `amount ≥ MIN_PAYMENT`, `dueDate > now`; `customer` is informational (the payer is often a fresh guest wallet), so anyone may pay an invoice, the nonce binds it. Phase 2 `payInvoice` takes exactly what is still owed (partial payments: FR-INV-4, Phase 4, same signature). `paySale`: `merchant ≠ 0`, `orderRef ≠ 0`, **an order is paid once** (frontend security review S5; implements FR-PAY-6 against retries with a new salt). Fee = current `relayFee`, sent to `feeRecipient`; rest to the merchant in the same tx. `refund`: cumulative ≤ gross, `transferFrom(merchant → payer)` (merchant approves once), allowed while paused. Pause stops `payInvoice`/`paySale` only.

## Acceptance criteria (each must be checkable)
- [ ] **M1** (fork tests, real USDT): `payInvoice` pays merchant `gross − fee` and fee recipient `fee` in one tx from a payer with 0 WBT, submitted by a third party; the signature can't pay another invoice id or another amount; replay reverts; a third party can't redeem it on the token directly (`to != msg.sender`); paid/cancelled/unknown invoices and partial/over-payments revert.
- [ ] **M2**: `paySale` same split; 0.99 USDT reverts (minimum); a sale signature can't pay another merchant or orderRef; the same order can't be paid twice (new salt); `setRelayFee` above 0.25 USDT or by a non-owner reverts; paused → pay reverts, unpause → pays.
- [ ] **M3**: `refund` only by that payment's merchant; partial then full; cumulative above gross reverts; works while paused; payer gets the USDT; nothing else moves.
- [ ] **Fuzz (F1, Phase 2 part)**: for any `amount ≥ MIN_PAYMENT` and `fee ≤ MAX_FEE`: `fee + toMerchant == gross` and MerchantPay's USDT balance is 0 after every pay and refund.
- [ ] **Domain pin (review F5)**: USDT `DOMAIN_SEPARATOR()` == keccak of `{name "Tether USD", version "1", chainId 1874, verifyingContract USDT}`; `saleNonce`/`invoiceNonce` equal the documented `abi.encode` formula.
- [ ] `vm.expectEmit` on every event with exact arguments; `forge build` 0 warnings, `forge lint` clean, `forge fmt --check`; `forge coverage --ir-minimum --report summary`: `src/MerchantPay.sol` lines ≥ 95% (branch maps under ir-minimum are approximate; every revert has its own test).
- [ ] **Live (1874)**: `git status --porcelain contracts` empty right before the broadcast and `jq -r .commit contracts/broadcast/DeployMerchantPay.s.sol/1874/run-latest.json` names a commit containing the deployed source; `grep -c /Users/ in.json` = 0 on the verification input; `curl -s https://explorer.testnet.whitechain.io/api/v2/smart-contracts/<addr> | jq -e .is_fully_verified` → true; one sale and one refund submitted by the **deployer** key (FR-REL-7: not our relayer; the relayer key is claude-relayer's, human 21:52); `cast balance <payer> --block <saleBlock>` = 0 and `cast nonce <payer>` = 0; `cast receipt <sale> gasUsed` recorded as "paySale, no market call" (the routed-payment gas of ARCHITECTURE §9 item 2 becomes a Phase 3 criterion).
- [ ] **packages/shared**: one generated, dependency-free file `packages/shared/merchantPay.ts` (ABI `as const`, the 1874 addresses, constants, nonce parameter list); `bash contracts/script/export-abi.sh && git diff --exit-code packages/shared` proves it matches the build.

## Files to touch (owner lane: claude-contracts only)
- `contracts/src/MerchantPay.sol`, `contracts/test/MerchantPay.t.sol`, `contracts/script/DeployMerchantPay.s.sol`, `contracts/script/SmokeMerchantPay.s.sol`, `contracts/script/export-abi.sh`
- `packages/shared/merchantPay.ts` (new, generated by `contracts/script/export-abi.sh`)
- `.batches/002-P2-merchantpay/*`, `notes/phase-2-contracts.md`

## Ponytail ladder (why this is the smallest change that works)
- Needed: yes, G2 depends on it. Already in repo: the PullStub pull pattern, the fork-test helpers (re-written with OZ `MessageHashUtils.toTypedDataHash`, review F2).
- Installed dependency (OZ v5.7.0): `IERC3009` (`interfaces/draft-IERC3009.sol`), `SafeERC20`, `Ownable`, `Pausable`, `ReentrancyGuardTransient` (TSTORE works on 1874). No hand-written token interface.
- Minimum: one contract, no proxy, no CapitalMarket hook yet (`toInvestors = 0`; Phase 3 adds `setMarket`/`onPayment` and redeploys before the G3 ABI freeze). `refHash` is emitted, not stored. `ponytail:` comments mark the deferrals.

## Out of scope
- `acknowledge` (FR-PAY-13, Phase 5), `setMarket` + `CapitalMarket.onPayment` (Phase 3), partial invoice payments (FR-INV-4, Phase 4), the seed script (CON-8, next batch 003), relayer wiring and drain guard (claude-relayer), pages (claude-frontend).
- ERC-1271 payers: the token checks them with a `staticcall` (verified source `contracts/Tether/util/SignatureChecker.sol:68`), so they can't re-enter; their gas burn is the relayer's pre-check (drain guard 11).

## NEEDS THE USER
1. `feeRecipient` = the relayer hot wallet `0xdd02…a651` (proposed: the FR-REL-8 swap keeper then swaps fees from its own balance) or the team wallet `0xb4E7…714D`.
2. "An order is paid once" is a spec decision implementing FR-PAY-6 (asked for by the frontend's security review). Trade-off: `orderRef` must be random per checkout session, or a stranger could pay a guessable order first.
3. PIPELINE §11: money-moving contract, deploy script with the deployer key, new shared package.
