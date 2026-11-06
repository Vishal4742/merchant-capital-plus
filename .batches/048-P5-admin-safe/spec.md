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
- Round 2 design (after security review 048 F1/F2/F3), one script run, deployer key only:
  1. Check first: exactly 3 distinct owners (not 0, the sentinel 0x1 or the Safe), and each owner's personal_sign of
     `ownerMessage(owner)` in SAFE_OWNER_SIGS (proof someone holds the key, so a typo or a contract address can't
     become a dead seat). Each contract must be owned by the deployer and pending to nobody or to this Safe.
     Otherwise it reverts before the first tx.
  2. `transferOwnership(predictedSafe)` on each contract not yet handed over. The address comes from CREATE2 in
     SafeProxyFactory 1.4.1 and commits to the owners, the threshold and the accepts. The deployer stays owner.
  3. `createProxyWithNonce` with the final owners at threshold 2, whose `setup` delegatecalls MultiSendCallOnly 1.4.1
     (0x9641d764fc13c8B624c04430C7356C1C7C8102e2, code hash matched to safe-deployments) to `acceptOwnership` on all
     three. If any handover is missing, creation reverts and nothing changes.
  4. Check last (simulation), then `check()` against the live chain after the broadcast.
- The Safe never exists below 2-of-3, and the deployer is never one of its owners unless listed. A squatter can only
  create our exact Safe, and only after the handover. A re-run after a partial broadcast skips handed-over contracts.
  Broadcast with `--slow` so each tx waits for the previous receipt.

## Acceptance criteria (each checked by a fork test at the pinned block 12_382_404)
- [ ] After the move: `owner()` is the Safe and `pendingOwner()` is 0 on MerchantPay, InvestorRegistry and ClaimToken.
- [ ] The deployer loses every role: `setEligible`, `pause`, `sweep`, `setRelayFee`, `forcedTransfer` and
      `setFrozenTokens` each revert `OwnableUnauthorizedAccount(deployer)`.
- [ ] The Safe holds it: a Safe tx signed by 2 of the 3 owners runs `setEligible` and `pause`. The same tx with
      1 signature reverts (GS020).
- [ ] Threshold is 2, the owners are exactly the 3, and the deployer is not an owner (unless listed).
- [ ] Admin listed as one of the 3: same end state, and it alone can't run a Safe tx. A non-owner's signature doesn't count (GS026).
- [ ] Bad input reverts before any tx: 2 or 4 owners, missing proofs, a duplicate, 0, the sentinel, an owner with no or
      someone else's proof (a contract address), a stranger as admin, or a contract pending to another address.
- [ ] A broadcast that stopped part-way resumes. Creating the Safe before every handover reverts and moves nothing.
- [ ] `check()` reads SAFE_OWNERS and passes only once the Safe holds every role.
- [ ] `forge build`, `forge test` (all suites) and `forge lint` clean; the two new files are `forge fmt`-clean. The contracts in src/ are unchanged.

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
