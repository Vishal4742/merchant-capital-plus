VERDICT: PASS

Reviewer: ux-ui, round 2. Checked on :3100 (not restarted) with my own Playwright contexts at 375 and 1440, light and dark. Fake-wallet sign-in with a throwaway key (any address signs in, so it shows the non-shop notice). Shots: round-2/shots-ux/ (merchant-home-*, merchant-out-*, docs-*, checkout-*). The checkout is a USDT one from "Try a checkout" (25.00). The EUR line was judged from the builder's shot b009/shots/r2/checkout-eur-375-dark.png: "20.00 EUR = 22.51 USDT · rate of 6 Nov 2026 · 1 USDT = 1 USD" fits and reads clearly, total 22.51 in large tabular figures, countdown pill, "Pay exactly 22.51 USDT" line.

## Round-1 findings
- F1 fixed. The night band at 375 is about 170 px with the dither visible behind the greeting, in light and dark (merchant-home-375-dark.png). The top bar is one row: wordmark, address, Sign out; the menu sits below.
- F2 fixed. The button reads "Hold to pay 25.00 USDT" on the checkout at all four viewport and scheme combinations; the builder's EUR shot shows "Hold to pay 22.51 USDT". The test-mode strip still says Whitechain; that is the FR-GW-14 strip, so it is allowed.
- F3 fixed. The /docs code blocks are role=region, tabIndex 0, labelled "Code: the pay button snippet" and so on. They wrap at 375 (pre-wrap, no overflow) and scroll from md up. Tab shows a solid 2 px outline on the block.
- F4 fixed. The four Copy buttons are named ("Copy the pay button snippet" etc.), 44 px high. After a click the role=status region says "Copied the pay button snippet", and the other regions stay empty.
- F5 fixed. A non-shop wallet sees one notice card (amber, one place), and the Invoices duplicate is gone from the home page.
- The neutral "0 vs yesterday" is shown as plain text with no arrow or colour.

## Other checks
- No horizontal overflow: scrollWidth equals innerWidth (375 or 1440) on /, /merchant (signed out and in), /docs and /checkout, in both schemes.
- Customer words: the checkout body has "Whitechain" only in the test-mode strip. No wallet, sign, gas or chain words on the checkout.
- Contrast: body text, amber notice (light and dark), grey SOON items and the blue strip are readable; no failures seen.
- Tokens and v2 language: the cards, mono caps labels, italic serif accent, brand-blue strip and pill buttons are reused; nothing new spotted.

## Remaining (low, not blocking)
1. /docs at 375 (docs-375-light.png): wrapped code breaks inside identifiers ("GATEWAY_SECRE / T_KEY", "SIGNATURE_HEA / DER"). Fix: use `overflow-wrap: anywhere` only for the URL block and leave code to scroll, or accept it. Owner: claude-frontend.
2. Not verified: the expired and paid checkout states, the pending-tx state (no payment made), and the spring hover. Carried from round 1.

PASS
