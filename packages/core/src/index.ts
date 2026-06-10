// @shomee/core — shared, platform-agnostic business logic (matching, parsing,
// geo resolution, stores, types, data). Bundlable by both Next (web) and
// Metro (mobile). MUST NOT import @prisma/client, next/*, react-native, or
// read process.env — all configuration is injected by the consumer.
//
// Public surface is exposed via subpath exports (see package.json "exports"),
// e.g. `@shomee/core/matching/engine`, `@shomee/core/stores/searchStore`.
// This root barrel stays intentionally minimal.

export const CORE_PACKAGE = '@shomee/core'
