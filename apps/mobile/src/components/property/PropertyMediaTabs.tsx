import { useCallback, useMemo, useRef, useState } from 'react'
import {
  View,
  Text,
  FlatList,
  Pressable,
  Modal,
  ScrollView,
  StyleSheet,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native'
import { Image } from 'expo-image'
import * as WebBrowser from 'expo-web-browser'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronLeft, ChevronRight, Maximize2, X } from 'lucide-react-native'

/**
 * react-native-webview est un module NATIF : indisponible tant que le dev build
 * n'a pas été reconstruit (`expo prebuild --clean && expo run:ios`). On le charge
 * derrière un try/catch pour NE PAS crasher l'app au démarrage si le natif n'est
 * pas encore présent → le tour retombe alors sur un CTA « ouvrir le navigateur ».
 * Une fois le natif rebuild, la WebView inline + plein écran s'activent seules.
 */
let RNWebView: React.ComponentType<{
  source: { uri: string }
  style?: object
  allowsInlineMediaPlayback?: boolean
  allowsFullscreenVideo?: boolean
}> | null = null
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  RNWebView = require('react-native-webview').WebView
} catch {
  RNWebView = null
}

/**
 * PropertyMediaTabs — switcher média en tête de la PropertyDetailSheet.
 *
 * - Photos / Plan → carrousel infini (swipe + flèches + points). Tap une image
 *   → plein écran ZOOMABLE (pincer pour agrandir).
 * - Visite virtuelle → WebView chargée INLINE + bouton plein écran (si le natif
 *   est présent) ; sinon CTA → navigateur in-app.
 * - États vides par onglet.
 */

type TabKey = 'photos' | 'plan' | 'tour'
type MediaSource = string | number

export type PropertyMediaTabsProps = {
  photos?: string[] | null
  planUrls?: MediaSource[] | null
  virtualTourUrl?: string | null
  coverUrl?: string | null
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'photos', label: 'Photos' },
  { key: 'plan', label: 'Plan' },
  { key: 'tour', label: 'Visite virtuelle' },
]

const HERO_HEIGHT = 260
const ACCENT = '#A64B27'

const imgSource = (m: MediaSource) => (typeof m === 'string' ? { uri: m } : m)

type Fullscreen =
  | { kind: 'image'; source: MediaSource }
  | { kind: 'tour'; url: string }
  | null

