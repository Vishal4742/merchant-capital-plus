STATUS: READY

# Build: 001-P1-rail-proof (claude-contracts, round 1)

Repo root: `/Users/vg890/ethglobal-contracts` (git worktree, branch `contracts`). Foundry: `~/.foundry/bin` (1.8.6, not on PATH).
Commits: `6de9e62` build (Foundry, OZ v5.7.0) · `7ab43b5` test RED (3/5 failing) · `8710439` feat GREEN · `4f9c0b0` fix (explicit remappings) · `a443d9f` two tests added by the round-1 tester (7/7 pass).

## DONE (file:line, what, how verified)
| Acceptance criterion | Evidence |
|---|---|
| foundry.toml prague + solc 0.8.38, OZ v5.7.0, clean build | `contracts/foundry.toml:5-7`; `forge config --json` → `solc 0.8.38, evm_version prague, optimizer true/200`; OZ submodule at tag v5.7.0 = `cab19933c33c2ad1d4c7a84864a3601dddfd16f3` (same commit as research_notes/build_prep/contracts_prep.md §2), forge-std v1.17.0 `f3dae6e6`, both in `contracts/foundry.lock`; `forge build --force` 0 warnings; `forge lint` clean |
| Fork: payer with 0 WBT signs, relayer submits, payee paid, payer still 0 WBT, nonce used | `contracts/test/PullStub.t.sol:66` `test_RelayerPullsForPayerWithNoGasToken` PASS (real USDT on a 1874 fork) |
| Fork: replay reverts | `PullStub.t.sol:81` PASS, exact `"TetherToken: auth invalid"` (string pinned from a used nonce on-chain before writing the test) |
| Fork: third party calling `USDT.receiveWithAuthorization(to = stub)` reverts | `PullStub.t.sol:89` PASS, exact `"TetherToken: to != msg.sender"`; also `:105` (tester): the same signature sent to `transferWithAuthorization` (no caller check) reverts `"TetherToken: invalid signature"` |
| Fork: wrong signer reverts | `PullStub.t.sol:96` PASS, exact `"TetherToken: invalid signature"` |
| Live: deployed by the deployer and verified | `PullStub` [`0x51e2E2A530c9dabe6147D55F9bb7fcD47219325d`](https://explorer.testnet.whitechain.io/address/0x51e2E2A530c9dabe6147D55F9bb7fcD47219325d), deploy tx `0x162fe5c83654f93e59bdfc5ea46405b9b554861468666cfd0427ccc06a2dbc95` from `0xb4E7…714D`, 230,639 gas. Blockscout API: `is_verified: true`, `v0.8.38+commit.1835d247`, `prague`, optimizer 200 (**partial** match, see OPEN 1) |
| **Live G1: relayed pull, payer 0 WBT** | [`0xc4629df10e9c3d259253ac368448db50d1783465555d3d0aa19de335f31c847e`](https://explorer.testnet.whitechain.io/tx/0xc4629df10e9c3d259253ac368448db50d1783465555d3d0aa19de335f31c847e), block 12,296,651, `from 0xdd02fe971ad9e21365673e701693e7ab7bf9a651` (relayer), status 1. Logs: USDT `AuthorizationUsed`, `Transfer` payer→stub, `Transfer` stub→payee. Payer `0xE53f…309b` before: 0 WBT / 2 USDT / nonce 0; after: **0 WBT / 1 USDT / nonce 0** (never sent a tx). Stub after: 0 USDT. Team wallet +1 USDT |
| Gas recorded | See "Gas" below |

Also checked: the USDT EIP-712 domain recomputed from `{name "Tether USD", version "1", chainId 1874, verifyingContract USDT}` equals on-chain `DOMAIN_SEPARATOR()` `0xcdcfacb6…2a25`, so viem `signTypedData` in the web and relayer lanes will match (told claude-relayer). On-chain `RECEIVE_WITH_AUTHORIZATION_TYPEHASH` is the standard EIP-3009 hash (`PullStub.t.sol:57`).

Secrets: the live run was piped through a redaction filter; every file under `contracts/broadcast/` and `contracts/cache/` was checked in-process against the 12 `.env` secret values: all clean. Only the live `run-latest.json` is committed (`contracts/.gitignore` drops dry-run copies, timestamped duplicates and locks).

## Gas (measured, chain 1874, 5.000000001 gwei, L1 fee 6,231 wei)
| What | Gas | WBT | ≈ USDT at the pool (74.5 USDT/WBT, swap 20:48) |
|---|---|---|---|
| Relayed pull, live (3009 pull + 1 USDT transfer to an existing holder, incl. 21k intrinsic) | **94,034** | 0.00047 | 0.035 |
| `forge test --gas-report` row for `pull` into a fresh payee: an isolated tx, so it **includes** the 21k intrinsic and is counted **before** refunds (corrected per reviewer-code F1) | 131,034–131,042 | | |
| PullStub deploy | 230,639 | 0.00115 | 0.086 |
Reconciled (reviewer-code): 131,034 = 94,034 live + 17,100 (fresh payee slot) + 19,900 (refund for the stub's 0→1→0 balance, not applied in the report). Size fees from live receipts or isolated `vm.lastCallGas()` (94,054 here), never from raw gas-report rows, which overstate by 20–43k.
Routed payment estimate (ARCHITECTURE §9 item 2), **updated, still an estimate**, built on the 94k live receipt: 94k measured + fee transfer (~30k) + payment record for refunds (2–3 new slots, ~45–66k) + `onPayment` with no lien (~10k) ≈ **180–200k**; with one advance lien push + burn ≈ **230–260k**, i.e. ≈0.086–0.097 USDT of gas, just under the 0.10 USDT fee. Payouts to many holders would exceed it. Measure with `forge test --gas-report` in Phase 2 before fixing the fee.

## OPEN (issue, proposed fix)
1. **Partial verification, cause found and fixed for Phase 2.** Auto-detected remappings put an absolute local path (`/Users/vg890/ethglobal-contracts/contracts/lib/openzeppelin-contracts/:forge-std/=…`, from OZ's nested remappings.txt) into the build metadata, so no verification input can fully match and a local username would be published. `4f9c0b0` sets `auto_detect_remappings = false` + two relative remappings; after it, build metadata remappings == verification input remappings, no absolute paths (checked). The deployed stub keeps its partial match (throwaway; resubmitting would publish the local path). Note: the live stub's bytecode differs from a rebuild at HEAD only in the CBOR metadata hash; runtime code is identical (on-chain tail == local tail before the fix).
2. **`forge verify-contract --verifier blockscout` fails with "Missing solc version: 0.8.38"** (a forge-side error string, also with `--compiler-version 0.8.38+commit.1835d247`), although Blockscout lists `v0.8.38+commit.1835d247`. Working path used: `forge verify-contract … --show-standard-json-input` → `POST https://explorer.testnet.whitechain.io/api/v2/smart-contracts/<addr>/verification/via/standard-input` (multipart: `compiler_version`, `contract_name`, `license_type`, `constructor_args`, `files[0]`). Phase 2: wrap that in the deploy step, or retry forge after a foundryup. Friction sent to claude-research for WHITECHAIN_FEEDBACK.md.
3. Known stub limit (by design, Phase 2 fixes it with FR-PAY-6): the nonce is caller-chosen, so any authorization naming the stub can be redeemed by anyone until `validBefore`, always to the fixed payee. Seen live: the dry-run signed an authorization for the same CREATE address (deployer nonce unchanged), valid until ≈21:20 and redeemable after the real deploy (money would still go to the team wallet). This is the case MerchantPay's invoice/order-bound nonce removes. (Expired 21:20:01 IST unused, per tester and reviewer-security.)
4. Broadcast record says `"commit": "7ab43b5"` (`contracts/broadcast/RelayPull.s.sol/1874/run-latest.json:146`, the RED skeleton) because the deploy ran from the uncommitted GREEN tree, committed right after as `8710439`. `src/` is unchanged since (`git diff 8710439 HEAD -- contracts/src` is empty) and the runtime code matches on-chain (tester, reviewer-security). Rule from Phase 2: deploy only from a clean, committed tree (reviewer-code F3).

## NEEDS THE USER
- PIPELINE §11 flags: contract code that moves money (PullStub), a deploy script using three `.env` keys (RelayPull), a new dependency (OZ v5.7.0 + forge-std as submodules, root `.gitmodules`).
- Lane change acknowledged (human 20:57): `apps/relayer/` is now claude-relayer's; claude-relayer will send a second 1 USDT pull through this stub via its `/relay` (agreed on agentbus 21:09).
