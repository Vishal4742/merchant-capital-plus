VERDICT: PASS

From apps/web on branch p5-hero-trim (b12e27f over 2d9dcbb):
- npx tsc --noEmit: exit 0 (no output)
- npm run lint: exit 0 (eslint, no output)
- npm test: exit 0 (815 tests, 813 pass, 0 fail, 2 skipped)
- npm run build: exit 0 (all routes listed, none failed)
- Secret scan (pre-push pattern via git grep): no hits (exit 1 = clean); git diff --cached --name-only: empty
- Removed code: grep for IstClock, lp-corner, lp-ticker in apps/web (excluding .env*) finds only a comment in Hero.tsx and a "FX ticker" CSS comment in landing.css:69. The Ticker/Rates matches elsewhere are unrelated docs prose. No dangling import or CSS reference.
- Live.tsx still defines and uses everySecond (lines 10, 17), so LockTimer keeps its tick.
