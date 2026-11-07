# ci round 1: PASS

apps/web on p5-whiteflow-names: npm ci; npm run typecheck (0 errors); npm run lint (clean); npm test: 748 tests, 746 pass, 0 fail, 2 skipped (the 2 pre-existing live-chain skips).
git grep 'Whiteflow' apps/web/{app,components,lib}: only tokens.css (comment) and lib/invoice-ack.ts (EIP-712 domain name, kept on purpose).
