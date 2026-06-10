import { notFound } from 'next/navigation'
import { prisma } from '@/lib/prisma'
import { toViewProperty } from '@/lib/serializers/property'
import type { Property } from '@/lib/types'
import PreviewClient from './PreviewClient'

export const dynamic = 'force-dynamic'

export default async function PreviewBienPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params

  let property: Property | null = null

  if (id !== 'draft-001') {
    const dbProp = await prisma.property.findUnique({ where: { id } })
    if (dbProp) property = toViewProperty(dbProp)
  }

  if (!property) notFound()

  return <PreviewClient property={property} />
}
