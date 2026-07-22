import { useEffect } from 'react'
import { Stack } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { BottomSheetModalProvider } from '@gorhom/bottom-sheet'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { StyleSheet, View } from 'react-native'
import { useShomeeStore, useSearchStore } from '@/lib/stores'
import { useStoreHydrated } from '@/lib/useStoreHydrated'
import { FlyHeartOverlay } from '@/components/flyHeart/FlyHeartOverlay'
import { useAuth, hydrateAuth } from '@/lib/authStore'
import { AuthScreen } from '@/components/auth/AuthScreen'

const BG = '#FDF5F2'

// Tient le splash NATIF affiché tant qu'on ne l'a pas explicitement masqué.
SplashScreen.preventAutoHideAsync().catch(() => {})

/**
 * Layout racine.
 *
 *  - Providers à la racine (gestes + insets + sheets modaux).
 *  - Gating d'hydratation SANS loader JS : tant que les stores persistés
 *    (favoris + brief) ET l'auth n'ont pas réhydraté, on ne rend RIEN — le
 *    splash natif reste seul à l'écran. Pas de spinner, pas de fond noir.
 *  - Hydraté : si aucune session → écran de connexion (Apple / Google /
 *    invité) ; sinon le `<Stack>` racine (onglets + funnels).
 */
export default function RootLayout() {
  const favHydrated = useStoreHydrated(useShomeeStore)
  const searchHydrated = useStoreHydrated(useSearchStore)
  const auth = useAuth()
  const hydrated = favHydrated && searchHydrated && auth.status !== 'loading'

  // Restaure la session (SecureStore) au démarrage.
  useEffect(() => {
    void hydrateAuth()
  }, [])

  useEffect(() => {
    if (hydrated) SplashScreen.hideAsync().catch(() => {})
  }, [hydrated])

  // Pas encore hydraté → le splash natif couvre l'écran. On ne rend rien.
  if (!hydrated) return null

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        <BottomSheetModalProvider>
          <View style={styles.root}>
            {auth.status === 'anon' ? (
              <AuthScreen />
            ) : (
              <>
                <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: BG } }}>
                  <Stack.Screen name="(tabs)" />
                  {/* Handoff deep-link (shomee://onboarding?brief=…). */}
                  <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
                  {/* Funnel d'onboarding manuel natif (S7). */}
                  <Stack.Screen name="onboarding-manual" options={{ animation: 'slide_from_right' }} />
                </Stack>
                <FlyHeartOverlay />
              </>
            )}
          </View>
        </BottomSheetModalProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
})
