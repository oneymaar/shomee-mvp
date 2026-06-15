# SHOMEE — Architecture

> État au terme des Sessions 1–2 de la migration. Doc de référence monorepo.
> Voir aussi : `README.md` (commandes/structure), `MIGRATION_AUDIT.md` (audit
> PWA→Expo), `SESSION_2_OUTCOME.md` (ce qui a été fait / reste).

## 1. Monorepo (Turborepo + npm workspaces)

```
apps/web/      @shomee/web    — PWA Next.js 16 (App Router) + routes API. Déployée sur Vercel (Root Directory = apps/web).
apps/mobile/   @shomee/mobile — App Expo SDK 56 (expo-router), iOS (com.shomee.app, scheme shomee). Scaffold minimal.
packages/core/ @shomee/core   — Logique métier agnostique (matching, parsing, géo, stores, types, données JSON). Consommée en SOURCE TS (transpilePackages + exports subpaths).
shomee-mcp/                   — Serveur MCP autonome, HORS workspaces (pin zod@3). Inchangé par la migration.
```

### Frontières d'import (non négociables)
| Package | Peut importer | NE DOIT PAS importer |
|---|---|---|
| `@shomee/core` | `zustand`, `zod`, ses fichiers/JSON | `@prisma/client` (même type-only), `next/*`, `react-native`, `cloudinary`, `@anthropic-ai/sdk`, `process.env` |
| `@shomee/web` | `@shomee/core` + ses libs serveur | `apps/mobile` |
| `@shomee/mobile` | `@shomee/core` + écosystème Expo | `apps/web`, `@prisma/client` |

`core` ne lit **aucune variable d'env** : toute config (base URL API, storage, token) est **injectée par paramètre** depuis l'app consommatrice. C'est ce qui le rend bundlable par Next ET Metro.

### Exceptions restées dans `apps/web` (audit les disait « purs » à tort)
- `lib/criteria/tags.ts` — `node:crypto` (`randomUUID`).
- `lib/services/aiBriefInjector.ts` — importe le composant `BienStep` (`SURFACE_UNLIMITED`) ; glue navigateur.
- `lib/types.ts` — re-exporte `@prisma/client` ; **scindé** : les types view-model (`Property`, `ChatMessage`, `Conversation`) vivent dans `@shomee/core/types/domain`, les types Prisma restent dans le shim web.

## 2. Couche données

- **Postgres via Prisma 7** (`@prisma/adapter-pg`, `lib/prisma.ts`) — source des biens, agents, agences, tokens. ⚠️ Le client Prisma est instancié à l'import et **throw si `DATABASE_URL` absente** → la variable doit exister au build/runtime (cf. §6).
- **JSON statiques** dans `@shomee/core/src/data/` (transportStations, quartiers, semanticNeighborhoods, communeNames, iris_market) — embarqués, partagés web+mobile. JSON web-only (`video-tags`, `iris_codes_insee`, `semanticNeighborhoods.enriched`) restent dans `apps/web/src/data/`.
- **APIs externes** (serveur) : opendata.paris.fr / geo.api.gouv.fr / opendatasoft (polygones géo), Nominatim/Overpass (géocodage), Anthropic (Claude Haiku), Cloudinary (médias).

## 3. État client (stores Zustand — pattern factory)

Tous les stores sont des **factories** dans `@shomee/core/stores/` recevant le backend de persistance en **thunk** (`getStorage`). Le web les instancie via des shims `apps/web/lib/{store,searchStore,feedStore}.ts` ; le mobile les instanciera avec AsyncStorage.

| Store | Contenu | Persistance |
|---|---|---|
| `searchStore` | brief d'onboarding (zones, budget, pièces, critères, `onboardingCompleted`) | **persisté** (clé `shomee-search-v2`, `partialize` exclut `onboardingCompleted` et les `location*`/`selected*Ids`) |
| `shomeeStore` (`store.ts`) | `favorites` (objet complet), `conversations` | persiste **favoris uniquement** (clé `shomee-favorites`) |
| `feedStore` | `properties`, `feedSessionId`, `currentIndex` | **TRANSIENT** (pas de `persist`) — survit aux navigations internes, perdu au reload |

