'use client'

/**
 * Jauge de rareté — portage web du composant natif `RarityGauge` (S7), pixel
 * pour pixel : carte blanche bordée terracotta, 4 segments Rare → Large,
 * message d'estimation. Alimentée par POST /api/feed/estimate à partir des
 * filtres durs du store (zones arr/commune, budget, surface, pièces,
 * chambres). Best-effort : toute erreur réseau masque le composant, le récap
 * reste intact. Se recalcule quand les filtres changent (retour au récap).
 */

import { useEffect, useState } from 'react'
import { Gauge, Loader2 } from 'lucide-react'
import { motion } from 'framer-motion'
import { useSearchStore } from '@/lib/searchStore'

type Band = 'rare' | 'selective' | 'steady' | 'abundant'
type Estimate = { band: Band; message: string; perWeekMin: number; perWeekMax: number }

const BANDS: { key: Band; label: string }[] = [
  { key: 'rare', label: 'Rare' },
  { key: 'selective', label: 'Sélectif' },
  { key: 'steady', label: 'Régulier' },
  { key: 'abundant', label: 'Large' },
]

const ACCENT = '#A64B27'

export default function RarityGaugeWeb() {
  const selectedArrIds = useSearchStore((s) => s.selectedArrIds)
  const selectedCommuneIds = useSearchStore((s) => s.selectedCommuneIds)
  const budgetMin = useSearchStore((s) => s.budgetMin)
  const budgetMax = useSearchStore((s) => s.budgetMax)
  const minSurface = useSearchStore((s) => s.minSurface)
  const maxSurface = useSearchStore((s) => s.maxSurface)
  const minRooms = useSearchStore((s) => s.minRooms)
  const maxRooms = useSearchStore((s) => s.maxRooms)
  const minBedrooms = useSearchStore((s) => s.minBedrooms)
  const maxBedrooms = useSearchStore((s) => s.maxBedrooms)

  const [estimate, setEstimate] = useState<Estimate | null>(null)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')

  useEffect(() => {
    let cancelled = false
    const snapshot = {
      arrondissementIds: selectedArrIds,
      communeIds: selectedCommuneIds,
      budgetMin, budgetMax,
      minSurface, maxSurface,
      minRooms, maxRooms,
      minBedrooms, maxBedrooms,
    }
    ;(async () => {
      try {
        const res = await fetch('/api/feed/estimate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshot),
        })
        if (!res.ok) throw new Error('estimate_failed')
        const data = (await res.json()) as Estimate
        if (!cancelled) {
          setEstimate(data)
          setStatus('ready')
        }
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [selectedArrIds, selectedCommuneIds, budgetMin, budgetMax, minSurface, maxSurface, minRooms, maxRooms, minBedrooms, maxBedrooms])

  if (status === 'error') return null

  const activeIdx = estimate ? BANDS.findIndex((b) => b.key === estimate.band) : -1

  return (
    <div
      className="bg-white rounded-2xl px-4 py-3.5 flex flex-col gap-2.5 border"
      style={{ borderColor: 'rgba(166,75,39,0.18)' }}
    >
      <div className="flex items-center gap-[7px]">
        <Gauge size={15} style={{ color: ACCENT }} />
        <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-600">
          Disponibilité
        </p>
      </div>

      {status === 'loading' ? (
        <div className="flex items-center gap-2.5 py-0.5">
          <motion.span
            animate={{ rotate: 360 }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'linear' }}
            className="inline-flex"
          >
            <Loader2 size={15} style={{ color: ACCENT }} />
          </motion.span>
          <p className="text-[13px] text-neutral-600">Estimation en cours…</p>
        </div>
      ) : (
        <>
          <div className="flex gap-1">
            {BANDS.map((b, i) => (
              <div
                key={b.key}
                className="flex-1 h-[7px] rounded"
                style={{ backgroundColor: i === activeIdx ? ACCENT : 'rgba(166,75,39,0.12)' }}
              />
            ))}
          </div>
          <div className="flex">
            {BANDS.map((b, i) => (
              <span
                key={b.key}
                className="flex-1 text-[10.5px] text-center"
                style={
                  i === activeIdx
                    ? { color: ACCENT, fontWeight: 800 }
                    : { color: '#a3a3a3', fontWeight: 600 }
                }
              >
                {b.label}
              </span>
            ))}
          </div>
          {estimate?.message ? (
            <p className="text-[13px] leading-[19px] text-neutral-900 mt-0.5">{estimate.message}</p>
          ) : null}
        </>
      )}
    </div>
  )
}
