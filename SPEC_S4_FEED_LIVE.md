# SPEC — S4 · Feed live (chemin sans-brief)

> Architecte → validé par Olivier → exécuté par Claude Code → testé sur simulateur.
> Branche `feat/monorepo`. **Aucun merge prod.**
> Décisions actées : périmètre **sans-brief uniquement** · token via **app.config.js
> + env** (hors git) · bypass Vercel via **`extraHeaders` générique** (core agnostique).

## Objectif (1 phrase)

Remplacer le seed statique (4 biens bundlés) par le **catalogue live** via
`GET /api/properties`, en réutilisant `createApiFetch` de core + le token
applicatif — sans loader, la seed masquant l'attente.

## Périmètre

- ✅ **Chemin sans-brief** : `GET /api/properties` (feed chronologique réel).
- ❌ **Hors-scope** `POST /api/feed/generate` + brief + MatchBadge → **S6** (après
  onboarding). Raison : rien ne peuple le `searchStore` sur mobile aujourd'hui →
  `hasBrief` toujours `false`, le chemin brief serait dormant/non-testable.
- ❌ Hors-scope : nav tap-chapitres (le Race de VideoCard est prêt, les données
  `chapters` arriveront — mais la nav est une passe UI séparée), fly-heart,
  onglets Photos/Plan/Visite, galerie, carte quartier.

## Résultat attendu (device)

