import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlatList, Pressable, StyleSheet, View, type ViewToken } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { BottomSheetModal } from '@gorhom/bottom-sheet'
import { useIsFocused, useRouter } from 'expo-router'
import { Volume2, VolumeX } from 'lucide-react-native'
import feedSeed from '@shomee/core/data/feedSeed.json'
import type { Property } from '@shomee/core/types/domain'
import { useFeedStore, useSearchStore } from '@/lib/stores'
import { apiFetch } from '@/lib/api'
import {
  BRIEF_FEED_PREFIX,
  generateDiscoveryFeed,
  generateFeedFromStore,
  rehydrateJournal,
  takeDiscoveryLane,
  type FeedOutcome,
} from '@/lib/handoff'
import { FeedItem } from '@/components/FeedItem'
import { PropertyDetailSheet } from '@/components/PropertyDetailSheet'
import { SearchStagingLoader, STEPS_RERUN } from '@/components/onboarding/SearchStagingLoader'
import { FeedSuggestion, type AppliedChange } from '@/components/feed/FeedSuggestion'
import { DiscoveryAnnouncement } from '@/components/feed/DiscoveryAnnouncement'
import { FeedTerminus } from '@/components/feed/FeedTerminus'
import { diagnoseSearch, type Diagnosis, type DiagnosisTrigger } from '@/lib/searchDiagnosis'
import {
  buildWideningPlan,
  describeAnyDiscovery,
  describeDiscovery,
  discoveryDistance,
  readWideningSnapshot,
  DISCOVERY_DEADLINE_MS,
  DISCOVERY_MAX_PER_STEP,
  DISCOVERY_MAX_TOTAL,
  type DiscoveryNotice,
  type WideningSnapshot,
} from '@/lib/wideningPlan'
import { track } from '@/lib/tracker'

// Seed bundlé (4 biens, URLs Cloudinary absolues) — source unique partagée avec
// le web (@shomee/core/data). v1 : seed uniquement, pas de feed live (brief/token).
const SEED = feedSeed as unknown as Property[]

/**
 * Onglet Biens — feed vidéo vertical (S4b).
 *
 * FlatList paginé plein écran : une seule vidéo joue à la fois (la carte visible),
 * déterminée par `onViewableItemsChanged`. Surcouches (overlay + action rail) dans
 * FeedItem. Mute global (feedStore) via un bouton unique au niveau du feed.
 */
const FAST_SKIP_MS = 3000 // < 3 s sur une carte = skip rapide
const STREAK_N = 3 // skips rapides consécutifs = « ces biens ne me parlent pas »
const SUGGESTION_COOLDOWN_VIEWS = 12 // biens à revoir avant qu'un intercalaire revienne
// Coup d'avance : l'intercalaire est fabriqué quand il reste LOOKAHEAD_ROWS lignes
// à parcourir, et non au moment où l'on bute sur la dernière. Il est alors déjà
// monté (windowSize={3} pré-rend la ligne suivante) et arrive AU SCROLL, comme un
// bien — au lieu de surgir après une temporisation sur un feed devenu inerte.
const LOOKAHEAD_ROWS = 2
// Biens à voir avant que l'écran de fin de feed puisse revenir. Il ne s'agit
// PAS d'un cooldown de plus : c'est le garde-fou « jamais deux fois d'affilée ».
// Depuis que la relance AJOUTE au lieu de remplacer, le feed garde sa session —
// un verrou posé une fois par session tairait donc l'écran pour toujours, et
// l'acquéreur buterait à nouveau sur un mur muet à la fin du feed élargi. Le
// verrou se lève donc au compteur de biens vus : après une relance, il faut en
// avoir réellement traversé trois de plus pour qu'on redemande d'élargir.
const STARVING_REARM_VIEWS = 3

/**
 * Une ligne du feed : un bien, l'intercalaire, ou l'annonce d'un bien hors
 * critères.
 *
 * L'intercalaire n'est plus une surcouche mais un élément du flux. Il hérite
 * ainsi gratuitement du paging, du pré-rendu et du geste de scroll — donc de la
 * continuité que l'ancien couple `setTimeout` + overlay ne pouvait pas produire :
 * la fin du feed n'est plus un mur, c'est une carte de plus.
 *
 * `announce` suit exactement la même logique, mais ne demande RIEN : c'est
 * l'écran informatif qui précède un bien rapporté par la voie découverte
 * (étape 2 de l'élargissement). Deux différences de comportement avec
 * l'intercalaire, et une seule règle derrière : l'annonce n'interrompt pas, elle
 * introduit. Elle ne gèle donc pas le scroll (l'acquéreur ouvre lui-même) et ne
 * se paie pas sur le budget d'interruption.
 */
type FeedRow =
  | { kind: 'property'; property: Property }
  | { kind: 'suggestion'; diagnosis: Diagnosis }
  | { kind: 'announce'; property: Property; notice: DiscoveryNotice }
  /** Terminus : plus rien à montrer — stock lu, rayon de découverte épuisé. */
  | { kind: 'terminus' }

/** Options d'ouverture d'un intercalaire — cf. `openSuggestion`. */
type OpenOpts = {
  /** Passer outre le budget d'interruption ET le garde-fou `brief:`. */
  force?: boolean
  /**
   * Poser l'écran EN SURCOUCHE (`at = -1`) au lieu de l'insérer dans le feed.
   * Réservé aux constats qui doivent se lire TOUT DE SUITE : inséré en fin de
   * feed, le même texte n'arriverait qu'après avoir re-scrollé des biens déjà
   * vus, et l'action qui vient de l'appeler semblerait sans effet.
   */
  overlay?: boolean
}

