# Spec: 059-P5-whiteflow-sweep (Money: no; wording only)

Request (human, 2026-11-07 06:47-06:48, claude-relayer session): "Change the repo name to Whiteflow." / "Check all the
wording. Check every line in the repo, every doc, everything, including the previous name. Change all to Whiteflow."
Answers (human 06:5x): spelling "Whiteflow everywhere" (the existing "WhiteFlow" too); stored IDs "Keep them"; the
GitHub repo rename "After the cutover" (after claude-sdk's UNFREEZE and the #43/#44/#47 stack).

## Requirements (cite docs/SRS.md IDs)
- FR-PAY-7: the pay pages name the shop and the product in plain words; the product name is now "Whiteflow".
- FR-GW-1 / FR-GW-4 / FR-GW-5: the hosted sheets, the pay button and the SDK docs carry the product name "Whiteflow".
- One final sweep on the final main (after the stack merges), so no other lane's open file changes under it: every
  tracked text file, every doc and every batch record. The rules live in `rename.sh` (this folder) and are idempotent:
  - "Merchant Capital+", "MERCHANT CAPITAL+", "Merchant Capital Plus" and "WhiteFlow" become "Whiteflow".
  - `@merchant-capital/sdk` becomes `@whiteflow/sdk` (it is never installed by name: vendored copies only, sdk README:29).
  - `Vishal4742/merchant-capital-plus` becomes `Vishal4742/whiteflow` (after the GitHub rename); `cd merchant-capital-plus`
    becomes `cd whiteflow`; the README's `claude mcp add merchant-capital` becomes `claude mcp add whiteflow`.
- NOT changed (stored IDs, human "Keep them"): `mcplus.*` browser keys (funded guest wallets incl. G5), the
  `mcplus_relayer` Postgres role, the Arkiv schemas `mcplus.*.v1`, the contract script salts, `MC-Signature`,
  `mc_session`, the `WHITEFLOW_*` env names, every `*.vercel.app` host and Vercel project name, deployment ids, the
  `.gitignore` rule for the local `merchant-capital-plus-main/` snapshot (it still exists on disk), paths to local files
  (`design-refs/merchant-capital-demo.html`, `research_notes/...merchant_capital.md`), and `merchantCapital` (the
  merchant's Capital tab, not the brand). `contracts/src` (verified on Blockscout byte for byte). Lockfiles, except the
  sdk's two name lines. Git history and commit messages can't change (no history rewrites).
- Signed strings: "Whiteflow" changes the EIP-712 `ackDomain.name` (acks are verified once on POST and stored, batch
  058) and the SIWE statement (each sign-in signs the message it is shown). Before merge, check every other signed
  string in the final diff (the Safe owner message: ask claude-contracts whether any owner has signed it).

## Acceptance criteria (each must be checkable)
- [ ] `git grep -n -E 'Merchant Capital|MERCHANT CAPITAL|WhiteFlow'` is empty.
- [ ] `git grep -o -E 'mcplus|MC-Signature|mc_session|WHITEFLOW_'` counts equal the counts before the sweep (ids-before.txt).
- [ ] `git diff --stat origin/main -- contracts/src` is empty.
- [ ] CI's checks for every changed folder pass (web typecheck + lint + tests, relayer, sdk, mcp, shop, forge build, secrets).
- [ ] The GitHub repo is Vishal4742/whiteflow, the old URL redirects, and web, relayer and shop still deploy from Git.

## Files to touch (owner lane: claude-relayer for this sweep, assigned by the human)
- Every tracked text file with the old wording (written by `rename.sh`), plus this batch folder.

## Ponytail ladder (why this is the smallest change that works)
- One perl pass over `git grep -l` output, no new tooling; re-runnable on the final main, so no hand edits to merge.

## Out of scope
- Screenshots in docs/screens that show the old wordmark (binary; retake after the deploy), the demo video, the Vercel
  project names, and the ETHGlobal submission form (the human edits it).
