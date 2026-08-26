import { redirect } from 'next/navigation'
import { getSessionAgentFromCookies, type AgentWithAgency } from '@/lib/auth/agentSession'

/**
 * Garde des pages du back-office. Appelé en tête de CHAQUE page serveur de
 * /agent/* (le tableau de bord faisait `prisma.agent.findFirst()` : n'importe
 * qui devenait l'agent de démo). Pas de garde dans le layout : /agent/admin
 * doit rester joignable SANS session (porte ADMIN_SECRET propre) pour que le
 * tout premier compte puisse être créé.
 */
export async function requireAgentOrRedirect(): Promise<AgentWithAgency> {
  const agent = await getSessionAgentFromCookies()
  if (!agent) redirect('/connexion-agent')
  return agent
}
