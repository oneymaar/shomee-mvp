import { NextResponse } from 'next/server'
import { requireAppToken } from '@/lib/auth/appToken'
import { verifyIdentityToken, type VerifyConfig } from '@/lib/auth/verifyIdentityToken'
import { providerLogin } from '@/lib/auth/providerLogin'
import { readJsonObject, getString, jsonError } from '@/lib/http'

export const dynamic = 'force-dynamic'

// aud = client id(s) OAuth Google (iOS + web), CSV via GOOGLE_CLIENT_IDS.
function googleConfig(): VerifyConfig {
  const ids = (process.env.GOOGLE_CLIENT_IDS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
  return {
    jwksUrl: 'https://www.googleapis.com/oauth2/v3/certs',
    issuers: ['accounts.google.com', 'https://accounts.google.com'],
    audiences: ids,
  }
}

export async function POST(req: Request) {
  const guard = requireAppToken(req)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await readJsonObject(req)
  const idToken = getString(body, 'idToken')
  const deviceId = getString(body, 'deviceId')
  if (!idToken) return jsonError('idToken requis', 400)

  const claims = await verifyIdentityToken(idToken, googleConfig())
  if (!claims) return jsonError('Token Google invalide', 401)

  const result = await providerLogin({
    provider: 'google',
    sub: claims.sub,
    email: claims.email ?? null,
    name: claims.name ?? null,
    deviceId,
  })
  if (!result) return jsonError('SHOMEE_SESSION_SECRET manquant', 500)
  return NextResponse.json(result)
}
