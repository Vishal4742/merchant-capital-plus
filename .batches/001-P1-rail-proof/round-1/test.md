VERDICT: PASS

# Test: 001-P1-rail-proof, round 1 (tester, 2026-11-05 21:27 IST)

Repo: `/Users/vg890/ethglobal-contracts` (worktree, branch `contracts`, HEAD `4f9c0b0`). Diff tested: `git diff d22cc48..HEAD -- contracts .gitmodules` (10 files), plus the tests I added (uncommitted, below). Foundry 1.8.6 (`6bad0a66`). On-chain checks were read-only `cast` calls to https://rpc.ankr.com/whitechain_testnet (`cast chain-id` → `1874`) and the Blockscout v2 API. I sent no transactions, ran no `forge script`, used no key and did not read `.env`.

**No UI in this batch.** No pages changed, so there was no browser walk and there is no `shots/` folder.
**AT-\*:** spec.md cites none (G1 is a gate; AT-1 to AT-10 come in later phases). The 8 acceptance criteria are below.

## Acceptance criteria

| # | Criterion | Result | Proof (exact output) |
|---|---|---|---|
| 1 | prague + solc 0.8.38, OZ v5.7.0 tag, clean build | **PASS** | `forge config --json` → `solc: '0.8.38'` (forge prints the `solc_version` key as `solc`), `evm_version: 'prague'`, `optimizer: True`, `optimizer_runs: 200`, `auto_detect_remappings: False` (foundry.toml:5,7,12). `git -C contracts/lib/openzeppelin-contracts describe --tags --exact-match HEAD` → `v5.7.0`, HEAD `cab19933c33c2ad1d4c7a84864a3601dddfd16f3`; `git ls-remote …/OpenZeppelin/openzeppelin-contracts refs/tags/v5.7.0` → `cab19933c33c2ad1d4c7a84864a3601dddfd16f3 refs/tags/v5.7.0`. forge-std `v1.17.0` = `f3dae6e6…` locally and upstream. `forge build --force` → `Compiling 31 files with Solc 0.8.38` / `Compiler run successful!`, exit 0, no warnings (same after my test additions). `forge lint` → no output, exit 0. `forge fmt --check` on the 3 .sol files → exit 0 |
| 2 | Fork: 0-WBT payer signs, relayer pulls, balances + nonce used | **PASS** | `forge test -vv --match-path test/PullStub.t.sol` → `[PASS] test_RelayerPullsForPayerWithNoGasToken() (gas: 263978)` (PullStub.t.sol:66). Asserts payer −1 USDT, payee +1 USDT, stub 0, `payer.balance == 0` before and after, `authorizationState == true`; caller is `relayer` (≠ payer). Mutants M2/M3 below make it fail |
| 3 | Fork: replay reverts | **PASS** | `[PASS] test_RevertWhen_AuthorizationIsReplayed() (gas: 202277)` (:81), exact `TetherToken: auth invalid`; payer is funded 2× so the revert isn't low balance. Mutant M4 makes it fail |
| 4 | Fork: third party calls `USDT.receiveWithAuthorization(to = stub)` → reverts | **PASS** | `[PASS] test_RevertWhen_ThirdPartyCallsTokenDirectly() (gas: 84340)` (:89), exact `TetherToken: to != msg.sender`. Cross-checked in the verified token source (impl `0x26425662D126412128967ECf0a02EC48573026F7` TetherTokenV2, `EIP3009.sol`): both `receiveWithAuthorization` overloads (v,r,s and `bytes`) go through `_receiveWithAuthorizationValidityCheck`, whose first line is `require(to == msg.sender, …)`. Extra test added for the other entry point (below) |
| 5 | Fork: wrong signer reverts | **PASS** | `[PASS] test_RevertWhen_SignedByAnotherKey() (gas: 102892)` (:96), exact `TetherToken: invalid signature`. Mutant M4 makes it fail |
| 6 | Live: deployed by the deployer, verified on Blockscout | **PASS** (partial match, NEEDS THE USER 2) | `cast receipt 0x162fe5c83654f93e59bdfc5ea46405b9b554861468666cfd0427ccc06a2dbc95` → `contractAddress 0x51e2E2A530c9dabe6147D55F9bb7fcD47219325d`, `from 0xb4E7eDe967E108858DDb5d88B25FDc70723B714D` (the deployer, HANDOFF.md:35), `status 1 (success)`, `gasUsed 230639`, block 12296647. `cast call <stub> usdt()` → `0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7`, `payee()` → `0xb4E7…714D`. `GET /api/v2/smart-contracts/0x51e2…325d` → `is_verified: True`, `is_fully_verified: False`, `is_partially_verified: True`, `name 'PullStub'`, `v0.8.38+commit.1835d247`, `prague`, optimizer 200, `verified_at 2026-11-05T15:38:36Z`; no `/Users/` string in the published sources or settings. https://explorer.testnet.whitechain.io/address/0x51e2E2A530c9dabe6147D55F9bb7fcD47219325d → HTTP 200. Builder's root cause checked: on-chain runtime vs `out/PullStub.sol/PullStub.json` at HEAD, immutables masked and CBOR stripped → **identical**, only the CBOR metadata tail differs; HEAD metadata remappings are `[':@openzeppelin/contracts/=lib/…', ':forge-std/=lib/forge-std/src/']`, no absolute path |
| 7 | Live G1: one relayer pull, payer 0 WBT before and after, link | **PASS** | `cast receipt 0xc4629df10e9c3d259253ac368448db50d1783465555d3d0aa19de335f31c847e` → `from 0xdd02FE971Ad9e21365673E701693e7ab7bF9a651` (relayer, HANDOFF.md:35), `to 0x51e2…325d`, `status 1 (success)`, `gasUsed 94034`, block 12296651; logs: `AuthorizationUsed(0xe53f…309b, 0x4a7c8e0b…cd89)`, `Transfer` payer→stub `0xf4240`, `Transfer` stub→`0xb4e7…714d` `0xf4240` (topic0s equal `cast keccak` of both events). Calldata decodes to `pull(0xE53fBc545e9b72f315699e3295a8A300c192309b, 1000000, 0, 1793893895, 0x4a7c…cd89, 27, r, s)`. Payer per block, see the table below. `cast code <payer>` → `0x` (no EIP-7702 delegation). Blockscout coin-balance-history for the payer: 0 entries. `authorizationState(payer, 0x4a7c…cd89)` → `true`. Link at build-contracts.md:17 |
| 8 | Gas: live gasUsed, `--gas-report`, routed estimate updated | **PASS** (OPEN 2) | Live `gasUsed 94034`; Blockscout fee `470170000100265` wei = 94,034 × 5,000,000,001 + L1 fee 6,231. `forge test --gas-report` → `pull │ min 39820 │ avg 88262 │ median 91098 │ max 131034 │ 4 calls` (deployment row shows 0 because setUp deploys; live deploy 230,639). build-contracts.md:24-30 records 94,034 live, 131,042 fork (the max; forking at latest drifts 8 gas) and the new estimate 180–200k, 230–260k with a lien. The sums check: 94k + 30k + 45–66k + 10k = 179–200k; 230–260k × 5 gwei × 74.5 USDT/WBT = 0.086–0.097 USDT |

