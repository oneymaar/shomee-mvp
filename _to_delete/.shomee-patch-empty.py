#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
SHOMEE — écran « aucun bien trouvé ».

Un feed vide n'est PAS une panne : c'est un résultat de recherche. Le booléen
`generateFeedFromStore(): boolean` confondait les deux, d'où le « Oups —
impossible de préparer votre sélection » affiché alors que le moteur avait
parfaitement fonctionné mais qu'un critère rédhibitoire écartait tous les biens.

7 fichiers, patch ancré (chaque remplacement doit matcher exactement une fois,
sinon on s'arrête sans rien écrire).
"""
import io
import os
import sys

ROOT = sys.argv[1] if len(sys.argv) > 1 else '.'

EDITS = []  # (relpath, [(old, new, expected_count), ...])


def E(path, *subs):
    EDITS.append((path, list(subs)))


# ── 1. apps/web — qualifier le vide côté serveur ────────────────────────────
E(
    'apps/web/app/api/feed/generate/route.ts',
    (
        """// ─── Route ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {""",
        """// ─── Route ───────────────────────────────────────────────────────────────

/**
 * Feed vide QUALIFIÉ. Le client ne peut pas distinguer « votre recherche
 * n'admet aucun bien » (résultat, à traiter par un écran d'élargissement) de
 * « le catalogue est indisponible » (panne, à traiter par un écran d'erreur)
 * s'il ne reçoit qu'un `[]`. L'en-tête porte cette distinction sans changer la
 * forme du corps : les clients antérieurs continuent de lire un tableau.
 */
function emptyFeed(reason: 'no_catalog' | 'no_generation' | 'all_excluded') {
  return NextResponse.json([], { headers: { 'x-shomee-empty-reason': reason } })
}

export async function POST(req: NextRequest) {""",
        1,
    ),
    (
        """    // Tag file vide / manquant — la page feed retombera sur /api/properties.
    return NextResponse.json([])""",
        """    // Tag file vide / manquant — la page feed retombera sur /api/properties.
    return emptyFeed('no_catalog')""",
        1,
    ),
    (
        """  if (fiches.length === 0) {
    return NextResponse.json([])
  }""",
        """  if (fiches.length === 0) {
    return emptyFeed('no_generation')
  }""",
        1,
    ),
    (
        """  const feed = scored
    .filter((p) => !p.isExcluded)
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))

  return NextResponse.json(feed)""",
        """  const feed = scored
    .filter((p) => !p.isExcluded)
    .sort((a, b) => (b.matchScore ?? 0) - (a.matchScore ?? 0))

  // Toutes les fiches écartées : un seul critère rédhibitoire suffit. C'est le
  // cas le plus fréquent de feed vide, et le seul que l'acquéreur peut corriger.
  if (feed.length === 0) return emptyFeed('all_excluded')

  return NextResponse.json(feed)""",
        1,
    ),
)

