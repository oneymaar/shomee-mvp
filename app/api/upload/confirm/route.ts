import { NextResponse } from 'next/server'
import { z } from 'zod'
import { DocumentType } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authenticateBearer } from '@/lib/auth/bearer'
import { computeCompletionRate } from '@/lib/completion'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const ConfirmSchema = z.object({
  bien_id:   z.string().min(1),
  type:      z.enum(['video', 'photo', 'plan', 'visite_virtuelle']),
  url:       z.string().url(),
  public_id: z.string().optional(),
})

export async function POST(req: Request) {
  const auth = await authenticateBearer(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  let raw: unknown
  try { raw = await req.json() } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  const parsed = ConfirmSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation', details: parsed.error.issues }, { status: 400 })
  }
  const { bien_id, type, url, public_id } = parsed.data

  const existing = await prisma.property.findUnique({ where: { id: bien_id } })
  if (!existing) {
    return NextResponse.json({ error: 'Bien introuvable' }, { status: 404 })
  }
  if (existing.agencyId !== auth.agent.agencyId) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // Apply the media update + recompute completion in a single update.
  let touched
  switch (type) {
    case 'video':
      touched = await prisma.property.update({
        where: { id: bien_id },
        data:  { videoUrl: url },
      })
      break
    case 'photo':
      touched = await prisma.property.update({
        where: { id: bien_id },
        data:  { gallery: { push: url } },
      })
      break
    case 'visite_virtuelle':
      touched = await prisma.property.update({
        where: { id: bien_id },
        data:  { matterportUrl: url },
      })
      break
    case 'plan':
      await prisma.document.create({
        data: {
          propertyId: bien_id,
          url,
          type: DocumentType.PLAN,
          nom:  public_id ? public_id.split('/').pop() ?? 'Plan' : 'Plan',
        },
      })
      touched = existing
      break
  }

  const newRate = computeCompletionRate(touched)
  const updated = await prisma.property.update({
    where: { id: bien_id },
    data:  { completionRate: newRate },
  })

  return NextResponse.json({
    success: true,
    bien_id,
    type,
    url,
    completion_rate: newRate,
    property: updated,
  })
}
