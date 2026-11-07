VERDICT: PASS
Batch 055-PW5-mcpb-release-ci, round 1. Phase mode (PIPELINE.md §3b.1): written by the lane. Head c435259, draft PR #49 (base wf/merchant-mcpb).

## GitHub Actions (ci.yml on PR #49)
Run https://github.com/Vishal4742/whiteflow/actions/runs/42303861937: conclusion `success` on c4352597250d.
- Jobs: secrets, changes, relayer, sdk, web, contracts, mcp. All passed.
- Every job ran because the diff touches `.github/workflows/`.
- Not CI: the two Vercel previews (web, relayer) say "Deployment rate limited, retry in 24 hours". They aren't required checks, and this branch doesn't deploy.

## Local checks (Node 26.13.0, Windows)
- The pre-push hook on `git push -u origin wf/mcpb-release-ci` printed "web typecheck / web lint / web tests / mcp typecheck + tests / all checks passed".
- `npm run pack` in packages/mcp:
  - mcpb validate, pack and info passed;
  - `mcpb info` says "WARNING: Not signed", as RELEASE.md states;
  - archive sha256 bb2453e5…eaac, contents sha256 d9795dd2…eb94;
  - 8 files: LICENSE, README.md, THIRD_PARTY_LICENSES, icon.png, manifest.json, sbom.cdx.json, server/index.mjs, server/sandbox-cli.mjs;
  - `sha256sum -c whiteflow.mcpb.sha256` gave `whiteflow.mcpb: OK`. manifest.json version is 0.3.0.
- **The scan step itself** (scratch script `scan-test.sh`, outside the repo). It pulls the step's `run:` text out of mcpb-release.yml with PyYAML and runs it with `bash -e`, the way the runner does:
  ```
  == 1: the real archive (expect exit 0)
  Extension unpacked successfully to …\t1\unpacked
  no key-shaped strings in 8 files
  exit=0
  SBOM copied out of the archive, identical to the staged one
  == 2: planted sk_test_ and wf_sbx_ strings (expect exit 1, two file names, no values)
  ::error::key-shaped string in leak-b.txt
  ::error::key-shaped string in server/leak-a.mjs
  exit=1
  both planted files named
  no planted value in the output
  whiteflow.mcpb: OK
  SCAN TEST PASS
  ```
  The planted values were random at runtime, the archive was repacked with `mcpb pack`, and dist/ was restored afterwards.
- **Structure check** (scratch `lint-workflow.py`). It checks:
  - triggers (`workflow_dispatch`, push tags `mcpb-v*`);
  - `permissions: {}` at the workflow level, and exactly contents: read, id-token: write, attestations: write on the job;
  - pins, `persist-credentials: false`, Node 26, the npm cache off;
  - no `${{ }}` in any shell block;
  - attestations before the upload, `if-no-files-found: error`, artifact paths;
  - `bash -n` on every run block.

  Output: `workflow structure OK: 13 steps, 8 run blocks pass bash -n`.
- The workflow's regexes don't trip the repo's own secret scan: both the pre-push scan and the CI `secrets` job passed on this branch.

## Action versions (checked on GitHub 2026-11-07)
| Pin | Latest release | Commit the tag resolves to | Source |
|---|---|---|---|
| actions/checkout@v7 | v7.0.1 (2026-07-20) | 3d3c42e5aac5 | `gh api repos/actions/checkout/releases/latest`, `…/commits/v7` |
| actions/setup-node@v7 | v7.1.0 (2026-10-08) | 949feb2413d6 | same calls for actions/setup-node |
| actions/upload-artifact@v7 | v7.0.2 (2026-10-07) | cf430e030ddb | same calls for actions/upload-artifact |
| actions/attest@v4 | v4.2.2 (2026-08-04) | 1e69f48acb82 | same calls for actions/attest |

- actions/attest-build-provenance v4.2.2 and actions/attest-sbom v4.1.0 are wrappers over actions/attest. Their READMEs point new workflows there, and attest-sbom is marked deprecated.
- `actions/attest` `src/sbom.ts` at v4.2.2 accepts CycloneDX (`bomFormat` + `serialNumber` + `specVersion`) and writes predicate type `https://cyclonedx.org/bom`.
- The inputs used were checked against each pin's action.yml:
  - checkout `persist-credentials`;
  - setup-node `package-manager-cache`;
  - upload-artifact `if-no-files-found` and `retention-days`;
  - attest `subject-path` and `sbom-path`, and the `bundle-path` output.

## Not done, and why
- **actionlint: not run.** actionlint 1.7.12 `windows_amd64.zip` was downloaded into its own empty folder (C:/Users/nothi/tools-dl/actionlint-1.7.12) and matched the release's checksums file (`OK`). Running the binary was then denied by the session's auto-mode permission classifier ("Code from External"). The structure check above stands in for it. The user can allow it and run `actionlint .github/workflows/mcpb-release.yml`.
- **The release workflow has never run.** `gh workflow run mcpb-release.yml --ref wf/mcpb-release-ci` returned `HTTP 404: workflow mcpb-release.yml not found on the default branch`. The dispatch API only sees workflows whose file is on `main`, and the repo's only registered workflow is `ci`. A tag push would run it from the tagged commit, but tags are out of scope. The first real run happens after this reaches `main` (Run workflow on the Actions tab), or on the owner's first `mcpb-v*` tag.
- **The .mcpb is still unsigned.** This adds GitHub-attested provenance, not an MCPB signature. `mcpb sign` needs a code-signing certificate and key from the owner (RELEASE.md §Limits).
