VERDICT: PASS

Checked: shots btn-375-light-focus.png and btn-375-dark-focus.png (round-1/shots/), button.js, README button section.

## Customer
- Label: "Pay with USDT" / "Pay 25.00 USDT" is acceptable. The shop embeds it, FR-PAY-7 covers the hosted pages, and USDT is the price currency, not chain jargon. No gas/WBT/sign/chain words. Amounts show 2 decimals in the README example.
- Contrast: white on #3b4fd9 is about 6.4:1 (AA). Reads fine on light and dark pages in both shots.
- Focus ring: visible on light (blue) and dark (white) in the shots. It is the browser default and thin, but it works.
- Touch target: 16px x 1.25 line-height = 20px + 12px x 2 padding = 44px tall. Meets the 44px minimum exactly. Width is well above 44px.
- 375: no overflow, no clipping.
- Bad id: nothing renders, one console error. Acceptable for a developer mistake. The customer sees an absent button, not a broken one.

## Shop developer
- README: the one-liner, data-link and own-element/React path are clear and short. The "SESSION_ID comes from your server" line is the key sentence and is present.
- Inline style: easy to replace by marking your own element. Fine.
- SDK snippet: amount check, markPaidOnce with event.id dedupe, and config errors rethrown as 500 are all clear.

## FOLLOW-UP (MEDIUM/LOW)
- LOW, button.js:36 (btn-375-dark-focus.png): no :hover/:active/:disabled state, no custom focus ring. Shops wanting more style their own element. Fix: document one line in README that .mc-pay-button can't be styled by CSS without !important because styles are inline. Owner: claude-sdk.
- LOW, README line 18: say a shop with a strict CSP (style-src without 'unsafe-inline') will get an unstyled button; point those shops to the own-element path. Owner: claude-sdk.
- LOW: add one README line that the bad-id case is silent for the customer by design.
