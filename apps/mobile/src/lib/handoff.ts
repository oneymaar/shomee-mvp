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
 *   5. POST /api/feed/generate <BriefSnapshot>            → Property[] (noté)
 *   6. useFeedStore.setFeed(feed, <session brief>)
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

// ─── 5. POST feed/generate ──────────────────────────────────────────────────

/**
 * Snapshot exact envoyé à /api/feed/generate — même forme que le corps construit
 * par la PWA (apps/web/app/feed/page.tsx). Les IDs géo sont envoyés à tous les
 * niveaux : le serveur résout l'arrondissement depuis n'importe lequel.
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

// ─── 5b. Génération du feed depuis le store (partagé handoff S6a + funnel S7) ─

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

/**
 * Le serveur qualifie un tableau vide via `x-shomee-empty-reason` :
 *  · `all_excluded` → le moteur a bien produit des biens, le matching les a tous
 *    écartés. C'est un RÉSULTAT, imputable à la recherche → écran d'élargissement.
 *  · `no_catalog` / `no_generation` → catalogue vidéo indisponible, ou génération
 *    LLM muette. Deux pannes serveur : la recherche de l'acquéreur n'y est pour
 *    rien, et lui proposer de l'élargir serait aussi mensonger que de crier à
 *    l'erreur technique quand ses critères sont en cause → écran d'erreur.
 * En-tête absente (build serveur antérieur à cette en-tête) → `empty` : sans
 * information, on parie sur le cas de très loin le plus fréquent plutôt que
 * d'accuser une panne qui n'a probablement pas eu lieu.
 */
function outcomeForEmpty(reason: string | null): FeedOutcome {
  if (reason == null) return 'empty'
  return reason === 'all_excluded' ? 'empty' : 'error'
}

/**
 * Assemble le snapshot du store → POST /api/feed/generate → pose le feed noté
 * (session préfixée `brief:` pour le protéger du refresh générique du feed
 * générique). Utilisé par `runBriefHandoff` (handoff ChatGPT) ET par le récap du
 * funnel manuel natif (S7) : le store est agnostique de la source (token ou
 * wizard), la chaîne de génération est donc strictement la même.
 */
export async function generateFeedFromStore(): Promise<FeedOutcome> {
  let res: Response
  try {
    res = await apiFetch('/api/feed/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSnapshotFromStore()),
    })
  } catch {
    return 'error'
  }
  if (!res.ok) return 'error'

  let feed: unknown
  try {
    feed = await res.json()
  } catch {
    return 'error'
  }
  if (!Array.isArray(feed)) return 'error'
  if (feed.length === 0) return outcomeForEmpty(res.headers.get('x-shomee-empty-reason'))

  useFeedStore.getState().setFeed(feed as Property[], `${BRIEF_FEED_PREFIX}${Date.now()}`)
  return 'ok'
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
