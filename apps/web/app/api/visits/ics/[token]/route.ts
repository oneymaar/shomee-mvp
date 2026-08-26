import { prisma } from '@/lib/prisma'
import { chatDb } from '@/lib/db/newModels'
import { buildVisitIcs } from '@/lib/chat/ics'

export const dynamic = 'force-dynamic'

/**
 * Fichier .ics d'une visite — authentifié par le SEUL token du lien
 * (capability token) : les apps d'agenda ne savent pas envoyer d'en-têtes.
 * Non devinable (32 octets), et un agenda qui re-télécharge après annulation
 * voit STATUS:CANCELLED.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const visit = await chatDb.visit.findUnique({ where: { icsToken: token } })
  if (!visit) return new Response('Introuvable', { status: 404 })

  const property = await prisma.property.findUnique({
    where: { id: visit.propertyId },
    select: { title: true, arrondissement: true, district: true, address: true, agency: { select: { name: true } } },
  })
  const agent = await prisma.agent.findUnique({ where: { id: visit.agentId }, select: { name: true } })

  const ics = buildVisitIcs({
    id: visit.id,
    scheduledAt: visit.scheduledAt,
    durationMin: visit.durationMin,
    cancelled: visit.status === 'CANCELLED',
    propertyTitle: property?.title ?? 'Bien immobilier',
    propertyLocation:
      property?.address ??
      [property?.arrondissement, property?.district].filter(Boolean).join(' · ') ??
      'Paris',
    agencyName: property?.agency?.name ?? 'SHOMEE',
    agentName: agent?.name ?? '',
  })

  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'attachment; filename="visite-shomee.ics"',
      'Cache-Control': 'no-store',
    },
  })
}
