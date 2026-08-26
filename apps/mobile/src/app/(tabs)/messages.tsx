import { useCallback, useEffect } from 'react'
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { MessageCircle } from 'lucide-react-native'
import { formatLocation } from '@shomee/core/utils/format'
import type { Conversation, Property } from '@shomee/core/types/domain'
import { hasUnread, useShomeeStore } from '@/lib/stores'
import { usePropertyResolver } from '@/lib/useResolveProperty'
import { syncConversations } from '@/lib/chat'
import { colors, fonts } from '@/lib/theme'

const BG = '#FAF3EE'

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
  /** Bien du feed local s'il y est encore — sinon le résumé serveur fait foi. */
  property: Property | null
}

function ConversationRow({ conv, property, onPress }: RowData & { onPress: () => void }) {
  // Identité de marque = agence (logo + nom), fallback agent, fallback résumé
  // serveur (fil dont le bien n'est plus dans le feed local).
  const summary = conv.propertySummary
  const brandName = property
    ? property.agencyName ?? property.agentName
    : summary?.agencyName ?? 'Agence'
  const brandLogo = property ? property.agencyLogo ?? property.agentAvatar : summary?.agencyLogo ?? null
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
          {property
            ? `${formatLocation(property.arrondissement, property.district)} · ${property.surface}m² · ${formatPrice(property.price)}`
            : [
                summary?.arrondissement
                  ? formatLocation(summary.arrondissement, summary.district ?? '')
                  : summary?.title,
                summary?.price != null ? formatPrice(summary.price) : null,
              ]
                .filter(Boolean)
                .join(' · ')}
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

  // Synchro : à l'arrivée sur l'onglet, puis toutes les 12 s tant qu'il vit.
  useEffect(() => {
    void syncConversations()
    const t = setInterval(() => {
      void syncConversations()
    }, 12000)
    return () => clearInterval(t)
  }, [])

  const rows: RowData[] = [...conversations]
    .map((conv) => ({ conv, property: resolve(conv.propertyId) ?? null }))
    // Un fil reste listé tant qu'on sait l'AFFICHER : bien local OU résumé serveur.
    .filter((r) => r.property != null || r.conv.propertySummary != null)
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
            <MessageCircle size={28} color="#B7A99D" />
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
    borderBottomColor: '#E8D9CB',
  },
  // Titre d'onglet en serif de marque — même famille que les questions du
  // funnel et les prix : c'est la signature typographique de l'app.
  headerTitle: {
    fontFamily: fonts.serif,
    fontSize: 27,
    color: colors.ink,
    letterSpacing: -0.2,
    lineHeight: 34,
  },
  headerSub: { fontSize: 13, color: colors.muted, marginTop: 3 },

  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 20, paddingVertical: 14 },
  avatarWrap: { position: 'relative' },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E8D9CB',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImg: { width: '100%', height: '100%' },
  avatarInitial: { fontSize: 15, fontWeight: '700', color: '#201A16' },
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
  brand: { flex: 1, fontSize: 14, fontWeight: '600', color: '#201A16' },
  brandUnread: { fontWeight: '800' },
  time: { fontSize: 11, color: '#B7A99D' },
  timeUnread: { color: '#201A16', fontWeight: '700' },
  sub: { fontSize: 12, color: '#525252', marginTop: 1 },
  preview: { fontSize: 13, color: '#B7A99D', marginTop: 2 },
  previewUnread: { color: '#201A16', fontWeight: '600' },

  sep: { height: 1, marginHorizontal: 20, backgroundColor: '#EFE2D5' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  emptyIcon: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#EFE2D5',
    borderWidth: 1,
    borderColor: '#E8D9CB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyTitle: { fontSize: 14, fontWeight: '600', color: '#8A7A6E' },
  emptyText: { fontSize: 12, color: '#B7A99D', textAlign: 'center', lineHeight: 18 },
})
