VERDICT: PASS

Scope check: `git diff --stat -- apps/web` shows only package.json (+1), package-lock.json (+21), tsconfig.json (+1). Untracked: apps/web/lib/arkiv.ts, apps/web/scripts/arkiv-probe.ts, apps/web/test/arkiv.test.mjs. No page, component or CSS file changed. No customer-flow surface, so FR-PAY-7 and FR-ADV-6 do not apply.

Proofs page (http://localhost:3100, HTTP 200, no rebuild): renders as before.
- .batches/003-P1-arkiv-probe/round-1/shots/ux-1440.png: header, hero, DEP-6 "Running" and DEP-3 "OK" cards, pill button, all as in batch 002.
- .batches/003-P1-arkiv-probe/round-1/shots/ux-375.png: clipped on the right. This is a headless Chrome capture artifact (window narrower than its minimum), not a regression, since no style or markup file changed. Batch 002 shots cover 375.

Probe output (read, not run):
- Success prints one JSON block: writer address, entityKey, txHash, createMs, queryMs, found, expiresInMin. Public values only, readable, easy to paste into a report. Good.
- Errors are one line, name the variable and never its value: "ARKIV_PRIVATE_KEY is missing or malformed.", "ARKIV_ACCESS_KEY is missing.", "Arkiv probe failed: <redacted message>". Access key is replaced with <access-key>. Good.
- Exit code is 1 on failure or found=false. Good.

Findings (all LOW, optional, owner lane claude-frontend unless noted):
1. "ARKIV_ACCESS_KEY is missing." does not say what to do. Fix: append " Set it in .env (see .env.example)." Same for the private key line. Only if .env.example lists both.
2. found=false exits 1 with the JSON and no sentence. Fix: also print one line to stderr, e.g. "Arkiv probe failed: the entity was created but the query did not return it." (indexing delay is likely; say to retry).
3. Failures of the missing .env itself: `node --env-file=../../.env` stops with Node's own message if the file is absent. README should mention that.

README section (owner claude-research) should say:
- Run from apps/web: `node --env-file=../../.env scripts/arkiv-probe.ts` (needs Node with native TypeScript stripping; state the minimum version).
- Needs ARKIV_PRIVATE_KEY (0x, 66 chars) and ARKIV_ACCESS_KEY in the git-ignored .env; never paste them into issues or logs.
- Each run creates one entity and spends a little tGLM on Rabdi; the writer must be funded. The entity expires after 30 minutes.
- Expected success: JSON with found: true. Typical failure lines and their meaning (missing key, timeout after 30 s, unfunded writer).
- Do not run it in CI.
