/**
 * Native deep-link handoff — consomme un brief de magic link (token) et produit
 * un feed personnalisé NOTÉ in-app, en réutilisant le contrat serveur web TEL
 * QUEL (aucune modif côté web).
 *
 * La chaîne réplique fidèlement ce que la PWA fait côté client
 * (`aiBriefInjector.injectBrief` + `feed/page.tsx`, NON modifiés — répliqués
 * ici avec les instances natives des stores + le `apiFetch` mobile) :
 *
 *   1. GET  /api/buyer/onboarding-prefill?token=<TOKEN>   → AIOnboardingBrief
 *   2. POST /api/location/analyze { input: locationQuery } → geoConstraints
 *   3. résolution géo (core geoDataService + geoConstraintService) → iris/arr/…
 *   4. seed useSearchStore   (parité : les filtres du funnel reflètent le brief)
 *   5. POST /api/properties  <BriefSnapshot + withLanes> → { main, discovery }
 *   6. useFeedStore.setFeed(main, <session brief>)
 *
 * Dégradation gracieuse (comme le web) : un échec analyze/géo laisse quand même
 * un feed personnalisé par critères/budget/surface (IRIS vides), et seuls les
 * échecs (1) / (5) remontent une erreur à l'écran d'onboarding.
 */

import {
  fetchParisArrondissements,
  fetchParisQuartiers,
  fetchParisIris,
  fetchSuburbanCommunes,
  type GeoZone,
} from '@shomee/core/geo/geoDataService'
import { resolveConstraints, type GeoConstraint } from '@shomee/core/geo/geoConstraintService'
import type { LocationIntentAnalysis } from '@shomee/core/geo/locationIntentAnalyzerService'
import type { Property } from '@shomee/core/types/domain'
import type { ChipState, LocationIntent } from '@shomee/core/stores/searchStore'
import { diagnoseShape } from '@shomee/core/stores/feedStore'
import { useSearchStore, useFeedStore } from '@/lib/stores'
import { apiFetch } from '@/lib/api'

// Sentinelle « pas de plafond de surface » — miroir de SURFACE_UNLIMITED
// (apps/web/components/onboarding/BienStep.tsx). Le web envoie 999 quand le
// brief omet maxSurface ; on fait pareil pour une parité stricte du snapshot.
const SURFACE_UNLIMITED = 999

/**
 * Préfixe d'identifiant de session posé sur un feed issu d'un brief. Le feed
 * Biens ((tabs)/index.tsx) s'en sert pour NE PAS écraser un feed personnalisé
 * par le rafraîchissement générique /api/properties.
 */
export const BRIEF_FEED_PREFIX = 'brief:'

// ─── Brief (miroir du schéma serveur, onboarding-prefill/route.ts) ──────────

export interface AIOnboardingBrief {
  locationQuery: string
  propertyTypes: ('appartement' | 'maison' | 'loft' | 'atelier')[]
  minRooms: number | null
  maxRooms?: number | null
  minBedrooms?: number | null
  maxBedrooms?: number | null
  minSurface: number
  maxSurface: number | null
  budgetMin: number | null
  budgetMax: number
  chipStates: Record<string, 1 | 2 | 3>
  customCriteria: { label: string; state: 1 | 2 | 3 }[]
}

export type HandoffOutcome =
  | { status: 'success' }
  | { status: 'not_found' }
  | { status: 'expired' }
  /** Brief valide, moteur OK, mais aucun bien ne satisfait la recherche. */
  | { status: 'empty' }
  | { status: 'error' }

// ─── Orchestrateur ──────────────────────────────────────────────────────────

/**
 * Point d'entrée : token → feed personnalisé posé dans useFeedStore.
 * Ne touche PAS au feedStore en cas d'échec (l'app retombe sur le feed
 * générique via le chemin normal de (tabs)/index.tsx).
 */
export async function runBriefHandoff(token: string): Promise<HandoffOutcome> {
  // 1. Récupération du brief (token). 404 / 410 → écran d'erreur dédié.
  const fetched = await fetchBrief(token)
  if (fetched.status !== 'ok') return { status: fetched.status }

  // 2 → 4. Réplique de injectBrief : analyze + résolution géo + seed du store.
  //         Best-effort ; les échecs internes sont avalés (feed par critères).
  await injectBriefNative(fetched.brief)

  // 5 → 6. Génération + pose du feed personnalisé noté (session préfixée →
  //        protégé du refresh générique). Chaîne factorisée (partagée avec le
  //        funnel manuel S7). Le vide remonte tel quel : un brief trop étroit
  //        n'est pas une panne et ne doit pas afficher le même écran.
  const outcome = await generateFeedFromStore()
  if (outcome === 'ok') return { status: 'success' }
  return { status: outcome === 'empty' ? 'empty' : 'error' }
}

