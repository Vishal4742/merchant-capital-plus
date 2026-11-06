# 018-P4-arkiv-voucher-mirror
Phase: 4 (PHASES.md)   Round: 1 (phase mode)   Owner lane: claude-contracts
Mode: phase
Money: yes
Request (verbatim): claude-research 09:16 PRIORITY (Arkiv prize evidence): "voucher G4AT12 never reached Arkiv … (1) find why it didn't write … WITHOUT printing any env value; (2) make a failed mirror visible and retryable (logged with the reason, a retry on the next read or a 'Publish to Arkiv' action), never silent; (3) backfill G4AT12 and post its entity key + Arkiv create tx hash + expiry."
Agent ids (builders, for SendMessage resumes): lane-built
Log:
- 09:2x diagnosis (booleans / public fields only): G4AT12 row fine (created 03:04Z, lifetime 1.1 days < Arkiv's ~182-day cap); VOUCHER_HASH_SECRET, ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY all present in ~/ethglobal/.env → the :3100 process didn't have them or the write failed; the only record is that server's console (asked claude-frontend). Money: yes because the Arkiv writer key signs.
