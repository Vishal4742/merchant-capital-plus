# 048-P5-admin-safe
Phase: 5 (PHASES.md)   Round: 1   Owner lane: claude-contracts
Mode: phase   Money: yes (moves every admin role: KYC list, forced transfer, pause, sweep, relay fee)
Request (verbatim): claude-research 20:46 (human 20:45 'by code can we fix [the limitations]?'): "move admin from the single deployer key to a Safe multisig, NO redeploy (Ownable2Step) ... dry-run it on a fork now, with tests proving the deployer loses each role and the Safe holds it. Broadcast ONLY after both G5 runs and the human's yes in your window"
Agent ids (builders, for SendMessage resumes): none (built inline by claude-contracts)
Log:
- 20:55 roles surveyed; Safe 1.4.1 addresses checked against safe-deployments and on chain. Research's "fallback handler 0xfb1bffC9…91EA" is a Safe 1.3.0 singleton (VERSION 1.3.0, 23.8 KB), so it isn't used.
- Red at 82bebd5 (no script). Green at c914e9e: 5/5 fork tests at block 12_382_404 (the first pin, 12_303_386, predates the live MerchantPay). forge fmt and lint clean.
- 21:00 dry run against live state (forge script, no --broadcast, placeholder owners): SIMULATION COMPLETE, 10 txs, 1,355,070 gas, max 0.0136 WBT at 10 gwei. Team wallet holds 0.261 WBT.
- 21:05 security round 1 PASS with 2 MEDIUM + 3 LOW (round-1/review-security.md). Fixed in 4203bc0: F1 (partial broadcast → weak Safe) and F3 (salt squat) by the redesign in spec.md (Safe created 2-of-3, setup accepts via MultiSendCallOnly; resumable; --slow; check()); F2 (dead seats) by a personal_sign proof per owner; F5 test gaps by GS026, sentinel, pending-elsewhere, resume, early-create and check() tests; F6 by fixing the spec block (the round-1 dry run had 11 txs, not 10). F4 (no tested 2-of-3 admin path on 1874 outside the fork) stays out of scope (spec). 8/8 fork tests, full suite 163/163, src unchanged.
- Follow-up (not this batch): forge fmt --check reports diffs in test/Seed.t.sol, SeedEdges.t.sol and CapitalMarketProbe.t.sol, which are already on main. CI doesn't run fmt.
- 21:16 security round 2 PASS (round-2/review-security.md): F1/F2/F3/F5 fixed. R2-2 fixed in 30f28c7 (resume with only the create left; exact empty reverts): 9/9 fork tests. R2-1 (the proof shows the key existed when signed): owners sign right before the broadcast. F4 (a 2-of-3 pause recipe on 1874) is a pre-broadcast item for claude-contracts, not this batch.
- 21:18 dry run of the round-2 design against live state (throwaway test owners, proofs from `cast wallet sign`, which exercises run() and SAFE_OWNER_SIGS parsing): SIMULATION COMPLETE, 4 txs, 681,148 gas, max 0.0068 WBT.