// ─── 1. GET onboarding-prefill ──────────────────────────────────────────────

type FetchBriefResult =
  | { status: 'ok'; brief: AIOnboardingBrief }
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'error' }

async function fetchBrief(token: string): Promise<FetchBriefResult> {
  try {
    const res = await apiFetch(
      `/api/buyer/onboarding-prefill?token=${encodeURIComponent(token)}`,
    )
    if (res.status === 404) return { status: 'not_found' }
    if (res.status === 410) return { status: 'expired' }
    if (!res.ok) return { status: 'error' }
    const json = (await res.json()) as { success: boolean; brief?: AIOnboardingBrief }
    if (!json.success || !json.brief) return { status: 'error' }
    return { status: 'ok', brief: json.brief }
  } catch {
    return { status: 'error' }
  }
}

// ─── 2 → 4. injectBrief natif (réplique de aiBriefInjector.injectBrief) ──────

async function injectBriefNative(brief: AIOnboardingBrief): Promise<void> {
  // 2 → 3. Analyse de la zone + résolution des contraintes géo. Factorisé dans
  //        `analyzeAndResolveGeo` (partagé avec l'étape Quartiers du funnel
  //        manuel S7). Dégradation gracieuse identique : tout échec réseau/parse
  //        laisse les listes vides → feed personnalisé par critères/budget.
  const geo = await analyzeAndResolveGeo(brief.locationQuery)

  // 4. Seed atomique du store (mêmes champs que injectBrief). customCriteria est
  //    remis à [] ici car addCustomCriteria ajoute — le brief fait autorité.
  useSearchStore.setState({
    locationQuery: brief.locationQuery,
    locationLabel: geo.locationLabel,
    locationLat: null,
    locationLng: null,
    locationIntent: geo.intent,
    selectedArrIds: geo.arrIds,
    selectedQuartierIds: geo.quartierIds,
    selectedIrisIds: geo.irisIds,
    selectedCommuneIds: geo.communeIds,
    propertyTypes: brief.propertyTypes,
    minRooms: brief.minRooms,
    maxRooms: brief.maxRooms ?? null,
    minBedrooms: brief.minBedrooms ?? null,
    maxBedrooms: brief.maxBedrooms ?? null,
    minSurface: brief.minSurface,
    maxSurface: brief.maxSurface ?? SURFACE_UNLIMITED,
    budgetMin: brief.budgetMin,
    budgetMax: brief.budgetMax,
    chipStates: brief.chipStates as Record<string, ChipState>,
    customCriteria: [],
  })

  if (brief.customCriteria.length > 0) {
    useSearchStore.getState().addCustomCriteria(
      brief.customCriteria.map((c) => ({
        label: c.label,
        state: c.state as ChipState,
      })),
    )
  }
}

// ─── 5. POST /api/properties ────────────────────────────────────────────────

/**
 * Snapshot exact envoyé au moteur — même forme que le corps construit par la PWA
 * (apps/web/app/feed/page.tsx). Les IDs géo sont envoyés à tous les niveaux : le
 * serveur résout l'arrondissement depuis n'importe lequel.
 */
function buildSnapshotFromStore() {
  const s = useSearchStore.getState()
  return {
    minSurface: s.minSurface,
    maxSurface: s.maxSurface,
    budgetMin: s.budgetMin,
    budgetMax: s.budgetMax,
    minRooms: s.minRooms,
    maxRooms: s.maxRooms,
    minBedrooms: s.minBedrooms,
    maxBedrooms: s.maxBedrooms,
    propertyTypes: s.propertyTypes,
    chipStates: s.chipStates,
    customCriteria: s.customCriteria,
    arrondissementIds: s.selectedArrIds,
    communeIds: s.selectedCommuneIds,
    quartierIds: s.selectedQuartierIds,
    irisIds: s.selectedIrisIds,
  }
}