**Payer `0xE53f…309b` (AC 7, CON-4):**

| Block | WBT (wei) | nonce | USDT units | stub USDT | team USDT |
|---|---|---|---|---|---|
| 12296650 (before G1) | 0 | 0 | 2000000 | 0 | 109721542 |
| 12296651 (G1 pull) | 0 | 0 | 1000000 | 0 | 110721542 |
| latest (≥12297249) | 0 | 0 | 0 | 0 | 111721542 |

Payer USDT is 0 at latest because claude-relayer sent the expected second pull: tx `0x9f5efc7504e52eb0b4b4bdecfdbf66b896ef3572864f44cb1041f965be5ee000`, block 12296944, from the relayer to the stub, `pull(0xE53f…309b, 1000000, …)`, `status 1`, 91,164 gas; at that block the payer still had 0 WBT and nonce 0.

## Other checks
- **CON-7:** keys are read only through `vm.envUint` (RelayPull.s.sol:29-31). `.env` is ignored (`.gitignore:29`) and untracked. The committed `contracts/broadcast/RelayPull.s.sol/1874/run-latest.json` holds 14 32-byte values; 13 appear verbatim in the on-chain tx and receipt data, and its tx inputs match the chain byte for byte. The 14th is `recovery_generation`, which Foundry sets with `B256::random()` (foundry-rs/foundry `crates/script/src/recovery.rs:153,216`), so it is not key material. The batch diff contains no `/Users/` string. Dry-run copies are ignored (contracts/.gitignore:2); the dry-run's authorization naming the live stub expired at 15:50:01 UTC (21:20 IST), so OPEN 3 in build-contracts.md is closed in practice.
- **CON-2:** `stub.usdt()` is the prize USDT.
- **RED commit `7ab43b5`** rerun from `git archive` in a scratch folder: `3 failed; 2 passed` (`payer paid: 2000000 != 1000000`, twice `next call did not revert as expected`), matching build-contracts.md.
- **Coverage** (scratch copy, `forge coverage --no-match-coverage lib/`): `src/PullStub.sol | 100.00% (7/7) | 100.00% (5/5) | 100.00% (2/2) | 100.00% (2/2)`. The constructor's revert branch had no test before `test_RevertWhen_PayeeIsZero`.
- `forge build --force` rewrote the ignored `contracts/out/` and `contracts/cache/` (same compiler and settings).

