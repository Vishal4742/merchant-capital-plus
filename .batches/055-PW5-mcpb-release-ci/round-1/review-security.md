VERDICT: PASS

# review-security: 055-PW5-mcpb-release-ci, round 1 (phase mode, Money: yes, the batch's one security pass)

Scope: `git -C P:/wf-release diff c8fc909..HEAD` (56e50ce, 1cdc634, c435259). Product files: `.github/workflows/mcpb-release.yml`
(new) and `packages/mcp/RELEASE.md` (new). I also read packages/mcp/scripts/{pack,build}.mjs, package.json, package-lock.json,
`@anthropic-ai/mcpb` 2.1.2's dist/cli/{cli,unpack}.js, ci.yml and tools/githooks/pre-push.
No HIGH or CRITICAL findings. Two MEDIUM and four LOW go under FOLLOW-UP below. None of them blocks.

## Secret grep (required)
- `grep -nE '(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})'` on the four changed files: **1 hit**, `.github/workflows/mcpb-release.yml:59`,
  the `keys='PRIVATE_KEY=0x[0-9a-fA-F]{64}|…'` regex literal. It is a pattern, not a secret.
- The repo's own scan (the ci.yml `secrets` job and pre-push, `git grep -nE '<regex>' -- ':!tools/agentbus.py'`) over the whole
  worktree: exit 1, no hit. The workflow's regex line doesn't match itself, because each prefix is followed by `[`, which none of
  the character classes accept. ci.yml already carries the same literal and passes.

## What I checked and found sound
- **Token scope:** workflow `permissions: {}`. The job gets only `contents: read`, `id-token: write` and `attestations: write`
  (yml:12, 22-25). No secrets are referenced. `GITHUB_TOKEN` reaches only `actions/attest`, through its default input, and no
  `run` step gets it.
- **Credential persistence and caches:** checkout has `persist-credentials: false` (yml:32). setup-node has
  `package-manager-cache: false` and no `cache:` input. I confirmed in setup-node@v7's action.yml that this input exists and
  defaults to true. No `actions/cache` step.
- **Injection:** no `${{ }}` reaches a shell. The bundle paths go through `env:` (yml:82-87). `github.ref`/`github.sha` appear
  only in `concurrency.group`, `if:` and an action input. The tag check reads `$GITHUB_REF_NAME` from the environment. Git
  refnames can't contain control characters or spaces, so the `::error::` line can't be turned into a second workflow command.
- **Triggers:** only `workflow_dispatch` and `push` of tags `mcpb-v*`. There is no `pull_request` or `pull_request_target`, so
  someone without write access cannot start the job. A tag pushed in a fork runs and attests under the fork's identity, and
  `--repo Vishal4742/whiteflow` rejects it.
- **Scan (yml:52-69):** I checked these cases:
  - `mcpb unpack` exits 1 on any error (cli.js:100, unpack.js:92-99), so `bash -e` fails a partial unpack. It also refuses
    zip-slip paths.
  - An empty unpack, or one nested a level down, fails the check for manifest.json, server/index.mjs and sbom.cdx.json.
  - `hits=$(grep …) || status=$?` keeps the exit code. 0 fails with file names, 1 passes, and anything else fails without
    printing the hits. If an error and a match happen together, grep exits 2 and the step fails closed.
  - `grep -l` never prints the matched text. I tested a binary file (NUL and invalid UTF-8 bytes) holding a `ghp_` string. It
    was listed by name only, in both C.UTF-8 and C locales (GNU grep).
  - `-r` doesn't follow symlinks.
  - If a file name contains a newline, every printed line still starts with `::error::`, so it can't inject a command.
- **Attested bytes are the shipped bytes:** nothing changes dist/whiteflow.mcpb between the scan, both `actions/attest` steps and
  the upload. The SBOM is copied out of the unpacked archive (yml:69), so the attested SBOM is the one that ships.
- **Attest action details:** `actions/attest@v4` with only `subject-path` uses its Provenance mode (SLSA). With `sbom-path` it
  uses SBOM mode (README "Attestation Modes"). Each run writes its bundle under its own `mkdtemp` directory
  (src/main.ts:99, 234-242), so the SBOM bundle can't overwrite the provenance bundle.
- **Action majors:** I confirmed each one read-only, and each major points at the same commit as the builder's patch tag:
  - attest v4 = v4.2.2 = `1e69f48acb82d1966a394da916b4c1698aa569d6`
  - checkout v7 = v7.0.1 = `3d3c42e5aac5ba805825da76410c181273ba90b1`
  - setup-node v7 = v7.1.0 = `949feb2413d6458794dcd2491c4babbbce0c15c1`
  - upload-artifact v7 = v7.0.2 = `cf430e030ddbb5b0abf93d22962f4752f3646cd9`