// ─── 5a. Empreinte de recherche (journal persistant, lot 1) ─────────────────

/**
 * JSON à clés triées, récursif — l'ordre d'énumération des objets JS n'est pas
 * un contrat, et deux snapshots identiques doivent produire la même empreinte.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const keys = Object.keys(value as Record<string, unknown>).sort()
  return (
    '{' +
    keys
      .map((k) => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k]))
      .join(',') +
    '}'
  )
}

/** djb2 — court, stable, sans dépendance. Ce n'est pas de la crypto : juste
 *  « la recherche a-t-elle changé depuis que ce journal a été constitué ? ». */
function hashString(input: string): string {
  let h = 5381
  for (let i = 0; i < input.length; i++) {
    h = ((h << 5) + h + input.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

/**
 * Empreinte des critères DÉCLARÉS courants. Posée sur le journal à chaque
 * (re)constitution ; comparée au boot pour savoir si le journal restauré parle
 * encore de la recherche en cours.
 */
export function computeSearchEpoch(): string {
  return hashString(stableStringify(buildSnapshotFromStore()))
}

// ─── 5b. Génération du feed depuis le store (partagé handoff S6a + funnel S7) ─

/**
 * Endpoint unique du feed personnalisé. On interrogeait `/api/feed/generate`,
 * qui ne lisait QUE `src/data/video-tags.json` (26 vidéos taguées à la main) et
 * faisait INVENTER les fiches par un LLM, plafonnées à 4. D'où les trois
 * symptômes du terrain : toujours 4 biens quelle que soit la recherche, des
 * identifiants `gen-<timestamp>` qui changeaient à chaque appel (donc « aucun
 * bien nouveau » indétectable), et un catalogue réel — plus de 1500 biens créés
 * via le Studio TikTok — parfaitement invisible.
 *
 * `/api/properties` accepte exactement le même `BriefSnapshot`, mais interroge
 * la base : filtre géo, `scoreAndProject`, dédoublonnage par vidéo. Les ids sont
 * ceux de la base, donc stables d'un appel à l'autre.
 */
const FEED_ENDPOINT = '/api/properties'

/**
 * Issue de la génération. Le booléen d'avant confondait DEUX situations qui
 * n'ont rien à voir et méritent deux écrans opposés :
 *
 *  · `error` — la requête a échoué (réseau, 4xx/5xx, corps illisible). Rien à
 *    dire à l'acquéreur sur sa recherche : c'est nous. → « Oups, réessayez ».
 *  · `empty` — la requête a RÉUSSI, le moteur n'a simplement retenu aucun bien
 *    (typiquement : un critère rédhibitoire les exclut tous). Ce n'est pas une
 *    panne, c'est un résultat. Afficher « Impossible de préparer votre
 *    sélection » ici accusait l'app d'une décision prise par la recherche.
 *    → écran « aucun bien » + leviers d'élargissement.
 */
export type FeedOutcome = 'ok' | 'empty' | 'error'

/** Champs du snapshot réécrits pour UN appel — cf. `generateDiscoveryFeed`. */
export type BriefSnapshotPatch = Partial<ReturnType<typeof buildSnapshotFromStore>>

/**
 * Les deux voies rendues par `scoreAndProject` :
 *  · `main`      — zéro critère obligatoire en défaut : le bien EST dans le brief ;
 *  · `discovery` — exactement UN obligatoire en défaut, et ce défaut tient dans
 *    une relaxation nommable. Chaque bien porte alors `discoveryDelta`
 *    (« Budget +7 % », « Surface −4 m² »…), qui est précisément la phrase que
 *    l'écran d'annonce de l'étape 2 doit prononcer avant de le montrer.
 */
interface FeedLanes {
  main: Property[]
  discovery: Property[]
}

/**
 * Appel unique du moteur. Rend `null` — et non des voies vides — sur toute
 * panne : l'appelant doit pouvoir distinguer « ça n'a pas répondu » de « il n'y
 * a rien », faute de quoi on affiche un écran d'erreur à un acquéreur dont la
 * recherche est simplement trop étroite (ou l'inverse).
 */
async function postLanes(patch: BriefSnapshotPatch = {}): Promise<FeedLanes | null> {
  let res: Response
  try {
    res = await apiFetch(FEED_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...buildSnapshotFromStore(), ...patch, withLanes: true }),
    })
  } catch {
    return null
  }
  if (!res.ok) return null

  let json: unknown
  try {
    json = await res.json()
  } catch {
    return null
  }

  // Tolérance de version : sans `withLanes`, le serveur répond le tableau nu de
  // la voie principale. Un build antérieur au déploiement de cette bascule doit
  // dégrader en « feed normal, pas de découverte », pas en panne.
  if (Array.isArray(json)) return { main: json as Property[], discovery: [] }
  if (json === null || typeof json !== 'object') return null
  const lanes = json as { main?: unknown; discovery?: unknown }
  if (!Array.isArray(lanes.main)) return null
  return {
    main: lanes.main as Property[],
    discovery: Array.isArray(lanes.discovery) ? (lanes.discovery as Property[]) : [],
  }
}

