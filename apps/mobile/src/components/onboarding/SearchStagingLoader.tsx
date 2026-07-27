/**
 * Écran de « mise en scène » du calcul de recherche — fond crème, une phrase à
 * la fois centrée (loader SHOMEE inline devant), chaque phrase apparaît, tient
 * ~1 s, puis remonte en fondu pour laisser place à la suivante. Se termine par
 * un check + « N biens trouvés », puis `onFinish('ok')`. Une issue `'empty'`
 * (aucun bien) ou `'error'` (panne) court-circuite l'annonce chiffrée et rend
 * la main aussitôt : c'est à l'appelant de décider de l'écran suivant.
 *
 * TIMING — la validation tombe JUSTE APRÈS l'effacement de la dernière phrase.
 * C'est la DERNIÈRE étape (« Sélection de vos biens ») qui absorbe l'attente
 * moteur : elle reste affichée au moins `HOLD`, et plus longtemps si le moteur
 * n'a pas encore répondu. Avant, on attendait le moteur APRÈS l'effacement de
 * la dernière phrase — d'où un écran vide, puis un compteur qui arrivait trop
 * tard. Nominal : 4 × 1,46 s + 0,24 + 0,95 ≈ 7 s (fenêtre 6–8 s demandée).
 *
 * Le moteur n'est lancé QU'UNE FOIS : `run`/`getCount`/`onFinish` sont lus dans
 * une ref, jamais dans les deps de l'effet. Les appelants passent des lambdas
 * inline (nouvelle identité à chaque rendu) : sans cette précaution, un simple
 * re-render du parent relançait une seconde génération concurrente, et le
 * compteur annoncé pouvait décrire un feed déjà remplacé par l'autre run.
 *
 * Réutilisable : fin d'onboarding ET recalcul après évolution de la recherche.
 */
import { useEffect, useRef, useState } from 'react'
import { Animated, StyleSheet, Text, View } from 'react-native'
import { Check } from 'lucide-react-native'
import { ShomeeLoader } from './ShomeeLoader'
import type { FeedOutcome } from '@/lib/handoff'

const BG = '#FDF5F2'
const ACCENT = '#A64B27'
const INK = '#1c1917'

const STEPS = [
  'Analyse de votre zone idéale',
  'Calibrage du budget',
  'Profil de recherche',
  'Sélection de vos biens',
]
const ENTER = 240
const HOLD = 1000
const EXIT = 220
const FINAL_IN = 240
const FINAL_HOLD = 950

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function SearchStagingLoader({
  run,
  getCount,
  onFinish,
}: {
  run: () => Promise<FeedOutcome>
  getCount: () => number
  onFinish: (outcome: FeedOutcome) => void
}) {
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState<{ count: number } | null>(null)
  const slot = useRef(new Animated.Value(0)).current
  const finalSlot = useRef(new Animated.Value(0)).current

  // Callbacks toujours frais, mais HORS deps de l'effet de séquence.
  const cbs = useRef({ run, getCount, onFinish })
  useEffect(() => {
    cbs.current = { run, getCount, onFinish }
  })

  useEffect(() => {
    let cancelled = false
    // Lancé au montage : le moteur travaille pendant toute la mise en scène.
    const runP: Promise<FeedOutcome> = cbs.current.run().catch((): FeedOutcome => 'error')

    const animate = (value: Animated.Value, to: number, duration: number) =>
      new Promise<void>((resolve) => {
        Animated.timing(value, { toValue: to, duration, useNativeDriver: true }).start(() =>
          resolve(),
        )
      })

    void (async () => {
      let outcome: FeedOutcome = 'error'
      for (let i = 0; i < STEPS.length; i++) {
        if (cancelled) return
        setIndex(i)
        slot.setValue(0)
        await animate(slot, 1, ENTER) // entre par le bas + fondu
        if (cancelled) return
        if (i === STEPS.length - 1) {
          // La dernière phrase tient AU MOINS HOLD, et davantage si le moteur
          // traîne — c'est elle qui porte l'attente, pas l'écran vide d'après.
          outcome = (await Promise.all([runP, wait(HOLD)]))[0]
        } else {
          await wait(HOLD)
        }
        if (cancelled) return
        await animate(slot, 2, EXIT) // remonte + fondu sortant
      }
      if (cancelled) return
      // Vide ou en échec : pas d'annonce chiffrée. Un « 0 bien trouvé » coché
      // en vert avant l'écran d'après serait une fausse bonne nouvelle.
      if (outcome !== 'ok') {
        cbs.current.onFinish(outcome)
        return
      }
      // Compteur lu au dernier moment : c'est bien l'état du feed AU MOMENT où
      // on l'annonce, pas celui d'il y a quelques secondes.
      setDone({ count: cbs.current.getCount() })
      finalSlot.setValue(0)
      await animate(finalSlot, 1, FINAL_IN)
      if (cancelled) return
      await wait(FINAL_HOLD)
      if (cancelled) return
      cbs.current.onFinish('ok')
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run/getCount/onFinish
    // sont lus via `cbs` : les inclure relancerait le moteur à chaque re-render.
  }, [slot, finalSlot])

  const translateY = slot.interpolate({ inputRange: [0, 1, 2], outputRange: [14, 0, -14] })
  const opacity = slot.interpolate({ inputRange: [0, 1, 2], outputRange: [0, 1, 0] })
  const finalY = finalSlot.interpolate({ inputRange: [0, 1], outputRange: [14, 0] })

  return (
    <View style={styles.root}>
      {done ? (
        <Animated.View
          style={[styles.row, { opacity: finalSlot, transform: [{ translateY: finalY }] }]}
        >
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
  root: {
    flex: 1,
    backgroundColor: BG,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  step: { fontSize: 16, color: INK, fontWeight: '500', flexShrink: 1 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  result: { fontSize: 17, color: INK, fontWeight: '600' },
  count: { color: ACCENT, fontWeight: '800' },
})
