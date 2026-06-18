# SHOMEE — État de la migration (point de reprise)

> **But** : repartir d'une session fraîche sans rien reconstruire.
> **Branche** : `feat/monorepo` (poussée sur `origin`). **Retour de secours** : tag `pwa-stable-pre-monorepo`.
> **Mis à jour** : 2026-06-15.
> Détail archi : `ARCHITECTURE.md` · audit RN : `MIGRATION_AUDIT.md` · détail S1–2 : `SESSION_2_OUTCOME.md`.

---

## ✅ Fait

**Session 1 — Monorepo** (Turborepo + npm workspaces)
- `apps/web` (`@shomee/web`), `apps/mobile` (Expo scaffold), `packages/core` (`@shomee/core`, source TS). `shomee-mcp` hors workspaces.
- Logique métier extraite dans core (matching, parsing, géo, types, data JSON, stores factories, utils, hooks). Stores = factories (storage injecté).
- Vérifié : `turbo type-check` + `build web` verts ; `expo export ios` bundle core.

**Session 2 — Sécurité routes acquéreur**
- `lib/auth/appToken.ts` (token applicatif **ou** origine web, allowlist stricte sans wildcard) + token obligatoire sur les 3 routes mortes.
- `lib/rateLimit.ts` (20/60 s/IP, in-memory) sur les 5 routes coûteuses.
- `apiFetch` agnostique (core) + shim web sans token.

**Correctifs feed (2026-06-15)** — 2 commits poussés, **non déployés/mergés**
- `e3b7279` **images vides du feed généré** : poster Cloudinary dérivé de `videoUrl` dans `feed/generate` ; `DEFAULT_FALLBACK_IMAGE` → `@shomee/core/constants` (source unique) ; gardes sur les 4 `<Image>`.
- `f979841` **vidéos figées au retour sur `/feed`** : effet `IntersectionObserver` keyé sur `[feedItems]` (se ré-attache au DOM rendu) + flag `hasRevealed` (rouvre un feed révélé en `'revealed'`). **Validé navigateur.**

**Éponge dette (2026-06-16)** — non déployé/mergé
- **`feed/generate` ENOENT `quartiers.json`** : remplacé `readFileSync(process.cwd()/src/data/...)` par des imports statiques (`@shomee/core/data/quartiers.json` + `@/src/data/iris_codes_insee.json`). Le `try` jetait sur la 1re lecture → map `QUARTIER_TO_ARRS` **vide depuis la migration** (local + prod). Restaurée : 109/112 entrées peuplées. Type-check vert.

