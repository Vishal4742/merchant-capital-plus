VERDICT: PASS

Batch 005-P2-web-invoices-refunds, round 2. Run in apps/web. contracts/ and apps/relayer untouched.

| Command | Exit |
|---|---|
| npm run typecheck (next typegen && tsc --noEmit) | 0 |
| npm run lint (eslint) | 0 |
| npm test | 0 |
| npm run build | 0 |

Typecheck tail: `Generating route types... Types generated successfully`, no tsc errors.
Lint tail: eslint printed nothing.

Test tail (live tests not run, 2 skipped):
```
ℹ tests 135
ℹ suites 0
ℹ pass 133
ℹ fail 0
ℹ cancelled 0
ℹ skipped 2
ℹ todo 0
```

Build (Next.js 16.4.3 Turbopack, compiled and TypeScript finished) route table:
```
┌ ○ /
├ ○ /_not-found
├ ƒ /api/auth/logout
├ ƒ /api/auth/nonce
├ ƒ /api/auth/verify
├ ƒ /api/demo-checkout
├ ƒ /api/v1/invoices/[id]/pay
├ ƒ /api/v1/sessions
├ ƒ /api/v1/sessions/[id]
├ ƒ /api/v1/sessions/[id]/pay
├   /checkout/[sessionId]  (◐)
├ ◐ /merchant
├   /pay/[invoiceId]       (◐)
├ ○ /proofs
└   /r/[id]                (◐)
```

## Greps
- `.next/static` for `SHOP_API_KEY|AUTH_SECRET|ARKIV_|PRIVATE_KEY|process\.env`: 0 files matched, no output.
- `grep -rn MUTATION apps/web/{app,lib,components,test}`: empty (exit 1).
- `1FqWS` in apps/, docs/, notes/, .batches/ (excluding node_modules, .next): no matches.
- Staged files (`git diff --cached --name-only`): none.
- Env/key files: only tracked `.env.example` (template). No `.env`, `.pem` or `.key` files tracked or untracked in apps/ or the batch folder. `.env` values were not read.
- Secret pattern (0x+64 hex, sk-, AKIA, ghp_, xox, PEM header, KEY/SECRET/TOKEN = value) over `git diff`, untracked apps files and the batch folder: 5 hits, all public:
  - 3 nonce test vectors (`saleNonce` old and new, `invoiceNonce`), derived from `0x33` repeated fill
  - `process.env.AUTH_SECRET = "test-auth-secret-0123456789abcdef0123"` (test fixture)
  - `process.env.SHOP_API_KEY = "test-shop-key-0123456789abcdef"` (test fixture)

Note: `next start -p 3100` serves the old .next; the build replaced it, so restart it.
