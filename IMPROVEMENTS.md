# Open risks

These gaps affect correctness, abuse resistance or shopper data. They are not claims about current production incidents or dependency advisories. Remove an item in the change that closes it.

- **No per-shopper rate limit.** Authenticated tool calls share the application's Kroger quota. Catalog operations and input batches have request caps, but repeated requests can still exhaust quota. Add a shopper-keyed throttle with actionable retry guidance.
- **Data lifecycle is incomplete.** D1 shopper records and completed cart journal entries have no automatic retention sweep, and no tool deletes all of a shopper's data. Cart add history is already bounded (newest 100 within seven days). Define retention and erasure behavior before implementing it. Pending cart entries must never age into permission to repeat an uncertain mutation.

The [auth contract](docs/better-auth-integration.md) documents expiry/revocation limits; the [cart contract](README.md#cart-outcomes-and-retries) documents ambiguity and cross-client deduplication limits.
