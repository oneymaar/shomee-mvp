import { prisma } from '@/lib/prisma'

/**
 * ⚠️ COUCHE TRANSITOIRE — À SUPPRIMER APRÈS `npx prisma generate`.
 *
 * Écrite le 24/08 dans une session SANS accès réseau : `prisma generate` exige
 * de télécharger ses moteurs (impossible ici), donc le client Prisma du dépôt
 * ne connaît pas encore les modèles Conversation / Message / Visit ni les
 * nouveaux champs d'Agent (passwordHash, setupToken…). Ce fichier déclare À LA
 * MAIN les délégués concernés, avec exactement les signatures utilisées par le
 * code, et caste le client dessus.
 *
 * Les types restent COMPATIBLES avec le vrai client : après régénération, on
 * peut remplacer `chatDb.conversation` par `prisma.conversation` partout et
 * supprimer ce fichier — ou le laisser, il reste correct.
 *
 * TOUT ce qui touche aux nouveaux modèles passe par ici : un seul fichier à
 * nettoyer, aucun `as any` disséminé.
 */

export type MessageSenderValue = 'BUYER' | 'AGENT'
export type MessageKindValue = 'TEXT' | 'VISIT_REQUEST' | 'AVAILABILITIES' | 'VISIT_CONFIRMED' | 'SYSTEM'
export type VisitStatusValue = 'CONFIRMED' | 'CANCELLED'

export interface ConversationRow {
  id: string
  propertyId: string
  buyerUserId: string
  agentId: string
  createdAt: Date
  lastMessageAt: Date
  buyerLastReadAt: Date | null
  agentLastReadAt: Date | null
}

export interface MessageRow {
  id: string
  conversationId: string
  sender: MessageSenderValue
  kind: MessageKindValue
  text: string
  payload: unknown
  createdAt: Date
}

export interface VisitRow {
  id: string
  conversationId: string
  propertyId: string
  buyerUserId: string
  agentId: string
  scheduledAt: Date
  durationMin: number
  status: VisitStatusValue
  icsToken: string
  createdAt: Date
}

/** Champs d'Agent ajoutés par la migration du 24/08. */
export interface AgentAuthFields {
  passwordHash: string | null
  setupToken: string | null
  setupTokenExpires: Date | null
}

interface ConversationDelegate {
  findUnique(args: {
    where: { id: string } | { buyerUserId_propertyId: { buyerUserId: string; propertyId: string } }
  }): Promise<ConversationRow | null>
  findMany(args: {
    where: Partial<Pick<ConversationRow, 'buyerUserId' | 'agentId'>>
    orderBy?: { lastMessageAt: 'desc' | 'asc' }
    take?: number
  }): Promise<ConversationRow[]>
  create(args: {
    data: { propertyId: string; buyerUserId: string; agentId: string }
  }): Promise<ConversationRow>
  update(args: {
    where: { id: string }
    data: Partial<{
      lastMessageAt: Date
      buyerLastReadAt: Date
      agentLastReadAt: Date
    }>
  }): Promise<ConversationRow>
}

interface MessageDelegate {
  findMany(args: {
    where: { conversationId: string } | { conversationId: { in: string[] } }
    orderBy?: { createdAt: 'asc' | 'desc' }
    take?: number
  }): Promise<MessageRow[]>
  create(args: {
    data: {
      conversationId: string
      sender: MessageSenderValue
      kind: MessageKindValue
      text: string
      payload?: unknown
    }
  }): Promise<MessageRow>
}

interface VisitDelegate {
  findUnique(args: { where: { id: string } | { icsToken: string } }): Promise<VisitRow | null>
  create(args: {
    data: {
      conversationId: string
      propertyId: string
      buyerUserId: string
      agentId: string
      scheduledAt: Date
      durationMin: number
      icsToken: string
    }
  }): Promise<VisitRow>
  update(args: { where: { id: string }; data: { status: VisitStatusValue } }): Promise<VisitRow>
}

/** Délégué Agent limité aux besoins de l'auth (nouveaux champs inclus). */
interface AgentAuthDelegate {
  findUnique(args: {
    where: { id: string } | { email: string } | { setupToken: string }
  }): Promise<(AgentAuthFields & { id: string; name: string; email: string; agencyId: string }) | null>
  findMany(args: {
    orderBy?: { createdAt: 'desc' | 'asc' }
  }): Promise<Array<AgentAuthFields & { id: string; name: string; email: string; agencyId: string; createdAt: Date }>>
  create(args: {
    data: {
      name: string
      email: string
      agencyId: string
      setupToken: string
      setupTokenExpires: Date
    }
  }): Promise<AgentAuthFields & { id: string; name: string; email: string; agencyId: string }>
  update(args: {
    where: { id: string }
    data: Partial<{
      passwordHash: string
      setupToken: string | null
      setupTokenExpires: Date | null
      name: string
    }>
  }): Promise<AgentAuthFields & { id: string; name: string; email: string; agencyId: string }>
}

interface ChatClient {
  conversation: ConversationDelegate
  message: MessageDelegate
  visit: VisitDelegate
  agent: AgentAuthDelegate
}

export const chatDb = prisma as unknown as ChatClient
