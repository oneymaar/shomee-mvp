/**
 * Étape Quartiers — le proto « deux moments » (saisie + carte) affiché en WebView
 * plein écran. Le proto gère lui-même le préchargement de la carte + le morph ;
 * il renvoie au natif la sélection ({action:'validate'}) ou un retour ({action:'back'}).
 *
 * Clavier : la WebView est enveloppée dans un KeyboardAvoidingView → quand le
 * clavier s'ouvre (champ web focus), la WebView rétrécit AU-DESSUS du clavier, donc
 * le contenu web se recadre proprement (plus de « tout remonte »). La barre
 * d'accessoires du clavier (‹ › ✓) est masquée.
 */
import { useMemo, useState, type ComponentType } from 'react'
import { KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, View } from 'react-native'
import { useSearchStore } from '@/lib/stores'

type WebViewMessage = { nativeEvent: { data: string } }
type WebViewProps = {
  source: { uri: string; headers?: Record<string, string> }
  onMessage?: (e: WebViewMessage) => void
  onLoadEnd?: () => void
  style?: object
  originWhitelist?: string[]
  cacheEnabled?: boolean
  hideKeyboardAccessoryView?: boolean
  keyboardDisplayRequiresUserAction?: boolean
}

let RNWebView: ComponentType<WebViewProps> | null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  RNWebView = require('react-native-webview').WebView
} catch {
  RNWebView = null
}

export const PROTO_WEBVIEW_AVAILABLE = RNWebView != null

const BRANCH_ALIAS = 'https://shomee-mvp-git-feat-monorepo-oneymaars-projects.vercel.app'
const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? BRANCH_ALIAS
const BYPASS = process.env.EXPO_PUBLIC_VERCEL_BYPASS_TOKEN || undefined
const BG = '#FDF5F2'
const ACCENT = '#A64B27'

interface Props {
  onValidate: () => void
  onBack: () => void
}

export function QuartierProtoWebView({ onValidate, onBack }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [nonce] = useState(() => String(Date.now()))

  const uri = useMemo(() => {
    const params = [`_cb=${nonce}`]
    if (BYPASS) {
      params.push(`x-vercel-protection-bypass=${encodeURIComponent(BYPASS)}`)
      params.push('x-vercel-set-bypass-cookie=true')
    }
    return `${BASE_URL}/proto/quartiers?${params.join('&')}`
  }, [nonce])

  const headers = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : undefined

  const handleMessage = (e: WebViewMessage) => {
    try {
      const data = JSON.parse(e.nativeEvent.data) as {
        action?: string
        selectedArrIds?: string[]
        selectedQuartierIds?: string[]
        selectedIrisIds?: string[]
        selectedCommuneIds?: string[]
        locationLabel?: string
        locationQuery?: string
      }
      if (data.action === 'back') { onBack(); return }
      if (data.action === 'validate') {
        const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
        useSearchStore.setState({
          selectedArrIds: arr(data.selectedArrIds),
          selectedQuartierIds: arr(data.selectedQuartierIds),
          selectedIrisIds: arr(data.selectedIrisIds),
          selectedCommuneIds: arr(data.selectedCommuneIds),
          ...(typeof data.locationLabel === 'string' ? { locationLabel: data.locationLabel } : {}),
          ...(typeof data.locationQuery === 'string' ? { locationQuery: data.locationQuery } : {}),
        })
        onValidate()
      }
    } catch {
      // message illisible → ignoré
    }
  }

  if (!RNWebView) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTxt}>La carte n&apos;est pas disponible sur cet appareil.</Text>
        <Pressable style={styles.cta} onPress={onValidate} hitSlop={8}>
          <Text style={styles.ctaTxt}>Continuer</Text>
        </Pressable>
      </View>
    )
  }

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <RNWebView
        source={{ uri, headers }}
        onMessage={handleMessage}
        onLoadEnd={() => setLoaded(true)}
        originWhitelist={['*']}
        cacheEnabled={false}
        hideKeyboardAccessoryView
        keyboardDisplayRequiresUserAction={false}
        style={styles.web}
      />
      {!loaded && <View style={styles.placeholder} />}
    </KeyboardAvoidingView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  web: { flex: 1, backgroundColor: BG },
  placeholder: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 20, backgroundColor: BG },
  fallbackTxt: { fontSize: 15, color: '#57534e', textAlign: 'center', lineHeight: 21 },
  cta: { backgroundColor: ACCENT, paddingHorizontal: 28, paddingVertical: 13, borderRadius: 999 },
  ctaTxt: { color: '#fff', fontSize: 15, fontWeight: '700' },
})
