VERDICT: CHANGES

# G4 phase review, part 2: UX/UI (reviewer: claude-ux-ui)

Method: headless Chromium, mobile emulation (isMobile, 375x812) and 1440x900, against http://localhost:3100. Merchant sign-in was unavailable (wallet sign-in), so /merchant/vouchers, /reports, /settlements and /developers were reviewed from code in apps/web/components/gateway/*.tsx. Their 1440 and 375 screenshots show only the sign-in card (vouchers-1440.png, etc.). I created one unpaid checkout session from the /p/ link to reach the discount field. I applied only the code NOPE and paid nothing.
Shots: /Users/vg890/ethglobal-docs/.batches/G4-phase-review/round-2/shots/

## Findings

### H1. FR-PAY-7: the live demo shop shows "gas" to the customer
- Screenshot: shots/shop-375.png, shop-1440.png
- What: the footer on https://merchant-capital-shop.vercel.app reads "Checkout by Whiteflow. No gas or crypto needed." "gas" and "crypto" are banned on customer pages. The source is not in this tree (apps/shop is on origin/relayer), so I could not find the line.
- Fix: "Checkout by Whiteflow. Pay in USDT, no fees for you." Same wording rule as the checkout sheet ("No fees for you.").
- Owner: relayer lane (apps/shop).

### H2. Customer checkout sheet overflows the viewport at 375 when "Have a discount code?" is opened
- Screenshot: shots/checkout-codeopen-375.png, checkout-badcode-375.png, checkout-focus-375.png
- What: with the code form closed the sheet spans 16-359 (checkout-load-375.png). After opening it, the sheet section measures 16-400 at 375 wide, so the right edge and the Apply button run flush to the screen edge and the card's right corners are clipped. The page itself does not scroll sideways (main clips it), so the layout break is silent. Focus ring on Apply is also cut at the edge. This is on the pay screen of the main flow.
- Fix: the code row makes the sheet wider than its column. Make the sheet `min-w-0` (and the form `w-full min-w-0`), and check the `whitespace-nowrap` fx/discount lines don't force width. Re-shoot at 375 with the field open, with an error shown, and with "Discount applied".
- Owner: claude-frontend (components/Checkout.tsx).

### M1. "Continue to pay" is live at a 0.00 total; the error arrives only after a round trip
- Screenshot: shots/pay-375.png, pay-zero-375.png
- What: the order-ahead page opens with both quantities 0 and TOTAL 0.00 USD, and "Continue to pay" is enabled. Pressing it reloads with "Choose at least one item, up to 100 of each." The total only updates via the underlined "Update total" control, which is easy to miss. A customer typing a quantity and pressing Continue should see the total they will pay.
- Fix: update the total as the quantity changes (small client island), or at least disable/aria-disable Continue while the total is 0.00 with the hint "Choose at least one item". Make "Update total" a secondary button if kept.
- Owner: claude-frontend (components/gateway/Hosted.tsx, PageSheet).

### L1. Docs: section chips at 375 are clipped without a scroll cue
- Screenshot: shots/docs-375-0.png
- What: the sticky chip row ("01 Quickstart, 02 Pay button, 03 Server SD…") overflows horizontally. This is fine as a scroller, but the cut-off third chip is the only cue. The page is 34,378 px tall at 375.
- Fix: acceptable; optionally add a right-edge fade. No blocker.
- Owner: claude-frontend (components/docs).

### L2. Docs say "read from the chain" in an example caption
- Screenshot: shots/docs-375-2.png ("Every payment to your wallet, newest first, read from the chain.")
- What: fine for developers (merchant side, FR-PAY-7 covers customer pages only). Just noting that "settles straight to your wallet" and "Wallet balance" are merchant-facing words and OK.
- Fix: none.
- Owner: n/a.

## Verified OK
- /docs (shots/docs-1440-0.png, docs-375-0..3.png): one h1, two-column on desktop with "On this page" list, single column at 375, code blocks scroll inside their card, no page-level horizontal overflow (scrollWidth 375), all headline numbers use the accent token, no new one-off colours. Copy says what happens ("Mark the order paid"), amounts are USDT. Tokens reused.
- Customer checkout (checkout-load-375.png): "Hold to pay 6.00 USDT" says what happens; 6.00 in the `amount-xl` style; "6.00 USD = 6.00 USDT · 1 USDT = 1 USD" line; countdown chip "29:01 left to pay"; no gas, wallet, chain or sign words anywhere on /p/egAwjNvIhu or /checkout/... text (checked the full body text at both widths).
- Discount error state: "That code isn't valid." in the critical colour, `role="alert"`, input `aria-invalid` and `aria-describedby`, focus ring visible on input and on Apply (checkout-focus-375.png), tap targets 44 px high.
- Merchant components (from code): Vouchers has an empty state ("No codes yet. Create one above, then share it with your customers."), `role="alert"` errors, `role="status"` success, deactivate confirm group, tabular numbers, status labels for expired/inactive. Reports has an empty state ("No payments in these days. Pick a wider range…"), a focusable scroll region for the table at 375, date fields with tabular numbers, range error alert. Settlements has USDT with `tabular-nums`, cards on phone and a table from md, network fee in WBT via `formatWbt` (6 dp) with `WBT_HINT`, and a footnote "Amounts in USDT." Merchant-only WBT is correct for FR-GW-10.
- Not verified (sign-in unavailable): the live pages of vouchers, reports, settlements and developers at 375, the loading state of each, and the paid and expired customer states (would need a paid or expired session; I did not pay). Please include them in the human's walk-through.

## Counts
HIGH 2 (H1 relayer, H2 frontend), MEDIUM 1 (M1 frontend), LOW 2 (L1, L2 no action).
