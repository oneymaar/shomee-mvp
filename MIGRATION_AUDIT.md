# SHOMEE — Audit de migration PWA (Next.js) → React Native (Expo)

> **Statut : audit uniquement.** Aucun code de migration n'est produit ici.
> Ce document est la référence unique pour toutes les sessions de migration
> suivantes.
>
> **Périmètre de lecture** : racine principale du projet uniquement.
> Exclus : `.claude/worktrees/`, `node_modules/`, `.next/`, `scripts/`.
>
> **Stack actuelle** : Next.js 16.2.4 (App Router) · React 19.2.4 ·
> Zustand 5 · Framer Motion 12 · Leaflet 1.9 + react-leaflet 5 ·
> Prisma 7 (Postgres via `@prisma/adapter-pg`) · Cloudinary ·
> `@anthropic-ai/sdk` 0.98 · Tailwind 4 · Zod 4.
>
> **Cible** : Expo (React Native), distribuable App Store iOS.

---

## ⚠️ 0. CORRECTIONS AU CAHIER DES CHARGES (à lire en premier)

L'énoncé de l'audit fait deux hypothèses qui **ne correspondent pas au code réel**.
À corriger avant toute décision d'architecture :

| Hypothèse de l'énoncé | Réalité du code | Impact migration |
|---|---|---|
| « Auth Next-Auth (Google + Apple) » | **`next-auth` n'est pas installé** (`package.json` ne le contient pas, aucun `getServerSession`, aucun provider OAuth). | **Il n'y a aucun login utilisateur à migrer.** Voir §1.4. |
| « Lien entre BuyerBriefToken et compte utilisateur » | **Il n'existe pas de compte acquéreur.** Le `BuyerBriefToken` est un token de magic-link autonome (UUID, TTL 24h), non rattaché à un `User`. | Le « compte » acquéreur = l'état local Zustand persisté dans le navigateur. **Aucune identité serveur côté acquéreur.** |

La seule authentification réelle est un **Bearer token API** ([lib/auth/bearer.ts](lib/auth/bearer.ts))
utilisé par les intégrations externes (import LLM, serveur MCP) et par
l'app agent côté client via une **clé démo en dur** (`DEMO_API_KEY = 'shomee_test_kr3tz_0001'`,
voir [components/agent/MediaUploader.tsx](components/agent/MediaUploader.tsx)).

