# How we use Arkiv

- **What we filter on:** chain, status, kind, sector, APR, holdback, ticket size, deadline, all indexed columns (`schema.md`).
- **Who can edit each entity:** only our publisher key. The terms carry the merchant's EIP-712 signature, and every offer is checked against `CapitalMarket.offers(claimId)` before the Buy button turns on, so integrity doesn't depend on our key.
- **When it expires:** at the offer deadline. The contract rejects funding after the same deadline, so Arkiv and the chain agree.
- **What users see change:** the investor offer book, the merchant's "my live offers" panel, the offer detail page with a countdown; funded offers flip to "funded". Reads go through Anon-RPC.
