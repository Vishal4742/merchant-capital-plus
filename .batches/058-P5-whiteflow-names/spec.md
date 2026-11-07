# Spec: 058-P5-whiteflow-names

The site shows the product's new name, WhiteFlow, now. Request (human, 2026-11-07 06:18): "yes I want that now" (the
WhiteFlow name live before G5, split out of PR #43). Names only: #43's redesign (tokens, cards, landing, logo) stays
in #43, which merges after both G5 runs.

## Requirements (cite docs/SRS.md IDs)
- FR-PAY-7: the pay pages name the shop and the product in plain words; the product name is now WhiteFlow.
- FR-GW-1 / FR-GW-4: the hosted checkout, link and page sheets carry the product name in their frame.

## Change
- Visible "Merchant Capital+" text in apps/web becomes "WhiteFlow": the root title and description (#43's exact
  strings), page titles (capital, holdings), the dashboard wordmark (Shell), the gateway frame (Frame), the landing
  wordmark (Hero, Sections), /docs, /proofs, the not-found sheet, the investor app header, the link page's
  "About" action, the SIWE statement.
- NOT changed: `lib/invoice-ack.ts` `ackDomain.name` (EIP-712 domain: renaming it breaks every signed acknowledgement),
  `tokens.css` (a comment), docs, the README, contracts.

## Acceptance criteria
- [ ] `git grep "Merchant Capital" apps/web/app apps/web/components apps/web/lib` lists only invoice-ack.ts and tokens.css.
- [ ] apps/web typecheck, lint and `npm test` pass.
- [ ] After the deploy, whiteflow-app.vercel.app's `<title>` is "WhiteFlow — Business Payments Workspace".

## Files to touch (owner lane: claude-contracts at the owner's request; only these)
apps/web/app/{layout.tsx,capital/page.tsx,capital/holdings/page.tsx,docs/page.tsx,l/[slug]/page.tsx,proofs/page.tsx},
apps/web/components/{NotFoundSheet.tsx,capital/investor/InvestorApp.tsx,dashboard/Shell.tsx,gateway/Frame.tsx,
landing/Hero.tsx,landing/Sections.tsx,merchant/SignIn.tsx}, .batches/058-P5-whiteflow-names/**
