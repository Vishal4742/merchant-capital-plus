VERDICT: PASS

No UI in this batch (script + tests only): no screenshots, Lighthouse or relayer timing apply.
All chain checks read-only via cast against https://rpc.testnet.whitechain.io.

## DONE
- AT-6 PASS. Fund txs 0x6b3464..9ab3c and 0xab395b..d9744 status 1. Funded (topic 0x9a989949) A units 0x03938700=60,000,000 cost 0x0381d126=58,839,334; B units 0x02625a00=40,000,000 cost 0x02568b6f=39,226,223. Merchant (0x37f9..a442b1) received both costs via the token Transfer logs: sum 98,065,557. createInvoice 0xd618..7ac1 and listInvoice 0xd6fc..617c status 1.
- AT-7 PASS. Tx 0xd9172e76..3b1 status 1, Paid (0x90133e34) invoice 8 data: gross 0x5f767a0=100,100,000, fee 0x186a0=100,000, toInvestors 0x5f5e100=100,000,000, toMerchant 0. Transfer logs: MerchantPay to A 60,000,000 and to B 40,000,000, fee 100,000 to relayer-fee recipient. Distributed outstanding 0 and Settled(2) emitted in the same tx. Merchant top-up 0x7062..d1cc4 status 1. Invoice 1 status 2 and claim 2 reads back as burned (claims(2)/totalSupply revert or 0, consistent with outstanding 0).
- Payers gasless PASS. Debtor 0x518b..6d9d, A 0xc236..6752, B 0xaf74..2771b: native balance 0, nonce 0 (cast balance / cast nonce).
- AT-8 PASS (contract half). canTransfer(A, 0x..dEaD, 2, 1) = false; canTransfer(A, B, 2, 1) = true; eth_call safeTransferFrom(A, dEaD, 2, 1, 0x) from A reverts data 0x705c1eed000000000000000000000000000000000000000000000000000000000000dead = ERC7943CannotReceive(0xdEaD). Re-run today after claim 2 was burned; results are eligibility-based and still hold. Also covered by unit tests ClaimToken.t.sol:258,291,300,497-498.
- E1 PASS. forge test --match-path test/EventAbi.t.sol: 3 passed (CapitalMarket, ClaimToken+registry, MerchantPay topics). On-chain topics seen above (0x9a989949 Funded, 0x90133e34 Paid, 0xc3d58168 TransferSingle-style) match the pinned snapshot lines.
- Full suite PASS: `forge test -j 1` (run from contracts/): 11 suites, 153 passed, 0 failed, 0 skipped.

## OPEN
- AT-9 and FR-TOK-8 UI half: claude-frontend (out of scope here).
- Coverage numbers in build-contracts.md are carried over from batch 005 (same src/); not re-run by me.

## NEEDS THE USER
- PIPELINE section 11 gate for the live script already executed with demo-wallet keys (testnet): human sign-off to be recorded.
