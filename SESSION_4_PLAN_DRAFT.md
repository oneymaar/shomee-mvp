# SESSION 4 — FEED ACQUÉREUR MOBILE (FlatList + expo-video) — 🚧 BROUILLON

> **Statut : DRAFT, à retravailler.** Ne pas exécuter tel quel.
> Base : `feat/monorepo`. Rédigé le 2026-06-18.
> Objectif S4 : coquille d'onglets `expo-router` + **prototype du feed vertical** (le pattern central qui dé-risque tout le reste), porté du web vers RN.

## ⏸️ Prérequis avant d'exécuter S4 : valider un **dev build iOS**

Jusqu'au 2026-06-18 le runtime n'avait pu être testé que sur **web SPA**. Désormais **Xcode 26.5 est installé** (simulateurs iOS 26.5 dispo) → le **dev build natif est possible**. Expo Go reste hors-jeu (SDK 56 trop récent pour l'Expo Go public). S4 introduit des comportements **natifs** (`expo-video` autoplay/lecture, `FlatList` `onViewableItemsChanged`, gestes) que le web ne valide que partiellement → il faut juger sur device.

➡️ **Avant de coder S4**, valider le dev build :
- **`expo run:ios`** (build local, recommandé maintenant que Xcode est là) — 1er build long (prebuild config plugins + compilation native), puis itérations rapides via Metro.
- (Alternative : dev build **EAS** cloud si on veut éviter la compilation locale.)

Tant que ce dev build n'est pas validé (l'app se lance sur simulateur, Metro recharge), S4 reste un plan : on ne peut pas juger le feed natif honnêtement.

> Note : `expo run:ios` fait un **prebuild** → génère le dossier natif `ios/` (à gitignorer si on reste en workflow managed/CD, ou à commiter si on bascule en bare). Décision à prendre lors de la validation du dev build.

> ⚠️ Avant tout code : lire les docs versionnées Expo SDK 56 (`docs.expo.dev/versions/v56.0.0/`) — `expo-video`, `Tabs` d'expo-router et `@gorhom/bottom-sheet` ont des APIs qui diffèrent de la mémoire d'entraînement.

---

## Contexte (état réel vérifié)

**Onglets acquéreur** (de `apps/web/components/BottomNav.tsx`, à reproduire en `<Tabs>`) :

| Onglet | Route | Icône lucide | Spécial |
|---|---|---|---|
| Biens | `/feed` | `Home` | le feed (cœur de S4) |
| Favoris | `/favorites` | `Heart` | écran placeholder en S4 → **S5** |
| Messages | `/messages` | `MessageCircle` | **badge** point rouge si `unreadCount>0` (placeholder S4 → S5) |
| Profil | `/profile` | `User` | placeholder S4 |

Couleurs : actif `#A64B27`, inactif `neutral-400`, fond barre `#FDF5F2`, hauteur 60.

