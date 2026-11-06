VERDICT: PASS

# Security review: 048-P5-admin-safe, round 2

Reviewer: reviewer-security (Opus). Mode: phase, Money: yes. Only HIGH or CRITICAL findings block.
Scope: `git diff c914e9e..HEAD -- contracts/ .batches/048-P5-admin-safe/` (commits 4203bc0 and 7564ed3). The other
files in that range (CODEOWNERS, AGENTS.md, README, SRS, pipeline-gate.sh) came in with the merge of origin/main.
Against origin/main the branch changes only the two contract files and the batch's markdown. `contracts/src` is
unchanged.

There are no HIGH or CRITICAL findings. The redesign closes round 1's F1, F2, F3 and F5. Every partial-broadcast state
can be recovered by the deployer, and the Safe can only exist as the intended 2-of-3. What remains is LOW or INFO.

## What I verified

- **Tests:** `forge test --match-contract MoveAdminToSafeForkTest` (forge 1.8.6) gave 8 passed, 0 failed, 0 skipped.
  `forge fmt --check` on both files exits 0.
- **Live state, read-only:** at block ~12_382_800 all three targets still have `owner = 0xb4E7…714D` and
  `pendingOwner = 0`, so nothing has been broadcast.
- **MultiSendCallOnly 1.4.1** `0x9641d764…02e2`: safe-deployments v1.4.1 lists chain 1874 as `canonical`. The on-chain
  code hash at block 12_382_404 is `0xecd5bd14…9939`, which matches the record. Round 1 already matched SafeL2, the
  factory and the handler.
- **Secret grep** (`grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` on the files that differ from origin/main):
  `contracts/script/MoveAdminToSafe.s.sol:96` `vm.envUint("DEPLOYER_PRIVATE_KEY")` is the env-var **name**. The
  other hits are my own round-1 file quoting that same line. No values.

## Answers to (a) to (d)

**(a) `predict()` matches the factory.** Here is the SafeProxyFactory 1.4.1 source (`proxies/SafeProxyFactory.sol`):
- line 54: `salt = keccak256(abi.encodePacked(keccak256(initializer), saltNonce))`
- line 29: `deploymentData = abi.encodePacked(type(SafeProxy).creationCode, uint256(uint160(_singleton)))`
- line 32: `create2(0, …, salt)` from the factory's own address
- line 16: `proxyCreationCode()` returns `type(SafeProxy).creationCode`

`predict()` at script:144-148 computes the same hash: `bytes32 ‖ uint256` packed, `creationCode ‖ uint256(singleton)`,
deployer = FACTORY. The salt, the singleton and `keccak256(initializer)` are all inputs, so the address commits to the
owners, the threshold, the handler and the exact accept calldata. The other factory entry points
(`createChainSpecificProxyWithNonce`, `createProxyWithCallback`) derive a different salt, so they can't land on this
address. `move()` also checks `created == predicted` in the simulation (script:160), and
`test_MovesEveryRoleToTheSafe` asserts equality on the fork.

**(b) The MultiSendCallOnly encoding and `msg.sender` are correct.**
- **Encoding:** MultiSendCallOnly 1.4.1 reads, per entry, `operation` = 1 byte, `to` = 20 bytes at +0x01, `value` =
  32 bytes at +0x15, `dataLength` = 32 bytes at +0x35, and `data` at +0x55. The next entry starts at
  `0x55 + dataLength`. script:126 packs `uint8(0) ‖ address ‖ uint256(0) ‖ uint256(accept.length) ‖ accept`, which is
  1 + 20 + 32 + 32 + 4 = 89 bytes per entry.
- **Loop:** the loop's `lt(i, length)` bound (i starts at 0x20) still reaches all three entries, at i = 32, 121 and
  210, all below 267.
- **Failure handling:** operation 1 (delegatecall) reverts, and any failed call does `revert(0,0)`.
- **`msg.sender`:** the call path is `Safe.setup` → `setupModules(to, data)` → `require(execute(to, 0, data,
  DelegateCall, type(uint256).max), "GS000")` (`base/ModuleManager.sol`). MultiSendCallOnly's code therefore runs in
  the proxy's context, and its CALLs to the three targets have `msg.sender` = the Safe proxy. `setupOwners` runs before
  `setupModules` in `setup`, so the Safe is already 2-of-3 when the accepts run. MultiSendCallOnly writes no storage.
- **Failure path:** if any accept reverts, GS000 makes setup fail. The factory's initializer call then does
  `revert(0,0)` (factory:39-41) and the CREATE2 is undone. `test_SafeCantBeCreatedBeforeTheHandover` shows this.

**(c) No partial-broadcast state is unrecoverable.** The broadcast is at most 3 × `transferOwnership(A)` followed by
`createProxyWithNonce`, where A is the predicted Safe.

| Mined so far | State on chain | Who can act | Recovery |
|---|---|---|---|
| 0–3 handovers, no Safe | deployer is `owner` of all three; `pending = A` on the ones handed over | deployer only (A has no code and can only be created as the intended Safe) | re-run: handed-over contracts are skipped (`_check` script:183-189, `test_PartialBroadcastResumes`), or abort with `transferOwnership(address(0))` on each |
| create reverted (a handover missing, OOG) | same as above; the revert undoes CREATE2 | deployer only | re-run, which sends only what's missing |
| create mined | final 2-of-3, all three owned by the Safe | 2 of the 3 owners | `check()` |

