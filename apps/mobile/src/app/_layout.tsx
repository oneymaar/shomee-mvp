import { useEffect } from 'react'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StyleSheet } from 'react-native'
import { useShomeeStore, useSearchStore } from '@/lib/stores'
import { useStoreHydrated } from '@/lib/useStoreHydrated'

const BG = '#FDF5F2'

// Tient le splash NATIF affiché tant qu'on ne l'a pas explicitement masqué.
SplashScreen.preventAutoHideAsync().catch(() => {})

/**
 * Layout racine.
 *
 *  - `GestureHandlerRootView` + `SafeAreaProvider` à la racine (gestes + insets).
 *  - Gating d'hydratation SANS loader JS : tant que les stores persistés
 *    (favoris + brief) n'ont pas réhydraté, on ne rend RIEN — le splash natif
 *    (tenu via `preventAutoHideAsync`) reste seul à l'écran. Pas de spinner,
 *    pas de fond noir. AsyncStorage hydrate en quelques ms ; sur web c'est
 *    synchrone (splash invisible).
 *  - Hydraté : on masque le splash natif et on rend le `<Stack>` racine
 *    (headerless, fond crème) contenant le groupe `(tabs)`.
 */
export default function RootLayout() {
  const favHydrated = useStoreHydrated(useShomeeStore)
  const searchHydrated = useStoreHydrated(useSearchStore)
  const hydrated = favHydrated && searchHydrated

  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync().catch(() => {})
  }, [hydrated])

  // Pas encore hydraté → le splash natif couvre l'écran. On ne rend rien.
  if (!hydrated) return null

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: BG } }}>
          <Stack.Screen name="(tabs)" />
        </Stack>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
