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
- Round 2 (human 06:26: "changes throughout the project"): also `lib/invoice-ack.ts` `ackDomain.name` is "WhiteFlow".
  Safe: the server verifies an ack's signature once, on POST, and stores the result (invoice-acks.ts never re-verifies),
  and the browser and server share the one constant, so only new acks use the new domain. Also the MCP manifest author,
  the Safe owner message (contracts/script/MoveAdminToSafe.s.sol; no owner has signed yet), the generated contracts
  headers (export-abi.sh, packages/shared, apps/relayer copy), ci.yml and tools/status.py comments, the demo shop's
  README and page.
- NOT changed: packages/sdk/* and its copies (apps/shop/lib/sdk.ts, apps/web/public/v1/button.js): claimed by
  claude-sdk (batch 057), asked to rename there. Technical ids (mcplus.* storage keys holding funded G5 wallets,
  mc_session, @merchant-capital/* package names, repo and URL names). contracts/src (frozen, verified on Blockscout).
  `tokens.css` (a comment). Docs and the README: claude-research's (asked).

## Acceptance criteria
- [ ] `git grep "Merchant Capital" apps/web/app apps/web/components apps/web/lib` lists only invoice-ack.ts and tokens.css.
- [ ] apps/web typecheck, lint and `npm test` pass.
- [ ] After the deploy, whiteflow-app.vercel.app's `<title>` is "WhiteFlow — Business Payments Workspace".

## Files to touch (owner lane: claude-contracts at the owner's request; only these)
apps/web/app/{layout.tsx,capital/page.tsx,capital/holdings/page.tsx,docs/page.tsx,l/[slug]/page.tsx,proofs/page.tsx},
apps/web/components/{NotFoundSheet.tsx,capital/investor/InvestorApp.tsx,dashboard/Shell.tsx,gateway/Frame.tsx,
landing/Hero.tsx,landing/Sections.tsx,merchant/SignIn.tsx}, .batches/058-P5-whiteflow-names/**