# ── 2. handoff.ts — booléen → FeedOutcome ───────────────────────────────────
E(
    'apps/mobile/src/lib/handoff.ts',
    (
        """async function generatePersonalizedFeed(
  snapshot: ReturnType<typeof buildSnapshotFromStore>,
): Promise<Property[]> {
  const res = await apiFetch('/api/feed/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as Property[]
}

// ─── 5b. Génération du feed depuis le store (partagé handoff S6a + funnel S7) ─

/**
 * Assemble le snapshot du store → POST /api/feed/generate → pose le feed noté
 * (session préfixée `brief:` pour le protéger du refresh générique du feed
 * générique). Renvoie `false` sur feed vide / erreur réseau — l'appelant décide
 * de l'UI. Utilisé par `runBriefHandoff` (handoff ChatGPT) ET par le récap du
 * funnel manuel natif (S7) : le store est agnostique de la source (token ou
 * wizard), la chaîne de génération est donc strictement la même.
 */
export async function generateFeedFromStore(): Promise<boolean> {
  let feed: Property[]
  try {
    feed = await generatePersonalizedFeed(buildSnapshotFromStore())
  } catch {
    return false
  }
  if (!Array.isArray(feed) || feed.length === 0) return false
  useFeedStore.getState().setFeed(feed, `${BRIEF_FEED_PREFIX}${Date.now()}`)
  return true
}""",
        """// ─── 5b. Génération du feed depuis le store (partagé handoff S6a + funnel S7) ─

/**
 * Issue de la génération. Le booléen d'avant confondait DEUX situations qui
 * n'ont rien à voir et méritent deux écrans opposés :
 *
 *  · `error` — la requête a échoué (réseau, 4xx/5xx, corps illisible). Rien à
 *    dire à l'acquéreur sur sa recherche : c'est nous. → « Oups, réessayez ».
 *  · `empty` — la requête a RÉUSSI, le moteur n'a simplement retenu aucun bien
 *    (typiquement : un critère rédhibitoire les exclut tous). Ce n'est pas une
 *    panne, c'est un résultat. Afficher « Impossible de préparer votre
 *    sélection » ici accusait l'app d'une décision prise par la recherche.
 *    → écran « aucun bien » + leviers d'élargissement.
 */
export type FeedOutcome = 'ok' | 'empty' | 'error'

/**
 * Le serveur peut qualifier un tableau vide via `x-shomee-empty-reason` :
 *  · `all_excluded` / `no_generation` → vide légitime, la recherche est en cause ;
 *  · `no_catalog` → catalogue de vidéos indisponible côté serveur : ce n'est PAS
 *    la faute de la recherche, proposer de l'élargir serait mensonger → error.
 * En-tête absente (déploiement antérieur) → on retombe sur `empty`, qui est le
 * cas de très loin le plus fréquent.
 */
function outcomeForEmpty(reason: string | null): FeedOutcome {
  return reason === 'no_catalog' ? 'error' : 'empty'
}

/**
 * Assemble le snapshot du store → POST /api/feed/generate → pose le feed noté
 * (session préfixée `brief:` pour le protéger du refresh générique du feed
 * générique). Utilisé par `runBriefHandoff` (handoff ChatGPT) ET par le récap du
 * funnel manuel natif (S7) : le store est agnostique de la source (token ou
 * wizard), la chaîne de génération est donc strictement la même.
 */
export async function generateFeedFromStore(): Promise<FeedOutcome> {
  let res: Response
  try {
    res = await apiFetch('/api/feed/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildSnapshotFromStore()),
    })
  } catch {
    return 'error'
  }
  if (!res.ok) return 'error'

  let feed: unknown
  try {
    feed = await res.json()
  } catch {
    return 'error'
  }
  if (!Array.isArray(feed)) return 'error'
  if (feed.length === 0) return outcomeForEmpty(res.headers.get('x-shomee-empty-reason'))

  useFeedStore.getState().setFeed(feed as Property[], `${BRIEF_FEED_PREFIX}${Date.now()}`)
  return 'ok'
}""",
        1,
    ),
    # `const ok = await generateFeedFromStore()` devenait une CHAÎNE : 'error' et
    # 'empty' sont truthy, le handoff aurait annoncé un succès sur un échec. Le
    # compilateur ne dit rien (une chaîne est une condition valide) — d'où le
    # rattrapage explicite ici.
    (
        """export type HandoffOutcome =
  | { status: 'success' }
  | { status: 'not_found' }
  | { status: 'expired' }
  | { status: 'error' }""",
        """export type HandoffOutcome =
  | { status: 'success' }
  | { status: 'not_found' }
  | { status: 'expired' }
  /** Brief valide, moteur OK, mais aucun bien ne satisfait la recherche. */
  | { status: 'empty' }
  | { status: 'error' }""",
        1,
    ),
    (
        """  // 5 → 6. Génération + pose du feed personnalisé noté (session préfixée →
  //        protégé du refresh générique). Feed vide / erreur réseau → écran
  //        d'erreur. Chaîne factorisée (partagée avec le funnel manuel S7).
  const ok = await generateFeedFromStore()
  return ok ? { status: 'success' } : { status: 'error' }""",
        """  // 5 → 6. Génération + pose du feed personnalisé noté (session préfixée →
  //        protégé du refresh générique). Chaîne factorisée (partagée avec le
  //        funnel manuel S7). Le vide remonte tel quel : un brief trop étroit
  //        n'est pas une panne et ne doit pas afficher le même écran.
  const outcome = await generateFeedFromStore()
  if (outcome === 'ok') return { status: 'success' }
  return { status: outcome === 'empty' ? 'empty' : 'error' }""",
        1,
    ),
)

