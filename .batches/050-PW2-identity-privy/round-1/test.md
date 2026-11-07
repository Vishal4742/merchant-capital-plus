VERDICT: PASS

# Batch 050 round 1: browser walk of the Stage 3 pages

Setup: next dev on port 3100 (port 3000 was already taken by another process I did not touch), DATABASE_URL = wf_s2_web only (verified `current_database()` = wf_s2_web, 10 wf_ tables), PUBLIC_ORIGIN=http://localhost:3100, no NEXT_PUBLIC_PRIVY_APP_ID. Seeded an Owner (owner@example.com, one wallet), a Viewer, business "Acme Studio" (owner_count 1) with both memberships, one session each (sha256 of a random token, expires in 1 h, cookie `wf_session` set in the browser), and for state d one wf_settlement_policies row plus its two consumed challenges. Chromium 156 via playwright-core. No Privy login attempted.

## Results
- a. /sign-in, no Privy app id: PASS. Shows "Sign-in isn't set up on this server yet: the Privy app id is missing. Nothing else is affected." and the Privy disclosure ("Sign-in is provided by Privy, which receives the email or wallet address ... sends its own anonymous usage analytics. Only this page loads Privy ..."). No page errors.
- b. /merchant/settings, no cookie: PASS. "You're not signed in to a Whiteflow workspace, or your session ended." with "Sign in with email or wallet" link and the legacy sign-in disclosure.
- c. Owner, no policy: PASS. Workspace "Acme Studio / Owner / UTC", "Signed in as owner@example.com · approval wallet 0x1111…1111", receiving wallet badge "Not set: collection off", address input, "Use my connected wallet", "Prove control of this wallet" (disabled until a valid address), team list with a role select and Remove per member, Add form (disabled until text entered).
- d. Owner with policy: PASS. "Version 1 active", full 42-char pay-out address, Copy, View on explorer, "Whitechain Testnet (chain 1874)", token "USDT 0xcedfB56113143d55b2358b8CFbB0dEB5Ad2f55a7", status and approval wallet, plus the new-receiving-wallet form.
- e. Viewer (without and with a policy): PASS. "Change receiving wallet" disabled with visible reason "Only an Owner can change where this workspace is paid."; both team role selects disabled; no Remove buttons and no Add form; visible reason "Only an Owner can add, change or remove team members." No action is enabled for the Viewer (Sign out aside, and Copy, which is read-only).
- f. 360 px, scrollWidth: b = 360, c = 360, e = 360 (also a = 360). No overflow. 375 and 1440 also equal their viewport width on every page.
- g. Keyboard (Owner, 1440, tab from "Sign out"): PASS. Every stop has a visible 2 px solid outline: buttons and links rgb(59,79,217); inputs and selects rgb(23,23,33) plus a box-shadow ring (screenshot g-focus-5.png shows the role select clearly ringed). Order is logical: Sign out, Copy, explorer, address input, Use my connected wallet, role select, Remove, role select, Remove, add input, add role select, legacy summary.
- npm test in apps/web: `ℹ tests 793 / ℹ pass 791 / ℹ fail 0 / ℹ skipped 2`.
- No pageerror events on any page. Not done (not required): outage simulation, real Privy login, the signing flow (needs a wallet).

## Screenshots (round-1/shots/)
a-signin-375.png, a-signin-1440.png, a-360-360.png; b-settings-nocookie-375.png, b-settings-nocookie-1440.png, b-360-360.png; c-owner-nopolicy-375.png, c-owner-nopolicy-1440.png, c-360-360.png; d-owner-policy-375.png, d-owner-policy-1440.png, d-viewer-policy-375.png; e-viewer-375.png, e-viewer-1440.png, e-360-360.png; g-focus-0/2/5/9.png and c-focus-5/9.png (the c-focus ones tabbed only through the sidebar).

## Findings (all non-blocking)
1. apps/web/components/workspace/WorkspaceSettings.tsx:444 (owner: frontend lane). The team role select is enabled for the only Owner on their own row, so a self-demotion is offered and the server answers with an error. The server invariant holds. Consider disabling it, with a reason, when owner_count is 1.
2. apps/web/components/workspace/WorkspaceSettings.tsx (owner: frontend lane). Dev-only: the Next.js dev-tools button appears as a stray unlabeled-looking control in the page; ignore (not in a production build).
3. Spec acceptance 18 (full browser journey with real Privy login, wallet signatures, step-up approval, logout) remains NEEDS THE USER: requires the owner's Privy app id and PRIVY_VERIFICATION_KEY, plus a wallet.

## Cleanup
Dev server (PID of the next dev I started) stopped; port 3100 returns no response. All seeded rows deleted by id (policy, challenges, sessions, memberships, business, wallets, principals; verification query returned 0 remaining). Temp scripts live in C:\Users\nothi\tmp-pw, outside the repo. No product code edited.
