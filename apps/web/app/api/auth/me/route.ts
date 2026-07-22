import { NextResponse } from 'next/server'
import { requireAppToken } from '@/lib/auth/appToken'
import { getSessionUser } from '@/lib/auth/sessionUser'
import { publicUser } from '@/lib/auth/publicUser'
import { jsonError } from '@/lib/http'

export const dynamic = 'force-dynamic'

/** Etat de session courant (Bearer JWT). Sert au boot de l'app. */
export async function GET(req: Request) {
  const guard = requireAppToken(req)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const user = await getSessionUser(req)
  if (!user) return jsonError('Non authentifie', 401)
  return NextResponse.json({ user: publicUser(user) })
}
