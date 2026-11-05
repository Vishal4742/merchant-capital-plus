# Reach

**Merchants** on the gateway create discount codes and, in Phase 5, list financing offers. Both are stored as Arkiv entities, so the live list is public and stops on its own at expiry.

**Shoppers** apply a code at checkout and get an answer from a live lookup, not from a stale cache.

**Other apps** (a deals page, a wallet, an aggregator) can list a merchant's live vouchers and offers with one owner-scoped query, without our API.

**Scope today:** Arkiv's Rabdi testnet (chain 7794095), test USDT, one writer key. Codes are stored only as keyed hashes (HMAC with a server-side secret), so they can't be guessed from the public entities. Voucher redemption counts are on our server, not on Arkiv.

**Try it:** ⟨live link⟩
**After Mumbai:** ⟨plan: mainnet Arkiv once the gateway moves off testnet⟩