# ── 3. searchDiagnosis.ts — déclencheur `empty` + levier critères réparé ─────
E(
    'apps/mobile/src/lib/searchDiagnosis.ts',
    (
        """ *  · `starving` — le feed est quasi vide / épuisé : ce sont les filtres de
 *                 capacité (budget, zone, surface) qui étranglent la recherche.
 */
export type DiagnosisTrigger = 'streak' | 'starving'""",
        """ *  · `starving` — le feed est quasi vide / épuisé : ce sont les filtres de
 *                 capacité (budget, zone, surface) qui étranglent la recherche.
 *  · `empty`    — le moteur n'a rendu AUCUN bien. C'est le cas le plus dur :
 *                 il n'y a rien à regarder, l'écran est donc un cul-de-sac s'il
 *                 ne propose pas de sortie. Une exclusion (critère rédhibitoire)
 *                 suffit à vider un feed à elle seule : elle passe donc en tête
 *                 du diagnostic, avant les leviers de capacité.
 */
export type DiagnosisTrigger = 'streak' | 'starving' | 'empty'""",
        1,
    ),
    (
        """function criteriaLever(s: SearchSnapshot, trigger: DiagnosisTrigger): Lever | null {
  const hard = hardCriteria(s)
  if (hard.length < 2) return null
  const mandatory = hard.filter((c) => c.state === 2).length
  const dealbreakers = hard.length - mandatory
  const plural = (n: number) => (n > 1 ? 's' : '')
  return {
    kind: 'criteria',
    score: Math.min(95, 30 + 15 * hard.length) + (trigger === 'streak' ? 15 : 0),
    title:
      dealbreakers > mandatory
        ? `Vous avez ${dealbreakers} critère${plural(dealbreakers)} rédhibitoire${plural(dealbreakers)}`
        : `Vous avez ${mandatory} critère${plural(mandatory)} obligatoire${plural(mandatory)}`,
    suggestion:
      'Passer un critère en « souhaité » le garde dans le classement sans exclure les biens qui ne l’ont pas.',
    short: 'Assouplir mes critères',
  }
}""",
        """/**
 * Un critère DUR est le seul levier capable de vider un feed à lui tout seul :
 * « rédhibitoire » exclut le bien, quoi qu'il vaille par ailleurs. C'est pour
 * cette raison qu'UN SEUL rédhibitoire suffit à ouvrir ce levier (le seuil de
 * deux ne vaut que pour les obligatoires, plus progressifs), et qu'il passe
 * devant tout le reste quand le moteur n'a rien rendu.
 */
function criteriaLever(s: SearchSnapshot, trigger: DiagnosisTrigger): Lever | null {
  const hard = hardCriteria(s)
  const dealbreaking = hard.filter((c) => c.state === 3)
  const dealbreakers = dealbreaking.length
  const mandatory = hard.length - dealbreakers
  if (hard.length === 0) return null
  if (dealbreakers === 0 && mandatory < 2) return null
  const plural = (n: number) => (n > 1 ? 's' : '')

  // Un seul rédhibitoire : on le NOMME. « Vous avez 1 critère rédhibitoire »
  // laisse l'acquéreur chercher lequel ; « "Lumineux" écarte tous les biens »
  // désigne le frein et rend le geste suivant évident.
  const named = dealbreakers === 1 ? `« ${dealbreaking[0].label} »` : null

  const title =
    trigger === 'empty'
      ? named
        ? `${named} écarte tous les biens`
        : dealbreakers > 0
          ? `Vos ${dealbreakers} critères rédhibitoires écartent tous les biens`
          : `Vos ${mandatory} critères obligatoires ne sont jamais tous réunis`
      : dealbreakers > mandatory
        ? `Vous avez ${dealbreakers} critère${plural(dealbreakers)} rédhibitoire${plural(dealbreakers)}`
        : `Vous avez ${mandatory} critère${plural(mandatory)} obligatoire${plural(mandatory)}`

  return {
    kind: 'criteria',
    // Sur un feed vide, l'exclusion explique le résultat à elle seule : elle
    // doit sortir devant budget / zone / surface, qui ne font que réduire.
    score:
      Math.min(95, 30 + 15 * hard.length) +
      (trigger === 'streak' ? 15 : 0) +
      (trigger === 'empty' ? (dealbreakers > 0 ? 120 : 40) : 0),
    title,
    suggestion:
      dealbreakers > 0
        ? 'Un critère rédhibitoire exclut le bien, quelles que soient ses autres qualités. En « souhaité », il fait redescendre les biens concernés dans le classement au lieu de les supprimer.'
        : 'Passer un critère en « souhaité » le garde dans le classement sans exclure les biens qui ne l’ont pas.',
    short: 'Assouplir mes critères',
  }
}""",
        1,
    ),
    # Budget / zone / surface : ces leviers de capacité pèsent aussi sur un feed
    # vide, pas seulement sur un feed épuisé.
    ("(trigger === 'starving' ? 15 : 0)", "(trigger !== 'streak' ? 15 : 0)", 3),
)

