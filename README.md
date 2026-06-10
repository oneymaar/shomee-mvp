# SHOMEE — monorepo

Turborepo + npm workspaces. The Next.js PWA, the Expo (iOS) app, and the
shared platform-agnostic business logic live side by side.

```
/
├── apps/
│   ├── web/      → Next.js 16 PWA (App Router) + API routes — deployed on Vercel
│   └── mobile/   → Expo SDK 56 app (expo-router) — built with EAS (iOS)
├── packages/
│   └── core/     → @shomee/core — shared logic: matching, parsing, geo
│                   resolution, stores (factories), view-model types, JSON data
├── shomee-mcp/   → MCP server (standalone, OUTSIDE workspaces — pins zod@3)
├── turbo.json
└── package.json  → workspaces: ["apps/*", "packages/*"]
```

## Commands

```bash
npm install                                   # install all workspaces (root)
npm run type-check                            # turbo: core + web tsc --noEmit
npm run build                                 # turbo: build all (web)
npm run test                                  # turbo: core test suite (vitest)
turbo run build --filter=@shomee/web          # build just the PWA
npm run dev --workspace=@shomee/web           # next dev
npm run start --workspace=@shomee/mobile      # expo start
```

## Import boundaries (do not cross)

| Package | May import | MUST NOT import |
|---|---|---|
| `@shomee/core` | `zustand`, `zod`, own files/JSON | `@prisma/client` (even type-only), `next/*`, `react-native`, `cloudinary`, `@anthropic-ai/sdk`, `process.env` |
| `@shomee/web` | `@shomee/core`, its own server libs | `apps/mobile` |
| `@shomee/mobile` | `@shomee/core`, Expo ecosystem | `apps/web`, `@prisma/client` |

`@shomee/core` reads **no environment variables** — all configuration (API base
URL, persistence storage) is injected by the consuming app as a parameter.
This is what keeps it bundlable by both Next (web) and Metro (mobile).

### How web consumes core
`@shomee/core` is consumed as **TypeScript source** (no build step):
`next.config.ts` lists `transpilePackages: ['@shomee/core']`; subpath imports
like `@shomee/core/matching/engine` resolve via the package `exports` map.

### Stores (factory pattern)
`createSearchStore(getStorage)` / `createShomeeStore(getStorage)` live in core.
Each app binds the storage backend:
- web: `() => localStorage` (see `apps/web/lib/{store,searchStore}.ts` shims — same
  keys `shomee-favorites` / `shomee-search-v2`, same `partialize` as before).
- mobile (later session): `() => AsyncStorage`.

### Types boundary
View-model types (`Property`, `ChatMessage`, `Conversation`) live in
`@shomee/core/types/domain`. Prisma entity types/enums stay server-side and are
re-exported from `apps/web/lib/types.ts` (which also re-exports the core view
types, so `@/lib/types` keeps its full surface).

## Conventions

- **Mobile API base URL**: `EXPO_PUBLIC_API_URL` (points at the deployed Next.js
  API). The mobile app calls the same `app/api/*` routes via `fetch`.
- **Mobile native**: scheme `shomee`, iOS bundle id `com.shomee.app`.

## Deploying the PWA on Vercel

The PWA stays continuously deployable. One-time project setting (Vercel
dashboard → Settings → Build & Development):

1. **Root Directory** = `apps/web`
2. Enable **“Include files outside of the Root Directory in the Build Step”**
   (so `packages/core` is available during the web build).
3. Build command can stay auto-detected (Next.js) or be set to
   `turbo run build --filter=@shomee/web` from the repo root.

Existing env vars (`DATABASE_URL`, `ANTHROPIC_API_KEY`, `CLOUDINARY_*`) are
unchanged — they belong to the web app only.

Safety tag before the monorepo restructure: `pwa-stable-pre-monorepo`.

## Notes for future migration sessions

Three files the original audit marked “pure” actually have web/Node/component
dependencies, so they intentionally **stay in `apps/web`** for now (flagged,
not needed in core until later sessions):

- `lib/criteria/tags.ts` — imports Node `crypto` (`randomUUID`).
- `lib/services/aiBriefInjector.ts` — imports the `BienStep` React component
  (`SURFACE_UNLIMITED`) and is browser-side glue (verdict “A” in the audit).
- `lib/types.ts` — re-exports `@prisma/client`; it was **split** (view types →
  core, Prisma re-exports kept in the web shim).
