import { useCallback, useEffect, useRef, useState } from 'react'
import { FlatList, Pressable, StyleSheet, View, type ViewToken } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import type { BottomSheetModal } from '@gorhom/bottom-sheet'
import { useIsFocused } from 'expo-router'
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
// Délai de grâce sur la dernière carte : on laisse la vidéo se regarder avant de
// proposer quoi que ce soit. Ouvrir l'intercalaire à l'instant où l'on arrive sur
// le dernier bien reviendrait à le masquer sans que l'acquéreur l'ait vu.
const STARVING_DELAY_MS = 6000

export default function BiensScreen() {
  const insets = useSafeAreaInsets()
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
  const starveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [suggestion, setSuggestion] = useState<Diagnosis | null>(null)
  const [rerunning, setRerunning] = useState(false)

  const cancelStarveTimer = useCallback(() => {
    if (starveTimerRef.current) {
      clearTimeout(starveTimerRef.current)
      starveTimerRef.current = null
    }
  }, [])

  // Écran quitté (autre onglet, détail empilé) ou démonté : on désarme. Sinon
  // l'intercalaire s'ouvrirait hors-champ et attendrait au retour.
  useEffect(() => {
    if (!isFocused) cancelStarveTimer()
    return cancelStarveTimer
  }, [isFocused, cancelStarveTimer])

  // Point d'entrée unique des deux déclencheurs : le budget d'interruption et le
  // garde-fou `brief:` vivent ici, en un seul endroit. Renvoie true si armé.
  const openSuggestion = useCallback((trigger: DiagnosisTrigger, force = false) => {
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

    const diagnosis = diagnoseSearch(useSearchStore.getState(), trigger)
    suggestionActiveRef.current = true
    streakRef.current = 0
    track({
      type: 'interstitial_shown',
      meta: { kind: 'search_suggestion', trigger, lever: diagnosis.primary.kind },
    })
    setSuggestion(diagnosis)
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
      const props = useFeedStore.getState().properties
      const leftCard = props[prev]

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
      viewCountRef.current += 1
      useFeedStore.getState().setCurrentIndex(newIndex)

      if (streakRef.current >= STREAK_N) {
        // Rejets rapides en série : les cartes défilent sans accrocher.
        cancelStarveTimer()
        openSuggestion('streak')
      } else if (props.length >= 2 && newIndex >= props.length - 1) {
        // Fin du feed atteinte : sur ces filtres, il n'y a plus rien. On arme un
        // délai de grâce plutôt que d'ouvrir tout de suite — la dernière carte a
        // droit d'être regardée. Une seule fois par feed généré, sinon un
        // aller-retour sur la fin rouvrirait l'écran en boucle.
        const sid = useFeedStore.getState().feedSessionId
        if (sid && starvedSessionRef.current !== sid && !starveTimerRef.current) {
          starveTimerRef.current = setTimeout(() => {
            starveTimerRef.current = null
            // Toujours sur la dernière carte du MÊME feed ? Alors c'est bien la
            // recherche qui est à sec, pas un simple passage.
            const f = useFeedStore.getState()
            if (f.feedSessionId !== sid) return
            if (f.currentIndex !== f.properties.length - 1) return
            if (openSuggestion('starving')) starvedSessionRef.current = sid
          }, STARVING_DELAY_MS)
        }
      } else {
        // On a quitté la fin du feed : le décompte de grâce n'a plus lieu d'être.
        cancelStarveTimer()
      }
    },
  ).current
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 60 }).current

  const renderItem = useCallback(
    ({ item, index }: { item: Property; index: number }) => (
      <FeedItem
        property={item}
        isActive={index === currentIndex && isFocused}
        muted={muted}
        height={viewportH}
        onOpenDetail={openDetail}
      />
    ),
    [viewportH, currentIndex, muted, isFocused, openDetail],
  )

  return (
    <View style={styles.root} onLayout={(e) => setViewportH(e.nativeEvent.layout.height)}>
      {viewportH > 0 && (
        <FlatList
          data={properties}
          keyExtractor={(p) => p.id}
          renderItem={renderItem}
          extraData={`${currentIndex}|${muted}|${isFocused}`}
          pagingEnabled
          showsVerticalScrollIndicator={false}
          onViewableItemsChanged={onViewableItemsChanged}
          viewabilityConfig={viewabilityConfig}
          getItemLayout={(_, index) => ({
            length: viewportH,
            offset: viewportH * index,
            index,
          })}
          windowSize={3}
          initialNumToRender={1}
          maxToRenderPerBatch={2}
          removeClippedSubviews
        />
      )}

      {/* Mute global — un seul bouton au niveau du feed (pas par carte) */}
      <Pressable
        onPress={toggleMuted}
        style={[styles.muteBtn, { top: insets.top + 12 }]}
        hitSlop={10}
      >
        {muted ? <VolumeX size={16} color="#fff" /> : <Volume2 size={16} color="#fff" />}
      </Pressable>

      {/* Detail sheet — partagé par toutes les cartes, présenté à la demande */}
      <PropertyDetailSheet ref={sheetRef} property={detail} />

      {/* Intercalaire P6 — « faire évoluer ma recherche » :
          constat → proposition pré-positionnée → validation explicite. */}
      {suggestion && (
        <FeedSuggestion
          diagnosis={suggestion}
          onApply={onSuggestionApply}
          onDismiss={onSuggestionDismiss}
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
