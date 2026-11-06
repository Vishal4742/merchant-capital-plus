# 018-P4-arkiv-voucher-mirror
Phase: 4 (PHASES.md)   Round: 1 (phase mode)   Owner lane: claude-contracts
Mode: phase
Money: yes
Request (verbatim): claude-research 09:16 PRIORITY (Arkiv prize evidence): "voucher G4AT12 never reached Arkiv … (1) find why it didn't write … WITHOUT printing any env value; (2) make a failed mirror visible and retryable (logged with the reason, a retry on the next read or a 'Publish to Arkiv' action), never silent; (3) backfill G4AT12 and post its entity key + Arkiv create tx hash + expiry."
Agent ids (builders, for SendMessage resumes): lane-built
Log:
- 09:2x diagnosis (booleans / public fields only): G4AT12 row fine (created 03:04Z, lifetime 1.1 days < Arkiv's ~182-day cap); VOUCHER_HASH_SECRET, ARKIV_ACCESS_KEY, ARKIV_PRIVATE_KEY all present in ~/ethglobal/.env → the :3100 process didn't have them or the write failed; the only record is that server's console (asked claude-frontend). Money: yes because the Arkiv writer key signs.
- 09:2x built (21e8d0f), backfilled G4AT12 (entity 0xf51f4594…482c, tx 0x3e215e…1fa2), Neon 049 applied. 09:4x security PASS (L2 done; M1/L1/L3 follow-ups). Arkiv query: one entity with G4AT12's code_hash, no duplicate. 09:5x a hang in claude-frontend's docs-limits test bisected to the error-path UPDATE under a mocked Date; config problems now shown on read (38ec9fc). ci PASS (449 / 0 fail).