# ── 4. SearchStagingLoader.tsx — propager l'issue ───────────────────────────
E(
    'apps/mobile/src/components/onboarding/SearchStagingLoader.tsx',
    (
        """ * un check + « N biens trouvés », puis `onFinish(true)`.""",
        """ * un check + « N biens trouvés », puis `onFinish('ok')`. Une issue `'empty'`
 * (aucun bien) ou `'error'` (panne) court-circuite l'annonce chiffrée et rend
 * la main aussitôt : c'est à l'appelant de décider de l'écran suivant.""",
        1,
    ),
    (
        """import { ShomeeLoader } from './ShomeeLoader'""",
        """import { ShomeeLoader } from './ShomeeLoader'
import type { FeedOutcome } from '@/lib/handoff'""",
        1,
    ),
    (
        """  run: () => Promise<boolean>
  getCount: () => number
  onFinish: (ok: boolean) => void
}) {""",
        """  run: () => Promise<FeedOutcome>
  getCount: () => number
  onFinish: (outcome: FeedOutcome) => void
}) {""",
        1,
    ),
    (
        """    const runP = cbs.current
      .run()
      .then((ok) => ok)
      .catch(() => false)""",
        """    const runP: Promise<FeedOutcome> = cbs.current.run().catch((): FeedOutcome => 'error')""",
        1,
    ),
    (
        """      let ok = false
      for (let i = 0; i < STEPS.length; i++) {""",
        """      let outcome: FeedOutcome = 'error'
      for (let i = 0; i < STEPS.length; i++) {""",
        1,
    ),
    (
        """          ok = (await Promise.all([runP, wait(HOLD)]))[0]""",
        """          outcome = (await Promise.all([runP, wait(HOLD)]))[0]""",
        1,
    ),
    (
        """      if (!ok) {
        cbs.current.onFinish(false)
        return
      }""",
        """      // Vide ou en échec : pas d'annonce chiffrée. Un « 0 bien trouvé » coché
      // en vert avant l'écran d'après serait une fausse bonne nouvelle.
      if (outcome !== 'ok') {
        cbs.current.onFinish(outcome)
        return
      }""",
        1,
    ),
    ("""      cbs.current.onFinish(true)""", """      cbs.current.onFinish('ok')""", 1),
)

