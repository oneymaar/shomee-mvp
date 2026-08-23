import { useEffect, useRef } from 'react'
import { Stack, useRouter } from 'expo-router'
import * as SplashScreen from 'expo-splash-screen'
import { useFonts } from 'expo-font'
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
 *    (favoris + brief), l'auth ET les polices de marque n'ont pas fini de
 *    charger, on ne rend RIEN — le splash natif reste seul à l'écran.
 *  - Hydraté : si aucune session → écran de connexion (Apple / Google /
 *    invité) ; sinon le `<Stack>` racine (onglets + funnels).
 */
export default function RootLayout() {
  const favHydrated = useStoreHydrated(useShomeeStore)
  const searchHydrated = useStoreHydrated(useSearchStore)
  const auth = useAuth()
  const router = useRouter()

  // Polices de marque (refonte, direction A) : Frank Ruhl Libre pour les prix /
  // scores / lettrines, Montserrat Light pour la tagline d'accueil. Les clés
  // sont les fontFamily consommées via `fonts` de `@/lib/theme`. Chargement
  // local (assets/fonts), donc quasi instantané ; en cas d'erreur on ne bloque
  // PAS le démarrage (fontsError libère le gate, la police système prend le
  // relais silencieusement).
  const [fontsLoaded, fontsError] = useFonts({
    'FrankRuhlLibre-Medium': require('../../assets/fonts/FrankRuhlLibre_500Medium.ttf'),
    'FrankRuhlLibre-SemiBold': require('../../assets/fonts/FrankRuhlLibre_600SemiBold.ttf'),
    'Montserrat-Light': require('../../assets/fonts/Montserrat_300Light.ttf'),
  })

  const hydrated =
    favHydrated && searchHydrated && auth.status !== 'loading' && (fontsLoaded || !!fontsError)

  // Restaure la session (SecureStore) au démarrage.
  useEffect(() => {
    void hydrateAuth()
  }, [])

  // Connexion qui VIENT d'aboutir (anon → authed, donc pas un cold start) : si
  // la recherche est vierge — nouvelle session invité de démo, ou compte neuf —
  // on envoie à l'onboarding plutôt que sur le feed. Un cold start d'un
  // utilisateur revenant (loading → authed) n'est jamais concerné, et le
  // handoff (déjà authed) non plus.
  const prevStatus = useRef(auth.status)
  useEffect(() => {
    const prev = prevStatus.current
    prevStatus.current = auth.status
    if (prev === 'anon' && auth.status === 'authed') {
      const s = useSearchStore.getState()
      const hasBrief =
        !!s.locationLabel ||
        !!s.locationQuery ||
        s.selectedArrIds.length > 0 ||
        s.selectedQuartierIds.length > 0 ||
        s.selectedIrisIds.length > 0 ||
        s.selectedCommuneIds.length > 0 ||
        s.propertyTypes.length > 0 ||
        Object.keys(s.chipStates).length > 0 ||
        s.customCriteria.length > 0 ||
        s.budgetMax != null
      if (!hasBrief) router.replace('/onboarding-manual')
    }
  }, [auth.status, router])

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
