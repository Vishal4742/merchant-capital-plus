VERDICT: PASS

CI gate, round 1, batch 056-P5-verified-merchant. Branch p5-verified-merchant, HEAD 1899870, base e7e41bf. Only apps/web changed (17 files incl. batch docs). Run from apps/web.

1. `npx tsc --noEmit` -> exit 0, no output.
2. `npm run lint` (eslint) -> exit 0, no warnings or errors.
3. `npm test` -> exit 0. Tail: `tests 707 / suites 0 / pass 705 / fail 0 / cancelled 0 / skipped 2 / todo 0`.
4. `npm run build` -> exit 0. Route table prints (incl. /p/[slug], /pay/[invoiceId], /r/[id]); no errors.
5. Secret scan (pre-push regex via `git grep -qE ... -- ':!tools/agentbus.py'`) -> exit 1 = no match, clean. `git diff --cached --name-only` -> empty (nothing staged). Tracked .env files: only `.env.example`. No .env values read.
6. Contracts/relayer/sdk untouched, so forge, coverage and their checks skipped.

Acceptance criteria checked from code and tests:
- merchantVerified(address): `merchantConfig()?.merchant.toLowerCase() === merchant.toLowerCase()` in lib/server/http.ts; no shop configured gives undefined === string, so false. Pinned in test/verified-merchant.test.mjs (shop in two cases true, other address false, no shop false). PASS.
- Public JSON: publicLinkJson and publicPageJson each gain only `merchant_verified` (diff shows one added field each); gw-links and gw-pages tests updated by that one key. Client parsers read `=== true`. PASS.
- Pay sheets: LinkSheet (/l), PageSheet (/p), Checkout (/checkout), InvoicePay (/pay) all render MerchantName; checkout and pay pages pass merchantVerified(session.merchant / shop.merchant). Source-pinned by test. Tick is an SVG with aria-label/title "Verified merchant", drawn only when verified. PASS.
- Dashboard preview: merchant/pages/page.tsx passes merchantVerified(merchant) into PagesScreen, which puts merchant_verified in the preview object. PASS.
- Screenshots (375 light, 1440 dark, no hscroll) and the FR-PAY-7 word scan: not re-run by CI; builder's files are in the scratchpad b056-shots dir. Not independently verified here.
- tsc, lint, test, build: all green above.

Notes (non-blocking): the receipt page and paid-state "to {shop}" line are intentionally untouched per spec. The `next start -p 3100` server was not touched; the build overwrote .next.
