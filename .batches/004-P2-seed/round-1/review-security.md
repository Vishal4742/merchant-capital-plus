VERDICT: PASS

# Security review: 004-P2-seed, round 1 (reviewer-security)

Scope: `git diff 3db8bad..8579cab -- contracts` (`script/Seed.s.sol`, `test/Seed.t.sol`, `broadcast/Seed.s.sol/1874/reclaim-latest.json`). The lane committed more during this round, and I checked those too: `4be1794` (`test/SeedEdges.t.sol`, tester) and `4c8c64f` (`broadcast/Seed.s.sol/1874/fund-latest.json`, a live `fund()` broadcast). `Seed.s.sol` is byte-identical from `ec9aeea` to `4c8c64f`.
Method: read the code, read the broadcast JSON, ran the secret grep, made read-only `cast` calls on 1874 (https://rpc.ankr.com/whitechain_testnet). I did not run `.env`, any key, or `forge script`.
Not in this batch: product contracts, relayer, web, Arkiv. Payout sums, mint/burn, transfer rules, default/recourse, relayer allowlist and budgets, webhook HMAC and client bundles don't apply.

## Secret grep
`grep -rnE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})' --include='*'` on the five files above:
- `PRIVATE_KEY`: only env-var **names** (`Seed.s.sol:40,44,115-118,124-128`; `SeedEdges.t.sol:125-130`). No values.
- 64-hex hits, sorted by JSON field: `reclaim-latest.json` has tx hash, block hash, log topics/data, logsBloom, calldata `input`, `arguments[]` (nonce, r, s) and `recovery_generation`. `fund-latest.json` has the same fields minus `arguments`.
  - Calldata is public. The broadcast `input` matches `cast tx 0x7fa9…ecf0 input` byte for byte. The reclaim nonce `0x7cda…5f13` has already been used (`authorizationState(PAYER, nonce) = true`), so its v/r/s can't be replayed.
  - `recovery_generation` is a Foundry `ScriptSequence` field: the string sits next to `commit` and `pending` in the forge 1.8.6 binary. It differs on every run (Seed reclaim `0x04c6…`, fund `0x2270…`, RelayPull dry run and broadcast differ again) even though the deployer key stays the same, and batches 001/002 already committed it. It is not a key.
- `.env` and `.env.*` are git-ignored; git tracks only `.env.example`. `run-*.json`, `dry-run/` and `*.lock` are ignored (`contracts/.gitignore:2-4`).
- Test keys come from `makeAddrAndKey(label)`. They are public, label-derived and fork-only.
**Result: no secret in any file.**

## Findings

**LOW-1. `transferWithAuthorization` where `receiveWithAuthorization` would be tighter.** `contracts/script/Seed.s.sol:105-108`. Owner: claude-contracts.
- Exploit sketch: once the reclaim tx is in the mempool, anyone can copy the authorization and submit it first. The money still goes to the team wallet, because the signature binds `to`, value and nonce (proved by `test_RevertWhen_ReclaimSignatureIsRedirected`). The deployer's own tx then reverts with `auth invalid`, so the run reports a failure and wastes a little gas. No funds are lost and none can be redirected.
- Why it is only a nit: here `to == team == msg.sender` (the deployer submits), which is exactly the case `receiveWithAuthorization` was made for. The token supports it (MerchantPay already pulls with it, ARCHITECTURE.md:62).
- Fix (optional): sign `ReceiveWithAuthorization` and call `receiveWithAuthorization`. If you keep it as is, add a `ponytail:` line saying it is front-runnable but cannot be redirected.

**LOW-2. `fund()` loads four private keys only to work out addresses.** `Seed.s.sol:115-118`, `:131-133`. Owner: claude-contracts.
- Exploit sketch: none directly. Foundry redacts `env*` outputs and `vm.addr` arguments at any verbosity (`crates/evm/traces/src/decoder/mod.rs`, confirmed in 001-P1-rail-proof and 002 security reviews). Still, `fund()` only needs addresses, yet it puts four signing keys into the process.
- Fix (optional): read `DEMO_*` address vars with `vm.envAddress` in `fund()` and keep the keys for `reclaim()` only. This is least privilege, and it lets someone without the wallet keys run a dry-run `fund()`.

**LOW-3. `CUSTOMER` comes from the process env and is never reclaimed.** `Seed.s.sol:113,119`. Owner: claude-contracts / human (runbook).
- Exploit sketch: if a `CUSTOMER` export from an earlier demo is still in the shell, or the address is mistyped, `fund --broadcast` sends 56 USDT to a wallet we can't reclaim from. It is operator error, not an attack.
- Fix: in the runbook, always dry-run first and read the printed address (`:91-93`). Better, the cheap version: also log the `CUSTOMER` address before the broadcast, so it shows on the short path too (this ties to tester OPEN 2).

**INFO-1. Reclaim nonce.** `Seed.s.sol:104`.
- `keccak256(abi.encode("mcplus.seed.reclaim", from, timestamp, balance))`. It is domain-prefixed and uses `abi.encode`, so it can't be confused with MerchantPay's nonces. A collision (same wallet, same balance, same second) fails safe. I agree with the tester: no action needed.

**INFO-2. `require(USDT.transfer(...))` against plain `IERC20`.** `Seed.s.sol:83`.
- This is correct for this token: Whitechain's TetherToken returns `bool`, which the fork tests prove against the real token. `SafeERC20` is only needed if the script is ever pointed at a token that returns no bool.

**INFO-3. Tester's `vm.setEnv` pattern is acceptable.** `contracts/test/SeedEdges.t.sol:125-131,141` (tester question, NEEDS THE USER 3).
- It sets the key names to public `makeAddrAndKey` test keys. Even if Foundry has loaded `.env` into the process, this overrides the real values rather than reading them. Nothing is written to a file, and fork tests never broadcast.
- No other test reads these names (grep over `contracts/test`). `CUSTOMER` is reset explicitly to `address(0)`, which is good: otherwise a real `CUSTOMER` in the shell would leak into the test.
- Keep it that way. Don't add an `assertEq` on an env key value: on failure it would print both values.

**INFO-4. Codex MEDIUM (keys in verbose traces).** Agreed that it is mitigated and not a code change. Foundry 1.8.6 redaction is verified (see LOW-2), there is no `console.log` of keys (`:92` prints address, USDT and WBT only), broadcast files hold signatures and not keys (checked above), and the process rule stands: no `-vvvv` on live runs, and always use the redaction filter.

**INFO-5 (process, for the human). A live `fund()` broadcast happened during round 1.** Owner: claude-contracts / human.
- `4c8c64f` records a `fund --broadcast` at 00:24, while this round was still running. It made 5 txs from the team wallet `0xb4E7…714D`. All five have status 1 (`cast receipt`): `0x85a5…e258` 1 USDT, `0x3ab7…174f` 0.02 WBT, `0x247c…70fa` 69 USDT, `0xd8c6…e4bd` 40 USDT, `0x3db3…288b` 100 USDT.
- The code that ran is the code reviewed here, and the chain now matches the targets exactly: merchant 1 USDT + 0.02 WBT, A 69, B 40, debtor 100. All four wallets are at nonce 0, and the payers hold 0 WBT.
- The spec's acceptance criteria only asked for a **dry run** of `fund()`, and PIPELINE §11 lists team-money scripts as always-flag. Please confirm the human approved this broadcast, and log it in `batch.md` and `build-contracts.md`.

## Checks that passed
- **Signature binding:** the authorization binds `from`, `to = vm.addr(deployerKey)` (no env override possible), the exact balance, `validAfter 0`, `validBefore = now + 15 min`, and a one-use nonce. The domain comes live from `DOMAIN_SEPARATOR()`, not hard-coded. Live result: PAYER `0xE53f…309b` went from 1 USDT to 0 (to the team), WBT 0 and nonce 0 before and after.
- **Fail-before-send:** the shortfall check (`:70-77`) runs before `vm.startBroadcast`. Third parties can only *raise* a wallet's balance (donations), which shrinks what the team sends. Nobody but the key holder can lower a balance to make the team overpay.
- **No reentrancy surface:** this is a script made of EOA-submitted txs. The only native send goes to the merchant (WBT targets for everyone else are 0).
- **No PII:** only demo wallet addresses and amounts appear on-chain or in the logs.

## NEEDS THE USER
1. PIPELINE §11: this script moves team-wallet USDT/WBT with the deployer key and signs with five script-wallet keys. Please look at it at the gate.
2. INFO-5: confirm the 00:24 live `fund()` broadcast was approved. It was not an acceptance criterion.
3. Tester question 3: the `vm.setEnv` test-key pattern is acceptable from a security view (INFO-3).
