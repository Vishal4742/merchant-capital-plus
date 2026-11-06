# Spec: 052-P5-vercel-quota

## Requirements (cite docs/SRS.md IDs)
- CON-3 / SR-WC-1 stay deployable: production (main) deploys must not be starved by branch previews.
- AGENTS.md "Deploy only from GitHub": main is the only branch that deploys.

## Change
`git.deploymentEnabled = {"**": false, "main": true}` in each Git-connected project's vercel.json
(apps/web, apps/relayer, apps/shop). Vercel: a branch matching several rules deploys if any rule is true,
so main deploys and every other branch (including `a/b` names: `**` crosses `/`) creates no deployment
at all, so it uses no quota. Docs: https://vercel.com/docs/project-configuration/git-configuration#git.deploymentenabled

## Acceptance criteria
- [ ] The 3 vercel.json files parse and keep every existing key (relayer test deploy-config passes).
- [ ] Pushing this branch creates no Vercel deployment (checked with the deployments API).
- [ ] After the merge, main creates its 3 deployments as before (web/relayer/shop production).

## Files to touch
apps/web/vercel.json, apps/relayer/vercel.json, apps/shop/vercel.json (new), AGENTS.md (one line)

## Not in scope
PR previews come back only by upgrading the plan or by `vercel deploy` (forbidden). Branch protection's
required checks are GitHub Actions only, so no PR loses a required check.
