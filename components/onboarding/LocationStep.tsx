'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import dynamic from 'next/dynamic'
import { MapPin, Search, Loader2, ChevronRight } from 'lucide-react'
import { geocodeBest, type GeocodingResult } from '@/lib/services/geocodingService'
import { parseLocationIntent, intentToGeocodableQuery } from '@/lib/services/locationIntentParser'
import { useSearchStore } from '@/lib/searchStore'

const LocationMap = dynamic(() => import('./LocationMap'), { ssr: false, loading: () => <div className="w-full h-full bg-neutral-100 animate-pulse rounded-2xl" /> })

const RADIUS_OPTIONS = [0.5, 1, 2, 5, 10, 20]

interface LocationStepProps {
  onNext: () => void
  onSkip: () => void
}

export default function LocationStep({ onNext, onSkip }: LocationStepProps) {
  const { setLocation, setLocationRadius, locationLat, locationLng, locationQuery, locationRadius } = useSearchStore()

  const [query, setQuery] = useState(locationQuery)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<GeocodingResult | null>(
    locationLat && locationLng ? { label: locationQuery, lat: locationLat, lng: locationLng, score: 1, type: 'unknown' } : null
  )
  const [showMap, setShowMap] = useState(!!locationLat)
  const [radius, setRadius] = useState(locationRadius)
  const [error, setError] = useState<string | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSearch = useCallback(async (q: string) => {
    if (!q.trim()) {
      setResult(null)
      setShowMap(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)
    try {
      const intent = parseLocationIntent(q)
      const geocodableQuery = intentToGeocodableQuery(q, intent)
      const geo = await geocodeBest(geocodableQuery)
      if (geo) {
        setResult(geo)
        setShowMap(true)
        setLocation({ query: q, label: geo.label, lat: geo.lat, lng: geo.lng, intent })
      } else {
        setError("Aucun résultat trouvé. Essayez d'être plus précis.")
        setShowMap(false)
      }
    } catch {
      setError('Erreur de recherche. Vérifiez votre connexion.')
    } finally {
      setLoading(false)
    }
  }, [setLocation])

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.length < 3) return
    debounceRef.current = setTimeout(() => handleSearch(query), 800)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [query, handleSearch])

  const handleRadiusChange = (r: number) => {
    setRadius(r)
    setLocationRadius(r)
  }

  const canContinue = !!result

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-6 pt-6 pb-4 flex-shrink-0">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        >
          <h2 className="text-[22px] font-bold text-neutral-900 leading-tight">
            Où aimeriez-vous habiter ?
          </h2>
          <p className="text-[14px] text-neutral-400 mt-1.5 leading-relaxed">
            Décrivez librement votre zone idéale. Vous pourrez ensuite l'ajuster.
          </p>
        </motion.div>

        {/* Search input */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
          className="mt-4 relative"
        >
          <div className="flex items-center gap-3 bg-white border border-black/8 rounded-2xl px-4 py-3.5 shadow-sm">
            {loading
              ? <Loader2 size={18} className="text-neutral-400 flex-shrink-0 animate-spin" />
              : <Search size={18} className="text-neutral-400 flex-shrink-0" />
            }
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ex : proche du bois de Vincennes, autour de Nation…"
              className="flex-1 text-[14px] text-neutral-900 placeholder:text-neutral-400 bg-transparent outline-none"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
            />
          </div>
          {error && (
            <p className="text-[12px] text-red-500 mt-2 px-1">{error}</p>
          )}
        </motion.div>
      </div>

      {/* Map area */}
      <AnimatePresence>
        {showMap && result && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 220 }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
            className="mx-6 rounded-2xl overflow-hidden flex-shrink-0 border border-black/8"
          >
            <LocationMap lat={result.lat} lng={result.lng} radiusKm={radius} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Location label + radius */}
      <AnimatePresence>
        {showMap && result && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.4, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="px-6 mt-4 flex-shrink-0"
          >
            {/* Zone label */}
            <div className="flex items-center gap-2 mb-4">
              <MapPin size={14} style={{ color: '#914E3C' }} className="flex-shrink-0" />
              <span className="text-[13px] font-medium text-neutral-700 line-clamp-1">{result.label}</span>
            </div>

            {/* Radius selector */}
            <div>
              <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-400 mb-2.5">
                Rayon de recherche
              </p>
              <div className="flex gap-2 flex-wrap">
                {RADIUS_OPTIONS.map((r) => (
                  <button
                    key={r}
                    onClick={() => handleRadiusChange(r)}
                    className="px-3 py-1.5 rounded-full text-[13px] font-medium border transition-all active:scale-95"
                    style={{
                      backgroundColor: radius === r ? '#914E3C' : 'white',
                      color: radius === r ? 'white' : '#1a1a1a',
                      borderColor: radius === r ? '#914E3C' : 'rgba(0,0,0,0.08)',
                    }}
                  >
                    {r < 1 ? `${r * 1000}m` : `${r} km`}
                  </button>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Spacer */}
      <div className="flex-1" />

      {/* CTAs */}
      <div
        className="px-6 pt-4 pb-10 flex flex-col gap-3 flex-shrink-0"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 32px)' }}
      >
        <button
          onClick={onNext}
          disabled={!canContinue}
          className="w-full py-4 rounded-2xl font-semibold text-[16px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
          style={{ backgroundColor: canContinue ? '#914E3C' : '#D4A89A', cursor: canContinue ? 'pointer' : 'default' }}
        >
          Voir sur la carte
          <ChevronRight size={18} />
        </button>
        <button
          onClick={onSkip}
          className="w-full py-3 text-[14px] font-medium text-neutral-400 active:text-neutral-600 transition-colors"
        >
          Passer cette étape
        </button>
      </div>
    </div>
  )
}
