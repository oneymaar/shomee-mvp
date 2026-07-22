import { NextResponse } from 'next/server'
import { requireAppToken } from '@/lib/auth/appToken'
import { prisma } from '@/lib/prisma'
import { signSession } from '@/lib/auth/jwt'
import { publicUser } from '@/lib/auth/publicUser'
import { readJsonObject, getString, jsonError } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * « Continuer sans compte » — cree (ou retrouve) un User INVITE persistant
 * rattache au deviceId, et renvoie un JWT de session. Upgradable plus tard vers
 * Apple/Google (voir providerLogin). Garde : token applicatif.
 */
export async function POST(req: Request) {
  const guard = requireAppToken(req)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await readJsonObject(req)
  const deviceId = getString(body, 'deviceId')
  if (!deviceId) return jsonError('deviceId requis', 400)

  const existing = await prisma.userDevice.findUnique({ where: { deviceId }, include: { user: true } })
  let user = existing?.user ?? null
  if (!user) {
    user = await prisma.user.create({ data: { isGuest: true, role: 'BUYER' } })
    await prisma.userDevice.create({ data: { deviceId, userId: user.id } })
  } else {
    user = await prisma.user.update({ where: { id: user.id }, data: { lastSeenAt: new Date() } })
  }

  const token = signSession(user.id, user.isGuest)
  if (!token) return jsonError('SHOMEE_SESSION_SECRET manquant', 500)
  return NextResponse.json({ token, user: publicUser(user) })
}