export function PropertyMediaTabs({
  photos,
  planUrls,
  virtualTourUrl,
  coverUrl,
}: PropertyMediaTabsProps) {
  const [heroW, setHeroW] = useState(0)
  const [fs, setFs] = useState<Fullscreen>(null)
  const safePhotos = photos ?? []
  const safePlans = planUrls ?? []

  const has = useMemo(
    () => ({
      photos: safePhotos.length > 0,
      plan: safePlans.length > 0,
      tour: !!virtualTourUrl,
    }),
    [safePhotos.length, safePlans.length, virtualTourUrl],
  )

  const defaultTab: TabKey = has.photos
    ? 'photos'
    : (TABS.find((t) => has[t.key])?.key ?? 'photos')
  const [active, setActive] = useState<TabKey>(defaultTab)

  const openImage = useCallback((source: MediaSource) => setFs({ kind: 'image', source }), [])

  return (
    <View style={styles.wrap}>
      {/* Segmented control — largeur figée par onglet (fantôme bold invisible). */}
      <View style={styles.tabRow}>
        {TABS.map((t) => {
          const selected = active === t.key
          return (
            <Pressable key={t.key} onPress={() => setActive(t.key)} hitSlop={8}>
              <View style={styles.labelBox}>
                <Text style={[styles.label, styles.labelBold, styles.ghost]}>{t.label}</Text>
                <Text
                  style={[styles.labelAbs, selected ? styles.labelBold : styles.labelMuted]}
                  numberOfLines={1}
                >
                  {t.label}
                </Text>
              </View>
              <View style={[styles.underline, selected && styles.underlineOn]} />
            </Pressable>
          )
        })}
      </View>

      {/* Zone hero */}
      <View style={styles.hero} onLayout={(e) => setHeroW(e.nativeEvent.layout.width)}>
        {active === 'photos' &&
          (has.photos ? (
            heroW > 0 ? (
              <MediaCarousel items={safePhotos} width={heroW} contentFit="cover" onExpand={openImage} />
            ) : null
          ) : (
            <EmptyMedia label="Photos bientôt disponibles" />
          ))}

        {active === 'plan' &&
          (has.plan ? (
            heroW > 0 ? (
              <MediaCarousel items={safePlans} width={heroW} contentFit="contain" onExpand={openImage} />
            ) : null
          ) : (
            <EmptyMedia label="Plan bientôt disponible" />
          ))}

        {active === 'tour' &&
          (has.tour ? (
            RNWebView ? (
              <View style={styles.fill}>
                <RNWebView
                  source={{ uri: virtualTourUrl! }}
                  style={styles.fill}
                  allowsInlineMediaPlayback
                  allowsFullscreenVideo
                />
                <Pressable
                  style={styles.expandBtn}
                  onPress={() => setFs({ kind: 'tour', url: virtualTourUrl! })}
                  hitSlop={8}
                >
                  <Maximize2 size={18} color="#fff" strokeWidth={2.2} />
                </Pressable>
              </View>
            ) : (
              // Fallback (natif webview absent) : poster + CTA → navigateur in-app.
              <Pressable style={styles.mediaCard} onPress={() => WebBrowser.openBrowserAsync(virtualTourUrl!)}>
                {coverUrl ? (
                  <Image source={{ uri: coverUrl }} style={StyleSheet.absoluteFill} contentFit="cover" />
                ) : null}
                <View style={styles.overlay}>
                  <View style={styles.ctaPill}>
                    <Text style={styles.ctaText}>Lancer la visite virtuelle</Text>
                  </View>
                </View>
              </Pressable>
            )
          ) : (
            <EmptyMedia label="Visite virtuelle bientôt disponible" />
          ))}
      </View>

      {/* Plein écran */}
      {fs?.kind === 'image' && <FullscreenImage source={fs.source} onClose={() => setFs(null)} />}
      {fs?.kind === 'tour' && <FullscreenTour url={fs.url} onClose={() => setFs(null)} />}
    </View>
  )
}

/* ── Carrousel média infini ────────────────────────────────────────────────── */
function MediaCarousel({
  items,
  width,
  contentFit,
  onExpand,
}: {
  items: MediaSource[]
  width: number
  contentFit: 'cover' | 'contain'
  onExpand: (item: MediaSource) => void
}) {
  const n = items.length
  const loop = n > 1
  const listRef = useRef<FlatList<MediaSource>>(null)
  const data = loop ? [...items, ...items, ...items] : items
  const startIdx = loop ? n : 0
  const idxRef = useRef(startIdx)
  const [dot, setDot] = useState(0)

  const mod = (i: number) => ((i % n) + n) % n

  const recenter = useCallback(
    (idx: number): number => {
      if (!loop) return idx
      if (idx < n || idx >= 2 * n) {
        const centered = n + mod(idx)
        requestAnimationFrame(() =>
          listRef.current?.scrollToOffset({ offset: centered * width, animated: false }),
        )
        return centered
      }
      return idx
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [loop, n, width],
  )

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const idx = Math.round(e.nativeEvent.contentOffset.x / width)
    setDot(mod(idx))
    idxRef.current = recenter(idx)
  }

  const go = (dir: 1 | -1) => {
    const next = idxRef.current + dir
    idxRef.current = next
    setDot(mod(next))
    listRef.current?.scrollToOffset({ offset: next * width, animated: true })
  }

  return (
    <View style={{ width, height: HERO_HEIGHT }}>
      <FlatList
        ref={listRef}
        data={data}
        keyExtractor={(_, i) => String(i)}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        initialScrollIndex={startIdx}
        onScrollToIndexFailed={() => {}}
        onMomentumScrollEnd={onMomentumEnd}
        renderItem={({ item }) => (
          <Pressable onPress={() => onExpand(item)}>
            <Image source={imgSource(item)} style={{ width, height: HERO_HEIGHT }} contentFit={contentFit} transition={150} />
          </Pressable>
        )}
      />

      <Pressable style={styles.expandBtn} onPress={() => onExpand(items[dot])} hitSlop={8}>
        <Maximize2 size={18} color="#fff" strokeWidth={2.2} />
      </Pressable>

      {loop && (
        <>
          <Pressable style={[styles.arrow, styles.arrowLeft]} onPress={() => go(-1)} hitSlop={8}>
            <ChevronLeft size={22} color="#fff" strokeWidth={2.5} />
          </Pressable>
          <Pressable style={[styles.arrow, styles.arrowRight]} onPress={() => go(1)} hitSlop={8}>
            <ChevronRight size={22} color="#fff" strokeWidth={2.5} />
          </Pressable>
          <View style={styles.dots} pointerEvents="none">
            {items.map((_, i) => (
              <View key={i} style={[styles.dot, i === dot && styles.dotOn]} />
            ))}
          </View>
        </>
      )}
    </View>
  )
}

