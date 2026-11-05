VERDICT: CHANGES

# UX/UI review: 004-P2-web-pages-and-sign-in, round 1

The tester's `shots/` was empty when I started, so I took my own at 375 and 1440, light and dark, against http://localhost:3100 (`.batches/004-P2-web-pages-and-sign-in/round-1/shots/ux-*.png`, prefix `ux-`). Covered: home, /proofs, /merchant signed out, /checkout ready, error (real hold, relayer refused) and pending (pay request aborted in the browser), /r unknown and unpaid. Keyboard tab order and focus at 375, and reduced motion. Not reachable locally, so unseen: the paid state of /checkout, a real /r receipt, the expired and "not live" states, and the signed-in merchant dashboard (they need a paid payment or a wallet). I read their code instead, noted below.

Overall: fidelity to Mercury + dither is good. Instrument Sans, pill buttons, electric-dot night scene with moon and skyline, white/dark sheet over the scene, serif-italic "sales", tokens reused, no horizontal overflow on any page at 375 or 1440 (scrollWidth - innerWidth = 0 everywhere). Both findings below are small; both touch customer money copy, so I want them fixed before the gate.

## Findings (fix before PASS)

1. **Real receipt page missing / unpaid /r shows Next's default 404.** `.batches/004-P2-web-pages-and-sign-in/round-1/shots/ux-receipt-unpaid-375-light.png`, `ux-receipt-unknown-375-dark.png`.
   - What: `/r/<id>` for a real but unpaid checkout, and any unknown /r or /checkout id, show the bare framework "404 / This page could not be found." There is no scene, no brand, no way back. A customer who followed "check this page again" from a pending checkout and lands on /r gets a dead end with no explanation.
   - Fix: add `app/not-found.tsx` (or one per route) on the StaticScene sheet: "We can't find this receipt. If you just paid, check the checkout page again in a few minutes." Keep `noindex`.
   - Owner: claude-frontend.
2. **Pending state reads as a failure and has no action.** `.batches/004-P2-web-pages-and-sign-in/round-1/shots/ux-pending-375-light.png`, `ux-pending-375-dark.png`.
   - What: the copy is correct and safe ("We couldn't confirm this payment yet. Don't pay again; check this page again in a few minutes.") but it is in the `text-critical` red like the error state, with no button. Red says "it failed", which is the opposite of the message and invites a second payment from another tab. The customer must reload by hand, and nothing tells the shop or the amount at risk.
   - Fix: use a neutral or warning token (`text-warning` already exists) with a small status pill ("Confirming"), add a "Check again" quiet button that calls the same settle path as page load, and keep no pay button. Keep `role="status"`, not `alert`.
   - Owner: claude-frontend.

## Should fix (LOW, can ride this batch or the next)

3. **Item prices use the mono `data` face** (`ux-ready-375-light.png`: "10.00", "5.00") next to the Instrument Sans `amount-xl` total. Numbers are tabular and 2-decimal, which is what NFR-6 needs, but two faces in one column is a one-off look. Use the sans with `tabular-nums` for line items and keep mono for ids. Owner: claude-frontend.
4. **Visible dev copy**: /merchant gate says "Sign-in isn't set up on this server yet (AUTH_SECRET)." Say "Sign-in isn't available right now." and log the variable name server-side. Owner: claude-frontend.
5. **Merchant sign-in dead end on a phone**: with no injected wallet it says "No browser wallet found. Install MetaMask or a similar wallet". A café owner on a phone has no next step. Add "Open this page in your wallet's browser." Owner: claude-frontend, copy only.
6. **The keyboard path is not announced.** HoldButton confirms at once on Enter/Space and VoiceOver double-tap (`detail === 0`), so the non-hold fallback I asked for in 002 exists and works (focus ring is a solid 2 px outline at 375 on every control). But the hint under the button only says "You pay exactly 25.00 USDT. No fees for you." Add a visually hidden "Press Enter, or double-tap, to pay without holding" to `aria-describedby`. Real-device VoiceOver/TalkBack remains unverified (human). Owner: claude-frontend.
7. **Paid state has no heading** (`Checkout.tsx` paid branch uses a pill and a paragraph, no `h1`) while the ready state has one. Add a visually hidden or real heading ("Payment received"). Owner: claude-frontend.

