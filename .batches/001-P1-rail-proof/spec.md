# Spec: 001-P1-rail-proof

## Requirements (cite docs/SRS.md IDs)
- **DEP-1**: prize USDT `receiveWithAuthorization` works when the payee is the calling contract, and anyone else calling it with `to = our contract` reverts (front-run safety).
- **FR-REL-1 (stub only)**: a relayer key submits a payer's signed authorization and gets the tx hash. Phase 1 stub = a forge script signed by `RELAYER_PRIVATE_KEY`; the HTTP relayer is Phase 2.
- **CON-2** prize USDT `0xcedf…55a7` only · **CON-4** payer signs a message, never a gas-costing tx · **CON-7** keys only in `.env` · **CON-3** (rehearsal) first Blockscout verification of our bytecode.
- ARCHITECTURE.md §9 open item 2: measure gas of a relayed pull.
- Gate **G1** (contracts half): explorer link of a relayed USDT pull where the payer holds 0 WBT.

## Acceptance criteria (each must be checkable)
- [ ] `contracts/foundry.toml` sets `evm_version = "prague"` and `solc_version = "0.8.38"`; `forge config --json` shows both; OpenZeppelin **v5.7.0** at `contracts/lib/openzeppelin-contracts` (git tag); `forge build` passes with no warnings in `src/`.
- [ ] Fork test on chain 1874 (real USDT): a payer with **0 WBT** signs `ReceiveWithAuthorization(to = PullStub)`; a different address (relayer) calls `PullStub.pull`; payee balance +value, payer −value, payer native balance stays 0, `authorizationState(payer, nonce) == true`.
- [ ] Fork test: replaying the same authorization reverts.
- [ ] Fork test: calling `USDT.receiveWithAuthorization` directly with `to = PullStub` from another address reverts (DEP-1 front-run safety).
- [ ] Fork test: an authorization signed by the wrong key reverts.
- [ ] Live: `PullStub` deployed by the deployer key on 1874 and **verified on Blockscout** (link).
- [ ] Live, **G1**: one `pull` tx sent from the relayer `0xdd02…a651`; the payer holds 0 WBT before and after (cast output); explorer link in `build-contracts.md`.
- [ ] Gas: `gasUsed` of the live pull tx and `forge test --gas-report` numbers recorded, with the estimate for a full routed payment updated.

## Files to touch (owner lane: claude-contracts only)
- `contracts/foundry.toml`, `contracts/src/PullStub.sol`, `contracts/test/PullStub.t.sol`, `contracts/script/RelayPull.s.sol`
- `contracts/lib/forge-std`, `contracts/lib/openzeppelin-contracts` (git submodules) and root `.gitmodules` (claimed on agentbus; no other lane uses submodules)
- `.batches/001-P1-rail-proof/*`, `notes/phase-1-contracts.md`

## Ponytail ladder (why this is the smallest change that works)
- Needed at all? Yes: G1 and DEP-1 must pass before Phase 2 builds on them.
- Already in repo? No contracts yet.
- Stdlib / installed dependency? OZ `SafeERC20` for the forward transfer (OZ v5.7.0 is the pinned lane dependency anyway). The EIP-712 digest uses the token's own `DOMAIN_SEPARATOR()` and `RECEIVE_WITH_AUTHORIZATION_TYPEHASH()` (read on-chain 20:42: typehash `0xd099cc98…3de8` = standard EIP-3009), so no hand-built domain.
- Minimum code: one ~20-line contract that pulls with `receiveWithAuthorization` and forwards everything to an immutable payee (no funds stay in it); one forge script that signs as the payer and broadcasts as the relayer. `ponytail:` stub, replaced by `MerchantPay` in Phase 2.

## Out of scope
- `MerchantPay`, on-chain nonce recomputation (FR-PAY-6), relay fee and minimum (FR-REL-4), the HTTP relayer and drain guards (FR-REL-2/3/5/6), `packages/shared` ABI, seed script (CON-8): all Phase 2.
- Anon-RPC private read (G1's other half): claude-frontend.

## Live-run plan (NEEDS THE USER before any live tx)
1. Swap (relayer holds 2 WBT, cap 0.5): relayer calls YetiTrade SwapRouter02 `0xe208…6962` `exactInputSingle{value: 1.5 WBT}(WWBT 0x4200…0006 → USDT, fee 3000, recipient = team wallet 0xb4E7…714D, minOut = QuoterV2 quote − 1%)`. Quote at 20:42: 1.5 WBT → 111.152668 USDT (minOut 110.04). Relayer ends at ≈0.5 WBT, team wallet gains ≈111 USDT float.
2. New G1 payer wallet: generate a key straight into `.env` as `PAYER_PRIVATE_KEY` (only the address is printed). Team wallet sends it 2 USDT; it never receives WBT.
3. Deployer deploys + verifies `PullStub(usdt, payee = team wallet)`; relayer submits `pull` for 1 USDT signed by the payer. USDT returns to the team wallet.