- `currentIndex` (carte active du feed) a été **consolidé** dans `feedStore` (retiré de `shomeeStore`) — source unique.
- Web = `localStorage` injecté en thunk (comportement identique à l'avant-migration).

## 4. Feed (parcours acquéreur)

- **Handoff onboarding → feed** : `AIPreparationStep` (fin d'onboarding) pré-génère le feed via `POST /api/feed/generate` (~7–12 s, Claude Haiku) et le dépose en `sessionStorage` (`shomee:pregen-feed`, consume-once). `/feed` le transfère dans `feedStore`.
- **3 cas d'entrée sur `/feed`** : (a) feed déjà en mémoire (`feedStore.hasFeed()`) → affichage immédiat, zéro fetch/loader ; (b) handoff sessionStorage → transfert au store ; (c) sinon fetch live **silencieux** (`GET /api/properties` ~180 ms, ou `feed/generate` si brief).
- `AIPreparationStep` (écran narratif) ne joue **que** dans le tunnel d'onboarding — jamais sur `/feed` (il masque la latence des 7–12 s de génération).
- `clearFeed()` sur reset onboarding (`profile`) force la régénération.
- ⚠️ Migration mobile : `sessionStorage` (web-only) → remplacer le handoff par un champ transient du store ou un param `expo-router`.

## 5. Sécurité des routes API (3 schémas coexistants)

| Schéma | Helper | Routes |
|---|---|---|
| **Bearer agent/MCP** | `lib/auth/bearer.ts` (clé `AgentApiKey` en DB) | `biens/*`, `upload/*`, `agent/me/*`, `onboarding-prefill` (POST). + 2 copies locales (api-keys, import-llm) — **dette : à consolider** |
| **Token applicatif OU origine web** | `lib/auth/appToken.ts` | routes acquéreur (S2) — voir ci-dessous |
| **Secret admin (header)** | inline `x-admin-secret` timing-safe vs `ADMIN_SECRET` | `admin/video-tags`, `admin/videos` |

### Routes acquéreur (Session 2 — Option A)
- `requireAppTokenOrTrustedOrigin` : token `x-shomee-app-token` (mobile, timing-safe) **OU** `Origin` dans l'allowlist (web). Fallback `Referer` **uniquement** pour `properties` (GET nu). Allowlist = `SHOMEE_WEB_ORIGINS` (CSV) + localhost + URLs Vercel du déploiement courant (`VERCEL_URL`/`VERCEL_BRANCH_URL`/`VERCEL_PROJECT_PRODUCTION_URL`). **Aucun wildcard** `*.vercel.app`.
- `requireAppToken` : token **obligatoire** (aucune exception origine) pour les 3 routes sans appelant client : `criteria/parse`, `criteria/update-importance`, `matching/score`.
- **Rate-limit** (`lib/rateLimit.ts`) : 20 req/60 s par IP, **in-memory** sur les 5 routes coûteuses (`feed/generate`, `criteria/analyze`, `criteria/parse`, `location/analyze`, `location/geocode`). ⚠️ Non distribué (reset au cold start) — migrer KV/Upstash avant App Store.
- Le **token n'entre jamais dans le bundle web** (le web passe par l'allowlist d'origine).

### Client API — `apiFetch`
Wrapper agnostique `@shomee/core/utils/apiFetch.ts` (`createApiFetch({ baseUrl, appToken })`) : injecte `x-shomee-app-token` quand un token est fourni. Shim web `apps/web/lib/apiFetch.ts` = `baseUrl:''`, **sans token**. Tous les appels acquéreur passent par lui ; le mobile injectera baseUrl absolue + token.

## 6. Déploiement

- **Vercel** : Root Directory = `apps/web`, « Include files outside Root Directory » activé (pour `packages/core`). Build = `turbo run build`.
- **Variables d'env** : déclarées dans `turbo.json` → `build.env` (sinon strippées en mode strict au build : `DATABASE_URL`, `ANTHROPIC_API_KEY`, `CLOUDINARY_*`, `NEXT_PUBLIC_APP_URL`, `SHOMEE_CRITERIA_MODEL`, `ADMIN_SECRET`, `SHOMEE_APP_TOKEN`, `SHOMEE_WEB_ORIGINS`). Définies côté Vercel par scope (Production / Preview). Secrets locaux dans `apps/web/.env.local` (gitignored).
- **Mobile** : build EAS (sessions futures). Convention base URL API : `EXPO_PUBLIC_API_URL`.
- Tag de sécurité avant migration : `pwa-stable-pre-monorepo`.

---

## Annexe — Prix marché DVF (feature planifiée, non implémentée)

Objectif : après la sélection des zones IRIS et avant le budget, afficher une fourchette de prix au m² (source DVF). Granularité = **quartier Shomee** (clé `id` quartier, pas IRIS INSEE). Stockage = JSON statique `iris_market.json` (déjà dans `@shomee/core/src/data/`, sparse). Génération = script batch ponctuel (`scripts/generate-iris-market.ts`) via Intent Analytics API (`GET /v1/market/snapshot` par arrondissement). Reste à faire : compte Intent Analytics, peuplement du JSON, hook d'agrégation pondérée, intégration à l'étape budget.
