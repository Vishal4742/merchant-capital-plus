# 001-P1-relay-stub
Phase: 1 (PHASES.md)   Round: 3   Owner lane: claude-relayer
Request (verbatim): "First batch = Phase 1, FR-REL-1 (stub): a minimal `POST /relay` that submits the G1 stub's signed `receiveWithAuthorization` pull with the relayer key and returns the tx hash, plus a `GET /health` skeleton. Stack: TypeScript, viem 2.57.13 (no ethers), deployable on Vercel; Neon only when rate limits arrive in Phase 2."
Agent ids (builders, for SendMessage resumes): builder = claude-relayer (this session)
Log:
- 20:59 asked claude-contracts for the PullStub `pull()` signature + address; proposed: their forge script submits the G1 pull, /relay sends a second pull after it is mined (shared relayer key, avoid nonce clash)
- 21:00 batch started; Vercel Web-standard handler format verified in the docs (functions-api-reference, runtimes/node-js)
- 21:02 spec written (FR-REL-1 stub, FR-REL-6 skeleton, FR-REL-3 simulate-before-send)
- 21:07 claude-contracts' G1 pull mined (0xc4629df1…847e); PullStub 0x51e2…325d checked with cast; ABI matches
- 21:09 build READY: tsc 0, 4/4 tests; live /health matches cast
- 21:11 human approved the live run; 21:12 relayed pull 0x9f5efc75…e000 (91,164 gas), replay → 422, relayer nonce unchanged
- 21:14 round 1: tester
- 21:20 round 1 tester: CHANGES (simulation RPC failure answered 422 not 502; 4 KB cap counted chars). Reviewers not run on round 1 (known-bad code); builder fixed both → round 2 runs tester + 3 reviewers + ci
- 21:23 round 2 started
- 21:35 round 2 tester: CHANGES (-32603 still 422; dev.ts new URL outside try crashed on a malformed target). Reviewers not run (known-bad code); builder fixed both (tests 18/18)
- 21:38 round 3 started (last allowed): tester, then reviewer-code + reviewer-security + reviewer-ux-ui, then ci
- 21:45–21:59 round 3: tester PASS, reviewer-code PASS (3 LOW), reviewer-security PASS (localhost stub; S1–S11 for Phase 2), reviewer-ux-ui PASS, ci PASS (clean npm ci, tsc 0, 18/18, secret scan clean)
- 22:01 human gate (proof: live tx 0x9f5efc75…e000 + replay 422, shown 21:12). Human decisions:
  1. Ship as reviewed; scoped apps/relayer/.env (only RELAYER_PRIVATE_KEY) is the first item of the Phase 2 batch
  2. No RELAYER_PRIVATE_KEY in any Vercel project until the Phase 2 drain-guard batch passes
  3. Only /relay sends from the relayer key; scripts and keepers use the deployer key or POST /relay
  4. Reject any payer with code (eth_getCode != 0x), incl. EIP-7702-delegated EOAs; smart wallets can self-submit (FR-REL-7)
