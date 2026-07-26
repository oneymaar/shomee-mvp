/**
 * Écran de « mise en scène » du calcul de recherche — fond crème, une phrase à
 * la fois centrée (loader SHOMEE inline devant), chaque phrase apparaît, tient
 * ~1,3 s puis remonte en fondu pour laisser place à la suivante. Durée fixe
 * (~7 s) quelle que soit la vitesse réelle du moteur : c'est une mise en scène.
 * Termine par un check vert + « N biens trouvés », puis `onFinish(true)`.
 *
 * Réutilisable : onboarding (fin de funnel) ET recalcul après modification de
 * recherche. Le calcul réel est passé via `run` (retourne true si feed généré),
 * le nombre de biens via `getCount` (lu après résolution de `run`).
 */
import { useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import { Check } from 'lucide-react-native'
import { ShomeeLoader } from './ShomeeLoader'

const BG = '#FDF5F2'
const ACCENT = '#A64B27'
const INK = '#1c1917'

const STEPS = [
  'Analyse de votre zone idéale',
  'Calibrage du budget',
  'Profil de recherche',
  'Sélection de vos biens',
]
const ENTER = 300
const HOLD = 1250
const EXIT = 260
const FINAL_HOLD = 1300

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function SearchStagingLoader({
  run,
  getCount,
  onFinish,
}: {
  run: () => Promise<boolean>
  getCount: () => number
  onFinish: (ok: boolean) => void
}) {
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState<{ count: number } | null>(null)
  const slot = useRef(new Animated.Value(0)).current
  const finalOpacity = useRef(new Animated.Value(0)).current

  useEffect(() => {
    let cancelled = false
    const runP = run().then((ok) => ({ ok, count: ok ? getCount() : 0 }))

    const animate = (to: number, duration: number) =>
      new Promise<void>((resolve) => {
        Animated.timing(slot, { toValue: to, duration, useNativeDriver: true }).start(() => resolve())
      })

    ;(async () => {
      for (let i = 0; i < STEPS.length; i++) {
        if (cancelled) return
        setIndex(i)
        slot.setValue(0)
        await animate(1, ENTER) // entre par le bas + fondu
        if (cancelled) return
        await wait(HOLD)
        if (cancelled) return
        await animate(2, EXIT) // remonte + fondu sortant
      }
      const result = await runP // on tient l'écran si le moteur est plus lent
      if (cancelled) return
      if (!result.ok) {
        onFinish(false)
        return
      }
      setDone({ count: result.count })
      Animated.timing(finalOpacity, { toValue: 1, duration: 320, useNativeDriver: true }).start()
      await wait(FINAL_HOLD)
      if (cancelled) return
      onFinish(true)
    })()

    return () => {
      cancelled = true
    }
  }, [run, getCount, onFinish, slot, finalOpacity])

  const translateY = slot.interpolate({ inputRange: [0, 1, 2], outputRange: [14, 0, -14] })
  const opacity = slot.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] })

  return (
    <View style={styles.root}>
      {done ? (
        <Animated.View style={[styles.row, { opacity: finalOpacity }]}>
          <View style={styles.check}>
            <Check size={16} strokeWidth={3} color="#fff" />
          </View>
          <Text style={styles.result}>
            <Text style={styles.count}>{done.count}</Text> bien{done.count > 1 ? 's' : ''} trouvé
            {done.count > 1 ? 's' : ''}
          </Text>
        </Animated.View>
      ) : (
        <Animated.View style={[styles.row, { opacity, transform: [{ translateY }] }]}>
          <ShomeeLoader size={26} />
          <Text style={styles.step}>{STEPS[index]}</Text>
        </Animated.View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  step: { fontSize: 16, color: INK, fontWeight: '500', flexShrink: 1 },
  check: { width: 26, height: 26, borderRadius: 13, backgroundColor: ACCENT, alignItems: 'center', justifyContent: 'center' },
  result: { fontSize: 17, color: INK, fontWeight: '600' },
  count: { color: ACCENT, fontWeight: '800' },
})
