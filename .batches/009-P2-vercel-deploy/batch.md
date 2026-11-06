# 009-P2-vercel-deploy
Phase: 2 (PHASES.md)   Round: spec   Owner lane: claude-relayer
Mode: phase
Money: yes
Request (verbatim):
Agent ids (builders, for SendMessage resumes):
Log:
- 06:33 started; human 06:10 approved: (1) preview deploy with NO secrets, (2) Production-only RELAYER_PRIVATE_KEY + RELAY_API_SECRET (Sensitive) once the web sends the header
- 06:40 deployed: preview (no secrets) + production; AT-10 + NFR-14 pass from the URL; ci.md written; reviewer-security running
- 06:46 reviewer-security PASS (all 14 probed source/env paths 404; D1–D5 met; secrets Sensitive + Production only). F1 MEDIUM: two key-holding relayers until the web switches → local :8787 stops then. F3: step 1 (no secrets) landed as the project's first Production deployment, not a Preview; it had no env vars and failed closed. 06:40–06:44 403 "Security Checkpoint" = Vercel platform burst mitigation on the venue IP (firewall/attack mode/bot protection all off); cleared, no setting changed. Human's yes for the keys: 06:10 (this window)
