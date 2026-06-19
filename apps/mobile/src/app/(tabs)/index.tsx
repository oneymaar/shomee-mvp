import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

// Onglet Biens — placeholder S4a. Le vrai feed vertical (FlatList + expo-video)
// arrive en S4b.
export default function BiensScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.center}>
        <Text style={styles.title}>Biens</Text>
        <Text style={styles.sub}>Feed — S4b</Text>
      </View>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#FDF5F2' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  title: { fontSize: 24, fontWeight: '700', color: '#1c1917' },
  sub: { fontSize: 15, color: '#78716c' },
})
