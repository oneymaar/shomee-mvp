import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { toViewProperty } from '@/lib/serializers/property'
import PreviewClient from './PreviewClient'

export const dynamic = 'force-dynamic'

export default async function PreviewBienPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  // Le cas particulier `draft-001` disparaît avec la fiche fictive : c'était
  // lui qui produisait un 404 juste après l'assistant, sur un bien qui
  // n'existait pas.
  const dbProp = await prisma.property.findUnique({ where: { id } })
  if (!dbProp) notFound()

  return <PreviewClient property={toViewProperty(dbProp)} />
}
