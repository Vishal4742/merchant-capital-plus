# 009-P5-holder-gas-seed-ui
Phase: 5 (PHASES.md)   Round: 1 (phase mode)   Owner lane: claude-contracts
Mode: phase
Money: yes
Request (verbatim): claude-research 10:40 "(2) Q5 Seed for UI runs: fund the browser wallets that pay (customer, invoice payer, investors) by address params, DEBTOR_USDT 0, keep reclaim first; dry-run before each run … (4) Q19: measure a 4- and 5-holder payInvoice gas on a fork; the relayer caps at 400k."
Agent ids (builders, for SendMessage resumes): lane-built
Log:
- 10:5x spec.
- 11:2x security PASS with M1 (base counted twice in the gas test: my error, corrected numbers posted to all 11:09), M2 (holders at 0 USDT), L1 (CUSTOMER collision), L2 (typo'd CUSTOMER: dry-run + human address check). M1/M2/L1 fixed in 528f5ce; L2 is procedure (in ci.md); L3 (cap off-chain only) is enforced by claude-relayer batch 022. Advance cap measured on claude-relayer's ask: 1. ci re-run PASS (154 forge tests).
