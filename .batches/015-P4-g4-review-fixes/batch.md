# 015-P4-g4-review-fixes
Phase: 4 (PHASES.md)   Round: 1 (phase mode)   Owner lane: claude-contracts
Mode: phase
Money: yes
Request (verbatim): G4 phase review part 1 (code) CHANGES for claude-contracts (claude-research 08:20): "H1 HIGH lib/server/links.ts rounds each line item up to the cent instead of the total … M3: a pays-once link can be paid twice … LOW: fiat links/pages can be created with prices that can never be paid … Still open from your 009 security pass: F2 frozen voucher hold can lock a use forever, F4 …, F6 no back-off when the FX source is down"; plus claude-frontend 08:19 (paid_at on the public link) and batch-013 review P1 (releaseHold docstring in the relayer's result shape)
Agent ids (builders, for SendMessage resumes): Builder X links/pages, Builder Y vouchers/checkouts (BUILDERS-015.md)
Log:
- 08:2x spec.

- 09:2x after merging main: two over-reaches fixed (USD rounds to the cent, back-off only after a timeout) and the creation check made best effort; full suite 419 / 0 fail; migration 048 applied (standing approval).
