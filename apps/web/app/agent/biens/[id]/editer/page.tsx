import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { toViewProperty } from '@/lib/serializers/property'
import EditBienClient from './EditBienClient'

export const dynamic = 'force-dynamic'

export default async function EditBienPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // Plus de repli sur une fiche de démonstration : `draft-001` était un bien
  // FICTIF (un haussmannien Kretz) servi à n'importe quel agent atterrissant
  // sur cette URL, et l'assistant y envoyait tout le monde. Un identifiant
  // inconnu est désormais un 404, comme partout ailleurs.
  const dbProp = await prisma.property.findUnique({ where: { id } })
  if (!dbProp) notFound()

  // P0 — le garde-fou de partage ne transite pas par le view-model : on le lit
  // en base et on le passe tel quel au bloc « Partage ».
  return <EditBienClient initialProperty={toViewProperty(dbProp)} initialIsShareable={dbProp.isShareable} />
}
