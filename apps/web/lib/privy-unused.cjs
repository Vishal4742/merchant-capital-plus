// Batch 046: stands in for the Solana and Stripe packages that @privy-io/react-auth imports for features we don't
// turn on (Solana wallets, card funding). Their installed versions don't match each other (optional peers), and
// Turbopack fails the build on the mismatch. CommonJS on purpose: its exports aren't checked at build time, so Privy's
// imports of them resolve to undefined, and the code that would use them never runs on our pages (ethereum-only).
module.exports = {};
