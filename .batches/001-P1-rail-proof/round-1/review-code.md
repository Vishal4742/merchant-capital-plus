VERDICT: PASS

# Code review: 001-P1-rail-proof, round 1 (reviewer-code, 2026-11-05 21:43 IST)

Reviewed: `git diff d22cc48..HEAD -- contracts .gitmodules` at HEAD `a443d9f` (10 files; the unfiltered diff is the same 10, so nothing outside the lane's folders was committed), the untracked `notes/phase-1-contracts.md`, and the batch files (spec, batch, build-contracts, round-1 test + outside). I edited no code. Builds and tests ran in a scratch copy made with `git archive HEAD` plus `lib/openzeppelin-contracts/contracts` and `lib/forge-std/src`, outside the worktree, so forge could not load the `.env` symlink. I used no key, sent no tx, ran no `forge script`. On-chain reads were read-only `cast call`s to the public Ankr RPC.

No blocking findings. The contract logic is correct, the batch builds nothing outside the spec and touches no ARCHITECTURE §2 ABI, the tests assert every fork acceptance criterion, and the pins are right. The five findings below are LOW. Three are doc fixes to batch or notes files (not product code), which the orchestrator can make before the commit. The other two are cleanups to carry into the Phase 2 MerchantPay batch. **Do not edit the deployed `PullStub.sol`**: its source has to stay the source verified at `0x51e2…325d`.

## Checks

| # | Check | Result |
|---|---|---|
| 1 | Traces to spec SRS IDs, no scope creep | OK. PullStub + RelayPull → DEP-1, FR-REL-1 stub, CON-2/4/7. `auto_detect_remappings` → CON-3. `optimizer = true` → AC 8 (gas measured = gas deployed). Three files are outside the spec's "Files to touch" list but are tool byproducts inside `contracts/` that trace to ACs: `foundry.lock` (forge install, AC 1), `broadcast/…/run-latest.json` (deploy record, AC 6/7) and `contracts/.gitignore` (keeps dry-run copies out). They add no behaviour. A lane-local `.gitignore` is right because the root one is a shared file |
| 2 | ABI vs ARCHITECTURE.md §2 | Nothing in §2 is built, so there is nothing to mismatch. PullStub is the throwaway stub. Constants match §7: solc 0.8.38, `prague`, OZ v5.7.0, USDT `0xcedf…55a7` |
| 3 | Logic and edge cases | OK. `pull` (PullStub.sol:53-54) redeems with `to = address(this)` and forwards exactly `value` to the immutable payee, and either token call reverting reverts the whole tx. Edge cases: zero payee is guarded (:38) and tested. Zero `usdt_` fails closed (high-level call to a codeless address reverts). `value = 0` is harmless. Replays are rejected by the token and tested. A fee-on-transfer token would revert the forward, and the test asserts exact amounts, so this one has no fee. In RelayPull, `vm.addr` in the constructor args doesn't consume `vm.broadcast` (the live record shows CREATE from the deployer). The second broadcast covers only `pull`. The digest view calls aren't broadcast |
| 4 | Ponytail ladder | One rung-5 miss (F2: OZ v5.7.0 ships `IERC3009`). Otherwise minimal: SafeERC20 reused, `receiveDigest` shared by script and test, no events/state/admin in the stub |
| 5 | Tests assert the ACs | OK. AC 2 → PullStub.t.sol:66-79 (payer −1, payee +1, stub 0, payer WBT 0 before and after, `authorizationState` true, caller = relayer). AC 3 → :81-86. AC 4 → :89-94. AC 5 → :96-101, each with the exact token revert string. AC 1, 6, 7 and 8 are config and live evidence, which the tester checked on-chain |

## Independent verification (scratch copy of HEAD `a443d9f`, Foundry 1.8.6)
- `forge config --json` → `solc 0.8.38`, `evm_version prague`, `optimizer true/200`, `auto_detect_remappings false`, remappings `@openzeppelin/contracts/=lib/openzeppelin-contracts/contracts/`, `forge-std/=lib/forge-std/src/`.
- `forge build --force` → `Compiling 31 files with Solc 0.8.38` / `Compiler run successful!`, no warnings.
- `forge test -vv --gas-report` → `7 passed; 0 failed; 0 skipped`; `pull │ 39820 │ 88265 │ 91104 │ 131034 │ 4`.
- Pins: `git ls-tree HEAD contracts/lib/` → forge-std `f3dae6e6…`, OZ `cab19933…`. `git ls-remote` upstream: `refs/tags/v5.7.0` = `cab19933c33c2ad1d4c7a84864a3601dddfd16f3` (lightweight tag), `refs/tags/v1.17.0` = `f3dae6e6ee381f25eb6a246f7da9b85c91a68219`. Both are the newest stable tags. Submodule trees are clean. `.gitmodules` URLs are the official repos.
- USDT domain: on-chain `DOMAIN_SEPARATOR()` = `0xcdcfacb6…2a25` = recomputed `{"Tether USD", "1", 1874, 0xcedf…55a7}`, as build-contracts.md:20 says. The token has **no** `version()` and **no** EIP-5267 `eip712Domain()` (both revert), so the web and relayer lanes must hard-code name and version (see F5).
- Gas probe (scratch-only test using `vm.lastCallGas()` on the same `pull`; the file stays in my scratchpad, not the repo). Isolated, existing payee: `gasTotalUsed 113954`, `gasRefunded 19900` → **94,054 net vs live 94,034**. Isolated, new payee: `131054` / `19900`. Non-isolated, new payee: `94490`. `--gas-report` forces isolation: `test_RelayerPullsForPayerWithNoGasToken` shows 263,958 with or without `--no-isolate`, against 125,414 non-isolated without the report.

## Findings (all LOW, none blocking)

**F1 · LOW · doc, AC 8 evidence · owner claude-contracts**
- *Where:* `.batches/001-P1-rail-proof/build-contracts.md:28` labels the fork number "131,042" as "(call only, excl. intrinsic)".
- *What:* the label is wrong. The gas-report row is an isolated transaction, so it **includes** the 21k intrinsic gas and calldata, and it is counted **before** the 19,900 refund the stub earns when its balance slot goes 0→1→0. The measured breakdown: 131,034 = 94,034 (live) + 17,100 (new payee balance slot, 0→nonzero vs nonzero→nonzero) + 19,900 (refund not applied).
- *Why:* build-contracts.md:30 and notes:21 say to size the 0.10 USDT fee (FR-REL-4) from `forge test --gas-report` in Phase 2. MerchantPay passes USDT through itself the same way, so gas-report rows overstate the relayer's real cost by about 19.9k per payment. Anyone who also adds 21k "intrinsic" on top overstates it by about 43.5k (≈0.016 USDT at 5 gwei and 74.5 USDT/WBT), which is enough to move the 230–260k estimate (0.086–0.097 USDT) over the 0.10 fee.
- *Fix:* relabel line 28 as "tx incl. intrinsic, before the 19,900 refund; net ≈111.2k with a new payee, ≈94.05k with an existing payee (= live)". Change the method on lines 30 and notes:21 to: size the fee from isolated `vm.lastCallGas()` (`gasTotalUsed − gasRefunded`) or a live receipt, not raw gas-report rows. That method reproduced the live pull within 20 gas.

**F2 · LOW · Ponytail rung 5 (installed dependency) · owner claude-contracts · apply in the Phase 2 MerchantPay batch**
- *Where:* `contracts/src/PullStub.sol:7-23` (`IUSDT3009`) and `contracts/test/PullStub.t.sol:9-22` (`ITransferWithAuthorization`, used at :109).
- *What:* OZ v5.7.0, already pinned, ships `@openzeppelin/contracts/interfaces/draft-IERC3009.sol`. Its `IERC3009` declares `receiveWithAuthorization`, `transferWithAuthorization` and `authorizationState` with the same signatures as the hand-written ones. Likewise `RelayPull.s.sol:18`, `keccak256(abi.encodePacked("\x19\x01", …))`, is OZ `MessageHashUtils.toTypedDataHash(domainSeparator, structHash)`. The spec's ladder (spec.md:28) found SafeERC20 but missed these.
- *Why:* the notes say these pieces get reused in Phase 2 (notes:8). Copying a hand-written interface into MerchantPay is the duplication the ladder exists to stop.
- *Fix:* in MerchantPay and its tests, import `IERC3009` and keep only a two-function extension, `interface IUSDT3009 is IERC3009 { DOMAIN_SEPARATOR(); RECEIVE_WITH_AUTHORIZATION_TYPEHASH(); }`, because those two getters are token-specific. Use `MessageHashUtils.toTypedDataHash` in the digest helper. The test file can drop its 14-line interface now if the builder wants, but leave `PullStub.sol` alone: it is the verified source of the live stub. The "draft-" prefix means OZ may change the file in a minor release, but the pin protects us.

**F3 · LOW · provenance of a committed record · owner claude-contracts**
- *Where:* `contracts/broadcast/RelayPull.s.sol/1874/run-latest.json:146` has `"commit": "7ab43b5"`.
- *What:* the live run happened from the uncommitted GREEN tree, before `8710439` was committed (batch.md:15-16). At `7ab43b5`, `pull` is an empty body and the constructor has no zero-payee check. The deployed initcode does contain `PullStub: zero payee`, so it was built from the `8710439` source.
- *Why:* judges "read the repo and check the deployment" (ARCHITECTURE.md:16). A deployment record pointing at a skeleton that doesn't match the verified source is a needless question mark.
- *Fix:* don't hand-edit the generated JSON. Add one line to build-contracts.md (and later the README evidence): "deployed from the working tree committed as 8710439; runtime identical to HEAD". From Phase 2 on, run deploy scripts only from a clean, committed tree, so the record's `commit` is the deployed source.

**F4 · LOW · stale docs after `a443d9f` · owner claude-contracts**
- *Where:* `notes/phase-1-contracts.md:9` ("5 fork tests") and `:12` ("5/5 pass"). `build-contracts.md:6` (commit list ends at `4f9c0b0`), `:12-15` (test lines :51/:66/:74/:81) and `:20` (`PullStub.t.sol:42`).
- *What:* the tester's commit added 15 lines at the top of the test file and 2 tests. HEAD has 7 tests at PullStub.t.sol:57, 66, 81, 89, 96, 105 and 113.
- *Fix:* update the counts to 7/7, add `a443d9f` to the commit list, and shift the line citations to the HEAD numbers above. This is also tester OPEN 1, now resolved: the tests are committed.

**F5 · LOW · test pin for a cross-lane constant (optional, best in Phase 2) · owner claude-contracts**
- *Where:* `contracts/test/PullStub.t.sol:57-64` pins the typehash but not the domain. build-contracts.md:20 and notes:17 tell claude-relayer and claude-frontend to hard-code `{name "Tether USD", version "1", chainId 1874, verifyingContract USDT}` for viem `signTypedData`.
- *Why:* every signature in this suite is built from the token's own `DOMAIN_SEPARATOR()` (RelayPull.s.sol:18), so no test can catch a domain that differs from what viem will sign. The token exposes neither `version()` nor `eip712Domain()`, so this assertion is the only on-chain check of "version 1". USDT is an EIP-1967 proxy, so an upgrade would surface on the unpinned fork run.
- *Fix:* add one assertion: `USDT.DOMAIN_SEPARATOR() == keccak256(abi.encode(keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"), keccak256("Tether USD"), keccak256("1"), 1874, address(USDT)))`.

## INFO (no action in this batch)
- I agree with tester OPEN 3. Pin the fork block when Phase 2 measures gas: it makes runs deterministic, and Foundry only caches RPC state for pinned blocks, which CI will need.
- Shared docs are now out of date, so send these to claude-research (PIPELINE §3). ARCHITECTURE.md:130 still gives the `forge verify-contract --verifier blockscout` command that fails here (build OPEN 2). ARCHITECTURE.md:99 and :156 still say 200–250k, so they need the measured 94,034 and the F1 method (tester OPEN 2). I found no HANDOFF_LOG entry showing either was sent.
- `PullStub.pull` is now called by claude-relayer's `/relay` (build-contracts.md:39) but is not in §2. When MerchantPay lands, the relayer allowlist (FR-REL-2) must drop it. Owner: claude-relayer.
- `contracts/foundry.toml:2-4,9` set Foundry defaults (`src`, `out`, `libs`, `optimizer_runs = 200`). They are harmless, and `optimizer_runs` documents a verification input, so keep them.

## DONE
- Scope, ABI, logic, ladder and test-to-AC checks above, against spec.md, SRS 1.1 and ARCHITECTURE.md §2/§7.
- Rebuilt and reran HEAD `a443d9f`: 0 warnings, 7/7 pass. Pins checked against upstream. USDT domain recomputed. Gas-report semantics measured (F1).

## OPEN
- F1, F3 and F4 are doc edits to batch or notes files, for the orchestrator to make before the commit. F2 and F5 go into the Phase 2 MerchantPay spec.

## NEEDS THE USER
- Same as tester NEEDS THE USER 1 and 2: PIPELINE §11 flags (money-moving stub, a script using three `.env` keys, new submodule dependencies), and accepting the **partial** Blockscout match as CON-3's rehearsal. Nothing new from this review.