# ── 5. FeedSuggestion.tsx — l'écran sert aussi le cas « aucun bien » ────────
E(
    'apps/mobile/src/components/feed/FeedSuggestion.tsx',
    (
        """  type CriteriaEntry,
  type Diagnosis,
  type Lever,
  type LeverKind,
} from '@/lib/searchDiagnosis'""",
        """  type CriteriaEntry,
  type Diagnosis,
  type DiagnosisTrigger,
  type Lever,
  type LeverKind,
} from '@/lib/searchDiagnosis'""",
        1,
    ),
    (
        """const LEGEND: Array<{ state: 1 | 2 | 3; label: string }> = [
  { state: 1, label: 'Souhaité' },
  { state: 2, label: 'Obligatoire' },
  { state: 3, label: 'Rédhibitoire' },
]""",
        """const LEGEND: Array<{ state: 1 | 2 | 3; label: string }> = [
  { state: 1, label: 'Souhaité' },
  { state: 2, label: 'Obligatoire' },
  { state: 3, label: 'Rédhibitoire' },
]

// L'écran sert trois moments différents ; seuls le sur-titre et la phrase
// d'accroche changent, tout le reste (constat, contrôle, impact, validation)
// est identique — c'est ce qui le rend reconnaissable d'une fois sur l'autre.
const KICKER: Record<DiagnosisTrigger, string> = {
  streak: 'Faire évoluer ma recherche',
  starving: 'Faire évoluer ma recherche',
  empty: 'Aucun bien pour l’instant',
}
const INTRO: Record<DiagnosisTrigger, string> = {
  streak: 'Vous avez passé plusieurs biens rapidement.',
  starving: 'Vous avez fait le tour des biens qui correspondent.',
  empty:
    'Votre recherche est trop étroite : aucun bien du catalogue ne la satisfait aujourd’hui.',
}""",
        1,
    ),
    (
        """export function FeedSuggestion({
  diagnosis,
  onApply,
  onDismiss,
}: {
  diagnosis: Diagnosis
  onApply: (change: AppliedChange) => void
  onDismiss: () => void
}) {""",
        """export function FeedSuggestion({
  diagnosis,
  onApply,
  onDismiss,
  dismissLabel = 'Garder ma recherche telle quelle',
}: {
  diagnosis: Diagnosis
  onApply: (change: AppliedChange) => void
  onDismiss: () => void
  /**
   * Libellé de la sortie sans rien changer. Sur un feed vide il n'y a rien à
   * « garder » derrière l'écran : l'appelant dit où mène la porte de sortie.
   */
  dismissLabel?: string
}) {""",
        1,
    ),
    (
        """      // Critères : on propose le passage en « souhaité » du premier critère
      // obligatoire — le plus réversible et le moins destructeur des gestes.
      const first = baseCriteria.find((c) => c.state === 2)
      return first ? { ...prev, criteria: { ...prev.criteria, [first.key]: 1 } } : prev
    })
  }, [lever, baseCriteria])""",
        """      // Critères : on pré-positionne le passage en « souhaité » — le geste le
      // plus réversible et le moins destructeur. Sur un feed vide on vise
      // d'abord un RÉDHIBITOIRE (c'est lui qui exclut, donc lui qui explique le
      // zéro) ; sinon un obligatoire. Sans ce repli, une recherche n'ayant qu'un
      // rédhibitoire arrivait ici sans rien de pré-positionné : le bouton
      // « Appliquer » restait grisé et l'écran devenait un cul-de-sac.
      const dealbreaker = baseCriteria.find((c) => c.state === 3)
      const mandatory = baseCriteria.find((c) => c.state === 2)
      const first =
        diagnosis.trigger === 'empty' ? (dealbreaker ?? mandatory) : (mandatory ?? dealbreaker)
      return first ? { ...prev, criteria: { ...prev.criteria, [first.key]: 1 } } : prev
    })
  }, [lever, baseCriteria, diagnosis.trigger])""",
        1,
    ),
    (
        """  const intro =
    diagnosis.trigger === 'streak'
      ? 'Vous avez passé plusieurs biens rapidement.'
      : 'Vous avez fait le tour des biens qui correspondent.'""",
        """  const intro = INTRO[diagnosis.trigger]""",
        1,
    ),
    (
        """        <Text style={styles.kicker}>Faire évoluer ma recherche</Text>""",
        """        <Text style={styles.kicker}>{KICKER[diagnosis.trigger]}</Text>""",
        1,
    ),
    (
        """          accessibilityLabel="Fermer et garder ma recherche telle quelle\"""",
        """          accessibilityLabel={dismissLabel}""",
        1,
    ),
    (
        """          <Text style={styles.ghostTxt}>Garder ma recherche telle quelle</Text>""",
        """          <Text style={styles.ghostTxt}>{dismissLabel}</Text>""",
        1,
    ),
)

# ── 6. onboarding-manual.tsx — phase `empty` ────────────────────────────────
E(
    'apps/mobile/src/app/onboarding-manual.tsx',
    (
        """import { SearchStagingLoader } from '@/components/onboarding/SearchStagingLoader'
import { useFeedStore } from '@/lib/stores'""",
        """import { SearchStagingLoader } from '@/components/onboarding/SearchStagingLoader'
import { FeedSuggestion } from '@/components/feed/FeedSuggestion'
import { diagnoseSearch } from '@/lib/searchDiagnosis'
import { useFeedStore, useSearchStore } from '@/lib/stores'""",
        1,
    ),
    (
        """type Phase = 'idle' | 'generating' | 'error'""",
        """type Phase = 'idle' | 'generating' | 'empty' | 'error'""",
        1,
    ),
    (
        """  // ── Écrans de génération (loading / erreur) ──────────────────────────────
  if (phase === 'generating') {
    return (
      <SearchStagingLoader
        run={generateFeedFromStore}
        getCount={() => useFeedStore.getState().properties.length}
        onFinish={(ok) => {
          if (ok) router.replace('/(tabs)')
          else setPhase('error')
        }}
      />
    )
  }
  if (phase === 'error') {""",
        """  // ── Écrans de génération (loading / aucun bien / erreur) ─────────────────
  if (phase === 'generating') {
    return (
      <SearchStagingLoader
        run={generateFeedFromStore}
        getCount={() => useFeedStore.getState().properties.length}
        onFinish={(outcome) => {
          if (outcome === 'ok') router.replace('/(tabs)')
          else setPhase(outcome === 'empty' ? 'empty' : 'error')
        }}
      />
    )
  }
  // Aucun bien trouvé — ce n'est PAS une erreur : la recherche a abouti, elle
  // est simplement trop étroite. Même écran que les intercalaires du feed
  // (constat → proposition pré-positionnée → validation), avec le déclencheur
  // `empty` : le diagnostic met alors les critères rédhibitoires en tête, eux
  // seuls pouvant vider un feed à eux tout seuls.
  if (phase === 'empty') {
    return (
      <View style={styles.root}>
        <FeedSuggestion
          diagnosis={diagnoseSearch(useSearchStore.getState(), 'empty')}
          dismissLabel="Revenir au récapitulatif"
          onApply={() => setPhase('generating')}
          onDismiss={() => { setPhase('idle'); setRecapOpen(true) }}
        />
      </View>
    )
  }
  if (phase === 'error') {""",
        1,
    ),
)

