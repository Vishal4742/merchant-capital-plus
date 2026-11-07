VERDICT: PASS

Branch p5-investor-disconnect, diff 8c9138b..HEAD (apps/web only, plus batch docs).

- `npx tsc --noEmit` (apps/web): exit 0, no output
- `npm run lint`: exit 0, eslint clean
- `npm test`: exit 0; tests 886, pass 884, fail 0, skipped 2
- `npm run build`: exit 0; routes listed, no errors
- Secret scan (pre-push regex, git grep): no match (exit 1). No .env files in the diff.

Code checks (from the diff):
- investorOff/setInvestorOff: both wrapped in try/catch, undefined store handled; blocked storage reads as "not off". OK.
- Silent reconnect skipped only when `!prompt && investorOff(...)`. OK.
- Connect (prompt=true) clears the flag before connecting. OK.
- Disconnect sets the flag and state "disconnected" synchronously, then fires wallet_revokePermissions with `.catch(() => {})`. OK. Caveat: if `window.ethereum.request` threw synchronously it would not be caught, but that is not a real case for EIP-1193 providers (returns a promise).
- Disconnect button rendered in "ready" and "wrong-network" cases. OK.

Browser evidence present in b063-shots: capital-1440-dark.png, capital-375-light.png, flow.mjs, server.log (not re-inspected by CI).
