VERDICT: CHANGES

Reviewer: ux-ui, round 1. Checked on :3100 at 375 and 1440, light and dark, signed in with a throwaway-key fake wallet (any address can sign in, so the dashboard showed the empty states). EUR session made with SHOP_API_KEY (never printed). Probes: round-1/probes/{ux,co,d}.mjs. Shots: round-1/shots/. No horizontal overflow on /merchant, /docs or the checkout at either width; no console errors; /docs Copy buttons are 44 px; no target under 44 px on /merchant.

Not verified: the expired and paid checkout states (a 10-minute session; I did not wait it out; the builder's expired shot was not re-checked), the demo-message tone, and the receipt rows (no payment made). The spring hover and the ASCII reveal are code-only: I did not capture them. Reduced motion was only tried on /docs for focus.

## Findings

### F1 (medium) Fidelity: the merchant home drops the demo dashboard's night band at 375 and the greeting loses its place
- Shot: shots/merchant-home-375-dark.png, shots/merchant-menu-375-light.png
- What: at 375 the band is a thin dithered strip behind "Tonight at your shop.", cropped to roughly 20 px of art above the text. The demo's band reads as a hero. The top bar (wordmark, address, Sign out) stacks on three rows before the menu. Sign out is far from the menu.
- Fix: give the band a min-height of about 160 px at 375 and keep the dither visible behind the greeting; put the address and Sign out on one row with the wordmark.
- Owner: claude-frontend

### F2 (medium) Customer flow: the checkout strip says "Whitechain" and the button omits the unit
- Shot: shots/checkout-eur-375-dark.png, shots/checkout-eur-1440-light.png
- What: the strip is required by FR-GW-14 and spec allow-lists it, but at 1440 the customer reads "Whitechain testnet · no real money moves" on /checkout. The button reads "Hold to pay 22.50" with no currency, while the total above it says USDT.
- Fix: keep the strip but make it "Test mode · no real money moves" on /checkout/* and /r/* only if FR-GW-14 allows the shortened text (ask claude-research); otherwise leave it. Make the button "Hold to pay 22.50 USDT".
- Owner: claude-frontend (button); claude-research (strip wording on customer pages)

### F3 (low) /docs: code blocks scroll sideways but cannot be reached by keyboard
- Shot: shots/docs-375-light.png
- What: three `<pre>` blocks overflow at 375 (tabIndex -1, scrollWidth over clientWidth). The first line of each snippet is cut off with no scroll hint, so a user cannot read the full snippet without a mouse or touch.
- Fix: add `tabIndex={0}` with an `aria-label` ("Code, scrollable") to each `<pre>`, or wrap long lines (`whitespace-pre-wrap`) at 375.
- Owner: claude-frontend

### F4 (low) /docs: the Copy button is the only label and it sits alone
- Shot: shots/docs-375-light.png
- What: "Copy" is right-aligned above each block, with no name for screen readers beyond "Copy". Three identical buttons.
- Fix: `aria-label="Copy the button snippet"` etc.; show "Copied" in a live region after the click.
- Owner: claude-frontend

### F5 (low) Merchant home: "—" tiles and the warning line
- Shot: shots/merchant-home-1440-light.png
- What: Refunds and Vouchers used show "—", with Vouchers captioned "Soon", which is right. The warning "The demo shop is paid to 0x37F9…42B1, not this wallet, so its test payments won't show here." is a plain sentence floating above the tiles in amber; it passes contrast but reads like page text. Also the Invoices card repeats the same fact.
- Fix: put both messages in one notice card (the design's existing warning tone), shown once.
- Owner: claude-frontend

## Passed
- FX line: "20.00 EUR = 22.50 USDT · rate of 5 Nov 2026 · 1 USDT = 1 USD", right-aligned and legible at 375; "Pay exactly 22.50 USDT, no more and no less. No fees for you." present; countdown pill "9:27 left to pay"; no gas, WBT, sign or chain words in the body (only the strip).
- Test-mode strip on /merchant, /docs and /checkout at both widths, one strip per page, white on brand blue, mono, tone calm and clear. Short text at 375, longer at 1440.
- Sidebar at 1440 (Home, Payments, Invoices active; unbuilt items greyed with SOON and not links); the 375 menu opens as a details list with the current page named. The KPI tiles, flat 7/30-day chart with its empty line, quick actions and the "Who pays gas" card all fit the demo's vocabulary and reuse tokens.
- /docs: the three steps are clear and ordered; the "available when the SDK ships" chip is honest; the test keys box shows no key; the "Before you go live" list is useful; the simulate button is 48 px.
- Focus is visible (2 px solid outline) on the first Copy button reached by Tab at 375.
