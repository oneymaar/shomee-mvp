import { NextResponse } from 'next/server'
import { jsonError } from '@/lib/http'
import { getSessionAgent } from '@/lib/auth/agentSession'
import { compterNotifications } from '@/lib/agent/notifications'

export const dynamic = 'force-dynamic'

/**
 * Le compteur que la barre d'onglets interroge — trois entiers, rien d'autre.
 * Volontairement séparé de `/api/agent/conversations` : la barre est présente
 * sur TOUS les écrans du back-office et interroge en boucle ; lui faire
 * charger la boîte de réception complète toutes les trente secondes serait
 * absurde.
 */
export async function GET(req: Request) {
  const agent = await getSessionAgent(req)
  if (!agent) return jsonError('Non authentifié', 401)
  return NextResponse.json(await compterNotifications(agent.id))
}
