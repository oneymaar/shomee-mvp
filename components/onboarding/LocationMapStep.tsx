'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { ArrowLeft, CheckCircle, Loader2, MapPin, AlertCircle } from 'lucide-react'
import { fetchParisGeoData, fetchParisIris, fetchSuburbanCommunes, matchArrondissements, matchCommunes, matchQuartiersByName, getChildQuartiers, polygonContainsPoint, type GeoZone } from '@/lib/services/geoDataService'
import { findStation } from '@/lib/services/metroStationsDb'
import { matchNeighborhood, neighborhoodToConstraints } from '@/lib/services/semanticNeighborhoodService'
import { geocodeBest } from '@/lib/services/geocodingService'
import { parseLocationIntent } from '@/lib/services/locationIntentParser'
import { resolveConstraints, poiRadius } from '@/lib/services/geoConstraintService'
import { useSearchStore } from '@/lib/searchStore'

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
function zonesToBounds(zones: GeoZone[]): [[number, number], [number, number]] | null {
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
  return found ? [[minLat, minLng], [maxLat, maxLng]] : null
}

interface LocationMapStepProps {
  onValidate: () => void
  onBack: () => void
}

export default function LocationMapStep({ onValidate, onBack }: LocationMapStepProps) {
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
  const [fitBounds, setFitBounds] = useState<[[number, number], [number, number]] | null>(null)
  const [constraintSummary, setConstraintSummary] = useState<string[]>([])
  const [briefDismissed, setBriefDismissed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locationLabel, setLocationLabel] = useState(
    locationLat && locationLng ? locationQuery : ''
  )
  const initialized = useRef(false)
  const quartiersRef = useRef<GeoZone[]>([])
  quartiersRef.current = quartiers
  const communesRef = useRef<GeoZone[]>([])
  communesRef.current = communes

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

  // Lazy-load IRIS when user zooms to level 15+
  useEffect(() => {
    if (zoom < 15 || irisLoading || iris.length > 0) return
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

  // Eager-load IRIS for transport_line and directional constraints.
  // "Paris 11 proche ligne 1" and "Paris 16 nord" both require IRIS to produce
  // the correct partial selection — without eager loading the full arrondissement
  // would appear selected until the user manually zoomed to 15.
  useEffect(() => {
    if (loading || irisLoading || iris.length > 0) return
    const geoC = locationIntent?.geoConstraints ?? []
    const needsIris = geoC.some(c =>
      c.type === 'transport_line' ||
      (c.type === 'administrative_area' && c.direction)
    )
    if (!needsIris) return
    loadIris()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

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

  async function loadIris() {
    setIrisLoading(true)
    try {
      const zones = await fetchParisIris(quartiersRef.current, communesRef.current)
      setIris(zones)

      const { locationIntent: intent, selectedQuartierIds: selQu, selectedCommuneIds: selCom, selectedIrisIds, selectedArrIds } = useSearchStore.getState()

      // ── POI coordinate injection ─────────────────────────────────────────
      // poi constraints may be in the store without coordinates if the initMap
      // geocoding failed or the Zustand update raced with loadIris.
      // Enrich from the ref cache, then geocode server-side for anything still missing.
      let resolveConstraintsInput = intent?.geoConstraints ?? []
      const poiMissing = resolveConstraintsInput.filter(
        c => c.type === 'poi' && !c.lat && !c.bbox && !c.geometry
      )
      if (poiMissing.length > 0) {
        const stillNeedsGeocode = poiMissing.filter(c => !poiGeocodedRef.current.has(c.label))
        if (stillNeedsGeocode.length > 0) {
          try {
            const gr = await fetch('/api/location/geocode', {
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

      // Try geo-constraint intersection first
      if (resolveConstraintsInput.length) {
        const result = resolveConstraints(resolveConstraintsInput, zones, quartiersRef.current, communesRef.current)
        if (result.wasNarrowed && result.irisIds.length > 0) {
          // Precise IRIS selected: clear any pre-selected arrondissements / quartiers that
          // belong to the narrowed zones so the map shows partial (not full) highlights.
          const narrowedArrIds = new Set(result.fallbackZoneIds.filter((id) => id.startsWith('arr-')))
          const { selectedArrIds: curArrs, selectedQuartierIds: curQus } = useSearchStore.getState()
          const clearedArrs = curArrs.filter((id) => !narrowedArrIds.has(id))
          const clearedQus = curQus.filter((qId) => {
            const q = quartiersRef.current.find((q) => q.id === qId)
            return !q || !narrowedArrIds.has(q.parentId ?? '')
          })
          useSearchStore.setState({
            selectedIrisIds: result.irisIds,
            selectedArrIds: clearedArrs,
            selectedQuartierIds: clearedQus,
          })
          // The pre-IRIS arr selection was a placeholder. Update the initial state
          // snapshot so the reset button restores to the *narrowed* selection, not
          // the full arrondissement that was pre-selected before IRIS loaded.
          const { selectedCommuneIds: curComs } = useSearchStore.getState()
          initialStateRef.current = {
            arrIds: clearedArrs,
            quartierIds: clearedQus,
            irisIds: result.irisIds,
            communeIds: [...curComs],
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
      const neighborhoodMatch = matchNeighborhood(locationQuery)
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

      // ── POI geocoding — server-side (Nominatim with full geometry) ───────────
      // Must happen before enrichedIntent is computed so the store gets geometry/coords.
      const poiCs = enrichedConstraints.filter(c => c.type === 'poi' && c.geometry == null && c.lat === undefined)
      if (poiCs.length > 0) {
        try {
          const res = await fetch('/api/location/geocode', {
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
      // Station, semantic neighborhood, POI, or between-entities → IRIS zoom, no arr pre-selection
      const hasFineConstraint = enrichedConstraints.some(
        (c) => (c.type === 'transport_station' || c.type === 'semantic_neighborhood' || c.type === 'poi') && c.confidence >= 0.75
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

        // Center on station or POI when no neighborhood matched
        if (!neighborhoodMatch) {
          const stationC = enrichedConstraints.find((c) => c.type === 'transport_station' && c.stationName)
          const poiC = enrichedConstraints.find(c => c.type === 'poi' && c.lat !== undefined)
          if (stationC?.stationName) {
            const station = findStation(stationC.stationName)
            if (station) setCenter([station.lat, station.lng])
          } else if (poiC?.lat !== undefined && poiC?.lng !== undefined) {
            setCenter([poiC.lat, poiC.lng])
          }
        }

        setZoom(15) // triggers loadIris via useEffect([zoom])
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
          newCommuneIds = adminInsideConstraints.filter(c => c.zoneId!.startsWith('com-')).map(c => c.zoneId!)
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

  type BriefTag = { id: string; label: string; icon: 'station' | 'pin' }

  const briefTags = useMemo((): BriefTag[] => {
    // Hidden once the user explicitly dismissed the brief, even if new selections appear
    if (briefDismissed) return []
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
      result.push({ id: `${c.type}_${label}`, label, icon: isStation ? 'station' : 'pin' })
    }
    return result
  }, [briefDismissed, locationIntent?.geoConstraints])

  const handleRemoveBrief = useCallback(() => {
    // Mark brief as dismissed (prevents re-appearance if user later adds zones manually)
    setBriefDismissed(true)
    initialStateRef.current = null
    useSearchStore.setState({ selectedArrIds: [], selectedQuartierIds: [], selectedIrisIds: [], selectedCommuneIds: [] })
  }, [])

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
        <h3 className="text-[20px] font-bold text-neutral-900 leading-tight">Sélectionnez vos zones</h3>
        <p className="text-[13px] text-neutral-400 mt-1">
          Touchez pour sélectionner · Zoomez pour affiner
        </p>
      </div>

      {/* Map */}
      <div className="flex-1 mx-4 rounded-2xl overflow-hidden border border-black/8 relative min-h-0">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-neutral-50 gap-3">
            <Loader2 size={28} className="text-neutral-300 animate-spin" />
            <p className="text-[13px] text-neutral-400">Chargement des zones…</p>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-neutral-50 gap-3 px-6 text-center">
            <AlertCircle size={28} className="text-neutral-300" />
            <p className="text-[13px] text-neutral-500">{error}</p>
            <button
              onClick={initMap}
              className="text-[13px] font-semibold px-4 py-2 rounded-full"
              style={{ backgroundColor: '#914E3C', color: 'white' }}
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
            showIrisNames={true}
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
          />
        )}
      </div>

      {/* IRIS sélectionnés — panel debug temporaire */}
      <div className="flex-shrink-0 px-4 pt-1 min-h-[18px]">
        {selectedIrisIds.length > 0 && iris.length > 0 && (() => {
          const names = iris.filter(z => selectedIrisIds.includes(z.id)).map(z => z.shortName).join(', ')
          return (
            <div className="flex items-start gap-2">
              <p className="text-[10px] font-mono text-neutral-400 leading-snug flex-1 select-all">{names}</p>
              <button
                onClick={() => navigator.clipboard.writeText(names)}
                className="text-[9px] font-medium text-neutral-400 active:text-neutral-700 flex-shrink-0 mt-0.5"
              >
                copier
              </button>
            </div>
          )
        })()}
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
              {/* Ligne 1 — brief initial: station (M) or neighborhood (pin) */}
              {briefTags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {briefTags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={handleRemoveBrief}
                      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold active:opacity-70 transition-opacity border border-[rgba(145,78,60,0.35)]"
                      style={{ backgroundColor: 'rgba(145,78,60,0.1)', color: '#914E3C' }}
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
              {/* Ligne 2 — zones admin concernées (moteur + ajouts manuels, tout en terracotta) */}
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
                          backgroundColor: isFull ? 'rgba(145,78,60,0.14)' : 'rgba(145,78,60,0.07)',
                          color: '#914E3C',
                          borderColor: isFull ? '#914E3C' : 'rgba(145,78,60,0.45)',
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
              className="text-[11px] font-medium text-neutral-400 active:text-neutral-600 transition-colors"
            >
              ↺ Réinitialiser la sélection
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* CTAs */}
      <div
        className="px-4 pt-2 flex flex-col gap-2 flex-shrink-0"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 20px)' }}
      >
        <button
          onClick={onValidate}
          disabled={!canValidate}
          className="w-full py-3.5 rounded-2xl font-semibold text-[15px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
          style={{ backgroundColor: canValidate ? '#914E3C' : '#D4A89A', cursor: canValidate ? 'pointer' : 'default' }}
        >
          <CheckCircle size={17} />
          Valider ma zone
          {canValidate && (
            <span className="bg-white/20 text-[12px] px-2 py-0.5 rounded-full">
              {allTags.length}
            </span>
          )}
        </button>
        <button
          onClick={onValidate}
          className="w-full py-2 text-[13px] font-medium text-neutral-400 active:text-neutral-600"
        >
          Continuer sans sélectionner
        </button>
      </div>
    </div>
  )
}
