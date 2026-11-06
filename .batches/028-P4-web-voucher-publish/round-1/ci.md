VERDICT: PASS

Batch 028-P4-web-voucher-publish, round 1. Contracts untouched, forge skipped. Run from apps/web.

- `npx tsc --noEmit`: exit 0, no output.
- `npm run lint` (eslint): exit 0, no output.
- `npm test`: exit 0. tests 572, pass 570, fail 0, cancelled 0, skipped 2. Duration about 32.6s.
- `npm run build`: exit 0. Route table printed through /pay/[invoiceId], /proofs, /qr/[kind]/[id], /r/[id].
- Secret scan (the CI `secrets` job pattern via `git grep`, excluding tools/agentbus.py): exit 1, which means no matches.
- `git ls-files | grep '\.env$'`: exit 1, no tracked .env.
- `git diff --cached --name-only`: 0 staged files.
