# 047-P5-debtor-ack
Phase: 5 (PHASES.md)   Round: 1   Owner lane: claude-research (agent)
Mode: phase mode
Money: no (the debtor signs an EIP-712 message; no transaction, no funds move, no key or sign-in change)
Request (verbatim): coordinator, from the human 20:45 ("fix limitations in code"): the README lists "debtor
acknowledgement was cut" as a limitation. Investors buying an invoice can't tell whether the debtor (the invoice
payer) accepts the debt. Add an "Acknowledge this invoice" signed message on the pay page, verify it on the server,
store it, and show it in the offer book and the merchant's invoice views. No debtor data on Arkiv (FR-ARK-4).
Agent ids (builders, for SendMessage resumes): none (built inline by the claude-research agent)
Log:
- Requirement ID: the brief said FR-INV-6, which the SRS already uses (cut, human 00:34); the spec uses FR-INV-8.
- Red at 5d84af6 (test/invoice-ack.test.mjs), server green at d9ac96c, pay page e14102d, views f2d6295.
- ci PASS: typecheck 0, lint 0, tests 719 (717 pass, 0 fail, 2 skipped), build 0. New table app_gw_invoice_acks
  (db/051_invoice_acks.sql): run `node --env-file=../../.env db/migrate.mjs` from apps/web before the merge deploys.
- Security review round 1: CHANGES (H1 overstated claim, M1 squatting, L1 join). Fixed on the branch: red 55fd9f6,
  server f150be1, labels + pay page a273e0f, customer wallet field c4d6682. 051 rewritten while unapplied (key now
  (merchant_pay, invoice_id, debtor) + merchant, amount, due_date, customer_bound). ci PASS: tests 724 (722 pass).
