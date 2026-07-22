/**
 * Sous-écran B de l'étape Quartiers (S7+) — carte de sélection interactive,
 * réutilisant le `ZoneMap` WEB via une WebView pointant la route embarquable
 * `/embed/zonemap`. Pattern `MapZone` étendu du mode « affichage » au mode
 * « sélection » avec un pont bidirectionnel :
 *   - RN → carte : sélection initiale (déjà résolue par `resolveGeoFromText`)
 *     passée en query-param `sel`.
 *   - carte → RN : sélection finale via `onMessage` → seed `useSearchStore`.
 *
 * `react-native-webview` est chargé via un require GARDÉ (comme `MapZone`) : si
 * indispo, on retombe sur un placeholder qui laisse continuer sans carte.
 * L'URL traverse la Deployment Protection Vercel comme `apiFetch` (header
 * `x-vercel-protection-bypass` + query-param qui pose le cookie pour les chunks).
 */
import { useMemo, type ComponentType } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context'
import { useSearchStore } from '@/lib/stores'

type WebViewMessage = { nativeEvent: { data: string } }
type WebViewProps = {
  source: { uri: string; headers?: Record<string, string> }
  onMessage?: (e: WebViewMessage) => void
  style?: object
  originWhitelist?: string[]
  startInLoadingState?: boolean
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

// Miroir de `lib/api.ts` : base + secret bypass lus EN DIRECT via process.env.
const BRANCH_ALIAS = 'https://shomee-mvp-git-feat-monorepo-oneymaars-projects.vercel.app'
const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? BRANCH_ALIAS
const BYPASS = process.env.EXPO_PUBLIC_VERCEL_BYPASS_TOKEN || undefined

// Cache-buster fixé UNE fois au lancement de l'app (portée module, hors rendu →
// pas d'appel impur pendant le render). Chaque session/reload = valeur neuve →
// l'URL de l'embed diffère de toute page mise en cache par une session
// précédente, donc WKWebView ne peut pas resservir un ancien build.
const CACHE_BUST = String(Date.now())

const BG = '#FDF5F2'
const ACCENT = '#A64B27'

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
  // Contraintes nommées (Daumesnil, Nation, métro…) déjà résolues côté natif.
  // Transmises COMPACTES (descripteurs d'entités, pas de listes d'IRIS) → l'embed
  // ré-exécute `resolveConstraints` pour dériver `entityGroups` (pastilles niveau 2)
  // localement, sans gonfler l'URL avec des IRIS. La sélection reste seedée par les
  // IDs résolus ci-dessus (inchangé).
  const geoConstraints = useSearchStore((s) => s.locationIntent?.geoConstraints)

  // URL de l'embed : sélection initiale + bypass Deployment Protection + cache-bust.
  const uri = useMemo(() => {
    const sel = JSON.stringify({
      arrIds: selectedArrIds,
      quartierIds: selectedQuartierIds,
      irisIds: selectedIrisIds,
      communeIds: selectedCommuneIds,
      label: locationLabel,
      safeTop: insets.top,
      geoConstraints: geoConstraints ?? [],
    })
    // Query string construit à la main (URLSearchParams est incomplet sous Hermes).
    // _cb : nonce par ouverture (prop) sinon fallback module (par lancement).
    const params = [`sel=${encodeURIComponent(sel)}`, `_cb=${nonce || CACHE_BUST}`]
    if (BYPASS) {
      params.push(`x-vercel-protection-bypass=${encodeURIComponent(BYPASS)}`)
      params.push('x-vercel-set-bypass-cookie=true')
    }
    return `${BASE_URL}/embed/zonemap?${params.join('&')}`
    // Recalcule seulement si la sélection initiale change (montage / retour).
  }, [selectedArrIds, selectedQuartierIds, selectedIrisIds, selectedCommuneIds, locationLabel, geoConstraints, nonce, insets.top])

  const headers = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : undefined

  const handleMessage = (e: WebViewMessage) => {
    try {
      const data = JSON.parse(e.nativeEvent.data) as {
        selectedArrIds?: string[]
        selectedQuartierIds?: string[]
        selectedIrisIds?: string[]
        selectedCommuneIds?: string[]
        locationLabel?: string
      }
      if ((data as { action?: string }).action === 'edit') { onBack(); return }
      const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
      // Seed du store natif — préserve locationQuery/intent (setState partiel).
      useSearchStore.setState({
        selectedArrIds: arr(data.selectedArrIds),
        selectedQuartierIds: arr(data.selectedQuartierIds),
        selectedIrisIds: arr(data.selectedIrisIds),
        selectedCommuneIds: arr(data.selectedCommuneIds),
        ...(typeof data.locationLabel === 'string' ? { locationLabel: data.locationLabel } : {}),
      })
      onValidate()
    } catch {
      // Message illisible → on ignore (l'utilisateur peut réessayer / revenir).
    }
  }

  return (
    <SafeAreaView style={styles.root} edges={['bottom']}>
      {RNWebView ? (
        <RNWebView
          source={{ uri, headers }}
          onMessage={handleMessage}
          originWhitelist={['*']}
          startInLoadingState
          cacheEnabled={false}
          style={styles.web}
        />
      ) : (
        // Fallback (module WebView absent) — on laisse continuer sans carte.
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
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  topbar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { flex: 1, fontSize: 15, fontWeight: '700', color: '#1c1917', textAlign: 'center' },
  web: { flex: 1, backgroundColor: BG },

  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 20 },
  fallbackTxt: { fontSize: 15, color: '#57534e', textAlign: 'center', lineHeight: 21 },
  cta: { backgroundColor: ACCENT, paddingHorizontal: 28, paddingVertical: 13, borderRadius: 999 },
  ctaTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
