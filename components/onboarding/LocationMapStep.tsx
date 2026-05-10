'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { ArrowLeft, CheckCircle, Loader2, MapPin, AlertCircle } from 'lucide-react'
import { fetchParisGeoData, fetchParisIris, matchArrondissements, getChildQuartiers, getChildZones, type GeoZone } from '@/lib/services/geoDataService'
import { geocodeBest } from '@/lib/services/geocodingService'
import { parseLocationIntent } from '@/lib/services/locationIntentParser'
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
    selectedArrIds, selectedQuartierIds, selectedIrisIds,
    setLocation, setSelectedArrs, toggleArr, toggleQuartier, toggleIris,
  } = useSearchStore()

  const [arrondissements, setArrondissements] = useState<GeoZone[]>([])
  const [quartiers, setQuartiers] = useState<GeoZone[]>([])
  const [iris, setIris] = useState<GeoZone[]>([])
  const [center, setCenter] = useState<[number, number]>(
    locationLat && locationLng ? [locationLat, locationLng] : PARIS_CENTER
  )
  const [zoom, setZoom] = useState(12)
  const [loading, setLoading] = useState(true)
  const [irisLoading, setIrisLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [locationLabel, setLocationLabel] = useState(
    locationLat && locationLng ? locationQuery : ''
  )
  const initialized = useRef(false)
  const quartiersRef = useRef<GeoZone[]>([])
  quartiersRef.current = quartiers

  useEffect(() => {
    if (initialized.current) return
    initialized.current = true
    initMap()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Lazy-load IRIS when user zooms in
  useEffect(() => {
    if (zoom < 15 || irisLoading || iris.length > 0 || quartiersRef.current.length === 0) return
    loadIris()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  async function loadIris() {
    setIrisLoading(true)
    try {
      const zones = await fetchParisIris(quartiersRef.current)
      setIris(zones)

      // Propagate existing quartier selection to newly loaded IRIS
      const { selectedQuartierIds: selQu } = useSearchStore.getState()
      if (selQu.length > 0) {
        const irisToSelect = zones.filter((i) => i.parentId && selQu.includes(i.parentId))
        if (irisToSelect.length > 0) {
          const { selectedIrisIds } = useSearchStore.getState()
          useSearchStore.setState({
            selectedIrisIds: [...new Set([...selectedIrisIds, ...irisToSelect.map((i) => i.id)])],
          })
        }
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
      const primaryTerm = intent.location_terms[0] ?? locationQuery

      const [geoData, geocodeResult] = await Promise.allSettled([
        fetchParisGeoData(),
        primaryTerm ? geocodeBest(primaryTerm) : Promise.resolve(null),
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

      if (geocodeResult.status === 'fulfilled' && geocodeResult.value) {
        const geo = geocodeResult.value
        const newCenter: [number, number] = [geo.lat, geo.lng]
        setCenter(newCenter)
        setLocationLabel(geo.label)
        setLocation({ query: locationQuery, label: geo.label, lat: geo.lat, lng: geo.lng, intent })
      }

      if (selectedArrIds.length === 0 && intent.location_terms.length > 0) {
        const matched = matchArrondissements(intent.location_terms, arrs)
        if (matched.length > 0) {
          const newArrIds = matched.map((z) => z.id)
          const newQuartierIds = matched.flatMap((z) => getChildQuartiers(z.id, qus).map((q) => q.id))
          useSearchStore.setState({ selectedArrIds: newArrIds, selectedQuartierIds: newQuartierIds })
        }
      }

      const matchedCount = selectedArrIds.length || matchArrondissements(intent.location_terms, arrs).length
      setZoom(matchedCount <= 2 ? 13 : 12)
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
    const parentQuartierId = zone.parentId
    const parentQuartier = quartiersRef.current.find((q) => q.id === parentQuartierId)
    if (!parentQuartier || !parentQuartier.parentId) return
    const parentArrId = parentQuartier.parentId
    const allQuartierSiblingIds = iris.filter((i) => i.parentId === parentQuartierId).map((i) => i.id)
    const allArrQuartierIds = getChildQuartiers(parentArrId, quartiersRef.current).map((q) => q.id)
    toggleIris(zone.id, parentQuartierId, parentArrId, allQuartierSiblingIds, allArrQuartierIds)
  }, [iris, toggleIris])

  const handleZoomChange = useCallback((z: number) => {
    setZoom(z)
  }, [])

  // Build selection summary
  const selectedArrs = arrondissements.filter((z) => selectedArrIds.includes(z.id))
  const partialArrs = arrondissements.filter((z) => {
    if (selectedArrIds.includes(z.id)) return false
    const childIds = getChildQuartiers(z.id, quartiers).map((q) => q.id)
    return childIds.some((id) => selectedQuartierIds.includes(id))
  })

  const totalSelectedZones = selectedArrs.length + partialArrs.length
  const canValidate = selectedArrIds.length > 0 || selectedQuartierIds.length > 0 || selectedIrisIds.length > 0

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

      {/* Location label */}
      {locationLabel && !loading && (
        <div className="flex-shrink-0 px-4 pb-2">
          <div
            className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium"
            style={{ backgroundColor: 'rgba(145,78,60,0.08)', color: '#914E3C' }}
          >
            <MapPin size={11} />
            {locationLabel}
          </div>
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
            selectedArrIds={selectedArrIds}
            selectedQuartierIds={selectedQuartierIds}
            selectedIrisIds={selectedIrisIds}
            irisLoading={irisLoading}
            onClickArr={handleClickArr}
            onClickQuartier={handleClickQuartier}
            onClickIris={handleClickIris}
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
                  {z.shortName}
                  <span className="opacity-60 text-[9px] ml-0.5">✕</span>
                </button>
              ))}
              {partialArrs.map((z) => (
                <button
                  key={z.id}
                  onClick={() => handleClickArr(z)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold active:opacity-75 transition-opacity border"
                  style={{ backgroundColor: 'rgba(145,78,60,0.1)', color: '#914E3C', borderColor: 'rgba(145,78,60,0.3)' }}
                >
                  {z.shortName} ~
                  <span className="opacity-60 text-[9px] ml-0.5">✕</span>
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
              {selectedArrIds.length + partialArrs.length}
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
