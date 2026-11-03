# Open risks

These gaps affect correctness, abuse resistance or shopper data. They are not claims about current production incidents or dependency advisories.

- **Pantry consumption can lose concurrent updates.** [Consumption](src/tools/inventory.ts) reads quantities, subtracts in JavaScript and writes absolute values through [storage](src/utils/d1-shopping-storage.ts). Concurrent “Use one” calls can overwrite each other. An atomic decrement needs coverage for concurrent calls and removal at zero.
- **No per-shopper rate limit.** Authenticated tool calls share the application's Kroger quota. Catalog operations have request/concurrency caps, but repeated requests can still exhaust quota. Add a shopper-keyed throttle with actionable retry guidance.
- **Some input batches remain unbounded.** Inventory add/remove arrays, order items, and list change/remove arrays have no maximum length. Bound work and persisted list growth; create-list and add-item catalog batches already have a 40-request cap.
- **Data lifecycle is incomplete.** D1 shopper records and completed cart journals have no automatic retention sweep, and no tool deletes all of a shopper's data. Define retention and erasure behavior before implementing it. Pending cart entries must never age into permission to repeat an uncertain mutation.
- **Error details can expose internals.** [Error formatting](src/errors.ts) includes serialized detail, and storage/upstream wrappers can populate it with raw exception text. Preserve server-side diagnostics while returning actionable public errors.
- **Order recording is not idempotent.** Retrying `record_order` creates another generated order ID. Add an explicit retry identity if purchase logging must tolerate lost responses.

The [auth contract](docs/better-auth-integration.md) documents expiry/revocation limits; the [cart contract](README.md#cart-outcomes-and-retries) documents ambiguity and cross-client deduplication limits.
