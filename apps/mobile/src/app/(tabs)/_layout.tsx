// `Tabs` importé depuis `expo-router/js-tabs` : `import { Tabs } from 'expo-router'`
// est déprécié en SDK 56 (même implémentation, entrée non-dépréciée).
import { useEffect } from 'react'
import { Tabs } from 'expo-router/js-tabs'
import { Home, MessageCircle, User } from 'lucide-react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useShomeeStore, hasUnread } from '@/lib/stores'
import { FavoritesTabIcon } from '@/components/flyHeart/FavoritesTabIcon'
import { syncConversations } from '@/lib/chat'
import { colors } from '@/lib/theme'

const BAR_HEIGHT = 60

/** Peinture d'une barre d'onglets — deux jeux, une seule géométrie. */
type BarTheme = { active: string; inactive: string; background: string; border: string }

/** Sur les écrans CLAIRS (favoris, messages, profil) : crème + terracotta. */
const LIGHT: BarTheme = {
  active: colors.terracotta,
  inactive: colors.muted,
  background: colors.cream,
  border: colors.line,
}

/** Sur le FEED : la barre passe en chrome sombre — la vidéo occupe l'écran, une
 *  barre crème lui ferait un socle blanc en bas. Terracotta éclairci pour
 *  rester lisible sur ce fond (décision direction A, maquette du 21/08). */
const DARK: BarTheme = {
  active: colors.terracottaBright,
  inactive: 'rgba(246,237,230,0.42)',
  background: colors.nightRaised,
  border: colors.hairlineOnDark,
}

export default function TabsLayout() {
  const insets = useSafeAreaInsets()
  // Vraie valeur du store. `conversations` n'est PAS persisté → 0 au lancement
  // tant qu'il n'y a pas de messages (badge masqué). Pas de valeur simulée.
  const unreadCount = useShomeeStore((s) => s.conversations.filter(hasUnread).length)

  // Le badge Messages vit sur les données SERVEUR : une synchro de fond douce
  // (60 s) le tient à jour même si l'onglet Messages n'est jamais ouvert.
  useEffect(() => {
    void syncConversations()
    const t = setInterval(() => {
      void syncConversations()
    }, 60000)
    return () => clearInterval(t)
  }, [])

  // Hauteur fixe + inset bas pour que la barre ne colle pas au bord
  // (home indicator iPhone). Identique sur les deux thèmes : seule la peinture
  // change d'un écran à l'autre, jamais la géométrie.
  const bar = (t: BarTheme) => ({
    backgroundColor: t.background,
    height: BAR_HEIGHT + insets.bottom,
    paddingBottom: insets.bottom,
    paddingTop: 6,
    borderTopColor: t.border,
  })

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: LIGHT.active,
        tabBarInactiveTintColor: LIGHT.inactive,
        tabBarStyle: bar(LIGHT),
        tabBarLabelStyle: { fontSize: 10.5, fontWeight: '500' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Biens',
          tabBarIcon: ({ color }) => <Home color={color} size={23} />,
          // Le feed, et lui seul, porte le chrome sombre.
          tabBarStyle: bar(DARK),
          tabBarActiveTintColor: DARK.active,
          tabBarInactiveTintColor: DARK.inactive,
        }}
      />
      <Tabs.Screen
        name="favorites"
        options={{ title: 'Favoris', tabBarIcon: ({ color }) => <FavoritesTabIcon color={color} /> }}
      />
      <Tabs.Screen
        name="messages"
        options={{
          title: 'Messages',
          tabBarIcon: ({ color }) => <MessageCircle color={color} size={23} />,
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{ title: 'Profil', tabBarIcon: ({ color }) => <User color={color} size={23} /> }}
      />
    </Tabs>
  )
}
