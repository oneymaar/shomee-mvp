/**
 * Sous-écran B de l'étape Quartiers — carte de sélection interactive en WebView
 * (`/embed/zonemap`). Transition d'ouverture (fondu + léger glissé) + skeleton
 * animé (grisé + reflet qui balaie) tant que la carte n'a pas signalé « prête ».
 *   - RN → carte : sélection initiale via query-param `sel`.
 *   - carte → RN : `{action:'ready'}` (masque le skeleton), `{action:'edit'}`
 *     (retour moment 1), sinon la sélection finale (seed store + valide).
 */
import { useEffect, useMemo, useState, type ComponentType } from 'react'
import { Dimensions, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import Animated, {
  Easing,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated'
import { LinearGradient } from 'expo-linear-gradient'
import { MapPin } from 'lucide-react-native'
import { useSearchStore } from '@/lib/stores'

type WebViewMessage = { nativeEvent: { data: string } }
type WebViewProps = {
  source: { uri: string; headers?: Record<string, string> }
  onMessage?: (e: WebViewMessage) => void
  style?: object
  originWhitelist?: string[]
  cacheEnabled?: boolean
}

let RNWebView: ComponentType<WebViewProps> | null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  RNWebView = require('react-native-webview').WebView
} catch {
  RNWebView = null
}

export const MAP_WEBVIEW_AVAILABLE = RNWebView != null

/**
 * Le composant WebView lui-meme + le type de son message. Exportes pour que
 * l'intercalaire du feed (`ZoneMapPicker`) monte LA MEME carte sans refaire un
 * `require('react-native-webview')` de son cote.
 */
export const ZoneMapNativeWebView = RNWebView
export type ZoneMapWebViewMessage = WebViewMessage

const BRANCH_ALIAS = 'https://shomee-mvp-git-feat-monorepo-oneymaars-projects.vercel.app'
const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? BRANCH_ALIAS
const BYPASS = process.env.EXPO_PUBLIC_VERCEL_BYPASS_TOKEN || undefined
const CACHE_BUST = String(Date.now())

/** Selection envoyee a l'embed en query-param `sel`. */
export type ZoneMapSel = {
  arrIds: string[]
  quartierIds: string[]
  irisIds: string[]
  communeIds: string[]
  label: string
  safeTop: number
  geoConstraints: unknown[]
}

/**
 * URL de l'embed carte. Source unique pour l'onboarding ET l'intercalaire :
 * l'ordre des parametres est celui d'origine, `embedded` n'etant pousse que
 * lorsqu'on le demande — l'URL de l'onboarding reste donc inchangee.
 */
export function buildZoneMapUri(sel: ZoneMapSel, nonce?: string, embedded?: boolean) {
  const params = [`sel=${encodeURIComponent(JSON.stringify(sel))}`, `_cb=${nonce || CACHE_BUST}`]
  if (embedded) params.push('embedded=1')
  if (BYPASS) {
    params.push(`x-vercel-protection-bypass=${encodeURIComponent(BYPASS)}`)
    params.push('x-vercel-set-bypass-cookie=true')
  }
  return `${BASE_URL}/embed/zonemap?${params.join('&')}`
}

/** En-tetes de contournement de la protection Vercel (previews). */
export const ZONEMAP_HEADERS = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : undefined

const BG = '#FDF5F2'
const ACCENT = '#A64B27'
const SCREEN_W = Dimensions.get('window').width

// ── Skeleton : carte grisée + reflet qui balaie (rassure pendant le chargement) ─
export function MapSkeleton() {
  const x = useSharedValue(0)
  useEffect(() => {
    x.value = withRepeat(withTiming(1, { duration: 1300, easing: Easing.inOut(Easing.ease) }), -1, false)
  }, [x])
  const shimmer = useAnimatedStyle(() => ({
    transform: [{ translateX: -SCREEN_W + x.value * (SCREEN_W * 2) }],
  }))
  return (
    <Animated.View exiting={FadeOut.duration(300)} style={styles.skeleton} pointerEvents="none">
      <MapPin size={30} color="rgba(166,75,39,0.30)" />
      <Text style={styles.skeletonTxt}>Préparation de la carte…</Text>
      <Animated.View style={[StyleSheet.absoluteFill, shimmer]}>
        <LinearGradient
          colors={['transparent', 'rgba(255,255,255,0.65)', 'transparent']}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>
    </Animated.View>
  )
}

interface Props {
  onValidate: () => void
  onBack: () => void
  /** Nonce unique par ouverture (cache-bust WebView) — voir onboarding-manual. */
  nonce?: string
}

export function QuartierMapWebView({ onValidate, onBack, nonce }: Props) {
  const insets = useSafeAreaInsets()
  const selectedArrIds = useSearchStore((s) => s.selectedArrIds)
  const selectedQuartierIds = useSearchStore((s) => s.selectedQuartierIds)
  const selectedIrisIds = useSearchStore((s) => s.selectedIrisIds)
  const selectedCommuneIds = useSearchStore((s) => s.selectedCommuneIds)
  const locationLabel = useSearchStore((s) => s.locationLabel)
  const geoConstraints = useSearchStore((s) => s.locationIntent?.geoConstraints)

  // Transition d'entrée : fondu + léger glissé vers le haut.
  const enter = useSharedValue(0)
  useEffect(() => {
    enter.value = withTiming(1, { duration: 320, easing: Easing.out(Easing.cubic) })
  }, [enter])
  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ translateY: (1 - enter.value) * 22 }],
  }))

  // Skeleton visible jusqu'au signal « ready » de l'embed (avec filet de sécurité).
  const [mapReady, setMapReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMapReady(true), 5000)
    return () => clearTimeout(t)
  }, [])

  const uri = useMemo(
    () =>
      buildZoneMapUri(
        {
          arrIds: selectedArrIds,
          quartierIds: selectedQuartierIds,
          irisIds: selectedIrisIds,
          communeIds: selectedCommuneIds,
          label: locationLabel,
          safeTop: insets.top,
          geoConstraints: geoConstraints ?? [],
        },
        nonce,
      ),
    [selectedArrIds, selectedQuartierIds, selectedIrisIds, selectedCommuneIds, locationLabel, geoConstraints, nonce, insets.top],
  )

  const headers = ZONEMAP_HEADERS

  const handleMessage = (e: WebViewMessage) => {
    try {
      const data = JSON.parse(e.nativeEvent.data) as {
        selectedArrIds?: string[]
        selectedQuartierIds?: string[]
        selectedIrisIds?: string[]
        selectedCommuneIds?: string[]
        locationLabel?: string
        action?: string
      }
      if (data.action === 'ready') { setMapReady(true); return }
      if (data.action === 'edit') { onBack(); return }
      const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
      useSearchStore.setState({
        selectedArrIds: arr(data.selectedArrIds),
        selectedQuartierIds: arr(data.selectedQuartierIds),
        selectedIrisIds: arr(data.selectedIrisIds),
        selectedCommuneIds: arr(data.selectedCommuneIds),
        ...(typeof data.locationLabel === 'string' ? { locationLabel: data.locationLabel } : {}),
      })
      onValidate()
    } catch {
      // Message illisible → ignoré.
    }
  }

  return (
    <Animated.View style={[styles.animRoot, enterStyle]}>
      <SafeAreaView style={styles.root} edges={['bottom']}>
        {RNWebView ? (
          <View style={styles.web}>
            <RNWebView
              source={{ uri, headers }}
              onMessage={handleMessage}
              originWhitelist={['*']}
              cacheEnabled={false}
              style={StyleSheet.absoluteFill}
            />
            {!mapReady && <MapSkeleton />}
          </View>
        ) : (
          <View style={styles.fallback}>
            <Text style={styles.fallbackTxt}>
              La carte n&apos;est pas disponible sur cet appareil. Votre zone reste celle
              comprise à partir de votre description.
            </Text>
            <Pressable style={styles.cta} onPress={onValidate} hitSlop={8}>
              <Text style={styles.ctaTxt}>Continuer</Text>
            </Pressable>
          </View>
        )}
      </SafeAreaView>
    </Animated.View>
  )
}

const styles = StyleSheet.create({
  animRoot: { flex: 1, backgroundColor: BG },
  root: { flex: 1, backgroundColor: BG },
  web: { flex: 1, backgroundColor: BG },

  skeleton: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#e8e3df',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    overflow: 'hidden',
  },
  skeletonTxt: { fontSize: 13, color: '#a8a29e', fontWeight: '600' },

  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 20 },
  fallbackTxt: { fontSize: 15, color: '#57534e', textAlign: 'center', lineHeight: 21 },
  cta: { backgroundColor: ACCENT, paddingHorizontal: 28, paddingVertical: 13, borderRadius: 999 },
  ctaTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
