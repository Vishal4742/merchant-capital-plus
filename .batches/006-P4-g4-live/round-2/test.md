VERDICT: PASS

1. `forge test --match-path test/EventAbi.t.sol -j 1`: 3 passed, 0 failed.
2. New assert `ClaimToken.MarketSet.selector == keccak256("MarketSet(address)")` (src/ClaimToken.sol:53 declares `event MarketSet(address market)`): the left side is compiler-derived from the declaration, the right is an independent literal, so any parameter type/count/name-of-event change makes them differ and the test fails. Proved by reasoning, not by mutation. Note it cannot see `indexed` changes (already in notes).
3. `cast call invoices(1)` on MerchantPay returns (merchant 0x37F9..42B1, due 1799096700, status 2, debtor 0x518b..6D9D, 1e8, 1e8, ...): status = 2 (Paid). Closes the round-1 gap.
4. AT-8 replay at block 12316357 works: canTransfer(A, dEaD, 2, 1) = false; canTransfer(A, B, 2, 1) = true; safeTransferFrom revert data 0x705c1eed...dead (see output below); A balanceOf(claim 2) at that block printed below.
