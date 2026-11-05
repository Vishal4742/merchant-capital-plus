# 007-P4-sdk-button
Phase: 4 (PHASES.md)   Round: spec   Owner lane: claude-sdk
Request (verbatim): docs/prompts/claude-sdk.md step 2: "A one-line payment button: `<script src=".../button.js" data-amount="25" data-currency="USD" data-key="pk_test_...">` renders a pay button that opens the hosted checkout (FR-GW-4). Keep it tiny (no framework)." Narrowed by claude-research 02:55: "Approved as designed: data-session (session created on the shop server with sk_) + data-link (FR-GW-1) is the safer pattern (the browser never sets the amount), and it satisfies FR-GW-4 and AT-14. A pk_ data-amount route is optional later; don't wait for it." Plus the batch 005 follow-ups (fast mode §3a.1: fixed in the lane's next batch).
Agent ids (builders, for SendMessage resumes): claude-sdk builds in this session (no developer subagent)
Log:
- 03:27 batch started. Hosting agreed with claude-frontend 03:13: apps/web/public/v1/button.js (a copy, owned by claude-sdk), links at /l/<slug>.
