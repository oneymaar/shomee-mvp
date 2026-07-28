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
import { BRIEF_FEED_PREFIX, generateFeedFromStore } from '@/lib/handoff'
import { FeedItem } from '@/components/FeedItem'
import { PropertyDetailSheet } from '@/components/PropertyDetailSheet'
import { SearchStagingLoader } from '@/components/onboarding/SearchStagingLoader'
import { FeedSuggestion, type AppliedChange } from '@/components/feed/FeedSuggestion'
import { diagnoseSearch, type Diagnosis, type DiagnosisTrigger } from '@/lib/searchDiagnosis'
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

/**
 * Une ligne du feed : un bien, ou l'intercalaire.
 *
 * L'intercalaire n'est plus une surcouche mais un élément du flux. Il hérite
 * ainsi gratuitement du paging, du pré-rendu et du geste de scroll — donc de la
 * continuité que l'ancien couple `setTimeout` + overlay ne pouvait pas produire :
 * la fin du feed n'est plus un mur, c'est une carte de plus.
 */
type FeedRow =
  | { kind: 'property'; property: Property }
  | { kind: 'suggestion'; diagnosis: Diagnosis }

export default function BiensScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  // Hauteur réelle du conteneur (au-dessus de la barre d'onglets) mesurée via
  // onLayout — évite de deviner la math safe-area/tab-bar pour le paging.
  const [viewportH, setViewportH] = useState(0)

  const properties = useFeedStore((s) => s.properties)
  const currentIndex = useFeedStore((s) => s.currentIndex)
  const muted = useFeedStore((s) => s.muted)
  const toggleMuted = useFeedStore((s) => s.toggleMuted)

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
  // biens vus, toujours refermable sans rien changer, et jamais deux fois pour la
  // même raison sur le même feed.
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
  const starvedSessionRef = useRef<string | null>(null)
  // `at` = index d'INSERTION de la ligne intercalaire dans le feed ; -1 = mode
  // surcouche (cas `empty`, où il n'y a pas de feed à traverser).
  const [suggestion, setSuggestion] = useState<{ diagnosis: Diagnosis; at: number } | null>(
    null,
  )
  const [rerunning, setRerunning] = useState(false)

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
  const openSuggestion = useCallback((trigger: DiagnosisTrigger, force = false) => {
    if (suggestionActiveRef.current) return false
    // `force` — le moteur vient de rendre ZÉRO bien. Ni le budget d'interruption
    // ni le garde-fou `brief:` ne s'appliquent alors : il n'y a plus de feed à
    // interrompre, et le cooldown vient justement d'être posé par la fermeture
    // de l'écran précédent, ce qui bloquerait à coup sûr. On passe quand même
    // par ce point d'entrée pour ne pas perdre le suivi ni la remise à zéro.
    // `starving` échappe au budget d'interruption : cette ligne n'interrompt
    // rien, elle est la DERNIÈRE du feed. La faire sauter par un cooldown
    // rendrait la fin du parcours muette — le mur qu'on est en train de retirer.
    // Aucun risque de harcèlement : `starvedSessionRef` la limite déjà à une
    // apparition par feed généré.
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
    const f = useFeedStore.getState()
    // Où poser la ligne ? `empty` n'a pas de feed → surcouche (-1). `starving` :
    // après le dernier bien, c'est la fin du parcours. `streak` : juste après le
    // bien courant, pour que le geste suivant tombe dessus — pas dix cartes plus
    // loin, où le constat n'aurait plus de rapport avec ce qui vient d'être vécu.
    const at =
      trigger === 'empty'
        ? -1
        : trigger === 'starving'
          ? f.properties.length
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
      // Le searchStore vient d'être modifié par l'écran (et seulement par lui,
      // sur validation explicite) : on relance le moteur avec la mise en scène
      // du récap, pour que le nombre annoncé soit celui du feed qui s'affiche.
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

  // Lignes du feed = les biens, plus éventuellement l'intercalaire inséré à
  // `at`. Une seule source de vérité (le store) : la ligne est DÉRIVÉE, jamais
  // stockée — refermer l'intercalaire la fait disparaître sans autre ménage.
  const rows = useMemo<FeedRow[]>(() => {
    const out: FeedRow[] = properties.map((property) => ({ kind: 'property', property }))
    if (!suggestion || suggestion.at < 0) return out
    const at = Math.min(Math.max(suggestion.at, 0), out.length)
    out.splice(at, 0, { kind: 'suggestion', diagnosis: suggestion.diagnosis })
    return out
  }, [properties, suggestion])
  rowsRef.current = rows
  const rowsLen = rows.length

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

  // Feed : seed instantané (transient) puis refresh live best-effort.
  //
  // (1) feedStore vide → on affiche la seed bundlée immédiatement : aucun loader,
  //     aucun écran vide (couvre aussi le cold-start Postgres ~38s).
  // (2) En arrière-plan, GET /api/properties renvoie un TABLEAU NU de biens
  //     PUBLISHED (newest first). On ne remplace la seed que si le catalogue a
  //     réellement changé ET que l'utilisateur n'a pas encore scrollé — sinon on
  //     ne l'arrache pas. Échec / réponse vide → la seed reste (best-effort).
  useEffect(() => {
    let cancelled = false

    // Feed personnalisé issu d'un handoff deep-link (session préfixée `brief:`) :
    // on n'y touche pas — ni seed, ni refresh générique /api/properties (qui
    // écraserait le feed noté). Il reste jusqu'au prochain cold start.
    if (useFeedStore.getState().feedSessionId?.startsWith(BRIEF_FEED_PREFIX)) {
      return () => {
        cancelled = true
      }
    }

    if (!useFeedStore.getState().hasFeed()) {
      useFeedStore.getState().setFeed(SEED, String(Date.now()))
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

      // Le budget d'interruption se compte en BIENS vus. Compter l'intercalaire
      // lui ferait financer son propre retour.
      viewCountRef.current += 1

      if (streakRef.current >= STREAK_N) {
        // Rejets rapides en série : les cartes défilent sans accrocher.
        openSuggestion('streak')
      } else if (rows.length >= 2 && newIndex >= rows.length - LOOKAHEAD_ROWS) {
        // Il reste au plus une ligne devant : on fabrique l'intercalaire MAINTENANT,
        // pour qu'il soit déjà monté quand le geste suivant arrivera. Une seule
        // fois par feed généré, sinon un aller-retour sur la fin le rouvrirait en
        // boucle.
        const sid = useFeedStore.getState().feedSessionId
        if (sid && starvedSessionRef.current !== sid) {
          if (openSuggestion('starving')) starvedSessionRef.current = sid
        }
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
      return (
        <FeedItem
          property={item.property}
          isActive={index === currentIndex && isFocused}
          muted={muted}
          height={viewportH}
          onOpenDetail={openDetail}
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
      onSuggestionApply,
      onSuggestionDismiss,
      onSuggestionEditBrief,
    ],
  )

  return (
    <View style={styles.root} onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}>
      {viewportH > 0 && (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(row) => (row.kind === 'suggestion' ? 'suggestion' : row.property.id)}
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

      {/* Mute global — un seul bouton au niveau du feed (pas par carte). Retiré
          sur la ligne intercalaire : il s'y poserait par-dessus la feuille, à
          l'endroit exact de la croix, et n'y couperait aucun son (aucune carte
          n'est active tant que l'intercalaire est la ligne courante). */}
      {rows[currentIndex]?.kind !== 'suggestion' && (
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
          le feed (une ligne, cf. `rows`). Ne reste ici que le cas `empty` : zéro
          bien après un élargissement, donc aucun feed à traverser. */}
      {suggestion && suggestion.at < 0 && (
        <FeedSuggestion
          diagnosis={suggestion.diagnosis}
          onApply={onSuggestionApply}
          onDismiss={onSuggestionDismiss}
          onEditBrief={onSuggestionEditBrief}
        />
      )}

      {/* Re-run du feed après évolution de la recherche (mise en scène ~7 s) */}
      {rerunning && (
        <View style={StyleSheet.absoluteFill}>
          <SearchStagingLoader
            run={generateFeedFromStore}
            getCount={() => useFeedStore.getState().properties.length}
            onFinish={(outcome) => {
              setRerunning(false)
              // Nouveau feed = nouveau départ. Sans cette remise à zéro, la liste
              // reste à l'offset de l'ancien parcours et le premier bien annoncé
              // n'est pas celui qu'on voit.
              prevIndexRef.current = 0
              setSettledIndex(0)
              useFeedStore.getState().setCurrentIndex(0)
              listRef.current?.scrollToOffset({ offset: 0, animated: false })
              // Élargissement appliqué… et toujours rien. Renvoyer l'acquéreur
              // sur l'ancien feed sans un mot lui laisserait croire que sa
              // modification a été ignorée : on rouvre l'écran, cette fois sur
              // le déclencheur `empty`, avec la recherche telle qu'elle vient
              // d'être modifiée comme nouvelle référence.
              if (outcome === 'empty') openSuggestion('empty', true)
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
