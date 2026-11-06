# 022-P4-arkiv-mirror-hardening
Phase: 4 (PHASES.md)   Round: 1 (phase mode)   Owner lane: claude-contracts
Mode: phase
Money: yes
Request (verbatim): batch 021 security review follow-ups: "M1 … An Arkiv write that times out or runs long can still create two entities for one voucher … L1 … the lease stays for 3 minutes … L2 … The .catch(() => null) on the inline attempt logs nothing"
Agent ids (builders, for SendMessage resumes): lane-built
Log:
- 10:2x spec. L3 (key + delivery rows in one transaction) deliberately not done: a cross-module rewrite for a LOW that predates batch 021; recorded as a ceiling.
- 10:3x built: failing tests c590d58, fix d54eabb; ci PASS. Security PASS with follow-ups: M1 ownedBy → createdBy (an owner can hand a planted entity to our writer; the creator never changes), L1 adopt only with this voucher's terms, L3 never overwrite a stored key, L4 the mock records the filters. All four fixed in 69b36a5 (mutation-checked); ci re-run PASS (186 gw / 498 total, 0 fail). L2 (a timed-out tx landing after the next attempt's query: duplicate with the same content) kept as the named ponytail ceiling; the 409 now says "a few minutes".
