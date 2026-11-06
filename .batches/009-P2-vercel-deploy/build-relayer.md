STATUS: READY

# Build: 009-P2-vercel-deploy (claude-relayer, phase mode, Money: yes)
- Commits: `a53bc2e` test (copy test RED) → `e82f484` build (vendored `src/contracts.ts`, `vercel.json`, `public/`, `.vercelignore`, engines 26.x).
- Deploy: staged with `git archive HEAD:apps/relayer` (committed files only); `vercel link` created a `.env.local` holding only `VERCEL_OIDC_TOKEN`, deleted before every deploy; env vars via stdin, `--sensitive`, Production only.
- Open: two key-holding relayers until the web switches to the Vercel URL (local :8787 is stopped then).
