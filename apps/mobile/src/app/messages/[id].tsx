import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Image } from 'expo-image'
import { ChevronLeft, Send } from 'lucide-react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import type { ChatMessage } from '@shomee/core/types/domain'
import type { AvailabilitiesPayload } from '@shomee/core/visits'
import { DEFAULT_FALLBACK_IMAGE } from '@shomee/core/constants'
import { useShomeeStore } from '@/lib/stores'
import { usePropertyResolver } from '@/lib/useResolveProperty'
import {
  markThreadRead,
  needsAvailabilities,
  sendAvailabilities,
  sendChatMessage,
  syncConversations,
} from '@/lib/chat'
import { AvailabilityModal } from '@/components/chat/AvailabilityModal'
import {
  AvailabilitiesBubble,
  AvailabilityPromptCard,
  SystemLine,
  VisitConfirmedCard,
  VisitRequestBubble,
} from '@/components/chat/VisitMessageCards'

const ACCENT = '#A6512B'
const BG = '#FAF3EE'

function formatPrice(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €'
}
function formatTime(ts: number): string {
  const d = new Date(ts)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * Fil de discussion plein écran (`/messages/[id]`) — hors `(tabs)`, couvre la tab
 * bar (UX chat natif). Portage de `apps/web/components/ConversationView.tsx` :
 * bulles, indicateur de frappe, réponses agence simulées. La conversation est
 * créée à l'envoi du 1er message (store partagé, éphémère). Retour → onglet
 * Messages (parité web : le back mène à la liste, pas à l'écran précédent).
 */
export default function ConversationScreen() {
  const { id } = useLocalSearchParams<{ id: string }>()
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const resolve = usePropertyResolver()
  const property = resolve(id)

  const conversations = useShomeeStore((s) => s.conversations)

  const conv = conversations.find((c) => c.propertyId === id)
  const messages: ChatMessage[] = conv?.messages ?? []

  // Le bien peut ne plus être dans le feed local : le résumé serveur prend le
  // relais pour l'identité du fil (jamais d'écran mort sur un fil réel).
  const summary = conv?.propertySummary
  const brandName = property
    ? property.agencyName ?? property.agentName
    : summary?.agencyName ?? 'Agence'
  const brandLogo = property ? property.agencyLogo ?? property.agentAvatar : summary?.agencyLogo ?? null
  const brandInitial = (brandName.trim().charAt(0) || '?').toUpperCase()
  const threadTitle = property?.title ?? summary?.title ?? ''
  const [availOpen, setAvailOpen] = useState(false)

  const [text, setText] = useState('')
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const scrollRef = useRef<ScrollView>(null)
  const inputRef = useRef<TextInput>(null)

  const goToList = useCallback(() => router.navigate('/messages'), [router])

  // Ni bien local NI résumé serveur → fil inconnu, retour à la liste.
  useEffect(() => {
    if (!property && !summary) goToList()
  }, [property, summary, goToList])

  // Fil ouvert = synchro serrée (4 s) : la réponse de l'agent arrive sans geste.
  useEffect(() => {
    void syncConversations()
    const t = setInterval(() => {
      void syncConversations()
    }, 4000)
    return () => clearInterval(t)
  }, [])

  // Marque la conversation vue (badge local + curseur serveur).
  useEffect(() => {
    if (id) markThreadRead(id)
  }, [id, messages.length])

  const scrollToEnd = useCallback(() => {
    requestAnimationFrame(() => scrollRef.current?.scrollToEnd({ animated: true }))
  }, [])
  useEffect(scrollToEnd, [messages.length, scrollToEnd])

  // Clavier ouvert dès l'arrivée : focus une fois l'animation de push posée
  // (autoFocus part pendant la transition et le clavier ne monte pas de façon
  // fiable). Le timer est nettoyé si on quitte l'écran avant.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 350)
    return () => clearTimeout(t)
  }, [])

  // Suit la visibilité du clavier pour coller la barre de saisie au clavier
  // (on retire le padding home-indicator quand il est ouvert). `will*` sur iOS
  // pour un timing synchrone avec l'animation.
  useEffect(() => {
    const showEvt = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow'
    const hideEvt = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide'
    const show = Keyboard.addListener(showEvt, () => setKeyboardOpen(true))
    const hide = Keyboard.addListener(hideEvt, () => setKeyboardOpen(false))
    return () => {
      show.remove()
      hide.remove()
    }
  }, [])

  // Envoi RÉEL — l'optimisme (bulle immédiate, retrait en échec) vit dans
  // lib/chat. Plus aucune réponse simulée : l'agent répond depuis son
  // back-office, le fil se met à jour par la synchro (4 s).
  const sendMessage = () => {
    const trimmed = text.trim()
    if (!trimmed || !id) return
    setText('')
    void sendChatMessage(id, { text: trimmed })
  }

  const submitAvailabilities = (payload: AvailabilitiesPayload) => {
    setAvailOpen(false)
    if (id) void sendAvailabilities(id, payload)
  }

  if (!property && !summary) return <View style={styles.root} />

  // Indice « Lu » : sous le dernier message user lu, tant que l'agent n'a pas
  // répondu par-dessus (parité web).
  const lastReadIdx = messages.reduceRight(
    (found, msg, i) => (found !== -1 ? found : msg.from === 'user' && msg.read ? i : -1),
    -1,
  )
  const lastMsgIsFromAgent = messages[messages.length - 1]?.from === 'agent'
  const hasMessages = messages.length > 0

  return (
    <View style={styles.root}>
      {/* Header */}
      <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
        <Pressable onPress={goToList} style={styles.back} hitSlop={8}>
          <ChevronLeft size={24} color="#8A7A6E" />
        </Pressable>
        <View style={styles.headerAvatar}>
          {brandLogo ? (
            <Image source={{ uri: brandLogo }} style={styles.headerAvatarImg} contentFit="contain" />
          ) : (
            <Text style={styles.headerAvatarInitial}>{brandInitial}</Text>
          )}
        </View>
        <View style={styles.headerText}>
          <Text style={styles.headerName} numberOfLines={1}>
            {brandName}
          </Text>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {threadTitle}
          </Text>
        </View>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.messages}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="interactive"
          onContentSizeChange={scrollToEnd}
        >
          {!hasMessages && (
            <View style={styles.emptyWrap}>
              <View style={styles.emptyAvatar}>
                {brandLogo ? (
                  <Image source={{ uri: brandLogo }} style={styles.headerAvatarImg} contentFit="contain" />
                ) : (
                  <Text style={styles.emptyAvatarInitial}>{brandInitial}</Text>
                )}
              </View>
              <View style={styles.emptyBrandBlock}>
                <Text style={styles.emptyBrand}>{brandName}</Text>
                <Text style={styles.emptyBrandSub}>Agence immobilière · Paris</Text>
              </View>
              {property && (
                <View style={styles.propertyCard}>
                  <Image
                    source={{ uri: property.imageUrlFallback || DEFAULT_FALLBACK_IMAGE }}
                    style={styles.propertyThumb}
                    contentFit="cover"
                  />
                  <View style={styles.propertyCardBody}>
                    <Text style={styles.propertyCardTitle} numberOfLines={1}>
                      {property.title}
                    </Text>
                    <Text style={styles.propertyCardSub}>
                      {property.surface} m² · {formatPrice(property.price)}
                    </Text>
                  </View>
                </View>
              )}
              <Text style={styles.emptyHint}>
                Envoyez un message pour démarrer{'\n'}votre échange avec {brandName}.
              </Text>
            </View>
          )}

          {messages.map((msg, i) => {
            // Messages structurés → cartes dédiées (la bulle ne sait pas tout dire).
            if (msg.kind === 'visit_request') return <VisitRequestBubble key={msg.id} />
            if (msg.kind === 'availabilities') return <AvailabilitiesBubble key={msg.id} msg={msg} />
            if (msg.kind === 'visit_confirmed') return <VisitConfirmedCard key={msg.id} msg={msg} />
            if (msg.kind === 'system') return <SystemLine key={msg.id} msg={msg} />
            const isUser = msg.from === 'user'
            return (
              <Animated.View
                key={msg.id}
                entering={FadeInDown.duration(160)}
                style={[styles.bubbleRow, isUser ? styles.bubbleRowUser : styles.bubbleRowAgent]}
              >
                <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAgent]}>
                  <Text style={isUser ? styles.bubbleTextUser : styles.bubbleTextAgent}>{msg.text}</Text>
                  <Text style={[styles.bubbleTime, isUser ? styles.bubbleTimeUser : styles.bubbleTimeAgent]}>
                    {formatTime(msg.timestamp)}
                  </Text>
                </View>
                {isUser && i === lastReadIdx && !lastMsgIsFromAgent && <Text style={styles.readMark}>Lu</Text>}
              </Animated.View>
            )
          })}

          {needsAvailabilities(conv) && (
            <AvailabilityPromptCard onOpen={() => setAvailOpen(true)} />
          )}
        </ScrollView>

        {/* Input bar */}
        <View style={[styles.inputBar, { paddingBottom: keyboardOpen ? 10 : insets.bottom + 10 }]}>
          <View style={styles.inputWrap}>
            <TextInput
              ref={inputRef}
              value={text}
              onChangeText={setText}
              placeholder="Message..."
              placeholderTextColor="#B7A99D"
              style={styles.input}
              multiline
            />
          </View>
          <Pressable
            onPress={sendMessage}
            disabled={!text.trim()}
            style={[styles.sendBtn, text.trim() ? styles.sendBtnActive : styles.sendBtnIdle]}
          >
            <Send size={15} strokeWidth={2.2} color={text.trim() ? '#fff' : '#B7A99D'} />
          </Pressable>
        </View>
      </KeyboardAvoidingView>

      <AvailabilityModal
        visible={availOpen}
        onClose={() => setAvailOpen(false)}
        onSubmit={submitAvailabilities}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: BG },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#E8D9CB',
  },
  back: { marginLeft: -6 },
  headerAvatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E8D9CB',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  headerAvatarImg: { width: '100%', height: '100%' },
  headerAvatarInitial: { fontSize: 13, fontWeight: '700', color: '#201A16' },
  headerText: { flex: 1, minWidth: 0 },
  headerName: { fontSize: 14, fontWeight: '700', color: '#201A16' },
  headerTitle: { fontSize: 11, color: '#8A7A6E', marginTop: 1 },

  messages: { paddingHorizontal: 16, paddingVertical: 18, gap: 12 },

  bubbleRow: { flexDirection: 'column', gap: 3 },
  bubbleRowUser: { alignItems: 'flex-end' },
  bubbleRowAgent: { alignItems: 'flex-start' },
  bubble: { maxWidth: '80%', paddingHorizontal: 15, paddingVertical: 10, borderRadius: 20 },
  bubbleUser: { backgroundColor: ACCENT, borderBottomRightRadius: 5 },
  bubbleAgent: {
    backgroundColor: '#fff',
    borderBottomLeftRadius: 5,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  bubbleTextUser: { color: '#fff', fontSize: 14, lineHeight: 19 },
  bubbleTextAgent: { color: '#201A16', fontSize: 14, lineHeight: 19 },
  bubbleTime: { fontSize: 10, textAlign: 'right', marginTop: 3 },
  bubbleTimeUser: { color: 'rgba(255,255,255,0.6)' },
  bubbleTimeAgent: { color: '#B7A99D' },
  readMark: { fontSize: 11, color: '#B7A99D', paddingHorizontal: 4 },


  emptyWrap: { alignItems: 'center', gap: 18, paddingTop: 12, paddingBottom: 8 },
  emptyAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E8D9CB',
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  emptyAvatarInitial: { fontSize: 26, fontWeight: '700', color: '#201A16' },
  emptyBrandBlock: { alignItems: 'center' },
  emptyBrand: { fontSize: 17, fontWeight: '700', color: '#201A16' },
  emptyBrandSub: { fontSize: 13, color: '#8A7A6E', marginTop: 2 },
  propertyCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#E8D9CB',
    borderRadius: 16,
    padding: 10,
    width: '100%',
  },
  propertyThumb: { width: 46, height: 46, borderRadius: 12, backgroundColor: '#EFE7E2' },
  propertyCardBody: { flex: 1, minWidth: 0 },
  propertyCardTitle: { fontSize: 13, fontWeight: '600', color: '#201A16' },
  propertyCardSub: { fontSize: 12, color: '#8A7A6E', marginTop: 2 },
  emptyHint: { fontSize: 13, color: '#8A7A6E', textAlign: 'center', lineHeight: 20 },

  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#E8D9CB',
    backgroundColor: BG,
  },
  inputWrap: {
    flex: 1,
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  input: { fontSize: 14, color: '#201A16', maxHeight: 120, padding: 0 },
  sendBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  sendBtnActive: { backgroundColor: ACCENT },
  sendBtnIdle: { backgroundColor: '#EFE2D5' },
})
