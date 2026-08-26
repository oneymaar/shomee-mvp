/**
 * Messagerie mobile — synchronisation avec le serveur.
 *
 * Principe : le store local (`useShomeeStore.conversations`) reste LA source de
 * l'interface — les écrans n'ont pas changé de modèle. Ce module l'alimente :
 * `syncConversations()` remplace son contenu par la vérité serveur (les fils
 * partent entiers, « remplace tout » — zéro fusion incrémentale à déboguer),
 * `sendChatMessage()` fait l'envoi optimiste (bulle immédiate, réconciliée à
 * la synchro suivante).
 *
 * Pas de push au MVP : les écrans qui affichent des messages RE-SYNCHRONISENT
 * périodiquement (liste 12 s, fil ouvert 4 s). À câbler plus tard :
 * expo-notifications + jeton d'appareil.
 */
import { Alert } from 'react-native'
import type { ChatMessage, Conversation, Property } from '@shomee/core/types/domain'
import type { AvailabilitiesPayload, VisitRequestPayload } from '@shomee/core/visits'
import { formatAvailabilities } from '@shomee/core/visits'
import { apiFetch } from './api'
import { useShomeeStore, useSearchStore } from './stores'

interface ServerMessage {
  id: string
  from: 'user' | 'agent'
  text: string
  timestamp: number
  read: boolean
  kind?: ChatMessage['kind']
  payload?: Record<string, unknown>
}
interface ServerConversation {
  id: string
  propertyId: string
  buyerLastReadAt: number
  propertySummary?: Conversation['propertySummary']
  messages: ServerMessage[]
}

/** propertyId → id de fil serveur (rempli à chaque synchro, sert au read). */
const serverIds = new Map<string, string>()

let syncing = false

/** Rapatrie tous les fils. Silencieux en cas d'échec réseau (on réessaiera). */
export async function syncConversations(): Promise<void> {
  if (syncing) return
  syncing = true
  try {
    const res = await apiFetch('/api/conversations')
    if (!res.ok) return
    const json = (await res.json()) as { conversations?: ServerConversation[] }
    if (!Array.isArray(json.conversations)) return
    serverIds.clear()
    const convs: Conversation[] = json.conversations.map((c) => {
      serverIds.set(c.propertyId, c.id)
      return {
        propertyId: c.propertyId,
        serverId: c.id,
        lastSeenAt: c.buyerLastReadAt,
        propertySummary: c.propertySummary,
        messages: c.messages.map((m) => ({
          id: m.id,
          text: m.text,
          from: m.from,
          timestamp: m.timestamp,
          read: m.read,
          kind: m.kind,
          payload: m.payload,
        })),
      }
    })
    useShomeeStore.getState().setConversations(convs)
  } catch {
    // hors-ligne / API pas encore déployée : l'existant local reste affiché
  } finally {
    syncing = false
  }
}

/**
 * Envoi optimiste : la bulle apparaît tout de suite, le serveur confirme, la
 * synchro suivante remplace le message temporaire par le vrai. En échec, le
 * temporaire est retiré et l'utilisateur est prévenu — un message qui SEMBLE
 * parti mais n'est jamais arrivé chez l'agent serait le pire des mensonges.
 */
