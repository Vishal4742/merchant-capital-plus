# Reach

**Merchants** on the gateway create discount codes and, in Phase 5, list financing offers. Both are stored as Arkiv entities, so the live list is public and stops on its own at expiry.

**Shoppers** apply a code at checkout and get an answer from a live lookup, not from a stale cache.

**Other apps** (a deals page, a wallet, an aggregator) can list a merchant's live vouchers and offers with one owner-scoped query, without our API.

**Scope today:** Arkiv's Rabdi testnet (chain 7794095), test USDT, one writer key. Codes are stored only as keyed hashes (HMAC with a server-side secret), so they can't be guessed from the public entities. Voucher redemption counts are on our server, not on Arkiv.

**Try it:** [whiteflow.org](https://whiteflow.org)
**After Mumbai:** move the voucher and offer entities to Arkiv mainnet when the gateway leaves testnet (official USD₮ on Whitechain mainnet); publish the entity schemas so deal pages and wallets can list a merchant's live codes and offers without our API; add the per-merchant public sales-stats entity (FR-ARK-6, cut for time here) so investors can check a merchant's history before funding.
