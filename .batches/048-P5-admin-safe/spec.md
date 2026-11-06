# Spec: 048-P5-admin-safe

Move every admin role from the single deployer key to a 2-of-3 Safe, with no redeploy (the contracts are
Ownable2Step). Request: claude-research 20:46 for the human ("by code can we fix [the limitations]?").

## Requirements (cite docs/SRS.md IDs)
- FR-KYC-1 / U5: the compliance admin (InvestorRegistry owner, `setEligible`) becomes the Safe.
- FR-TOK-5: ClaimToken's compliance admin (`forcedTransfer`, `setFrozenTokens`) becomes the Safe.
- FR-REL-9, FR-PAY-16, FR-REL-4: MerchantPay's owner (`pause`/`unpause`, `sweep`, `setRelayFee`) becomes the Safe.
- CON-7 / NFR-3: no admin power rests on one key held in one `.env`. Today one key can make itself eligible
  (`setEligible`) and then `forcedTransfer` any holder's claim units to itself; afterwards that takes 2 of 3 owners.

Roles found (src/, frozen): MerchantPay, InvestorRegistry and ClaimToken are each Ownable2Step with one owner
(the deployer 0xb4E7…714D, no pending owner, checked live 20:55). CapitalMarket has no admin: every link is immutable.
`setMarket` on MerchantPay and ClaimToken is one-time and already set, so moving it changes nothing.

## Design
- Safe 1.4.1 SafeL2 proxy from the canonical SafeProxyFactory, CompatibilityFallbackHandler 1.4.1. Addresses
  checked against safe-global/safe-deployments v1.4.1 (chain 1874 listed as canonical) and with code on chain:
  SafeL2 0x29fcB43b46531BcA003ddC8FCB67FFE91900C762, factory 0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67,
  handler 0xfd0732Dc9E303f09fCEf3a7388Ad10A83459Ec99.
- Bootstrap in one script run, deployer key only:
  1. Check first: exactly 3 distinct non-zero owners in SAFE_OWNERS, and all three contracts owned by the deployer
     with no pending owner. Otherwise it reverts before the first tx.
  2. Create the Safe with owners [deployer] and threshold 1.
  3. `transferOwnership(safe)` on all three contracts.
  4. The Safe runs these as Safe txs, signed by the deployer's pre-validated signature (v = 1, msg.sender is the
     owner, so no signing step): `acceptOwnership` on all three, then `addOwnerWithThreshold` for each owner, then
     `removeOwner(deployer, 2)`, or `changeThreshold(2)` when the deployer is one of the 3.
  5. Check last: owner() is the Safe on all three, the threshold is 2, and the owners are exactly the 3.
- While the script runs the deployer alone controls the Safe, which is no worse than today. After it, it can't.

## Acceptance criteria (each checked by a fork test at the pinned block 12_303_386)
- [ ] After the move: `owner()` is the Safe and `pendingOwner()` is 0 on MerchantPay, InvestorRegistry and ClaimToken.
- [ ] The deployer loses every role: `setEligible`, `pause`, `sweep`, `setRelayFee`, `forcedTransfer` and
      `setFrozenTokens` each revert `OwnableUnauthorizedAccount(deployer)`.
- [ ] The Safe holds it: a Safe tx signed by 2 of the 3 owners runs `setEligible` and `pause`. The same tx with
      1 signature reverts (GS020).
- [ ] Threshold is 2, the owners are exactly the 3, and the deployer is not an owner (unless listed).
- [ ] Deployer listed as one of the 3: same end state, and the deployer alone can't run a Safe tx.
- [ ] Bad input moves nothing: 2 or 4 owners, a duplicate, address 0, or a contract not owned by the deployer.
- [ ] `forge build`, `forge test` (all suites), `forge fmt --check`, `forge lint` clean. The contracts in src/ are unchanged.

## Files to touch (owner lane: claude-contracts; only these)
- contracts/script/MoveAdminToSafe.s.sol (new)
- contracts/test/MoveAdminToSafe.t.sol (new)
- .batches/048-P5-admin-safe/**

## Ponytail ladder (why this is the smallest change that works)
- Needed: yes, the human asked for admin trust to be fixed by code. Already in repo: Ownable2Step does the
  handover, so there's no redeploy. Installed dependency: none for Safe; two minimal interfaces (ISafe,
  ISafeProxyFactory) instead of vendoring safe-contracts. Pre-validated signatures remove any signing code in the script.
  MultiSend is skipped: separate Safe txs are a few more txs, but one fewer contract to trust.

## Out of scope
- Broadcasting: only after both G5 runs and the human's yes in claude-contracts' window (G5 may still need
  `setEligible` from the deployer).
- A helper for later Safe txs on chain 1874 (the Safe web app may not list this chain; owners can use safe-cli or
  `cast`). Add when the first post-move admin action is needed.
- The relay fee recipient 0xdd02…a651 (an address that receives fees, not a role).
