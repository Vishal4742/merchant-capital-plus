# How we use Arkiv

## Vouchers (FR-GW-12)

1. **Merchant creates a code** in the dashboard (percent or fixed off, expiry, usage limit, optional minimum and first-time-only).
2. **Entity written.** Our server computes `code_hash = HMAC-SHA256(VOUCHER_HASH_SECRET, merchant ‖ code)` and calls `createEntity(Voucher, {...}, { expiration: ExpirationTime.atDate(expiresAt) })` from the writer key. The plain code is shown to the merchant once and not stored.
3. **Checkout reads the code.** When a shopper enters a code, the server hashes it and queries Arkiv for a live entity with that hash.
4. **Server validates and counts.** It checks the rules (currency, minimum, first-time-only) and the redemption count in its own database, then applies the discount. Redemptions stay on our server because Arkiv entities are only patched by the writer, and a counter there would cost a transaction per payment.
5. **Entity expires on its own** at the code's expiry. An expired code returns no result; there is no cleanup job.

Query (SDK 1.0.1, run against the Rabdi testnet):

```ts
import { createPublicClient, http } from "@arkiv-network/sdk"
import { rabdi } from "@arkiv-network/sdk/chains"
import { addr, defineSchema, str, u64 } from "@arkiv-network/sdk/schema"
import { and, eq } from "@arkiv-network/sdk/query"

const Voucher = defineSchema("mcplus.voucher.v1", {
  merchant: addr().indexed(), code_hash: str().indexed(), kind: str().indexed(),
  value: u64(), currency: str().indexed(), min_amount: u64(),
  max_redemptions: u64(), first_time_only: u64(), expires_at: u64().indexed(),
})
const WRITER = "0xF216677A6c7635c34e7dD58927B98D141d538Cbe"
const reader = createPublicClient({ chain: rabdi({ accessKey: ARKIV_ACCESS_KEY }), transport: http() })

const { entities } = await reader.select().from(Voucher)
  .where(eq("merchant", addr(MERCHANT)), eq("code_hash", codeHash))
  .ownedBy(WRITER).limit(1).fetch()
```

Check the exact import path of `and`/`eq` against the installed version before copying; `where(a, b)` already ANDs its arguments.

## Offers (Phase 5)

- **What we filter on:** chain, status, kind, sector, APR, holdback, ticket size, deadline (all indexed, see `schema.md`).
- **Who can edit:** only our writer key. The terms carry the merchant's EIP-712 signature and the Buy button is enabled only if the offer matches `CapitalMarket.offers(claimId)`, so integrity does not depend on our key.
- **When it expires:** at the offer deadline; the contract rejects funding after the same deadline.
- **What users see:** the investor offer book, the merchant's "my live offers" panel, the offer detail page with a countdown; funded offers flip to "funded".
