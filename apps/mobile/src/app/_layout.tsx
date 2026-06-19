import { useCallback } from 'react'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ActivityIndicator, StyleSheet, View } from 'react-native'
import { Image } from 'expo-image'
import { useShomeeStore, useSearchStore } from '@/lib/stores'
import { useStoreHydrated } from '@/lib/useStoreHydrated'

const LOGO = require('../../assets/images/logo-shomee-terracotta.png')

const BRAND = '#A64B27'
const BG = '#FDF5F2'

// Empêche le splash NATIF de s'auto-masquer dès le 1er render : sans ça, sur un
// dev build (bundle déjà chargé) il flashe en quelques ms et reste invisible.
// On le tient affiché jusqu'à ce que notre 1er écran soit posé (onLayout).
SplashScreen.preventAutoHideAsync().catch(() => {})

/**
 * Layout racine.
 *
 *  - `GestureHandlerRootView` à la racine (requis dès maintenant ; le feed S4b
 *    s'appuiera dessus pour les gestes vidéo / la bottom-sheet).
 *  - `SafeAreaProvider` : rend `useSafeAreaInsets` disponible à toute l'app
 *    (la barre d'onglets en a besoin pour ne pas coller au bord bas iPhone).
 *  - Gating d'hydratation : AsyncStorage est asynchrone. Tant que les stores
 *    persistés (favoris + brief) n'ont pas réhydraté, on affiche un splash —
 *    pas de décision de navigation avant (sinon flash d'état vide, et plus tard
 *    en S6 de mauvaises redirections onboarding/feed). Sur web l'hydratation
 *    est synchrone → splash quasi invisible.
 *  - Une fois hydraté : `<Stack>` racine (headerless) contenant le groupe
 *    `(tabs)`. Le Stack permettra d'empiler des écrans modaux hors onglets
 *    (détail bien, etc.) en S4b/S7.
 */
export default function RootLayout() {
  const favHydrated = useStoreHydrated(useShomeeStore)
  const searchHydrated = useStoreHydrated(useSearchStore)
  const hydrated = favHydrated && searchHydrated

  // Masque le splash NATIF une fois notre 1er écran (splash JS ou app) effectivement
  // posé → pas de blank flash, et transition fluide vers le splash JS (même fond +
  // logo). À partir de là, le gating d'hydratation est porté par le splash JS.
  const onLayout = useCallback(() => {
    SplashScreen.hideAsync().catch(() => {})
  }, [])

  return (
    <GestureHandlerRootView style={styles.root} onLayout={onLayout}>
      <SafeAreaProvider>
        {hydrated ? (
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
        ) : (
          <View style={styles.splash}>
            <Image source={LOGO} style={styles.logo} contentFit="contain" />
            <ActivityIndicator color={BRAND} />
          </View>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 24, backgroundColor: BG },
  logo: { width: 120, height: 136 },
})
