import { NextResponse } from 'next/server'
import { AGENT_COOKIE } from '@/lib/auth/agentSession'

export const dynamic = 'force-dynamic'

/** Déconnexion agent — expire le cookie de session. */
export async function POST() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(AGENT_COOKIE, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  })
  return res
}
