# 002-P2-drain-guard
Phase: 2 (PHASES.md)   Round: 3   Owner lane: claude-relayer
Request (verbatim, claude-research relaying the human at 22:44): "PHASE 2 START (human 22:44): FR-REL-1-3,5,6 + AT-10 + drain-guard point 11 (reject payers with code incl. EIP-7702), eth_sendRawTransactionSync for NFR-4 (<=5 s), NFR-14 budgets (/health <=300 ms p95, reject <=500 ms), send lock, streaming body cap, validBefore + authorizationState pre-checks. Build against the PullStub path now; switch the allowlist to MerchantPay when claude-contracts publishes its ABI in packages/shared. Rate limits need Neon: ask the human if DATABASE_URL isn't in .env yet."
Agent ids (builders, for SendMessage resumes): builder = claude-relayer (this session)
Log:
- 22:46 G1 verified by claude-research 22:05; merged main (SRS NFR-12..14, CI, tester.md)
- 22:50 split Phase 2: 002 drain guard (no DB) · 003 limits/budget/pause/advisory lock (Neon) · 004 MerchantPay wiring (ABI)
- 22:55 viem source read (fill skipped when chainId/nonce/fees/gas all set; sendRawTransactionSync; http batch); latency probes (warm read 176/181 ms p50/p95, pending nonce 365 ms, batch ~370 ms)
- 23:00 spec written; plan-reviewer next
- 22:53 human decisions: (1) limits approved: gas 400k, maxFeePerGas 10 gwei, window <= 15 min, >= 30 s left, >= 1 USDT; (2) create scoped apps/relayer/.env (relayer key only); (3) fund the G1 payer 2 USDT from the team wallet for the live check; (4) Neon: claude-relayer creates it via the Neon tools (batch 003)
- 22:56 funded payer: team → payer 2 USDT, tx 0x945980052736f4c25613bb0118ea164d6f502326dc6a345534736e9c757089bb (60,911 gas); payer 2 USDT / 0 WBT. Scoped apps/relayer/.env created (1 var, mode 600, git-ignored)
- 22:58 plan-reviewer: READY WITH CHANGES (11 findings) → all adopted except S1 host guard (human-enforced control per the 001 gate); spec updated
- 23:10 RED e9a9dff → GREEN 6eac3b3 (26/26, tsc 0, 5/5 mutants killed); pushed; GitHub CI success on 6eac3b3
- 23:14 round 1: builder runs the key-holding dev server on 127.0.0.1:8787; tester only sends HTTP requests (tester.md: never touch keys)
- 23:25 round 1 tester: CHANGES (F1 /health p95 372–426 ms > 300; F2 expiry can lapse inside the lock: viem retries ~33 s, re-check only before simulate). Human 23:27: (1) approve a 5 s /health balance cache, refreshed after each send; (2) RPC-backed rejects keep NFR-14's 500 ms but G2 measures them from the deployed relayer (venue Ankr p95 was 582–717 ms on its own)
- 00:36 fix 27c0250 (expiry re-check before signing, retryCount 0, 5 s /health cache; 32/32, tsc 0); reviewers not run on round 1 (known-bad code); round 2 starts: tester → reviewers → ci
- 01:01 round 2 tester: CHANGES (F5 paced /health p95 545–558 ms: idle socket dropped at ~4 s vs 5 s TTL; F6 a read across a send re-caches the old balance; F7 spec text). F2 confirmed fixed on the real transport. Payer 0xE53f was drained by another lane's txs (not the relayer)
- 01:14 human: F5 = background refresh every 3 s. 01:16 merged origin/main (strategy files untracked, human 01:12) and pushed
- 01:20 fix (refresh + send counter + spec F7); 36/36, tsc 0, F6 mutant killed; paced /health p95 3.5 ms, 5.5 s gaps max 189 ms. Round 3 (last): tester → reviewers → ci
- 01:52 round 3: tester PASS, code PASS, security PASS, ux-ui PASS; 6 gwei cap applied (human 00:45) as 09410af; CI green run 42102535928 → ci.md PASS. Missed agentbus backlog 23:10–01:46 caught up at 01:45
- 02:44 HUMAN GATE decisions: (1) run the live proof (throwaway payer funded with exactly 1 USDT; one relayed pull; replay); (2) batch 003 breaker: ban a payer after 1 mined revert, 503 to all /relay after 3 mined reverts in an hour; (3) /relay auth = shared secret header from the web server (relayer limits per payer + merchant; web app limits per IP); (4) RPC_URL → https://rpc.testnet.whitechain.io (batch 003; this live proof runs on the reviewed code = Ankr)
- 02:50 live pull attempted: stopped at the funding simulation (team wallet 0 USDT: seed script + other lanes); nothing sent. Human 02:51: close 002 on offline + live-rejection evidence; the live relayed payment is proven in the G2 joint run via MerchantPay paySale
