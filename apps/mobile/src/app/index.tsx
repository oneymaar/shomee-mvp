import { Text, View } from 'react-native'
import { formatLocation } from '@shomee/core/utils/format'
import { CORE_PACKAGE } from '@shomee/core'

// Session 1 smoke screen: proves a pure @shomee/core helper runs inside the
// React Native / Metro bundle (shared business logic, web + mobile).
export default function Home() {
  const label = formatLocation('PARIS 11e', 'Bastille')
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8, padding: 24 }}>
      <Text style={{ fontSize: 18, fontWeight: '600' }}>SHOMEE mobile</Text>
      <Text>{CORE_PACKAGE} import OK</Text>
      <Text>{label}</Text>
    </View>
  )
}
