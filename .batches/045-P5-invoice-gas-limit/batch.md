# 045-P5-invoice-gas-limit
Phase: 5 (PHASES.md)   Round: build   Owner lane: claude-relayer
Request: claude-contracts 16:45 (M3 measured: payInvoice on a half-sold invoice + a running advance needs 406,587-504,115 gas; "send payInvoice with gas = min(estimate x 1.2, 600k) … keep refusing above 600k"; contracts test_Gas_PartlySoldInvoiceWithRunningAdvance, 965bd8f). Human 19:1x: "Build now, deploy after G5 (Recommended)".
Mode: phase mode
Money: yes (relayer gas and budget)
Log:
- 19:2x batch started (045: 038-044 are claimed by other lanes). Deploy waits until both G5 runs are done (live app frozen).
