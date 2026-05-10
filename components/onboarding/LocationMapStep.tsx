'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { ArrowLeft, CheckCircle, Loader2, MapPin, AlertCircle } from 'lucide-react'
import { fetchParisGeoData, fetchParisIris, fetchSuburbanCommunes, matchArrondissements, matchCommunes, getChildQuartiers, polygonContainsPoint, type GeoZone } from '@/lib/services/geoDataService'
import { findStation } from '@/lib/services/metroStationsDb'
import { matchNeighborhood, neighborhoodToConstraints } from '@/lib/services/semanticNeighborhoodService'
import { geocodeBest } from '@/lib/services/geocodingService'
import { parseLocationIntent } from '@/lib/services/locationIntentParser'
import { resolveConstraints } from '@/lib/services/geoConstraintService'
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
  const [constraintSummary, setConstraintSummary] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [locationLabel, setLocationLabel] = useState(
    locationLat && locationLng ? locationQuery : ''
  )
  const initialized = useRef(false)
  const quartiersRef = useRef<GeoZone[]>([])
  quartiersRef.current = quartiers
  const communesRef = useRef<GeoZone[]>([])
  communesRef.current = communes

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    initMap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Lazy-load IRIS (Paris + suburbs) when user zooms to level 15+
  useEffect(() => {
    if (zoom < 15 || irisLoading || iris.length > 0) return
    loadIris()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  async function loadIris() {
    setIrisLoading(true)
    try {
      const zones = await fetchParisIris(quartiersRef.current, communesRef.current)
      setIris(zones)

      const { locationIntent: intent, selectedQuartierIds: selQu, selectedCommuneIds: selCom, selectedIrisIds, selectedArrIds } = useSearchStore.getState()

      // Try geo-constraint intersection first
      if (intent?.geoConstraints?.length) {
        const result = resolveConstraints(intent.geoConstraints, zones, quartiersRef.current, communesRef.current)
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
      let enrichedConstraints = intent.geoConstraints ?? []

      if (neighborhoodMatch) {
        const alreadyHasNeighborhood = enrichedConstraints.some((c) => c.type === 'semantic_neighborhood')
        if (!alreadyHasNeighborhood) {
          const nbConstraints = neighborhoodToConstraints(neighborhoodMatch)
          // Keep existing administrative_area if LLM provided one; otherwise use the one
          // derived from the neighborhood's arrondissement field.
          const hasAdminArea = enrichedConstraints.some((c) => c.type === 'administrative_area')
          enrichedConstraints = [
            ...(hasAdminArea
              ? enrichedConstraints
              : nbConstraints.filter((c) => c.type === 'administrative_area')),
            ...enrichedConstraints.filter((c) => c.type !== 'administrative_area'),
            nbConstraints.find((c) => c.type === 'semantic_neighborhood')!,
          ]
        }
      }

      const enrichedIntent = enrichedConstraints !== (intent.geoConstraints ?? [])
        ? { ...intent, geoConstraints: enrichedConstraints }
        : intent

      if (geocodeResult.status === 'fulfilled' && geocodeResult.value) {
        const geo = geocodeResult.value
        // Reject results outside Île-de-France (lat 48.1–49.2, lng 1.4–3.7)
        const inIdf = geo.lat >= 48.1 && geo.lat <= 49.2 && geo.lng >= 1.4 && geo.lng <= 3.7
        if (inIdf) {
          const newCenter: [number, number] = [geo.lat, geo.lng]
          setCenter(newCenter)
          setLocationLabel(geo.label)
          setLocation({ query: locationQuery, label: geo.label, lat: geo.lat, lng: geo.lng, intent: enrichedIntent })
        }
      } else if (neighborhoodMatch) {
        // No geocoding result but neighborhood matched: center on neighborhood
        setLocation({ query: locationQuery, label: neighborhoodMatch.label, lat: neighborhoodMatch.center.lat, lng: neighborhoodMatch.center.lng, intent: enrichedIntent })
      }

      // Always center on the neighborhood's exact center (overrides geocoding if needed)
      if (neighborhoodMatch) {
        setCenter([neighborhoodMatch.center.lat, neighborhoodMatch.center.lng])
      }

      // ── Fine constraint detection ─────────────────────────────────────────
      // Station OR semantic neighborhood → open at IRIS zoom, skip whole-arr pre-selection
      const hasFineConstraint = enrichedConstraints.some(
        (c) => (c.type === 'transport_station' || c.type === 'semantic_neighborhood') && c.confidence >= 0.75
      )

      if (hasFineConstraint) {
        // Clear any stale zone selections from a previous query so fine IRIS selection
        // starts clean. resolveConstraints (in loadIris) will set selectedIrisIds.
        useSearchStore.setState({
          selectedArrIds: [],
          selectedQuartierIds: [],
          selectedIrisIds: [],
          selectedCommuneIds: [],
        })

        // Safety net: for station queries, also pin the center on the station
        if (!neighborhoodMatch) {
          const stationC = enrichedConstraints.find((c) => c.type === 'transport_station' && c.stationName)
          if (stationC?.stationName) {
            const station = findStation(stationC.stationName)
            if (station) setCenter([station.lat, station.lng])
          }
        }

        setZoom(15) // triggers loadIris via useEffect([zoom])
      } else {
        const loadedCommunes = communesResult.status === 'fulfilled' ? communesResult.value : []
        const matchedArrs = matchArrondissements(intent.location_terms, arrs)
        const matchedComms = matchCommunes(intent.location_terms, loadedCommunes)

        let newArrIds = matchedArrs.map((z) => z.id)
        let newQuartierIds = matchedArrs.flatMap((z) => getChildQuartiers(z.id, qus).map((q) => q.id))
        let newCommuneIds = matchedComms.map((z) => z.id)

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

        if (selectedArrIds.length === 0 && selectedCommuneIds.length === 0 && (newArrIds.length > 0 || newCommuneIds.length > 0)) {
          useSearchStore.setState({
            selectedArrIds: newArrIds,
            selectedQuartierIds: newQuartierIds,
            selectedCommuneIds: newCommuneIds,
          })
        }

        const matchedCount = newArrIds.length + newCommuneIds.length
        setZoom(matchedCount <= 2 ? 13 : 12)
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

  // Selection summary
  const selectedArrs = arrondissements.filter((z) => selectedArrIds.includes(z.id))
  const partialArrs = arrondissements.filter((z) => {
    if (selectedArrIds.includes(z.id)) return false
    const childIds = getChildQuartiers(z.id, quartiers).map((q) => q.id)
    return childIds.some((id) => selectedQuartierIds.includes(id))
  })
  const selectedCommunes = communes.filter((z) => selectedCommuneIds.includes(z.id))

  const totalSelectedZones = selectedArrs.length + partialArrs.length + selectedCommunes.length
  const canValidate = selectedArrIds.length > 0 || selectedQuartierIds.length > 0 || selectedIrisIds.length > 0 || selectedCommuneIds.length > 0

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div
        className="flex-shrink-0 px-4 pb-2 flex items-center gap-3"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}
      >
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full bg-white border border-black/8 flex items-center justify-center active:bg-black/5 transition-colors flex-shrink-0"
        >
          <ArrowLeft size={17} className="text-neutral-600" />
        </button>
        <div className="flex-1 min-w-0">
          <h3 className="text-[15px] font-bold text-neutral-900 leading-tight">Sélectionnez vos zones</h3>
          <p className="text-[11px] text-neutral-400 mt-0.5">
            Touchez pour sélectionner · Zoomez pour affiner
          </p>
        </div>
      </div>

      {(locationLabel || constraintSummary.length > 0) && !loading && (
        <div className="flex-shrink-0 px-4 pb-2 flex flex-wrap items-center gap-2">
          {locationLabel && (
            <div
              className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium"
              style={{ backgroundColor: 'rgba(145,78,60,0.08)', color: '#914E3C' }}
            >
              <MapPin size={11} />
              {locationLabel}
            </div>
          )}
          {constraintSummary.map((s) => (
            <div
              key={s}
              className="inline-flex items-center px-3 py-1 rounded-full text-[11px] font-medium"
              style={{ backgroundColor: 'rgba(59,130,246,0.08)', color: '#2563eb' }}
            >
              {s}
            </div>
          ))}
        </div>
      )}

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

      {/* Selection chips */}
      <div className="flex-shrink-0 px-4 pt-2.5 min-h-[36px]">
        <AnimatePresence>
          {totalSelectedZones > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="flex flex-wrap gap-1.5"
            >
              {selectedArrs.map((z) => (
                <button
                  key={z.id}
                  onClick={() => handleClickArr(z)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold text-white active:opacity-75 transition-opacity"
                  style={{ backgroundColor: '#914E3C' }}
                >
                  {z.shortName} <span className="opacity-60 text-[9px] ml-0.5">✕</span>
                </button>
              ))}
              {partialArrs.map((z) => (
                <button
                  key={z.id}
                  onClick={() => handleClickArr(z)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold active:opacity-75 transition-opacity border"
                  style={{ backgroundColor: 'rgba(145,78,60,0.1)', color: '#914E3C', borderColor: 'rgba(145,78,60,0.3)' }}
                >
                  {z.shortName} ~ <span className="opacity-60 text-[9px] ml-0.5">✕</span>
                </button>
              ))}
              {selectedCommunes.map((z) => (
                <button
                  key={z.id}
                  onClick={() => handleClickCommune(z)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold text-white active:opacity-75 transition-opacity"
                  style={{ backgroundColor: '#914E3C' }}
                >
                  {z.shortName} <span className="opacity-60 text-[9px] ml-0.5">✕</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Legend */}
      {!loading && !error && (
        <div className="flex-shrink-0 px-4 pt-1 pb-1">
          <div className="flex items-center gap-4 text-[11px] text-neutral-400">
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(145,78,60,0.18)', border: '2px solid #914E3C' }} />
              <span>Sélectionné</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(145,78,60,0.06)', border: '2px dashed rgba(145,78,60,0.6)' }} />
              <span>Partiel</span>
            </div>
          </div>
        </div>
      )}

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
              {selectedArrIds.length + partialArrs.length + selectedCommuneIds.length}
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
