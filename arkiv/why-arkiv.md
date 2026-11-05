# Why Arkiv

Vouchers and financing offers share one property: they are valid for a limited time and someone else needs to check them.

If we used a Postgres row instead:
1. **We would run the expiry.** A code past its date must stop working. With a row we need a check on every read plus a cleanup job; with Arkiv the entity is removed at its expiry and a query never returns it.
2. **Nobody could verify a merchant's live offers without asking us.** Arkiv entities are public and owner-scoped: anyone can list the vouchers and offers our writer key published for a merchant, and see that they are still live. A DB row is visible only through our API.
3. **We would hold the only copy.** Another app could build a "live deals" list straight from Arkiv.

If we used a contract instead: every voucher would cost gas to create, expiry would still need an off-chain job to clear storage, and attribute queries (by merchant, currency, status) would need an indexer that Whitechain does not have yet.

What Arkiv does not do for us: count redemptions. That stays on our server.
