import { NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'
import { requireAppToken } from '@/lib/auth/appToken'
import { getSessionUser } from '@/lib/auth/sessionUser'
import { prisma } from '@/lib/prisma'
import { readJsonObject, jsonError } from '@/lib/http'

export const dynamic = 'force-dynamic'

/**
 * Persiste le brief de l'utilisateur connecte dans BuyerProfile
 * (rattachement brief → user). Garde : token applicatif + Bearer JWT.
 */
export async function POST(req: Request) {
  const guard = requireAppToken(req)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const user = await getSessionUser(req)
  if (!user) return jsonError('Non authentifie', 401)

  const body = await readJsonObject(req)
  const parsedCriteria = (Array.isArray(body.parsedCriteria) ? body.parsedCriteria : []) as unknown as Prisma.InputJsonValue
  const rawTags = Array.isArray(body.rawTags) ? body.rawTags.filter((t): t is string => typeof t === 'string') : []
  const searchPreferences = (body.searchPreferences && typeof body.searchPreferences === 'object'
    ? body.searchPreferences
    : {}) as unknown as Prisma.InputJsonValue

  const profile = await prisma.buyerProfile.upsert({
    where: { userId: user.id },
    update: { parsedCriteria, rawTags, searchPreferences },
    create: { userId: user.id, parsedCriteria, rawTags, searchPreferences },
  })
  return NextResponse.json({ ok: true, profileId: profile.id })
}
