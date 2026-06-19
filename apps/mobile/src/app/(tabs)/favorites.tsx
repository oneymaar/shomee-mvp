import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useShomeeStore } from '@/lib/stores'

// Onglet Favoris — placeholder S5. Affiche le compteur réel lu depuis le store
// pour prouver le câblage (un favori ajouté ailleurs apparaît ici).
export default function FavoritesScreen() {
  const count = useShomeeStore((s) => s.favorites.length)

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.center}>
        <Text style={styles.title}>Favoris</Text>
        <Text style={styles.sub}>Bientôt — S5</Text>
        <Text style={styles.count}>{count} favori{count > 1 ? 's' : ''} en mémoire</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FDF5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  title: { fontSize: 24, fontWeight: '700', color: '#1c1917' },
  sub: { fontSize: 15, color: '#78716c' },
  count: { marginTop: 8, fontSize: 14, color: '#A64B27', fontWeight: '600' },
})
