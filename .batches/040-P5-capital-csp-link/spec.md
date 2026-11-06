# Spec: 040-P5-capital-csp-link

## Requirements (cite docs/SRS.md IDs)
- NFR-8 (no third-party trackers; enforced by CSP review): /capital and /capital/holdings (PR #33, FR-ADV-3 investor
  funding) get the same Content-Security-Policy as /merchant: scripts 'self', calls only to 'self' and the Anon-RPC
  hosts (FR-PRIV-1, FR-PRIV-4), worker blob:, frame-ancestors 'none'. Today they ship with none.
- FR-ADV-3: an investor can reach the offer book: a "Browse offers" link to /capital in the landing page's Capital
  section and its footer.
- FR-INV-1/FR-ADV-1 copy (UX #28 follow-up, claude-research 16:51 "fix that copy in a follow-up only if it's wrong"):
  the landing card is a part-funded invoice, so it has 1 investor (the 2nd investor takes the last slot and buys all
  left, capital-fund.ts), and the section text names both ways to raise cash, not only the advance.
- FR-GW-10 + FR-GW-15 (claude-research 17:08): /merchant/settlements shows the balance once, in #30's Withdraw card;
  the old "Wallet balance" card in components/gateway/Settlements.tsx goes, the T+0 card stays.

## Acceptance criteria (each must be checkable)
- [ ] test/csp-routes.test.mjs: /capital/:path* carries exactly the /merchant/:path* policy, and no later rule
      overrides /capital (for one header the last matching rule wins).
- [ ] `curl -I` on a `next start` of this build: /capital and /capital/holdings answer with that policy.
- [ ] Landing: "Browse offers" in the Capital section (and footer) goes to /capital, 375 and 1440, light and dark.
- [ ] test/capital-entry.test.mjs: the landing links to /capital, the part-funded card says "1 investor", the text
      names invoices and advances.
- [ ] /merchant/settlements: one balance (Withdraw's), the T+0 card full width and readable, 375 and 1440.
- [ ] tsc, lint, web tests, build pass.

## Files to touch (owner lane: only these)
- apps/web/next.config.ts, apps/web/test/csp-routes.test.mjs (new)
- apps/web/components/landing/Sections.tsx (Capital section + footer only; #28 merged 17:08), test/capital-entry.test.mjs
- apps/web/components/gateway/Settlements.tsx, app/merchant/settlements/page.tsx (drop the merchant prop only; #30 merged)

## Ponytail ladder (why this is the smallest change that works)
- One headers() entry reusing merchantCsp; one anchor reusing buttonClasses("quiet") like "Read the developer docs".

## Out of scope
- app/capital/** and components/capital/** (PR #33, #32); the merchant Capital page's own link (#32).
