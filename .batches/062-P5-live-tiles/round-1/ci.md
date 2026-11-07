VERDICT: PASS

Run from apps/web on 8783dfb (diff e08f356..HEAD, 8 files).
- npx tsc --noEmit: exit 0, no output
- npm run lint: exit 0, no output
- npm test: exit 0; tests 885, pass 883, fail 0, skipped 2
- npm run build: exit 0 (all routes listed, / static, /pay and /r partial prerender)
- Secret scan (pre-push regex, git grep, excluding tools/agentbus.py): no hits. Tracked env file: only .env.example. Staged files: none.

Code checks
- landingDemo(): link and page pass `SLUG.test` or become null, so nothing unchecked reaches an href, src or the snippet. Origin comes from publicOrigin (http/https only, else fallback).
- New hrefs/srcs: `${origin}/l/${slug}`, `/p/${slug}`, `/qr/l/${slug}`, the snippet's `${origin}/v1/button.js` and data-link slug. All built from slugs or PUBLIC_ORIGIN.
- Unset env: link pill shows plain text, minipage is a div, QR is the aria-hidden drawing, no copy buttons. The snippet shows "your-link".
- CopyButton className path: `<button type="button" ... aria-label="Copy {name}">`, with the live region kept.
