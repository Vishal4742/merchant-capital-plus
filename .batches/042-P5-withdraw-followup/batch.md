# 042-P5-withdraw-followup
Phase: 5 (PHASES.md)   Round: 1   Owner lane: claude-research (agent)
Mode: phase
Money: yes (the merchant's own wallet signs a USDT transfer; this batch changes when the page learns its hash)
Request (verbatim): coordinator, after PR #30 merged: "claude-frontend's UX review (posted on #30) found follow-ups; please
fix them … MEDIUM: withdraw() returns the hash only after waitForTransactionReceipt (lib/withdraw.ts:82-84), so the UI
shows "Waiting for your wallet…" through the whole receipt wait with no link. Hand the hash out as soon as the wallet
returns it and show "Sent, waiting for confirmation…" with the explorer link, then the confirmed state. Make sure the
headline balance re-reads after Sent. LOW: announce field errors (aria-live / aria-describedby), say "Whitechain Testnet"
not "Sepolia" (lib/withdraw.ts:27), Max tap target ≥ 44px, a Retry when the balance can't be read."
Agent ids (builders, for SendMessage resumes): this agent (worktree agent-ac442ce5c8a09e3d3, branch p5-withdraw-followup)
Log:
- Source: claude-frontend's UX review on PR #30 (PASS, 2 MEDIUM + 5 LOW; LOW 7, the duplicate balance card, is already
  gone on main via batch 040).
- Started as 041; renamed to 042 at the coordinator's request (claude-frontend took 041).
- Tests first dd0a635 (3 failing), lib 5c1c91b, UI ddbc938. ci PASS: 630/632, 0 fail, build 0.
- Security: no reviewer pass yet. The money change is only the timing of when the page learns the tx hash; the transfer
  call, checks and the no-second-send rule (033 M2) are unchanged.