Without `--slow` the outcome is the same. A dropped handover makes the create revert, which is the second row. The
Safe never exists below 2-of-3, there is no threshold-1 window, and the deployer is never an owner unless listed.
Only one thing in this design can't be undone: once the initializer is public (for example, the calldata of a create
tx that reverted on chain) and all three handovers are mined, **anyone** can send the create. That completes the move
to the intended Safe, which is the approved end state, so it isn't a vulnerability. But if the human wants to abort
after a create has gone out, cancel the pending owners first.

**(d) The ownerMessage proof can't be forged or usefully replayed.**
- **Forgery:** the message includes the owner's own address, so the usual trick of picking a random `(r,s,v)` and
  claiming the recovered keyless address as a "proven" owner doesn't work. The recovered address would have to equal
  the address inside the message it signs, and finding such a fixed point is as hard as forging ECDSA. OZ 5.7.0
  `tryRecover` accepts only 65 bytes, rejects high-s and returns an error for `ecrecover == 0`. A wrong length or a
  0/1 `v` fails closed with `NoProofOfKey`.
- **Replay from another context:** a signature over any other digest recovers to a different address, so it's
  rejected (`test_BadInputReverts`, the swapped-proof case). The text isn't a 32-byte hash, EIP-712 data or a SIWE
  message, so it can't be reused as a Safe eth_sign signature (Safe signs `toEthSignedMessageHash(bytes32)`), as an
  EIP-3009 authorization or as a login.
- **Replay of the proof itself:** it isn't bound to this Safe, a date or a nonce, so an old proof stays valid. That
  is acceptable. The proof authorizes nothing on chain; it only checks the operator's input. It shows the key existed
  when the owner signed, not that it is still held (see R2-1).

## Round-1 findings

| R1 | Status | Evidence |
|---|---|---|
| F1 MEDIUM, partial broadcast leaves a weak Safe | **fixed** | redesign (c); `--slow` documented at script:73; `check()` at script:102-106, `test_CheckReadsTheLiveState` |
| F2 MEDIUM, dead seats | **fixed** | `NoProofOfKey` (script:177-179); `test_BadInputReverts` covers a contract address and a swapped proof |
| F3 LOW, squat blocks the run | **fixed** | a create before the handover reverts (`test_SafeCantBeCreatedBeforeTheHandover`); after the handover, a squatter can only finish the intended move |
| F4 LOW, no tested 2-of-3 path on live 1874 | open, out of scope (spec) | carried below |
| F5 LOW, test gaps | **fixed** except one part | GS026, sentinel, pending-elsewhere, resume and early-create are covered; the vacuous asserts are removed. `run()` is still unexercised (R2-2) |
| F6 INFO | fixed (spec block, tx count) / still stands (don't list the deployer) | spec.md AC header; batch.md log |

## FOLLOW-UP (LOW and INFO, none blocking)

- **R2-1 LOW: the proof shows the key existed when the owner signed, not that it is still held.** Where:
  script:115-118. Scenario: an owner signs early, then loses the device, and the proof still passes. Fix: have each
  owner sign right before the broadcast. Optionally add the predicted Safe address to the message; that binds the
  proof to this owner set at no extra cost. Owner lane: claude-contracts.
- **R2-2 LOW: three small test gaps.** Where: `contracts/test/MoveAdminToSafe.t.sol`.
  (a) `run()` and the `SAFE_OWNER_SIGS` comma parsing (`vm.envBytes`, script:97) are never exercised. SeedEdges
  already sets `DEPLOYER_PRIVATE_KEY` to a test key, and `test_AdminAsOneOfThreeCantActAlone` shows how to hand the
  targets to it first.
  (b) The resume case where all three are handed over and only the create is left isn't tested; the one-of-three case
  is (test:139-148).
  (c) The bare `vm.expectRevert()` in test:154 and test:159 would also pass on an unrelated revert. The factory reverts
  with empty data here, so `vm.expectRevert(bytes(""))` is tighter.
  Owner lane: claude-contracts.
- **F4 LOW, carried: there is no tested 2-of-3 recipe for `pause` / `unpause` / `setEligible` on live chain 1874.**
  The Safe web app may not list the chain. Have one ready before the broadcast; the test's `_sign` / `_exec`
  (test:228-249) are most of it. Owner lane: claude-contracts.
- **INFO:**
  - The only dry run in batch.md (21:00) was of the round-1 design. Dry-run this design against live state with the
    real owners and proofs before the broadcast, and confirm 4 txs, the gas, and that forge's gas for the create comes
    from its simulation with the handovers applied.
  - `check()` must get `SAFE_OWNERS` in the order used at creation. A different order computes another address and
    reverts. That fails closed, but the error isn't clear; say so in the header.
  - Owners must sign the exact checksummed text. Print it with `forge script … --sig "ownerMessage(address)" <owner>`.
  - A 65-byte proof in hex matches the repo's secret pattern `0x[0-9a-fA-F]{64}` and agentbus's secret filter. Proofs
    are public data, but keep them out of committed files and agentbus so the scanners don't trip.
  - Round 1 F6 still stands: listing the deployer keeps the most exposed key as half the admin.

## NEEDS THE USER
- An irreversible access-control change (PIPELINE §11). Before the yes to broadcast: a dry run of this design with the
  real 3 owners and fresh proofs (R2-1, INFO), and a 2-of-3 pause recipe ready for chain 1874 (F4).
