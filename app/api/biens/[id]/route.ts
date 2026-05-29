import { NextResponse } from 'next/server'
import { z } from 'zod'
import { PropertyStatus } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { authenticateBearer } from '@/lib/auth/bearer'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBearer(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const { id } = await params

  const property = await prisma.property.findUnique({
    where: { id },
    include: {
      propertyTags: { orderBy: { createdAt: 'asc' } },
      videoAnalysis: true,
      documents: true,
    },
  })

  if (!property) {
    return NextResponse.json({ error: 'Bien introuvable' }, { status: 404 })
  }

  if (property.agencyId !== auth.agent.agencyId) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  return NextResponse.json(property)
}

// Allowed status transitions — guard against impossible jumps.
const ALLOWED_TRANSITIONS: Record<PropertyStatus, PropertyStatus[]> = {
  DRAFT:       [PropertyStatus.PUBLISHED],
  PUBLISHED:   [PropertyStatus.UNPUBLISHED],
  UNPUBLISHED: [PropertyStatus.PUBLISHED, PropertyStatus.ARCHIVED],
  ARCHIVED:    [PropertyStatus.UNPUBLISHED],
}

const PatchSchema = z.object({
  statut: z.enum(['DRAFT', 'PUBLISHED', 'UNPUBLISHED', 'ARCHIVED']),
})

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBearer(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const { id } = await params

  let raw: unknown
  try { raw = await req.json() } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  const parsed = PatchSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation', details: parsed.error.issues }, { status: 400 })
  }

  const existing = await prisma.property.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: 'Bien introuvable' }, { status: 404 })
  }
  if (existing.agencyId !== auth.agent.agencyId) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  const next = parsed.data.statut as PropertyStatus
  if (next !== existing.statut && !ALLOWED_TRANSITIONS[existing.statut].includes(next)) {
    return NextResponse.json(
      { error: `Transition interdite : ${existing.statut} → ${next}` },
      { status: 409 },
    )
  }

  const updated = await prisma.property.update({
    where: { id },
    data:  { statut: next },
    select: { id: true, statut: true },
  })

  return NextResponse.json({ success: true, ...updated })
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateBearer(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const { id } = await params

  const existing = await prisma.property.findUnique({ where: { id } })
  if (!existing) {
    return NextResponse.json({ error: 'Bien introuvable' }, { status: 404 })
  }
  if (existing.agencyId !== auth.agent.agencyId) {
    return NextResponse.json({ error: 'Accès refusé' }, { status: 403 })
  }

  // Hard delete is only allowed from DRAFT or ARCHIVED.
  if (existing.statut !== PropertyStatus.DRAFT && existing.statut !== PropertyStatus.ARCHIVED) {
    return NextResponse.json(
      { error: 'Suppression interdite : archivez le bien avant de le supprimer.' },
      { status: 409 },
    )
  }

  await prisma.property.delete({ where: { id } })
  return NextResponse.json({ success: true, id })
}
