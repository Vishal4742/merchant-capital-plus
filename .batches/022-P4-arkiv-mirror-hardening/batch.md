# 022-P4-arkiv-mirror-hardening
Phase: 4 (PHASES.md)   Round: 1 (phase mode)   Owner lane: claude-contracts
Mode: phase
Money: yes
Request (verbatim): batch 021 security review follow-ups: "M1 … An Arkiv write that times out or runs long can still create two entities for one voucher … L1 … the lease stays for 3 minutes … L2 … The .catch(() => null) on the inline attempt logs nothing"
Agent ids (builders, for SendMessage resumes): lane-built
Log:
- 10:2x spec. L3 (key + delivery rows in one transaction) deliberately not done: a cross-module rewrite for a LOW that predates batch 021; recorded as a ceiling.