**Anatomie du feed web** (`apps/web/app/feed/page.tsx` + composants) :
- **Données** : `feedStore` (transient : `properties`, `currentIndex`, `hasRevealed`) alimenté par `searchStore` (brief) → `POST /api/feed/generate` (sinon `GET /api/properties`, sinon `mockProperties`) → `setFeed`. Survit aux navigations internes.
- **Carte active** : `IntersectionObserver` (seuil 0.6) → `setCurrentIndex` → `VideoCard isActive` → play/pause.
- **`VideoCard`** : `<video loop playsInline>`, play/pause piloté par `isActive`, autoplay-safe (retombe en muet si refus), **hold-to-pause 300 ms**, **tap gauche/droite = nav chapitres**, label de chapitre centré, `VideoProgressBar`, image de fallback, gradient.
- **Surcouches** : `PropertyOverlay` (titre/score/bouton « plus »), `ActionRail` (favori avec fly-heart vers l'onglet Favoris, message → `/messages?bien=id`), `PropertyDetailSheet` (bottom-sheet, ~797 lignes).
- **Chorégraphie** (complexe, web-scroll-spécifique) : séquence `blocked → pre-reveal → revealed`, interstitiels `SkipFeedbackCard`, `EndOfFeedCard`, `BAIAModal`, fly-hearts.

**Stores (S3, faits)** : `@/lib/stores` expose `useShomeeStore`/`useSearchStore`/`useFeedStore` sur AsyncStorage ; `useStoreHydrated` prêt.

**Libs natives** — déjà là : `react-native-reanimated`, `react-native-gesture-handler`, `expo-image`. **À installer** (`expo install`) : `expo-video`, `@gorhom/bottom-sheet`, `lucide-react-native`, `react-native-svg`, `expo-linear-gradient`.

**Couche données mobile** : `apiFetch` est agnostique dans core (`createApiFetch({ baseUrl, appToken })`). Le web utilise `baseUrl: ''`. **Le mobile a besoin d'une base URL absolue** (déploiement web) **+ appToken** (config app). ⚠️ Les `videoUrl` de `mockData` sont **relatifs** (`/videos/bien-1.mp4`) → injouables sur device. Le feed live renvoie des URLs **Cloudinary absolues** (OK mobile).

## Ce que cette session N'INCLUT PAS

- **Favoris / Messages complets** → **S5** (écrans placeholder seulement ici).
- **Onboarding / handoff deep-link / `sessionStorage`** → **S6** (le feed mobile lira le brief depuis `searchStore` déjà hydraté ; pas de `sessionStorage`).
- **Cartes** → S7. **Agent/Admin/`/share`** → restent web.
- **Chorégraphie de révélation** (`blocked/pre-reveal/revealed`), **interstitiels** `SkipFeedbackCard`, `EndOfFeedCard`, **BAIA** : **différés** (logique scroll-web très spécifique). S4 = feed vertical *core* qui joue/pause + gestes + overlay + action rail + detail sheet. À rediscuter une fois le pattern FlatList validé.
- **typedRoutes / web `static`** : restent désactivés (dette hoist `expo-router`, cf. `ÉTAT_MIGRATION.md`).

---

## ÉTAPES (à affiner)

### 0 — Dépendances
`expo install expo-video @gorhom/bottom-sheet lucide-react-native react-native-svg expo-linear-gradient` (versions alignées SDK 56, **pas** npm brut). Vérifier le plugin babel reanimated déjà en place (gesture-handler + bottom-sheet en dépendent).

### 1 — Coquille d'onglets + gating hydratation
- `src/app/(tabs)/_layout.tsx` : `<Tabs>` avec les 4 écrans, `tabBarActiveTintColor: '#A64B27'`, inactif `neutral-400`, `tabBarStyle` fond `#FDF5F2`, icônes `lucide-react-native`, `tabBarBadge` sur Messages câblé sur `useShomeeStore` + `hasUnread`.
- `src/app/(tabs)/index.tsx` = **Biens** (le feed). `favorites.tsx` / `messages.tsx` / `profile.tsx` = placeholders.
- `src/app/_layout.tsx` (root) : `GestureHandlerRootView` + `BottomSheetModalProvider` en racine ; **gating `useStoreHydrated`** — tant que `searchStore` n'est pas hydraté, afficher un splash (pas de décision onboarding/feed). **Supprime le smoke screen S3** (`src/app/index.tsx`) — garder les shims `src/lib/stores.ts` / `useStoreHydrated.ts`.

### 2 — Couche données mobile
- `src/lib/apiFetch.ts` : `createApiFetch({ baseUrl: <URL absolue>, appToken: <token> })`. Base URL + token via `expo-constants` (`app.json > extra`) ou env EAS — **jamais en dur**.
- Hook/util `useFeedData` : reprend la logique de `feed/page.tsx` — (a) feed déjà en mémoire → affichage immédiat ; (b) sinon fetch `POST /api/feed/generate` depuis le snapshot `searchStore`, fallback `GET /api/properties` puis `mockProperties` ; pose dans `useFeedStore.setFeed`. **Sans `sessionStorage`** (handoff = S6).

### 3 — `VideoCard` RN (le morceau le plus technique)
Port de `VideoCard.tsx` :

| Web | RN |
|---|---|
| `<video>` | `expo-video` (`useVideoPlayer`, `<VideoView>`) ; `player.loop=true`, play/pause selon `isActive` |
| autoplay-safe muet | `player.muted` + try/catch play |
| hold-to-pause 300 ms | `Gesture.LongPress()` (react-native-gesture-handler) |
| tap gauche/droite chapitres | `Gesture.Tap()` + `x` relatif → `player.currentTime = startSec` |
| `VideoProgressBar` | barre custom (reanimated, abonnée à `player.currentTime`/`duration`) |
| image fallback | `expo-image` |
| gradient | `expo-linear-gradient` |
| label chapitre centré | `<Text>` + fade reanimated |

Réutiliser tel quel : `normalizedChapters`/`fractionalChapters` (logique pure, déplaçable en util core si partagé).

### 4 — Feed `FlatList` (remplace observer + scroll-snap)
- `<FlatList data={feedItems}>` vertical, `pagingEnabled`, `snapToInterval={height}`, `decelerationRate="fast"`, `showsVerticalScrollIndicator={false}`, `windowSize`/`removeClippedSubviews` réglés.
- **Carte active** : `onViewableItemsChanged` + `viewabilityConfig` (`itemVisiblePercentThreshold: 60`) → `setCurrentIndex` → `VideoCard isActive`. (Remplace l'`IntersectionObserver`.)
- Chaque item = hauteur plein écran (`useWindowDimensions` ; gérer les safe-areas).
- Mute global (bouton flottant) comme web.

### 5 — Surcouches
- `PropertyOverlay` RN (titre, sous-titre, score, bouton « plus » → ouvre la sheet).
- `ActionRail` RN (favori → `useShomeeStore.toggleFavorite` ; bouton message → `router.push('/messages?bien=id')`). Fly-heart : **différer** l'animation inter-éléments (complexe) ; au minimum le toggle + burst local.
- `PropertyDetailSheet` → `@gorhom/bottom-sheet` (`BottomSheetModal`) : titre, prix, surface, DPE, chapitres, favori, message. Port du contenu (~797 lignes) en plusieurs passes — viser d'abord les champs clés.

### 6 — Placeholders
`favorites.tsx` / `messages.tsx` / `profile.tsx` : écrans minimaux (« Bientôt — S5 ») lisant un compteur du store pour prouver le câblage. Détail bien `feed/[id]` : stub ou via la sheet.

---

## Contraintes
- **Zéro régression web** (PWA intacte ; ne toucher qu'à `apps/mobile` + éventuels utils core *purs* partagés).
- `expo install` (versions SDK 56), pas npm brut. typedRoutes restent off, web `single`.
- Base URL + appToken mobile **jamais en dur** (config/env).
- Lire les docs Expo SDK 56 versionnées avant chaque lib.

## Critères de succès (provisoires)
- [ ] **Dev build iOS validé** (prérequis) — feed jugeable sur device.
- [ ] `expo start` (dev build/web) démarre, la barre d'onglets s'affiche (4 onglets, couleurs, badge Messages).
- [ ] Splash tant que non hydraté, puis Biens.
- [ ] Feed vertical **paginé** : swipe haut/bas, **une seule vidéo joue** (l'active), les autres en pause/rembobinées.
- [ ] Hold = pause ; tap gauche/droite = nav chapitres ; progress bar avance.
- [ ] Overlay (titre/score) + action rail (favori togglé, persiste — vérif via store) + ouverture de la detail sheet.
- [ ] Favori ajouté depuis le feed visible dans le placeholder Favoris (compteur).
- [ ] Web non régressé : `turbo build --filter=@shomee/web` vert. `turbo type-check` vert.
- [ ] Données : feed live (Cloudinary) si base URL+token configurés ; sinon repli documenté (mock injouable sur device → bundler une vidéo d'exemple ou pointer une URL absolue de test).

## Notes migration / risques
- **`mockData` videoUrl relatifs** → sur web pointent vers `apps/mobile` (404). Pour un vrai test vidéo : configurer la base URL live, **ou** bundler 1–2 vidéos d'exemple dans `assets/`.
- **Base URL + appToken** : c'est aussi le moment où le token applicatif S2 entre en jeu côté mobile (`createApiFetch({ appToken })`). Statique/extractible → App Attest en S9.
- **Chorégraphie différée** : si le feed tronqué/reveal est jugé indispensable tôt, la re-spécifier en S4-bis une fois le FlatList de base validé.
- **`onViewableItemsChanged`** se comporte différemment web vs natif → re-valider sur le dev build dès qu'il existe.

---

## À retravailler (TODO sur ce brouillon)
- Trancher : feed **live** (config base URL + appToken) **vs** vidéos d'exemple bundlées pour le 1er proto.
- Garder ou couper la **chorégraphie de révélation** dès S4.
- Découper `PropertyDetailSheet` (gros) : quels champs en S4, quels champs en S5.
- Confirmer le chemin **dev build** (Xcode local vs EAS) avant de figer les critères runtime.
