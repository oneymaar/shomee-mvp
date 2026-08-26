import { prisma } from '@/lib/prisma'
import { chatDb, type ConversationRow, type MessageRow, type MessageKindValue } from '@/lib/db/newModels'

/**
 * Sérialisation des fils — partagée par les routes acquéreur (mobile) et agent
 * (back-office). Un fil part TOUJOURS entier (ses ~derniers 200 messages) :
 * les volumes du MVP le permettent largement, et ça réduit la synchro mobile à
 * « remplace tout » — zéro fusion incrémentale à déboguer.
 */

const MAX_MESSAGES = 200

/** kind serveur (enum SQL) → kind mobile (ChatMessage.kind). */
const KIND_TO_MOBILE: Record<MessageKindValue, string> = {
  TEXT: 'text',
  VISIT_REQUEST: 'visit_request',
  AVAILABILITIES: 'availabilities',
  VISIT_CONFIRMED: 'visit_confirmed',
  SYSTEM: 'system',
}

export function kindFromMobile(kind: unknown): MessageKindValue {
  switch (kind) {
    case 'visit_request':
      return 'VISIT_REQUEST'
    case 'availabilities':
      return 'AVAILABILITIES'
    case 'system':
      return 'SYSTEM'
    default:
      return 'TEXT'
  }
}

export interface BuyerMessageJson {
  id: string
  from: 'user' | 'agent'
  text: string
  timestamp: number
  read: boolean
  kind: string
  payload: unknown
}

function toBuyerMessage(m: MessageRow, agentReadAt: Date | null): BuyerMessageJson {
  return {
    id: m.id,
    from: m.sender === 'BUYER' ? 'user' : 'agent',
    text: m.text,
    timestamp: m.createdAt.getTime(),
    // « lu » du point de vue acquéreur = l'agent a lu mes messages.
    read: m.sender !== 'BUYER' || (agentReadAt != null && agentReadAt.getTime() >= m.createdAt.getTime()),
    kind: KIND_TO_MOBILE[m.kind] ?? 'text',
    payload: m.payload ?? undefined,
  }
}

async function messagesByConversation(ids: string[]): Promise<Map<string, MessageRow[]>> {
  if (ids.length === 0) return new Map()
  const all = await chatDb.message.findMany({
    where: { conversationId: { in: ids } },
    orderBy: { createdAt: 'asc' },
  })
  const map = new Map<string, MessageRow[]>()
  for (const m of all) {
    const list = map.get(m.conversationId) ?? []
    list.push(m)
    map.set(m.conversationId, list)
  }
  for (const [k, list] of map) if (list.length > MAX_MESSAGES) map.set(k, list.slice(-MAX_MESSAGES))
  return map
}

async function propertySummaries(ids: string[]) {
  if (ids.length === 0) return new Map<string, Record<string, unknown>>()
  const props = await prisma.property.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      title: true,
      arrondissement: true,
      district: true,
      price: true,
      agency: { select: { name: true, logo: true } },
    },
  })
  return new Map(
    props.map((p) => [
      p.id,
      {
        title: p.title,
        arrondissement: p.arrondissement,
        district: p.district,
        price: p.price,
        agencyName: p.agency?.name ?? undefined,
        agencyLogo: p.agency?.logo ?? null,
      },
    ]),
  )
}

/** Fils d'un acquéreur, entiers, prêts pour le store mobile. */
export async function buyerConversationsJson(buyerUserId: string) {
  const convs = await chatDb.conversation.findMany({
    where: { buyerUserId },
    orderBy: { lastMessageAt: 'desc' },
  })
  const msgs = await messagesByConversation(convs.map((c) => c.id))
  const props = await propertySummaries([...new Set(convs.map((c) => c.propertyId))])
  return convs.map((c) => ({
    id: c.id,
    propertyId: c.propertyId,
    lastMessageAt: c.lastMessageAt.getTime(),
    buyerLastReadAt: c.buyerLastReadAt?.getTime() ?? 0,
    propertySummary: props.get(c.propertyId) ?? undefined,
    messages: (msgs.get(c.id) ?? []).map((m) => toBuyerMessage(m, c.agentLastReadAt)),
  }))
}

/** Résout (ou crée) le fil (acquéreur, bien). L'agent du fil = créateur du bien. */
export async function getOrCreateConversation(
  buyerUserId: string,
  propertyId: string,
): Promise<ConversationRow | null> {
  const existing = await chatDb.conversation.findUnique({
    where: { buyerUserId_propertyId: { buyerUserId, propertyId } },
  })
  if (existing) return existing
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { id: true, createdByAgentId: true },
  })
  if (!property) return null
  return chatDb.conversation.create({
    data: { propertyId, buyerUserId, agentId: property.createdByAgentId },
  })
}
