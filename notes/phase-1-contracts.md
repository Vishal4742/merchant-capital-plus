# Phase 1, contracts lane (claude-contracts): rail proof

Batch `001-P1-rail-proof` · branch `contracts` · SRS DEP-1, FR-REL-1 (stub), CON-2/3/4/7 · gate G1 (contracts half).

## What was built
- `contracts/` Foundry project: solc **0.8.38**, `evm_version = "prague"` (Foundry 1.8.6 defaults to osaka, which 1874 rejects), optimizer 200, OpenZeppelin **v5.7.0** (`cab19933`) and forge-std v1.17.0 as submodules, explicit relative remappings.
- `src/PullStub.sol`: pulls USDT with the payer's EIP-3009 `receiveWithAuthorization` and forwards it all to an immutable payee. Throwaway; MerchantPay replaces it in Phase 2.
- `script/RelayPull.s.sol`: deployer deploys, payer signs once, relayer key submits. `receiveDigest()` builds the EIP-712 digest from the token's own domain and typehash (reuse it in Phase 2 tests).
- `test/PullStub.t.sol`: 7 fork tests on 1874 against the real USDT (5 by the builder, 2 by the round-1 tester).

## Verified (with which output)
- `forge test`: 7/7 pass (RED commit `7ab43b5` had 3/5 failing first). Tester's mutation runs: every one of 5 broken stubs fails at least one test; PullStub lines and branches 100% covered.
- Round 1: tester, reviewer-code, reviewer-security, reviewer-ux-ui all PASS; Codex outside opinion: no findings.
- G1 on-chain: PullStub `0x51e2E2A530c9dabe6147D55F9bb7fcD47219325d` (Blockscout verified, partial match); relayed pull `0xc4629df10e9c3d259253ac368448db50d1783465555d3d0aa19de335f31c847e` from the relayer `0xdd02…a651`; payer `0xE53f…309b` 0 WBT and nonce 0 before and after.
- Gas: relayed pull 94,034 live (≈0.00047 WBT ≈ 0.035 USDT); deploy 230,639. `forge --gas-report` rows are isolated txs that include intrinsic gas and exclude refunds (131,034 for the same pull into a fresh payee), so size fees from live receipts or `vm.lastCallGas()`.

## Facts the next phases need
- USDT EIP-712 domain = `{name "Tether USD", version "1", chainId 1874, verifyingContract 0xcedf…55a7}`; recomputed, equals `DOMAIN_SEPARATOR()` `0xcdcfacb6…2a25`. Typehash is standard EIP-3009.
- USDT revert strings: `TetherToken: to != msg.sender` · `TetherToken: auth invalid` (nonce used/cancelled) · `TetherToken: invalid signature` · `TetherToken: auth expired` · `ECRecover: invalid signature` (malformed sig). The relayer's pre-checks can map these to 4xx reasons.
- Verification: `forge verify-contract --verifier blockscout` fails locally ("Missing solc version: 0.8.38"). Working path: `--show-standard-json-input` then `POST /api/v2/smart-contracts/<addr>/verification/via/standard-input`.
- Never run forge scripts with `-vvvv` while keys are in env; pipe live runs through a redaction filter.
- Routed payment gas estimate: 180–200k with no lien, 230–260k with one lien push (≈0.086–0.097 USDT at 74.5 USDT/WBT): measure in Phase 2 before fixing the 0.10 fee. Pin the fork block for gas tests (they run at the latest block now, so numbers drift by a few gas).
- Phase 2 MerchantPay inputs from round 1: use OZ v5.7.0 `interfaces/draft-IERC3009.sol` (`IERC3009`) and `MessageHashUtils.toTypedDataHash` instead of hand-written copies (don't edit the deployed PullStub.sol); add a test pinning the USDT domain fields the web/relayer lanes hard-code (the token has no `version()` or `eip712Domain()`); decide on a sweep for USDT sent straight to the contract; payers with code are checked via ERC-1271 by the token, so off-chain pre-checks should trust the simulation; deploy only from a clean, committed tree.
- Relayer drain (reviewer-security S1, owner claude-relayer): through the stub, ~1,060 one-unit pulls could burn the relayer's 0.5 WBT for ≈0.001 USDT. The relayer must stay localhost-only until the 1 USDT minimum, fee, rate limits and daily budget exist (FR-REL-4/5/6).

## Decisions
- Relayer swapped 1.5 WBT → 111.72 USDT to the team wallet (human 20:44); new scripted payer key `PAYER_PRIVATE_KEY` in `.env`.
- `apps/relayer/` moved to the claude-relayer lane (human 20:57); this lane keeps `contracts/` and `packages/shared/`.

## Open issues
- Deployed stub stays partially verified (resubmitting would publish a local path); fixed for Phase 2 contracts in `4f9c0b0`.
- Stub nonce is caller-chosen (any authorization naming the stub can be redeemed by anyone until `validBefore`, always to the team wallet). By design; FR-PAY-6 removes it in MerchantPay.
