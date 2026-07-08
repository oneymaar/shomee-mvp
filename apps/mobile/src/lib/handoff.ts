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
import type { ChipState } from '@shomee/core/stores/searchStore'
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

  // 5. Génération du feed noté à partir du snapshot du store.
  let feed: Property[]
  try {
    feed = await generatePersonalizedFeed(buildSnapshotFromStore())
  } catch {
    return { status: 'error' }
  }
  if (!Array.isArray(feed) || feed.length === 0) return { status: 'error' }

  // 6. Pose du feed personnalisé (session préfixée → protégé du refresh générique).
  useFeedStore.getState().setFeed(feed, `${BRIEF_FEED_PREFIX}${Date.now()}`)
  return { status: 'success' }
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
  // 2. Analyse de la zone (LLM/parser côté serveur). Échec avalé → le reste du
  //    brief est quand même injecté (l'utilisateur voit ses critères/budget).
  let analysis: LocationIntentAnalysis | null = null
  try {
    const res = await apiFetch('/api/location/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: brief.locationQuery }),
    })
    if (res.ok) analysis = (await res.json()) as LocationIntentAnalysis
  } catch {
    // analyze indispo → feed par critères, sans contrainte géo.
  }

  // 3. Résolution des contraintes géo en identifiants de zones (iris → parents).
  let irisIds: string[] = []
  let arrIds: string[] = []
  let quartierIds: string[] = []
  let communeIds: string[] = []
  let locationLabel = brief.locationQuery

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

  // 4. Seed atomique du store (mêmes champs que injectBrief). customCriteria est
  //    remis à [] ici car addCustomCriteria ajoute — le brief fait autorité.
  useSearchStore.setState({
    locationQuery: brief.locationQuery,
    locationLabel,
    locationLat: null,
    locationLng: null,
    locationIntent: analysis
      ? {
          location_terms: analysis.explicitLocations?.map((l) => l.label) ?? [],
          lifestyle_terms: [],
          transport_constraints: [],
          confidence: 1,
          geoConstraints: analysis.geoConstraints,
          resolutionStrategy: analysis.resolutionStrategy,
        }
      : null,
    selectedArrIds: arrIds,
    selectedQuartierIds: quartierIds,
    selectedIrisIds: irisIds,
    selectedCommuneIds: communeIds,
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

async function generatePersonalizedFeed(
  snapshot: ReturnType<typeof buildSnapshotFromStore>,
): Promise<Property[]> {
  const res = await apiFetch('/api/feed/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as Property[]
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