1. Ouverture onglet Biens → **seed instantanée** (inchangé, zéro loader).
2. En arrière-plan, `apiFetch('/api/properties')` → si le catalogue diffère de la
   seed **ET** `currentIndex === 0`, le feed est remplacé par les vrais biens (sans
   arracher l'utilisateur qui aurait déjà scrollé).
3. Biens live → vraie agence, vrais équipements, `chapters` réels (données seules),
   DetailSheet peuplée depuis la base (composition/marché/quartier/DPE-GES **si les
   colonnes sont remplies**).
4. **MatchBadge reste masquée** (pas de brief → pas de matchScore) — conforme.

## ⚠️ DEUX couches d'auth (découvert au Step 0 — curl)

Le preview de branche n'est pas seulement gardé par le token applicatif : la
**Vercel Deployment Protection** (SSO) intercepte **avant** le code de l'app
(`GET /api/properties` sans rien → `302 → vercel.com/sso-api`). Il faut traverser
les deux :

| Couche | Rôle | Header mobile |
|---|---|---|
| Vercel Deployment Protection | preview privé du monde | `x-vercel-protection-bypass` (secret « Protection Bypass for Automation ») |
| Garde applicatif `requireAppTokenOrTrustedOrigin` | seul mon app appelle l'API | `x-shomee-app-token` |

Traversée **stateless** (headers à chaque requête, pas de `set-bypass-cookie`).
Curl de traversée déjà **validé** (200 avec bypass + token).

- Sans bypass → `302 SSO`. Sans token → `401`. Les deux → `200`.
- Le nom `x-vercel-protection-bypass` vit **uniquement côté mobile** — core reste
  agnostique (config générique `extraHeaders`, précédence
  `extraHeaders < init.headers < appToken`).

## Le pipe est déjà complet côté serveur (0 modif backend)

- `requireAppTokenOrTrustedOrigin` ([appToken.ts](apps/web/lib/auth/appToken.ts))
  compare `x-shomee-app-token` timing-safe vs `SHOMEE_APP_TOKEN`. Mobile n'a pas
  d'Origin navigateur → **il doit envoyer le token**.
- `toViewProperty` ([serializers/property.ts](apps/web/lib/serializers/property.ts))
  mappe **tous** les champs enrichis (composition, dpe/ges, transports,
  nearbyPlaces, neighborhoodVibe, iris*, market*, mapLat/Lng, chapters…) → la seed
  enrichie à la main reflète exactement ces champs → **pas de régression code**.

---

## PRÉREQUIS (Step 0 — à valider AVANT test device)

1. **`SHOMEE_APP_TOKEN`** défini sur le scope **Preview** du projet Vercel (celui
   qui sert l'alias `shomee-mvp-git-feat-monorepo-oneymaars-projects.vercel.app`).
   Récupérer la valeur → `apps/mobile/.env` sous `EXPO_PUBLIC_SHOMEE_APP_TOKEN`.
2. **Secret « Protection Bypass for Automation »** (Vercel → Settings → Deployment
   Protection) → `apps/mobile/.env` sous `EXPO_PUBLIC_VERCEL_BYPASS_TOKEN`.
3. Alias joignable — ⚠️ **cold-start Postgres ~38s** au 1er hit : la seed couvre
   l'attente, **ne pas** ajouter de loader.

---

## SOUS-ÉTAPES TESTABLES

### A — Config & primitive réseau — ✅ FAIT (code)

Fichiers modifiés/créés :
- ✅ `packages/core/src/utils/apiFetch.ts` — `ApiFetchConfig` gagne
  `extraHeaders?: Record<string,string>` (générique, core agnostique).
  Précédence `extraHeaders < init.headers < appToken`. Web inchangé (n'utilise pas
  `extraHeaders`). **type-check core + web verts.**
- ⚠️ `apps/mobile/app.config.js` — **vestigial mais conservé** (jamais commité).
  Était censé exposer les secrets via `extra`, mais `extra` ne remonte pas au
  runtime (SDK 56) → remplacé par `process.env.EXPO_PUBLIC_*` dans `api.ts`.
  Suppression tentée puis **reverted** (frayeur splash = artefact hot-reload, PAS
  le cleanup). `app.json` seul couvre le natif (vérifié `expo config`) → re-suppression
  sûre à faire avec un vrai cold launch.
- ✅ `apps/mobile/.env.example` (commité, sans valeur) + `.env` (gitignoré).
  Négation `!.env.example` ajoutée à `apps/mobile/.gitignore` (le root ignore
  `.env*`). Vérifié : `.env.example` traçable, `.env` ignoré.
- ✅ `apps/mobile/src/lib/api.ts` — `apiFetch = createApiFetch({ baseUrl, appToken,
  extraHeaders })`. Le header Vercel n'est câblé **que si** bypass présent.
  ⚠️ **Secrets lus en direct via `process.env.EXPO_PUBLIC_*`** (inline Metro fiable),
  **PAS** via `Constants.expoConfig.extra` (reste vide au runtime SDK 56 → symptôme
  trompeur `200 + HTML`, fetch relatif résolu contre le serveur Metro). Du coup
  `app.config.js` est **vestigial** (conservé pour l'instant, cf. étape A).

**Env (nom unique partout)** : `EXPO_PUBLIC_API_BASE_URL`,
`EXPO_PUBLIC_SHOMEE_APP_TOKEN`, `EXPO_PUBLIC_VERCEL_BYPASS_TOKEN`.

**Build** : changement JS/config only (expo-constants déjà dépendance) →
**restart Metro** (`expo start -c`), **pas de prebuild**.

**Test A (device — reste à faire, dépend du Step 0)** : log/bouton debug appelant
`apiFetch('/api/properties')` → `200` + N biens = deux couches traversées ✅ ;
`302` = bypass manquant ; `401` = token manquant.

### B — Loader du feed sans-brief — ✅ FAIT (code)

`GET /api/properties` renvoie un **tableau nu** de biens PUBLISHED (validé curl :
219 biens). Le loader lit ce tableau nu (`Array.isArray(live)` / `live.length`),
**pas** une enveloppe objet. Bloc TEST A retiré.

**Fichier :** `apps/mobile/src/app/(tabs)/index.tsx` — `useEffect` combiné
(miroir de `apps/web/app/feed/page.tsx`, branche c.1) :

```ts
useEffect(() => {
  let cancelled = false

  // 1) seed instantané (inchangé)
  if (!useFeedStore.getState().hasFeed()) {
    useFeedStore.getState().setFeed(SEED, String(Date.now()))
  }

  // 2) refresh live best-effort — remplace seulement si le catalogue a changé
  //    ET que l'utilisateur n'a pas encore scrollé.
  apiFetch('/api/properties')
    .then((r) => (r.ok ? r.json() : null))
    .then((live: Property[] | null) => {
      if (cancelled || !Array.isArray(live) || live.length === 0) return
      const seedIds = SEED.map((p) => p.id).join(',')
      const liveIds = live.slice(0, SEED.length).map((p) => p.id).join(',')
      if (liveIds === seedIds) return                        // catalogue inchangé
      if (useFeedStore.getState().currentIndex !== 0) return // ne pas arracher
      useFeedStore.getState().setFeed(live, String(Date.now()))
    })
    .catch(() => {}) // best-effort : la seed reste affichée

  return () => { cancelled = true }
}, [])
```

Détails :
- Import `apiFetch` depuis `@/lib/api`.
- `String(Date.now())` = sessionId (déjà utilisé côté mobile).
- **Aucun loader / écran vide** : la seed couvre l'attente (y compris cold-start).
- Fallback : `/api/properties` échoue/vide → la seed reste. Pas de `mockProperties`.

**Test B (device) :**
- Seed instantanée ; swap vers les vrais biens **si** catalogue base ≠ seed.
- Scroller AVANT la réponse → pas de swap (currentIndex ≠ 0).
- Réseau coupé → la seed reste, pas de crash.

### C — Vérif DetailSheet sur biens live — À FAIRE (garde si nécessaire)

**Fichier :** `apps/mobile/src/components/PropertyDetailSheet.tsx` (fix ciblé
seulement si une section ne se garde pas déjà sur présence de données).

- Ouvrir la DetailSheet sur un bien **live**.
- Chaque section (Composition, Marché, Quartier/Transports, DPE/GES, Équipements)
  doit **se masquer proprement** si la colonne base est vide — pas d'espace vide,
  pas de crash.
- `chapters` réels : vérifier aucune régression visuelle dans VideoCard (le
  tap-chapitres reste **inactif** — hors scope).

**Critère :** aucune section vide affichée, aucun crash, badges DPE/GES corrects.

---

## RISQUES / VIGILANCE

- **Deployment Protection** : sans le secret bypass → `302 SSO`, le garde app
  n'est jamais atteint. Step 0 obligatoire (2 secrets, pas 1).
- **Token/secret env manquant** (scope Preview) → 401/302.
- **DB non peuplée** : colonnes enrichies possiblement NULL → sections sheet
  masquées sur live. **Pas une régression code**, c'est l'état des données.
- **Cold-start Postgres ~38s** : 1er hit lent → la seed masque l'attente.
- **Secrets dans le binaire** : token app + bypass shippés (dette actée, App Attest
  → S9). Évités **en plus** dans git (`.env` gitignoré).

## DEFINITION OF DONE

- [x] `createApiFetch` étendu (`extraHeaders`) — type-check core + web verts.
- [x] `app.config.js` / `.env.example` / `api.ts` créés, `.gitignore` réglé.
- [x] Traversée auth validée (curl `200` + 219 biens, bypass + token). Env serveur
      sain : `DATABASE_URL` + `SHOMEE_APP_TOKEN` sur Preview (feat/monorepo).
- [x] Loader sans-brief (étape B) codé : lit un tableau nu, seed préservée, swap
      live si catalogue ≠ seed ET `currentIndex === 0`. type-check `index.tsx` OK.
- [x] **Device validé** : Biens → seed instant → `swap EFFECTUÉ → 219 biens` (log
      confirmé). Fix secrets = `process.env`. DIAG retirés, loader propre, tc vert.
- [ ] DetailSheet ne régresse pas sur biens live (étape C).
- [ ] Commit sur `feat/monorepo` (pas de merge prod, pas de `vercel --prod`).

## APRÈS (rappel séquencement)

Feed live sans-brief = dernier gros morceau **testable** de S4. Le chemin brief
(`/api/feed/generate`, MatchBadge, chapitres nav) attend l'onboarding porté en
**S6**. Voir POINT DE REPRISE pour Sessions 5-9.
