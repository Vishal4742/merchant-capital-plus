# Spec: 046-P5-walletconnect (Pay with Privy: any wallet, email or QR)

Direction change (human 19:56, via the coordinator): "Use Privy". Same batch, branch and PR; Privy's modal replaces raw
WalletConnect.

## Requirements (cite docs/SRS.md IDs)
- FR-PAY-16 (pay with your own wallet): under "Pay with your wallet" the customer can use the browser wallet directly
  (the batch 032 injected path, shown only when `window.ethereum` exists) or open Privy's modal, which offers browser
  wallets, phone wallets over WalletConnect (QR on desktop, deep link on a phone) and email (Privy's wallet). A customer
  on a phone browser with no injected wallet can now pay. Every route feeds the same signing path
  (lib/payer-wallet.ts `connectPayer`): add or switch to Whitechain Testnet (1874), the same funds check through our
  server, the same EIP-3009 typed data via `eth_signTypedData_v4`, the same POST to the same pay route. Never a
  transaction. The Privy session is closed (wallet disconnected, Privy logout, tree unmounted) after every attempt.
- FR-PAY-7: the default guest path keeps its words; only the wallet block (data-pay-option="wallet") says "wallet".
- FR-PRIV-1: the pay pages still make no browser chain reads: our 1874 RPC is in Privy's chain config, but no RPC host
  is in the pay pages' connect-src, so a read can't leave the page even by mistake. What Privy's servers receive is
  listed in the PR and the report (the README must disclose it).
- NFR-4: a Privy approval lands on the same pay route and relayer path, so the 5 s budget from signing holds.
- NFR-12: `@privy-io/react-auth` loads only when the customer presses the Privy option (dynamic import of
  components/PrivyPay.tsx); the sheets never import it, so the checkout's first load does not grow.
- AT-17: a visitor with a wallet holding test USDT and 0 WBT chooses Pay with your wallet → one signature prompt, no
  transaction, the payment lands in one tx. Covered for Privy's provider by a fake EIP-1193 wallet in node:test (no real
  wallet, no real signature).

## Design
- `@privy-io/react-auth` pinned exactly; `useConnectOrCreateWallet` (a wallet is only connected, no sign-in message;
  email creates Privy's wallet), `wallet.getEthereumProvider()` → `privyPayer` → `connectPayer`.
- Chain: viem `defineChain` for 1874 with our RPC, the only `supportedChains` entry and the `defaultChain`.
- `NEXT_PUBLIC_PRIVY_APP_ID` (public). Unset or malformed: the Privy button is not rendered. Optional
  `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` → `walletConnectCloudProjectId`. Names added to `.env.example`.
- Privy exposes no analytics or telemetry switch in `PrivyClientConfig` (checked in 3.51.0's types); none to turn off.
- CSP (Privy's CSP guide): connect-src auth.privy.io, the WalletConnect relay (wss .com/.org), explorer-api;
  frame-src auth.privy.io and WalletConnect verify (.com/.org); only on /checkout/*, /pay/*, /l/*, /p/*.
  No Coinbase (walletlink), no rpc.privy.systems, no Cloudflare captcha.
- `apps/web/.npmrc` `legacy-peer-deps=true`: Privy's x402/Solana optional peers conflict (ox, @solana/kit) and npm ci
  refuses the lock otherwise.

## Acceptance criteria (each must be checkable)
- [ ] test/privy-pay.test.mjs: IDs validated (unset/blank/malformed → null), chain 1874 only with our RPC, wallets +
      email, no Coinbase, the Privy button only behind the app ID check, Privy only dynamically imported, both sheets
      close the session after every attempt.
- [ ] test/payer-wallet.test.mjs: a Privy wallet's provider is asked for one `eth_signTypedData_v4`, never a
      transaction method, and the pay route relays it; provider failure and cancel are plain sentences.
- [ ] test/csp-routes.test.mjs: pay-sheet routes list exactly Privy's hosts; /r, /counter, /docs,
      /merchant/developers stay 'self'; no RPC host on the pay pages.
- [ ] `npm run typecheck && npm run lint && npm test && npm run build` pass.
- [ ] `next start` with a dummy app ID: the Privy modal opens on a checkout; CSP violations recorded.
- [ ] `npm audit --omit=dev` result recorded.

## Files to touch (owner lane: only these)
- apps/web/package.json, apps/web/package-lock.json, apps/web/.npmrc (new)
- apps/web/lib/privy-config.ts (new), apps/web/lib/payer-wallet.ts
- apps/web/components/PrivyPay.tsx (new), apps/web/components/WalletPay.tsx, apps/web/components/Checkout.tsx,
  apps/web/components/InvoicePay.tsx
- apps/web/next.config.ts
- apps/web/test/privy-pay.test.mjs (new), apps/web/test/payer-wallet.test.mjs, apps/web/test/csp-routes.test.mjs
- .env.example (variable names only)

## Ponytail ladder (why this is the smallest change that works)
- Privy's own modal covers wallet list, QR, deep links and email; no hand-built screen.
- No new signing code: a Privy wallet is just another EIP-1193 provider into `connectPayer`.

## Out of scope
- Server routes, contracts, relayer. README disclosure (claude-research owns README). Real wallet runs (the human, on
  the Vercel preview with the real app ID).
