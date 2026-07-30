import { ActionSheetIOS, Alert, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { Image } from 'expo-image'
import { useRouter } from 'expo-router'
import * as ImagePicker from 'expo-image-picker'
import { Bell, Camera, ChevronRight, LogOut, Pencil, Settings, Shield, Trash2, User } from 'lucide-react-native'
import feedSeed from '@shomee/core/data/feedSeed.json'
import { useSearchStore, useShomeeStore, useFeedStore } from '@/lib/stores'
import { useProfileStore } from '@/lib/profileStore'
import { useAuth, logout, deleteAccount } from '@/lib/authStore'

const BG = '#FDF5F2'
const ACCENT = '#A64B27'
const SEED_COUNT = (feedSeed as unknown[]).length

const MENU_ITEMS = [
  { icon: Bell, label: 'Notifications', description: 'Alertes et rappels' },
  { icon: Shield, label: 'Confidentialité', description: 'Données et sécurité' },
  { icon: Settings, label: 'Paramètres', description: "Préférences de l'app" },
]

/** Budget max → libellé lisible (parité web). */
function formatBudget(max: number | null): string {
  if (!max) return 'Non défini'
  if (max >= 99_000_000) return '> 1 500 000 €'
  return `≤ ${(max / 1000).toFixed(0)} 000 €`
}

/**
 * Onglet Profil — portage de `apps/web/app/profile/page.tsx`.
 *
 * 100 % client : stats depuis le store (favoris), préférences depuis le brief
 * partagé (`searchStore`). Note : pas d'onboarding en natif → le brief est vide
 * tant qu'il n'est pas alimenté (affiche « Non défini »), et le bouton web
 * « Modifier ma recherche » (→ /onboarding) est omis (aucune cible native).
 */
export default function ProfileScreen() {
  const router = useRouter()
  const favoritesCount = useShomeeStore((s) => s.favorites.length)
  const feedCount = useFeedStore((s) => s.properties.length)
  const locationLabel = useSearchStore((s) => s.locationLabel)
  const budgetMax = useSearchStore((s) => s.budgetMax)
  const propertyTypes = useSearchStore((s) => s.propertyTypes)
  const photoUri = useProfileStore((s) => s.photoUri)
  const setPhoto = useProfileStore((s) => s.setPhoto)
  const { user: authUser } = useAuth()

  // Ouvre la galerie (permission → sélection → recadrage carré) et enregistre
  // l'URI. Fonction simple (React Compiler) — pas de useCallback.
  const pickImage = async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!perm.granted) {
      Alert.alert(
        'Accès aux photos',
        "Autorisez l'accès à vos photos dans les Réglages pour définir une photo de profil.",
      )
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    })
    if (!result.canceled && result.assets[0]?.uri) {
      setPhoto(result.assets[0].uri)
    }
  }

  // Menu photo — feuille d'actions iOS (galerie / suppression), fallback Alert
  // sur Android. Si aucune photo, ouvre directement la galerie.
  const openPhotoMenu = () => {
    const hasPhoto = photoUri != null
    if (Platform.OS === 'ios') {
      const options = hasPhoto
        ? ['Changer la photo', 'Supprimer la photo', 'Annuler']
        : ['Choisir une photo', 'Annuler']
      ActionSheetIOS.showActionSheetWithOptions(
        {
          title: 'Photo de profil',
          options,
          cancelButtonIndex: options.length - 1,
          destructiveButtonIndex: hasPhoto ? 1 : undefined,
        },
        (i) => {
          if (i === 0) pickImage()
          else if (hasPhoto && i === 1) setPhoto(null)
        },
      )
    } else if (hasPhoto) {
      Alert.alert('Photo de profil', undefined, [
        { text: 'Changer la photo', onPress: pickImage },
        { text: 'Supprimer la photo', style: 'destructive', onPress: () => setPhoto(null) },
        { text: 'Annuler', style: 'cancel' },
      ])
    } else {
      pickImage()
    }
  }

  const confirmLogout = () => {
    Alert.alert('Se déconnecter', 'Vous reviendrez à l’écran de connexion.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Se déconnecter', style: 'destructive', onPress: () => { void logout() } },
    ])
  }

  // Suppression de compte — double confirmation native, formulation sans
  // ambiguïté sur l'irréversibilité. La purge locale est immédiate ; la purge
  // serveur est best-effort (cf. authStore.deleteAccount).
  const confirmDeleteAccount = () => {
    Alert.alert(
      'Supprimer votre compte',
      'Vos recherches, votre historique et vos favoris seront définitivement effacés. Cette action est irréversible.',
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Supprimer', style: 'destructive', onPress: () => { void deleteAccount() } },
      ],
    )
  }

  const stats = [
    { label: 'Favoris', value: favoritesCount },
    { label: 'Vus', value: feedCount || SEED_COUNT },
    { label: 'Alertes', value: 0 },
  ]

  const searchPrefs = [
    { label: 'Localisation', value: locationLabel || 'Non définie' },
    { label: 'Budget max', value: formatBudget(budgetMax) },
    {
      label: 'Type de bien',
      value:
        propertyTypes.length > 0
          ? propertyTypes.map((t) => t.charAt(0).toUpperCase() + t.slice(1)).join(', ')
          : 'Non défini',
    },
  ]

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Mon profil</Text>
        <Text style={styles.headerSub}>Utilisateur SHOMEE</Text>
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Avatar + stats */}
        <View style={styles.avatarSection}>
          <Pressable style={styles.avatarWrap} onPress={openPhotoMenu}>
            {photoUri ? (
              <Image
                source={{ uri: photoUri }}
                style={styles.avatarImg}
                contentFit="cover"
                onError={() => setPhoto(null)}
              />
            ) : (
              <User size={36} color="#A3A3A3" />
            )}
            <View style={styles.editBadge}>
              <Camera size={13} color="#fff" />
            </View>
          </Pressable>
          <Pressable onPress={openPhotoMenu} hitSlop={8}>
            <Text style={styles.editPhotoText}>Modifier la photo</Text>
          </Pressable>
        </View>
        <View style={styles.statsRow}>
          {stats.map(({ label, value }) => (
            <View key={label} style={styles.statCard}>
              <Text style={styles.statValue}>{value}</Text>
              <Text style={styles.statLabel}>{label}</Text>
            </View>
          ))}
        </View>

        <View style={styles.divider} />

        {/* Recherche */}
        <Text style={styles.sectionLabel}>Recherche</Text>
        <View style={styles.card}>
          {searchPrefs.map(({ label, value }, i) => (
            <View key={label} style={[styles.prefRow, i > 0 && styles.rowBorder]}>
              <Text style={styles.prefLabel}>{label}</Text>
              <Text style={styles.prefValue} numberOfLines={1}>
                {value}
              </Text>
            </View>
          ))}
        </View>

        {/* Point d'entrée du funnel manuel natif (S7) — remplace le bouton web
            « Modifier ma recherche » (jusqu'ici omis faute de cible native). */}
        <Pressable
          onPress={() => router.push('/onboarding-manual?recap=1')}
          style={({ pressed }) => [styles.searchBtn, { opacity: pressed ? 0.9 : 1 }]}
        >
          <Pencil size={16} color="#fff" />
          <Text style={styles.searchBtnTxt}>Modifier la recherche</Text>
        </Pressable>

        {/* Compte */}
        <Text style={[styles.sectionLabel, styles.sectionSpacing]}>Compte</Text>
        <View style={styles.card}>
          {MENU_ITEMS.map(({ icon: Icon, label, description }, i) => (
            <View key={label} style={[styles.menuRow, i > 0 && styles.rowBorder]}>
              <View style={styles.menuIcon}>
                <Icon size={15} color="#78716c" />
              </View>
              <View style={styles.menuText}>
                <Text style={styles.menuLabel}>{label}</Text>
                <Text style={styles.menuDesc}>{description}</Text>
              </View>
              <ChevronRight size={14} color="#A3A3A3" />
            </View>
          ))}
        </View>

        {/* Session — statut du compte + déconnexion (retour à l'écran de connexion) */}
        <Text style={[styles.sectionLabel, styles.sectionSpacing]}>Session</Text>
        <View style={styles.card}>
          <View style={styles.prefRow}>
            <Text style={styles.prefLabel}>Statut</Text>
            <Text style={styles.prefValue} numberOfLines={1}>
              {authUser && !authUser.isGuest
                ? authUser.email ?? authUser.name ?? 'Compte connecté'
                : 'Invité'}
            </Text>
          </View>
        </View>
        <Pressable
          onPress={confirmLogout}
          style={({ pressed }) => [styles.logoutBtn, { opacity: pressed ? 0.9 : 1 }]}
        >
          <LogOut size={16} color="#b91c1c" />
          <Text style={styles.logoutTxt}>Se déconnecter</Text>
        </Pressable>

        {/* Suppression définitive — volontairement plus discret que la
            déconnexion (texte nu, pas de cadre) : action rare, mais qui doit
            exister et se trouver là où on la cherche, en bas du profil. */}
        <Pressable
          onPress={confirmDeleteAccount}
          hitSlop={8}
          style={({ pressed }) => [styles.deleteBtn, { opacity: pressed ? 0.6 : 0.85 }]}
        >
          <Trash2 size={14} color="#b91c1c" />
          <Text style={styles.deleteTxt}>Supprimer mon compte</Text>
        </Pressable>

        <Text style={styles.version}>SHOMEE · v0.2.0</Text>
      </ScrollView>
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: BG },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(0,0,0,0.08)',
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: '#1c1917', letterSpacing: -0.3 },
  headerSub: { fontSize: 12, color: '#78716c', marginTop: 2 },

  scroll: { paddingBottom: 32 },

  avatarSection: { alignItems: 'center', gap: 10, marginTop: 28, marginBottom: 22 },
  avatarWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImg: { width: 80, height: 80, borderRadius: 40 },
  editBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: BG,
  },
  editPhotoText: { fontSize: 13, fontWeight: '600', color: ACCENT },
  statsRow: { flexDirection: 'row', gap: 12, paddingHorizontal: 20 },
  statCard: {
    flex: 1,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 16,
    paddingVertical: 14,
    alignItems: 'center',
  },
  statValue: { fontSize: 24, fontWeight: '700', color: '#1c1917' },
  statLabel: { fontSize: 12, color: '#78716c', marginTop: 2 },

  divider: { borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.08)', marginHorizontal: 20, marginTop: 24 },

  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#A3A3A3',
    letterSpacing: 1.5,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    marginTop: 24,
    marginBottom: 12,
  },
  sectionSpacing: { marginTop: 24 },

  card: {
    marginHorizontal: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    borderRadius: 16,
    overflow: 'hidden',
  },
  rowBorder: { borderTopWidth: 1, borderTopColor: 'rgba(0,0,0,0.06)' },

  searchBtn: {
    marginHorizontal: 20,
    marginTop: 12,
    height: 48,
    borderRadius: 14,
    backgroundColor: ACCENT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  searchBtnTxt: { color: '#fff', fontSize: 14.5, fontWeight: '600' },

  prefRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 12,
  },
  prefLabel: { fontSize: 14, color: '#1c1917' },
  prefValue: { flex: 1, fontSize: 14, color: '#78716c', textAlign: 'right' },

  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 16, paddingVertical: 14 },
  menuIcon: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuText: { flex: 1 },
  menuLabel: { fontSize: 14, fontWeight: '500', color: '#1c1917' },
  menuDesc: { fontSize: 12, color: '#78716c', marginTop: 1 },

  logoutBtn: {
    marginHorizontal: 20,
    marginTop: 12,
    height: 48,
    borderRadius: 14,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(185,28,28,0.35)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logoutTxt: { color: '#b91c1c', fontSize: 14.5, fontWeight: '600' },
  deleteBtn: {
    marginTop: 18,
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  deleteTxt: { color: '#b91c1c', fontSize: 13.5, fontWeight: '600' },
  version: { fontSize: 12, color: '#A3A3A3', textAlign: 'center', marginTop: 28 },
})
