import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { checkAdminSecret } from '@/lib/auth/adminSecret'
import { readJsonObject, getString, jsonError } from '@/lib/http'
import { newSetupToken } from '@/lib/auth/agentPassword'
import { chatDb } from '@/lib/db/newModels'

export const dynamic = 'force-dynamic'

const SETUP_TTL_MS = 14 * 24 * 60 * 60 * 1000 // 14 jours

/**
 * Administration des comptes agents — réservé à Olivier via ADMIN_SECRET
 * (même schéma que le TikTok Studio). Il crée un compte à partir d'un email ;
 * la réponse porte le LIEN D'ACTIVATION à transmettre à l'agent (par l'email
 * de son choix — aucune infrastructure d'envoi requise pour ce MVP).
 */
export async function GET(req: Request) {
  if (!checkAdminSecret(req)) return jsonError('Non autorisé', 401)
  const agents = await chatDb.agent.findMany({ orderBy: { createdAt: 'desc' } })
  const agencies = await prisma.agency.findMany({ select: { id: true, name: true } })
  const byId = new Map(agencies.map((a) => [a.id, a.name]))
  return NextResponse.json({
    agents: agents.map((a) => ({
      id: a.id,
      name: a.name,
      email: a.email,
      agency: byId.get(a.agencyId) ?? '—',
      hasPassword: !!a.passwordHash,
      pendingSetup:
        !!a.setupToken && !!a.setupTokenExpires && a.setupTokenExpires.getTime() > Date.now(),
      setupPath: a.setupToken ? `/activation-agent/${a.setupToken}` : null,
    })),
  })
}

export async function POST(req: Request) {
  if (!checkAdminSecret(req)) return jsonError('Non autorisé', 401)
  const body = await readJsonObject(req)
  const name = getString(body, 'name')
  const email = getString(body, 'email')?.toLowerCase()
  const agencyName = getString(body, 'agencyName')
  if (!name || !email || !agencyName) {
    return jsonError('Nom, email et agence requis', 400)
  }

  const existing = await chatDb.agent.findUnique({ where: { email } })
  if (existing) return jsonError('Un agent existe déjà avec cet email', 409)

  // Agence : réutilisée si le nom correspond exactement, créée sinon.
  const agency =
    (await prisma.agency.findFirst({ where: { name: agencyName } })) ??
    (await prisma.agency.create({ data: { name: agencyName } }))

  const token = newSetupToken()
  const agent = await chatDb.agent.create({
    data: {
      name,
      email,
      agencyId: agency.id,
      setupToken: token,
      setupTokenExpires: new Date(Date.now() + SETUP_TTL_MS),
    },
  })

  return NextResponse.json({
    agent: { id: agent.id, name: agent.name, email: agent.email, agency: agency.name },
    setupPath: `/activation-agent/${token}`,
  })
}
