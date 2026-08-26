/**
 * La modale des disponibilités — 14 jours × 4 tranches (matinée, déjeuner,
 * après-midi, soir : la 4ᵉ est une demande explicite d'Olivier, 24/08).
 *
 * L'acquéreur coche GROSSIÈREMENT : jamais d'heure précise ici — dans ce
 * marché c'est l'agent qui se plie au calendrier de l'acquéreur et cale
 * l'heure exacte en répondant. Cette grille est aussi la fondation du futur
 * calendrier de créneaux ouverts par l'agent (même surface, maille plus fine).
 */
import { useState } from 'react'
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, X } from 'lucide-react-native'
import {
  nextDays,
  VISIT_SLOTS,
  type AvailabilitiesPayload,
  type VisitSlotId,
} from '@shomee/core/visits'
import { colors, fonts, radii } from '@/lib/theme'

interface Props {
  visible: boolean
  onClose: () => void
  onSubmit: (payload: AvailabilitiesPayload) => void
}

export function AvailabilityModal({ visible, onClose, onSubmit }: Props) {
  const insets = useSafeAreaInsets()
  const [days] = useState(() => nextDays(14))
  // clé "date|slot" → coché. Déduit en payload à la validation.
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const toggle = (date: string, slot: VisitSlotId) => {
    setPicked((prev) => {
      const next = new Set(prev)
      const key = `${date}|${slot}`
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const count = picked.size

  const submit = () => {
    const payload: AvailabilitiesPayload = {
      days: days
        .map((d) => ({
          date: d.date,
          slots: VISIT_SLOTS.map((s) => s.id).filter((s) => picked.has(`${d.date}|${s}`)),
        }))
        .filter((d) => d.slots.length > 0),
    }
    if (payload.days.length === 0) return
    onSubmit(payload)
    setPicked(new Set())
  }

  return (
    <Modal visible={visible} animationType="fade" transparent onRequestClose={onClose}>
      <View style={styles.veil}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 14 }]}>
          <View style={styles.head}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Vos disponibilités</Text>
              <Text style={styles.sub}>
                Cochez large — l&apos;agence vous proposera une heure précise.
              </Text>
            </View>
            <Pressable onPress={onClose} hitSlop={10} style={styles.close}>
              <X size={18} color={colors.ink} strokeWidth={2.2} />
            </Pressable>
          </View>

          {/* Légende des 4 tranches */}
          <View style={styles.legendRow}>
            <View style={styles.dayColHead} />
            {VISIT_SLOTS.map((s) => (
              <View key={s.id} style={styles.slotHead}>
                <Text style={styles.slotHeadTxt}>{s.label}</Text>
                <Text style={styles.slotHint}>{s.hint}</Text>
              </View>
            ))}
          </View>

          <ScrollView style={styles.grid} showsVerticalScrollIndicator={false}>
            {days.map((d, i) => (
              <View key={d.date} style={[styles.dayRow, i === 0 && { borderTopWidth: 0 }]}>
                <View style={styles.dayColHead}>
                  <Text style={styles.dayName}>{d.weekday}</Text>
                  <Text style={styles.dayNum}>
                    {d.dayNum} {d.month}
                  </Text>
                </View>
                {VISIT_SLOTS.map((s) => {
                  const on = picked.has(`${d.date}|${s.id}`)
                  return (
                    <Pressable
                      key={s.id}
                      onPress={() => toggle(d.date, s.id)}
                      style={[styles.cell, on && styles.cellOn]}
                      hitSlop={2}
                    >
                      {on && <Check size={15} color={colors.creamOnDark} strokeWidth={2.6} />}
                    </Pressable>
                  )
                })}
              </View>
            ))}
          </ScrollView>

          <Pressable
            onPress={submit}
            disabled={count === 0}
            style={[styles.cta, count === 0 && styles.ctaOff]}
          >
            <Text style={[styles.ctaTxt, count === 0 && styles.ctaTxtOff]}>
              {count === 0
                ? 'Cochez au moins un créneau'
                : `Envoyer mes disponibilités (${count})`}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  )
}

const styles = StyleSheet.create({
  veil: { flex: 1, backgroundColor: 'rgba(23,18,16,0.45)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.cream,
    borderTopLeftRadius: radii.sheet,
    borderTopRightRadius: radii.sheet,
    paddingTop: 18,
    paddingHorizontal: 18,
    maxHeight: '86%',
  },
  head: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 14 },
  title: { fontFamily: fonts.serif, fontSize: 22, color: colors.ink, letterSpacing: -0.2 },
  sub: { fontSize: 13, color: colors.muted, marginTop: 3, lineHeight: 18 },
  close: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },

  legendRow: { flexDirection: 'row', alignItems: 'flex-end', paddingBottom: 8 },
  slotHead: { flex: 1, alignItems: 'center' },
  slotHeadTxt: { fontSize: 11.5, fontWeight: '600', color: colors.ink },
  slotHint: { fontSize: 9, color: '#B7A99D', marginTop: 1 },

  grid: { flexGrow: 0 },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 7,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  dayColHead: { width: 76 },
  dayName: { fontSize: 12.5, fontWeight: '600', color: colors.ink, textTransform: 'capitalize' },
  dayNum: { fontSize: 11, color: colors.muted, marginTop: 1 },
  cell: {
    flex: 1,
    height: 34,
    marginHorizontal: 3,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: colors.line,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellOn: { backgroundColor: colors.terracotta, borderColor: colors.terracotta },

  cta: {
    marginTop: 14,
    height: 50,
    borderRadius: radii.pill,
    backgroundColor: colors.terracotta,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: colors.terracotta,
    shadowOpacity: 0.26,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 8 },
    elevation: 5,
  },
  ctaOff: { backgroundColor: colors.sand, shadowOpacity: 0, elevation: 0 },
  ctaTxt: { color: colors.creamOnDark, fontSize: 15, fontWeight: '600' },
  ctaTxtOff: { color: colors.muted },
})
