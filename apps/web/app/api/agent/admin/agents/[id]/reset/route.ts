import { NextResponse } from 'next/server'
import { checkAdminSecret } from '@/lib/auth/adminSecret'
import { jsonError } from '@/lib/http'
import { newSetupToken } from '@/lib/auth/agentPassword'
import { chatDb } from '@/lib/db/newModels'

export const dynamic = 'force-dynamic'

const SETUP_TTL_MS = 14 * 24 * 60 * 60 * 1000

/**
 * Regénère un lien d'activation — c'est AUSSI la réinitialisation de mot de
 * passe du MVP (pas d'envoi d'email dans l'infra : l'admin transmet le lien).
 * Le mot de passe existant reste valable tant que le lien n'est pas utilisé.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  if (!checkAdminSecret(req)) return jsonError('Non autorisé', 401)
  const { id } = await ctx.params
  const agent = await chatDb.agent.findUnique({ where: { id } })
  if (!agent) return jsonError('Agent introuvable', 404)
  const token = newSetupToken()
  await chatDb.agent.update({
    where: { id },
    data: { setupToken: token, setupTokenExpires: new Date(Date.now() + SETUP_TTL_MS) },
  })
  return NextResponse.json({ setupPath: `/activation-agent/${token}` })
}
