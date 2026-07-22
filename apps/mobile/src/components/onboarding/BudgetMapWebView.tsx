/**
 * Carte de faisabilité budgétaire — `/embed/budgetmap` (carte web réutilisée)
 * affichée dans une WebView CARRÉE, en lecture seule, sous la légende de l'étape
 * Budget. La sélection Quartiers + budget/surface initiaux partent dans l'URL ;
 * ensuite, chaque changement de budget/surface est POUSSÉ dans la WebView via
 * `injectJavaScript(window.__shomeeSetBudget(...))` → les IRIS se recolorent en
 * live sans recharger la page (restyle impératif Leaflet).
 *
 * WebView require-guarded (comme les autres) : absent → composant vide (la
 * légende au-dessus suffit à la lecture marché).
 */
import { useEffect, useMemo, useRef, useState, type ComponentType, type RefAttributes } from 'react'
import { StyleSheet, View } from 'react-native'
import type { WebView as WebViewType } from 'react-native-webview'

type WebViewMessage = { nativeEvent: { data: string } }
type WebViewProps = {
  source: { uri: string; headers?: Record<string, string> }
  onMessage?: (e: WebViewMessage) => void
  style?: object
  originWhitelist?: string[]
  cacheEnabled?: boolean
  scrollEnabled?: boolean
}

let RNWebView: ComponentType<WebViewProps> | null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  RNWebView = require('react-native-webview').WebView
} catch {
  RNWebView = null
}

export const BUDGET_MAP_AVAILABLE = RNWebView != null

const BRANCH_ALIAS = 'https://shomee-mvp-git-feat-monorepo-oneymaars-projects.vercel.app'
const BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL ?? BRANCH_ALIAS
const BYPASS = process.env.EXPO_PUBLIC_VERCEL_BYPASS_TOKEN || undefined
const BG = '#f5f5f4'

interface Props {
  arrIds: string[]
  quartierIds: string[]
  irisIds: string[]
  communeIds: string[]
  budgetMax: number
  surface: number
}

export function BudgetMapWebView({ arrIds, quartierIds, irisIds, communeIds, budgetMax, surface }: Props) {
  const ref = useRef<WebViewType | null>(null)
  const [ready, setReady] = useState(false)
  // Nonce figé au montage (cache-bust). La sélection ne change pas dans l'étape
  // Budget → l'URL reste stable (pas de reload) ; seuls budget/surface évoluent,
  // poussés par injection. Les valeurs initiales sont dans l'URL pour un premier
  // rendu correct avant même le premier « ready ».
  const [nonce] = useState(() => String(Date.now()))

  const uri = useMemo(() => {
    const sel = JSON.stringify({ arrIds, quartierIds, irisIds, communeIds, budgetMax, surface })
    const params = [`sel=${encodeURIComponent(sel)}`, `_cb=${nonce}`]
    if (BYPASS) {
      params.push(`x-vercel-protection-bypass=${encodeURIComponent(BYPASS)}`)
      params.push('x-vercel-set-bypass-cookie=true')
    }
    return `${BASE_URL}/embed/budgetmap?${params.join('&')}`
    // Volontairement figé sur `nonce` : budget/surface passent par injection.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonce])

  const headers = BYPASS ? { 'x-vercel-protection-bypass': BYPASS } : undefined

  // Pousse budget/surface à chaque changement, une fois la carte prête.
  useEffect(() => {
    if (!ready || !ref.current) return
    const js = `window.__shomeeSetBudget && window.__shomeeSetBudget(${Math.round(budgetMax)}, ${Math.round(surface)}); true;`
    ref.current.injectJavaScript(js)
  }, [ready, budgetMax, surface])

  const handleMessage = (e: WebViewMessage) => {
    try {
      const data = JSON.parse(e.nativeEvent.data) as { action?: string }
      if (data.action === 'ready') setReady(true)
    } catch {
      // message illisible → ignoré
    }
  }

  if (!RNWebView) return null

  const RN = RNWebView as unknown as ComponentType<WebViewProps & RefAttributes<WebViewType>>

  return (
    <View style={styles.wrap}>
      <RN
        ref={ref}
        source={{ uri, headers }}
        onMessage={handleMessage}
        originWhitelist={['*']}
        cacheEnabled={false}
        scrollEnabled={false}
        style={styles.web}
      />
      {!ready && <View style={styles.placeholder} />}
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    width: '100%',
    aspectRatio: 1,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    backgroundColor: BG,
  },
  web: { flex: 1, backgroundColor: BG },
  placeholder: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: BG },
})
