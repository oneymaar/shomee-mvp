import { prisma } from '@/lib/prisma'

/**
 * Le compteur de notifications de l'agent — une seule définition, partagée
 * par la page d'accueil du back-office et par la barre d'onglets.
 *
 * « Non lu » = message de l'ACQUÉREUR postérieur au curseur de lecture de
 * l'agent (`agentLastReadAt`). C'est exactement la règle déjà appliquée par la
 * boîte de réception : le badge et la liste ne peuvent donc pas se contredire.
 */

export type Notifications = {
  /** Messages d'acquéreurs jamais lus. */
  messages: number
  /** Fils qui portent au moins un message non lu. */
  fils: number
  /** Fils où l'acquéreur a donné ses disponibilités et attend un créneau. */
  aCaler: number
}

export const AUCUNE: Notifications = { messages: 0, fils: 0, aCaler: 0 }

type Bref = { sender: string; kind: string; createdAt: Date }

/**
 * Un fil dont la dernière demande de visite n'a pas encore reçu de créneau.
 * Même machine à états que l'outil MCP `shomee_ma_journee` — c'est la seule
 * chose qui mérite vraiment de sonner : l'acquéreur a fait sa part.
 */
function attendUnCreneau(messages: Bref[]): boolean {
  let etat: 'rien' | 'attente' | 'a_caler' = 'rien'
  for (const m of messages) {
    if (m.kind === 'VISIT_REQUEST') etat = 'attente'
    else if (m.kind === 'AVAILABILITIES' && etat === 'attente') etat = 'a_caler'
    else if (m.kind === 'VISIT_CONFIRMED') etat = 'rien'
  }
  return etat === 'a_caler'
}

export async function compterNotifications(agentId: string): Promise<Notifications> {
  const fils = await prisma.conversation.findMany({
    where: { agentId },
    select: { id: true, agentLastReadAt: true },
  })
  if (fils.length === 0) return AUCUNE

  const messages = await prisma.message.findMany({
    where: { conversationId: { in: fils.map((f) => f.id) } },
    select: { conversationId: true, sender: true, kind: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  })

  const parFil = new Map<string, Bref[]>()
  for (const m of messages) {
    const liste = parFil.get(m.conversationId) ?? []
    liste.push({ sender: m.sender, kind: m.kind, createdAt: m.createdAt })
    parFil.set(m.conversationId, liste)
  }

  let nonLus = 0
  let filsNonLus = 0
  let aCaler = 0

  for (const fil of fils) {
    const liste = parFil.get(fil.id) ?? []
    const lu = fil.agentLastReadAt?.getTime() ?? 0
    const n = liste.filter((m) => m.sender === 'BUYER' && m.createdAt.getTime() > lu).length
    if (n > 0) {
      nonLus += n
      filsNonLus += 1
    }
    if (attendUnCreneau(liste)) aCaler += 1
  }

  return { messages: nonLus, fils: filsNonLus, aCaler }
}
