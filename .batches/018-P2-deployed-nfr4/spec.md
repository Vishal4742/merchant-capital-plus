# Spec: 018-P2-deployed-nfr4 (phase mode, Money: yes)

## Requirements
- **NFR-4:** a relayed sale confirms in ≤ 5 s. Measured on the deployed URL https://merchant-capital-relayer.vercel.app (the demo's URL), where claude-frontend's sale 0xcfeafa20…4bc1 took 7.31 s, against 4.40 s on the local relayer.
- **FR-REL-1:** the `POST /relay` 200 keeps its fields and adds `timings`. No secrets, no key, no RPC URL.

## Facts (09:24)
- Whitechain block time is 1 s (averaged over the last 10 and 50 blocks).
- Venue → Ankr `eth_blockNumber`: 643 ms cold, ~181 ms warm.
- Venue → deployed `/health`: 260–480 ms (`x-vercel-id` bom1::iad1).
- `api/relay.ts` and `api/health.ts` are separate Vercel functions, so `/health` pings don't warm `/relay`'s instance or its RPC socket.

## Changes, step 1 (measure)
1. `src/relayer.ts`: the 200 body gains `timings` = `{cold, checks, queue, presend, send, receipt, total}`, each a whole number of ms. `cold` is true on the first relay of the process.
   - `checks`: parse through the RPC pre-check round.
   - `queue`: waiting for the send lock.
   - `presend`: simulate ‖ nonce, plus signing.
   - `send`: `eth_sendRawTransaction`.
   - `receipt`: polling.
   - One `console.info` line per sale carries the same numbers and the txHash.
2. Test first: a 200 carries the `timings` fields as numbers that sum to ≤ total, and `cold` is a boolean.

## Step 2 (fix the biggest step, chosen from the numbers)
- Candidates: one Vercel function for `/relay` + `/health`, so health pings keep the relay instance and socket warm; a faster receipt poll in the first second; another RPC if the iad1 → Ankr RTT dominates.
- Each candidate gets its own spec addendum and test before code.

## Acceptance criteria
- [ ] `npm test` + `npx tsc --noEmit` pass (53 + new).
- [ ] Deployed: a reject-probe series (cold, then warm) recorded with timings from the client side.
- [ ] ONE live 1.00 USDT sale through the deployed relayer (human 09:31) with its `timings`, then the fix, and the result recorded. A second sale needs another yes from the human.
- [ ] Relayer ≤ 0.5 WBT; nonce and balance recorded before and after.

## Files to touch
- apps/relayer/src/relayer.ts, apps/relayer/test/relayer.test.ts (+ api/*.ts and vercel.json only if step 2 merges the functions).

## Out of scope
- Postgres lock / rel_sent (post-deadline follow-up).

## Step 2 addendum (09:40, from the probe + claude-research 09:38)
- **One function:** `api/relay.ts` also exports `GET` (the existing `health`). `vercel.json` rewrites `/health` → `/api/relay`, and `api/health.ts` is deleted. Then a `/health` ping warms the same instance and the same RPC socket that `/relay` uses. claude-frontend adds a fire-and-forget server-side `GET /health` when a checkout opens (their file).
- **`"fluid": true`** in `vercel.json`. The schema says Fluid compute is on by default for new projects; pinning it means a project setting can't drift.
- **Receipt poll 300 → 250 ms** (it already starts right after the send).
- Test first: `test/deploy-config.test.ts` checks that `/relay` and `/health` go to the same function and that `fluid` is true. dev.ts serves `/health` from `api/relay.ts`, so the existing dev tests cover the route.