/**
 * Voie découverte du DERNIER appel, mise de côté ici plutôt que renvoyée : elle
 * ne se consomme pas au moment où elle arrive. L'étape 1 de la doctrine dit que
 * l'acquéreur élargit LUI-MÊME d'abord ; ces biens hors brief n'ont le droit
 * d'apparaître qu'à l'étape 2, si son propre élargissement n'a rien donné. On la
 * garde donc au chaud — un coup d'avance, gratuit puisque le serveur l'a déjà
 * calculée dans la même requête.
 */
let pendingDiscovery: Property[] = []

/**
 * Retire et rend la voie découverte en attente. Retire : un même bien hors brief
 * ne doit pas pouvoir être annoncé deux fois si l'acquéreur repasse par un
 * intercalaire sans que le moteur ait été rappelé entre-temps.
 */
export function takeDiscoveryLane(): Property[] {
  const lane = pendingDiscovery
  pendingDiscovery = []
  return lane
}

/**
 * Assemble le snapshot du store → POST /api/properties → pose le feed noté
 * (session préfixée `brief:` pour le protéger du refresh générique). Utilisé par
 * `runBriefHandoff` (handoff ChatGPT) ET par le récap du funnel manuel natif
 * (S7) : le store est agnostique de la source (token ou wizard), la chaîne de
 * génération est donc strictement la même.
 *
 * `mode` tranche la deuxième plainte du terrain — « ils ne s'ajoutent pas à la
 * suite des premiers, mais comme le résultat d'une nouvelle recherche ; on ne
 * peut plus scroller vers le haut » :
 *  · `replace` — première génération (handoff, fin de funnel). Le feed n'existe
 *    pas encore, il n'y a rien à préserver.
 *  · `append`  — relance depuis un intercalaire. L'acquéreur a DÉJÀ vu des biens
 *    et a le droit de remonter dessus : on ajoute à la suite (le dédoublonnage
 *    par id de `appendFeed` fait le reste) et on ne touche ni au
 *    `feedSessionId`, ni au `currentIndex`.
 */
export async function generateFeedFromStore(
  mode: 'replace' | 'append' = 'replace',
): Promise<FeedOutcome> {
  const lanes = await postLanes()
  if (lanes === null) return 'error'
  pendingDiscovery = lanes.discovery
  if (lanes.main.length === 0) return 'empty'

  const store = useFeedStore.getState()
  if (mode === 'append') store.appendFeed(lanes.main, 'rerun')
  else store.setFeed(lanes.main, `${BRIEF_FEED_PREFIX}${Date.now()}`, 'initial')
  // Chaque (re)constitution re-note le journal : l'empreinte de recherche (le
  // boot saura si le journal restauré parle encore du brief courant) et le
  // diagnostic A/B/C — recalculé sur le compte TOTAL de la requête, pas sur le
  // delta ajouté : une recherche étroite élargie à douze biens DEVIENT calibrée.
  store.setSearchEpoch(computeSearchEpoch())
  store.setShape(diagnoseShape(lanes.main.length))
  return 'ok'
}

/**
 * RÉ-HYDRATATION DU JOURNAL (boot) — fiches fraîches pour des biens que
 * l'acquéreur possède déjà. Mise à jour EN PLACE uniquement : un prix qui a
 * baissé se voit, un bien vendu est marqué périmé et tombera à la PROCHAINE
 * ouverture (`staleIds`) — jamais sous le doigt pendant la lecture.
 *
 * Réservée aux feeds personnalisés (`brief:`) : le feed générique a son propre
 * rafraîchissement, et la seed bundlée n'a rien à hydrater. Best-effort
 * intégral — un échec réseau laisse simplement les fiches du disque, qui
 * étaient déjà affichables.
 */
