// ⚠️ TEMP SMOKE TEST — à retirer en Session 4 (remplacé par les vrais écrans
// Expo Router). Ne câble AUCUNE UX réelle : prouve seulement, au runtime, que le
// cycle de persistance AsyncStorage des stores @shomee/core fonctionne.
//
// Protocole (simulateur/device) :
//   1. Lancer → `favoris hydraté` passe false → true, favoris vide au 1er lancement.
//   2. « Ajouter un favori test » → compteur +1.
//   3. TUER l'app (kill, pas background) puis relancer.
//   4. Après hydratation, le favori test est toujours là (compteur conservé).
// Ce round-trip valide : injection AsyncStorage, écriture async, persistance
// disque, réhydratation au démarrage.
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { useShomeeStore, useSearchStore } from '@/lib/stores'
import { useStoreHydrated } from '@/lib/useStoreHydrated'
import type { Property } from '@shomee/core/types/domain'

// Stub minimal — seul l'`id` importe pour le test de persistance. Cast assumé :
// c'est un objet jetable de smoke test, pas une vraie fiche.
function makeStubFavorite(): Property {
  const id = `test-fav-${Date.now()}`
  return { id, title: `Favori test ${id}` } as Property
}

export default function SmokeStores() {
  const favorites = useShomeeStore((s) => s.favorites)
  const addFavorite = useShomeeStore((s) => s.addFavorite)
  const removeFavorite = useShomeeStore((s) => s.removeFavorite)
  const favHydrated = useStoreHydrated(useShomeeStore)

  const budgetMax = useSearchStore((s) => s.budgetMax)
  const setBudgetMax = useSearchStore((s) => s.setBudgetMax)
  const searchHydrated = useStoreHydrated(useSearchStore)

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Text style={styles.title}>SMOKE — stores AsyncStorage</Text>
      <Text style={styles.warn}>TEMP — retiré en Session 4</Text>

      {/* ── shomee-favorites (persisté) ── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>useShomeeStore · shomee-favorites</Text>
        <Text>favoris hydraté : {String(favHydrated)}</Text>
        <Text>nombre de favoris : {favorites.length}</Text>
        <Text style={styles.mono}>
          ids : {favorites.map((f) => f.id).join(', ') || '—'}
        </Text>
        <Pressable style={styles.btn} onPress={() => addFavorite(makeStubFavorite())}>
          <Text style={styles.btnText}>Ajouter un favori test</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnSecondary]}
          onPress={() => favorites.forEach((f) => removeFavorite(f.id))}
        >
          <Text style={styles.btnText}>Réinitialiser les favoris</Text>
        </Pressable>
      </View>

      {/* ── shomee-search-v2 (persisté) ── */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>useSearchStore · shomee-search-v2</Text>
        <Text>brief hydraté : {String(searchHydrated)}</Text>
        <Text>budgetMax : {budgetMax === null ? '—' : budgetMax}</Text>
        <Pressable style={styles.btn} onPress={() => setBudgetMax(500000)}>
          <Text style={styles.btnText}>Définir budget test (500000)</Text>
        </Pressable>
      </View>
    </ScrollView>
  )
}

const styles = StyleSheet.create({
  container: { padding: 24, paddingTop: 72, gap: 16 },
  title: { fontSize: 20, fontWeight: '700' },
  warn: { color: '#b45309', fontWeight: '600' },
  card: { gap: 8, padding: 16, borderRadius: 12, backgroundColor: '#f1f5f9' },
  cardTitle: { fontSize: 14, fontWeight: '700', marginBottom: 4 },
  mono: { fontFamily: 'monospace', fontSize: 12 },
  btn: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    backgroundColor: '#208AEF',
    alignItems: 'center',
  },
  btnSecondary: { backgroundColor: '#64748b' },
  btnText: { color: '#fff', fontWeight: '600' },
})
