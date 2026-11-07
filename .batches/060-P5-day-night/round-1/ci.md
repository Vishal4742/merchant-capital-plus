VERDICT: PASS

CI round 1, batch 060-P5-day-night, branch p5-day-night (diff 8d8ec7c..HEAD, apps/web only). Run from apps/web.

| Command | Exit | Result |
|---|---|---|
| npx tsc --noEmit | 0 | no output |
| npm run lint (eslint) | 0 | no warnings or errors |
| npm test | 0 | tests 819, pass 817, fail 0, cancelled 0, skipped 2 (test/theme.test.mjs among them) |
| npm run build | 0 | all routes listed, none failed |
| secret scan (pre-push regex, `git grep -E`, excluding tools/agentbus.py) | 1 = no match | clean |

Test tail:
  ℹ tests 819 / pass 817 / fail 0 / cancelled 0 / skipped 2 / todo 0
Only a MODULE_TYPELESS_PACKAGE_JSON warning for lib/theme.ts (Node note, not a failure).

Secrets: `git diff --cached --name-only` empty (nothing staged). Tracked env files: only `.env.example`. No `.env` values were read.

Code checks
- lib/theme.ts: THEME_SCRIPT reads localStorage, compares to "light"/"dark" only, then sets documentElement.dataset.theme to the literal-validated value; the stored string is never written into the page; try/catch for private mode.
- app/layout.tsx: `<head>` holds `<script dangerouslySetInnerHTML={{__html: THEME_SCRIPT}}/>` (line 22); `<html ... suppressHydrationWarning>` (line 19).
- ThemeToggle: labels "Switch to day mode" / "Switch to night mode" (aria-label and title); saves with localStorage.setItem(THEME_KEY, theme).
- Placements, each `<ThemeToggle`: components/landing/Hero.tsx:24, components/dashboard/Shell.tsx:33 and :58 (desktop and mobile), components/gateway/Frame.tsx:83 (inside PlainPage, defined line 73), app/docs/page.tsx:93 (TopBar), components/capital/investor/InvestorApp.tsx:53. All five present.
- CSP (next.config.ts): every policy (csp, logoCsp, paySheetCsp, merchantPolicy/merchantCsp, /merchant/pages) derives from PAY_PAGE_CSP, whose script-src is `'self' 'unsafe-inline'` (line 9, plus 'unsafe-eval' in dev only); the merchant variant replaces it with `'self' 'unsafe-inline' 'wasm-unsafe-eval' blob:`, still inline-allowing. Home and /proofs carry no CSP (comment at line 55).

Browser evidence (builder, not rerun): /private/tmp/claude-501/-Users-vg890-ethglobal/84ab5191-49c4-4bb6-9570-7be540025a9b/scratchpad/b060-shots/ has shots.mjs plus 10 PNGs (landing, dashboard, docs, capital, signed-out, pay at 1440 and 375), builder reports 10/10 OK, 0 CSP, 0 console. I only confirmed the files exist.
