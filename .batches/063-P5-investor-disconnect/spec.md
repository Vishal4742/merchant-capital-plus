# Spec: 063-P5-investor-disconnect

## Requirements (cite docs/SRS.md IDs)
- FR-ADV-3 (the investor offer book) and FR-UX-4 (labelled controls, a way back out of every state): an investor who connected a wallet can disconnect it from the Capital pages.

## Acceptance criteria
- [ ] With a wallet connected (ready, or wrong network), the bar shows a "Disconnect" button (accessible name "Disconnect wallet").
- [ ] Disconnect shows Connect at once, asks the wallet to revoke this site (wallet_revokePermissions eth_accounts; a wallet without it is fine), and a reload or an accountsChanged event does NOT reconnect silently.
- [ ] Connect clears that, and the next loads reconnect silently again as today.
- [ ] Storage blocked (private mode) breaks nothing: Disconnect still shows Connect for this page.
- [ ] 375 + 1440: no h-scroll; tsc, lint, npm test, build.

## Files to touch
- apps/web/components/capital/investor/useInvestor.ts, components/capital/investor/InvestorApp.tsx (WalletChip), test/investor-disconnect.test.mjs (new)

## Ponytail ladder
- One localStorage flag (mcplus.investorOff) + one wallet request; no new dependency.

## Out of scope
- The checkout/invoice wallet (already ends after each attempt) and the dashboard (has Sign out).
