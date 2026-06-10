import { NextResponse } from 'next/server'
import { z } from 'zod'
import cloudinary from '@/lib/cloudinary'
import { authenticateBearer } from '@/lib/auth/bearer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const SignSchema = z.object({
  folder:        z.string().min(1),
  upload_preset: z.string().optional(),
  eager:         z.string().optional(),
})

export async function POST(req: Request) {
  const auth = await authenticateBearer(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  let raw: unknown
  try { raw = await req.json() } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  const parsed = SignSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation', details: parsed.error.issues }, { status: 400 })
  }

  const apiSecret = process.env.CLOUDINARY_API_SECRET
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME
  const apiKey    = process.env.CLOUDINARY_API_KEY
  if (!apiSecret || !cloudName || !apiKey) {
    return NextResponse.json({ error: 'Cloudinary non configuré' }, { status: 500 })
  }

  const timestamp = Math.round(Date.now() / 1000)
  const paramsToSign: Record<string, string | number> = {
    timestamp,
    folder: parsed.data.folder,
  }
  if (parsed.data.eager) {
    paramsToSign.eager = parsed.data.eager
    paramsToSign.eager_async = 'true'
  }
  if (parsed.data.upload_preset) {
    paramsToSign.upload_preset = parsed.data.upload_preset
  }

  const signature = cloudinary.utils.api_sign_request(paramsToSign, apiSecret)

  return NextResponse.json({
    signature,
    timestamp,
    cloud_name: cloudName,
    api_key: apiKey,
    folder: parsed.data.folder,
    ...(parsed.data.eager ? { eager: parsed.data.eager, eager_async: 'true' } : {}),
    ...(parsed.data.upload_preset ? { upload_preset: parsed.data.upload_preset } : {}),
  })
}