> **Décision d'architecture nº1 à prendre** : la migration mobile devra
> probablement introduire une vraie auth (Sign in with Apple est *obligatoire*
> sur l'App Store dès qu'un autre social login existe — mais ici il n'y en a
> aucun aujourd'hui). Voir §10.

---

## 1. PARCOURS UTILISATEUR

### 1.1 Parcours Acquéreur

#### a) Onboarding via magic link
- **Écrans** : [app/onboarding/page.tsx](app/onboarding/page.tsx) (orchestrateur multi-étapes), avec les étapes :
  [LocationStep](components/onboarding/LocationStep.tsx) → [LocationMapStep](components/onboarding/LocationMapStep.tsx) (Leaflet) → [ClarificationStep](components/onboarding/ClarificationStep.tsx) → [BienStep](components/onboarding/BienStep.tsx) → [BudgetStep](components/onboarding/BudgetStep.tsx) (Leaflet feasibility map) → [CriteriaStep](components/onboarding/CriteriaStep.tsx) → [AIPreparationStep](components/onboarding/AIPreparationStep.tsx) → [AIBriefRecap](components/onboarding/AIBriefRecap.tsx).
- **Magic link** : arrivée sur `/onboarding?brief=<uuid>`. La page lit `useSearchParams()`, `GET /api/buyer/onboarding-prefill?token=<uuid>`, puis [aiBriefInjector.injectBrief()](lib/services/aiBriefInjector.ts) qui :
  1. `POST /api/location/analyze`
  2. charge arrondissements/quartiers/communes/iris en parallèle ([geoDataService](lib/services/geoDataService.ts), fetch opendata)
  3. `resolveConstraints()` → IRIS ids
  4. dérive parents (arr/quartier/commune)
  5. `useSearchStore.setState(...)` + `addCustomCriteria(...)`
- **État Zustand** : [useSearchStore](lib/searchStore.ts) (tout le brief : location, zones, budget, pièces, surface, chipStates, customCriteria).
- **Appels API** : `GET /api/buyer/onboarding-prefill`, `POST /api/location/analyze`, et indirectement les fetch opendata externes (opendata.paris.fr, geo.api.gouv.fr, public.opendatasoft.com).
- **Framer Motion** : `AnimatePresence` + `variants` (transitions d'étapes), `layoutId` (pills critères), typewriter/caret animés (AIPreparationStep, MapLoadingScreen).
- **Dépendances browser** : `useSearchParams`/`useRouter` (next/navigation), Leaflet (DOM), `localStorage` (persist Zustand), `document.activeElement` ([CriteriaStep:189](components/onboarding/CriteriaStep.tsx)).

#### b) Feed principal
- **Écran** : [app/feed/page.tsx](app/feed/page.tsx).
- **État Zustand** : `useSearchStore` (lecture du brief pour POST), `useShomeeStore` (favoris, currentIndex).
- **Appels API** : `POST /api/feed/generate` (génération Claude Haiku + matching vidéos via [video-tags.json](src/data/video-tags.json)), fallback `POST /api/properties`.
- **Framer Motion** : `AnimatePresence`, `whileTap`.
- **Dépendances browser** : **deux `IntersectionObserver`** ([feed/page.tsx:310,326](app/feed/page.tsx)) pour le scroll-snap vertical type TikTok ; `container.scrollTop`, `requestAnimationFrame`, `document.querySelector('[data-tab="favoris"] svg')` (animation du badge favori). **Point chaud RN** (voir §10).

#### c) Détail d'un bien
- **Écran/Composant** : [components/PropertyDetailSheet.tsx](components/PropertyDetailSheet.tsx) (bottom sheet), route dédiée [app/feed/[id]/page.tsx](app/feed/[id]/page.tsx).
- **Framer Motion** : `AnimatePresence` + `variants` + **`createPortal`** (rendu dans `document.body`).
- **Dépendances browser** : `createPortal` vers `document.body` ([PropertyDetailSheet:306](components/PropertyDetailSheet.tsx)), `window.location.href = 'tel:...'` ([:753](components/PropertyDetailSheet.tsx)).

#### d) Favoris
- **Écrans** : [app/favorites/page.tsx](app/favorites/page.tsx), [app/favorites/[id]/page.tsx](app/favorites/[id]/page.tsx).
- **État Zustand** : `useShomeeStore.favorites` (objet `Property` entier, pas seulement l'id — voir commentaire dans [store.ts](lib/store.ts)).
- **Persistence** : `persist` middleware, clé `shomee-favorites`, `partialize` → favoris uniquement. **`localStorage`** → à migrer en AsyncStorage.

#### e) Assistant IA / Messages
- **Écrans** : [app/assistant/page.tsx](app/assistant/page.tsx), [app/messages/page.tsx](app/messages/page.tsx), [components/ConversationView.tsx](components/ConversationView.tsx).
- **État Zustand** : `useShomeeStore.conversations` (**non persisté** — éphémère, mock), helpers `addMessage`, `markConversationSeen`, `hasUnread`.
- **Framer Motion** : `AnimatePresence`.
- **Dépendances browser** : `useRouter` (next/navigation).

### 1.2 Parcours Agent

| Étape | Écran(s) | État | API | Notes RN |
|---|---|---|---|---|
| Dashboard | [app/agent/dashboard/page.tsx](app/agent/dashboard/page.tsx) (server), [DashboardListClient](components/agent/DashboardListClient.tsx), [DashboardFilterPills](components/agent/DashboardFilterPills.tsx) | local | données via Prisma (server component) | server component → à transformer en fetch API |
| Création | [app/agent/biens/nouveau/page.tsx](app/agent/biens/nouveau/page.tsx) | local + `useAutoSave` | `POST /api/biens/import-llm` ou MCP | `variants`, `AnimatePresence` |
| Édition complète | [app/agent/biens/[id]/editer/](app/agent/biens/[id]/editer/) ([EditBienClient](app/agent/biens/[id]/editer/EditBienClient.tsx)) | local + `useAutoSave` | `PATCH /api/biens/[id]` | **17 usages `drag`** (réorg. chapitres vidéo) + 9 `AnimatePresence` — composant le plus complexe à porter |
| Import LLM (citations sources) | éditeur + import-llm | — | `POST /api/biens/import-llm` (Bearer) | citations par champ stockées en base |
| Auto-save | [lib/hooks/useAutoSave.ts](lib/hooks/useAutoSave.ts) + [AutoSaveIndicator](components/agent/AutoSaveIndicator.tsx) | hook (debounce 3s, single in-flight) | `PATCH /api/biens/[id]` | hook pur React, **portable tel quel** |
| Gestion / statuts / archives | [app/agent/biens/archives/page.tsx](app/agent/biens/archives/page.tsx), [ArchivesListClient](components/agent/ArchivesListClient.tsx), [PropertyCardAgent](components/agent/PropertyCardAgent.tsx) | local | Prisma / API | `AnimatePresence` |
| Upload média | [MediaUploader](components/agent/MediaUploader.tsx) | local | `POST /api/upload/sign` → upload direct Cloudinary → `POST /api/upload/confirm` | **fortes deps browser** : `File`, `URL.createObjectURL`, `document.createElement('video')` pour sonder la durée. Voir §9. |
| Aperçu | [app/agent/biens/[id]/preview/](app/agent/biens/[id]/preview/) | local | — | `whileTap` |

- **Layout agent** : [app/agent/layout.tsx](app/agent/layout.tsx) + [AgentBottomNav](components/agent/AgentBottomNav.tsx) (`useRouter`/`usePathname`).
- **Auth agent (réalité)** : clé Bearer démo en dur dans le client ([MediaUploader.tsx](components/agent/MediaUploader.tsx)) — `'shomee_test_kr3tz_0001'`. Pas de session.

### 1.3 Parcours Admin
- **Écran** : [app/admin/video-tagger/page.tsx](app/admin/video-tagger/page.tsx) + [VideoTaggerClient](app/admin/video-tagger/VideoTaggerClient.tsx).
- **API** : `GET /api/admin/videos`, `POST /api/admin/video-tags`.
- **Notes** : outil interne. À **exclure de l'app iOS** (rester web). Faible priorité.

### 1.4 Auth (réalité du code — corrige l'énoncé)
- **Aucun Next-Auth, aucun Google/Apple, aucun compte acquéreur.**
- **Bearer API key** ([lib/auth/bearer.ts](lib/auth/bearer.ts)) : résout `AgentApiKey → Agent → Agency`. Utilisé par : import LLM, MCP, routes agent/upload/biens.
- **`BuyerBriefToken`** (modèle Prisma) : token magic-link autonome. `POST` (Bearer agent) crée le token + renvoie l'URL `/onboarding?brief=<token>`. `GET ?token=` renvoie le brief (non single-use, 404 inconnu, 410 expiré).
- **Identité acquéreur = état Zustand local** (favoris/brief dans localStorage). Rien côté serveur.

---

## 2. INVENTAIRE COMPOSANTS

Tous les composants sont `'use client'` sauf `MobileFrame` et `ShomeeLogo`.
Légende équivalent RN : RNW = react-native-web non requis (app native).

### 2.1 `components/` (racine)

| Composant | Rôle | Props clés | État local | Framer Motion | Deps browser/Next | Équivalent RN |
|---|---|---|---|---|---|---|
| [ActionRail](components/ActionRail.tsx) | Rail d'actions latéral (like/message) sur le feed | `property, isFavorite, onToggleFavorite, onMessage, previewMode` | non | `AnimatePresence` (3) | — | `View` + `Pressable` + Reanimated |
| [AgentBottomNav](components/AgentBottomNav.tsx) | Nav basse agent | — | non | non | **`useRouter`/`usePathname`** | Tabs `expo-router` |
| [BAIAModal](components/BAIAModal.tsx) | Modale "Bon à savoir IA" (bg-neutral-900) | `open, onClose` | non | `AnimatePresence` (7) | — | RN `Modal` + Reanimated |
| [BottomNav](components/BottomNav.tsx) | Nav basse acquéreur | `previewMode` | non | non | **`useRouter`**, `next/link`, `next/image` | Tabs `expo-router` |
| [ConversationView](components/ConversationView.tsx) | Fil de discussion bien | `property` | local (input) | `AnimatePresence` | **`useRouter`** | `FlatList` + `KeyboardAvoidingView` |
| [EndOfFeedCard](components/EndOfFeedCard.tsx) | Carte fin de feed (bg-neutral-900) | `onReset, ...` | non | `AnimatePresence` (3) | — | `View` |
| [MapZone](components/MapZone.tsx) | Mini-carte d'un bien (Leaflet) | `lat, lng, polygon, transports, pois` | non | non | **Leaflet/react-leaflet (DOM)** | `react-native-maps` / `expo-maps` |
| [MobileFrame](components/MobileFrame.tsx) | Cadre 430px (simulateur mobile en web) | `children, className` | non | non | — | **Supprimer** (inutile en natif) |
| [PropertyDetailSheet](components/PropertyDetailSheet.tsx) | Bottom sheet détail bien | `property, open, onClose, ...` | local | `AnimatePresence`+`variants`, **`createPortal`** | **`createPortal`→`document.body`**, `window.location.href='tel:'` | `@gorhom/bottom-sheet` + `Linking.openURL('tel:')` |
| [PropertyOverlay](components/PropertyOverlay.tsx) | Overlay infos sur la vidéo | `property, onMore, agencyTopOffset, matchScore, isActive` | non | non | `next/image` | `View` absolu + `expo-image` |
| [ServiceWorkerRegistrar](components/ServiceWorkerRegistrar.tsx) | Enregistre `/sw.js` | — | non | non | **`navigator.serviceWorker`** | **Supprimer** (pas de SW en natif) |
| [ShomeeLogo](components/ShomeeLogo.tsx) | Logo SVG inline | `size, className` | non | non | SVG | `react-native-svg` |
| [SkipFeedbackCard](components/SkipFeedbackCard.tsx) | Carte feedback skip (bg-neutral-900) | `property, onAfterSubmit` | local | `AnimatePresence` (3) | — | `View` + Reanimated |
| [SkipFeedbackModal](components/SkipFeedbackModal.tsx) | Modale feedback skip | `property, open, onClose` | local | `AnimatePresence` (5) | — | RN `Modal` |
| [VideoCard](components/VideoCard.tsx) | Lecteur vidéo + chapitres + gestes tap/hold | `property, isActive, muted` | local (duration, chapterLabel) | CSS keyframes (`animate-fade-in-out`) | **`<video>` HTML5**, `next/image`, `next/font` (Poppins), gestes tactiles manuels, `DOMRect`, `getBoundingClientRect` | **`expo-video`** + `react-native-gesture-handler` (voir §9) |
| [VideoProgressBar](components/VideoProgressBar.tsx) | Barre de progression segmentée | `videoRef, chapters` | local | non | **`HTMLVideoElement` ref**, `requestAnimationFrame` | Reanimated + `expo-video` player listener |

### 2.2 `components/agent/`

| Composant | Rôle | Props clés | État | Framer Motion | Deps browser/Next | Équivalent RN |
|---|---|---|---|---|---|---|
| [ArchivesListClient](components/agent/ArchivesListClient.tsx) | Liste biens archivés | `properties` | local (filtre) | `AnimatePresence` (3) | — | `FlatList` |
| [AutoSaveIndicator](components/agent/AutoSaveIndicator.tsx) | Pastille état auto-save | `status, isDirty, error` | non | (icônes) | — | `View` + icône |
| [DashboardFilterPills](components/agent/DashboardFilterPills.tsx) | Pills de filtre | `...` | local | **`layoutId`** (shared pill) | — | Reanimated `layout` / shared transition |
| [DashboardListClient](components/agent/DashboardListClient.tsx) | Liste biens dashboard | `...` | local | `AnimatePresence` (3) | `next/image`, `next/link`, `window.*` | `FlatList` + `expo-image` |
| [MediaUploader](components/agent/MediaUploader.tsx) | Upload Cloudinary signé | `bienId, type, onSuccess, multiple, variant` | local (progress) | non | **`File`, `URL.createObjectURL`, `document.createElement('video')`**, Bearer démo en dur | `expo-image-picker` + `expo-file-system` (voir §9) |
| [PropertyCardAgent](components/agent/PropertyCardAgent.tsx) | Carte bien (agent) | `...` | non | `AnimatePresence` (3) | **`useRouter`**, `next/image`, `next/link` | `Pressable` + `expo-image` |
| [VideoChapterEditor](components/agent/VideoChapterEditor.tsx) | Édition chapitres vidéo | `...` | local | (drag dans le parent modal) | **`window.*` / refs vidéo** | Reanimated + gesture-handler |
| [VideoChapterEditorModal](components/agent/VideoChapterEditorModal.tsx) | Modale éditeur chapitres | `...` | local | `AnimatePresence` (5) | refs vidéo | `@gorhom/bottom-sheet` ou `Modal` |

### 2.3 `components/onboarding/`

| Composant | Rôle | Props clés | État | Framer Motion | Deps browser/Next | Équivalent RN |
|---|---|---|---|---|---|---|
| [AIBriefRecap](components/onboarding/AIBriefRecap.tsx) | Récap final du brief | `brief, onConfirm, ...` | local | `AnimatePresence` (3) | — | `ScrollView` |
| [AIPreparationStep](components/onboarding/AIPreparationStep.tsx) | Écran "préparation IA" (typewriter) | `onReady` | local (typed) | timers (pas de FM lourd) | `setTimeout` | `View` + Reanimated |
| [BienStep](components/onboarding/BienStep.tsx) | Type/pièces/surface | `onNext` | store | non | — | `View` + sliders. Exporte `SURFACE_UNLIMITED` |
| [BudgetFeasibilityMap](components/onboarding/BudgetFeasibilityMap.tsx) | Carte faisabilité budget (Leaflet) | `...` | — | non | **Leaflet** | `react-native-maps`/`expo-maps` |
| [BudgetFeasibilityMapShell](components/onboarding/BudgetFeasibilityMapShell.tsx) | Wrapper carte budget | `...` | local | non | **Leaflet** (dynamique) | idem |
| [BudgetStep](components/onboarding/BudgetStep.tsx) | Étape budget | `onNext` | store | non | — | `View` + slider |
| [ClarificationStep](components/onboarding/ClarificationStep.tsx) | Désambiguïsation localisation | `options, onPick, ...` | non | (aucun FM détecté) | — | `View` |
| [CriteriaStep](components/onboarding/CriteriaStep.tsx) | Chips critères 4-états + ajout libre | `onNext, onFocusChange` | local (input) | `AnimatePresence` (11), `layoutId` (2) | **`document.activeElement`**, input | `TextInput` + Reanimated layout |
| [LocationMapStep](components/onboarding/LocationMapStep.tsx) | Sélection zones sur carte (Leaflet) | `onValidate, onBack, onReady` | local | `AnimatePresence` (5) | **Leaflet via ZoneMap** | `react-native-maps`/`expo-maps` |
| [LocationStep](components/onboarding/LocationStep.tsx) | Saisie localisation + reconnaissance entités | `onOpenMap, onStartMapLoading, onCancelMapLoading, onNeedsClarification` | local | `AnimatePresence` (3) | input | `TextInput` |
| [ZoneMap](components/onboarding/ZoneMap.tsx) | **Carte Leaflet complète** (arr/quartiers/iris/communes, click multi-niveaux, zoom) | `center, zoom, fitBounds, *Ids, on*Click, ...` (~25 props) | local | non | **react-leaflet (DOM, ~800 lignes)** | **Réécriture lourde** : `react-native-maps` + GeoJSON overlays ou MapLibre |

**Composants utilisant `useRouter` (next/navigation)** : BottomNav, ConversationView, AgentBottomNav, PropertyCardAgent (+ la plupart des pages `app/`). → `expo-router` (`useRouter`, `useLocalSearchParams`, `usePathname`).

**Composants accédant directement au DOM** : VideoCard (`getBoundingClientRect`, `HTMLVideoElement`), VideoProgressBar (`HTMLVideoElement`), PropertyDetailSheet (`createPortal`/`document.body`, `window.location`), MediaUploader (`document.createElement`), CriteriaStep (`document.activeElement`), ServiceWorkerRegistrar (`navigator.serviceWorker`).

**Composants utilisant des API d'observation browser** : `app/feed/page.tsx` (2× `IntersectionObserver`), VideoProgressBar (`requestAnimationFrame`).

---

## 3. COUCHE MÉTIER — `lib/`

Verdict : **C** = conservable tel quel côté API (server) · **A** = à adapter pour RN · **D** = à dupliquer/embarquer dans le client RN (pur + JSON, bundlable).

| Fichier | Rôle | Deps Node/browser | Verdict |
|---|---|---|---|
| [lib/prisma.ts](lib/prisma.ts) | Client Prisma (adapter-pg) | **`@prisma/client`, `pg`, `DATABASE_URL`** | **C** (serveur uniquement, jamais bundlé RN) |
| [lib/cloudinary.ts](lib/cloudinary.ts) | Config SDK Cloudinary | **`cloudinary` (Node), secrets env** | **C** (serveur uniquement) |
| [lib/completion.ts](lib/completion.ts) | Calcul `completionRate` d'un bien | type `@prisma/client` (type-only) | **C** (côté API) / pur sinon |
| [lib/format.ts](lib/format.ts) | Helpers de formatage texte | aucune | **D** (pur) |
| [lib/share.ts](lib/share.ts) | Partage natif d'un bien | **`navigator.share`, `navigator.clipboard`, `window.location`** | **A** → `expo-sharing`/`Share` RN |
| [lib/store.ts](lib/store.ts) | Zustand favoris/conversations | **`localStorage`** (persist) | **A** → AsyncStorage (voir §4) |
| [lib/searchStore.ts](lib/searchStore.ts) | Zustand brief de recherche | **`localStorage`** (persist) | **A** → AsyncStorage (voir §4) |
| [lib/types.ts](lib/types.ts) | Types front (`Property`, etc.) | aucune | **D** |
| [lib/mockData.ts](lib/mockData.ts) | Biens statiques de démo | aucune | **D** |
| [lib/hooks/useAutoSave.ts](lib/hooks/useAutoSave.ts) | Auto-save debounce générique | React seul (timers) | **D** (portable tel quel) |
| [lib/auth/bearer.ts](lib/auth/bearer.ts) | Auth Bearer agent | **Prisma** | **C** |
| [lib/serializers/property.ts](lib/serializers/property.ts) | Prisma → view-model | type Prisma | **C** |
| [lib/criteria/parser.ts](lib/criteria/parser.ts) | Free-text → critères (LLM) | **`fetch` Anthropic, `ANTHROPIC_API_KEY`** | **C** (clé secrète → reste serveur) |
| [lib/criteria/tags.ts](lib/criteria/tags.ts) | Tags → critères | aucune | **D** |
| [lib/criteria/types.ts](lib/criteria/types.ts) | Types critères | aucune | **D** |
| [lib/matching/engine.ts](lib/matching/engine.ts) | **Moteur de matching déterministe** (pur) | aucune | **D** (cœur, embarquable client) |
| [lib/matching/buyerBriefBuilder.ts](lib/matching/buyerBriefBuilder.ts) | BuyerProfile → brief | type Prisma | **C** (mapping serveur) |
| [lib/matching/propertyProfileBuilder.ts](lib/matching/propertyProfileBuilder.ts) | Property → profile | type Prisma | **C** |
| [lib/matching/semantic-map.ts](lib/matching/semantic-map.ts) | Carte sémantique critères | aucune (présumé) | **D** |
| [lib/matching/types.ts](lib/matching/types.ts) | Types matching | aucune | **D** |
| [lib/parsing/spatialIntentParser.ts](lib/parsing/spatialIntentParser.ts) | Parseur spatial déterministe (entre/côté/proche/sauf) | aucune | **D** |
| [lib/parsing/spatialIntentToGeoConstraints.ts](lib/parsing/spatialIntentToGeoConstraints.ts) | Intent → GeoConstraints | aucune (présumé) | **D** |
| [lib/parsing/spatialTokens.ts](lib/parsing/spatialTokens.ts) | Tokens spatiaux | aucune | **D** |
| [lib/services/aiBriefInjector.ts](lib/services/aiBriefInjector.ts) | Injecte le brief dans le store (browser) | **`useSearchStore`** + `fetch` interne (`/api/...`) | **A** (logique cliente : remplacer URLs relatives par base API, garder Zustand) |
| [lib/services/geoConstraintService.ts](lib/services/geoConstraintService.ts) | Résolution contraintes géo → IRIS | imports locaux + types (pas de Node) | **D** |
| [lib/services/geoDataService.ts](lib/services/geoDataService.ts) | Charge polygones admin via **`fetch` opendata** + point-in-polygon | `fetch` (universel), GeoJSON | **D** (fetch marche en RN ; cache module-level OK) |
| [lib/services/geocodingService.ts](lib/services/geocodingService.ts) | Géocodage (BAN/Nominatim) | `fetch` | **D** ou **C** (au choix : éviter CORS/quotas → préférer côté API) |
| [lib/services/locationEntityRecognizer.ts](lib/services/locationEntityRecognizer.ts) | Reconnaissance stations/quartiers locale | **imports JSON** (`transportStations`, `semanticNeighborhoods`, `communeNames`) | **D** |
| [lib/services/locationIntentAnalyzerService.ts](lib/services/locationIntentAnalyzerService.ts) | Types + analyse intent localisation | types | **D** |
| [lib/services/locationIntentParser.ts](lib/services/locationIntentParser.ts) | Parse lifestyle/keywords | aucune | **D** |
| [lib/services/metroStationsDb.ts](lib/services/metroStationsDb.ts) | **DB stations métro/RER** | **import JSON** `transportStations.json` (261 KB) + tableau RAW inline (383 lignes) | **D** (bundlable ; ~261 KB → peser pour le poids du bundle iOS) |
| [lib/services/quartierMatchingService.ts](lib/services/quartierMatchingService.ts) | Matching quartiers (normalisation) | **import JSON** `quartiers.json` (49 KB) | **D** |
| [lib/services/semanticNeighborhoodService.ts](lib/services/semanticNeighborhoodService.ts) | Quartiers "vécus" sémantiques | **import JSON** `semanticNeighborhoods.json` (30 KB) | **D** |
| [lib/services/budgetFeasibility.ts](lib/services/budgetFeasibility.ts) | Math faisabilité budget | aucune | **D** |
| [lib/services/irisMarketService.ts](lib/services/irisMarketService.ts) | Prix/m² par IRIS + fallback | **import JSON** `iris_market.json` (sparse) | **D** |
| [lib/services/zoneService.ts](lib/services/zoneService.ts) | Zones (arr/commune/quartier) | aucune (présumé) | **D** |
| [lib/services/videoAnalysisService.ts](lib/services/videoAnalysisService.ts) | Frames Cloudinary + Claude vision | **`@anthropic-ai/sdk`, `cloudinary`** | **C** (serveur strict) |

**Réponse aux points d'attention de l'énoncé :**
- `geoConstraintService`, `quartierMatchingService`, `semanticNeighborhoodService` : **aucun import Node.js** (`fs`/`path`/`os`). Uniquement des imports de modules locaux et de **fichiers JSON** (`@/src/data/*.json`). → **bundlables tels quels dans RN** (Metro gère l'import JSON nativement). Verdict **D**.
- `metroStationsDb` : **fichier JSON externe** `src/data/transportStations.json` (**261 KB**) importé + tableau `RAW` inline (~330 entrées) dont les coords sont écrasées par le JSON au "build time" (en réalité à l'init du module). **Bundlable**, mais c'est le plus gros poste de données embarquées.
- `aiBriefInjector` : dépend de **Zustand** (OK en RN) et de `fetch` vers des **routes relatives `/api/...`** (à remplacer par une base URL configurable). **Aucune dépendance directe au Router Next.js** dans ce fichier (le routing est dans la page).

**Total `lib/`** ≈ 9 800 lignes. La grande majorité (matching, parsing, géo, services data) est **pure + JSON → réutilisable côté client RN ou côté API sans réécriture**.

---

## 4. ÉTAT GLOBAL ZUSTAND

### 4.1 `useShomeeStore` — [lib/store.ts](lib/store.ts)

- **State** : `currentIndex: number`, `favorites: Property[]` (objet complet), `conversations: Conversation[]`.
- **Actions** : `setCurrentIndex`, `addFavorite`, `removeFavorite`, `toggleFavorite`, `isFavorite`, `addMessage`, `markUserMessagesRead`, `markConversationSeen` (+ helper `hasUnread`).
- **Persisté** : **uniquement `favorites`** (`partialize`). `currentIndex` et `conversations` éphémères.
- **Mécanisme** : `persist` + `createJSONStorage(() => localStorage)`, clé `shomee-favorites`.
- **Verdict** : **localStorage → AsyncStorage**. `createJSONStorage(() => AsyncStorage)`. Sinon code inchangé.

### 4.2 `useSearchStore` — [lib/searchStore.ts](lib/searchStore.ts)

- **State** (`SearchPreferences`) : `locationQuery/Label/Lat/Lng/Radius`, `locationIntent`, `selectedArrIds/QuartierIds/IrisIds/CommuneIds`, `budgetMin/Max`, `propertyTypes`, `minRooms/maxRooms`, `minBedrooms/maxBedrooms`, `minSurface/maxSurface`, `chipStates: Record<string, ChipState>`, `customCriteria: {id,label,state,polarity}[]`, `onboardingCompleted`.
- **Actions** : ~30 (toggles hiérarchiques arr↔quartier↔iris↔commune, couplage pièces→chambres, cycles de chips 4-états, gestion critères custom, `completeOnboarding`, `resetOnboarding`). Logique métier riche, exporte aussi `buildSelectedCriteria()`.
- **Persisté** : tout le brief **SAUF `onboardingCompleted`** et les champs `location*`/`selected*Ids` (`partialize` ne conserve que budget/types/rooms/bedrooms/surface/chipStates/customCriteria). Clé `shomee-search-v2` (v2 volontaire pour invalider d'anciens payloads bugués).
- **Mécanisme** : `persist` (storage par défaut = `localStorage`).
- **Verdict** : **localStorage → AsyncStorage** (`createJSONStorage(() => AsyncStorage)`). **Attention** : AsyncStorage est **asynchrone** → gérer l'hydratation (`persist` expose `onRehydrateStorage`/`hasHydrated`) pour éviter un flash d'état vide au démarrage (équivalent du commentaire "le feed ne voit pas les réponses d'onboarding sur refresh"). Sinon logique inchangée.

> **Note** : les deux stores stockent l'objet `Property` complet et le brief entier → volumes modérés, compatibles AsyncStorage (limite ~6 MB iOS, largement suffisant).

---

## 5. API ROUTES — CONTRATS D'INTERFACE

Toutes restent **côté Next.js/Vercel** et seront appelées par l'app RN via `fetch` (avec base URL `NEXT_PUBLIC_APP_URL`). Aucune ne dépend d'un contexte Next.js *côté client* : entrées/sorties = JSON pur. Plusieurs forcent `runtime = 'nodejs'` (Prisma/Cloudinary/Anthropic) — **n'impacte pas le client**.

| Route | Méthode | Input | Output | Auth | Commentaire migration |
|---|---|---|---|---|---|
| `/api/properties` | GET `?buyerProfileId=` | query param | `ViewProperty[]` (scoré si profil) | non | OK fetch direct |
| `/api/properties` | POST | `BriefSnapshot` (subset du store) | `ViewProperty[]` (scoré + filtré zones) | non | **Cœur feed** (fallback). Envoie le snapshot Zustand |
| `/api/feed/generate` | POST | `BriefSnapshot` | `ViewProperty[]` (générés Claude Haiku + vidéos) | non | **Cœur feed**. Lit [video-tags.json](src/data/video-tags.json), appelle Claude, matche vidéos Cloudinary. `[]` si tags vides → fallback `/api/properties` |
| `/api/matching/score` | POST | `{ brief, properties[] }` (Zod) | `{ success, data:{ results, excluded_count, total_scored } }` | non | Scoring stateless |
| `/api/matching/score` | GET `?buyerProfileId=` | query | idem | non | Scoring DB |
| `/api/criteria/parse` | POST | `{ raw_text, user_tags[], user_id? }` (Zod) | `{ success, data: UserCriteriaBrief }` | non | Appelle parser LLM |
| `/api/criteria/analyze` | POST | `{ input: string }` | `{ criteria: {label,type}[] }` | non | Claude Haiku (clé serveur) |
| `/api/criteria/update-importance` | PATCH | (à confirmer) | (à confirmer) | non | — |
| `/api/location/analyze` | POST | `{ input: string }` | `LocationIntentAnalysis` (geoConstraints, mapAction, clarification…) | non | Fast-path parseur déterministe, fallback Claude Haiku |
| `/api/location/geocode` | POST | `{ places: {label, poiType?}[] }` | `{ results: GeocodedPlace[] }` | non | Nominatim + Overpass (User-Agent fixe). Externe → quotas |
| `/api/buyer/onboarding-prefill` | POST | `AIOnboardingBrief` (Zod) | `{ success, token, url }` | **Bearer** | Crée magic-link (TTL 24h) |
| `/api/buyer/onboarding-prefill` | GET `?token=` | query | `{ success, brief }` (404/410) | non | Lecture brief par token |
| `/api/biens/[id]` | GET | path id | bien complet | **Bearer** | — |
| `/api/biens/[id]` | PATCH | champs partiels | bien mis à jour | **Bearer** | **Cible auto-save agent** |
| `/api/biens/[id]` | DELETE | path id | — | **Bearer** | — |
| `/api/biens/import-llm` | POST | payload import (24 champs) | bien créé/maj | (vérif interne) | Création via LLM |
| `/api/biens/[id]/analyze-video` | POST | path id | analyse lancée | **Bearer** | Cloudinary + Claude vision |
| `/api/agent/me/properties` | GET | — | biens de l'agent | **Bearer** | Dashboard agent (RN) |
| `/api/agent/me/api-keys` | GET | — | clés API | (vérif) | — |
| `/api/agent/[agentId]/properties` | GET | path | biens publics agent | non | — |
| `/api/upload/sign` | POST | params upload | signature Cloudinary | **Bearer** | **Upload média agent** |
| `/api/upload/confirm` | POST | `{ url, ... }` | bien maj + completionRate | **Bearer** | Post-upload |
| `/api/admin/videos` | GET | — | vidéos | (admin) | Outil web interne |
| `/api/admin/video-tags` | POST | tags | — | (admin) | Outil web interne |

> **Conclusion §5** : tous les contrats sont JSON-only, aucun n'expose de logique « Next.js côté client ». L'app RN peut taper ces endpoints tels quels. **À sécuriser avant prod** : routes acquéreur non authentifiées (feed/generate, properties, location/*, criteria/*, matching/score) — exposition de coûts LLM. Voir §10.

---

## 6. SERVEUR MCP (`shomee-mcp/`)

- **Rôle** : serveur **Model Context Protocol** standalone ([shomee-mcp/src/index.ts](shomee-mcp/src/index.ts)) qui expose 3 outils — `shomee_creer_annonce`, `shomee_lister_biens`, `shomee_get_bien` — à un client MCP **externe** (Claude Desktop, Claude Code). Il appelle l'API SHOMEE via une **clé Bearer agent**.
- **Appelé depuis** : **jamais le navigateur ni l'app**. C'est un process Node lancé par un client MCP tiers, côté poste de l'agent. Dépendances `@modelcontextprotocol/sdk` + `zod@3` (séparées du projet principal).
- **Impact migration mobile** : **aucun direct / indirect uniquement.** Il ne fait pas partie de l'app distribuée. Indirect seulement parce qu'il représente un *canal de création de biens* (l'agent crée des annonces par conversation IA) dont l'app mobile consomme ensuite les données. → **Hors périmètre de la migration RN.** Le laisser tel quel.

---

## 7. TABLE DES DÉPENDANCES (client)

| Package | Rôle | Compatible RN natif | Substitut recommandé | Effort |
|---|---|---|---|---|
| `next` 16.2.4 | Framework + routing + Image/Link/Font/manifest | **Non** | `expo` + `expo-router` (file-based, proche de l'App Router) | **Élevé** |
| `react` / `react-dom` 19.2 | UI | react oui, **react-dom non** | `react` + `react-native` | Moyen |
| `framer-motion` 12 | Animations | **Non** | `react-native-reanimated` + `react-native-gesture-handler` (+ `@gorhom/bottom-sheet` pour les sheets) | **Élevé** (voir §8) |
| `next/navigation` | Routing client | Non | `expo-router` (`useRouter`, `useLocalSearchParams`, `usePathname`) | Moyen |
| `next/image` | Images optimisées | Non | `expo-image` | Faible |
| `next/link` | Navigation | Non | `<Link>` d'expo-router / `router.push` | Faible |
| `next/font/google` (Poppins) | Fonts | Non | `expo-font` + `@expo-google-fonts/poppins` | Faible |
| `leaflet` + `react-leaflet` + `@types/leaflet` | Cartes (DOM) | **Non** | `react-native-maps` (Apple Maps iOS) **ou** `@maplibre/maplibre-react-native` (recommandé pour GeoJSON multi-couches lourds) | **Élevé** (ZoneMap ~800 lignes) |
| `next-cloudinary` | Widget/Image Cloudinary | Non | Upload via signed URL (`expo-file-system`) + `expo-image` pour l'affichage | Moyen |
| `cloudinary` (SDK Node) | Signature serveur | **Serveur only** | **Reste côté API** (ne pas bundler RN) | — |
| `@anthropic-ai/sdk` | Claude (vision) | **Serveur only** | **Reste côté API** | — |
| `@prisma/client` + `@prisma/adapter-pg` + `pg` | DB | **Serveur only** | **Reste côté API** | — |
| `zustand` 5 (+ persist) | État global | **Oui** | `zustand` + `@react-native-async-storage/async-storage` (via `createJSONStorage`) | Faible |
| `zod` 4 | Validation | **Oui** | `zod` (inchangé) | Aucun |
| `clsx` | Classes conditionnelles | Oui (mais pas de className RN) | `clsx` utilisable, ou logique de `style` | Faible |
| `lucide-react` 1.8 | Icônes | **Non** (SVG web) | `lucide-react-native` (+ `react-native-svg`) | Faible |

> **Auth (à ajouter, n'existe pas aujourd'hui)** : `next-auth` n'est **pas** présent. Si une auth est introduite : `expo-auth-session` + `expo-secure-store`, et **Sign in with Apple** obligatoire si un autre social login est ajouté (règle App Store). Voir §10.

> **Styling** : Tailwind 4 (web). En RN → **NativeWind** (Tailwind pour RN) pour réutiliser au mieux les classes existantes, sinon `StyleSheet`.

---

## 8. ANIMATIONS FRAMER MOTION — INVENTAIRE DÉTAILLÉ

Décompte basé sur les occurrences de primitives (`AnimatePresence`, `layoutId`, `drag`, `variants`, `whileTap`, `createPortal`).

| Fichier | Type d'animation | Complexité | Équivalent Reanimated |
|---|---|---|---|
| [components/ActionRail.tsx](components/ActionRail.tsx) | `AnimatePresence` ×3 (toggle like/badges) | Simple | `FadeIn/FadeOut` (Layout Animations) |
| [components/BAIAModal.tsx](components/BAIAModal.tsx) | `AnimatePresence` ×7 (modale, fade/slide) | Moyenne | `Modal` + `withTiming`/entering-exiting |
| [components/SkipFeedbackCard.tsx](components/SkipFeedbackCard.tsx) | `AnimatePresence` ×3 | Simple | entering/exiting |
| [components/SkipFeedbackModal.tsx](components/SkipFeedbackModal.tsx) | `AnimatePresence` ×5 (modale) | Moyenne | `Modal` + Reanimated |
| [components/EndOfFeedCard.tsx](components/EndOfFeedCard.tsx) | `AnimatePresence` ×3 | Simple | entering/exiting |
| [components/ConversationView.tsx](components/ConversationView.tsx) | `AnimatePresence` ×3 (messages) | Simple/Moyenne | `Layout` + `FadeInUp` |
| [components/PropertyDetailSheet.tsx](components/PropertyDetailSheet.tsx) | `AnimatePresence` ×5 + `variants` ×2 + **`createPortal`** | **Complexe** (bottom sheet portée hors arbre) | **`@gorhom/bottom-sheet`** (gestes + snap points natifs) |
| [components/agent/DashboardFilterPills.tsx](components/agent/DashboardFilterPills.tsx) | **`layoutId`** (pill partagée) | Moyenne | `sharedTransitionTag` ou Layout Animations Reanimated |
| [components/agent/PropertyCardAgent.tsx](components/agent/PropertyCardAgent.tsx) | `AnimatePresence` ×3 | Simple | entering/exiting |
| [components/agent/DashboardListClient.tsx](components/agent/DashboardListClient.tsx) | `AnimatePresence` ×3 (liste) | Moyenne (stagger possible) | `Layout` + stagger via délais |
| [components/agent/ArchivesListClient.tsx](components/agent/ArchivesListClient.tsx) | `AnimatePresence` ×3 | Simple | entering/exiting |
| [components/agent/VideoChapterEditorModal.tsx](components/agent/VideoChapterEditorModal.tsx) | `AnimatePresence` ×5 (modale) | Moyenne | `Modal`/bottom-sheet |
| [components/onboarding/AIBriefRecap.tsx](components/onboarding/AIBriefRecap.tsx) | `AnimatePresence` ×3 | Simple | entering/exiting |
| [components/onboarding/CriteriaStep.tsx](components/onboarding/CriteriaStep.tsx) | `AnimatePresence` ×11 + `layoutId` ×2 (chips) | **Complexe** (réorganisation + shared layout des pills) | Layout Animations + `LinearTransition` |
| [components/onboarding/LocationStep.tsx](components/onboarding/LocationStep.tsx) | `AnimatePresence` ×3 | Simple | entering/exiting |
| [components/onboarding/LocationMapStep.tsx](components/onboarding/LocationMapStep.tsx) | `AnimatePresence` ×5 (overlays carte) | Moyenne | entering/exiting + carte native |
| [app/onboarding/page.tsx](app/onboarding/page.tsx) | `AnimatePresence` ×6 + `variants` ×3 (transitions d'étapes + caret typewriter) | **Complexe** (machine d'étapes animée) | `Reanimated` slide transitions + state machine |
| [app/feed/page.tsx](app/feed/page.tsx) | `AnimatePresence` ×5 + `whileTap` ×1 | Moyenne | entering/exiting + `Pressable` scale |
| [app/feed/[id]/page.tsx](app/feed/[id]/page.tsx) | `whileTap` ×3 | Simple | `Pressable` + `withSpring` scale |
| [app/favorites/[id]/page.tsx](app/favorites/[id]/page.tsx) | `AnimatePresence` ×5 + `whileTap` ×2 | Moyenne | entering/exiting + scale |
| [app/assistant/page.tsx](app/assistant/page.tsx) | `AnimatePresence` ×3 | Simple | entering/exiting |
| [app/share/[id]/page.tsx](app/share/[id]/page.tsx) | `AnimatePresence` ×3 | Simple | (page web — peut rester web) |
| [app/agent/biens/nouveau/page.tsx](app/agent/biens/nouveau/page.tsx) | `AnimatePresence` ×3 + `variants` ×1 | Moyenne | entering/exiting + variants |
| [app/agent/biens/[id]/preview/PreviewClient.tsx](app/agent/biens/[id]/preview/PreviewClient.tsx) | `whileTap` ×1 | Simple | `Pressable` |
| [app/agent/biens/[id]/editer/EditBienClient.tsx](app/agent/biens/[id]/editer/EditBienClient.tsx) | `AnimatePresence` ×9 + **`drag` ×17** | **Complexe** (réorg. drag des chapitres/médias) | **`react-native-gesture-handler`** (`PanGestureHandler`) + Reanimated ; liste réordonnable → `react-native-draggable-flatlist` |
| [components/VideoCard.tsx](components/VideoCard.tsx) | CSS keyframes `animate-fade-in-out` (label chapitre) + gestes tap/hold manuels | **Complexe** (gesture-driven) | gesture-handler (tap/long-press) + Reanimated fade |

**Récapitulatif complexité** :
- **Complexe (5)** : PropertyDetailSheet (bottom sheet portal), CriteriaStep (shared-layout chips), onboarding/page (state machine animée), EditBienClient (drag réorg.), VideoCard (gestes lecteur).
- **Moyenne (~9)** : modales, listes avec stagger, layoutId pills, transitions de carte.
- **Simple (~13)** : fades/slides via `AnimatePresence`, `whileTap`.

> Rappel mémoire projet : **toutes les UI doivent garder le niveau d'animation du dashboard** (layoutId pills, AnimatePresence listes, modales animées). À reproduire fidèlement avec Reanimated Layout Animations + `@gorhom/bottom-sheet`.

---

## 9. DÉPENDANCES ENVIRONNEMENT iOS SPÉCIFIQUES

| Fonctionnalité | Usage actuel (web) | Module Expo cible | Permission iOS | Notes |
|---|---|---|---|---|
| **Lecture vidéo** | `<video>` HTML5 dans [VideoCard](components/VideoCard.tsx) : autoplay (fallback muet si bloqué), `loop`, `playsInline`, `preload="metadata"`, `currentTime` (nav. chapitres), `onTimeUpdate`, `onLoadedMetadata` | **`expo-video`** (API `VideoPlayer`, remplace `expo-av` déprécié) | — | Reproduire : autoplay au focus (`isActive`), seek par chapitre, listener de progression pour [VideoProgressBar](components/VideoProgressBar.tsx) |
| **Sonde de durée vidéo (upload)** | `document.createElement('video')` + `URL.createObjectURL` dans [MediaUploader](components/agent/MediaUploader.tsx) (limite 80 s) | `expo-video` (metadata) ou `expo-image-picker` (`duration`) | — | Vérifier la durée avant upload |
| **Caméra / bibliothèque photos** | `<input type=file>` + Cloudinary signé (upload agent) | **`expo-image-picker`** (+ `expo-file-system` pour l'upload) | `NSCameraUsageDescription`, `NSPhotoLibraryUsageDescription` | Vidéo jusqu'à 500 MB, photos 20 MB ; upload direct vers Cloudinary via signature `/api/upload/sign` |
| **Notifications push** | **inexistant aujourd'hui** | `expo-notifications` (+ APNs) | `aps-environment` | À concevoir (messages agent↔acquéreur ?) — voir §10 |
| **Liens profonds (magic link)** | URL web `/onboarding?brief=<uuid>` | **`expo-linking`** + Universal Links (`apple-app-site-association`) + scheme custom | — | **Critique** : le magic-link email doit ouvrir l'app. Configurer associated domains + route `expo-router` `/onboarding` lisant `brief` |
| **Partage natif** | `navigator.share` / `clipboard` dans [share.ts](lib/share.ts) | **`expo-sharing`** / RN `Share` / `expo-clipboard` | — | URL `/share/[id]` |
| **Haptics** | inexistant | `expo-haptics` | — | Bonus (feedback like/skip dans le feed) |
| **PWA / Service Worker** | [sw.js](public/sw.js) (cache-first), [manifest.ts](app/manifest.ts) + `manifest-agent.json` | **N/A** | — | **Supprimer** : remplacé par l'app native. Caching offline → à reconcevoir si besoin |
| **Téléphone** | `window.location.href='tel:'` ([PropertyDetailSheet](components/PropertyDetailSheet.tsx)) | `Linking.openURL('tel:')` | — | Trivial |
| **Carte / géoloc** | Leaflet (pas de géoloc GPS détectée) | `react-native-maps`/MapLibre | `NSLocationWhenInUseUsageDescription` *si* on ajoute le centrage GPS | Pas de géoloc utilisateur aujourd'hui |

---

## 10. RISQUES ET POINTS D'ATTENTION

### 10.1 Architecture à décider AVANT de commencer
1. **Monorepo vs deux repos.** Recommandation : **monorepo** (ex. Turborepo) avec `apps/web` (Next.js actuel, garde les API routes + admin + page `/share`), `apps/mobile` (Expo), et `packages/core` partageant les couches **D** (matching, parsing, géo, types, JSON data). ~9 800 lignes de `lib/` sont majoritairement pures → fort ROI au partage. Le serveur **MCP** reste un package isolé.
2. **Auth.** Il n'y a **aucune auth utilisateur** aujourd'hui (correction §0). Décider : (a) garder le modèle "magic-link + état local" pour l'acquéreur, (b) introduire une vraie auth agent (remplacer la `DEMO_API_KEY` en dur). Si un social login est ajouté, **Sign in with Apple devient obligatoire (App Store Guideline 4.8)**.
3. **Sécurité des routes acquéreur.** `feed/generate`, `properties`, `location/analyze`, `criteria/*`, `matching/score` sont **non authentifiées** et déclenchent des appels Claude payants. En mobile public → risque d'abus/coût. Prévoir rate-limiting / App Attest / clé applicative.

### 10.2 Dépendances SSR / rendu Next.js
- **Server Components** : le dashboard agent et les pages biens chargent des données **directement via Prisma** dans des server components (`app/agent/dashboard/page.tsx`, etc.). En RN il n'y a **pas de SSR** → tout doit passer par des **fetch d'API** (`/api/agent/me/properties`, `/api/biens/[id]`). Certaines de ces routes existent déjà ; vérifier la couverture complète.
- **`app/manifest.ts`, `app/layout.tsx` (metadata/viewport), `next/font`** : concepts web sans équivalent — remplacés par `app.json`/`app.config.ts` Expo, `expo-font`, et la config d'icônes/splash native.
- **`page /share/[id]`** : page de partage **publique web** (OpenGraph). **La garder côté web** (les liens partagés s'ouvrent dans un navigateur), ne pas la porter en natif.

### 10.3 Patterns sans équivalent direct en RN
- **Feed scroll-snap par `IntersectionObserver`** ([feed/page.tsx](app/feed/page.tsx)) : à réécrire avec `FlatList` (`pagingEnabled`, `snapToInterval`, `onViewableItemsChanged`) pour détecter la carte active et piloter le play/pause vidéo. Pattern central — prototyper en premier.
- **`createPortal` → `document.body`** ([PropertyDetailSheet](components/PropertyDetailSheet.tsx)) : pas de portail DOM → `@gorhom/bottom-sheet` (gestion native du z-index/overlay).
- **Lecteur vidéo gesture-driven** ([VideoCard](components/VideoCard.tsx)) : tap gauche/droite = chapitre préc./suiv., appui long = pause. À reconstruire avec `react-native-gesture-handler` (`Tap` + `LongPress`) + seek `expo-video`. Logique de normalisation des chapitres (`fraction`/`startSec`) **réutilisable telle quelle**.
- **Carte multi-couches `ZoneMap`** (~800 lignes Leaflet : arr/quartiers/iris/communes, sélection hiérarchique, zoom→affichage IRIS) : **le plus gros chantier UI**. `react-native-maps` gère mal des centaines de polygones GeoJSON → préférer **MapLibre RN** (style vectoriel + couches). La logique de toggle hiérarchique vit déjà dans `useSearchStore` (réutilisable) ; seul le rendu carte est à refaire.
- **Drag de réorganisation des chapitres** ([EditBienClient](app/agent/biens/[id]/editer/EditBienClient.tsx), 17× `drag`) : `react-native-draggable-flatlist` ou Reanimated + gesture-handler.

### 10.4 Données embarquées (poids du bundle iOS)
- `src/data/` ≈ **460 KB** de JSON. Les couches **D** importent statiquement `transportStations.json` (261 KB), `quartiers.json` (49 KB), `semanticNeighborhoods.json` (30 KB), `iris_codes_insee.json` (55 KB)… Metro les bundlera. **Décider** : embarquer (offline, +taille app) vs servir via API/asset distant (`expo-asset`/CDN). Recommandation : embarquer les petits (matching/recognition), servir les polygones lourds à la demande.
- `geoDataService` charge les **polygones admin via `fetch` opendata** (pas embarqués) → dépendance réseau + latence + risque de quota/CORS. En mobile, **proxifier via une route API** maîtrisée + cache.

### 10.5 Divers
- **Cloudinary upload signé** : flux `sign → upload direct → confirm` reste valable ; remplacer l'`<input file>`/`createObjectURL` par `expo-image-picker` + `expo-file-system`. Retirer la **clé Bearer démo en dur**.
- **`lucide-react` 1.8** : utiliser `lucide-react-native` (vérifier la parité d'icônes pour cette version).
- **Hydratation AsyncStorage asynchrone** : gérer `hasHydrated` sur les deux stores pour éviter un feed/onboarding vide au lancement (le commentaire de `searchStore` le souligne déjà côté web).
- **Tailwind 4** : pas de portage automatique. **NativeWind** maximise la réutilisation des classes ; sinon réécriture `StyleSheet`.
- **`MobileFrame` (cadre 430px)** et **`ServiceWorkerRegistrar`** : à **supprimer** (artefacts purement web).

---

## ANNEXE — Modèles Prisma (référence, restent côté API)

`User`, `BuyerProfile`, `Agency`, `Agent`, `AgentApiKey`, `Property`, `PropertyTag`, `VideoAnalysis`, `Document`, `BuyerBriefToken`
+ enums : `UserRole`, `AgencyPlan`, `MandatType`, `PropertyStatus`, `DpeRating`, `PropertyBadge`, `TagSource`, `VideoAnalysisStatus`, `DocumentType`.

> `User` existe en base mais **n'est lié à aucun flux d'auth client** aujourd'hui — confirme l'absence de login (§0/§1.4).
