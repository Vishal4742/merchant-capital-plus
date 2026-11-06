# 033-P5-settlement-withdraw
Phase: 5 (PHASES.md)   Round: 1   Owner lane: claude-research (agent)
Mode: phase
Money: yes (the merchant's own wallet signs a USDT transfer; nothing moves through our server or the relayer)
Request (verbatim): human 16:16: "After paying, there is no option to settle in the backend."
Agent ids (builders, for SendMessage resumes): this agent (worktree agent-ac442ce5c8a09e3d3, branch p5-settlement-withdraw)
Log:
- Spec from SRS v2.2 FR-GW-15 / AT-18. Payments already settle T+0 to the merchant's own wallet (MerchantPay._settle);
  the gap was that Settlements never let the merchant see that money as theirs or move it.
- Built tests-first (c9c5512 RED, 5b4bbb6 GREEN), UI d4e75f5. ci PASS (596/598, build 0). PR #30.
- reviewer-security PASS (0 HIGH). M1 (sent link lost after Max), M2 (Close allowed a second send while unconfirmed),
  M3 (ClaimToken/InvestorRegistry not refused), L1 (lower-case note), L2 (transfer result) fixed in f968a73; ci re-run
  598/600, 0 fail, build 0. L3 (wallet errors after broadcast) left as is: inherited from merchant-wallet send(), and the
  wallet's own nonce shows the pending tx.
