// `Tabs` importé depuis `expo-router/js-tabs` : `import { Tabs } from 'expo-router'`
// est déprécié en SDK 56 (même implémentation, entrée non-dépréciée).
import { Tabs } from 'expo-router/js-tabs'
import { Home, Heart, MessageCircle, User } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useShomeeStore, hasUnread } from '@/lib/stores'

const ACTIVE = '#A64B27'
const INACTIVE = '#A3A3A3' // tailwind neutral-400 (parité avec BottomNav web)
const BAR_BG = '#FDF5F2'
const BAR_HEIGHT = 60

export default function TabsLayout() {
  const insets = useSafeAreaInsets()
  // Vraie valeur du store. `conversations` n'est PAS persisté → 0 au lancement
  // tant qu'il n'y a pas de messages (badge masqué). Pas de valeur simulée.
  const unreadCount = useShomeeStore((s) => s.conversations.filter(hasUnread).length)

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: ACTIVE,
        tabBarInactiveTintColor: INACTIVE,
        // Hauteur fixe + inset bas pour que la barre ne colle pas au bord
        // (home indicator iPhone).
        tabBarStyle: {
          backgroundColor: BAR_BG,
          height: BAR_HEIGHT + insets.bottom,
          paddingBottom: insets.bottom,
          paddingTop: 6,
          borderTopColor: 'rgba(0,0,0,0.1)',
        },
        tabBarLabelStyle: { fontSize: 12, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Biens', tabBarIcon: ({ color }) => <Home color={color} size={24} /> }}
      />
      <Tabs.Screen
        name="favorites"
        options={{ title: 'Favoris', tabBarIcon: ({ color }) => <Heart color={color} size={24} /> }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color }) => <MessageCircle color={color} size={24} />,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profil', tabBarIcon: ({ color }) => <User color={color} size={24} /> }}
      />
    </Tabs>
  )
}
