/**
 * Écran de « mise en scène » du calcul de recherche — fond crème, une phrase à
 * la fois centrée (loader SHOMEE inline devant), chaque phrase apparaît, tient,
 * puis remonte en fondu pour laisser place à la suivante. Se termine par un
 * check + « N biens trouvés », puis `onFinish('ok')`. Une issue `'empty'`
 * (aucun bien) ou `'error'` (panne) court-circuite l'annonce chiffrée et rend
 * la main aussitôt : c'est à l'appelant de décider de l'écran suivant.
 *
 * DEUX REGISTRES DE TEXTE. Les étapes sont GRISES et suivies de « … » : elles
 * décrivent un travail en cours, pas un résultat. La dernière ligne — le
 * compte — reste NOIRE, sans points de suspension : c'est une validation. Le
 * « … » est ajouté à L'AFFICHAGE, jamais dans les chaînes : toute étape ajoutée
 * plus tard hérite de la règle sans qu'on ait à y penser.
 *
 * DEUX SÉQUENCES. `STEPS_ONBOARDING` (quatre étapes) décrit un travail de
 * première fois. `STEPS_RERUN` (une seule) sert la relance depuis un
 * intercalaire : la recherche existe déjà, il n'y a plus rien à « analyser » ni
 * à « calibrer », on cherche seulement du neuf. Une étape seule tient plus
 * longtemps (`HOLD_SOLO`) — à `HOLD`, l'écran entier durerait 2,6 s, sous le
 * plancher de 3 à 4 s fixé pour la relance, et la mise à jour ressemblerait à
 * un clignotement.
 *
 * TIMING — la validation tombe JUSTE APRÈS l'effacement de la dernière phrase.
 * C'est la DERNIÈRE étape qui absorbe l'attente moteur : elle reste affichée au
 * moins `hold`, et davantage si le moteur n'a pas encore répondu. Avant, on
 * attendait le moteur APRÈS l'effacement de la dernière phrase — d'où un écran
 * vide, puis un compteur qui arrivait trop tard.
 * Onboarding : 4 × 1,46 s + 0,24 + 0,95 ≈ 7 s (fenêtre 6–8 s demandée).
 * Relance : 2,86 + 0,24 + 0,95 ≈ 4,1 s.
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

import { colors, fonts } from '@/lib/theme'

const BG = colors.cream
const ACCENT = colors.terracotta
const INK = colors.ink
const MUTED = colors.muted

/** Fin d'onboarding — la recherche se construit sous les yeux de l'acquéreur. */
export const STEPS_ONBOARDING = [
  'Analyse de votre zone idéale',
  'Calibrage du budget',
  'Profil de recherche',
  'Sélection de vos biens',
]
/** Relance depuis un intercalaire — la recherche existe, on cherche du neuf. */
export const STEPS_RERUN = ['Recherche de nouveaux biens']

/**
 * Ce que compte `getCount`, et donc ce que la validation annonce.
 *  · `'total'` — tout le feed (« 4 biens trouvés »). Fin d'onboarding : le feed
 *    naît avec l'écran, total et nouveautés sont la même chose.
 *  · `'new'` — les seuls biens absents du feed précédent (« 1 nouveau bien
 *    trouvé »). Relance : l'acquéreur vient de modifier sa recherche, il
 *    demande ce que ça a changé, pas combien de biens existent.
 */
export type CountKind = 'total' | 'new'

const ENTER = 240
const HOLD = 1000
/** Palier d'une séquence à une seule étape (cf. en-tête : plancher de 3–4 s). */
const HOLD_SOLO = 2400
const EXIT = 220
const FINAL_IN = 240
const FINAL_HOLD = 950

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function SearchStagingLoader({
  run,
  getCount,
  onFinish,
  steps = STEPS_ONBOARDING,
  countKind = 'total',
}: {
  run: () => Promise<FeedOutcome>
  getCount: () => number
  onFinish: (outcome: FeedOutcome) => void
  steps?: readonly string[]
  countKind?: CountKind
}) {
  const [index, setIndex] = useState(0)
  const [done, setDone] = useState<{ count: number } | null>(null)
  const slot = useRef(new Animated.Value(0)).current
  const finalSlot = useRef(new Animated.Value(0)).current

  // Callbacks toujours frais, mais HORS deps de l'effet de séquence. `steps` y
  // est joint pour la même raison : un appelant qui passerait un tableau
  // littéral en ferait une nouvelle identité à chaque rendu, donc une relance
  // du moteur.
  const cbs = useRef({ run, getCount, onFinish, steps })
  useEffect(() => {
    cbs.current = { run, getCount, onFinish, steps }
  })

  useEffect(() => {
    let cancelled = false
    // Séquence figée au montage : elle pilote la boucle du dessous, qui ne doit
    // pas changer de longueur en cours de route.
    const seq = cbs.current.steps
    const hold = seq.length === 1 ? HOLD_SOLO : HOLD
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
      for (let i = 0; i < seq.length; i++) {
        if (cancelled) return
        setIndex(i)
        slot.setValue(0)
        await animate(slot, 1, ENTER) // entre par le bas + fondu
        if (cancelled) return
        if (i === seq.length - 1) {
          // La dernière phrase tient AU MOINS `hold`, et davantage si le moteur
          // traîne — c'est elle qui porte l'attente, pas l'écran vide d'après.
          outcome = (await Promise.all([runP, wait(hold)]))[0]
        } else {
          await wait(hold)
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
      const count = cbs.current.getCount()
      // Zéro ne se coche pas. En `'new'`, une relance qui ne ramène aucune
      // nouveauté n'a rien à valider : on rend la main sans annonce, à
      // l'appelant d'enchaîner. L'issue reste `'ok'` — le moteur a bien
      // travaillé, c'est le RÉSULTAT qui est vide, et l'appelant, qui détient
      // la référence du feed précédent, sait le recalculer.
      if (count === 0) {
        cbs.current.onFinish('ok')
        return
      }
      setDone({ count })
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
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run/getCount/
    // onFinish/steps sont lus via `cbs` : les inclure relancerait le moteur à
    // chaque re-render.
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
            <Check size={16} strokeWidth={3} color={colors.creamOnDark} />
          </View>
          <Text style={styles.result}>
            <Text style={styles.count}>{done.count}</Text>{' '}
            {countKind === 'new'
              ? done.count > 1
                ? 'nouveaux biens trouvés'
                : 'nouveau bien trouvé'
              : done.count > 1
                ? 'biens trouvés'
                : 'bien trouvé'}
          </Text>
        </Animated.View>
      ) : (
        <Animated.View style={[styles.row, { opacity, transform: [{ translateY }] }]}>
          <ShomeeLoader size={26} />
          {/* Le « … » est posé ICI, pas dans les chaînes : la règle vaut pour
              toute étape, y compris celles qu'on ajoutera plus tard. */}
          <Text style={styles.step}>{steps[index]}…</Text>
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
  // Gris : une étape en cours décrit un travail, pas un résultat.
  step: { fontSize: 16, color: MUTED, fontWeight: '500', flexShrink: 1 },
  check: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Noir : c'est la phrase de validation.
  result: { fontSize: 17, color: INK, fontWeight: '600' },
  count: { color: ACCENT, fontFamily: fonts.serifStrong },
})
