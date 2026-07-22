/**
 * Jauge de rareté au récap (idée Olivier) — situe la recherche de « rare » à
 * « large » via POST /api/feed/estimate, à partir des filtres durs du store.
 * Best-effort : en cas d'échec réseau, le composant ne s'affiche pas (le récap
 * reste intact). Se recalcule si les filtres changent (retour au récap).
 */
import { useEffect, useState } from 'react'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { Gauge } from 'lucide-react-native'
import { apiFetch } from '@/lib/api'
import { useSearchStore } from '@/lib/stores'
import { ACCENT, INK, MUTED } from './ui'

type Band = 'rare' | 'selective' | 'steady' | 'abundant'
type Estimate = { band: Band; message: string; perWeekMin: number; perWeekMax: number }

const BANDS: { key: Band; label: string }[] = [
  { key: 'rare', label: 'Rare' },
  { key: 'selective', label: 'Sélectif' },
  { key: 'steady', label: 'Régulier' },
  { key: 'abundant', label: 'Large' },
]

export function RarityGauge() {
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
        const res = await apiFetch('/api/feed/estimate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(snapshot),
        })
        if (!res.ok) throw new Error('estimate_failed')
        const data = (await res.json()) as Estimate
        if (!cancelled) { setEstimate(data); setStatus('ready') }
      } catch {
        if (!cancelled) setStatus('error')
      }
    })()
    return () => { cancelled = true }
  }, [selectedArrIds, selectedCommuneIds, budgetMin, budgetMax, minSurface, maxSurface, minRooms, maxRooms, minBedrooms, maxBedrooms])

  if (status === 'error') return null

  const activeIdx = estimate ? BANDS.findIndex((b) => b.key === estimate.band) : -1

  return (
    <View style={styles.card}>
      <View style={styles.head}>
        <Gauge size={15} color={ACCENT} />
        <Text style={styles.title}>Disponibilité</Text>
      </View>

      {status === 'loading' ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator color={ACCENT} size="small" />
          <Text style={styles.loadingTxt}>Estimation en cours…</Text>
        </View>
      ) : (
        <>
          <View style={styles.bar}>
            {BANDS.map((b, i) => (
              <View
                key={b.key}
                style={[styles.seg, { backgroundColor: i === activeIdx ? ACCENT : 'rgba(166,75,39,0.12)' }]}
              />
            ))}
          </View>
          <View style={styles.labels}>
            {BANDS.map((b, i) => (
              <Text key={b.key} style={[styles.label, i === activeIdx && styles.labelActive]}>
                {b.label}
              </Text>
            ))}
          </View>
          {estimate?.message ? <Text style={styles.msg}>{estimate.message}</Text> : null}
        </>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(166,75,39,0.18)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 10,
  },
  head: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { fontSize: 10, fontWeight: '700', color: MUTED, letterSpacing: 1.3, textTransform: 'uppercase' },
  loadingRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 2 },
  loadingTxt: { fontSize: 13, color: MUTED },
  bar: { flexDirection: 'row', gap: 4 },
  seg: { flex: 1, height: 7, borderRadius: 4 },
  labels: { flexDirection: 'row' },
  label: { flex: 1, fontSize: 10.5, color: '#a3a3a3', textAlign: 'center', fontWeight: '600' },
  labelActive: { color: ACCENT, fontWeight: '800' },
  msg: { fontSize: 13, color: INK, lineHeight: 19, marginTop: 2 },
})