**Session 3 — Stores Zustand mobile (2026-06-16)** — non déployé/mergé
- **Barrel core** `packages/core/src/stores/index.ts` (`export *` des 3 stores, aucune collision) + entrée `exports` explicite `"./stores"` dans `packages/core/package.json`. Les shims web importent par sous-chemin (`./stores/store` via `./*`) → **inchangés**.
- **AsyncStorage** : `@react-native-async-storage/async-storage@2.2.0` ajouté à `apps/mobile` via `expo install` (aligné SDK 56).
- **Shim mobile consolidé** `apps/mobile/src/lib/stores.ts` : `createShomee/Search/FeedStore(() => AsyncStorage)` depuis `@shomee/core/stores`. Un seul module (pas d'ambiguïté de ré-export). Clés/partialize inchangés (`shomee-favorites`, `shomee-search-v2`).
- **Hydratation (mécanisme seul, pas d'UX)** : hook `apps/mobile/src/lib/useStoreHydrated.ts` lit `persist.hasHydrated()` + `onFinishHydration()` du middleware Zustand → **zéro modif core** (neutre pour le web).
- **Écran de fumée JETABLE** `apps/mobile/src/app/index.tsx` (marqué `TEMP — Session 4`) : compteur favoris + ids, `hasHydrated`, budgetMax, boutons ajout/reset/set-budget.
- Vérifs : `turbo type-check` + `test --filter=@shomee/core` (173/173) + `build --filter=@shomee/web` **verts** ; `tsc` mobile propre côté `src/`.
- **Déblocage `expo start`** : le 1er démarrage crashait (`Cannot find module 'expo-router/_ctx-shared'`) dans la génération des **typed-routes** du CLI — `expo-router` est dans `apps/mobile/node_modules` (non hoisté), inatteignable par `@expo/cli` (racine). Désactivé `experiments.typedRoutes` dans `app.json` (Metro bundle sans). Serveur OK (`localhost:8081/status` = 200). Expo a auto-nettoyé `tsconfig.json#include` (retrait `.expo/types`/`expo-env.d.ts`, déjà couverts par `**/*.ts`). **Sans rapport avec les stores.**
- **Bundle iOS prouvé** : `expo export --platform ios` → `iOS Bundled … entry.js (1084 modules)`, EXIT 0. Metro résout tout l'arbre (barrel `@shomee/core/stores`, AsyncStorage, hooks) — une résolution cassée aurait fait échouer l'export.
- **✅ Validé au runtime (web SPA)** : favori (`shomee-favorites`) ET budget (`shomee-search-v2`) **persistent au rechargement**. Valide la chaîne complète : résolution barrel, instanciation des 3 stores, injection AsyncStorage (shim localStorage sur web), hydratation, round-trip de persistance. A nécessité `web.output: "single"` (le mode `"static"` déclenche la SSR `getRoutesSSR` → même blocage hoist `expo-router`).
- **Device iOS natif non testé** : Xcode pas complètement installé (pas de simulateur) + Expo Go App Store trop ancien pour SDK 56 (« Project is incompatible »). Le chemin disque AsyncStorage natif reste donc à exercer sur device/dev-build — couvert pour l'instant par « le bundle iOS compile ».
- Périmètre S3 restant (hors stores) : tabs `expo-router`, prototype feed `FlatList`, décisions auth/cartes.

---

## 🔜 Reste à faire — Sessions 3–9

> Découpage dérivé de `MIGRATION_AUDIT` §10. Le **feed FlatList est le pattern central → à prototyper en premier** (S3).

| Session | Périmètre | Points durs |
|---|---|---|
| **3 — Fondations RN** | Décisions archi (auth, cartes, embarqué). Tabs `expo-router`, NativeWind vs StyleSheet, `lucide-react-native`, hydratation AsyncStorage (`hasHydrated`), suppr. `MobileFrame`/`ServiceWorkerRegistrar`. **Prototype feed `FlatList`**. | Auth (Sign in with Apple si social login), hydratation async |
| **4 — Feed acquéreur** | `FlatList` (`pagingEnabled`/`snapToInterval`/`onViewableItemsChanged`) → play/pause. `VideoCard` (`expo-video` + `react-native-gesture-handler`). `PropertyDetailSheet` → `@gorhom/bottom-sheet`. | Remplace `IntersectionObserver` + `createPortal` ; logique chapitres réutilisable |
| **5 — Favoris + Messages** | Favoris (AsyncStorage), Assistant/Messages (`FlatList` + `KeyboardAvoidingView`), navigation. | `localStorage`→AsyncStorage |
| **6 — Onboarding** | Étapes du brief (hors cartes), magic-link en **deep-link** (`expo-router`), remplacement `sessionStorage`/`useSearchParams`. | Handoff feed sans `sessionStorage` |
| **7 — Cartes** | `ZoneMap` (~800 lignes Leaflet) + `MapZone` → **MapLibre RN** (polygones vectoriels, sélection hiérarchique). Logique toggle déjà dans `searchStore`. | **Plus gros chantier UI** |
| **8 — Parcours agent** | Dashboard via **fetch API** (plus de server components), création, édition (**17× drag** chapitres → `react-native-draggable-flatlist`), upload média (`expo-image-picker`/`expo-file-system`). Auth agent (retirer `DEMO_API_KEY`). | Édition = composant le + complexe ; upload signé Cloudinary |
| **9 — Durcissement + go-live** | Rate-limit → Vercel KV/Upstash, App Attest iOS, env prod (`DATABASE_URL`), build EAS, soumission App Store. **Admin + `/share` restent web.** | Sécurité routes payantes en public |

---

## ⚠️ Dette technique notée

- **`DATABASE_URL` Production absente de `vercel env ls`** (probable intégration Storage) → **confirmer avant merge → prod**, sinon build prod casse (Prisma throw à l'import). Build prod monorepo **jamais testé**.
- **Deploy CLI Vercel bloqué** : lien dans `apps/web/.vercel` **+** Root Directory = `apps/web` se cumulent (`vercel --prod` → `apps/web/apps/web`). Régler l'un OU l'autre (Root Directory vide, ou re-lier à la racine). Cf. `ARCHITECTURE.md` §6.
- **Bearer** : 3 implémentations (helper + 2 copies locales api-keys/import-llm) + **clé démo en dur** `shomee_test_kr3tz_0001` (MediaUploader) → consolider + remplacer.
- **Rate-limit in-memory** non distribué (reset cold start) → KV/Upstash avant App Store.
- **Cold-start Postgres** : `GET /api/properties` ~38 s à froid vs ~180 ms à chaud (adaptateur `pg`).
- **Allowlist d'origine sans wildcard** : preview hors `VERCEL_URL`/`VERCEL_BRANCH_URL`/`VERCEL_PROJECT_PRODUCTION_URL` → 401 (ajouter à `SHOMEE_WEB_ORIGINS`).
- **3 tests `geo-resolution.test.ts` flaky** (appels live Overpass/Nominatim) — à mocker/skip. 170 autres stables.
- **`expo-router` non hoisté (cause racine de 2 symptômes dev-server)** : `expo-router` vit dans `apps/mobile/node_modules` (pas à la racine), donc tout chemin de `@expo/cli` (hoisté dans `node_modules/expo/...`) qui `require('expo-router/...')` échoue. Casse uniquement 2 commodités du **dev-server** : (1) génération typed-routes (`_ctx-shared`) → `experiments.typedRoutes` désactivé ; (2) web `output: "static"` (SSR `getRoutesSSR` → `internal/routing`) → passé en `output: "single"` (SPA). **N'affecte PAS** le bundling Metro, `expo export` (iOS prouvé), ni le run natif/dev-build (ils résolvent via `metro.config` → `apps/mobile/node_modules`).
  - ❌ **Ne PAS hoister via le `package.json` racine** (testé 2026-06-18 → ERESOLVE) : remonter expo-router à la racine force npm à réconcilier React web (**19.2.7**, via Next/`react-server-dom-webpack`) et mobile (**19.2.3**, pinné Expo SDK 56) → conflit de peer dep dur. Tant qu'expo-router reste niché, chaque app garde sa version.
  - ✅ **État actuel = stable, pas un pansement.** typedRoutes (DX) et web-static (inutile, le vrai web = Next/apps/web) ne sont pas des bloqueurs. Si typedRoutes redevient souhaité : aligner les versions React (impossible sans toucher au SDK) **ou** migrer le monorepo vers **pnpm** (isolation par défaut) — décision séparée, hors S4.
- **`tsc` mobile ↔ namespace global `GeoJSON`** : dès qu'`apps/mobile` importe `@shomee/core/stores` (→ `searchStore` → `import('../geo/geoConstraintService')`), un `tsc` sur le projet mobile remonte `Cannot find namespace 'GeoJSON'` dans `geoConstraintService.ts`/`geoDataService.ts`. Core s'appuie sur le global ambient `GeoJSON` de `@types/geojson` (non inclus par le tsconfig mobile). **Sans impact** : mobile n'a pas de tâche `type-check`, Metro strippe les types, `turbo type-check` reste vert. **Fix propre (quand mobile aura son type-check)** : dans core, remplacer les `GeoJSON.X` par `import type { X } from 'geojson'` (auto-suffisant pour tout consommateur).
- **Token statique extractible** (mobile) → App Attest iOS (S9).
- **Données embarquées** ~460 KB JSON : décider embarqué vs CDN (S3/S7).

---

## ▶️ Point de reprise précis

1. **État git** : sur `feat/monorepo`, working tree propre, 2 commits feed poussés (`e3b7279`, `f979841`) au-dessus de `e667158`. **Rien à déployer/merger sans avoir réglé `DATABASE_URL` prod + le blocage deploy CLI.**
2. **Si tu veux déployer** : régler le doublement Root Directory (cf. dette), puis `vercel --prod` ; confirmer `DATABASE_URL` en Production d'abord.
3. **Si tu veux merger `feat/monorepo` → `main`** : valider build prod monorepo en preview d'abord (jamais testé).
4. **Si tu démarres le mobile** : commencer **Session 3** → prototyper le **feed `FlatList`** (pattern central, dé-risque tout le reste) avant l'onboarding/les cartes.
5. **Vérif rapide d'environnement** : `npx turbo run type-check` (web+core), `npx turbo run test --filter=@shomee/core` (173 tests, 3 flaky réseau), `npx turbo run build --filter=@shomee/web`.

> Aucune tâche en cours, aucun serveur dev actif. État stable.