export default function BiensScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  // Hauteur réelle du conteneur (au-dessus de la barre d'onglets) mesurée via
  // onLayout — évite de deviner la math safe-area/tab-bar pour le paging.
  const [viewportH, setViewportH] = useState(0)

  const properties = useFeedStore((s) => s.properties)
  const feedSessionId = useFeedStore((s) => s.feedSessionId)
  const currentIndex = useFeedStore((s) => s.currentIndex)
  const muted = useFeedStore((s) => s.muted)
  const toggleMuted = useFeedStore((s) => s.toggleMuted)
  // Journal persistant (lot 1) : la liste attend le verdict de l'hydratation
  // pour se monter — sinon elle naîtrait vide, puis sauterait à l'état restauré.
  const journalHydrated = useFeedStore((s) => s.journalHydrated)
  // Photo des biens vus AVANT ce lancement — c'est elle qui porte le marqueur
  // « Déjà vu », jamais `seen` : re-scroller un bien dans la même session n'est
  // pas du déjà-vu, le re-croiser une session plus tard, si.
  const seenAtLaunch = useFeedStore((s) => s.seenAtLaunch)

  // Écran focalisé ? Les onglets restent MONTÉS quand on navigue (autre onglet
  // ou écran empilé par-dessus les tabs) : sans ce garde, la carte active
  // continuerait de jouer (et le son de tourner) hors écran. Le focus est
  // hiérarchique → false aussi quand un écran est empilé au-dessus des tabs.
  const isFocused = useIsFocused()

  // PropertyDetailSheet : un seul modal au niveau du feed, présenté avec le bien
  // sélectionné depuis la carte (« Voir l'annonce » de l'overlay).
  const sheetRef = useRef<BottomSheetModal>(null)
  const [detail, setDetail] = useState<Property | null>(null)

  // ── P6 — intercalaire « faire évoluer ma recherche » ─────────────────────
  //
  // Deux déclencheurs, un seul écran (FeedSuggestion) :
  //  · `streak`   — STREAK_N rejets rapides d'affilée : les biens passent bien
  //                 les filtres, mais ils ne plaisent pas → c'est le déclaratif
  //                 fin (les critères) qui est le plus suspect ;
  //  · `starving` — la dernière carte du feed est atteinte : sur ces filtres, il
  //                 n'y a tout simplement plus rien à montrer.
  //
  // Budget d'interruption : au plus un intercalaire par SUGGESTION_COOLDOWN_VIEWS
  // biens vus, toujours refermable sans rien changer.
  //
  // JAMAIS DEUX FOIS D'AFFILÉE. `starving` échappe au budget — il ne coupe rien,
  // il est la fin du parcours — mais pas à cette règle-là : après avoir demandé
  // d'élargir, on doit d'abord MONTRER quelque chose. L'ordre est
  // élargissement → biens hors critères annoncés → et seulement ensuite, si le
  // mur revient, la question à nouveau. D'où STARVING_REARM_VIEWS.
  //
  // Il n'est proposé que sur un feed PERSONNALISÉ (session `brief:`). Sur le
  // catalogue générique, annoncer « votre recherche est trop étroite » serait
  // faux : ce n'est pas elle qui a produit les cartes affichées.
  const shownAtRef = useRef(Date.now())
  const prevIndexRef = useRef(0)
  const streakRef = useRef(0)
  const viewCountRef = useRef(0)
  const cooldownRef = useRef(0)
  const suggestionActiveRef = useRef(false)
  // Nombre de biens vus à partir duquel l'écran de fin de feed peut réapparaître.
  // `Infinity` = jamais ; il est réarmé à `viewCountRef + STARVING_REARM_VIEWS`
  // chaque fois qu'il s'affiche, et remis à 0 quand l'acquéreur relance.
  const starvedRearmAtRef = useRef(0)

  // ── Lot 3 — la machine de fin de parcours ────────────────────────────────
  //
  // La découverte se sert PAR COUCHES : chaque passage en fin de feed en tente
  // une (voie serveur d'abord, puis une étape du plan d'élargissement), et la
  // suivante n'arrive qu'à la fin de feed suivante — le rayon s'épuise au rythme
  // de la lecture, pas d'un coup. `running` empêche deux couches simultanées ;
  // `done` = plus rien dans le rayon → le terminus prend la parole.
  const discoveryPhaseRef = useRef<'idle' | 'running' | 'done'>('idle')
  // Biens hors-brief déjà servis pour cette recherche — la borne DISCOVERY_MAX_TOTAL
  // est un plafond de session de découverte, toutes couches confondues.
  const discoveryCountRef = useRef(0)
  // Étape 1 déjà proposée pour cette recherche ? Elle ne se propose qu'une fois
  // par lancement : qu'il élargisse ou referme, la fin de feed suivante passe à
  // la découverte. (Le refus n'est pas une impasse — « toujours une porte ».)
  const wideningShownRef = useRef(false)
  const terminusTrackedRef = useRef(false)
  // La ligne terminus est DÉRIVÉE (cf. `rows`) et ESTAMPILLÉE de la génération
  // qui l'a posée — même mécanique que les annonces : une nouvelle constitution
  // l'invalide toute seule, sans remise à zéro à orchestrer.
  const [terminusFor, setTerminusFor] = useState<string | null>(null)
  // `at` = index d'INSERTION de la ligne intercalaire dans le feed ; -1 = mode
  // surcouche (cas `empty`, où il n'y a pas de feed à traverser).
  const [suggestion, setSuggestion] = useState<{ diagnosis: Diagnosis; at: number } | null>(
    null,
  )
  const [rerunning, setRerunning] = useState(false)
  // Miroir ref de `rerunning`, pour les chemins qui ne peuvent pas lire l'état
  // (le callback de viewabilité est figé au premier rendu, et l'effet de fin de
  // feed tire pendant le loader). Tant que la relance tourne, l'aiguillage de
  // fin de feed doit se taire : la fermeture de l'intercalaire raccourcit la
  // liste d'une ligne, l'index encore posé dessus « dépasse » alors du feed, et
  // sans ce verrou l'aiguillage croyait la lecture finie — il lançait une
  // couche de découverte EN PARALLÈLE de la relance, avec la voie découverte de
  // l'ANCIENNE recherche : un bien hors critères s'intercalait avant les biens
  // que l'acquéreur venait de demander, et l'atterrissage tombait sur son
  // annonce. (Bug du 29/07, vu au premier test du lot 3.)
  const rerunningRef = useRef(false)
  // Empreinte du feed AVANT la relance. La validation du loader annonce alors
  // les NOUVEAUTÉS (« 1 nouveau bien trouvé ») et non le total : l'acquéreur
  // qui vient de modifier sa recherche demande ce que ça a CHANGÉ, pas combien
  // de biens existent. Le diff vit ICI, côté appelant, parce que c'est ici —
  // et nulle part ailleurs — qu'on détient la référence de l'ancien feed.
  const idsBeforeRerunRef = useRef<Set<string>>(new Set())

  // ── Étape 2 — voie découverte ────────────────────────────────────────────
  //
  // État de la recherche AVANT que l'acquéreur ne touche à l'intercalaire. Il ne
  // sert qu'à une chose, mais elle est décisive : mesurer ce qu'il a lâché de
  // lui-même à l'étape 1, pour que le système élargisse d'abord ailleurs. Celui
  // qui vient de pousser son budget de 20 % a dit ce qu'il pensait du budget —
  // le repousser encore serait ne pas l'avoir écouté.
  const wideningBeforeRef = useRef<WideningSnapshot | null>(null)
  // Annonces à afficher, par id de bien. C'est la SEULE mémoire de la découverte
  // côté rendu : les lignes `announce` en sont dérivées (cf. `rows`), jamais
  // stockées.
  //
  // Elles sont ESTAMPILLÉES de la génération qui les a produites, et n'ont de
  // sens que pour elle. Sans ça : l'acquéreur découvre un bien à 585 000 €
  // annoncé « au-dessus de votre maximum : 500 000 € », puis remonte lui-même
  // son budget à 700 000 € — le bien revient légitimement dans le feed suivant,
  // et l'annonce, elle, répéterait un dépassement qui n'existe plus. Une annonce
  // fausse est pire que pas d'annonce du tout.
  const [notices, setNotices] = useState<{
    sessionId: string | null
    byId: Record<string, DiscoveryNotice>
  }>({ sessionId: null, byId: {} })

  const countNewProperties = useCallback(
    () =>
      useFeedStore
        .getState()
        .properties.filter((p) => !idsBeforeRerunRef.current.has(p.id)).length,
    [],
  )

  /**
   * VOIE DÉCOUVERTE — le système élargit à la place de l'acquéreur, une fois que
   * l'acquéreur a élargi lui-même sans résultat.
   *
   * UN CRITÈRE À LA FOIS, et on s'arrête au premier qui donne : desserrer le
   * budget ET la zone ET la surface d'un coup ramènerait des biens dont on ne
   * saurait plus dire en quoi ils sortent de la recherche — donc rien
   * d'annonçable, et une sélection qui n'aurait plus grand-chose à voir avec ce
   * que l'acquéreur a demandé.
   *
   * L'INVARIANT TIENT : `generateDiscoveryFeed` pose l'élargissement sur une
   * COPIE du snapshot. Rien n'est écrit dans `searchStore` — la recherche
   * déclarée reste exactement celle que l'acquéreur a validée, et c'est bien à
   * elle que les annonces se réfèrent (« votre maximum : 500 000 € »).
   */
  const runDiscovery = useCallback(async (): Promise<number> => {
    // Ce qu'il reste du rayon : le plafond global moins ce qui a déjà été servi.
    const batchCap = Math.min(
      DISCOVERY_MAX_PER_STEP,
      DISCOVERY_MAX_TOTAL - discoveryCountRef.current,
    )
    if (batchCap <= 0) return 0
    const declared = readWideningSnapshot(useSearchStore.getState())
    // Génération à laquelle ces annonces appartiennent. `appendFeed` ne la
    // change pas, exprès : les biens découverts font partie de CE feed-là.
    const sessionId = useFeedStore.getState().feedSessionId
    const known = new Set(useFeedStore.getState().properties.map((p) => p.id))

    /** Pose un lot dans le feed avec ses annonces. Rend le nombre de biens posés. */
    const commit = (
      batch: Property[],
      noticeOf: (p: Property) => DiscoveryNotice | null,
    ): number => {
      if (batch.length === 0) return 0
      const next: Record<string, DiscoveryNotice> = {}
      for (const p of batch) {
        known.add(p.id)
        const notice = noticeOf(p)
        if (notice) next[p.id] = notice
      }
      // La raison d'entrée + la trace d'annonce partent au JOURNAL (méta, data
      // d'historique) ; l'affichage des annonces, lui, reste dérivé de `notices`
      // (état React) — éphémère, conformément à la doctrine.
      const journalNotices: Record<string, { kind: string; line: string }> = {}
      for (const [id, n] of Object.entries(next)) {
        journalNotices[id] = { kind: n.kind, line: n.line }
      }
      useFeedStore.getState().appendFeed(batch, 'discovery', journalNotices)
      setNotices((prev) =>
        prev.sessionId === sessionId
          ? { sessionId, byId: { ...prev.byId, ...next } }
          : { sessionId, byId: next },
      )
      return batch.length
    }

    // ── Source 1 : la voie découverte DU MOTEUR ────────────────────────────
    //
    // Elle est arrivée avec la requête principale, sans qu'on ait rien élargi :
    // ce sont les biens à UNE relaxation près (budget ≤ +7 %, surface ≥ −5 %,
    // une pièce de moins, ou un seul autre obligatoire manqué). Donc plus
    // proches de la recherche que tout ce qu'on pourrait fabriquer avec un
    // +30 %, et déjà payés. C'est le coup d'avance : on la sert d'abord.
    const laneNotices = new Map<string, DiscoveryNotice>()
    const candidates: { p: Property; d: number }[] = []
    for (const p of takeDiscoveryLane()) {
      if (!p?.id || known.has(p.id)) continue
      const notice = describeAnyDiscovery(p, declared, p.discoveryDelta)
      // PAS D'ANNONCE POSSIBLE ⇒ PAS DE BIEN. Ces biens-là sont hors brief par
      // construction (le serveur ne les met dans cette voie qu'à ce titre) : les
      // glisser sans un mot serait exactement l'infiltration muette que l'étape 2
      // interdit. On préfère en montrer moins que d'en montrer sans le dire.
      // Depuis le 29/07, ce filtre emporte aussi les biens « une pièce en
      // moins » : l'axe a quitté le vocabulaire, ils n'ont plus d'annonce.
      if (!notice) continue
      const d = discoveryDistance(p, declared, p.discoveryDelta)
      if (d > 1) continue // au-delà de la borne du rayon : jamais proposé
      laneNotices.set(p.id, notice)
      candidates.push({ p, d })
    }
    // « Aussi légèrement que possible » est un TRI : du plus proche du brief au
    // plus loin — jamais l'inverse.
    const lane = candidates
      .sort((a, b) => a.d - b.d)
      .slice(0, batchCap)
      .map((c) => c.p)
    const served = commit(lane, (p) => laneNotices.get(p.id) ?? null)
    if (served > 0) return served

    // ── Source 2 : filet — on élargit nous-mêmes, un critère à la fois ──────
    const plan = buildWideningPlan(wideningBeforeRef.current ?? declared, declared)
    // Garde-fou de durée : la voie découverte tourne DANS le loader, et le
    // loader tient l'acquéreur. Un critère qui traîne ne doit pas retarder les
    // biens déjà trouvés — on rend la main plutôt que de faire attendre.
    const deadline = Date.now() + DISCOVERY_DEADLINE_MS

    for (const step of plan) {
      if (Date.now() > deadline) break
      const found = await generateDiscoveryFeed(step.patch)
      // Un bien déjà dans le feed n'est pas une découverte : le ré-annoncer
      // ferait passer pour une trouvaille ce que l'acquéreur a déjà écarté.
      const fresh = found
        .filter((p) => p && p.id && !known.has(p.id))
        .map((p) => ({ p, d: discoveryDistance(p, declared) }))
        .filter((c) => c.d <= 1)
        .sort((a, b) => a.d - b.d)
        .slice(0, batchCap)
        .map((c) => c.p)
      if (fresh.length === 0) continue

      // Ici, contrairement à la source 1, l'absence d'annonce ne disqualifie pas
      // le bien : il vient d'une requête ÉLARGIE, dont le lot contient aussi des
      // biens parfaitement dans les critères déclarés (le dédoublonnage par vidéo
      // a pu les écarter du premier appel). `describeDiscovery` rend alors `null`,
      // et le bien rejoint le feed sans un mot — parce qu'il n'y a rien à dire.
      return commit(fresh, (p) => describeDiscovery(p, declared, step.kind))
    }
    return 0
  }, [])

  /**
   * Ce que fait le loader de relance : le moteur d'abord, la découverte ensuite
   * — et ensuite SEULEMENT si la relance n'a rien rapporté de neuf.
   *
   * ON AJOUTE, ON NE REMPLACE PAS (`'append'`). Élargir une recherche, c'est en
   * étendre le périmètre, pas en ouvrir une autre : les biens déjà vus restent
   * valides et restent donc là où ils étaient. Remplacer coupait le feed en deux
   * — plus moyen de remonter à ce qu'on venait de regarder, et l'écran se
   * comportait comme une nouvelle recherche alors que l'acquéreur n'en avait pas
   * lancé une. Le dédoublonnage par id de `appendFeed` fait le reste : les biens
   * que la nouvelle requête renvoie à l'identique ne sont pas dupliqués.
   *
   * La découverte tourne DANS le loader, pas après lui. Deux raisons : le compte
   * annoncé à la fin (« 1 nouveau bien trouvé ») inclut alors les biens
   * découverts, ce qui est la vérité de ce qui attend l'acquéreur juste en
   * dessous ; et il n'y a aucun trou entre la fin du loader et l'arrivée des
   * biens, où l'écran aurait montré un feed inchangé pendant une seconde.
   *
   * `'empty'` ne veut plus dire « écran vide » — le feed précédent est toujours
   * là — mais « la requête élargie n'a rien ramené ». On tente quand même la
   * découverte avant de conclure : elle puise dans la voie découverte du moteur
   * et dans des requêtes élargies, elle peut donc rapporter là où la voie
   * principale n'a rien eu. C'est seulement si elle échoue aussi qu'on renvoie
   * `'empty'` et que l'écran de constat s'ouvre.
   */
  const runRerun = useCallback(async (): Promise<FeedOutcome> => {
    const outcome = await generateFeedFromStore('append')
    if (outcome === 'error') return 'error'
    if (countNewProperties() > 0) return 'ok'
    // `running` le temps de l'appel : la fin de feed peut se re-déclencher
    // pendant le loader (viewabilité sur les lignes ajoutées) — deux couches de
    // découverte simultanées serviraient deux fois les mêmes biens.
    discoveryPhaseRef.current = 'running'
    discoveryCountRef.current += await runDiscovery()
    discoveryPhaseRef.current = 'idle'
    if (countNewProperties() > 0) return 'ok'
    return outcome
  }, [countNewProperties, runDiscovery])

  // Index de la ligne RÉELLEMENT posée, mis à jour à la fin de l'inertie — à ne
  // pas confondre avec `currentIndex`, que `onViewableItemsChanged` publie dès
  // 60 % de visibilité, donc PENDANT la décélération. Couper `scrollEnabled` à
  // cet instant-là figerait la liste entre deux pages.
  const [settledIndex, setSettledIndex] = useState(0)
  const listRef = useRef<FlatList<FeedRow>>(null)
  // Miroir des lignes pour le callback de viewability, que RN exige STABLE et
  // qui ne peut donc pas capturer l'état.
  const rowsRef = useRef<FeedRow[]>([])
  const shownTrackedRef = useRef(false)

  // Point d'entrée unique des deux déclencheurs : le budget d'interruption et le
  // garde-fou `brief:` vivent ici, en un seul endroit. Renvoie true si armé.
  const openSuggestion = useCallback((trigger: DiagnosisTrigger, opts: OpenOpts = {}) => {
    const { force = false, overlay = false } = opts
    if (suggestionActiveRef.current) return false
    // `force` — le moteur vient de tourner sans rien apporter (zéro bien, ou
    // zéro NOUVEAU bien). Ni le budget d'interruption ni le garde-fou `brief:`
    // ne s'appliquent alors : le cooldown vient justement d'être posé par la
    // fermeture de l'écran précédent, ce qui bloquerait à coup sûr, et c'est
    // bien nous qui venons de relancer la recherche. On passe quand même par ce
    // point d'entrée pour ne pas perdre le suivi ni la remise à zéro.
    // `starving` échappe au budget d'interruption : cette ligne n'interrompt
    // rien, elle est la DERNIÈRE du feed. La faire sauter par un cooldown
    // rendrait la fin du parcours muette — le mur qu'on est en train de retirer.
    // Aucun risque de harcèlement : `starvedRearmAtRef` lui impose déjà
    // STARVING_REARM_VIEWS biens vus entre deux apparitions.
    if (!force && trigger !== 'starving' && viewCountRef.current < cooldownRef.current) {
      return false
    }
    if (
      !force &&
      !useFeedStore.getState().feedSessionId?.startsWith(BRIEF_FEED_PREFIX)
    ) {
      return false
    }

    const diagnosis = diagnoseSearch(useSearchStore.getState(), trigger)
    // Photo de la recherche AVANT que l'acquéreur ne touche à l'écran qui
    // s'ouvre. Prise ICI et pas ailleurs : c'est le dernier instant où elle est
    // encore intacte. Comparée à celle d'« Appliquer et relancer », elle dit
    // quel critère il a lui-même le moins desserré — donc lequel le système
    // pourra desserrer à sa place, si sa propre tentative ne donne rien.
    wideningBeforeRef.current = readWideningSnapshot(useSearchStore.getState())
    const f = useFeedStore.getState()
    // Où poser la ligne ? `empty` → surcouche (-1). Le feed n'est plus vide pour
    // autant — depuis que la relance ajoute au lieu de remplacer, les biens
    // d'avant sont toujours là — mais le constat porte sur la recherche qu'on
    // vient de relancer, pas sur eux : l'insérer entre deux cartes déjà vues le
    // rendrait incompréhensible, et l'acquéreur devrait scroller pour lire une
    // réponse à ce qu'il vient de demander. `starving` :
    // après la dernière LIGNE, c'est la fin du parcours — en lignes et non en
    // biens, car les annonces de la voie découverte en occupent aussi et
    // compter les biens poserait l'écran de fin avant les dernières cartes.
    // `streak` : juste après le bien courant, pour que le geste suivant tombe
    // dessus — pas dix cartes plus loin, où le constat n'aurait plus de rapport
    // avec ce qui vient d'être vécu (`currentIndex` est déjà un index de LIGNE).
    const at =
      trigger === 'empty' || overlay
        ? -1
        : trigger === 'starving'
          ? rowsRef.current.length
          : f.currentIndex + 1

    suggestionActiveRef.current = true
    streakRef.current = 0
    shownTrackedRef.current = false
    // La ligne est fabriquée EN AVANCE : à cet instant elle n'est pas vue. Le
    // suivi part donc quand elle devient visible (cf. onViewableItemsChanged).
    // Seule la surcouche `empty` est à l'écran dès son montage.
    if (at < 0) {
      track({
        type: 'interstitial_shown',
        meta: { kind: 'search_suggestion', trigger, lever: diagnosis.primary.kind },
      })
      shownTrackedRef.current = true
    }
    setSuggestion({ diagnosis, at })
    return true
  }, [])

  // Fermeture commune : referme l'écran et repousse le prochain intercalaire.
  const closeSuggestion = useCallback(() => {
    setSuggestion(null)
    suggestionActiveRef.current = false
    cooldownRef.current = viewCountRef.current + SUGGESTION_COOLDOWN_VIEWS
  }, [])

  const onSuggestionApply = useCallback(
    (change: AppliedChange) => {
      track({
        type: 'interstitial_accepted',
        meta: { kind: 'search_suggestion', lever: change.lever, summary: change.summary },
      })
      closeSuggestion()
      // Empreinte du feed AVANT la relance. Elle sert deux fois, et elle est la
      // seule à pouvoir le faire : compter les nouveautés à la fin du loader, et
      // dire où reposer la liste — sur la première ligne qui n'y figure pas.
      idsBeforeRerunRef.current = new Set(
        useFeedStore.getState().properties.map((p) => p.id),
      )
      // Les annonces de la relance précédente n'ont plus lieu d'être : elles
      // parlaient d'une recherche qui vient de changer. Et comme les biens sont
      // désormais AJOUTÉS, ceux qu'elles annonçaient sont toujours là : sans
      // cette remise à zéro, un bien passé dans les critères garderait au-dessus
      // de lui un écran qui le dit hors critères. Il redevient un bien comme un
      // autre — ce qu'il est.
      setNotices({ sessionId: null, byId: {} })
      // Une relance ROUVRE le rayon : la recherche vient de changer, la
      // découverte repart de zéro sur ce nouveau périmètre, et le terminus n'a
      // plus lieu d'être — retrait explicite, car `appendFeed` garde la même
      // session et l'estampille ne l'invaliderait pas seule. L'étape 1, elle,
      // vient d'être consommée.
      wideningShownRef.current = true
      discoveryPhaseRef.current = 'idle'
      discoveryCountRef.current = 0
      terminusTrackedRef.current = false
      setTerminusFor(null)
      // Le searchStore vient d'être modifié par l'écran (et seulement par lui,
      // sur validation explicite) : on relance le moteur avec la mise en scène
      // du récap, pour que le nombre annoncé soit celui du feed qui s'affiche.
      // Le miroir ref passe à true AVANT le re-render : la fermeture de
      // l'intercalaire va faire tirer l'effet de fin de feed, qui doit déjà
      // trouver porte close.
      rerunningRef.current = true
      setRerunning(true)
    },
    [closeSuggestion],
  )

  const onSuggestionDismiss = useCallback(() => {
    track({ type: 'interstitial_dismissed', meta: { kind: 'search_suggestion' } })
    closeSuggestion()
  }, [closeSuggestion])

  // « Revoir toute ma recherche » — la sortie quand notre proposition n'est pas la
  // bonne. On referme l'intercalaire AVANT de naviguer : sans cela il serait
  // encore ouvert au retour sur l'onglet, par-dessus un feed peut-être déjà
  // régénéré entre-temps.
  const onSuggestionEditBrief = useCallback(() => {
    track({ type: 'interstitial_dismissed', meta: { kind: 'search_suggestion' } })
    closeSuggestion()
    router.push('/onboarding-manual?recap=1')
  }, [closeSuggestion, router])

  // « Ajuster ma recherche » depuis le terminus — même destination, mais rien à
  // refermer : le terminus est une ligne, pas un intercalaire.
  const onTerminusEditBrief = useCallback(() => {
    track({ type: 'interstitial_accepted', meta: { trigger: 'terminus', action: 'edit_brief' } })
    router.push('/onboarding-manual?recap=1')
  }, [router])

  // ── L'aiguillage de fin de feed (lot 3, spec feed v2 §3) ─────────────────
  //
  // UNE couche de découverte par passage : la voie serveur d'abord (instantanée,
  // déjà payée), puis une étape du plan d'élargissement. Si la couche rapporte,
  // le feed s'allonge et le scroll continue — la couche suivante attendra la
  // prochaine fin de feed. Si elle ne rapporte rien (ou que le plafond
  // DISCOVERY_MAX_TOTAL est atteint), le rayon est épuisé : le terminus prend
  // la parole, et il ne la rend plus pour cette recherche.
  const maybeDiscoverAtEnd = useCallback(() => {
    if (discoveryPhaseRef.current === 'running') return
    const stamp = () => setTerminusFor(useFeedStore.getState().feedSessionId)
    if (
      discoveryPhaseRef.current === 'done' ||
      discoveryCountRef.current >= DISCOVERY_MAX_TOTAL
    ) {
      discoveryPhaseRef.current = 'done'
      stamp()
      return
    }
    discoveryPhaseRef.current = 'running'
    void runDiscovery().then((added) => {
      discoveryCountRef.current += added
      if (added > 0) {
        discoveryPhaseRef.current = 'idle'
      } else {
        discoveryPhaseRef.current = 'done'
        stamp()
      }
    })
  }, [runDiscovery])

  // La FIN DE FEED n'est plus un seul écran mais un AIGUILLAGE, décidé par le
  // diagnostic de la recherche (shape, posé à chaque constitution) :
  //  · étroite (sparse) et pas encore invitée → étape 1, l'acquéreur élargit
  //    LUI-MÊME (l'intercalaire, une seule proposition par lancement — qu'il
  //    élargisse ou referme, la suite passe à la découverte : un refus n'est
  //    pas une impasse) ;
  //  · calibrée ou large → le mur vient du stock, pas du brief : lui dire
  //    « élargissez » serait un mauvais diagnostic — découverte directement ;
  //  · rayon épuisé → terminus.
  const onEndOfFeed = useCallback(() => {
    // Le loader de relance est ouvert : c'est LUI qui orchestre (append, puis
    // découverte si besoin, puis atterrissage). L'aiguillage se tait — cf. le
    // commentaire de `rerunningRef` pour la course qu'il provoquait sinon.
    if (rerunningRef.current) return
    // Un intercalaire est déjà posé (typiquement l'étape 1, en dernière ligne,
    // scroll gelé) : rien ne doit s'ajouter derrière lui — des biens découverts
    // insérés sous un écran infranchissable seraient servis à personne, et la
    // ligne d'étape 1 se retrouverait en sandwich au milieu du feed.
    if (suggestionActiveRef.current) return
    const f = useFeedStore.getState()
    // Jamais sur le catalogue générique : ni « votre recherche est trop
    // étroite » (elle n'a pas produit ces cartes), ni biens hors-brief (il n'y
    // a pas de brief), ni terminus.
    if (!f.feedSessionId?.startsWith(BRIEF_FEED_PREFIX)) return
    if (f.shape === 'sparse' && !wideningShownRef.current) {
      if (viewCountRef.current < starvedRearmAtRef.current) return
      if (openSuggestion('starving')) {
        wideningShownRef.current = true
        starvedRearmAtRef.current = viewCountRef.current + STARVING_REARM_VIEWS
      }
      return
    }
    maybeDiscoverAtEnd()
  }, [openSuggestion, maybeDiscoverAtEnd])

  // Lignes du feed = les biens, chacun précédé de son annonce s'il en a une,
  // plus éventuellement l'intercalaire inséré à `at`. Une seule source de vérité
  // (le store) : la ligne est DÉRIVÉE, jamais stockée — refermer l'intercalaire
  // la fait disparaître sans autre ménage, et vider `notices` suffit à effacer
  // les annonces sans toucher au feed.
  const rows = useMemo<FeedRow[]>(() => {
    // Une génération plus récente a remplacé celle qui a produit ces annonces :
    // elles ne décrivent plus la recherche en cours, on n'en montre aucune.
    const byId = notices.sessionId === feedSessionId ? notices.byId : null
    const out: FeedRow[] = []
    for (const property of properties) {
      const notice = byId?.[property.id]
      // L'annonce vient AVANT : elle prépare, elle ne commente pas après coup.
      if (notice) out.push({ kind: 'announce', property, notice })
      out.push({ kind: 'property', property })
    }
    if (suggestion && suggestion.at >= 0) {
      const at = Math.min(Math.max(suggestion.at, 0), out.length)
      out.splice(at, 0, { kind: 'suggestion', diagnosis: suggestion.diagnosis })
    }
    // Le terminus ferme la marche — toujours la dernière ligne, dérivée et
    // estampillée comme les annonces : une génération plus récente l'efface.
    if (terminusFor != null && terminusFor === feedSessionId) {
      out.push({ kind: 'terminus' })
    }
    return out
  }, [properties, notices, feedSessionId, suggestion, terminusFor])
  rowsRef.current = rows
  const rowsLen = rows.length

  // LA FIN DE FEED DOIT POUVOIR EXISTER SANS GESTE. Sur un feed d'un seul bien
  // (parcours C typique — « 1 bien trouvé »), onViewableItemsChanged ne tire
  // jamais : l'index ne change pas, la branche « avant-dernière ligne » ne
  // s'arme donc jamais, et l'acquéreur bute sur un mur muet — impossible de
  // scroller, aucun intercalaire. Même impasse sur un journal restauré
  // directement sur sa dernière ligne. Cet effet fabrique la ligne de fin dès
  // que la position courante est DÉJÀ dans la fenêtre du coup d'avance, avec
  // exactement les garde-fous de la branche de scroll : réarmement en biens vus
  // (pas de boucle après refermeture — le compteur n'avance pas sans scroll) et
  // garde `brief:` dans openSuggestion (jamais sur le catalogue générique).
  useEffect(() => {
    if (!journalHydrated || rowsLen === 0) return
    if (suggestionActiveRef.current) return
    if (useFeedStore.getState().currentIndex < rowsLen - LOOKAHEAD_ROWS) return
    onEndOfFeed()
  }, [journalHydrated, rowsLen, feedSessionId, onEndOfFeed])

  // Nouvelle constitution (nouvelle recherche, handoff, catalogue) → machine de
  // fin de parcours neuve. `appendFeed` ne change pas la session, exprès : une
  // relance passe par le reset explicite d'`onSuggestionApply`, pas par ici.
  // (La ligne terminus, estampillée de la session, s'invalide toute seule.)
  useEffect(() => {
    discoveryPhaseRef.current = 'idle'
    discoveryCountRef.current = 0
    wideningShownRef.current = false
    terminusTrackedRef.current = false
  }, [feedSessionId])

  const scrollToRow = useCallback((index: number) => {
    // On dégèle TOUT DE SUITE, sans attendre l'événement de fin d'inertie : si
    // celui-ci se perdait, le feed resterait verrouillé pour de bon.
    setSettledIndex(index)
    listRef.current?.scrollToIndex({ index, animated: true })
  }, [])

  const openDetail = useCallback((p: Property) => {
    // Ouvrir le détail = engagement → on casse la streak de rejets.
    streakRef.current = 0
    setDetail(p)
    sheetRef.current?.present()
  }, [])

  // Boot du feed — LE JOURNAL D'ABORD (lot 1), le générique ensuite.
  //
  // (0) `hydrateJournal` restaure le feed persistant depuis le disque. Restauré
  //     → on repart à la position quittée (une liseuse, pas un magazine qu'on
  //     rouvre à la première page), et on rafraîchit les fiches en arrière-plan
  //     (`rehydrateJournal` : prix à jour, biens vendus marqués pour la
  //     PROCHAINE ouverture — rien ne bouge sous le doigt). Les nouveautés « en
  //     haut de la pile » brancheront ici au lot 6, et primeront alors sur la
  //     position de reprise.
  // (1) Rien à restaurer et pas de feed noté en mémoire → seed bundlée
  //     immédiate : aucun loader, aucun écran vide (couvre le cold-start
  //     Postgres ~38s).
  // (2) En arrière-plan, GET /api/properties renvoie un TABLEAU NU de biens
  //     PUBLISHED. On ne remplace la seed que si le catalogue a réellement
  //     changé ET que l'utilisateur n'a pas encore scrollé — sinon on ne
  //     l'arrache pas. Échec / réponse vide → la seed reste (best-effort).
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      const restored = await useFeedStore.getState().hydrateJournal()
      if (cancelled) return
      const store = useFeedStore.getState()

      if (restored === 'restored') {
        // La carte de reprise est « vue » et redevient la position courante —
        // le premier geste de scroll partira d'elle, pas d'un état fantôme.
        const resumed = store.properties[store.lastReadIndex]
        if (resumed) {
          store.markSeen(resumed.id)
          store.setLastRead(resumed.id)
        }
        prevIndexRef.current = store.lastReadIndex
        setSettledIndex(store.lastReadIndex)
        rehydrateJournal()
        return
      }

      // Feed personnalisé déjà en mémoire (handoff deep-link parti avant le
      // montage de l'onglet) : on n'y touche pas — ni seed, ni refresh générique
      // /api/properties (qui écraserait le feed noté).
      if (store.feedSessionId?.startsWith(BRIEF_FEED_PREFIX)) return

      if (!store.hasFeed()) {
        store.setFeed(SEED, String(Date.now()))
      }

      apiFetch('/api/properties')
        .then((r) => (r.ok ? r.json() : null))
        .then((live: Property[] | null) => {
          if (cancelled || !Array.isArray(live) || live.length === 0) return
          // Re-test du garde-fou `brief:` À LA RÉSOLUTION, pas seulement au montage :
          // l'onboarding pose son feed personnalisé APRÈS que ce fetch soit parti.
          // Sans ce test, un /api/properties lent écrase le feed noté et l'écran
          // affiche le catalogue générique alors qu'on vient d'annoncer « N biens
          // trouvés » — exactement l'incohérence 4 annoncés / 3 affichés.
          if (useFeedStore.getState().feedSessionId?.startsWith(BRIEF_FEED_PREFIX)) return
          const seedIds = SEED.map((p) => p.id).join(',')
          const liveIds = live.slice(0, SEED.length).map((p) => p.id).join(',')
          // Le seed n'est qu'un aperçu (SEED.length biens, = les plus récents de la
          // base) ; le live porte tout le catalogue publié. On swap sauf si le live
          // est STRICTEMENT identique au seed (même taille ET mêmes ids) — cas rare
          // où la base n'aurait que ces biens. live[0] === seed[0] → aucun flash.
          if (live.length === SEED.length && liveIds === seedIds) return
          if (useFeedStore.getState().currentIndex !== 0) return // ne pas arracher l'utilisateur
          useFeedStore.getState().setFeed(live, String(Date.now()))
        })
        .catch(() => {}) // best-effort : la seed reste affichée
    })()

    return () => {
      cancelled = true
    }
  }, [])

  // RN exige une ref STABLE pour onViewableItemsChanged / viewabilityConfig.
  const onViewableItemsChanged = useRef(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems[0]
      if (first?.index == null) return
      const newIndex = first.index
      const prev = prevIndexRef.current
      if (newIndex === prev) return

      const now = Date.now()
      const dwell = now - shownAtRef.current
      const rows = rowsRef.current
      const leftRow = rows[prev]
      // L'intercalaire n'est pas un bien : le quitter vite n'est pas un rejet.
      const leftCard = leftRow?.kind === 'property' ? leftRow.property : null

      if (newIndex > prev && leftCard && dwell < FAST_SKIP_MS) {
        track({ type: 'skip_fast', propertyId: leftCard.id, valueMs: dwell })
        streakRef.current += 1
      } else {
        if (newIndex > prev && leftCard) {
          track({ type: 'skip', propertyId: leftCard.id, valueMs: dwell })
        }
        streakRef.current = 0
      }

      prevIndexRef.current = newIndex
      shownAtRef.current = now
      useFeedStore.getState().setCurrentIndex(newIndex)

      // Arrivée SUR l'intercalaire : c'est ici, et seulement ici, qu'il est vu.
      const arrived = rows[newIndex]
      if (arrived && arrived.kind === 'suggestion') {
        if (!shownTrackedRef.current) {
          shownTrackedRef.current = true
          track({
            type: 'interstitial_shown',
            meta: {
              kind: 'search_suggestion',
              trigger: arrived.diagnosis.trigger,
              lever: arrived.diagnosis.primary.kind,
            },
          })
        }
        return
      }

      // L'annonce n'est pas un bien non plus : elle introduit celui qui la suit
      // immédiatement. La compter reviendrait à faire payer au bien découvert le
      // droit d'être présenté — et à rapprocher l'intercalaire suivant à chaque
      // découverte, alors qu'on vient justement d'apporter quelque chose.
      if (arrived && arrived.kind === 'announce') return

      // Le terminus non plus : il se voit (suivi, une fois), il ne se compte pas.
      if (arrived && arrived.kind === 'terminus') {
        if (!terminusTrackedRef.current) {
          terminusTrackedRef.current = true
          track({ type: 'interstitial_shown', meta: { trigger: 'terminus' } })
        }
        return
      }

      // Le journal note le passage : premier horodatage — c'est le « déjà vu »
      // des sessions suivantes, jamais de celle-ci — et position de reprise pour
      // la réouverture. La carte QUITTÉE est marquée aussi : la toute première
      // (index 0) n'émet jamais d'« arrivée » — prev démarre à 0 — et ne serait
      // sinon jamais vue. Écritures débouncées côté store.
      if (leftCard) useFeedStore.getState().markSeen(leftCard.id)
      if (arrived?.kind === 'property') {
        useFeedStore.getState().markSeen(arrived.property.id)
        useFeedStore.getState().setLastRead(arrived.property.id)
      }

      // Le budget d'interruption se compte en BIENS vus. Compter l'intercalaire
      // lui ferait financer son propre retour.
      viewCountRef.current += 1

      if (streakRef.current >= STREAK_N) {
        // Rejets rapides en série : les cartes défilent sans accrocher.
        openSuggestion('streak')
      } else if (rows.length >= 2 && newIndex >= rows.length - LOOKAHEAD_ROWS) {
        // Fin de feed en approche — coup d'avance : ce qui doit suivre (étape 1,
        // couche de découverte, terminus) se fabrique MAINTENANT, pour être déjà
        // monté quand le geste suivant arrivera. L'aiguillage vit dans
        // `onEndOfFeed` ; le verrou de l'étape 1 se compte toujours en biens vus.
        onEndOfFeed()
      }
    },
  ).current
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current

  const renderItem = useCallback(
    ({ item, index }: { item: FeedRow; index: number }) => {
      if (item.kind === 'suggestion') {
        return (
          <FeedSuggestion
            diagnosis={item.diagnosis}
            height={viewportH}
            onApply={onSuggestionApply}
            onEditBrief={onSuggestionEditBrief}
            // Le scroll est gelé sur cette ligne : le chevron est la seule
            // remontée. Absent en tête de feed, où il n'y a rien au-dessus.
            onBack={index > 0 ? () => scrollToRow(index - 1) : undefined}
            // « Passer » n'existe que s'il reste un bien derrière. En fin de
            // feed il n'y a rien à passer : le proposer serait un cul-de-sac.
            onDismiss={index < rowsLen - 1 ? onSuggestionDismiss : undefined}
          />
        )
      }
      // Annonce d'un bien hors critères : rien à décider, rien à toucher. Elle
      // ne reçoit donc ni `onBack` ni `onDismiss` — c'est le scroll, et lui
      // seul, qui la traverse.
      if (item.kind === 'announce') {
        return <DiscoveryAnnouncement notice={item.notice} height={viewportH} />
      }
      // Terminus : le stock est lu, le rayon épuisé. Une seule sortie (ajuster
      // sa recherche) — la promesse de notification attend la veille (lot 6).
      if (item.kind === 'terminus') {
        return <FeedTerminus height={viewportH} onEditBrief={onTerminusEditBrief} />
      }
      return (
        <FeedItem
          property={item.property}
          isActive={index === currentIndex && isFocused}
          muted={muted}
          height={viewportH}
          onOpenDetail={openDetail}
          // « Déjà vu » = vu lors d'une session ANTÉRIEURE (photo à l'hydratation),
          // jamais dans celle-ci — re-scroller un bien à l'instant ne le grise pas.
          alreadySeen={seenAtLaunch[item.property.id] != null}
        />
      )
    },
    [
      viewportH,
      currentIndex,
      muted,
      isFocused,
      openDetail,
      rowsLen,
      scrollToRow,
      seenAtLaunch,
      onSuggestionApply,
      onSuggestionDismiss,
      onSuggestionEditBrief,
      onTerminusEditBrief,
    ],
  )

  return (
    <View style={styles.root} onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}>
      {viewportH > 0 && journalHydrated && (
        <FlatList
          ref={listRef}
          data={rows}
          // Position de reprise du journal restauré (0 sinon). Lu au montage
          // seulement — la liste ne se monte qu'une fois `journalHydrated`, donc
          // la valeur est déjà posée. `getItemLayout` la rend fiable sans mesure.
          initialScrollIndex={useFeedStore.getState().lastReadIndex}
          // L'annonce et le bien qu'elle introduit partagent le même id : sans
          // le préfixe, la FlatList les prendrait pour un doublon et n'en
          // monterait qu'un.
          keyExtractor={(row) =>
            row.kind === 'suggestion'
              ? 'suggestion'
              : row.kind === 'terminus'
                ? 'terminus'
                : row.kind === 'announce'
                  ? `announce:${row.property.id}`
                  : row.property.id
          }
          renderItem={renderItem}
          extraData={`${currentIndex}|${muted}|${isFocused}|${rowsLen}`}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          // Feed gelé tant que l'intercalaire est la ligne POSÉE : sans cela, un
          // geste vertical dans l'écran partirait dans la carte du dessous, et
          // emporterait l'intercalaire hors de vue avant qu'il soit lu. On lit
          // `settledIndex` (fin d'inertie) et non `currentIndex` (60 % de
          // visibilité) : couper le scroll en pleine décélération figerait la
          // liste entre deux pages.
          //
          // Les lignes `announce`, elles, restent SCROLLABLES, et c'est tout le
          // principe : l'annonce pose une question (« ça vous intéresse quand
          // même ? ») à laquelle on répond en scrollant. Geler la liste ici, ou
          // pire la faire défiler toute seule, imposerait un bien hors critères
          // au lieu de le proposer.
          scrollEnabled={rows[settledIndex]?.kind !== 'suggestion'}
          onMomentumScrollEnd={(e) =>
            setSettledIndex(
              viewportH > 0 ? Math.round(e.nativeEvent.contentOffset.y / viewportH) : 0,
            )
          }
          getItemLayout={(_, index) => ({
            length: viewportH,
            offset: viewportH * index,
            index,
          })}
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          /* Pas de `removeClippedSubviews` ici : l'intercalaire porte une
             WebView (la carte), et iOS peut détacher les vues hors écran — la
             carte serait rechargée au retour, sélection en cours perdue. */
        />
      )}

      {/* Mute global — un seul bouton au niveau du feed (pas par carte). Il
          n'apparaît QUE sur un bien : sur l'intercalaire il se poserait par-
          dessus la feuille, à l'endroit exact de la croix, et sur l'annonce il
          serait un bouton blanc sur fond crème, seul élément touchable d'un
          écran qui ne demande précisément rien. Dans les deux cas il ne
          couperait aucun son — aucune vidéo ne joue sur ces lignes. */}
      {rows[currentIndex]?.kind === 'property' && (
        <Pressable
          onPress={toggleMuted}
          style={[styles.muteBtn, { top: insets.top + 12 }]}
          hitSlop={10}
        >
          {muted ? <VolumeX size={16} color="#fff" /> : <Volume2 size={16} color="#fff" />}
        </Pressable>
      )}

      {/* Detail sheet — partagé par toutes les cartes, présenté à la demande */}
      <PropertyDetailSheet ref={sheetRef} property={detail} />

      {/* Intercalaire P6 — « faire évoluer ma recherche ». Il vit désormais DANS
          le feed (une ligne, cf. `rows`). Ne restent ici que les surcouches :
          `empty` (l'élargissement n'a rien ramené) et le constat de fin de
          relance — deux réponses immédiates à un geste que l'acquéreur vient de
          faire, qui doivent être lues sans avoir à scroller. */}
      {suggestion && suggestion.at < 0 && (
        <FeedSuggestion
          diagnosis={suggestion.diagnosis}
          onApply={onSuggestionApply}
          onDismiss={onSuggestionDismiss}
          onEditBrief={onSuggestionEditBrief}
        />
      )}

      {/* Re-run du feed après évolution de la recherche.
          UNE seule étape (« Recherche de nouveaux biens… », ~4 s) : la recherche
          existe déjà, il n'y a plus rien à « analyser » ni à « calibrer ». Et la
          validation compte les NOUVEAUTÉS, pas le total — cf. countNewProperties. */}
      {rerunning && (
        <View style={StyleSheet.absoluteFill}>
          <SearchStagingLoader
            steps={STEPS_RERUN}
            countKind="new"
            run={runRerun}
            getCount={countNewProperties}
            onFinish={(outcome) => {
              rerunningRef.current = false
              setRerunning(false)
              // OÙ REPOSER LE FEED — sur la PREMIÈRE LIGNE QUI N'ÉTAIT PAS LÀ
              // avant la relance, jamais en tête.
              //
              // Les biens arrivent désormais À LA SUITE (cf. `runRerun`). Tout ce
              // qui précède est du déjà-vu : reposer la liste en 0 obligerait
              // l'acquéreur à re-scroller l'intégralité du connu pour atteindre ce
              // qu'on vient de lui annoncer, et lui donnerait l'impression d'une
              // recherche repartie de zéro — précisément ce qu'on corrige.
              //
              // La règle vaut pour les deux voies d'un seul tenant : un bien
              // découvert est neuf lui aussi, et son annonce le précède en portant
              // le même bien, donc on tombe sur l'annonce, pas sur le bien nu.
              //
              // Rien de neuf ? On ne bouge pas. La relance n'a rien changé à ce
              // qu'il regardait — l'y laisser est la seule chose honnête à faire.
              const target = (() => {
                const rows = rowsRef.current
                const i = rows.findIndex(
                  (r) =>
                    (r.kind === 'property' || r.kind === 'announce') &&
                    !idsBeforeRerunRef.current.has(r.property.id),
                )
                if (i >= 0) return i
                // L'intercalaire vient de quitter la liste : sans ce plafond, on
                // viserait une ligne qui n'existe plus.
                return Math.min(prevIndexRef.current, Math.max(0, rows.length - 1))
              })()
              prevIndexRef.current = target
              setSettledIndex(target)
              useFeedStore.getState().setCurrentIndex(target)
              listRef.current?.scrollToOffset({ offset: target * viewportH, animated: false })
              // Élargissement appliqué… et toujours rien. Renvoyer l'acquéreur
              // sur l'ancien feed sans un mot lui laisserait croire que sa
              // modification a été ignorée : on rouvre l'écran, cette fois sur
              // le déclencheur `empty`, avec la recherche telle qu'elle vient
              // d'être modifiée comme nouvelle référence.
              if (outcome === 'empty') {
                openSuggestion('empty', { force: true })
                return
              }
              if (outcome !== 'ok') return
              // ÉTAPE 1 SANS EFFET, ET ÉTAPE 2 NON PLUS — l'acquéreur a élargi
              // LUI-MÊME, puis le système a élargi à sa place dans le loader, et
              // il ne reste toujours aucun bien qu'il n'ait déjà. Le rayon est
              // dit : c'est le TERMINUS qui répond, posé en dernière ligne et
              // amené SOUS LES YEUX — le laisser hors champ ferait passer la
              // relance pour ignorée.
              //
              // `countNewProperties` compte le feed complet, découverte
              // comprise : si la voie découverte a rapporté quoi que ce soit, on
              // ne passe pas ici, et c'est l'annonce qui parle à notre place.
              if (countNewProperties() === 0) {
                discoveryPhaseRef.current = 'done'
                setTerminusFor(useFeedStore.getState().feedSessionId)
                // La ligne n'existera qu'au prochain rendu : l'index visé est
                // la fin de la liste ACTUELLE (annonces comprises), où elle va
                // se poser ; le scroll part une frame plus tard.
                const t = rowsRef.current.length
                prevIndexRef.current = t
                setSettledIndex(t)
                useFeedStore.getState().setCurrentIndex(t)
                requestAnimationFrame(() => {
                  listRef.current?.scrollToOffset({ offset: t * viewportH, animated: false })
                })
              }
            }}
          />
        </View>
      )}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  muteBtn: {
    position: 'absolute',
    right: 16,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.5)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
})
