# Spec: 055-PW5-mcpb-release-ci: CI-built, attested whiteflow.mcpb releases

## Requirements (cite docs/SRS.md IDs)
- FR-MCP-12 (approved SRS-CHANGE, batch 052 srs-change.md): `whiteflow.mcpb` with its sha256 installs in MCPB clients.
  This batch makes the archive people install come from GitHub Actions on a known commit, with checksums, the SBOM,
  and a SLSA build-provenance attestation that anyone can verify.
- NFR-17 (v3.1): no keys in model context, logs or bundle files. Before the release job attests the archive, it unpacks
  it and refuses it if any file holds a key-shaped string. It prints only the file name, never the match.
- Production review F8 (batch 052 production-plan.md §5, "signed, attested release": partial): "the archive is
  unsigned; add CI-origin provenance, SBOM, checksums".

## Acceptance criteria (each checkable)
- [ ] `.github/workflows/mcpb-release.yml` runs on `workflow_dispatch` and on tags `mcpb-v*`. ci.yml and the required
  checks are unchanged.
- [ ] Permissions: `{}` at the workflow level. The one job gets exactly `contents: read`, `id-token: write` and
  `attestations: write`.
- [ ] Checkout uses `persist-credentials: false`. Node is 26 via setup-node. There is no dependency cache: a release
  build must not restore files another workflow wrote.
- [ ] In packages/mcp: `npm ci`, `npm run typecheck`, `npm test` and `npm run pack`. Then `sha256sum -c` checks the
  archive against its `.sha256` file.
- [ ] On a tag push, the tag's version (`mcpb-v<version>`) must equal `manifest.json`'s `version`, or the job fails.
- [ ] `mcpb unpack` (the installed devDependency) unpacks the archive. The job fails if `manifest.json` or
  `server/index.mjs` is missing, so an empty unpack can't pass the scan. `grep -l` then scans every file with the
  pre-push regexes plus `sk_test_[A-Za-z0-9_-]{24,}` and `wf_sbx_[A-Za-z0-9_-]{32}`. A hit prints the file name only
  and fails the job. A grep error (exit 2) also fails it.
- [ ] Attestations come from `actions/attest`: SLSA provenance on `whiteflow.mcpb`, plus an SBOM attestation on the same
  subject from the `sbom.cdx.json` taken out of the archive (CycloneDX, so the attested SBOM is the shipped one).
- [ ] One artifact holds whiteflow.mcpb, both checksum files, the SBOM and the two Sigstore bundles, with
  `if-no-files-found: error`. The attestations run before the upload, so nothing unattested is uploaded.
- [ ] Each action is pinned to its current major, checked on GitHub on 2026-11-07 (sources in ci.md).
- [ ] actionlint passes. Its binary is downloaded into its own empty folder and checked against the release checksums.
- [ ] Local proof: the workflow's own scan block, run on a freshly packed archive, passes. With a planted key-shaped
  string it fails and prints only that file's name.
- [ ] packages/mcp/RELEASE.md covers cutting a release, verifying one (`gh attestation verify`, sha256) and honest
  limits: GitHub-attested provenance, not an MCPB signature.
- [ ] A draft PR with base `wf/merchant-mcpb`, and one `gh workflow run` attempt. The result, or the exact reason it
  can't run, goes in ci.md.

## Files
- `.github/workflows/mcpb-release.yml` (new)
- `packages/mcp/RELEASE.md` (new)
- `.batches/055-PW5-mcpb-release-ci/` (this folder)

## Ponytail ladder
- Does it need to exist? Yes, F8 is open and merchants install this archive.
- Already in the repo? pack.mjs already builds the archive, both checksums and the SBOM. The mcp job in ci.yml is the
  step pattern, and the pre-push hook has the secret regexes. All three are reused, not rebuilt.
- Platform? GitHub artifact attestations (`actions/attest@v4`) handle both SLSA provenance and the CycloneDX SBOM
  attestation, signed keylessly by Sigstore through the job's OIDC token. There are no keys to manage.
- No new script and no new dependency.
- ponytail: the job uploads a workflow artifact and creates no GitHub Release, because that would need
  `contents: write`. Upgrade trigger: when the owner wants automatic publishing, add a separate publish job with
  `contents: write` that needs this job.

## Out of scope
- `mcpb sign`: it needs a code-signing certificate the owner must provide. Until then MCPB clients show "unsigned".
- packages/mcp source, scripts and tests (whiteflow-8b's lane), ci.yml, branch protection, tags and merges.
- Publishing a GitHub Release.
