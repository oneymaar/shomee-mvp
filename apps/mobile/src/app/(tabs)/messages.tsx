import { useCallback } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { MessageCircle } from 'lucide-react-native'
import { formatLocation } from '@shomee/core/utils/format'
import type { Conversation, Property } from '@shomee/core/types/domain'
import { hasUnread, useShomeeStore } from '@/lib/stores'
import { usePropertyResolver } from '@/lib/useResolveProperty'

const BG = '#FDF5F2'

/** Séparateurs de milliers + « € », sans Intl (support Hermes inégal). */
function formatPrice(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €'
}
/** HH:MM local, sans Intl. */
function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function Header() {
  return (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Messages</Text>
      <Text style={styles.headerSub}>Vos échanges avec les agents</Text>
    </View>
  )
}

interface RowData {
  conv: Conversation
  property: Property
}

function ConversationRow({ conv, property, onPress }: RowData & { onPress: () => void }) {
  // Identité de marque = agence (logo + nom), fallback sur l'agent.
  const brandName = property.agencyName ?? property.agentName
  const brandLogo = property.agencyLogo ?? property.agentAvatar
  const initial = (brandName.trim().charAt(0) || '?').toUpperCase()

  const lastMsg = conv.messages[conv.messages.length - 1]
  const unread = hasUnread(conv)
  const preview = lastMsg
    ? lastMsg.from === 'user'
      ? `Vous : ${lastMsg.text}`
      : lastMsg.text
    : ''

  return (
    <Pressable style={styles.row} onPress={onPress}>
      <View style={styles.avatarWrap}>
        <View style={styles.avatar}>
          {brandLogo ? (
            <Image source={{ uri: brandLogo }} style={styles.avatarImg} contentFit="contain" />
          ) : (
            <Text style={styles.avatarInitial}>{initial}</Text>
          )}
        </View>
        {unread && <View style={styles.unreadDot} />}
      </View>

      <View style={styles.rowBody}>
        <View style={styles.rowTop}>
          <Text style={[styles.brand, unread && styles.brandUnread]} numberOfLines={1}>
            {brandName}
          </Text>
          {lastMsg && (
            <Text style={[styles.time, unread && styles.timeUnread]}>{formatTime(lastMsg.timestamp)}</Text>
          )}
        </View>
        <Text style={styles.sub} numberOfLines={1}>
          {formatLocation(property.arrondissement, property.district)} · {property.surface}m² ·{' '}
          {formatPrice(property.price)}
        </Text>
        {preview ? (
          <Text style={[styles.preview, unread && styles.previewUnread]} numberOfLines={1}>
            {preview}
          </Text>
        ) : null}
      </View>
    </Pressable>
  )
}

/**
 * Onglet Messages (S5) — liste des conversations avec les agences. 100 % client :
 * les conversations vivent dans le store partagé (éphémères, non persistées, comme
 * le web). Portage de `apps/web/app/messages/page.tsx` (liste + empty state).
 *
 * Le store ne stocke que `propertyId` → on résout la fiche complète depuis le feed
 * / les favoris (cf. `usePropertyResolver`) ; une conversation dont le bien n'est
 * plus résolvable est écartée (parité web `if (!property) return null`).
 */
export default function MessagesScreen() {
  const router = useRouter()
  const conversations = useShomeeStore((s) => s.conversations)
  const resolve = usePropertyResolver()

  const rows: RowData[] = [...conversations]
    .map((conv) => ({ conv, property: resolve(conv.propertyId) }))
    .filter((r): r is RowData => r.property != null)
    .sort((a, b) => {
      const ta = a.conv.messages[a.conv.messages.length - 1]?.timestamp ?? 0
      const tb = b.conv.messages[b.conv.messages.length - 1]?.timestamp ?? 0
      return tb - ta
    })

  const openThread = useCallback(
    (propertyId: string) =>
      router.push({ pathname: '/messages/[id]', params: { id: propertyId } }),
    [router],
  )

  if (rows.length === 0) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <Header />
        <View style={styles.empty}>
          <View style={styles.emptyIcon}>
            <MessageCircle size={28} color="#A3A3A3" />
          </View>
          <Text style={styles.emptyTitle}>Aucun message</Text>
          <Text style={styles.emptyText}>Vos échanges avec les agents{'\n'}apparaîtront ici.</Text>
        </View>
      </SafeAreaView>
    )
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <Header />
      <FlatList
        data={rows}
        keyExtractor={(r) => r.conv.propertyId}
        renderItem={({ item }) => (
          <ConversationRow
            conv={item.conv}
            property={item.property}
            onPress={() => openThread(item.conv.propertyId)}
          />
        )}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        showsVerticalScrollIndicator={false}
      />
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

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.1)',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontSize: 15, fontWeight: '700', color: '#404040' },
  unreadDot: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 13,
    height: 13,
    borderRadius: 7,
    backgroundColor: '#EF4444',
    borderWidth: 2,
    borderColor: BG,
  },

  rowBody: { flex: 1, minWidth: 0 },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  brand: { flex: 1, fontSize: 14, fontWeight: '600', color: '#1c1917' },
  brandUnread: { fontWeight: '800' },
  time: { fontSize: 11, color: '#A3A3A3' },
  timeUnread: { color: '#1c1917', fontWeight: '700' },
  sub: { fontSize: 12, color: '#525252', marginTop: 1 },
  preview: { fontSize: 13, color: '#A3A3A3', marginTop: 2 },
  previewUnread: { color: '#292524', fontWeight: '600' },

  sep: { height: 1, marginHorizontal: 20, backgroundColor: 'rgba(0,0,0,0.06)' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: '#78716c' },
  emptyText: { fontSize: 12, color: '#A3A3A3', textAlign: 'center', lineHeight: 18 },
})