/* ── Plein écran image (pincer pour zoomer) ────────────────────────────────── */
function FullscreenImage({ source, onClose }: { source: MediaSource; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  const { width, height } = useWindowDimensions()
  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.fsRoot}>
        <ScrollView
          style={styles.fill}
          contentContainerStyle={styles.fsContent}
          maximumZoomScale={5}
          minimumZoomScale={1}
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          <Image source={imgSource(source)} style={{ width, height }} contentFit="contain" />
        </ScrollView>
        <Pressable style={[styles.fsClose, { top: insets.top + 8 }]} onPress={onClose} hitSlop={12}>
          <X size={26} color="#fff" strokeWidth={2.4} />
        </Pressable>
      </View>
    </Modal>
  )
}

/* ── Plein écran visite virtuelle (WebView) ────────────────────────────────── */
function FullscreenTour({ url, onClose }: { url: string; onClose: () => void }) {
  const insets = useSafeAreaInsets()
  if (!RNWebView) return null
  const WV = RNWebView
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.fsRoot}>
        <WV source={{ uri: url }} style={styles.fill} allowsInlineMediaPlayback allowsFullscreenVideo />
        <Pressable style={[styles.fsClose, { top: insets.top + 8 }]} onPress={onClose} hitSlop={12}>
          <X size={26} color="#fff" strokeWidth={2.4} />
        </Pressable>
      </View>
    </Modal>
  )
}

function EmptyMedia({ label }: { label: string }) {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyText}>{label}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 16, paddingTop: 12 },
  fill: { flex: 1 },

  // Onglets
  tabRow: { flexDirection: 'row', gap: 20, marginBottom: 12 },
  labelBox: { alignItems: 'center', justifyContent: 'center' },
  ghost: { opacity: 0 },
  labelAbs: { position: 'absolute', top: 0, left: 0, right: 0, textAlign: 'center' },
  label: { fontSize: 14 },
  labelBold: { fontWeight: '700', color: '#1C1917' },
  labelMuted: { fontWeight: '500', color: '#A8A29E' },
  underline: { height: 2, borderRadius: 1, marginTop: 6, backgroundColor: 'transparent' },
  underlineOn: { backgroundColor: ACCENT },

  // Hero
  hero: {
    width: '100%',
    height: HERO_HEIGHT,
    backgroundColor: '#F5F5F4',
    borderRadius: 14,
    overflow: 'hidden',
  },

  // Carrousel
  arrow: {
    position: 'absolute',
    top: HERO_HEIGHT / 2 - 18,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.38)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  arrowLeft: { left: 10 },
  arrowRight: { right: 10 },
  dots: {
    position: 'absolute',
    bottom: 12,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.55)' },
  dotOn: { backgroundColor: '#fff', width: 18 },

  expandBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Tour fallback (CTA)
  mediaCard: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#1A1A1A' },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.25)',
  },
  ctaPill: { paddingVertical: 12, paddingHorizontal: 20, borderRadius: 999, backgroundColor: ACCENT },
  ctaText: { fontSize: 15, fontWeight: '700', color: '#fff' },

  // Plein écran
  fsRoot: { flex: 1, backgroundColor: '#000' },
  fsContent: { flexGrow: 1, justifyContent: 'center' },
  fsClose: {
    position: 'absolute',
    right: 14,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Vide
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  emptyText: { fontSize: 14, color: '#A8A29E' },
})
