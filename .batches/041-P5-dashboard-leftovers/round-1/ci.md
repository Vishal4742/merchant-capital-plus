VERDICT: PASS

Scope: commit bb6dfde (apps/web only), run from apps/web.

1. `npx tsc --noEmit` -> exit 0, no output.
2. `npm run lint` -> exit 0 (eslint, no findings).
3. `npm test` -> exit 0. tests 637, pass 635, fail 0, cancelled 0, skipped 2, todo 0.
   `node --test test/home-tiles.test.mjs` -> tests 5, pass 5, fail 0, skipped 0 (vouchersUsed x3, home Get paid early link, invoices Sell this invoice link).
4. `npm run build` -> exit 0, route table printed, 0 error lines (grep -ci error = 0).
5. Secret scan over `git show --name-only bb6dfde` (4 files: app/merchant/page.tsx, components/merchant/Invoices.tsx, lib/gateway-money.ts, test/home-tiles.test.mjs): no key/private-key/secret patterns, no .env files in the commit; `git diff --cached --name-only` empty.
