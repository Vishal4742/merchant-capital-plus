# Whitechain workshop + Anon-RPC test (2026-11-05 ~17:50 IST)

## Anon-RPC → Whitechain: TESTED, works
- Live demo https://ethereum.github.io/anon-rpc/demo/ with Worker RPC URL = https://rpc.ankr.com/whitechain_testnet, watching 0x4200…0006 (WWBT).
- **tor-js:** bootstrap ~17 s, then `eth_getBalance OK in 2803 ms — 5,862.613604`.
- **Nym:** `eth_getBalance OK in 1613 ms — 5,862.613604`.
- Direct read via cast: 5862.613604718… (match). So both anonymizing networks reach Whitechain's RPC.
- Notes: the app chooses the URL (`worker.fetch(url, …)`, wallet guide). The bootstrap RPC must be on the specifier's chain (mainnet for tor-js/Nym). rpc.testnet.whitechain.io is behind Cloudflare (could challenge Tor); Ankr isn't and sends CORS `*`. The tor-js demo gateway is "demonstration only… may disappear", so keep Nym as the fallback. The repo also has `impl/node-harness` (earlier "browser-only" note was wrong).
- EF rule: "You can submit to anon-rpc, the alt mempool and CROPS, but you will be placed in at most one." Judging includes "how much of the app's traffic goes through Anon-RPC"; disclosed exclusions are OK.

## Whitechain workshop: "How to Win on Whitechain" (Toma Sadova, strategic partnerships lead) https://www.youtube.com/live/Xj2H-j1joP8
- "Build what business actually needs": everything a real business could use. Example: a coffee shop that needs to accept USDT. Infra usable by web3 **or web2** businesses: "payments, it could be any kind of oracle infrastructure".
- **Tokenize is broader than RWA:** "not only limited to RWA… could be some DeFi, could be perp DEX, could be borrowing and lending protocol".
- **Positioning: B2B2C.** "We're looking for the product who's working with B2C. We could help with their finances, distribution, legal… this concept of B2B2C is something that we're looking for."
- Scale: hide that you use a blockchain; improve the product with it without showing it up front.
- They encourage AI tools (Claude Code etc.). Operate has 3 places; the others have 2. "You could go to a few tracks at the same time."
- Six qualification items (same as the one-pager). On the "why onchain" line they reject products where blockchain isn't needed ("could be done by Stripe").
- They check the public repo and the Whitechain deployment. **Judging day: you come to their booth with "strict timelines within two, three minutes."** A feedback page is "extremely important".
- Builders Program: up to $300k, milestone-based (3–5 milestones, paid in stables), answer within ~14 working days; **hackathon placers get priority**.
