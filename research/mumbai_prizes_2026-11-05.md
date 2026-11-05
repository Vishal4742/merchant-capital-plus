# ETHGlobal Mumbai prizes (fetched 2026-11-05 09:30 IST from ethglobal.com/events/mumbai/prizes)

Max 3 partner prizes per project. "Cont" = Continuity Track only (existing projects; not for us).

| Sponsor | Track (non-Continuity) | $ | Split |
|---|---|---|---|
| World | ID Agent Pass | 5,000 | 2.5/1.5/1 |
| World | Best Use of IDKit | 2,500 | 2 × 1.25 |
| 1inch | Build an Aqua App (SwapVM bonus) | 5,000 | 2.5/1.5/1 |
| 0G | Build with 0G PC (Private Computer inference, request IDs) | 5,000 | 2.5/1.5/1 |
| 0G | Physical AI: Agents with a Body (sim OK) | 5,000 | 2.5/1.5/1 real-hw |
| 0G | Agents That Pay for Themselves | 2,000 | 2 × 1 |
| Uniswap | Build with Uniswap (FEEDBACK.md + form) | 10,000 | 4/3/2/1 |
| Arc | DeFi app in Arc Studio / Consumer agent + Nanopayments / Advanced stablecoin contracts / Bridge Kit non-USDC | 3,000 each | unspecified |
| Hedera | AI Agents That Pay: x402 on Hedera | 6,500 | 3/2/1.5 |
| Hedera | Tokenize Anything (ATS / Stablecoin Studio) | 5,000 | 2.5/1.5/1 |
| Hedera | No Solidity Allowed (SDK, 2 native services) | 2,000 | 2 × 1 |
| Arkiv | Mirror something Ethereum depends on | 4,000 | 3/1 |
| Arkiv | Build on Arkiv (from scratch) | 4,000 | 3/1 |
| Arkiv | Node tooling | 2,000 | — |
| Arkiv | + Swarm bonus | 500 | — |
| Whitechain | Operate · Stablecoin Payments for Business | 5,000 | 2.5/1.5/1 |
| Whitechain | Tokenize · RWA in USDT, rules enforced in contract | 4,000 | 2.5/1.5 |
| Whitechain | Scale · Payments Nobody Notices (gasless) | 3,000 | 2/1 |
| EF (1 per project) | Best Use of Anon-RPC | 5,000 | 2.5/1.5/1 |
| EF | Frame Transaction Alternative Mempool | 5,000 | 2.5/1.5/1 |
| EF | Best CROPS App | 3,500 | 2/1/0.5 |
| ENS | Best Use of ENSv2 | 7,000 | 3/2/1/1 |
| Chainlink | Best workflow with CRE (simulation OK) | 1,500 | — |
| Chainlink | CCIP 2.0 in contracts, state change | 3,500 | 2 × 1.75 |
| Definitive | Flash Advanced Orders (Continuity only) | 2,500 | — |

Full requirement text: re-fetch the page; key "won't qualify" lines:
- World Agent Pass: a login screen without a meaningful action that needs human identity/approval.
- 0G PC: generic chat wrappers; AI call removable without anyone noticing. Physical AI: chatbot with robot avatar, pre-recorded motion, 0G only for logs.
- 0G Agents That Pay: token launch + chatbot; agents whose wallet a human refills.
- Hedera x402: agent must find endpoint and pay with no human approval; extra points spend controls, ERC-8004, HCS audit log.
- Whitechain Scale: payer signs a gas-costing tx; AI chats that never pay anyone.
- Arkiv: SDK never used for reads; Arkiv as a log nothing reads.

## Past winners per sponsor (research/ethglobal_winners_11_events.json)
Share of a sponsor's prize-winning projects that were also finalists (avg 6.2%):
0G 21% (6/28) · Chainlink 19% (7/37) · Hedera 10% · 1inch 7% · ENS 5% · Uniswap 5% · World 4% · Arc/Circle 4% · EF 0% (9 wins, 3 events).
Repeat multi-sponsor finalists: VEIL VPN (Arc Nanopayments + World ID + ENS, 3× 1st), DIVE (World + Hedera + 0G), ENShell (Chainlink CRE, agent safety).

## Research agent findings (2026-11-05 ~09:30)
**EF:** Anon-RPC = github.com/ethereum/anon-rpc (MIT, "working reference prototype"), `@anon-rpc/browser-harness`, browser-only, plug as viem `custom()` transport; networks tor-js / Nym / Nox; guess 15–40 entries. Frame Tx = EIP-8141 (Draft, type 0x06, VERIFY/SENDER frames, APPROVE opcode); alt mempool = ERC-8421 (stake/reputation, `pre_verify` frame); devnet chain 1337 (ethrex), RPC altmempool.forshtat.com, explorer explorer.altmempool.wtf; workshop repo github.com/forshtat/mempool-workshop gets an admitted tx in 8 steps; devnet can reset; guess 5–15 entries; isolated from other sponsors' chains. EF workshop today 17:00 IST, Workshop Room 2.
**Arkiv:** ex-Golem DB; entities with ≤32 attributes + expiry; TS `@arkiv-network/sdk` (viem); Rabdi testnet chain 7794095, faucet hub.arkiv.network; SDK broke at v0.7, agents hallucinate old API; public data, filter by `$owner`. Guess build 15–30, mirror 5–12, node tooling 0–4 (node is "scaffold only").
**1inch Aqua/SwapVM:** shared liquidity registry, LPs keep funds; SwapVM bytecode per order, custom opcodes via `_dispatch`; same address on 17 chains incl. Arc 5042, no testnet → mainnet fork; build vs v1.0.2, solc 0.8.30 cancun via_ir; guess 10–25 entries; past winners are sophisticated (options, curve order book, formal verification).
**Agent payments:** World "Agent Pass" = World IdP OIDC at auth.world.org (device-code grant RFC 8628 for headless agents, step-up via max_age=0 + acr, RFC 9470 `insufficient_user_authentication`), NOT World AgentKit. x402 v2 = x402-foundation/x402, `@x402/evm` accepts any `eip155:<id>`; EVM exact = EIP-3009; no listed facilitator for 1874 → run our own (verify USDT EIP-712 name/version on-chain first). x402 on Hedera = partial TransferTransaction, facilitators x402.org / Launa / Blocky402, testnet USDC 0.0.429274. 0G PC = OpenAI-compatible router-api.0g.ai/v1, X-Request-ID, `verify_tee`. 0G "Agents That Pay" needs earnings in 0G → skip. Arc consumer-agent track must be built in hosted Arc Studio → skip.
