import { NextResponse } from 'next/server'
import { requireAppToken } from '@/lib/auth/appToken'
import { verifyIdentityToken, type VerifyConfig } from '@/lib/auth/verifyIdentityToken'
import { providerLogin } from '@/lib/auth/providerLogin'
import { readJsonObject, getString, jsonError } from '@/lib/http'

export const dynamic = 'force-dynamic'

// aud = bundle id de l'app (identity token natif Apple). CSV possible.
function appleConfig(): VerifyConfig {
  const bundle = process.env.APPLE_BUNDLE_ID ?? 'com.shomee.app'
  const audiences = bundle.split(',').map((s) => s.trim()).filter(Boolean)
  return { jwksUrl: 'https://appleid.apple.com/auth/keys', issuers: ['https://appleid.apple.com'], audiences }
}

export async function POST(req: Request) {
  const guard = requireAppToken(req)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })

  const body = await readJsonObject(req)
  const identityToken = getString(body, 'identityToken')
  const deviceId = getString(body, 'deviceId')
  // Apple ne renvoie le nom qu'a la 1re autorisation — passe separement par l'app.
  const fullName = getString(body, 'fullName')
  if (!identityToken) return jsonError('identityToken requis', 400)

  const claims = await verifyIdentityToken(identityToken, appleConfig())
  if (!claims) return jsonError('Token Apple invalide', 401)

  const result = await providerLogin({
    provider: 'apple',
    sub: claims.sub,
    email: claims.email ?? null,
    name: fullName ?? claims.name ?? null,
    deviceId,
  })
  if (!result) return jsonError('SHOMEE_SESSION_SECRET manquant', 500)
  return NextResponse.json(result)
}
