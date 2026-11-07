# Releasing whiteflow.mcpb

The archive merchants install is built by GitHub Actions, not on a laptop. [`mcpb-release.yml`](../../.github/workflows/mcpb-release.yml) builds it from a commit, checks it, attests it and uploads it as a workflow artifact.

## What the release jobs do

The workflow has two jobs. `npm ci` and `npm test` run code from every dependency, so the job that runs them can't request the OIDC token that Sigstore exchanges for a signing certificate. Only the second job can, and it runs no npm, no node and nothing from the repository.

**`build`** (permission `contents: read` only):

1. In packages/mcp, on Node 26 with no dependency cache: `npm ci`, `npm run typecheck`, `npm test` (which packs and launches the archive) and `npm run pack`.
2. Checks the archive against `whiteflow.mcpb.sha256`.
3. Unpacks the archive and fails if any file holds a key-shaped string. That covers private keys (with or without `PRIVATE_KEY=`, as any `0x` followed by 64 hex digits), `sk-`, `sk_test_`, `sk_live_` and `wf_sbx_` keys, and GitHub and supermemory tokens. It prints only file names.
4. Hands the checked archive, its two checksums and the SBOM to the next job as the artifact `whiteflow-mcpb-unattested-<commit sha>`, kept for 1 day.

**`attest`** (`contents: read`, `id-token: write`, `attestations: write`; runs after `build` succeeds):

1. Downloads that artifact (`actions/download-artifact` fails on a digest mismatch).
2. Signs two attestations for the archive with Sigstore, through GitHub artifact attestations:
   - SLSA build provenance: which repository, workflow, commit and ref built it, and on which runner;
   - the CycloneDX SBOM that ships inside it.
3. Uploads the artifact `whiteflow-mcpb-<commit sha>`, kept for 90 days:

| File | What it is |
|---|---|
| `whiteflow.mcpb` | the bundle |
| `whiteflow.mcpb.sha256` | sha256 of the archive's bytes |
| `whiteflow.mcpb.contents.sha256` | sha256 over the files inside; the same source gives the same value |
| `whiteflow.mcpb.sbom.cdx.json` | the SBOM, copied out of the archive |
| `whiteflow.mcpb.provenance.sigstore.json`, `whiteflow.mcpb.sbom.sigstore.json` | the two signed attestations, for checking without the GitHub attestations API |

## Cut a release (the owner or a maintainer)

1. Bump `VERSION` in `src/server.ts` and run `npm run manifest`. Merge that through a PR with green CI; `npm run pack` refuses a stale manifest.json.
2. Tag the merge commit on `main` with the manifest version, and push the tag:
   ```sh
   git tag mcpb-v0.3.0 <merge commit on main>
   git push origin mcpb-v0.3.0
   ```
   The `build` job fails if the tag isn't `mcpb-v` followed by manifest.json's `version`.
3. When the run is green, download the artifact and publish it, for example as a GitHub Release:
   ```sh
   gh run download <run id> -n whiteflow-mcpb-<commit sha> -D release
   gh release create mcpb-v0.3.0 release/* --verify-tag --title "Whiteflow Merchant MCP 0.3.0"
   ```
   The workflow doesn't publish anything itself, because that would need `contents: write`. Moving the file doesn't break the attestation, which covers the archive's sha256, not where it's hosted.

Once the workflow is on `main`, you can also start it from the Actions tab (Run workflow) to make a test build of any branch. That build is attested too, with the branch as its ref. That is why the strict check below pins `--source-ref` to the release tag.

## Verify a download (anyone)

```sh
# 1. The bytes match the published checksum (PowerShell:
#    (Get-FileHash whiteflow.mcpb).Hash.ToLower() -eq (Get-Content whiteflow.mcpb.sha256).Split(' ')[0])
sha256sum -c whiteflow.mcpb.sha256

# 2. GitHub Actions built these exact bytes in this repository
gh attestation verify whiteflow.mcpb --repo Vishal4742/whiteflow

# 3. Stricter: built by the release workflow, from the release tag, on a GitHub-hosted runner
gh attestation verify whiteflow.mcpb --repo Vishal4742/whiteflow \
  --signer-workflow Vishal4742/whiteflow/.github/workflows/mcpb-release.yml \
  --source-ref refs/tags/mcpb-v0.3.0 --deny-self-hosted-runners

# 4. The SBOM attestation
gh attestation verify whiteflow.mcpb --repo Vishal4742/whiteflow --predicate-type https://cyclonedx.org/bom
```

To check without the GitHub attestations API, add `--bundle whiteflow.mcpb.provenance.sigstore.json` to step 2 or 3, or `--bundle whiteflow.mcpb.sbom.sigstore.json` to step 4. A checksum alone only shows the download wasn't damaged, and only if the checksum came from a channel you trust. The attestation is what ties the bytes to this repository, workflow and commit.

## Limits

- **This is provenance, not an MCPB signature.** The attestation proves which workflow, repository and commit produced these bytes, and you check it with `gh attestation verify`. MCPB clients don't read it: Claude Desktop and `mcpb info` still show the archive as **unsigned** ("WARNING: Not signed").
- **`mcpb sign` needs a real code-signing certificate and its private key, which the owner must provide.** `mcpb sign --self-signed` would prove nothing to a user. When the owner has a certificate:
  1. Store the key as a secret in a GitHub environment with required reviewers.
  2. Sign after the key scan and before the attestations, so the attested digest is the signed archive's. Keep the key out of `build`, where every dependency's code has run: use its own job between `build` and `attest` that installs only `@anthropic-ai/mcpb`.
  3. Check the result with `mcpb verify`.
  Until then the workflow has no signing step.
- **A tag is only as trustworthy as the people who can push it.** Anyone with write access can push an `mcpb-v*` tag on any commit, and a manual run can build any branch. The attestation records the exact commit and ref, so check `--source-ref` and compare the commit it reports with `main`. Owner action: a tag ruleset that limits who can create `mcpb-v*` tags.
- **A rebuild can't reproduce the archive's sha256.** `mcpb` 2.1.2 stamps zip entries with the build time. `whiteflow.mcpb.contents.sha256` (the files inside) is the reproducible value.
- **The key scan matches patterns.** It catches the key formats listed above, not every possible secret.
- Actions are pinned to major tags (`@v7`, `@v4`, `@v8`), as in ci.yml, not to commit SHAs.
- Attestations work on public repositories like this one on every GitHub plan. A private copy would need GitHub Enterprise Cloud.