# ── 7. (tabs)/index.tsx — re-run qui retombe sur zéro bien ──────────────────
E(
    'apps/mobile/src/app/(tabs)/index.tsx',
    (
        """  const openSuggestion = useCallback((trigger: DiagnosisTrigger) => {
    if (suggestionActiveRef.current) return false
    if (viewCountRef.current < cooldownRef.current) return false
    if (!useFeedStore.getState().feedSessionId?.startsWith(BRIEF_FEED_PREFIX)) return false
""",
        """  const openSuggestion = useCallback((trigger: DiagnosisTrigger, force = false) => {
    if (suggestionActiveRef.current) return false
    // `force` — le moteur vient de rendre ZÉRO bien. Ni le budget d'interruption
    // ni le garde-fou `brief:` ne s'appliquent alors : il n'y a plus de feed à
    // interrompre, et le cooldown vient justement d'être posé par la fermeture
    // de l'écran précédent, ce qui bloquerait à coup sûr. On passe quand même
    // par ce point d'entrée pour ne pas perdre le suivi ni la remise à zéro.
    if (!force && viewCountRef.current < cooldownRef.current) return false
    if (
      !force &&
      !useFeedStore.getState().feedSessionId?.startsWith(BRIEF_FEED_PREFIX)
    ) {
      return false
    }
""",
        1,
    ),
    (
        """          <SearchStagingLoader
            run={generateFeedFromStore}
            getCount={() => useFeedStore.getState().properties.length}
            onFinish={() => setRerunning(false)}
          />""",
        """          <SearchStagingLoader
            run={generateFeedFromStore}
            getCount={() => useFeedStore.getState().properties.length}
            onFinish={(outcome) => {
              setRerunning(false)
              // Élargissement appliqué… et toujours rien. Renvoyer l'acquéreur
              // sur l'ancien feed sans un mot lui laisserait croire que sa
              // modification a été ignorée : on rouvre l'écran, cette fois sur
              // le déclencheur `empty`, avec la recherche telle qu'elle vient
              // d'être modifiée comme nouvelle référence.
              if (outcome === 'empty') openSuggestion('empty', true)
            }}
          />""",
        1,
    ),
)


# ── Application ─────────────────────────────────────────────────────────────
def main():
    planned = []
    problems = []
    for rel, subs in EDITS:
        path = os.path.join(ROOT, rel)
        if not os.path.isfile(path):
            problems.append(f'MANQUANT  {rel}')
            continue
        with io.open(path, encoding='utf-8') as fh:
            text = fh.read()
        original = text
        for old, new, expected in subs:
            found = text.count(old)
            if found != expected:
                head = old.strip().splitlines()[0][:70]
                problems.append(f'ANCRE     {rel} :: attendu {expected}, trouvé {found} — « {head} »')
                continue
            text = text.replace(old, new)
        if text != original:
            planned.append((path, rel, text))

    if problems:
        sys.stderr.write('\n'.join(problems) + '\n')
        sys.stderr.write('\nAUCUN fichier écrit.\n')
        return 1

    for path, rel, text in planned:
        with io.open(path, 'w', encoding='utf-8') as fh:
            fh.write(text)
        print(f'ok  {rel}')
    print(f'\n{len(planned)} fichier(s) écrit(s).')
    return 0


if __name__ == '__main__':
    sys.exit(main())
