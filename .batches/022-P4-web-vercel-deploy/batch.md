# 022-P4-web-vercel-deploy
Phase: 4 (PHASES.md)   Round: 1   Owner lane: claude-frontend
Mode: phase
Money: yes (public payments deploy)
Request (verbatim): human 10:12 "Yes, deploy it (Recommended)"
Agent ids (builders, for SendMessage resumes):
Log:
- 10:14 linked apps/web to merchant-capital-web (CLI user vishal4742; .vercel git-ignored; vercel link added VERCEL_OIDC_TOKEN to the git-ignored .env.local). Project preset was 'Other', region iad1, no env set.
- 10:18 deployed: https://merchant-capital-web.vercel.app; live checks pass (200s, 401 without a key, per-route CSP, test-mode strip). The human set the 8 secrets; Claude set 5 public values.
- 10:24 human: "do the simple url" -> added the project domain https://merchant-capital.vercel.app; PUBLIC_ORIGIN updated; redeployed; the short URL serves 200s and 401 without a key; the old URL still works.

