import { NextResponse } from 'next/server'
import { requireAppToken } from '@/lib/auth/appToken'
import { getSessionUser } from '@/lib/auth/sessionUser'
import { prisma } from '@/lib/prisma'
import { jsonError } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * POST /api/account/delete — suppression DÉFINITIVE du compte courant.
 *
 * Efface tout ce que le serveur sait de l'acquéreur :
 *  - les tables comportementales clées par deviceId (InteractionEvent,
 *    CriteriaRevision, BuyerAffinity, CriteriaSuggestion) — pour TOUS les
 *    devices rattachés au compte, plus celui envoyé par l'app (utile pour un
 *    invité dont le device n'aurait pas encore de pont UserDevice) ;
 *  - le User lui-même — BuyerProfile et UserDevice tombent par cascade.
 *
 * Garde-fou : un deviceId reçu dans le corps n'est pris en compte que s'il
 * n'appartient PAS à un autre compte — sans quoi n'importe quelle session
 * pourrait purger l'historique d'autrui en devinant son deviceId.
 *
 * Vaut pour les comptes invités comme pour les comptes Apple/Google : exigence
 * App Store (guideline 5.1.1) autant qu'outil de test « repartir de zéro ».
 */
export async function POST(req: Request) {
  const guard = requireAppToken(req)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const user = await getSessionUser(req)
  if (!user) return jsonError('Non authentifie', 401)

  let bodyDeviceId: string | null = null
  try {
    const body = (await req.json()) as { deviceId?: unknown }
    if (typeof body.deviceId === 'string' && body.deviceId.length > 0) {
      bodyDeviceId = body.deviceId
    }
  } catch {
    /* corps optionnel */
  }

  try {
    if (bodyDeviceId) {
      const owner = await prisma.userDevice.findUnique({
        where: { deviceId: bodyDeviceId },
        select: { userId: true },
      })
      if (owner && owner.userId !== user.id) bodyDeviceId = null
    }

    const devices = await prisma.userDevice.findMany({
      where: { userId: user.id },
      select: { deviceId: true },
    })
    const deviceIds = [
      ...new Set([
        ...devices.map((d: { deviceId: string }) => d.deviceId),
        ...(bodyDeviceId ? [bodyDeviceId] : []),
      ]),
    ]

    if (deviceIds.length > 0) {
      await prisma.$transaction([
        prisma.interactionEvent.deleteMany({ where: { deviceId: { in: deviceIds } } }),
        prisma.criteriaRevision.deleteMany({ where: { deviceId: { in: deviceIds } } }),
        prisma.buyerAffinity.deleteMany({ where: { deviceId: { in: deviceIds } } }),
        prisma.criteriaSuggestion.deleteMany({ where: { deviceId: { in: deviceIds } } }),
      ])
    }

    // BuyerProfile + UserDevice : cascade du schéma.
    await prisma.user.delete({ where: { id: user.id } })

    console.log(
      `[POST /api/account/delete] user=${user.id} devices=${deviceIds.length} purged`,
    )
    return NextResponse.json({ deleted: true })
  } catch (error) {
    console.error('[POST /api/account/delete]', error)
    return jsonError('Suppression impossible', 500)
  }
}
