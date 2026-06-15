# SESSION 1–2 — Outcome (handoff pour session fraîche)

> Branche : `feat/monorepo` (poussée sur `origin`). Base de retour : tag `pwa-stable-pre-monorepo`.
> Détails archi : `ARCHITECTURE.md`. Audit migration : `MIGRATION_AUDIT.md`.

## ✅ Fait

**Session 1 — Monorepo** (Étapes 0–5)
- Turborepo + npm workspaces : `apps/web`, `apps/mobile` (Expo scaffold), `packages/core`. `shomee-mcp` hors workspaces.
- Extraction de la logique métier dans `@shomee/core` (types, matching, parsing, géo, data JSON, stores, utils, hooks) — consommée en source TS.
- Stores convertis en **factories** (storage injecté) ; tests relocalisés dans core.
- Vérifié : `turbo type-check` + `build web` verts ; `expo export ios` bundle avec core résolu.

**Fixes intermédiaires**
- `fix(feed)` : feed persistant entre navigations (nouveau `feedStore` transient) + écran d'analyse uniquement en fin d'onboarding. Validé en navigateur (3 critères).
- `fix(security)` admin : secret `shomee_admin` (en dur + query) → header `x-admin-secret` timing-safe vs `ADMIN_SECRET`.

**Session 2 — Sécurité routes acquéreur** (Option A)
- `lib/auth/appToken.ts` : token applicatif **OU** origine web autorisée (allowlist stricte, sans wildcard) ; token obligatoire pour les 3 routes mortes.
- `lib/rateLimit.ts` : 20/60s par IP (in-memory) sur les 5 routes coûteuses.
- `apiFetch` agnostique (core) + shim web sans token ; 5 sites client migrés.
- Vérifié : curl 401/200/429 OK, type-check + build verts.

**Env configurées sur Vercel (scope Production + Preview/feat-monorepo)** : `DATABASE_URL`, `CLOUDINARY_*`, `ANTHROPIC_API_KEY`, `ADMIN_SECRET`, `SHOMEE_APP_TOKEN`. Locales dans `apps/web/.env.local` (gitignored).

## 🔜 Reste à faire

- **BUG image (diagnostiqué, non corrigé)** : `feed/generate` projette `imageUrlFallback: ''` et `gallery: []` (route.ts ~1023). Next `<Image src="">` **crashe** → feed/favoris/détail des biens **générés**. Fix : dériver un poster Cloudinary depuis `video.videoUrl` (cf. `videoAnalysisService` `…/so_0,…/<publicId>.jpg`) ou `DEFAULT_FALLBACK_IMAGE` ; + garde défensive sur les 4 `<Image>` (VideoCard:252, favorites:66, PropertyDetailSheet:443 via `gallery`, favorites/[id] via VideoCard).
- **PR `feat/monorepo` → `main`** (quand prêt).
- Migration mobile (sessions suivantes) : parcours acquéreur/agent, remplacement `sessionStorage`/`localStorage`, navigation expo-router, etc.

## ⚠️ Points de vigilance

- **`DATABASE_URL` Production absente de `vercel env ls`** (probablement injectée par une intégration Storage). À **confirmer avant tout merge → prod**, sinon le build prod casse (Prisma throw à l'import). Le build prod n'a pas encore été testé sur le monorepo.
- **Env scopées à la branche `feat/monorepo`** côté Preview (`DATABASE_URL`, `CLOUDINARY_*`, `ADMIN_SECRET`, `SHOMEE_APP_TOKEN`). Une autre branche de preview ne les aurait pas.
- **Allowlist d'origine sans wildcard** : si le preview web est ouvert via une URL hors `VERCEL_URL`/`VERCEL_BRANCH_URL`/`VERCEL_PROJECT_PRODUCTION_URL`, les routes acquéreur renvoient 401 → ajouter l'origine exacte à `SHOMEE_WEB_ORIGINS`.
- **Rate-limit in-memory** non distribué (reset cold start) → migrer Vercel KV/Upstash **avant App Store**.
- **Dette bearer** : 3 implémentations (helper partagé + 2 copies locales api-keys/import-llm) + clé démo agent en dur (`shomee_test_kr3tz_0001` dans MediaUploader) → consolider + remplacer.
- **Cold-start Postgres** : `GET /api/properties` ~38 s à froid vs ~180 ms à chaud (adaptateur `pg`) → à creuser avant App Store.
- **Token statique extractible** (mobile) → App Attest iOS (session ultérieure).
- **Tests core** : 3 tests de `geo-resolution.test.ts` sont **flaky** (appels live Overpass/Nominatim : HTTP 504, forme de réponse variable) — non déterministes, à mocker/skip un jour. Les 171 autres sont stables.
- **`SHOMEE_WEB_ORIGINS`** : ajouter le domaine de prod final au go-live (et retirer toute tolérance preview).
