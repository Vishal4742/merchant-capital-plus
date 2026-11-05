VERDICT: PASS

Round 2, batch 003-P1-arkiv-probe, cwd apps/web unless noted. contracts/ and apps/relayer untouched, so forge is skipped.

| Command | Exit | Tail |
|---|---|---|
| npm run typecheck | 0 | `next typegen && tsc --noEmit`, "Types generated successfully" |
| npm run lint | 0 | `eslint`, no output |
| npm test | 0 | tests 23, pass 23, fail 0, cancelled 0, skipped 0 (270 ms) |
| npm run build | 0 | Next.js 16.4.3 Turbopack, compiled, TypeScript finished, 4/4 static pages |

Route table:
```
Route (app)
┌ ○ /
└ ○ /_not-found
○  (Static)  prerendered as static content
```

Client bundle leak grep (after build): `grep -rlE "ARKIV_|rpc\.rabdi|arkiv-network" apps/web/.next/static` -> no hits (grep exit 1).

Security reviewer extras:
- `grep -rn MUTATION apps/web/lib apps/web/scripts apps/web/test` -> empty (exit 1).
- shasum -a 256: lib/arkiv.ts = 994b3885c230b9c9... (match); scripts/arkiv-probe.ts = 4a8f854105f4e026... (match). Reviewed versions unchanged.

Secret grep (27 files: git diff + untracked under apps and the batch folder; `git diff --cached --name-only` empty):
- No .env / .pem / .key among changed or untracked files; apps/web/.env and .env.local are git-ignored.
- Patterns (sk-, AKIA, ghp_, PEM header, KEY/MNEMONIC/SECRET/PASSWORD/TOKEN = value): no hits.
- 64-hex values: only 0x59f0a4a5... (entity key), 0xf604d899..., 0x2d651b87... (tx hashes), 0xe14667bc... (entity, abbreviated in a note). All labelled public probe output in test.md, build notes and notes/phase-1-frontend.md. Not private keys.
- No .env value was read or printed. Live probe not run.

Note: node prints a harmless "add type: module" warning during npm test. The running `next start -p 3100` serves the old .next and needs a restart.
