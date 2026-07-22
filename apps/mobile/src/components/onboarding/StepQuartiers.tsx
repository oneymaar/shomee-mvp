/**
 * Étape 1 — Quartiers (« deux moments », moment 1).
 *
 * Saisie libre → pastilles vivantes (parser déterministe de packages/core) →
 * UN SEUL bouton « Voir ma zone sur la carte » qui résout la zone
 * (`resolveGeoFromText`) PUIS ouvre le moment 2 (carte). Fidèle au proto :
 * pas de carte « Zone ciblée » intermédiaire, pas de double-clic.
 */
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { MapPin } from 'lucide-react-native'
import { useSearchStore } from '@/lib/stores'
import { resolveGeoFromText } from '@/lib/handoff'
import { parseSpatialIntent } from '@shomee/core/parsing/spatialIntentParser'
import { PrimaryButton, StepHeader, ACCENT, INK, MUTED } from './ui'

type Status = 'idle' | 'resolving'
type LiveChip = { label: string; icon: boolean; variant: 'zone' | 'place' | 'excl' | 'rel' | 'unknown' }

export function StepQuartiers({
  onOpenMap,
}: {
  onNext: () => void
  /** Résolution faite → ouvre le sous-écran carte (sélection interactive). */
  onOpenMap: () => void
}) {
  const storedQuery = useSearchStore((s) => s.locationQuery)

  const [query, setQuery] = useState(storedQuery)
  const [status, setStatus] = useState<Status>('idle')

  // ── MOMENT 1 — pastilles vivantes (parser déterministe, aucun réseau). ──────
  const [liveChips, setLiveChips] = useState<LiveChip[]>([])
  useEffect(() => {
    const t = setTimeout(() => {
      const q = query.trim()
      if (q.length < 2) { setLiveChips([]); return }
      try {
        const intent = parseSpatialIntent(q)
        const seen = new Set<string>()
        const chips: LiveChip[] = []
        const push = (c: LiveChip) => {
          const key = `${c.variant}|${c.label}`
          if (seen.has(key)) return
          seen.add(key); chips.push(c)
        }
        for (const e of intent.primaryEntities) {
          const lbl = e.label ?? e.rawText
          if (e.type === 'unknown') {
            if (lbl.trim().length >= 3) push({ label: lbl.trim(), icon: false, variant: 'unknown' })
            continue
          }
          const isZone = e.type === 'city' || e.type === 'district'
          push({ label: lbl, icon: !isZone, variant: isZone ? 'zone' : 'place' })
        }
        for (const r of intent.spatialRelations) {
          if (r.type === 'edge_of' && r.targetText) push({ label: r.targetText, icon: true, variant: 'rel' })
        }
        for (const e of intent.exclusions) {
          const lbl = e.label ?? e.rawText
          if (e.type === 'unknown') push({ label: lbl.trim(), icon: false, variant: 'unknown' })
          else push({ label: lbl, icon: false, variant: 'excl' })
        }
        setLiveChips(chips)
      } catch { setLiveChips([]) }
    }, 280)
    return () => clearTimeout(t)
  }, [query])

  const canGo = query.trim().length >= 2 && status !== 'resolving'

  // Un seul geste (comme le proto) : résout la zone PUIS ouvre la carte.
  const handleToMap = async () => {
    if (!canGo) return
    setStatus('resolving')
    await resolveGeoFromText(query)
    onOpenMap()
  }

  return (
    <View style={styles.root}>
      <StepHeader title="Où aimeriez-vous habiter ?" subtitle="Décrivez librement une ou plusieurs zones." />

      <View style={styles.body}>
        <View style={styles.inputWrap}>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Ex : Le Marais, Belleville, près de la Tour Eiffel…"
            placeholderTextColor="#a3a3a3"
            style={styles.input}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={handleToMap}
            editable={status !== 'resolving'}
            multiline
          />
        </View>

        <View style={styles.result}>
          {status === 'resolving' ? (
            <View style={styles.resultRow}>
              <ActivityIndicator color={ACCENT} />
              <Text style={styles.resultMuted}>Préparation de votre zone…</Text>
            </View>
          ) : liveChips.length > 0 ? (
            <View style={styles.chipsWrap}>
              {liveChips.map((c, i) => {
                const isExcl = c.variant === 'excl'
                const isUnknown = c.variant === 'unknown'
                const color = isUnknown ? '#9ca3af' : isExcl ? '#6b7280' : ACCENT
                const text =
                  (isExcl ? 'sans ' : '') + (c.variant === 'rel' ? '~ ' : '') + c.label + (isUnknown ? ' ?' : '')
                return (
                  <View
                    key={`${c.variant}-${c.label}-${i}`}
                    style={[
                      styles.chip,
                      {
                        backgroundColor: isUnknown ? 'rgba(0,0,0,0.03)' : isExcl ? 'rgba(0,0,0,0.04)' : 'rgba(166,75,39,0.06)',
                        borderColor: isUnknown ? 'rgba(0,0,0,0.18)' : isExcl ? 'rgba(0,0,0,0.16)' : 'rgba(166,75,39,0.28)',
                        borderStyle: isUnknown ? 'dashed' : 'solid',
                      },
                    ]}
                  >
                    {c.icon && <MapPin size={11} color={color} style={{ marginRight: 3 }} />}
                    <Text style={[styles.chipTxt, { color }]}>{text}</Text>
                  </View>
                )
              })}
            </View>
          ) : null}
        </View>
      </View>

      <View style={styles.footer}>
        <PrimaryButton label="Voir ma zone sur la carte" onPress={handleToMap} disabled={!canGo} />
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  body: { flex: 1, paddingHorizontal: 24 },
  inputWrap: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(166,75,39,0.28)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  input: { fontSize: 16, color: INK, minHeight: 72, textAlignVertical: 'top', lineHeight: 22 },
  result: { marginTop: 18, minHeight: 72 },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  resultMuted: { fontSize: 13.5, color: MUTED },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  chipTxt: { fontSize: 12, fontWeight: '600' },
  footer: { paddingHorizontal: 24, paddingTop: 12 },
})
