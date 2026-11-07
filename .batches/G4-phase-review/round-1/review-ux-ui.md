VERDICT: CHANGES

# UX/UI review, G4 phase review part 1 (round 1)

Scope: /l/U4S8s8tUZB (paid), /p/nope (not found), /docs, /merchant/links, /merchant/pages, merchant payments with the network-fee column. Merchant sign-in was unavailable: /merchant/* rendered only the signed-out card (shots/mlinks-375.png), so links, pages and payments were reviewed from code (components/gateway/Links.tsx, Pages.tsx, app/merchant/payments/page.tsx). No /p/<slug> page could be listed (no sign-in), so PageSheet was reviewed from code only. Nothing was paid or submitted.

Limit of my evidence: headless Chrome would not render below about 500 px wide, so every 375 screenshot is cropped on the right (shots/link-375.png, docs-375.png, mlinks-375.png, p-bad.png). That is the tool, not the app. 375 is NOT verified visually; the code does show mobile handling (payments card-per-row below md, docs code blocks wrap below md, focusable scrollable regions). A 375 pass in a real device emulator is still owed.

## What passes
- FR-PAY-7: no "gas", "wallet", "chain", "sign" or token words in app/l, app/p, Hosted.tsx, gateway-forms.ts closed-link copy. The "sign"/"chain" hits in Checkout.tsx and InvoicePay.tsx are code comments and imports, not rendered text.
- Paid state (shots/link-1440.png): clear title, one-time explanation, what to do next, role="status". Expired and cancelled copy exists and says "Nothing was charged" (gateway-forms.ts:167). Error state on the link page exists ("We can't open this link right now"). Loading fallback exists. Not-found copy is plain (shots/p-bad.png).
- Merchant payments: loading, empty, partial-failure and "can't check right now" states all present; fee column is merchant-only and says the customer paid no fee; explorer link and receipt link on each row; tabular-nums on amounts.
- Tokens reused (sheet, buttonClasses, eyebrow, amount-xl, text-ink-muted); global :focus-visible outline exists (globals.css:63).

## Findings

### F1 (MEDIUM) Network fee is shown as "WBT" with variable decimals
Where: apps/web/app/merchant/payments/page.tsx (summary line and fee cell), formatWbt in lib/dashboard.ts. No screenshot (merchant signed out).
What: the fee cell reads like "0.000042 WBT" or "<0.000001 WBT" or "0.1 WBT": trailing zeros are trimmed, so the column does not align or read consistently, and the unit is the crypto token name while the rest of the screen is USDT with 2 decimals. Fine for a merchant (FR-GW-10 allows it) but it is the one place a shop owner sees an unexplained token.
Fix: keep the unit but render a fixed 6 decimals in the column (tabular), and add a one-line hint under the summary ("WBT is the network's own coin; we paid this, you did not"). Or show the USDT equivalent when a rate exists.
Owner: claude-frontend.

### F2 (LOW) Paid link page is a dead end
Where: shots/link-1440.png, components/gateway/Hosted.tsx HostedNotice.
What: no date or amount of the payment, no receipt link, no action. A customer who already paid and returns to the link cannot confirm it was their payment.
Fix: if the gateway exposes paid_at or the receipt id on the public link, show "Paid on 6 Nov, 14:02" and a "View receipt" link; otherwise leave and note the API gap for claude-contracts.
Owner: claude-frontend (screen), claude-contracts if the API needs a field.

### F3 (LOW) Closed and error notices have no way forward on the page
Where: HostedNotice for expired, cancelled and "can't open right now".
What: the error notice says "Try again in a minute" but offers no retry control; the not-found sheet links to the product home, which means nothing to a customer of a shop.
Fix: add a "Try again" button (a plain link to the same URL) on the error notice; on the not-found sheet use "Ask the shop for its page link" without the product link, or keep the link but label it "About Whiteflow".
Owner: claude-frontend.

### F4 (LOW) Pages empty-state copy
Where: components/gateway/Pages.tsx:38, "it's a shop page without a shop".
What: clever, but a merchant new to the product may not parse it.
Fix: "No pages yet. Build one above and share its address; customers pay on a page that shows your name and items."
Owner: claude-frontend.

### F5 (LOW) Docs read as merchant copy but live on a public route
Where: shots/docs-1440.png.
What: "settles straight to your wallet" is fine for developers and the page is not a customer page, so FR-PAY-7 does not apply. Just confirm that is intended; the lede also says "pay no network fee" in the same breath as "wallet". No change needed if docs stay developer-only.
Owner: claude-frontend (decision only).

## Required before the gate
Nothing blocks on correctness. CHANGES because: (1) 375 width is unverified for every screen and needs a real emulator pass, (2) F1 should be fixed so the fee column is consistent. F2 to F5 can ride the same fix batch.
