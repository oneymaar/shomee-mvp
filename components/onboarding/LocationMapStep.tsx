'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { ArrowLeft, CheckCircle, Loader2, MapPin } from 'lucide-react'
import { geocodeBest } from '@/lib/services/geocodingService'
import { parseLocationIntent } from '@/lib/services/locationIntentParser'
import { findZonesByTerms, getZonesAroundPoint, type Zone } from '@/lib/services/zoneService'
import { useSearchStore } from '@/lib/searchStore'

const ZoneMap = dynamic(() => import('./ZoneMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-neutral-100">
      <Loader2 size={24} className="text-neutral-400 animate-spin" />
    </div>
  ),
})

// Default center: Paris
const PARIS: [number, number] = [48.8566, 2.3522]

interface LocationMapStepProps {
  onValidate: () => void
  onBack: () => void
}

export default function LocationMapStep({ onValidate, onBack }: LocationMapStepProps) {
  const { locationQuery, locationLat, locationLng, setLocation, setSelectedZones, toggleZone, selectedZoneIds } = useSearchStore()

  const [center, setCenter] = useState<[number, number]>(
    locationLat && locationLng ? [locationLat, locationLng] : PARIS
  )
  const [zoom, setZoom] = useState(12)
  const [zones, setZones] = useState<Zone[]>([])
  const [loading, setLoading] = useState(true)
  const [locationLabel, setLocationLabel] = useState('')
  const didInit = useRef(false)

  useEffect(() => {
    if (didInit.current) return
    didInit.current = true

    async function init() {
      setLoading(true)
      try {
        const intent = parseLocationIntent(locationQuery)

        // Geocode the primary location
        let resolvedCenter = center
        let resolvedLabel = locationQuery

        const primaryTerm = intent.location_terms[0] ?? locationQuery
        if (primaryTerm) {
          const geo = await geocodeBest(primaryTerm)
          if (geo) {
            resolvedCenter = [geo.lat, geo.lng]
            resolvedLabel = geo.label
            setCenter(resolvedCenter)
            setLocation({ query: locationQuery, label: geo.label, lat: geo.lat, lng: geo.lng, intent })
          }
        } else if (locationLat && locationLng) {
          resolvedCenter = [locationLat, locationLng]
        }

        setLocationLabel(resolvedLabel)

        // Find zones to display
        const matchedZones = findZonesByTerms(intent.location_terms)
        const nearbyZones = getZonesAroundPoint(resolvedCenter[0], resolvedCenter[1], 7)

        // Merge: matched zones first, then nearby (dedup)
        const seen = new Set<string>()
        const merged: Zone[] = []
        for (const z of [...matchedZones, ...nearbyZones]) {
          if (!seen.has(z.id)) { seen.add(z.id); merged.push(z) }
        }
        setZones(merged.slice(0, 30))

        // Pre-select matched zones
        if (matchedZones.length > 0) {
          setSelectedZones(matchedZones.map((z) => z.id))
        }

        // Set zoom based on context
        const inParis = resolvedCenter[0] > 48.81 && resolvedCenter[0] < 48.91 &&
                        resolvedCenter[1] > 2.22 && resolvedCenter[1] < 2.47
        setZoom(inParis ? 12 : 11)
      } finally {
        setLoading(false)
      }
    }

    init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const selectedZones = zones.filter((z) => selectedZoneIds.includes(z.id))
  const canValidate = selectedZoneIds.length > 0

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex-shrink-0 px-4 pt-4 pb-3 flex items-center gap-3">
        <button
          onClick={onBack}
          className="w-9 h-9 rounded-full bg-white border border-black/8 flex items-center justify-center active:bg-black/5 transition-colors"
        >
          <ArrowLeft size={17} className="text-neutral-600" />
        </button>
        <div className="flex-1">
          <h3 className="text-[15px] font-bold text-neutral-900 leading-tight">Sélectionnez vos zones</h3>
          <p className="text-[12px] text-neutral-400 mt-0.5">Touchez les zones pour les sélectionner</p>
        </div>
      </div>

      {/* Location label */}
      {locationLabel && (
        <div className="flex-shrink-0 px-4 pb-2">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-medium w-fit"
            style={{ backgroundColor: 'rgba(145,78,60,0.08)', color: '#914E3C' }}>
            <MapPin size={11} />
            {locationLabel}
          </div>
        </div>
      )}

      {/* Map */}
      <div className="flex-1 mx-4 rounded-2xl overflow-hidden border border-black/8 relative min-h-0">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-neutral-100">
            <Loader2 size={24} className="text-neutral-400 animate-spin" />
          </div>
        )}
        <ZoneMap
          center={center}
          zoom={zoom}
          zones={zones}
          selectedIds={selectedZoneIds}
          onToggle={toggleZone}
        />
      </div>

      {/* Selected zones summary */}
      <div className="flex-shrink-0 px-4 pt-3 min-h-[44px]">
        <AnimatePresence>
          {selectedZones.length > 0 && (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              className="flex flex-wrap gap-1.5"
            >
              {selectedZones.map((z) => (
                <button
                  key={z.id}
                  onClick={() => toggleZone(z.id)}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-medium text-white active:opacity-80"
                  style={{ backgroundColor: '#914E3C' }}
                >
                  {z.shortLabel}
                  <span className="opacity-70 text-[10px]">✕</span>
                </button>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* CTAs */}
      <div
        className="px-4 pt-2 flex flex-col gap-2.5 flex-shrink-0"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}
      >
        <button
          onClick={onValidate}
          disabled={!canValidate}
          className="w-full py-4 rounded-2xl font-semibold text-[16px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
          style={{ backgroundColor: canValidate ? '#914E3C' : '#D4A89A', cursor: canValidate ? 'pointer' : 'default' }}
        >
          <CheckCircle size={18} />
          Valider ma zone
          {selectedZoneIds.length > 0 && (
            <span className="bg-white/20 text-white text-[12px] px-2 py-0.5 rounded-full ml-1">
              {selectedZoneIds.length}
            </span>
          )}
        </button>
        <button
          onClick={onValidate}
          className="w-full py-2.5 text-[13px] font-medium text-neutral-400 active:text-neutral-600 transition-colors"
        >
          Continuer sans sélectionner
        </button>
      </div>
    </div>
  )
}
