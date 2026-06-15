'use client'

// Mettre à true pour réactiver les noms IRIS sur la carte.
const SHOW_IRIS_DEBUG = false

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { ChevronRight, Loader2, MapPin, AlertCircle } from 'lucide-react'
import { fetchParisGeoData, fetchParisIris, fetchSuburbanCommunes, matchArrondissements, matchCommunes, matchQuartiersByName, getChildQuartiers, polygonContainsPoint, type GeoZone } from '@shomee/core/geo/geoDataService'
import { findStation } from '@shomee/core/geo/metroStationsDb'
import { matchNeighborhood, neighborhoodToConstraints } from '@shomee/core/geo/semanticNeighborhoodService'
import { geocodeBest } from '@/lib/services/geocodingService'
import { parseLocationIntent } from '@shomee/core/geo/locationIntentParser'
import { resolveConstraints, poiRadius } from '@shomee/core/geo/geoConstraintService'
import { useSearchStore } from '@/lib/searchStore'
import { apiFetch } from '@/lib/apiFetch'

const ZoneMap = dynamic(() => import('./ZoneMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-neutral-50">
      <Loader2 size={24} className="text-neutral-300 animate-spin" />
    </div>
  ),
})

const PARIS_CENTER: [number, number] = [48.8566, 2.3522]

/** Compute a [SW, NE] bounding box from an array of GeoZone polygons. */
/**
 * Compute Leaflet fitBounds corners from a set of zones.
 *
 * coverage (default 0.8): fraction of the full extent to show on open.
 *   1.0 = show 100% (all zones fully in view, may dezoom a lot).
 *   0.8 = trim 10% from each side → one zoom level tighter; edge zones
 *         remain reachable by panning.
 *
 * Important: only pass the zones that are actually selected (IRIS, not their
 * parent arrondissement) so the bounds don't include the full arr polygon.
 */
function zonesToBounds(zones: GeoZone[], coverage = 0.8): [[number, number], [number, number]] | null {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  let found = false
  for (const zone of zones) {
    const geom = zone.feature.geometry as GeoJSON.Polygon | GeoJSON.MultiPolygon
    const rings: GeoJSON.Position[][] =
      geom.type === 'Polygon' ? geom.coordinates
      : geom.type === 'MultiPolygon' ? geom.coordinates.flat()
      : []
    for (const ring of rings) {
      for (const pos of ring) {
        const lng = pos[0], lat = pos[1]
        if (!isFinite(lat) || !isFinite(lng)) continue
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        found = true
      }
    }
  }
  if (!found) return null

  if (coverage < 1) {
    const trim = (1 - coverage) / 2
    const dLat = maxLat - minLat
    const dLng = maxLng - minLng
    minLat += dLat * trim;  maxLat -= dLat * trim
    minLng += dLng * trim;  maxLng -= dLng * trim
  }

  return [[minLat, minLng], [maxLat, maxLng]]
}

interface LocationMapStepProps {
  onValidate: () => void
  onBack: () => void
  onReady?: () => void
}

