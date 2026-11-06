# Spec: 029-P4-web-onboarding

## Requirements (cite docs/SRS.md IDs)
- FR-PAY-15 (merchant signs in with its own wallet, SIWE): a new merchant goes from no wallet to signed in without help:
  wallet found or an install link, add Whitechain Testnet (wallet_addEthereumChain, chain 1874), sign in (SIWE, unchanged).
- FR-GW-1 (payment links) / FR-GW-6 (API keys): the home shows a 4-step Get started checklist computed on the server
  (link, share, first payment, keys) with one primary next action.
- NFR copy rule: plain sentences, test mode stated, no jargon on customer pages.

## Acceptance criteria (each must be checkable)
- [ ] Signed-out /merchant (and every /merchant/* page) shows the three steps with live statuses; no horizontal scroll
      at 375; 0 CSP violations under each page's existing CSP.
- [ ] wallet_addEthereumChain gets exactly chainId 0x752, the chain name, WBT 18 decimals, the official RPC and explorer URLs
      pinned to viem's whitechainSepolia in test/onboarding.test.mjs, plus Ankr as a second RPC (ARCHITECTURE.md RPC row;
      security 029 F2).
- [ ] SIWE domain, nonce, 5-minute expiry, chain 1874 and statement unchanged; new error copy for cancel, pending
      request, expiry, 503 and offline.
- [ ] Checklist counts from listLinks/listKeys/confirmed payments; unreadable data says "Can't check now"; 4 of 4 folds.
- [ ] tsc, lint, web tests, build pass.

## Files to touch (owner lane: only these)
- apps/web/app/merchant/page.tsx, components/gateway/Frame.tsx, components/merchant/SignIn.tsx
- apps/web/lib/onboarding.ts, components/dashboard/GetStarted.tsx (new)
- apps/web/test/onboarding.test.mjs (new), test/test-mode.test.mjs (one allowed name)

## Ponytail ladder
- Reuses the existing SIWE flow, listLinks/listKeys and the home's payment reads; no new dependency, no new table.

## Out of scope
- Email or social sign-in; a stored onboarding state.
