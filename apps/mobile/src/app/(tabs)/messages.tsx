import { StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'

// Onglet Messages — placeholder S5.
export default function MessagesScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.center}>
        <Text style={styles.title}>Messages</Text>
        <Text style={styles.sub}>Bientôt — S5</Text>
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
