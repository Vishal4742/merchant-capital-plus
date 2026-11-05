# Arkiv schema (draft; finalized when the entity is first written)

Entity **`mcplus.offer.v1`**, one per open financing offer. Owner: our publisher key (writer address ⟨0x…⟩). Expiry = the offer deadline (`ExpirationTime.atDate`), so an expired offer drops out of every query without a cron job.

| Column | Type | Indexed | Used for |
|---|---|---|---|
| kind | str | yes | "invoice" or "advance" |
| chainId | u64 | yes | 1874 |
| market | addr | yes | CapitalMarket address (checked on-chain) |
| claimId | u64 | yes | joins to `CapitalMarket.offers(claimId)` |
| merchant | addr | yes | the merchant's offer list |
| faceUsdt, priceUsdt, remainingUsdt | u64 (micro-USDT) | yes | ticket-size filters |
| aprBps, holdbackBps | u64 | yes | sort and filter |
| maturity, deadline | u64 (unix s) | yes | exact times (expiry is block-rounded) |
| status | str | yes | "open" / "funded" (patched on funding) |
| sector | str | yes | "cafe", "studio" |
| terms | bytes | no | JSON: merchant's EIP-712 signature over the terms, invoice summary (debtor hashed, no personal data), 30-day sales snapshot, explorer links |

Runnable query: ⟨`select().from(Offer).where(and(eq("chainId", u64(1874)), eq("status", "open"))).ownedBy(PUBLISHER).fetch()` once verified against SDK 1.0.1⟩
