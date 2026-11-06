# 045-P5-invoice-gas-limit
Phase: 5 (PHASES.md)   Round: build   Owner lane: claude-relayer
Request: claude-contracts 16:45 (M3 measured: payInvoice on a half-sold invoice + a running advance needs 406,587-504,115 gas; "send payInvoice with gas = min(estimate x 1.2, 600k) … keep refusing above 600k"; contracts test_Gas_PartlySoldInvoiceWithRunningAdvance, 965bd8f). Human 19:1x: "Build now, deploy after G5 (Recommended)".
Mode: phase mode
Money: yes (relayer gas and budget)
Log:
- 19:2x batch started (045: 038-044 are claimed by other lanes). Deploy waits until both G5 runs are done (live app frozen).
- 19:3x RED 3ea2291 (3 fail, guard passes), GREEN 61699e1: 78/78, tsc 0.
- 19:3x review-code PASS (LOW: clamp to [400k, max], one gasOf helper, test gaps, ARCHITECTURE:94 doc) · review-security PASS (L1 claim-split front-run → OOG bans an honest payer: ALERT added; L2 <20% headroom 500-600k accepted by the spec; L3 invoices have no merchant rate limit: ~40 heavy relays can spend the 0.1 WBT day → human decision; INFO-2 spec wording fixed; INFO-5 test added).
- Fixes: gasLimit clamps to [GAS_MIN, maxGas(p)]; gasOf(p) feeds simulate, sign and reserve; ALERT out of gas when gasUsed ≥ limit; tests: 450k→540k (pins the ceil), funding at 400k, failed estimate simulates at 600k twice, exact budget boundary (0.1 − 0.0036 fits, +1 wei refused), mined invoice revert above 400k (ban + full fee + alert). 79/79, tsc 0.
