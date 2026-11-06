VERDICT: PASS

Batch 040-P5-capital-csp-link, round 1. Commits ec7dade, 68bb29b, 0eac388. Only apps/web changed, so forge was skipped (no contract change).

From apps/web:
- `npx tsc --noEmit`: exit 0, no output.
- `npm run lint` (eslint): exit 0, no output.
- `npm test` (node --test test/): exit 0. tests 632, pass 630, fail 0, cancelled 0, skipped 2, todo 0.
- New test files, run alone (`node --test test/csp-routes.test.mjs test/capital-entry.test.mjs`): tests 5, pass 5, fail 0, skipped 0.
  - csp: /capital/:path* sends exactly the merchant dashboard's policy
  - csp: no later rule overrides /capital
  - landing: Capital section links to the offer book
  - landing: footer links to the offer book too
  - landing: part-funded invoice card has 1 investor, and the text names invoices and advances
- `npm run build`: exit 0. Output has 0 lines matching "error" (case-insensitive). Tail ends with the route table legend (Static / Partial Prerender / Dynamic).

Secret scan:
- `git diff --cached --name-only`: empty, nothing staged.
- Tracked .env files: only .env.example.
- Pattern `(PRIVATE_KEY|SECRET|0x[0-9a-fA-F]{64})` (--exclude='.env*') over the files the three commits touched: see result line below.
  Result: grep exit 1, zero hits in the 6 touched files. No keys, tokens or .env staged.

VERDICT: PASS
