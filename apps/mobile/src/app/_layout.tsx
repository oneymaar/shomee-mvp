import { Stack } from 'expo-router'
import { GestureHandlerRootView } from 'react-native-gesture-handler'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native'
import { useShomeeStore, useSearchStore } from '@/lib/stores'
import { useStoreHydrated } from '@/lib/useStoreHydrated'

const BRAND = '#A64B27'
const BG = '#FDF5F2'

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

  return (
    <GestureHandlerRootView style={styles.root}>
      <SafeAreaProvider>
        {hydrated ? (
          <Stack screenOptions={{ headerShown: false }}>
            <Stack.Screen name="(tabs)" />
          </Stack>
        ) : (
          <View style={styles.splash}>
            <Text style={styles.brand}>Shomee</Text>
            <ActivityIndicator color={BRAND} />
          </View>
        )}
      </SafeAreaProvider>
    </GestureHandlerRootView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, backgroundColor: BG },
  brand: { fontSize: 28, fontWeight: '800', color: BRAND, letterSpacing: 0.5 },
})
