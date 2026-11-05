# 007-P4-sdk-button
Phase: 4 (PHASES.md)   Round: spec   Owner lane: claude-sdk
Request (verbatim): docs/prompts/claude-sdk.md step 2: "A one-line payment button: `<script src=".../button.js" data-amount="25" data-currency="USD" data-key="pk_test_...">` renders a pay button that opens the hosted checkout (FR-GW-4). Keep it tiny (no framework)." Narrowed by claude-research 02:55: "Approved as designed: data-session (session created on the shop server with sk_) + data-link (FR-GW-1) is the safer pattern (the browser never sets the amount), and it satisfies FR-GW-4 and AT-14. A pk_ data-amount route is optional later; don't wait for it." Plus the batch 005 follow-ups (fast mode §3a.1: fixed in the lane's next batch).
Agent ids (builders, for SendMessage resumes): claude-sdk builds in this session (no developer subagent)
Log:
- 03:27 batch started. Hosting agreed with claude-frontend 03:13: apps/web/public/v1/button.js (a copy, owned by claude-sdk), links at /l/<slug>.
- 03:31 RED b5ceb00 (8 of 32 failing, all new), GREEN 3e48d40 (39/39, tsc clean, button.js 2026 B, copy identical). Pushed.
- 03:45 round 1 verdicts: test PASS, ux-ui PASS, code CHANGES (H1 DOM clobbering of document.currentScript; H2 amount formats '1,000.00' vs '1000.00'), security CHANGES (HIGH-1 = the same clobbering). claude-frontend agreed one plainUsdt format (03:44).
- 03:52 round 2 fixes 1c5c294 (47/47; EUR/USD now priced by the real v2 route). Round 2 tester launched (real-Chrome clobbering proof).
- 03:36 round 1 tester PASS (39/39; headless Chrome via CDP on a :4400 stub at 375/1440 light/dark: keyboard Enter → /checkout/<id>, link, shop-written and late-added elements navigate, one console error for the bad id). Reviewers code/security/ux-ui launched.
