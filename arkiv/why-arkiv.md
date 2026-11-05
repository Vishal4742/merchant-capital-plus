# Why Arkiv

If we swapped Arkiv for Postgres, investors would lose:
1. **The guarantee that a listed offer is still live.** Expiry is enforced by the store at the offer deadline; there is no cron job to forget, and a stale price can't be shown.
2. **Open access.** Any investor app, wallet or exchange can read the offer book without our API: distribution is exactly what Whitechain says it sells.
3. **A provenance trail** tied to a writer key, with the merchant's own signature over the terms inside each entity.
Putting offers on Whitechain itself would cost gas per listing and still need an indexer, which doesn't exist there yet.