## Tests added (contracts/test/PullStub.t.sol, +30 lines, not committed)
- `:10` `interface ITransferWithAuthorization`: the token's other EIP-3009 entry point.
- `:105` `test_RevertWhen_SignatureReusedForTransferWithAuthorization`: a copied ReceiveWithAuthorization signature sent to `transferWithAuthorization`, which has no caller check, reverts with `TetherToken: invalid signature`. So nobody can push the payer's USDT into the stub outside `pull`, where it would be stuck. Supports the "can't be redeemed anywhere else" claim at PullStub.sol:28-29.
- `:113` `test_RevertWhen_PayeeIsZero`: `new PullStub(USDT, address(0))` reverts with `PullStub: zero payee` (PullStub.sol:38).
- Run: `Suite result: ok. 7 passed; 0 failed; 0 skipped; finished in 6.55s`, exit 0.

**Mutation check:** run on a scratch copy outside the repo (`contracts/src` untouched). Each mutant must make at least one test fail:

| Mutant | Failing tests |
|---|---|
| M1 remove the zero-payee `require` (PullStub.sol:38) | `test_RevertWhen_PayeeIsZero` |
| M2 remove the `safeTransfer` to the payee (:54) | `test_RelayerPullsForPayerWithNoGasToken` |
| M3 forward to `msg.sender` instead of `payee` (:54) | `test_RelayerPullsForPayerWithNoGasToken` |
| M4 `try … catch {}` around the token call (:53) | `test_RevertWhen_AuthorizationIsReplayed`, `test_RevertWhen_SignedByAnotherKey` |
| M5 receive signature also valid as a transfer (typehash mocked to TransferWithAuthorization) | `test_RevertWhen_SignatureReusedForTransferWithAuthorization` |

All 5 caught. The token-property tests (`:57` typehash, `:89` caller check) pass on the empty RED skeleton by design. They pin DEP-1 behaviour of the token, not of PullStub.

## DONE
- All 8 acceptance criteria PASS with the outputs above (contracts/foundry.toml:5-16, contracts/src/PullStub.sol:37-55, contracts/test/PullStub.t.sol:57-116, contracts/script/RelayPull.s.sol:28-45; live txs `0x162fe5c8…dbc95`, `0xc4629df1…c847e`).
- Added 2 fork tests; all 7 pass; 5/5 mutants caught; PullStub.sol at 100% line and branch coverage.

## OPEN
1. **LOW · claude-contracts:** commit my two tests with this batch (contracts/test/PullStub.t.sol:9-22, :103-116). They are only in the working tree. If round 2 edits this file, keep them.
2. **LOW · claude-contracts → claude-research:** ARCHITECTURE.md:156 (§9 item 2) still says "estimate 200–250k" and ARCHITECTURE.md:99 says "gas per payment ~200–250k". Send claude-research the measured 94,034 and the 180–260k estimate (shared doc, PIPELINE §3).
3. **LOW · claude-contracts:** the fork tests run at the latest block (PullStub.t.sol:40) and fund the payer from `HOLDER` (:27, 589,653 USDT now). Gas drifts run to run (131,042 vs 131,034) and every test needs the public RPC. Pin a fork block when Phase 2 measures gas to set the fee; ci needs network access for this suite.
4. **INFO · claude-contracts:** at `info` severity `forge lint` gives 5 notes: PullStub.sol:34,35 immutables not SCREAMING_SNAKE_CASE, :38 `require` string instead of a custom error, :8/:31 two contracts in one file. Default severities (high/med/low) are clean. Leave them for the throwaway stub; apply to MerchantPay.
5. **INFO · reviewer-security:** USDT sent to the stub by a plain `transfer` stays there forever because PullStub has no sweep (PullStub.sol:31-56). The stub holds 0 now and this is by design for a stub. MerchantPay shouldn't inherit it.

## NEEDS THE USER
1. **PIPELINE §11 flags:** PullStub moves money (PullStub.sol:53-54); RelayPull.s.sol deploys and signs with three `.env` keys (:29-31); new dependencies OZ v5.7.0 and forge-std as submodules (`.gitmodules`, `contracts/foundry.lock`). Everything above passes; the human still signs off.
2. **Partial Blockscout match:** accept it as "verified" for AC 6 / CON-3 rehearsal on the throwaway stub `0x51e2…325d`. The runtime code matches; only the metadata hash differs; the cause was fixed in `4f9c0b0`. Proposal: Phase 2 deploys must show `is_fully_verified: true`.
