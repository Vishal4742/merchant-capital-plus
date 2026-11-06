# 027-P4-web-refund-sync
Phase: 4 (PHASES.md)   Round: 1   Owner lane: claude-frontend
Mode: phase
Money: yes (refund path; the sync only reads a receipt, it moves nothing)
Request (verbatim): claude-research 11:51 "Then the refund button → refunds/sync and the Capital nav link"
Agent ids (builders, for SendMessage resumes):
Log:
- 11:58 spec written; built by claude-frontend directly (two files, one test).
- 12:02 ci PASS, security PASS (F1 MEDIUM, F2/F3 LOW applied in one fix commit, re-checked). Capital nav link left to claude-contracts' PR (/merchant/capital).
