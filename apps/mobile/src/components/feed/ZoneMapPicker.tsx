/**
 * Carte de sélection de zones EMBARQUÉE dans un intercalaire du feed.
 *
 * C'est exactement la carte de l'onboarding (`/embed/zonemap`) — ajout, retrait,
 * zoom, déplacement, pastilles, reset — servie en mode `embedded=1`. Dans ce
 * mode l'embed masque ses propres CTA (« Valider ma zone », encart « Modifier »)
 * et pousse sa sélection à chaque changement. UN SEUL bouton reste donc à
 * l'écran : « Appliquer et relancer », côté natif.
 *
 * Ce composant N'ÉCRIT RIEN dans le searchStore : il remonte la sélection au
 * parent, qui la met en attente. Invariant du parcours — l'implicite ne modifie
 * jamais silencieusement les critères déclarés.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { useSearchStore } from '@/lib/stores'
import {
  buildZoneMapUri,
  MapSkeleton,
  ZONEMAP_HEADERS,
  ZoneMapNativeWebView,
  type ZoneMapWebViewMessage,
} from '@/components/onboarding/QuartierMapWebView'

/** Sélection remontée au parent — les quatre granularités + le libellé dérivé. */
export interface ZoneSelection {
  arrIds: string[]
  quartierIds: string[]
  irisIds: string[]
  communeIds: string[]
  /** Libellé dérivé des zones affichées (« Paris 11e · Montreuil »). */
  label: string
}

export function ZoneMapPicker({ onChange }: { onChange: (sel: ZoneSelection) => void }) {
  // Photo du store au montage, FIGÉE : l'URL de la WebView ne doit jamais
  // changer, sinon la carte se rechargerait sous les doigts au premier tap et
  // la sélection en cours serait perdue.
  const initial = useRef(useSearchStore.getState()).current
  // Nonce calculé une fois : `Date.now()` en plein rendu changerait à chaque
  // image et provoquerait exactement le rechargement qu'on veut éviter.
  const nonce = useRef(String(Date.now())).current

  const uri = useMemo(
    () =>
      buildZoneMapUri(
        {
          arrIds: initial.selectedArrIds,
          quartierIds: initial.selectedQuartierIds,
          irisIds: initial.selectedIrisIds,
          communeIds: initial.selectedCommuneIds,
          label: initial.locationLabel,
          // La carte est ici DANS une feuille native, pas en plein écran : son
          // encart flottant est masqué, aucune marge de safe-area à réserver.
          safeTop: 0,
          geoConstraints: initial.locationIntent?.geoConstraints ?? [],
        },
        nonce,
        true,
      ),
    [initial, nonce],
  )

  // Skeleton jusqu'au signal « ready », avec le même filet de sécurité que
  // l'onboarding : si le message n'arrive pas, on révèle quand même la carte
  // plutôt que de laisser un écran gris définitif.
  const [mapReady, setMapReady] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setMapReady(true), 5000)
    return () => clearTimeout(t)
  }, [])

  const handleMessage = useCallback(
    (e: ZoneMapWebViewMessage) => {
      try {
        const data = JSON.parse(e.nativeEvent.data) as {
          action?: string
          selectedArrIds?: string[]
          selectedQuartierIds?: string[]
          selectedIrisIds?: string[]
          selectedCommuneIds?: string[]
          zonesLabel?: string
        }
        if (data.action === 'ready') {
          setMapReady(true)
          return
        }
        // Tout autre message que « change » est ignoré : en mode embarqué la
        // carte n'émet ni validation ni retour arrière.
        if (data.action !== 'change') return
        const arr = (v: unknown) =>
          Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
        onChange({
          arrIds: arr(data.selectedArrIds),
          quartierIds: arr(data.selectedQuartierIds),
          irisIds: arr(data.selectedIrisIds),
          communeIds: arr(data.selectedCommuneIds),
          label: typeof data.zonesLabel === 'string' ? data.zonesLabel : '',
        })
      } catch {
        // Message illisible → ignoré.
      }
    },
    [onChange],
  )

  if (!ZoneMapNativeWebView) {
    return (
      <View style={styles.fallback}>
        <Text style={styles.fallbackTxt}>
          La carte n&apos;est pas disponible sur cet appareil.
        </Text>
      </View>
    )
  }

  return (
    <View style={styles.root}>
      <ZoneMapNativeWebView
        source={{ uri, headers: ZONEMAP_HEADERS }}
        onMessage={handleMessage}
        originWhitelist={['*']}
        cacheEnabled={false}
        style={StyleSheet.absoluteFill}
      />
      {!mapReady && <MapSkeleton />}
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#e8e3df', overflow: 'hidden' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  fallbackTxt: { fontSize: 14, color: '#78716c', textAlign: 'center', lineHeight: 20 },
})
