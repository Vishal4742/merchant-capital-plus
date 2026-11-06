VERDICT: PASS

# Security review: 048-P5-admin-safe, round 1

Reviewer: reviewer-security (Opus). Mode: phase, Money: yes (PIPELINE §3b.2), so only HIGH or CRITICAL findings block.
Scope: `git diff origin/main...HEAD` = `contracts/script/MoveAdminToSafe.s.sol` and `contracts/test/MoveAdminToSafe.t.sol`
(new), plus the batch's own markdown. `contracts/src` is unchanged (`git diff origin/main...HEAD --stat -- contracts/src` is empty).

There are no HIGH or CRITICAL findings. The Safe wiring is correct, and no step can hand a role to an address nobody
controls. Two MEDIUM findings (F1, F2) should be fixed or handled by procedure **before the broadcast** (the broadcast
is out of scope here and waits for the human's yes). Details are under FOLLOW-UP.

## What I verified

- **Tests:** `forge test --match-contract MoveAdminToSafeForkTest` (forge 1.8.6) gave 5 passed, 0 failed, 0 skipped
  (BadInputMovesNothing, DeployerAsOneOfThreeCantActAlone, DeployerLosesEveryRole, MovesEveryRoleToTheSafe,
  TwoOwnersActOneCannot).
- **Safe addresses against safe-deployments v1.4.1** (`src/assets/v1.4.1/*.json` on main, chain 1874 = `canonical`).
  I hashed the on-chain bytecode at block 12_382_404 (`cast code | cast keccak`) and compared it with each record's
  `codeHash`. All three match:
  - SafeL2 `0x29fcB43b…C762` = `0xb1f92697…81ff`, and `VERSION()` returns "1.4.1"
  - SafeProxyFactory `0x4e1DCf7A…ec67` = `0x50c3cdc4…3317`
  - CompatibilityFallbackHandler `0xfd0732Dc…Ec99` = `0x7c6007a5…42f9`
- **Live preconditions (read-only calls):** MerchantPay, InvestorRegistry and ClaimToken each have `owner() = 0xb4E7…714D`
  and `pendingOwner() = 0`. The addresses in `targets()` (script:86-90) match `packages/shared/contracts.ts:9-12`.
  Only MerchantPay (`setRelayFee`, `setMarket`, `sweep`, `pause`, `unpause`), InvestorRegistry (`setEligible`) and
  ClaimToken (`setMarket`, `forcedTransfer`, `setFrozenTokens`) use `onlyOwner`. CapitalMarket has only immutables.
  No app calls an owner-only function (`apps/`, `packages/` show the ABI only), so nothing in the product breaks once
  the deployer stops being the owner.
- **Safe 1.4.1 semantics, read from the v1.4.1 source** (`safe-smart-account@v1.4.1`):
  - `setup()` args (script:97-99): owners [deployer], threshold 1, `to = 0` / `data = ""` (no module delegatecall),
    the handler, and no payment. Correct.
  - Pre-validated signature (script:146): `r = uint256(uint160(admin)) ‖ s = 0 ‖ v = 1`. This matches
    `checkNSignatures` (`currentOwner = address(uint160(uint256(r)))`, then `msg.sender == currentOwner`, GS025, and
    GS026 for the owner check). 65 bytes. Correct.
  - `safeTxGas = gasPrice = 0` means a failing inner call reverts the outer tx (`GS013`, Safe.sol:207). Correct, so a
    failed `acceptOwnership` can't be silently skipped by the Safe.
  - `addOwnerWithThreshold` puts each new owner at the head of the list, so after three adds `getOwners()` returns
    `[o2, o1, o0, deployer]`. `_prevOwner` (script:150-156) returns `list[i-1] = o0`, which is the right `prevOwner`.
    `removeOwner` needs `ownerCount - 1 = 3 >= 2`. Correct. When the deployer is listed, `changeThreshold(2)` with 3
    owners is also correct.
  - `addOwnerWithThreshold` rejects 0, the sentinel and the Safe itself (GS203) and duplicates (GS204). Any of these
    would revert during the local simulation, so forge would broadcast nothing.
- **CREATE2 binding:** `salt = keccak256(keccak256(initializer) ‖ saltNonce)` (SafeProxyFactory.sol:54). The Safe's
  address therefore commits to "owners [deployer], threshold 1, this handler". It is `0xf513fdb2…4233` (from the dry
  run) and has no code as of block 12_382_803.
- **Secret grep** (`grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` on the 4 diff files): 1 hit,
  `contracts/script/MoveAdminToSafe.s.sol:80` `vm.envUint("DEPLOYER_PRIVATE_KEY")`. That is the env-var **name**, not
  a value. The test keys (`0xA11CE`, `0xB0B`, `0xCA401`) are throwaway test scalars. The script logs only the Safe
  address. The dry-run JSON is git-ignored (`contracts/.gitignore:2`).

## Answers to the five questions

1. **Stranded or half-moved roles.** No step can hand a role to an address nobody controls. The pending owner is always
   the CREATE2 Safe, and the deployer can recreate it with the same arguments even if tx 1 never landed. Under one
   condition (txs sent without `--slow`, and one tx in the middle fails or is dropped), though, the end state can be
   2-of-2 with the deployer already gone, or a Safe at threshold 1 with up to 4 owners who can each act alone. In
   addition, `_verify` only checks the simulation and never the chain. See F1.
2. **Safe setup.** Correct: addresses, codehashes, `setup()`, the v=1 encoding and `prevOwner` all check out (above).
3. **Front-running the Safe.** Liveness only. A squatter can only deploy the identical Safe (owners [deployer],
   threshold 1), because the salt commits to the initializer. They can't set its owners, modules or guard. A mempool
   front-run of tx 1 without `--slow` makes only tx 1 revert, and the rest then run against the identical Safe, so the
   end state is still correct. One gap: the repo is public and SALT is a constant, so anyone can pre-deploy the Safe
   before the broadcast. The script then reverts in simulation (nothing moves) and can't run until SALT changes. See F3.
4. **Do the tests prove the ACs?** Mostly. AC1, AC2, AC4 and AC5 are proven as written. AC3 is proven as worded (one
   signature: GS020, a length check), but no test sends two signatures where one isn't valid. AC6 doesn't test the
   sentinel or the "pending owner already set" branch. Its "moves nothing" asserts are also vacuous: `expectRevert`
   rolls the state back whatever the order of checks. The real guarantee is that forge simulates the whole script
   first. See F5.
5. **Owner-list validation.** Zero, sentinel and duplicates are rejected. The Safe's own address reverts in simulation
   (GS203). A target contract, the factory, the handler, USDT, or any address whose key nobody holds is **accepted**
   and becomes a dead seat. See F2.

## FOLLOW-UP (MEDIUM and LOW: fix in the next batch, F1 and F2 before the broadcast)

### F1 MEDIUM: a partial broadcast can leave the Safe at 2-of-2 without the deployer, or at threshold 1 with 4 owners, and nothing checks the chain afterwards
- **Where:** `contracts/script/MoveAdminToSafe.s.sol:60-61` (the documented broadcast command has no `--slow`),
  `:110-121` (three `addOwnerWithThreshold(o, 1)`, then `removeOwner` with a `prevOwner` taken from the simulation),
  `:124` and `:158-167` (`_verify` runs only in the local simulation).
- **Failure scenario:** without `--slow`, forge 1.8.6 sends all 11 txs back to back and checks receipts afterwards
  (`forge script --help`: `--slow` "Makes sure a transaction is sent, only after its previous one has been confirmed
  and succeeded"). The v=1 signature doesn't bind the Safe nonce, so every later Safe tx still runs after an earlier
  one fails. The deployer key is the shared team wallet: Seed, LiveAdvance, LiveInvoice, RelayPull and
  SmokeMerchantPay all sign with it. A concurrent tx from it can take one of the script's nonces, and that script tx
  is then never mined.
  - tx 8 (`add o0`) lost: `removeOwner(prev = o0, deployer)` reverts GS205 → GS013. The Safe stays **1-of-3
    {o2, o1, deployer}**, so each of three single keys now holds `forcedTransfer` + `setEligible`. That is the CON-7
    risk this batch closes, three times over. The deployer can recover, but the script can't resume (`_check` now fails
    with `NotAdmin`) and there is no runbook.
  - tx 9 or 10 (`add o1` / `add o2`) lost: `prev = o0` is still right, so the deployer is removed and the Safe ends at
    **2-of-2**. The deployer can no longer fix it, and losing one more key bricks every admin role.
  - tx 11 lost: the Safe ends at **1-of-4**.

  Forge prints "Transaction Failure", but `_verify`'s "Safe is not 2 of 3" never ran against the chain.
- **Fix (claude-contracts):** (a) put `--slow` in the documented broadcast command. Every partial state is then a
  prefix in which the deployer is still an owner at threshold 1 and can finish or roll back. (b) Add a read-only entry
  point, e.g. `check(address safe, address[] owners)` that calls `_verify`, and run it against the live RPC right after
  the broadcast. Add a three-line recovery note: re-send `removeOwner` with the current `prevOwner`, or cancel with
  `transferOwnership(address(0))` while the deployer is still the owner. (c) Optional, stronger: skip the bootstrap
  owner. Run `transferOwnership(predictedSafe)` ×3 first, then call `createProxyWithNonce` with owners [o0, o1, o2],
  threshold 2, and `setup(to = MultiSendCallOnly 1.4.1, data = multiSend(acceptOwnership ×3))`. That is 4 txs, with no
  threshold-1 window and no v=1 signatures, and the deployer is never a Safe owner. A squatter can only create the
  intended Safe, and before the transfers its setup reverts.

### F2 MEDIUM: nothing proves that someone holds each owner key, and two bad addresses brick every admin role for good
- **Where:** `contracts/script/MoveAdminToSafe.s.sol:127-134` (`_check` validates the format only).
- **Failure scenario:** `SAFE_OWNERS` is pasted by hand. Any address with no key is accepted, for example a mistyped
  address, one of the target contracts, CapitalMarket, USDT, the factory or the handler. The run then removes the
  deployer in the same broadcast. One dead seat leaves the admin at 2-of-2. Two dead seats leave no one who can ever
  call `pause` (the FR-REL-9 brake), `sweep` (stray USDT stays stuck), `setEligible` (no new investors), or
  `forcedTransfer` / `setFrozenTokens`. The contracts can't be redeployed without moving every live link.
- **Fix (claude-contracts):** in `_check`, require one EIP-191 signature per owner (`SAFE_OWNER_SIGS`, made with
  `cast wallet sign "mcplus admin safe 1874 <safe>"`) and check it with OZ `ECDSA.recover` against `owners[i]`. That
  rejects contract addresses and typos in one step. The lighter alternative is a human step before the broadcast: each
  owner signs that message and the human checks it with `cast wallet verify`. Record it in batch.md.

### F3 LOW: the constant SALT plus a public initializer lets anyone block the script before it runs
- **Where:** `contracts/script/MoveAdminToSafe.s.sol:72`, `:97-102`.
- **Failure scenario:** the initializer can be derived entirely from the repo (deployer address, handler, threshold 1)
  and the salt is constant. Anyone can call `createProxyWithNonce(SAFE_L2, init, SALT)` now and create
  `0xf513…4233`, owned by the deployer at 1-of-1. The script's simulation then reverts with "Create2 call failed".
  Nothing moves and nothing is lost, but the move can't run until the code changes.
- **Fix (claude-contracts):** `vm.envOr("SAFE_SALT", SALT)`. Or, if the predicted address already has code, reuse the
  Safe when `getOwners() == [admin]`, the threshold is 1 and the nonce is 0.

### F4 LOW: the emergency brake has no tested 2-of-3 path on chain 1874
- **Where:** spec.md:58 (the helper is out of scope, "add when the first post-move admin action is needed").
- **Failure scenario:** after the move, `MerchantPay.pause()` (FR-REL-9) needs two owner signatures. The Safe web app
  may not list chain 1874. If the first admin action needed is an incident, the owners would be building the signing
  path during it.
- **Fix (claude-contracts):** before the broadcast, have a tested `cast` / script recipe for `pause`, `unpause` and
  `setEligible` as 2-of-3 Safe txs. The test's `_sign` / `_exec` helpers (test:139-157) are most of it.

### F5 LOW: test gaps
- **Where:** `contracts/test/MoveAdminToSafe.t.sol:74-89`, `:106-137`.
- **Gaps:** (a) no test of a 130-byte payload where one signature is bad: the same owner twice, or the deployer's v=1
  plus one owner after the move (expect GS026). Today "one can't act" is proven only by the GS020 length check.
  (b) The `owners[i] == SENTINEL` branch and the `pendingOwner != 0` branch of `_check` are untested. (c) The
  `assertEq(owner, DEPLOYER)` lines after the `expectRevert`s are vacuous, because a reverted call rolls back its
  state either way. (d) `run()` and the `SAFE_OWNERS` comma parsing are never exercised (the tests call `move`).
- **Fix (claude-contracts):** add (a) and (b). (c) is fine as long as the claim is "forge broadcasts nothing when the
  script reverts", not "the checks come first".

### F6 INFO
- Listing the deployer as one of the 3 (script:111, 118-119) keeps the most exposed key in the project as half the
  admin. It is the shared team wallet, used by six scripts and loaded into dev processes (batch 001 S8). Recommend not
  listing it.
- Stale numbers: spec.md:33 still cites fork block 12_303_386 (the test uses 12_382_404, and batch.md:8 explains why).
  batch.md:9 says the dry run made "10 txs", but the dry-run record (`broadcast/MoveAdminToSafe.s.sol/1874/dry-run/run-latest.json`)
  has 11, which is the right count for 3 non-deployer owners.

## NEEDS THE USER
- Before saying yes to the broadcast: F1 (at least `--slow` plus an on-chain check right after) and F2 (proof that a
  person holds each of the 3 owner keys). Both concern an irreversible access-control change (PIPELINE §11).
