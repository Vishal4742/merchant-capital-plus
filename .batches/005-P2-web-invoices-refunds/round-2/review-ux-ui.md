VERDICT: PASS

# UX/UI review, batch 005 round 2

Shots: builder's fork set `/private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/p005-r2-shots/` (B/), mine `/private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/ux2/` (U/). Live :3100 checked directly.

## Round-1 findings
- **F1 demo message: FIXED.** U/checkout-demo-375-light.png: a fresh unfunded guest holding to pay on a real session now sees "This is a demo: paying needs test USDT, and this browser doesn't have enough yet. Nothing was charged." Shorter, one "test", no crypto words. Also B/pay-demo-low-balance-375-dark.png.
- **F2 Refund off-screen at 375: FIXED.** Payments and invoices are stacked cards. B/merchant-refund-open-375-light.png: visible label "Refund amount (USDT)", full-width field, Refund + Close below, hint "Up to 17.50 USDT. Your wallet may ask to approve this amount first." visible. Live /merchant signed in with a throwaway key through the fake wallet: scrollWidth 375 = innerWidth at 375 light and dark, 1440 equal too. Builder's 12 shots also fit.
- **F3 refund field/label: FIXED** (visible label, hint). Residual LOW below.
- **F4 Cancel/Copy/Receipt: FIXED.** Two-step "Cancel invoice? Yes, cancel / No" (B/merchant-cancel-confirm-375-dark.png), separated from Copy link; Receipt link 44 px by the builder's report. Residual LOW below.
- **F5 pay hint: FIXED.** Visible under the fee line on /pay (B/pay-open-hint-375-*, pay-part-paid-375-dark) and on the live checkout.
- **F6 stale form error: FIXED** (log: "error after a change: cleared"; amount label shows the range).
- **F7 Part paid: FIXED** (pill "Part paid", B/pay-part-paid-375-dark.png). Overdue state still absent, deferred as LOW; accepted.
- **F8 invoice receipt: verify-only, accepted** (fork has no time source).
- Round-1 ask for shots: Confirming panel at 375 (B/pay-confirming-375-light.png: warning pill, "Don't pay again; check this page again in a few minutes.", accent "Check again" link) and cancelled (B/pay-cancelled-375-light.png) are now shown. Expired checkout still not shot; code-only, accepted.

## New, all LOW (do not block)
- **N1** Refund field shows "17.5", not 17.50 (B/merchant-refund-open-375-light.png). Format the prefill to 2 decimals. Owner: claude-frontend.
- **N2** Cancel confirm at 375 (B/merchant-cancel-confirm-375-dark.png): "Cancel invoice?" wraps to two lines, "Yes, cancel" wraps, and "No" sits flush against the card edge; "No" is vague next to a destructive Yes. Prefer "Keep it" and let the row wrap with padding. The plain Cancel link is also indented differently from Copy link above it. Owner: claude-frontend.
- **N3** The demo message uses the error red. It is an explanation, not a failure; the muted/warning token would read calmer. Owner: claude-frontend.
- **N4** Customer page "payment fee" and merchant footer still fine for FR-PAY-7; no crypto words on any customer shot (builder's scan: 0 in 24 states; mine: none). Merchant side uses "WBT fee", acceptable on the merchant dashboard.

## Checked and fine
- Amounts 2 decimals, tabular; "Hold to pay 6.10" matches the large figure; "Part paid", "Confirming", "Cancelled" pills use existing tokens in light and dark.
- Private customer field labelled "(only you see it)" with the explanatory line that it stays in this browser.
- No one-off styles spotted; focus ring on the Hold button visible (double outline in U/checkout-demo-375-light.png).
