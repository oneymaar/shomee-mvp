# SHOMEE — État de la migration (point de reprise)

> **But** : repartir d'une session fraîche sans rien reconstruire.
> **Branche** : `feat/monorepo` (poussée sur `origin`). **Retour de secours** : tag `pwa-stable-pre-monorepo`.
> **Mis à jour** : 2026-07-01.
> Détail archi : `ARCHITECTURE.md` · audit RN : `MIGRATION_AUDIT.md` · détail S1–2 : `SESSION_2_OUTCOME.md` · brouillon spec S4 : `SESSION_4_PLAN_DRAFT.md`.

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

**Session 4 — Feed acquéreur mobile (2026-06-18 → 07-01)** — non déployé/mergé · dernier commit `1212783`

> Runtime : **dev build iOS validé** (Xcode 26.5). Expo Go inutilisable (SDK 56 trop récent). Itération UI = `expo start --web` (SPA) ; comportement natif (vidéo/gestes/splash) = `expo prebuild --clean && expo run:ios`. Cf. mémoire `project_mobile_runtime_testing`.

- **Splash** (`app.json` + `src/app/_layout.tsx`) : natif (expo-splash-screen) **crème `#FDF5F2` + logo terracotta** (`assets/images/logo-shomee-terracotta.png`, copié du web), top-level iOS+Android + dark (⚠️ baké → `prebuild --clean`). Côté JS : `preventAutoHideAsync()` au load + `hideAsync()` quand hydraté ; non-hydraté → rien (le splash natif couvre). **Aucun loader JS** (un spinner sur fond noir a été retiré).
- **S4a — Coquille d'onglets** (`src/app/(tabs)/`) : `<Tabs>` depuis **`expo-router/js-tabs`** (import depuis `expo-router` déprécié SDK 56). 4 onglets Biens/Favoris/Messages/Profil, icônes `lucide-react-native`, actif `#A64B27`/inactif `#A3A3A3`/fond `#FDF5F2`+safe-area, badge Messages sur `hasUnread` réel (0→masqué). `index`=Biens, `favorites` (compteur store réel), `messages`/`profile` placeholders. Smoke screen S3 supprimé. Root = `GestureHandlerRootView` + `SafeAreaProvider` + gating hydratation.
- **S4b-v1 — Feed vidéo nu** : `feedSeed.json` **déplacé** `apps/web/lib` → `packages/core/src/data/` (source unique web+mobile ; import web + `gen-feed-seed.ts` maj). `expo-video@56.1.4` ; `src/components/VideoCard.tsx` (`useVideoPlayer` loop, play/pause sur `isActive`, inactive→pause+seek 0, poster expo-image, player libéré à l'unmount). `(tabs)/index.tsx` : `FlatList` plein écran (hauteur via onLayout), `pagingEnabled`, carte active via `onViewableItemsChanged` (ref stable, 60%) → `feedStore.currentIndex`. **Une seule vidéo joue à la fois.**
- **S4b-v2a — Surcouches** : `feedStore.muted` (core, global, init `false`=son ON) + `toggleMuted` ; VideoCard sync `player.muted` ; bouton mute unique haut-droite. `PropertyOverlay.tsx` (dégradés haut/bas `expo-linear-gradient`, badge agence, adresse `formatLocation`, ligne bien, **features 1 ligne avec fondu droit via MaskedView alpha** — le texte devient transparent, pas de calque ; « Voir l'annonce » no-op → v2b ; **MatchBadge rendue seulement si `matchScore` réel** → invisible sur le seed). `ActionRail.tsx` (Cœur favori toggle+pulse+likeCount ; **Téléphone** `Linking.openURL('tel:')` lit `agencyPhone` sinon **numéro de test marqué TODO** ; Message placeholder S5 ; Partage natif `Share.share`). `FeedItem.tsx` empile vidéo+overlay+rail, `pointerEvents="box-none"`.
- **S4b-v2b — Hold-pause + `PropertyDetailSheet` complète** :
  - **Hold-pause** : `Gesture.LongPress().minDuration(200).maxDistance(10)` sur la VideoCard (`onStart`→pause à l'activation, `onFinalize`→reprise ; `runOnJS(true)` car appels player JS ; `maxDistance` fait échouer le long-press dès que le doigt bouge → **swipe vertical FlatList jamais bloqué**). Composé via **`Gesture.Race`** = point d'insertion prêt pour un futur **tap-chapitres gauche/droite** (TODO en place, non codé — seed sans chapitres), sans re-câbler le `GestureDetector`.
  - **`PropertyDetailSheet`** (`@gorhom/bottom-sheet@5.2.14`) — **⚠️ correction du plan : v5 est JS pur** (peers `reanimated@4.3.1` + `gesture-handler@2.31.1` déjà compilés) → `npm install` + reload, **PAS de rebuild natif**. `BottomSheetModalProvider` à la racine ; **un seul modal** au niveau du feed, présenté par `onMore` (« Voir l'annonce » de l'overlay). **Fond clair** (miroir du sheet web). Contenu, ordre web : badge agence (repris du feed, adapté fond clair) + image principale (galerie différée → 1 poster) + **Équipements** (puces ✓ vertes, style feed) + **Description** + **Quartier** + **Caractéristiques** (17 lignes) + **Diagnostics** + **Composition** + **Marché**. **Barre CTA sticky** (`BottomSheetFooter`) : Message/Appeler/Visiter + Like/Share (répartition flex corrigée : `flex:1` sur la pill gauche seulement).
    - **Diagnostics** : `DiagBadge` **100% SVG** (`react-native-svg`) — flèche DPE / pilule GES via `<Path>`, couleurs ADEME, **lettre contourée en 2 passes** (stroke derrière / fill devant) pour émuler `paintOrder:'stroke fill'` (absent en RN → supprime le double tracé). Badges `flex:1` (répartis, plus serrés à gauche).
    - **Quartier** : `irisZone`/`irisDescription` + **placeholder carte** (interactive → S7) + transports groupés à pastilles colorées (`parseLine` + couleurs lignes métro/RER portées du web) + à-proximité + ambiance.
  - **Appeler** : fallback `Alert` (numéro affiché) si `tel:` échoue — le **simu iOS n'a pas d'app Téléphone** ; sur device le composeur s'ouvre. Numéro de test `0670744935` marqué `// TODO` (aussi dans le CTA du sheet).
- **Seed enrichi — données de test hors-base** : `composition` (sommée à la surface Carrez), marché (`marketAvgPricePerSqm`/`Evolution10y`/`High`/`Low`, ancrés sur `pricePerSqm`), Quartier (`irisZone`/`irisDescription`/`transports` format parseLine/`nearbyPlaces`) ajoutés **à la main** aux 4 biens → rendent visibles les sections Composition/Marché/Quartier du sheet. **⚠️ Hors Prisma → un `npm run feed:seed` (régénéré depuis la base) les écrase** (cf. dette + mémoire `project_feed_instant_seed`). Diff purement additif, `build web` vert.
- **Différé (hors v2b)** : onglets média **Photos / Plan / Visite** (matterport) + **galerie photos** (carrousel) → **passe média** ultérieure (aujourd'hui 1 poster) ; **carte quartier interactive** → **S7** (placeholder pour l'instant) ; **fly-heart** (animation cœur qui s'envole au like) → v2+.
- **Crash natif résolu** : `expo install expo-video` avait tiré 56.1.4 sur un SDK dérivé (expo 56.0.9) → `dyld Symbol not found ExpoModulesCore.Record.from(...)`. `expo install --fix` a réaligné (expo ~56.0.12, **expo-modules-core 56.0.17** qui contient le symbole). **Leçon : `expo install --check` après tout ajout de module natif + `prebuild --clean`.**
- Modules natifs mobile ajoutés en S3/S4 : `@react-native-async-storage/async-storage`, `expo-video`, `expo-linear-gradient`, `lucide-react-native`, `react-native-svg`, `@react-native-masked-view/masked-view` (0.3.2 = pod `RNCMaskedView` déjà lié via expo-router).
- Vérifs (chaque étape) : `tsc` mobile propre (src/), `turbo type-check` (core+web) vert, `build web` vert, `expo export ios` EXIT 0.
- ⏳ **Validation simulateur finale par Olivier** en cours (feed vidéo v1/v2a + hold-pause + `PropertyDetailSheet` v2b sur le dev build).

---

## 🔜 Reste à faire — Sessions 3–9

> Découpage dérivé de `MIGRATION_AUDIT` §10. Le **feed FlatList est le pattern central → à prototyper en premier** (S3).

| Session | Périmètre | Points durs |
|---|---|---|
| **3 — Fondations RN** ✅ | Stores AsyncStorage + hydratation, tabs `expo-router`, `lucide-react-native`. StyleSheet retenu (pas NativeWind). | _fait_ |
| **4 — Feed acquéreur** 🟡 | ✅ v1 (FlatList + `expo-video`) + v2a (overlay, favori, mute, partage, appeler, fondu features) + **v2b** (hold-pause `Gesture.LongPress` composé `Gesture.Race` ; `PropertyDetailSheet` **complète** via `@gorhom/bottom-sheet` **JS pur, pas de rebuild** — sections + Diagnostics SVG + Quartier ; seed enrichi). **Reste : feed live** (brief+token) → MatchBadge + chapitres (tap G/D). | shim apiFetch mobile (base URL+token) ; brancher tap-chapitres (point d'insertion `Race` prêt) |
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
- **Feed mobile = seed statique** : `feedSeed.json` (4 biens) n'a pas de `matchScore`, `chapters`, ni `agencyPhone` → **MatchBadge masquée**, **nav chapitres indisponible**, **téléphone = numéro de test marqué `// TODO`** (`ActionRail.tsx` + CTA Appeler du sheet). Tout réapparaît avec le **feed live** (POST /api/feed/generate via shim apiFetch mobile + base URL d'alias de branche + appToken). Le numéro d'agence devra venir d'un champ `agencyPhone` (à projeter côté serializer).
- **Seed enrichi de données de test hors-base (v2b)** : `composition`, marché (`marketAvgPricePerSqm`/`Evolution10y`/`High`/`Low`) et Quartier (`irisZone`/`irisDescription`/`transports`/`nearbyPlaces`) ont été **ajoutés à la main** au JSON pour valider l'UI du sheet. Ils **ne viennent PAS de Prisma** (le seed est régénéré depuis la base par `gen-feed-seed.ts` → `toViewProperty`) → **un `npm run feed:seed` les efface**. Pour les pérenniser : les porter en base / dans `toViewProperty`. Cf. mémoire `project_feed_instant_seed`.
- **Modules natifs mobile** : tout ajout (`expo install <module natif>`) exige `expo install --check` (éviter le skew de version, cf. crash expo-video) **puis** `expo prebuild --clean && expo run:ios` (le `ios/` est gitignoré, régénéré). Un simple reload ne suffit pas pour le natif.
- **Token statique extractible** (mobile) → App Attest iOS (S9).
- **Données embarquées** ~460 KB JSON : décider embarqué vs CDN (S3/S7).

---

## ▶️ Point de reprise précis

1. **État git** : sur `feat/monorepo`, working tree propre (seul `ARCHITECTURE.md` apparaît modifié — changement pré-existant non lié, laissé tel quel). Dernier commit **`1212783`**. **`feat/monorepo` = `main` + 53 commits, 0 divergence** → merge fast-forward possible, MAIS **rien déployé/mergé** (dette `DATABASE_URL` prod + deploy CLI).
2. **Mobile — S4b-v2b ✅ terminée** (hold-pause + composition `Gesture.Race` prête pour tap-chapitres ; `PropertyDetailSheet` complète — JS pur, sans rebuild ; seed enrichi). **Prochaine étape = feed live** :
   - créer `apps/mobile/src/lib/apiFetch.ts` = `createApiFetch({ baseUrl: <alias de branche `shomee-mvp-git-feat-monorepo-oneymaars-projects.vercel.app`>, appToken: <app.json > extra> })` ; POST `/api/feed/generate` depuis le snapshot `searchStore` (réutiliser la logique web de `feed/page.tsx`, sans `sessionStorage`).
   - Débloque : **MatchBadge** (matchScore réel), **chapitres** (nav **tap gauche/droite** → brancher un `Gesture.Tap()` au **point d'insertion `Gesture.Race` déjà en place** dans `VideoCard.tsx` ; le hack ghost-click web n'est PAS à porter), **`agencyPhone`** réel (remplace le numéro de test), et les vraies **composition / marché / quartier** (remplacent les données de test du seed).
   - **Différé à brancher plus tard** : passe média (onglets Photos/Plan/Visite + galerie), carte quartier interactive (**S7**), fly-heart.
3. **Lancer le mobile** : `cd apps/mobile && npx expo run:ios` (dev build natif). Itération UI pure (pas de natif touché) : `npx expo start --web`. Après tout `expo install` de module natif : `expo install --check` puis `expo prebuild --clean && expo run:ios`.
4. **Si deploy/merge prod** : régler `DATABASE_URL` Production + doublement Root Directory (cf. dette), valider build prod monorepo en preview d'abord (jamais testé).
5. **Vérif env** : `npx turbo run type-check` (web+core) ; `npx turbo run test --filter=@shomee/core` (173, 3 flaky réseau) ; `npx turbo run build --filter=@shomee/web` ; côté mobile `cd apps/mobile && npx tsc --noEmit -p tsconfig.json` (propre sur `src/` ; erreurs `GeoJSON` dans core = dette connue) et `npx expo export --platform ios` (depuis `apps/mobile`).

> Aucune tâche en cours, aucun serveur dev actif requis. `SESSION_4_PLAN_DRAFT.md` = brouillon de spec S4 (archivable). État stable.
