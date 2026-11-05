VERDICT: PASS

# Review (code): 006-P4-g4-live, round 2 (delta only)

Delta reviewed: `git diff -- contracts/test/EventAbi.t.sol` (uncommitted), the ROUND 2 section and E1 row in `build-contracts.md`, and `notes/phase-4-contracts.md`. `contracts/src` is still unchanged.

## Round 1 findings
| Round 1 | Status | Evidence |
|---|---|---|
| MEDIUM 1: `ClaimToken.MarketSet` not pinned | **Fixed** | `EventAbi.t.sol:7` imports `ClaimToken`, and `EventAbi.t.sol:51` adds `assertEq(ClaimToken.MarketSet.selector, keccak256("MarketSet(address)"))`. All 20 per-contract events from `forge inspect` are now pinned. `forge test --match-path test/EventAbi.t.sol -j 1`: 3 passed, 0 failed. The build note's E1 row now says 20 and explains the 8 inherited OZ events. |
| MEDIUM 2: `indexed` flags not pinned | Deferred, recorded | The fix is a CI step, which needs the human (§11). It is recorded in build-contracts.md ROUND 2 and in `notes/phase-4-contracts.md:23`. Fine as a FOLLOW-UP. |
| LOW 3: duplicated `_digest` | Deferred | The script has run once and won't run again on frozen contracts. Accepted. |
| LOW 4: AT-8 replay commands | **Fixed** | `notes/phase-4-contracts.md:10-18`. I replayed them read-only against `https://rpc.testnet.whitechain.io` at block 12316357: `canTransfer(A, dEaD, 2, 1)` = `false`, `canTransfer(A, B, 2, 1)` = `true`, and `safeTransferFrom` from A reverts with `0x705c1eed…dead` (`ERC7943CannotReceive(0x…dEaD)`). |
| LOW 5: `pay()` hardcodes FACE | No change needed | Recorded in `notes/phase-4-contracts.md:23`. |

## FOLLOW-UP
1. **LOW, repo root `cache/`:** an untracked `cache/solidity-files-cache.json.abi` (02:38) appeared, probably from running `forge` at the repo root. Only `contracts/cache/` is git-ignored (`.gitignore:23`). Fix: don't stage it (commit only this batch's files) and delete it. Owner: claude-contracts.
2. MEDIUM 2 (from round 1) stays open for the human: the CI step `bash contracts/script/export-abi.sh && git diff --exit-code packages/shared/contracts.ts`.

## NEEDS THE USER
- Same as round 1: PIPELINE §11, the live script that moved demo-wallet USDT with the deployer, merchant, investor and debtor keys (testnet only).
- The `indexed`-flag CI check above, if wanted.
