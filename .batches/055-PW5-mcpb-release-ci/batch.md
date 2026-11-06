# 055-PW5-mcpb-release-ci
Phase: 5 / W5 (MCP)   Round: 1   Owner lane: claude (CI and release; worktree P:/wf-release, branch wf/mcpb-release-ci,
stacked on wf/merchant-mcpb, draft PR #45)
Mode: phase
Money: yes (signing: the job mints an OIDC id-token for Sigstore attestations of the archive merchants install)
Request (from whiteflow-8b, at the human's request, 2026-11-07, summarized): "build a CI release workflow for the
WhiteFlow Merchant MCP bundle, so the .mcpb shipped is built from a reviewed commit and carries a verifiable
build-provenance attestation. This is production review finding F8: the archive is unsigned; add CI-origin provenance,
SBOM, checksums." Files: .github/workflows/mcpb-release.yml (new; ci.yml and required checks untouched),
packages/mcp/RELEASE.md (new; packages/mcp's other files stay whiteflow-8b's). Draft PR with base wf/merchant-mcpb, one
workflow_dispatch attempt, no merges, no tags.
Agent ids (builders, for SendMessage resumes): claude (this session)
Log:
- batch folder made by hand: batch-start.sh would pick 053, and 053 and 054 are taken.
- round 1: ci PASS (PR #49, ci run 42303861937 green on c435259). The scan step was proven locally against a real
  archive and a planted one. actionlint was downloaded and checksum-verified but not allowed to run here.
  workflow_dispatch returns 404 until the file is on main.
- round 1: reviewer-security PASS. The first attempt died on an API billing error; the retry succeeded. Follow-ups
  for the next batch: M1 tie releases to a commit on main (verify with --source-digest, check main's history on tag
  runs, a tag ruleset from the owner); M2 split the build and attest jobs so npm code can't mint the OIDC token, plus
  npm ci --ignore-scripts; L1 pin actions to SHAs; L2 add whsec_ and sk_live_ to the scan; L3 compare the unpacked
  contents digest; L4 the SBOM says 0.2.0 from package.json while the release is 0.3.0 (build.mjs, whiteflow-8b).
- closed under the supervisor's (whiteflow-8c) scope freeze: no follow-up built in this batch, nothing merged.