export default function LocationMapStep({ onValidate, onBack, onReady }: LocationMapStepProps) {
  const {
    locationQuery, locationLat, locationLng, locationIntent,
    selectedArrIds, selectedQuartierIds, selectedIrisIds, selectedCommuneIds,
    setLocation, setSelectedArrs, toggleArr, toggleQuartier, toggleIris, toggleCommune, toggleCommuneIris,
  } = useSearchStore()

  const [arrondissements, setArrondissements] = useState<GeoZone[]>([])
  const [quartiers, setQuartiers] = useState<GeoZone[]>([])
  const [iris, setIris] = useState<GeoZone[]>([])
  const [communes, setCommunes] = useState<GeoZone[]>([])
  const [center, setCenter] = useState<[number, number]>(
    locationLat && locationLng ? [locationLat, locationLng] : PARIS_CENTER
  )
  const [zoom, setZoom] = useState(12)
  const [loading, setLoading] = useState(true)
  const [irisLoading, setIrisLoading] = useState(false)
  // Incremented by initMap's hasFineConstraint path to force a fresh loadIris() regardless
  // of zoom state or cached iris. Avoids the setZoom(15) trap when zoom is already 15.
  const [fineLoadTrigger, setFineLoadTrigger] = useState(0)
  const [fitBounds, setFitBounds] = useState<[[number, number], [number, number]] | null>(null)
  const [constraintSummary, setConstraintSummary] = useState<string[]>([])
  // briefDismissed removed — brief tag visibility is now controlled by
  // locationIntent.geoConstraints (stripped on individual removal).
  const [error, setError] = useState<string | null>(null)
  const [locationLabel, setLocationLabel] = useState(
    locationLat && locationLng ? locationQuery : ''
  )
  const initialized = useRef(false)
  const quartiersRef = useRef<GeoZone[]>([])
  // Fully enriched constraints (with geometry/lat/lng) used in the last resolveConstraints call.
  // Required to re-run the resolver when a brief tag is removed individually.
  const enrichedConstraintsRef = useRef<import('@shomee/core/geo/geoConstraintService').GeoConstraint[]>([])
  // Constraints set directly by initMap's hasFineConstraint path.
  // loadIris prefers this over the store to avoid race conditions where the store
  // hasn't been updated yet when the useEffect fires.
  const fineConstraintsRef = useRef<import('@shomee/core/geo/geoConstraintService').GeoConstraint[] | null>(null)
  // Tracks whether onReady has been called (must only fire once, after full map load)
  const onReadyCalledRef = useRef(false)
  // Set true by ZoneMap's whenReady callback — Leaflet instance is alive.
  const [mapInstanceReady, setMapInstanceReady] = useState(false)
  // Set true 2 rAF after `loading` becomes false — gives cascading useEffects time
  // to fire (e.g. loadIris setting irisLoading=true) so the !irisLoading check below
  // doesn't yield a false positive in the brief window between renders.
  const [engineSettled, setEngineSettled] = useState(false)
  quartiersRef.current = quartiers
  const communesRef = useRef<GeoZone[]>([])
  communesRef.current = communes
  const resolutionRunIdRef = useRef(0)

  // Cache geocoded POI data (label → {lat,lng,bbox,geometry,radiusM}).
  // Written by initMap after /api/location/geocode; read by loadIris to enrich
  // constraints without relying on Zustand store timing.
  type PoiGeoData = { lat: number; lng: number; bbox?: [number,number,number,number]; geometry?: GeoJSON.Geometry; radiusM?: number; parentArrIds?: string[] }
  const poiGeocodedRef = useRef<Map<string, PoiGeoData>>(new Map())

  // Snapshot of the engine's initial selection — captured once, used to distinguish
  // engine-origin tags (terracotta) from user-added tags (blue) and for reset.
  const initialStateRef = useRef<{
    arrIds: string[]; quartierIds: string[]; irisIds: string[]; communeIds: string[]
  } | null>(null)

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    initMap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Lazy-load IRIS when user zooms to level 15+ (manual zoom only).
  // Skip when fineLoadTrigger is active — hasFineConstraint path handles it via
  // useEffect([fineLoadTrigger]) with correct constraints from fineConstraintsRef.
  // Running both in parallel would consume fineConstraintsRef in this call,
  // leaving the fineLoadTrigger call with stale store constraints.
  useEffect(() => {
    if (zoom < 15 || irisLoading || iris.length > 0 || fineLoadTrigger > 0) return
    loadIris()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  // Eager-load IRIS when the map is ready and IRIS IDs are already selected
  // but the geometry hasn't been fetched yet (e.g. map opens at low zoom after
  // a fine-grained query, or user navigates back with selections in the store).
  useEffect(() => {
    if (loading || irisLoading || iris.length > 0 || selectedIrisIds.length === 0) return
    loadIris()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, selectedIrisIds.length])

  // Eager-load IRIS for transport_line, directional, and exclusion constraints.
  // Without eager loading, queries like "Paris 12 mais pas Bercy" or
  // "Boulogne sauf Marcel Sembat" would show the full zone until the user
  // manually zoomed to 15 — the exclusion would never be applied.
  //
  // Previously, exclusion constraints (operator:"exclude") inadvertently triggered
  // hasFineConstraint=true which caused setZoom(15). The hasFineConstraint fix
  // removed that side-effect, so we must re-add the explicit trigger here.
  useEffect(() => {
    if (loading || irisLoading || iris.length > 0) return
    const geoC = locationIntent?.geoConstraints ?? []
    const needsIris = geoC.some(c =>
      c.type === 'transport_line' ||
      (c.type === 'administrative_area' && c.direction) ||
      c.operator === 'exclude'
    )
    if (!needsIris) return
    loadIris()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  // Triggered by initMap's hasFineConstraint path via setFineLoadTrigger(t => t + 1).
  // Runs after React has flushed all pending state updates (quartiersRef.current is current),
  // bypassing the iris.length > 0 guard that would block the zoom-based useEffect.
  useEffect(() => {
    if (fineLoadTrigger === 0 || irisLoading) return
    loadIris()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fineLoadTrigger])

  // Mark the engine "settled" two animation frames after initMap finishes.
  // This window lets the cascade of post-loading useEffects fire (notably
  // loadIris setting irisLoading=true) so the `!irisLoading` check in
  // fullMapUiReady doesn't yield a false positive in the inter-render gap.
  useEffect(() => {
    if (loading) {
      setEngineSettled(false)
      return
    }
    let raf2 = 0
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setEngineSettled(true))
    })
    return () => {
      cancelAnimationFrame(raf1)
      if (raf2) cancelAnimationFrame(raf2)
    }
  }, [loading])

  // The page is genuinely ready to be revealed only when:
  //   - Leaflet has initialized (whenReady fired)
  //   - initMap finished (loading=false)
  //   - the engine is settled (post-loading cascade has had a chance to run)
  //   - no IRIS load is in flight
  // No fixed-delay timer: the loader stays up until this composite signal is true.
  const fullMapUiReady = mapInstanceReady && engineSettled && !loading && !irisLoading

  // Fire onReady exactly once when the full UI is ready. Two rAFs let React
  // commit the latest state and Leaflet paint the styled zones before the
  // parent reveals the page.
  useEffect(() => {
    if (!fullMapUiReady) return
    if (onReadyCalledRef.current) return
    onReadyCalledRef.current = true
    const raf1 = requestAnimationFrame(() => {
      requestAnimationFrame(() => onReady?.())
    })
    return () => cancelAnimationFrame(raf1)
  }, [fullMapUiReady, onReady])

  const handleMapInstanceReady = useCallback(() => {
    setMapInstanceReady(true)
  }, [])

  // Capture initial selection state once — first non-empty selection is the engine's output.
  useEffect(() => {
    if (initialStateRef.current !== null) return
    const hasSelection = selectedArrIds.length > 0 || selectedQuartierIds.length > 0 ||
      selectedIrisIds.length > 0 || selectedCommuneIds.length > 0
    if (!hasSelection) return
    initialStateRef.current = {
      arrIds: [...selectedArrIds],
      quartierIds: [...selectedQuartierIds],
      irisIds: [...selectedIrisIds],
      communeIds: [...selectedCommuneIds],
    }
  }, [selectedArrIds, selectedQuartierIds, selectedIrisIds, selectedCommuneIds])

  // Runtime debug — to be removed after fix validation
  useEffect(() => {
    const isPeriphQuery = locationQuery.toLowerCase().includes('periph') || locationQuery.toLowerCase().includes('périph')
    const isParis16Query = locationQuery.toLowerCase().includes('paris 16') || locationQuery.toLowerCase().includes('paris16')

    if (isPeriphQuery && isParis16Query) {
      const nonParis16 = selectedIrisIds.filter(id => !id.includes('75116'))
      const state = {
        locationQuery,
        geoConstraints: locationIntent?.geoConstraints?.map(c => `${c.type}/${c.operator}/${c.zoneId ?? (c as any).neighborhoodId ?? c.label}`),
        selectedIrisIdsCount: selectedIrisIds.length,
        selectedIrisIdsSample: selectedIrisIds.slice(0, 5),
        nonParis16Count: nonParis16.length,
        nonParis16Sample: nonParis16.slice(0, 5),
        selectedArrIds,
        selectedQuartierIds,
        selectedCommuneIds,
      }

      if (nonParis16.length > 0 || selectedIrisIds.length > 40) {
        console.error('🚨 INVARIANT VIOLATED — Paris 16 proche périph has wrong IRIS', state)
      } else if (selectedIrisIds.length > 0) {
        console.log('✅ Paris 16 proche périph — correct state', state)
      }
    }

    // Expose debug state globally for mobile inspection
    if (typeof window !== 'undefined') {
      (window as any).SHOMEE_DEBUG = {
        locationQuery,
        geoConstraints: locationIntent?.geoConstraints,
        selectedIrisIds,
        selectedArrIds,
        selectedQuartierIds,
        selectedCommuneIds,
        timestamp: Date.now(),
      }
    }
  }, [selectedIrisIds, selectedArrIds, selectedQuartierIds, selectedCommuneIds, locationQuery, locationIntent])

  async function loadIris() {
    const myRunId = ++resolutionRunIdRef.current
    setIrisLoading(true)
    try {
      const zones = await fetchParisIris(quartiersRef.current, communesRef.current)
      setIris(zones)

      const { locationIntent: intent, selectedQuartierIds: selQu, selectedCommuneIds: selCom, selectedIrisIds, selectedArrIds } = useSearchStore.getState()

      // ── POI coordinate injection ─────────────────────────────────────────
      // poi constraints may be in the store without coordinates if the initMap
      // geocoding failed or the Zustand update raced with loadIris.
      // Enrich from the ref cache, then geocode server-side for anything still missing.
      //
      // Prefer fineConstraintsRef (set directly by initMap's hasFineConstraint path)
      // over the store to avoid race conditions: the store update from setLocation may
      // not be visible yet when the useEffect fires, but the ref is always up-to-date.
      let resolveConstraintsInput = fineConstraintsRef.current ?? intent?.geoConstraints ?? []
      fineConstraintsRef.current = null  // consume — subsequent loadIris calls fall back to store
      const poiMissing = resolveConstraintsInput.filter(
        c => c.type === 'poi' && !c.lat && !c.bbox && !c.geometry
      )
      if (poiMissing.length > 0) {
        const stillNeedsGeocode = poiMissing.filter(c => !poiGeocodedRef.current.has(c.label))
        if (stillNeedsGeocode.length > 0) {
          try {
            const gr = await apiFetch('/api/location/geocode', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ places: stillNeedsGeocode.map(c => ({ label: c.label, poiType: c.poiType })) }),
            })
            if (gr.ok) {
              const { results } = await gr.json() as {
                results: Array<{ label: string; found: boolean; lat?: number; lng?: number; geometry?: GeoJSON.Geometry | null; bbox?: [number,number,number,number] | null; radius?: number; arrondissements?: string[] }>
              }
              for (const r of results) {
                if (r.found && r.lat !== undefined && r.lng !== undefined) {
                  poiGeocodedRef.current.set(r.label, {
                    lat: r.lat, lng: r.lng,
                    bbox: r.bbox ?? undefined,
                    geometry: r.geometry ?? undefined,
                    radiusM: r.radius,
                    parentArrIds: r.arrondissements,
                  })
                }
              }
            }
          } catch { /* silent fail — resolver will return empty, map shows nothing */ }
        }
        // Apply cached data to constraints
        resolveConstraintsInput = resolveConstraintsInput.map(c => {
          if (c.type !== 'poi' || c.lat || c.bbox || c.geometry) return c
          const data = poiGeocodedRef.current.get(c.label)
          return data ? { ...c, ...data } : c
        })
      }

      // Snapshot enriched constraints for brief-tag individual removal
      enrichedConstraintsRef.current = resolveConstraintsInput

      console.log('[loadIris] runId:', myRunId, 'constraints:', resolveConstraintsInput.map(c => `${c.type}/${c.operator}/${(c as any).zoneId ?? (c as any).neighborhoodId ?? c.label}`))

      // Try geo-constraint intersection first
      if (resolveConstraintsInput.length) {
        const result = resolveConstraints(resolveConstraintsInput, zones, quartiersRef.current, communesRef.current)
        console.log('[loadIris] result:', { wasNarrowed: result.wasNarrowed, irisCount: result.irisIds.length, sample: result.irisIds.slice(0, 5), nonParis16: result.irisIds.filter(id => !id.includes('75116')).length })
        // DEBUG — trace resolution result. Remove after validation.
        const dbgSrc = useSearchStore.getState().locationIntent?.parserSource ?? 'unknown'
        console.group(`🗺️ IRIS RESOLUTION [${dbgSrc}]`)
        console.log('constraints:', resolveConstraintsInput.map(c => `${c.type}/${c.operator}/${c.zoneId ?? c.label}`))
        console.log('wasNarrowed:', result.wasNarrowed, '| irisCount:', result.irisIds.length)
        console.log('summary:', result.matchSummary)
        console.log('finalSelectionSource:', result.wasNarrowed && result.irisIds.length > 0 ? 'geoConstraints' : 'fallback')
        console.groupEnd()
        if (result.wasNarrowed && result.irisIds.length > 0) {
          // Precise IRIS selected: clear any pre-selected arrondissements / quartiers that
          // belong to the narrowed zones so the map shows partial (not full) highlights.
          const narrowedArrIds = new Set(result.fallbackZoneIds.filter((id) => id.startsWith('arr-')))
          const narrowedComIds = new Set(result.fallbackZoneIds.filter((id) => id.startsWith('com-')))
          const { selectedArrIds: curArrs, selectedQuartierIds: curQus, selectedCommuneIds: curComs } = useSearchStore.getState()
          const clearedArrs = curArrs.filter((id) => !narrowedArrIds.has(id))
          const clearedQus = curQus.filter((qId) => {
            const q = quartiersRef.current.find((q) => q.id === qId)
            return !q || !narrowedArrIds.has(q.parentId ?? '')
          })
          // Also clear pre-selected communes (e.g. "Boulogne" in "Boulogne sauf Marcel Sembat")
          // so the map shows partial IRIS rather than the full commune highlight.
          const clearedComs = curComs.filter((id) => !narrowedComIds.has(id))
          if (myRunId !== resolutionRunIdRef.current) {
            console.warn('[geo] later loadIris supersedes this one (runId mismatch) — but still writing since constraints differ', { myRunId, current: resolutionRunIdRef.current })
          }
          useSearchStore.setState({
            selectedIrisIds: result.irisIds,
            selectedArrIds: clearedArrs,
            selectedQuartierIds: clearedQus,
            selectedCommuneIds: clearedComs,
          })
          // The pre-IRIS zone selection was a placeholder. Update the initial state
          // snapshot so the reset button restores to the *narrowed* selection, not
          // the full zone that was pre-selected before IRIS loaded.
          initialStateRef.current = {
            arrIds: clearedArrs,
            quartierIds: clearedQus,
            irisIds: result.irisIds,
            communeIds: clearedComs,
          }
          // Fit the map view to encompass all selected IRIS zones
          const selectedZones = zones.filter(z => result.irisIds.includes(z.id))
          const bounds = zonesToBounds(selectedZones)
          if (bounds) setFitBounds(bounds)
          else if (result.suggestedCenter) setCenter(result.suggestedCenter)
          if (result.matchSummary.length > 0) setConstraintSummary(result.matchSummary)
          return
        }
      }

      // Fallback: propagate existing Paris quartier selections to IRIS
      const toAdd: string[] = []
      if (selQu.length > 0) {
        zones.filter((i) => i.parentId && selQu.includes(i.parentId)).forEach((i) => toAdd.push(i.id))
      }
      // Propagate existing suburb commune selections to IRIS
      if (selCom.length > 0) {
        zones.filter((i) => i.parentId && selCom.includes(i.parentId)).forEach((i) => toAdd.push(i.id))
      }
      if (toAdd.length > 0) {
        useSearchStore.setState({ selectedIrisIds: [...new Set([...selectedIrisIds, ...toAdd])] })
      }
    } catch (e) {
      console.error('IRIS load failed', e)
    } finally {
      setIrisLoading(false)
    }
  }

  async function initMap() {
    setLoading(true)
    setError(null)

    // Always start fresh — any selections in the store belong to a previous query.
    // Without this, initialStateRef would capture stale values and the reset button
    // would restore to an older session's output instead of the current one.
    useSearchStore.setState({
      selectedArrIds: [],
      selectedQuartierIds: [],
      selectedIrisIds: [],
      selectedCommuneIds: [],
    })

    try {
      const intent = locationIntent ?? parseLocationIntent(locationQuery)
      // locationQuery = centerQuery from clarification (or original user query)
      // intent.location_terms = preselectZones from clarification (or parsed terms)
      const geocodeTarget = locationQuery || intent.location_terms[0] || ''

      const [geoData, geocodeResult, communesResult] = await Promise.allSettled([
        fetchParisGeoData(),
        geocodeTarget ? geocodeBest(geocodeTarget) : Promise.resolve(null),
        fetchSuburbanCommunes(),
      ])

      const { arrondissements: arrs, quartiers: qus } = geoData.status === 'fulfilled'
        ? geoData.value
        : { arrondissements: [], quartiers: [] }

      if (!arrs.length) {
        setError('Impossible de charger les données géographiques. Vérifiez votre connexion.')
        setLoading(false)
        return
      }

      setArrondissements(arrs)
      setQuartiers(qus)

      if (communesResult.status === 'fulfilled') {
        setCommunes(communesResult.value)
      }

      // ── Semantic neighborhood enrichment ─────────────────────────────────
      // Match the raw query against semanticNeighborhoods.json before processing
      // the LLM's geoConstraints. If a neighborhood is found, inject its constraints
      // so resolveConstraints can narrow to the relevant IRIS zone (not the full arr).
      //
      // IMPORTANT: skip enrichment for compound queries ("A et B", "A sauf B"…).
      // matchNeighborhood strips spaces before matching, so "bellevilleetmenilmontant"
      // contains "belleville" and returns only Belleville — silently ignoring Ménilmontant.
      // For compound queries the LLM already generates all the necessary constraints;
      // a single-neighborhood override here can only make things worse.
      // Also skip for spatial-relation queries ("proche", "côté", "pres"…) — matchNeighborhood
      // could match a zone token inside the query (e.g. "periph" in "Paris 16 proche périph")
      // and replace the correct [arr-16 inside, zone-periph near] constraints with only zone-periph.
      // Also treat 4+ word queries without any known separator as compound:
      // "Bel air Picpus Daumesnil Dugommier" has no separator but is clearly multi-entity.
      const hasKnownSeparator = /\b(et|ou|sauf|sans|hors|mais|entre|proche|pres|cote|cot[eé]|excent)\b|[,;+\/]|\s+-\s+/i.test(locationQuery.trim())
      const isLongQueryWithoutSeparator = !hasKnownSeparator && locationQuery.trim().split(/\s+/).length >= 4
      const isCompoundLocationQuery = hasKnownSeparator || isLongQueryWithoutSeparator
      const neighborhoodMatch = isCompoundLocationQuery ? null : matchNeighborhood(locationQuery)
      // Normalize any residual "neighborhood" type (LLM sometimes confuses explicitLocations
      // type "neighborhood" with geoConstraints type "semantic_neighborhood").
      let enrichedConstraints = (intent.geoConstraints ?? []).map(c =>
        c.type === ('neighborhood' as typeof c.type) ? { ...c, type: 'semantic_neighborhood' as typeof c.type } : c
      )

      // Skip neighborhood enrichment when:
      // - query starts with a street/way type prefix ("avenue des Ternes" → poi, not Ternes neighborhood)
      // - LLM already returned poi constraints (geometry-based selection must not be overridden)
      const hasStreetTypePrefix = /^(avenue|av\.|rue|boulevard|bd\.|place|pl\.|square|all[eé]e|chemin|impasse|passage|cour|quai|voie|route|promenade|villa|cit[eé]|r[eé]sidence|esplanade|parvis|sentier|ruelle|port|pont)\s+/i.test(locationQuery.trim())
      const hasPoiConstraints = enrichedConstraints.some(c => c.type === 'poi')

      if (neighborhoodMatch && !hasStreetTypePrefix && !hasPoiConstraints) {
        const alreadyHasNeighborhood = enrichedConstraints.some(
          (c) => c.type === 'semantic_neighborhood' || c.type === ('neighborhood' as typeof c.type)
        )
        if (!alreadyHasNeighborhood) {
          // Drop any LLM-provided administrative_area: resolveConstraints will use the
          // no-primary-zone path and scan all loaded IRIS by radius from the neighborhood
          // center. This is the only approach that correctly covers multi-arrondissement
          // neighborhoods (e.g. Le Marais spans Paris 3 + Paris 4).
          enrichedConstraints = [
            ...enrichedConstraints.filter((c) => c.type !== 'administrative_area'),
            ...neighborhoodToConstraints(neighborhoodMatch),
          ]
        }
      }

      // ── Street-prefix override: semantic_neighborhood → poi ──────────────────
      // The LLM may generate semantic_neighborhood for names that are also streets
      // (e.g. "rue des Martyrs" → the neighborhood "rue_des_martyrs" with center+420m radius).
      // A 420m radius around one point covers only ~⅓ of a 1.2km street.
      // When the user typed an explicit street-type prefix, force poi type so the
      // server-side geocoding returns the full bbox/geometry of the street.
      if (hasStreetTypePrefix && !hasPoiConstraints) {
        const hasNeighborhoodOnly = enrichedConstraints.some(c => c.type === 'semantic_neighborhood')
        if (hasNeighborhoodOnly) {
          enrichedConstraints = enrichedConstraints.map(c => {
            if (c.type !== 'semantic_neighborhood') return c
            return {
              ...c,
              type: 'poi' as typeof c.type,
              poiType: 'street',
              label: locationQuery.trim(),
            }
          })
        }
      }

      // ── Geocode excluded transport_stations not in the metro/RER DB ────────────
      // Handles Transilien gares, lesser-known stops (e.g. "gare Clichy-Levallois",
      // "Porte de la Chapelle" if not found). Injects lat/lng so resolveExcludeToIris
      // can use the lat/lng fallback path instead of silently dropping the exclusion.
      const unknownExcludedStations = enrichedConstraints.filter(c =>
        c.operator === 'exclude' &&
        c.type === 'transport_station' &&
        c.lat === undefined &&
        !findStation(c.stationName ?? c.label)
      )
      if (unknownExcludedStations.length > 0) {
        try {
          const gRes = await apiFetch('/api/location/geocode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ places: unknownExcludedStations.map(c => ({ label: c.label, poiType: 'poi' })) }),
          })
          if (gRes.ok) {
            const { results } = await gRes.json() as { results: Array<{ label: string; found: boolean; lat?: number; lng?: number }> }
            enrichedConstraints = enrichedConstraints.map(c => {
              if (c.operator !== 'exclude' || c.type !== 'transport_station') return c
              const r = results.find(res => res.label === c.label)
              if (r?.found && r.lat !== undefined && r.lng !== undefined) return { ...c, lat: r.lat, lng: r.lng }
              return c
            })
          }
        } catch { /* silent — exclusion will log warning at resolve time */ }
      }

      // ── POI geocoding — server-side (Nominatim with full geometry) ───────────
      // Must happen before enrichedIntent is computed so the store gets geometry/coords.
      const poiCs = enrichedConstraints.filter(c => c.type === 'poi' && c.geometry == null && c.lat === undefined)
      if (poiCs.length > 0) {
        try {
          const res = await apiFetch('/api/location/geocode', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ places: poiCs.map(c => ({ label: c.label, poiType: c.poiType })) }),
          })
          if (res.ok) {
            const { results } = await res.json() as {
              results: Array<{ label: string; found: boolean; lat?: number; lng?: number; geometry?: GeoJSON.Geometry | null; bbox?: [number, number, number, number] | null; radius?: number; arrondissements?: string[] }>
            }
            // Populate the ref cache so loadIris can use it even if store update is delayed
            for (const r of results) {
              if (r.found && r.lat !== undefined && r.lng !== undefined) {
                poiGeocodedRef.current.set(r.label, {
                  lat: r.lat, lng: r.lng,
                  bbox: r.bbox ?? undefined,
                  geometry: r.geometry ?? undefined,
                  radiusM: r.radius,
                  parentArrIds: r.arrondissements,
                })
              }
            }
            enrichedConstraints = enrichedConstraints.map(c => {
              if (c.type !== 'poi' || c.geometry != null || c.lat !== undefined) return c
              const data = poiGeocodedRef.current.get(c.label)
              if (data) return { ...c, ...data }
              return c
            })
          }
        } catch { /* silent fail — resolver falls back to no-coord behavior */ }
      }

      const enrichedIntent = { ...intent, geoConstraints: enrichedConstraints }

      // Always persist enrichedIntent so POI geometry/coords reach the store via loadIris
      if (geocodeResult.status === 'fulfilled' && geocodeResult.value) {
        const geo = geocodeResult.value
        // Reject results outside Île-de-France (lat 48.1–49.2, lng 1.4–3.7)
        const inIdf = geo.lat >= 48.1 && geo.lat <= 49.2 && geo.lng >= 1.4 && geo.lng <= 3.7
        if (inIdf) {
          const newCenter: [number, number] = [geo.lat, geo.lng]
          setCenter(newCenter)
          setLocationLabel(geo.label)
          setLocation({ query: locationQuery, label: geo.label, lat: geo.lat, lng: geo.lng, intent: enrichedIntent })
        } else {
          setLocation({ query: locationQuery, label: locationQuery, lat: 0, lng: 0, intent: enrichedIntent })
        }
      } else if (neighborhoodMatch) {
        // No geocoding result but neighborhood matched: center on neighborhood
        setLocation({ query: locationQuery, label: neighborhoodMatch.label, lat: neighborhoodMatch.center.lat, lng: neighborhoodMatch.center.lng, intent: enrichedIntent })
      } else {
        // No geocoding, no neighborhood — still persist enrichedIntent (POI coords/geometry)
        setLocation({ query: locationQuery, label: locationQuery, lat: 0, lng: 0, intent: enrichedIntent })
      }

      // Always center on the neighborhood's exact center (overrides geocoding if needed)
      if (neighborhoodMatch) {
        setCenter([neighborhoodMatch.center.lat, neighborhoodMatch.center.lng])
      }

      // ── Fine constraint detection ─────────────────────────────────────────
      // Station, semantic neighborhood, POI, or between-entities → IRIS zoom, no arr pre-selection.
      // CRITICAL: exclude constraints (operator:"exclude") must NOT trigger hasFineConstraint.
      // An excluded POI like "La Défense" in "Neuilly mais pas côté Défense" would otherwise:
      //   1. set hasFineConstraint=true
      //   2. center the map on La Défense
      //   3. trigger loadIris() before communes are ready → empty insidePool → standalone path
      //   4. select all IRIS near La Défense (Nanterre, Puteaux…) instead of Neuilly IRIS
      const hasFineConstraint = enrichedConstraints.some(
        (c) => c.operator !== 'exclude' &&
               (c.type === 'transport_station' || c.type === 'semantic_neighborhood' || c.type === 'poi') &&
               c.confidence >= 0.75
      ) || enrichedConstraints.some(c => c.operator === 'between')

      if (hasFineConstraint) {
        // Clear any stale zone selections from a previous query so fine IRIS selection
        // starts clean. resolveConstraints (in loadIris) will set selectedIrisIds.
        useSearchStore.setState({
          selectedArrIds: [],
          selectedQuartierIds: [],
          selectedIrisIds: [],
          selectedCommuneIds: [],
        })
        // Also clear stale IRIS geometry — a previous loadIris() call may have populated
        // `iris` before initMap finished loading quartiers, causing getIrisInZone to miss
        // the correct pool and fall through to the standalone path. Clearing iris ensures
        // the useEffect([zoom]) condition (iris.length > 0) never blocks the fresh load.
        setIris([])

        // Center on the INCLUDED station or POI (never on an excluded entity).
        if (!neighborhoodMatch) {
          const stationC = enrichedConstraints.find((c) => c.operator !== 'exclude' && c.type === 'transport_station' && c.stationName)
          const poiC = enrichedConstraints.find(c => c.operator !== 'exclude' && c.type === 'poi' && c.lat !== undefined)
          if (stationC?.stationName) {
            const station = findStation(stationC.stationName)
            if (station) setCenter([station.lat, station.lng])
          } else if (poiC?.lat !== undefined && poiC?.lng !== undefined) {
            setCenter([poiC.lat, poiC.lng])
          }
        }

        // Store enriched constraints directly in the ref so loadIris uses them
        // even if the Zustand store update (setLocation above) hasn't been committed yet.
        fineConstraintsRef.current = enrichedConstraints
        setZoom(15)
        setFineLoadTrigger(t => t + 1) // always triggers loadIris after render, even if zoom was already 15
      } else {
        const loadedCommunes = communesResult.status === 'fulfilled' ? communesResult.value : []

        // Prefer geoConstraints for admin zone selection — they come directly from the LLM
        // and are authoritative. location_terms from preselectQueries is a less reliable
        // fallback (can be incomplete for compound queries like "Paris 11 et Paris 12").
        const adminInsideConstraints = enrichedConstraints.filter(
          c => c.type === 'administrative_area' && c.operator === 'inside' && c.zoneId
        )

        let newArrIds: string[]
        let newQuartierIds: string[]
        let newCommuneIds: string[]

        if (adminInsideConstraints.length > 0) {
          newArrIds = adminInsideConstraints.filter(c => c.zoneId!.startsWith('arr-')).map(c => c.zoneId!)

          // Validate commune zoneIds — the LLM can hallucinate wrong INSEE codes
          // (e.g. "Vincennes" → com-94089 Villeneuve-Saint-Georges instead of com-94080).
          // Keep only IDs that exist in the loaded communes; for the rest, match by label.
          const rawCommIds = adminInsideConstraints.filter(c => c.zoneId!.startsWith('com-'))
          newCommuneIds = rawCommIds
            .map(c => {
              if (loadedCommunes.some(lc => lc.id === c.zoneId)) return c.zoneId!
              // Wrong ID: find the commune by label name
              const matched = matchCommunes([c.label], loadedCommunes)
              return matched.length > 0 ? matched[0].id : null
            })
            .filter((id): id is string => id !== null)
          newQuartierIds = newArrIds.flatMap(id => getChildQuartiers(id, qus).map(q => q.id))
        } else {
          const matchedArrs = matchArrondissements(intent.location_terms, arrs)
          const matchedComms = matchCommunes(intent.location_terms, loadedCommunes)
          newArrIds = matchedArrs.map(z => z.id)
          newQuartierIds = matchedArrs.flatMap(z => getChildQuartiers(z.id, qus).map(q => q.id))
          newCommuneIds = matchedComms.map(z => z.id)
        }

        // Safety net: if term matching failed but we have a station constraint, derive zone
        // from station coordinates (e.g. LLM returned "Vincennes" for "Daumesnil").
        if (newArrIds.length === 0 && newCommuneIds.length === 0 && enrichedConstraints.length) {
          const stationC = enrichedConstraints.find((c) => c.type === 'transport_station' && c.stationName)
          if (stationC?.stationName) {
            const station = findStation(stationC.stationName)
            if (station) {
              const matchedArr = arrs.find((a) => polygonContainsPoint(a.feature.geometry, station.lng, station.lat))
              if (matchedArr) {
                newArrIds = [matchedArr.id]
                newQuartierIds = getChildQuartiers(matchedArr.id, qus).map((q) => q.id)
              } else {
                const loadedC = communesResult.status === 'fulfilled' ? communesResult.value : []
                const matchedComm = loadedC.find((c) => polygonContainsPoint(c.feature.geometry, station.lng, station.lat))
                if (matchedComm) newCommuneIds = [matchedComm.id]
              }
              setCenter([station.lat, station.lng])
            }
          }
        }

        // Quartier administratif name matching — refine to a specific quartier when the
        // raw user query names one (e.g. "Saint-Thomas d'Aquin", "Gros-Caillou", "Épinettes").
        // Search within already-matched arrondissements first; fall back to all Paris quartiers.
        {
          const searchPool = newArrIds.length > 0
            ? qus.filter(q => newArrIds.includes(q.parentId ?? ''))
            : qus
          const matchedQs = matchQuartiersByName(locationQuery, searchPool)
          if (matchedQs.length > 0 && matchedQs.length <= 4) {
            newQuartierIds = matchedQs.map(q => q.id)
            if (newArrIds.length === 0) {
              newArrIds = [...new Set(matchedQs.map(q => q.parentId).filter(Boolean) as string[])]
            }
          }
        }

        const hasQuartierRefinement = newQuartierIds.length > 0 && newQuartierIds.length <= 4
          && newQuartierIds.length < (newArrIds.flatMap(id => getChildQuartiers(id, qus)).length)

        if (newArrIds.length > 0 || newCommuneIds.length > 0) {
          useSearchStore.setState({
            // When refining to specific QAs: don't put the parent arrondissements in
            // selectedArrIds — it would show the ENTIRE arr as 'selected' (dark fill).
            // Instead, leave selectedArrIds empty so computeArrState derives 'partial'
            // from the child QA selection. Works correctly even across multiple arrondissements.
            selectedArrIds: hasQuartierRefinement ? [] : newArrIds,
            selectedQuartierIds: newQuartierIds,
            selectedCommuneIds: newCommuneIds,
          })
          // For quartier-refined selections, fitBounds on the quartier polygons (more specific)
          const quartiersForBounds = qus.filter(z => newQuartierIds.includes(z.id))
          const zonesForBounds = hasQuartierRefinement && quartiersForBounds.length > 0
            ? quartiersForBounds
            : [
              ...arrs.filter(z => newArrIds.includes(z.id)),
              ...loadedCommunes.filter(z => newCommuneIds.includes(z.id)),
            ]
          const bounds = zonesToBounds(zonesForBounds)
          if (bounds) setFitBounds(bounds)
        }

        const matchedCount = newArrIds.length + newCommuneIds.length
        setZoom(hasQuartierRefinement ? 13 : matchedCount <= 2 ? 13 : 12)
      }
    } catch (e) {
      console.error(e)
      setError('Erreur lors du chargement de la carte. Réessayez.')
    } finally {
      setLoading(false)
    }
  }

  const handleClickArr = useCallback((zone: GeoZone) => {
    const childQuartierIds = getChildQuartiers(zone.id, quartiersRef.current).map((q) => q.id)
    const childIrisIds = iris.filter((i) => childQuartierIds.includes(i.parentId ?? '')).map((i) => i.id)
    toggleArr(zone.id, childQuartierIds, childIrisIds)
  }, [iris, toggleArr])

  const handleClickQuartier = useCallback((zone: GeoZone) => {
    if (!zone.parentId) return
    const siblings = getChildQuartiers(zone.parentId, quartiersRef.current).map((q) => q.id)
    const childIrisIds = iris.filter((i) => i.parentId === zone.id).map((i) => i.id)
    toggleQuartier(zone.id, zone.parentId, siblings, childIrisIds)
  }, [iris, toggleQuartier])

  const handleClickIris = useCallback((zone: GeoZone) => {
    if (!zone.parentId) return
    const parentQuartier = quartiersRef.current.find((q) => q.id === zone.parentId)
    if (!parentQuartier || !parentQuartier.parentId) return
    const parentArrId = parentQuartier.parentId
    const allQuartierSiblingIds = iris.filter((i) => i.parentId === zone.parentId).map((i) => i.id)
    const allArrQuartierIds = getChildQuartiers(parentArrId, quartiersRef.current).map((q) => q.id)
    toggleIris(zone.id, zone.parentId, parentArrId, allQuartierSiblingIds, allArrQuartierIds)
  }, [iris, toggleIris])

  const handleClickCommune = useCallback((zone: GeoZone) => {
    toggleCommune(zone.id)
  }, [toggleCommune])

  const handleClickCommuneIris = useCallback((zone: GeoZone) => {
    if (!zone.parentId) return
    const allSiblingIds = iris.filter((i) => i.parentId === zone.parentId).map((i) => i.id)
    toggleCommuneIris(zone.id, zone.parentId, allSiblingIds)
  }, [iris, toggleCommuneIris])

  const handleZoomChange = useCallback((z: number) => {
    setZoom(z)
  }, [])

  // ── Tag removal handlers ──────────────────────────────────────────────────

  const handleRemoveTag = useCallback((tag: { id: string; state: 'full' | 'partial'; zoneType: 'arrondissement' | 'commune' }) => {
    if (tag.zoneType === 'arrondissement') {
      const childQus = getChildQuartiers(tag.id, quartiersRef.current)
      const childQuSet = new Set(childQus.map(q => q.id))
      const childIrisSet = new Set(
        iris.filter(i => !i.parentId?.startsWith('com-') &&
          childQuSet.has(i.parentId ?? '')).map(i => i.id)
      )
      useSearchStore.setState({
        selectedArrIds: selectedArrIds.filter(id => id !== tag.id),
        selectedQuartierIds: selectedQuartierIds.filter(id => !childQuSet.has(id)),
        selectedIrisIds: selectedIrisIds.filter(id => !childIrisSet.has(id)),
      })
    } else {
      // commune (full or partial)
      const comIrisSet = new Set(iris.filter(i => i.parentId === tag.id).map(i => i.id))
      useSearchStore.setState({
        selectedCommuneIds: selectedCommuneIds.filter(id => id !== tag.id),
        selectedIrisIds: selectedIrisIds.filter(id => !comIrisSet.has(id)),
      })
    }
  }, [selectedArrIds, selectedQuartierIds, selectedIrisIds, selectedCommuneIds, iris])

  const handleReset = useCallback(() => {
    const init = initialStateRef.current
    if (!init) return
    useSearchStore.setState({
      selectedArrIds: init.arrIds,
      selectedQuartierIds: init.quartierIds,
      selectedIrisIds: init.irisIds,
      selectedCommuneIds: init.communeIds,
    })
  }, [])

  // ── Brief intent tags (Ligne 1) ───────────────────────────────────────────
  // Derived from geoConstraints: non-administrative constraints = what the engine
  // understood from the user's text (station name, neighborhood, metro line).
  // These are NEVER duplicated in Ligne 2/3 because they represent intent labels,
  // not administrative zone names.

  type BriefTag = { id: string; label: string; icon: 'station' | 'pin'; excluded: boolean }

  const briefTags = useMemo((): BriefTag[] => {
    const geoC = locationIntent?.geoConstraints ?? []
    const nonAdmin = geoC.filter(c => c.type !== 'administrative_area')
    if (nonAdmin.length === 0) return []

    const result: BriefTag[] = []
    const seen = new Set<string>()

    for (const c of nonAdmin) {
      const label =
        c.type === 'transport_station' ? (c.stationName ?? c.label) :
        c.type === 'transport_line'    ? `Ligne ${c.line ?? c.label}` :
        c.label
      if (!label || seen.has(label)) continue
      seen.add(label)
      const isStation = c.type === 'transport_station' || c.type === 'transport_line'
      result.push({ id: `${c.type}_${label}`, label, icon: isStation ? 'station' : 'pin', excluded: c.operator === 'exclude' })
    }
    return result
  }, [locationIntent?.geoConstraints])

  // Returns the display label for a constraint — mirrors the briefTags computation.
  const briefLabelOf = (c: import('@shomee/core/geo/geoConstraintService').GeoConstraint): string =>
    c.type === 'transport_station' ? (c.stationName ?? c.label) :
    c.type === 'transport_line'    ? `Ligne ${c.line ?? c.label}` :
    c.label

  const handleRemoveBrief = useCallback((tag: BriefTag) => {
    // Re-run the resolver without the constraints that produced this brief tag,
    // so only the zones contributed by it are removed — other zones stay intact.
    const remaining = enrichedConstraintsRef.current.filter(c => {
      if (c.type === 'administrative_area') return true
      return `${c.type}_${briefLabelOf(c)}` !== tag.id
    })
    const newIrisIds = remaining.length > 0
      ? resolveConstraints(remaining, iris, quartiersRef.current, communesRef.current).irisIds
      : []

    // Strip the constraint from the store's locationIntent so briefTags recomputes.
    const intent = useSearchStore.getState().locationIntent
    useSearchStore.setState({
      selectedIrisIds: newIrisIds,
      locationIntent: intent ? {
        ...intent,
        geoConstraints: (intent.geoConstraints ?? []).filter(c => {
          if (c.type === 'administrative_area') return true
          return `${c.type}_${briefLabelOf(c)}` !== tag.id
        }),
      } : null,
    })

    enrichedConstraintsRef.current = remaining
    initialStateRef.current = null
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iris])

  // ── Tag computation ───────────────────────────────────────────────────────

  // All administrative zone tags — engine and user additions unified in one terracotta row.
  // No origin distinction needed: the only signal is full (solid) vs partial (dashed).
  type TagItem = { id: string; label: string; state: 'full' | 'partial'; zoneType: 'arrondissement' | 'commune' }

  const allTags = useMemo((): TagItem[] => {
    const result: TagItem[] = []

    for (const arr of arrondissements) {
      const fullSel = selectedArrIds.includes(arr.id)
      const childQus = getChildQuartiers(arr.id, quartiers)
      const hasPartialQu = childQus.some(q => selectedQuartierIds.includes(q.id))
      const hasPartialIris = iris.some(i => {
        if (i.parentId?.startsWith('com-')) return false
        const q = quartiers.find(q => q.id === i.parentId)
        return q?.parentId === arr.id && selectedIrisIds.includes(i.id)
      })
      if (!fullSel && !hasPartialQu && !hasPartialIris) continue
      result.push({ id: arr.id, label: arr.shortName, state: fullSel ? 'full' : 'partial', zoneType: 'arrondissement' })
    }

    for (const com of communes) {
      const fullSel = selectedCommuneIds.includes(com.id)
      const hasPartialIris = iris.some(i => i.parentId === com.id && selectedIrisIds.includes(i.id))
      if (!fullSel && !hasPartialIris) continue
      result.push({ id: com.id, label: com.shortName, state: fullSel ? 'full' : 'partial', zoneType: 'commune' })
    }

    return result
  }, [selectedArrIds, selectedQuartierIds, selectedIrisIds, selectedCommuneIds, iris, arrondissements, communes, quartiers])

  // ── (debug panel supprimé) ───────────────────────────────────────────────

  const snap = initialStateRef.current
  const hasChangedFromInitial = snap !== null && (
    [...selectedArrIds].sort().join() !== [...snap.arrIds].sort().join() ||
    [...selectedQuartierIds].sort().join() !== [...snap.quartierIds].sort().join() ||
    [...selectedIrisIds].sort().join() !== [...snap.irisIds].sort().join() ||
    [...selectedCommuneIds].sort().join() !== [...snap.communeIds].sort().join()
  )

  const canValidate = selectedArrIds.length > 0 || selectedQuartierIds.length > 0 || selectedIrisIds.length > 0 || selectedCommuneIds.length > 0

  return (
    <div className="flex flex-col h-full">
      {/* Top bar — title only, back button removed (parent onboarding has one) */}
      <div
        className="flex-shrink-0 px-4 pb-2"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}
      >
        <h2 className="text-[22px] font-bold text-neutral-900 leading-tight">Sélectionnez vos zones</h2>
        <p className="text-[13px] text-neutral-600 mt-1">
          Touchez pour sélectionner · Zoomez pour affiner
        </p>
      </div>

      {/* Map */}
      <div className="flex-1 mx-4 rounded-2xl overflow-hidden border border-black/8 relative min-h-0">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-neutral-50 gap-3">
            <Loader2 size={28} className="text-neutral-300 animate-spin" />
            <p className="text-[13px] text-neutral-600">Chargement des zones…</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-neutral-50 gap-3 px-6 text-center">
            <AlertCircle size={28} className="text-neutral-300" />
            <p className="text-[13px] text-neutral-500">{error}</p>
            <button
              onClick={initMap}
              className="text-[13px] font-semibold px-4 py-2 rounded-full"
              style={{ backgroundColor: '#A64B27', color: 'white' }}
            >
              Réessayer
            </button>
          </div>
        )}
        {!loading && !error && arrondissements.length > 0 && (
          <ZoneMap
            center={center}
            zoom={zoom}
            fitBounds={fitBounds}
            showIrisNames={SHOW_IRIS_DEBUG}
            arrondissements={arrondissements}
            quartiers={quartiers}
            iris={iris}
            communes={communes}
            selectedArrIds={selectedArrIds}
            selectedQuartierIds={selectedQuartierIds}
            selectedIrisIds={selectedIrisIds}
            selectedCommuneIds={selectedCommuneIds}
            irisLoading={irisLoading}
            onClickArr={handleClickArr}
            onClickQuartier={handleClickQuartier}
            onClickIris={handleClickIris}
            onClickCommune={handleClickCommune}
            onClickCommuneIris={handleClickCommuneIris}
            onZoomChange={handleZoomChange}
            whenMapReady={handleMapInstanceReady}
          />
        )}
      </div>

      {/* Tag system — 3 rows under the map */}
      <div className="flex-shrink-0 px-4 pt-2 min-h-[36px]">
        <AnimatePresence>
          {(briefTags.length > 0 || allTags.length > 0 || hasChangedFromInitial) && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-col gap-1.5"
            >
              {/* Ligne 1 — zones admin concernées (moteur + ajouts manuels, tout en terracotta) */}
              {allTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {allTags.map((tag) => {
                    const isFull = tag.state === 'full'
                    return (
                      <button
                        key={tag.id}
                        onClick={() => handleRemoveTag(tag)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold active:opacity-70 transition-opacity border"
                        style={{
                          backgroundColor: isFull ? 'rgba(166,75,39,0.14)' : 'rgba(166,75,39,0.07)',
                          color: '#A64B27',
                          borderColor: isFull ? '#A64B27' : 'rgba(166,75,39,0.45)',
                          borderStyle: isFull ? 'solid' : 'dashed',
                        }}
                      >
                        {tag.label}
                        {!isFull && <span className="opacity-55 text-[9px]">~</span>}
                        <span className="opacity-40 ml-0.5 text-[11px]">×</span>
                      </button>
                    )
                  })}
                </div>
              )}
              {/* Ligne 2 — brief: station (M) or neighborhood (pin) */}
              {briefTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {briefTags.map((tag) => tag.excluded ? (
                    // Excluded zone — grey, strikethrough, "−" prefix
                    <button
                      key={tag.id}
                      onClick={() => handleRemoveBrief(tag)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold active:opacity-60 transition-opacity border"
                      style={{
                        backgroundColor: 'rgba(0,0,0,0.04)',
                        color: 'rgba(0,0,0,0.38)',
                        borderColor: 'rgba(0,0,0,0.18)',
                        borderStyle: 'dashed',
                      }}
                      title="Zone exclue — cliquer pour retirer l'exclusion"
                    >
                      <span className="font-bold text-[13px] leading-none" style={{ marginTop: -1 }}>−</span>
                      <span style={{ textDecoration: 'line-through' }}>{tag.label}</span>
                      <span className="opacity-40 text-[11px]">×</span>
                    </button>
                  ) : (
                    // Included zone — terracotta
                    <button
                      key={tag.id}
                      onClick={() => handleRemoveBrief(tag)}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold active:opacity-70 transition-opacity border border-[rgba(166,75,39,0.35)]"
                      style={{ backgroundColor: 'rgba(166,75,39,0.1)', color: '#A64B27' }}
                    >
                      {tag.icon === 'station' ? (
                        <span style={{
                          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                          width: 14, height: 14, borderRadius: '50%',
                          border: '1.5px solid currentColor',
                          fontSize: 8, fontWeight: 900, lineHeight: 1, flexShrink: 0,
                        }}>M</span>
                      ) : (
                        <MapPin size={10} className="flex-shrink-0" />
                      )}
                      {tag.label}
                      <span className="opacity-40 text-[11px]">×</span>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Reset button — only visible when user has diverged from engine's initial selection */}
      <AnimatePresence>
        {hasChangedFromInitial && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="flex-shrink-0 px-4 py-0.5"
          >
            <button
              onClick={handleReset}
              className="text-[11px] font-medium text-neutral-600 active:text-neutral-800 transition-colors"
            >
              ↺ Réinitialiser la sélection
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CTAs */}
      <div
        className="px-4 pt-4 flex-shrink-0"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}
      >
        <button
          onClick={onValidate}
          disabled={!canValidate}
          className="w-full py-3.5 rounded-2xl font-semibold text-[15px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
          style={{ backgroundColor: canValidate ? '#A64B27' : '#DB947E', cursor: canValidate ? 'pointer' : 'default' }}
        >
          Valider ma zone
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  )
}
