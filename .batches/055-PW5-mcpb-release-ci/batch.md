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
