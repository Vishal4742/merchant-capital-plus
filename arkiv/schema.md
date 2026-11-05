# Arkiv schemas

Two entity types, both written by our writer key `0xF216677A6c7635c34e7dD58927B98D141d538Cbe` on Arkiv's Rabdi testnet (chain 7794095). Probe write: tx `0x2d651b87c027419949d12cb650c7ca70ce7b65246e802fc44e213b0fc42b771e`, block 258050. Readers filter with `.ownedBy(WRITER)` because anyone can write a matching entity. Neither schema stores personal data: no names, emails, shopper addresses or plain codes.

## `mcplus.voucher.v1` (FR-GW-12)

One entity per discount code. Expiration = the code's expiry (`ExpirationTime.atDate`), so an expired code drops out of every query. Redemption counts are not stored here; they stay on our server.

| Column | Type | Indexed | Why |
|---|---|---|---|
| merchant | addr | yes | the merchant's code list; scopes a lookup to one shop |
| code_hash | str (0x + 64 hex) | yes | checkout looks the code up by `HMAC-SHA256(VOUCHER_HASH_SECRET, merchant ‖ code)` (keyed with a server-only secret, so short codes cannot be guessed offline from the public entity). The plain code is never written |
| kind | str | yes | "percent" or "amount" |
| value | u64 | no | percent points, or micro-units of `currency` |
| currency | str | yes | "USDT": filter vouchers usable for a payment |
| min_amount | u64 (micro-units) | no | minimum basket; checked by the server, shown to the shopper |
| max_redemptions | u64 | no | limit; the count itself is on our server |
| first_time_only | u64 (0/1) | no | rule flag; enforced by the server |
| expires_at | u64 (unix s) | yes | exact time (entity expiry is block-rounded); server rejects after this |

Personal data: none. The only identifiers are the merchant's public address and a hash of the code.

## `mcplus.offer.v1` (FR-ARK-1 to 5, Phase 5)

One per open financing offer. Owner: our writer key. Expiry = the offer deadline (`ExpirationTime.atDate`).

| Column | Type | Indexed | Why |
|---|---|---|---|
| kind | str | yes | "invoice" or "advance" filter |
| chainId | u64 | yes | keeps testnet and later mainnet offers apart |
| market | addr | yes | CapitalMarket address, checked on-chain before Buy |
| claimId | u64 | yes | joins to `CapitalMarket.offers(claimId)` |
| merchant | addr | yes | the merchant's "my live offers" list |
| faceUsdt, priceUsdt, remainingUsdt | u64 (micro-USDT) | yes | ticket-size filters |
| aprBps, holdbackBps | u64 | yes | sort and filter |
| maturity, deadline | u64 (unix s) | yes | exact times (expiry is block-rounded) |
| status | str | yes | "open" / "funded", patched on funding |
| sector | str | yes | "cafe", "studio" filter |
| terms | bytes | no | JSON: merchant's EIP-712 signature over the terms, invoice summary (debtor hashed), 30-day sales snapshot, explorer links. Not queryable |

Personal data: none. The debtor is stored as a hash (FR-ARK-4); merchants appear only by public address.

Limits we stay under (SDK 1.0.1): str values up to 128 bytes, 32 attributes per entity including the schema tag. Voucher uses 9 + 1, offer 15 + 1.
