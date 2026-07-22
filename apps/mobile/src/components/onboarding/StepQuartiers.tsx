/**
 * Étape 1 — Quartiers (TEXTE, pas de carte — décision d'archi actée S7).
 *
 * Champ libre → `resolveGeoFromText` (partagé avec le handoff ChatGPT) :
 * `/api/location/analyze` → resolveConstraints → deriveParents → seed des IDs
 * géo dans le store. Même qualité de résolution que le handoff, sans Leaflet.
 */
import { useEffect, useState } from 'react'
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Check, MapPin } from 'lucide-react-native'
import { useSearchStore } from '@/lib/stores'
import { resolveGeoFromText } from '@/lib/handoff'
import { parseSpatialIntent } from '@shomee/core/parsing/spatialIntentParser'
import { PrimaryButton, StepHeader, ACCENT, INK, MUTED } from './ui'

type Status = 'idle' | 'resolving' | 'resolved' | 'empty'
type LiveChip = { label: string; icon: boolean; variant: 'zone' | 'place' | 'excl' | 'rel' | 'unknown' }

export function StepQuartiers({
  onNext,
  onOpenMap,
}: {
  onNext: () => void
  /** Résolution réussie → ouvre le sous-écran carte (sélection interactive). */
  onOpenMap: () => void
}) {
  const storedQuery = useSearchStore((s) => s.locationQuery)
  const storedLabel = useSearchStore((s) => s.locationLabel)
  const storedIris = useSearchStore((s) => s.selectedIrisIds.length)

  const [query, setQuery] = useState(storedQuery)
  // Réhydratation : si le store porte déjà une zone résolue, on repart de là.
  const [status, setStatus] = useState<Status>(storedIris > 0 ? 'resolved' : 'idle')
  const [label, setLabel] = useState(storedLabel)

  // ── MOMENT 1 — pastilles vivantes (parser déterministe de packages/core,
  //    aucun réseau) : on affiche EN DIRECT ce que le moteur comprend.
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

  const canResolve = query.trim().length >= 2 && status !== 'resolving'

  const handleResolve = async () => {
    if (!canResolve) return
    setStatus('resolving')
    const outcome = await resolveGeoFromText(query)
    setLabel(outcome.label)
    setStatus(outcome.resolved ? 'resolved' : 'empty')
  }

  const onEdit = (text: string) => {
    setQuery(text)
    if (status !== 'idle') setStatus('idle')
  }

  return (
    <View style={styles.root}>
      <StepHeader title="Où aimeriez-vous habiter ?" subtitle="Décrivez librement une ou plusieurs zones." />

      <View style={styles.body}>
        <View style={styles.inputWrap}>
          <TextInput
            value={query}
            onChangeText={onEdit}
            placeholder="Ex : Le Marais, Belleville, près de la Tour Eiffel…"
            placeholderTextColor="#a3a3a3"
            style={styles.input}
            autoFocus
            autoCorrect={false}
            returnKeyType="search"
            onSubmitEditing={handleResolve}
            editable={status !== 'resolving'}
            multiline
          />
        </View>

        {/* Zone de résultat */}
        <View style={styles.result}>
          {status === 'idle' && liveChips.length > 0 && (
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
          )}
          {status === 'resolving' && (
            <View style={styles.resultRow}>
              <ActivityIndicator color={ACCENT} />
              <Text style={styles.resultMuted}>Analyse de votre recherche…</Text>
            </View>
          )}
          {status === 'resolved' && (
            <View style={styles.resolvedCard}>
              <View style={styles.resolvedIcon}>
                <Check size={14} color="#fff" strokeWidth={2.8} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.resolvedCap}>Zone ciblée</Text>
                <Text style={styles.resolvedLabel} numberOfLines={2}>
                  {label || query.trim()}
                </Text>
              </View>
              <MapPin size={16} color={ACCENT} />
            </View>
          )}
          {status === 'empty' && (
            <Text style={styles.emptyMsg}>
              Je n&apos;ai pas pu cibler cette zone précisément. Reformulez (un quartier, une
              station, un arrondissement…), ou continuez sans filtre de zone.
            </Text>
          )}
        </View>
      </View>

      <View style={styles.footer}>
        {status === 'resolved' ? (
          <PrimaryButton label="Voir ma zone sur la carte" onPress={onOpenMap} />
        ) : status === 'empty' ? (
          <PrimaryButton label="Continuer quand même" onPress={onNext} />
        ) : (
          <PrimaryButton
            label="Rechercher cette zone"
            onPress={handleResolve}
            disabled={!canResolve}
            icon={false}
          />
        )}
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
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, marginBottom: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, borderWidth: 1 },
  chipTxt: { fontSize: 12, fontWeight: '600' },
  resultRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  resultMuted: { fontSize: 13.5, color: MUTED },

  resolvedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  resolvedIcon: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  resolvedCap: {
    fontSize: 10,
    fontWeight: '700',
    color: MUTED,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 2,
  },
  resolvedLabel: { fontSize: 15, fontWeight: '600', color: INK, lineHeight: 20 },

  emptyMsg: { fontSize: 13.5, color: '#854d0e', lineHeight: 20 },

  footer: { paddingHorizontal: 24, paddingTop: 12 },
})
