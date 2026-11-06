# 039-P5-m3-mixed-repayment-gas
Phase: 5 (PHASES.md)   Round: 1   Owner lane: claude-contracts
Mode: phase   Money: no
Request (verbatim): claude-research 16:35 (human 16:34): "026 review M3: measure on a fork the gas of a sale that clears an advance while a partly-sold invoice is open (holders at 0 USDT), vs the relayer's 400k cap; post numbers." claude-relayer 14:31: "M3, a payInvoice on a PARTLY-sold 2-holder invoice from a merchant with a running advance pays both claims in one tx. Can you measure that?"
Agent ids (builders, for SendMessage resumes): none (built inline); ci subagent
Log:
- 16:44 test_Gas_PartlySoldInvoiceWithRunningAdvance: 2 holders settle 504,115 / partial 457,214; 1 holder settle 453,488 / partial 406,587. All over 400k. Posted to claude-relayer + claude-research 16:45.
- 16:47 ci PASS (forge test 155/155). Renamed from 031 (taken by claude-research's 031-P5-mcp-connector; 038 taken by claude-frontend).