export async function rehydrateJournal(): Promise<void> {
  const store = useFeedStore.getState()
  if (!store.feedSessionId?.startsWith(BRIEF_FEED_PREFIX)) return
  const ids = store.properties.map((p) => p.id).filter(Boolean)
  if (ids.length === 0) return
  try {
    const res = await apiFetch(FEED_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...buildSnapshotFromStore(), ids }),
    })
    if (!res.ok) return
    const json: unknown = await res.json()
    // GARDE DE VERSION. Un serveur pas encore déployé ignore `ids` et répond le
    // feed normal (tableau nu, ou lanes) : le prendre pour une hydratation
    // marquerait « vendus » tous les biens du journal absents de cette réponse —
    // les biens découverte en premier. Seule l'enveloppe `hydrated: true`,
    // introduite AVEC le paramètre `ids`, prouve que le serveur a compris.
    if (json === null || typeof json !== 'object' || Array.isArray(json)) return
    const wrapped = json as { hydrated?: unknown; properties?: unknown }
    if (wrapped.hydrated !== true || !Array.isArray(wrapped.properties)) return
    useFeedStore.getState().applyFreshProperties(wrapped.properties as Property[])
  } catch {
    /* best-effort */
  }
}

/**
 * Génération « voie découverte » (étape 2) : même moteur, mais interrogé avec un
 * snapshot VOLONTAIREMENT élargi — un critère desserré à la fois — pour aller
 * chercher des biens qui sortent des critères déclarés. Ne sert que de FILET :
 * la voie `discovery` du serveur est consultée d'abord (`takeDiscoveryLane`),
 * elle est plus fine puisqu'elle nomme elle-même le dépassement.
 *
 * Trois différences avec `generateFeedFromStore`, et elles sont toutes des
 * garde-fous :
 *  · le patch est posé sur une COPIE du snapshot, jamais dans `searchStore` —
 *    l'invariant tient : l'implicite ne modifie jamais le déclaratif ;
 *  · aucun `setFeed` — remplacer le feed effacerait les biens que l'acquéreur
 *    vient de demander. L'appelant décide quoi garder et l'AJOUTE (`appendFeed`) ;
 *  · aucune issue d'erreur — cette voie est un bonus qu'on tente APRÈS avoir
 *    échoué à trouver du neuf dans les critères. Une panne ici ne mérite pas un
 *    écran : on rend un tableau vide, l'acquéreur retombe simplement sur
 *    l'intercalaire d'élargissement, exactement comme si on n'avait rien tenté.
 *
 * La voie `discovery` de CET appel est délibérément jetée : elle serait relative
 * au snapshot élargi, pas au brief déclaré, et l'annonce mentirait.
 */
export async function generateDiscoveryFeed(patch: BriefSnapshotPatch): Promise<Property[]> {
  const lanes = await postLanes(patch)
  return lanes?.main ?? []
}

// ─── Résolution géo partagée (handoff S6a + étape Quartiers du funnel S7) ─────

export interface GeoResolution {
  analysis: LocationIntentAnalysis | null
  irisIds: string[]
  arrIds: string[]
  quartierIds: string[]
  communeIds: string[]
  /** Libellé lisible de la zone (matchSummary → centerQuery → requête brute). */
  locationLabel: string
  /** `locationIntent` prêt à poser dans le store (parité web injectBrief). */
  intent: LocationIntent | null
}

/**
 * Cœur de la résolution géographique — NE touche PAS au store. Réplique fidèle
 * de l'ancienne partie géo de `injectBriefNative` (analyze → resolveConstraints
 * → deriveParents), factorisée pour être partagée par le handoff (brief token)
 * ET l'étape Quartiers du funnel manuel (S7). Dégradation gracieuse : tout échec
 * réseau/parse laisse les listes vides (feed personnalisé par critères/budget).
 */