## Checked and met

- **FR-PAY-7 / NFR-6 words.** `innerText` of /checkout ready, error, pending: no match for sign / gas / wallet / chain / WBT / Whitechain. Copy is plain: "Hold to pay 25.00", "You pay exactly 25.00 USDT. No fees for you." Code for expired ("Ask {shop} for a new one"), not live ("Nothing can be charged from this page"), paid ("View receipt", "View on explorer") also clean. "Explorer" is a spec item (FR-PAY-9), acceptable. The words "wallet" and "Whitechain Sepolia" appear only on home, /proofs and /merchant, which are not the customer flow.
- **Money copy.** "Nothing was charged" appears only on the error state where the relayer refused before any money moved (verified live: the guest wallet holds 0 USDT, the hold produced it, the button returned idle). Pending uses "Don't pay again" and shows no button. The expired and not-live copy is also true.
- **Amounts.** 25.00 USDT, 10.00, 5.00: two decimals, `amount-xl` for the total, unit label beside it. Merchant totals are not checked (signed out).
- **Focus and targets.** Every control I tabbed is at least 48 px tall (pay 279x48, sign-in 218x48, home buttons 156x48 and 202x48, Dashboard 122x48), with a visible 2 px solid outline. Tab order is DOM order (home: Dashboard, Try a checkout, Open the dashboard, proofs link). The one under-target control is the footer link "Private reads and wallet proofs" at 196x20 (text link, WCAG 2.2 AA exempt in-line, but it is the sole footer action; give it `min-h-11` if cheap).
- **Contrast over the scene.** Home hero text reads cleanly at 1440 and 375 in both themes (night wash behind the text, `ux-home-1440-light.png`, `ux-home-375-dark.png`); the checkout sheet sits on a solid surface so nothing sits directly on the dots. Error red on the white sheet and the light red on the dark sheet are legible.
- **Reduced motion.** `ux-reduced-checkout-375.png` and `ux-reduced-home-375.png` render the scene, static. The checkout uses the 2D StaticScene, so it never animates.
- **Layout at 375.** No overflow, sheet has 16 px margins, "Hold to pay 25.00" fits on one line, the 375 error and pending sheets grow cleanly.
- **Design tokens.** No new hex values or one-off styles seen in the rendered pages; `rounded-[28px]` and `max-w-[420px]` on the sheet are literals (same two in Checkout and the receipt), so promote them to a token (LOW, same owner).
- **Merchant gate (signed out).** Clean at 375 and 1440 in both themes (`ux-merchant-375-light.png`). Button says what happens and the sentence "free and moves no money" sets the right expectation.

## Deferred from my 002 round-3 notes: status

- Non-hold fallback for assistive tech: met in code (click with detail 0 confirms), not announced (finding 6), real-device unverified.
- USDT 2 decimals and tabular numbers: met (finding 3 is cosmetic).
- Empty/error/explorer states: error met; pending met in copy (finding 2); explorer link present in code on /r and in the paid state, not seen rendered; empty/missing states: finding 1.
- Quiet button `-ml-2` alignment: not applicable here (no quiet button on these pages); still open for /proofs ("Read block again"), cosmetic.
- FR-ADV-6 (cost of an advance before signing): not in this batch; merchant advance UI is later.
- Replace internal copy on customer pages: done for /checkout; /proofs keeps "chain 1874" and "Nym" and is internal-only.

## For the tester next round
Please screenshot the paid checkout and a real /r receipt (a paid payment needs a funded guest wallet or the test hook), the expired state, and the signed-in dashboard with the "Sales, before fees" label, so I can confirm the unseen states.