- **gh flags:** every flag RELEASE.md uses exists in gh 2.99.0 (`--signer-workflow`, `--source-ref`,
  `--deny-self-hosted-runners`, `--predicate-type`, `--bundle`). The default predicate type is `https://slsa.dev/provenance/v1`,
  so step 2 can't match the SBOM attestation by mistake.
- **No overclaim in RELEASE.md:**
  - It says plainly that this is "provenance, not an MCPB signature", that clients still show it as unsigned, and that a rebuild
    can't reproduce the archive's sha256.
  - It says a checksum is only as good as the channel it came from.
  - It names the tag-trust limit and the owner action (a tag ruleset).
  - Its claim about public repositories and plans matches GitHub's documentation.

## FOLLOW-UP (MEDIUM / LOW, non-blocking)

### M1 (MEDIUM): the verification steps don't tie the release to a reviewed commit on `main`
- **Where:** RELEASE.md:48-57 (verify steps), :70 (limits), :26-31 (cutting a release); mcpb-release.yml:7-10, 37-43.
- **Exploit sketch:**
  1. A collaborator with write access, or a stolen maintainer token, pushes branch `x`. It changes `src/` (for example, sending
     the `sk_test_` key elsewhere) or edits mcpb-release.yml itself to drop the scan. It also sets manifest.json to 0.3.0.
  2. They run `git tag mcpb-v0.3.0 <that commit>` and push the tag. For tag pushes, GitHub runs the workflow file from the
     tagged commit.
  3. The certificate then reads `…/mcpb-release.yml@refs/tags/mcpb-v0.3.0`, source ref `refs/tags/mcpb-v0.3.0`, on a
     GitHub-hosted runner. Step 3, the strictest check RELEASE.md gives, passes.
  4. Deleting the tag and pushing it again on another commit gives a second valid attestation with the same `--source-ref`.
- **Weaker steps:**
  - Step 2 (`--repo` only) and step 4 (SBOM, `--repo` only) accept any workflow in the repo on any ref. That includes a new
    workflow file in a same-repo PR or branch that asks for `id-token: write` and `attestations: write`.
  - Line 70 says "compare the commit it reports with `main`" but doesn't say how.
- **Mitigating factors:** this needs write access, and RELEASE.md already discloses the limit and the owner action. That is why
  it is MEDIUM and not HIGH.
- **Fix:**
  - (a) RELEASE.md:
    - Make the strict command the one people run. Label `--repo`-only as weak ("any workflow, any branch of this repo").
    - Publish the commit SHA in the release notes. Add `--source-digest <commit sha>` to step 3.
    - Give a concrete check that the commit is on `main`:
      `gh api repos/Vishal4742/whiteflow/compare/main...<sha> --jq .status` must print `behind` or `identical`.
    - Give step 4 the same `--signer-workflow`, `--source-ref` and `--source-digest` pins.
  - (b) Workflow: on tag runs, fail unless `$GITHUB_SHA` is an ancestor of `origin/main`. For example, check out with
    `fetch-depth: 0` and run `git merge-base --is-ancestor "$GITHUB_SHA" origin/main`. Or use the compare API with
    `GH_TOKEN: ${{ github.token }}` in that one step. This catches mistakes, and catches a tag on an unreviewed commit that still
    carries the reviewed workflow. A commit that also edits the workflow is caught by (a).
  - (c) Owner: a repository ruleset on `refs/tags/mcpb-v*` that restricts creation, update and deletion, with a short bypass
    list. RELEASE.md:70 already asks for this.
- **Owner lane:** claude (CI/release) for (a) and (b). The repository owner (human) for (c).

### M2 (MEDIUM): every build step can mint the OIDC token, including npm ci's install scripts
- **Where:** mcpb-release.yml:22-25 (job-level `id-token: write`) with :44-47 (`npm ci`, `npm test`, `npm run pack`).
- **Problem:** with `id-token: write`, `ACTIONS_ID_TOKEN_REQUEST_URL` and `ACTIONS_ID_TOKEN_REQUEST_TOKEN` are in the
  environment of every step in the job. That includes `npm ci` lifecycle scripts (lockfile: `esbuild` 0.28.2 has
  `hasInstallScript`), 175 locked packages, the test suite and the bundler.
- **Exploit sketch:**
  1. A compromised dependency version lands in the lock (for example, a Shai-Hulud-style worm).
  2. Its code calls the token endpoint with audience `sigstore` and gets a Fulcio certificate for
     `mcpb-release.yml@refs/tags/mcpb-vX`.
  3. It signs Sigstore bundles for any bytes it likes, not only this run's archive. Those bundles pass
     `gh attestation verify --bundle … --signer-workflow … --source-ref …` offline and can be shipped later outside GitHub.
  4. The same token is good for any cloud OIDC trust that uses a loose `repo:Vishal4742/whiteflow:*` subject.