async function analyzeAndResolveGeo(query: string): Promise<GeoResolution> {
  const trimmed = query.trim()

  let analysis: LocationIntentAnalysis | null = null
  try {
    const res = await apiFetch('/api/location/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: trimmed }),
    })
    if (res.ok) analysis = (await res.json()) as LocationIntentAnalysis
  } catch {
    // analyze indispo → feed par critères, sans contrainte géo.
  }

  let irisIds: string[] = []
  let arrIds: string[] = []
  let quartierIds: string[] = []
  let communeIds: string[] = []
  let locationLabel = trimmed

  const constraints: GeoConstraint[] = analysis?.geoConstraints ?? []
  if (constraints.length > 0) {
    try {
      const [arrs, qus, communes] = await Promise.all([
        fetchParisArrondissements(),
        fetchParisQuartiers(),
        fetchSuburbanCommunes(),
      ])
      const iris = await fetchParisIris(qus, communes)
      const result = resolveConstraints(constraints, iris, qus, communes)
      irisIds = result.irisIds
      ;({ arrIds, quartierIds, communeIds } = deriveParents(irisIds, iris, qus))
      if (result.matchSummary.length > 0) {
        locationLabel = result.matchSummary.join(' · ')
      } else if (analysis?.mapAction?.centerQuery) {
        locationLabel = analysis.mapAction.centerQuery
      }
      void arrs // parité avec le flux web (chargé mais non requis ici)
    } catch {
      // Réseau/parse géo KO → IRIS vide ; le feed reste personnalisé par critères.
    }
  } else if (analysis?.mapAction?.centerQuery) {
    locationLabel = analysis.mapAction.centerQuery
  }

  const intent: LocationIntent | null = analysis
    ? {
        location_terms: analysis.explicitLocations?.map((l) => l.label) ?? [],
        lifestyle_terms: [],
        transport_constraints: [],
        confidence: 1,
        geoConstraints: analysis.geoConstraints,
        resolutionStrategy: analysis.resolutionStrategy,
      }
    : null

  return { analysis, irisIds, arrIds, quartierIds, communeIds, locationLabel, intent }
}

export interface GeoResolveOutcome {
  /** true si au moins un IRIS a été résolu (zone exploitable pour le feed). */
  resolved: boolean
  /** Libellé affichable de la zone résolue. */
  label: string
  irisCount: number
}

/**
 * Étape Quartiers du funnel manuel (S7) : résout une requête texte en zones et
 * SEED le store (location + selectedArr/Quartier/Iris/Commune). Même qualité de
 * résolution que le handoff ChatGPT — ils partagent `analyzeAndResolveGeo`.
 * Aucune carte : c'est la décision d'archi actée (texte, pas Leaflet).
 */
export async function resolveGeoFromText(query: string): Promise<GeoResolveOutcome> {
  const geo = await analyzeAndResolveGeo(query)
  useSearchStore.getState().setLocation({
    query: query.trim(),
    label: geo.locationLabel,
    lat: 0,
    lng: 0,
    intent: geo.intent,
  })
  useSearchStore.setState({
    selectedArrIds: geo.arrIds,
    selectedQuartierIds: geo.quartierIds,
    selectedIrisIds: geo.irisIds,
    selectedCommuneIds: geo.communeIds,
  })
  return {
    resolved: geo.irisIds.length > 0,
    label: geo.locationLabel,
    irisCount: geo.irisIds.length,
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Remonte les parents (arrondissement / quartier / commune) d'une liste d'IRIS.
 * Copie du helper web-only de aiBriefInjector (pur, aucune dépendance externe).
 */
function deriveParents(
  irisIds: string[],
  iris: GeoZone[],
  quartiers: GeoZone[],
): { arrIds: string[]; quartierIds: string[]; communeIds: string[] } {
  const irisById = new Map(iris.map((i) => [i.id, i]))
  const quartierById = new Map(quartiers.map((q) => [q.id, q]))
  const arrIds = new Set<string>()
  const quartierIds = new Set<string>()
  const communeIds = new Set<string>()
  for (const id of irisIds) {
    const z = irisById.get(id)
    if (!z?.parentId) continue
    if (z.parentId.startsWith('qu-')) {
      quartierIds.add(z.parentId)
      const q = quartierById.get(z.parentId)
      if (q?.parentId) arrIds.add(q.parentId)
    } else if (z.parentId.startsWith('arr-')) {
      arrIds.add(z.parentId)
    } else if (z.parentId.startsWith('com-')) {
      communeIds.add(z.parentId)
    }
  }
  return {
    arrIds: [...arrIds],
    quartierIds: [...quartierIds],
    communeIds: [...communeIds],
  }
}