export async function sendChatMessage(
  propertyId: string,
  msg: { text: string; kind?: ChatMessage['kind']; payload?: Record<string, unknown> },
): Promise<boolean> {
  const store = useShomeeStore.getState()
  const tempId = `local-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  store.addMessage(propertyId, {
    id: tempId,
    text: msg.text,
    from: 'user',
    timestamp: Date.now(),
    read: false,
    kind: msg.kind,
    payload: msg.payload,
  })
  try {
    const res = await apiFetch('/api/conversations/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ propertyId, text: msg.text, kind: msg.kind, payload: msg.payload }),
    })
    if (!res.ok) throw new Error(String(res.status))
    await syncConversations()
    return true
  } catch {
    // Retire la bulle optimiste (la synchro qui suit fait foi).
    const convs = useShomeeStore.getState().conversations.map((c) =>
      c.propertyId === propertyId
        ? { ...c, messages: c.messages.filter((m) => m.id !== tempId) }
        : c,
    )
    useShomeeStore.getState().setConversations(convs)
    Alert.alert('Message non envoyé', 'Vérifiez votre connexion et réessayez.')
    return false
  }
}

/** Marque le fil lu — localement tout de suite, côté serveur en arrière-plan. */
export function markThreadRead(propertyId: string): void {
  useShomeeStore.getState().markConversationSeen(propertyId)
  const id = serverIds.get(propertyId)
  if (!id) return
  void apiFetch(`/api/conversations/${id}/read`, { method: 'POST' }).catch(() => {})
}

/** Le brief qualifié — photographié depuis le store de recherche local :
 *  c'est LA valeur de la demande SHOMEE, l'agent reçoit un prospect qualifié
 *  (budget, zones, exigences, score), pas un « quelqu'un veut visiter ». */
function buildBrief(property: Property): VisitRequestPayload {
  const s = useSearchStore.getState()
  const byState = (want: number) =>
    Object.entries(s.chipStates)
      .filter(([, st]) => st === want)
      .map(([label]) => label)
  const customByState = (want: number) =>
    s.customCriteria.filter((c) => c.state === want).map((c) => c.label)
  return {
    budgetMax: s.budgetMax,
    budgetMin: s.budgetMin,
    minSurface: s.minSurface,
    minRooms: s.minRooms,
    minBedrooms: s.minBedrooms,
    locationLabel: s.locationLabel || null,
    criteria: {
      must: [...byState(2), ...customByState(2)],
      want: [...byState(1), ...customByState(1)],
      never: [...byState(3), ...customByState(3)],
    },
    matchScore: property.matchScore ?? null,
  }
}

/** Une demande est « en cours » si aucun créneau n'a été calé depuis. */
export function hasPendingVisitRequest(conv: Conversation | undefined): boolean {
  if (!conv) return false
  let pending = false
  for (const m of conv.messages) {
    if (m.kind === 'visit_request') pending = true
    if (m.kind === 'visit_confirmed') pending = false
  }
  return pending
}

/** La carte « indiquez vos disponibilités » s'affiche tant que la demande n'a
 *  ni disponibilités ni visite calée APRÈS elle. */
export function needsAvailabilities(conv: Conversation | undefined): boolean {
  if (!conv) return false
  let needs = false
  for (const m of conv.messages) {
    if (m.kind === 'visit_request') needs = true
    if (m.kind === 'availabilities' || m.kind === 'visit_confirmed') needs = false
  }
  return needs
}

/**
 * « Demander une visite » — poste le message + le brief. Ne double JAMAIS une
 * demande en cours : rouvrir la fiche et re-toucher le bouton mène simplement
 * au fil.
 */
export async function requestVisit(property: Property): Promise<void> {
  const conv = useShomeeStore
    .getState()
    .conversations.find((c) => c.propertyId === property.id)
  if (hasPendingVisitRequest(conv)) return
  await sendChatMessage(property.id, {
    text: "Bonjour, j'aimerais organiser une visite de ce bien.",
    kind: 'visit_request',
    payload: buildBrief(property) as unknown as Record<string, unknown>,
  })
}

/** Envoie les disponibilités cochées (la modale appelle ceci). */
export async function sendAvailabilities(
  propertyId: string,
  payload: AvailabilitiesPayload,
): Promise<boolean> {
  return sendChatMessage(propertyId, {
    text: `Mes disponibilités :\n${formatAvailabilities(payload)}`,
    kind: 'availabilities',
    payload: payload as unknown as Record<string, unknown>,
  })
}

/**
 * Lien .ics d'une visite — ouvert dans Safari, iOS propose l'ajout à l'agenda.
 * Le déploiement preview est protégé : on passe le bypass en PARAMÈTRES de
 * requête (Safari ne sait pas envoyer d'en-têtes), exactement comme la WebView
 * du proto Quartiers. Disparaîtra avec le domaine de production public.
 */
export function visitIcsUrl(icsToken: string): string {
  const base =
    process.env.EXPO_PUBLIC_API_BASE_URL ??
    'https://shomee-mvp-git-feat-monorepo-oneymaars-projects.vercel.app'
  const bypass = process.env.EXPO_PUBLIC_VERCEL_BYPASS_TOKEN
  const params = bypass
    ? `?x-vercel-protection-bypass=${encodeURIComponent(bypass)}&x-vercel-set-bypass-cookie=true`
    : ''
  return `${base}/api/visits/ics/${icsToken}${params}`
}
