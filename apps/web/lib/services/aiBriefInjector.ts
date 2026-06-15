/**
 * AI Brief Injector — runs in the browser after the magic-link landing on
 * /onboarding?brief=<uuid> has fetched and validated a brief from the API.
 *
 * Pipeline:
 *   1. POST /api/location/analyze  → LocationIntentAnalysis (LLM/parser)
 *   2. Load arrondissements / quartiers / communes / iris in parallel
 *   3. resolveConstraints(...)     → IRIS ids
 *   4. derive parent arr / quartier / commune from the selected IRIS
 *   5. useSearchStore.setState(...) + addCustomCriteria(...)
 *
 * Non-blocking: when /api/location/analyze fails or returns no constraints
 * the store is still seeded with the brief's preferences and an empty
 * IRIS selection — the recap then shows the location as the raw query and
 * the user can refine the zone manually before launching the search.
 */

import { useSearchStore, type ChipState } from '@/lib/searchStore'
import { SURFACE_UNLIMITED } from '@/components/onboarding/BienStep'
import {
  fetchParisArrondissements,
  fetchParisQuartiers,
  fetchParisIris,
  fetchSuburbanCommunes,
  type GeoZone,
} from '@shomee/core/geo/geoDataService'
import { resolveConstraints, type GeoConstraint } from '@shomee/core/geo/geoConstraintService'
import type { LocationIntentAnalysis } from '@shomee/core/geo/locationIntentAnalyzerService'
import { apiFetch } from '@/lib/apiFetch'

// ─── Brief shape (mirrors the server schema) ───────────────────────────────

export interface AIOnboardingBrief {
  locationQuery: string
  propertyTypes: Array<'appartement' | 'maison' | 'loft' | 'atelier'>
  minRooms: number | null
  maxRooms?: number | null
  minBedrooms?: number | null
  maxBedrooms?: number | null
  minSurface: number
  maxSurface: number | null
  budgetMin: number | null
  budgetMax: number
  chipStates: Record<string, 1 | 2 | 3>
  customCriteria: Array<{ label: string; state: 1 | 2 | 3 }>
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function injectBrief(brief: AIOnboardingBrief): Promise<void> {
  // 1. Analyze location query (LLM/parser) — failures are swallowed so the
  //    user can still see and edit the rest of the brief.
  let analysis: LocationIntentAnalysis | null = null
  try {
    const res = await apiFetch('/api/location/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ input: brief.locationQuery }),
    })
    if (res.ok) analysis = (await res.json()) as LocationIntentAnalysis
  } catch (e) {
    console.warn('[aiBriefInjector] analyze failed:', e)
  }

  // 2 + 3. Resolve geo constraints when present
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
      // arrs is loaded for parity with the rest of the geo flow but
      // parent derivation only needs iris + quartiers.
      void arrs
    } catch (e) {
      console.warn('[aiBriefInjector] resolve failed:', e)
    }
  } else if (analysis?.mapAction?.centerQuery) {
    locationLabel = analysis.mapAction.centerQuery
  }

  // 4. Seed the store atomically. customCriteria is reset to [] here
  //    because addCustomCriteria appends — the brief is authoritative.
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
    // When the brief omits maxSurface, default to the "no upper limit"
    // sentinel so downstream consumers (Budget step, matching engine)
    // treat it as unbounded rather than as "any surface ≥ minSurface".
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

// ─── Helpers ───────────────────────────────────────────────────────────────

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
