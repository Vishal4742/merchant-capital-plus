VERDICT: PASS

# Batch 051 round 2: targeted re-walk of the changed UI

**Who:** the independent tester wrote the round-2 walk script (`C:/Users/nothi/tmp-pw/b051/walk2.mjs`) but stopped on an API billing error before running it. whiteflow-ef (the author) read the script and ran it unchanged, with a new launcher. Independence is therefore limited to the script, which was written by the tester from round 1's findings. Round 1's full walk (a–i) was fully independent: see `round-1/test.md`.

## Setup (no secrets)
- **Code:** a detached worktree `P:/wf-051-walk` at the committed HEAD, no local edits: first 438459c, then 04266ce after the overflow fix below.
  - Why not P:/wf-051: it holds uncommitted edits to three batch-050 files (privy-config.ts, auth-sessions.ts, privy-token.ts) that belong to neither this batch nor its author.
- **Server:** `next dev -p 3100`, launched by `launch3.mjs`.
  - DATABASE_URL is read in-process from P:/WhiteFlow/.env, switched to `/wf_s2_web`, verified with `current_database()`, and passed only through the child's environment.
  - PUBLIC_ORIGIN=http://localhost:3100.
  - Dummy non-secret MERCHANT_ADDRESS and SHOP_API_KEY are set so `/merchant` renders.
  - No Privy app id.
- **Seeding** (seed.mjs): 5 principals, 2 workspaces (Acme unlinked, Bandra linked), 4 memberships and 6 sessions (random tokens; only sha256 stored). Deleted by id in `finally`.
- **Before the run:** the tester's earlier runs were checked with `verify.mjs` over all 78 ids from 6 runs: 0 rows left in principals, businesses, memberships, sessions, audit, claims and links. No round-2 rows existed, and its round-2 server had never started.

## Results (run 2, warm pages): 30/30 checks, 0 pageerrors

| Check | Result |
|---|---|
| 360 px panel states a (no cookie), b (no workspace), c (Owner unlinked), d (Viewer unlinked) | scrollWidth 360 for all four |
| c, no `window.ethereum`, keyboard Enter (375/1440) | "No browser wallet found. Open the wallet your merchant account uses, then try again."; focus stays on "Link merchant wallet" |
| c2, the wallet rejects eth_requestAccounts with 4001 (375/1440) | "You cancelled in your wallet. Nothing was signed and nothing was linked."; focus on the button; 0 challenge calls |
| c3, mid-flow (slow signature, then 4001) | While busy: focus on "Linking…", aria-disabled=true, status "Sign the link message with 0x2222…2222. It's free and moves no funds."; a second Enter/Space is ignored (1 challenge, 1 personal_sign). After: the cancelled message, focus on the button, aria-disabled=false |
| c4, pending request (-32002) / internal error at signing (-32603) | "Your wallet already has a request open. Open the wallet, finish or close it, then try again." / "Your wallet couldn't sign the link message. Nothing was linked. Try again." No fee or funds wording |
| c5, a 409 at the challenge | the message shows and GET /api/v2/legacy is re-read (2 → 3) |
| h-fail, sign-out answers 500 (1440/375/360) | "We couldn't sign you out. Try again." (role=alert); no navigation; the session's revoked_at stays null; focus on Sign out; scrollWidth equals the viewport |
| h, sign-out works | lands on `/sign-in?out=1`; that session's revoked_at is set, the other session untouched, the cookie cleared |
| h-reuse | the revoked token gives the signed-out panel |
| i, focus and target size | Sign out is 54×40 px, tab stop 2, outline solid 2 px rgb(59,79,217); "Link merchant wallet", "Sign in to WhiteFlow" and "Create your workspace" all have the same 2 px outline |
| /merchant/connections at 360/375, Owner and Viewer | scrollWidth 360/375; the MCP `<pre>` scrolls inside its box (client 286/301 of 410); the Viewer sees "Only Owners can see API keys and webhooks.", the Owner doesn't |

## Findings in run 1 (both resolved)
1. **/merchant/connections still 447 px wide at 360/375.** The round-1 fix (minmax on the outer grid) wasn't enough: the MCP card's own grid and its inner grid had `auto` columns that sized to the pre's longest line. **Fixed in 04266ce:** `grid-cols-[minmax(0,1fr)]` on every grid level down to the pre. Re-checked in run 2: 360/375.
2. **h reported "no redirect".** The server log shows POST /api/v2/auth/signout 200, then "Compiling /sign-in", then GET /sign-in?out=1 200. The first dev-mode compile of /sign-in took longer than the walk's 15 s wait. A test-timing artifact, not a defect; it passed in run 2.

## Not done
The real acceptance-13 journey (a Privy login, a real wallet signature, a claim) needs the owner's Privy app id and verification key, plus a wallet: **NEEDS THE USER**.

## Cleanup
- Both runs deleted their rows by id. Final counts: principals 0, businesses 0, memberships 0, sessions 0, audit 0, claims 0.
- The dev server was stopped (taskkill on the launcher's tree); nothing listens on port 3100.
- Shots are in `round-2/shots/` (git-ignored).
- Scripts stay in `C:/Users/nothi/tmp-pw/b051/` and hold no database URL or tokens.