- **Mitigating factor:** such a dependency could also just backdoor this archive. The token only adds the ability to sign other
  bytes. That is why this is MEDIUM.
- **Fix:**
  - Split into two jobs:
    1. `build`: `contents: read` only. It runs npm ci, typecheck, test, pack and the scan, uploads the archive and SBOM, and
       outputs the sha256.
    2. `attest`: `needs: build`, with `id-token` and `attestations` write. It downloads the artifact, checks the sha256 against
       `needs.build.outputs.digest`, runs both `actions/attest` steps and uploads the final artifact. It runs no npm code.
  - Also run `npm ci --ignore-scripts`. esbuild uses its `@esbuild/linux-x64` optional dependency without the postinstall step;
    confirm the pack still passes.
  - RELEASE.md's future `mcpb sign` plan (RELEASE.md:65-69) should also sign in a separate job that holds the environment secret
    and runs no npm code.
- **Owner lane:** claude (CI/release).

### L1 (LOW): action pins are mutable major tags in the job that holds `id-token: write`
- **Where:** mcpb-release.yml:30, 33, 72, 77, 88.
- **Problem:** all four are first-party `actions/*` and match ci.yml's convention, and RELEASE.md:73 discloses this. But a tag
  that is moved, or a compromised `actions` org, runs inside the signing job. `actions/attest` is the code that signs.
- **Fix:** pin this workflow to commit SHAs with a version comment, for example
  `actions/attest@1e69f48acb82d1966a394da916b4c1698aa569d6 # v4.2.2`. The other three SHAs are listed above. Add Dependabot for
  `github-actions` to keep them current.
- **Owner lane:** claude (CI/release).

### L2 (LOW): the scan misses two of the product's own secret formats
- **Where:** mcpb-release.yml:59.
- **Problem:** the product issues `whsec_` webhook signing secrets (apps/web/lib/server/webhooks.ts:80, 43 base64url characters).
  Its tests also check `sk_live_` keys (apps/web/test/gateway-dev.test.mjs:64). Neither pattern is in `keys`. A bare 64-hex
  private key without `PRIVATE_KEY=` is not caught either. RELEASE.md:72 admits the scan matches patterns only.
- **Fix:** add `|whsec_[A-Za-z0-9_-]{32,}|sk_live_[A-Za-z0-9_-]{24,}` and list both formats in RELEASE.md:9. The literal can't
  trip the repo scan, because neither pattern is in it and each prefix is followed by `[`. A bare-hex rule would produce false
  positives on hashes; leave it out unless it's scoped.
- **Owner lane:** claude (CI/release).

### L3 (LOW): only 3 of the archive's files are checked to have been unpacked
- **Where:** mcpb-release.yml:55-57.
- **Problem:** `mcpb unpack` already fails on any error, so the risk is low. But nothing proves the scanned tree is exactly what
  was packed: server/sandbox-cli.mjs, README.md, LICENSE, THIRD_PARTY_LICENSES and icon.png aren't checked. Nothing proves the
  published `whiteflow.mcpb.contents.sha256` matches the attested archive either.
- **Fix:** after unpacking, recompute pack.mjs's contents digest over `$out`: sorted `path\0sha256(file)\n` entries, then sha256
  over those. Compare it with the first field of `dist/whiteflow.mcpb.contents.sha256`, or at least compare the file list.
- **Owner lane:** claude (CI/release).

### L4 (LOW): the attested SBOM gives the wrong product version
- **Where:** packages/mcp/scripts/build.mjs:74-78.
- **Problem:** `metadata.component.version` comes from package.json (`0.2.0`), but the release version is manifest.json /
  `VERSION` (`0.3.0`, src/server.ts:22). The 0.3.0 release would carry a signed SBOM that calls itself 0.2.0. RELEASE.md:25 says
  to bump only `VERSION`, so the two will keep drifting apart.
- **Fix:** take the SBOM version from `VERSION` or the manifest, or bump package.json in the same step and say so in
  RELEASE.md:25.
- **Owner lane:** whiteflow-8b (build.mjs), and claude for the RELEASE.md line.

## Notes (not findings)
- The spec's acceptance criterion "actionlint passes" is still unmet, because the binary couldn't be run. ci.md should record
  this as open and not as passed. The structure check and `bash -n` don't replace it, for example for `if:` expression typos.
- `whiteflow.mcpb.contents.sha256` is not an attestation subject. A verifier trusts it only by recomputing it from the attested
  archive. RELEASE.md:19 could say so.
