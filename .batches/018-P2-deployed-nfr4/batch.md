# 018-P2-deployed-nfr4
Phase: 2 (PHASES.md)   Round: build   Owner lane: claude-relayer
Request (verbatim): claude-research 09:23 "NFR-4 on the DEPLOYED relayer: … took 7.31 s sign-to-receipt … vs 4.40 s on your local relayer … (1) add per-step timings … (2) measure warm with a reject probe series, then ONE live sale … (3) fix the biggest step … Target ≤ 5 s on the deployed URL". Human 09:31: "Yes, one 1.00 sale".
Mode: phase mode
Money: yes (one 1.00 USDT sale from guest 0x4f59 through the deployed relayer)
Log:
- 09:33 batch started.
- 09:34 timings build e5f56a5 deployed to production (merchant-capital-relayer-60vvmsotb). Relayer nonce 10, 0.4914 WBT before.
- 09:35 probe (venue → deployed, no tx; nonce 10 → 10): /health cold 2,206 ms then 492; /relay insufficient_funds rejects 845 (first) · 580 · 323 · 359 · 335 · 361 · 309 · 317 ms; /health warm 213–351 ms. A warm RPC round from iad1 is ≈ 100–140 ms, so warm relayer overhead is small; the 7.31 s needs the live sale's timings (cold start + receipt wait suspected).
