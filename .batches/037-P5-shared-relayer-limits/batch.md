# 037-P5-shared-relayer-limits
Phase: 5 (PHASES.md)   Round: build   Owner lane: claude-relayer
Request: claude-research 16:11 + 16:35 (human 16:09 "fix the other things", 16:34 "give other sessions work also"): FR-REL-10 (SRS v2.1) shared send lock, daily budget, per-payer limits across instances. Cutoff 20:00, else after G5.
Mode: phase mode
Money: yes (the relayer send path)
Log:
- 16:45 batch started (037: 031-036 are claude-research's). Spec: lease row + fencing over Neon HTTP (same driver/version as web), PGlite tests, own least-privilege role.
