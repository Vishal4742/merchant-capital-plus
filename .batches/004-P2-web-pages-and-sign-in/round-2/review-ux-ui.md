VERDICT: PASS

# UX/UI review: 004-P2-web-pages-and-sign-in, round 2

Checked live on http://localhost:3100 (not rebuilt) at 375 and 1440, light and dark. Shots are in `.batches/004-P2-web-pages-and-sign-in/round-2/shots/` (prefix `ux2-`, names like `confirming-ux2-375-dark.png`). Probes: `round-2/probes/ux.mjs`, `m.mjs`, `w.mjs`, output `ux.json`. The shop key was read into a shell variable and never printed. No horizontal overflow on any page (scrollWidth minus innerWidth = 0 in all 32 captures).

How each state was reached:
- ready: a real session (25.00 USDT, two items, order T-1042).
- error: a real hold; the relayer refused ("The payment didn't go through. Nothing was charged.").
- confirming: the pay POST aborted in the browser after the hold.
- expired: `Date.now()` shifted +1 h in the page, so the client's expiry check runs. That is a client-side simulation, not a 30-minute-old session.

Both round-1 musts are fixed. No new MUST. Three LOWs below.

## Round-1 findings

1. **Not-found for /checkout and /r: fixed.** `nf-checkout-ux2-375-light.png`, `nf-receipt-ux2-1440-dark.png`. Branded sheet on the dither scene, a title, one plain explanation, and a "Go to Merchant Capital+" link. The checkout copy ("Nothing was charged from this page") is true. The receipt copy tells a customer who just paid to open the checkout link again. Legible in both themes, no crypto words.
2. **Pending state: fixed.** `confirming-ux2-375-dark.png`, `confirming-ux2-1440-light.png`. Bordered panel, amber "Confirming" pill (`text-warning`), copy in ink not red, quiet "Check again" button, 44 px tall. `role="status"`, no pay button. Panel text confirmed by DOM. It sits below the item list, so the amount stays visible.
3. **Mono prices: fixed.** Line items render in the sans face with tabular numbers (10.00 / 5.00 align with 25.00).
4. **Paid heading: fixed in code** (sr-only `h1` "Paid to {shop}"). I could not render the paid state (no funded wallet).
5. **Hold hint for assistive tech: fixed.** `#pay-hint` text reads "You pay exactly 25.00 USDT. No fees for you. Press and hold the button, or press Enter, to pay." and is wired to `aria-describedby`.
6. **Gate copy:** the code now says "Sign-in isn't available right now." and has no variable name. I could not see the no-AUTH_SECRET gate live, since that needs the server restarted without it. The signed-out gate with sign-in available is clean at all four sizes (`merchant2-375-light.png`). Note: my first merchant capture caught the brief "Loading the dashboard…" text; the page settles within about 3 s.
7. **No wallet on a phone: fixed.** `merchant-nowallet-375-light.png` reads "No wallet found in this browser. On a phone, open this page in your wallet app's browser (MetaMask, Rabby)…". It is a next step for a phone user. The red error text fits at 375.
8. **Footer link:** 195.7 x 44 px at 375 and 1440 (`home-ux2-375-light.png`). "Try a checkout" is now a `<form method="post" action="/api/demo-checkout">`, so it is a full page load.
9. **Cut placeholders:** no "Cash advance", "To investors" or "Refund soon" remain in `components/merchant` or `app/merchant`. The only mention of investors is the marketing card on the home page, which is fine.

## Checked and met

- **FR-PAY-7 / NFR-6.** `innerText` of the not-found sheets, ready, error, confirming and expired shows no sign / gas / wallet / chain / WBT. The matches on / ("Whitechain Sepolia" footer) and /merchant ("Sign in", "wallet") are outside the customer flow.
- **Every state exists:** ready, error, confirming, expired and not-found are all rendered and legible. The paid state with the explorer link is seen in code only.
- **Amounts:** 25.00 USDT with `amount-xl`, line items 2 decimals and tabular.
- **375 layout:** the sheet keeps 16 px margins; "Hold to pay 25.00" fits on one line.
- **Tokens reused.** Warning, critical, hairline and surface tokens; `buttonClasses("quiet")` is reused.

## LOW (next batch, not blocking)

- **L1. "Check again" looks disabled and is indented.** `confirming-ux2-375-dark.png`: the quiet button text is grey (low contrast on the panel) and sits about 8 px right of the pill and body text because of its padding. It is the only action on the panel. Fix: left-align it with `-ml-2` (still open from 002) and use `text-ink` or `text-accent` so it reads as clickable. Owner: claude-frontend.
- **L2. Expired state is a lone red line** (`expired-ux2-375-light.png`) with no link. It is correct and honest, but the item list stays visible, so a customer might think they can still pay. Optional: drop the hold hint (already gone) and style it with the warning token rather than red, since expiry is not an error. Owner: claude-frontend.
- **L3. `rounded-[28px]` and `max-w-[420px]`** are still literals shared by Checkout and the receipt (round-1 LOW). Promote them to tokens when convenient. Owner: claude-frontend.

## Not seen, still open for the human or tester
- Paid /checkout and a real /r receipt (they need a funded guest wallet).
- Signed-in dashboard.
- Real-device VoiceOver/TalkBack on the keyboard path.
- FR-ADV-6 (cost of an advance before signing) is not in this batch.
