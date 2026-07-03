import { notFound } from 'next/navigation'
import TikTokStudioClient from './TikTokStudioClient'

export const dynamic = 'force-dynamic'

export default async function TikTokStudioPage({
  searchParams,
}: {
  searchParams: Promise<{ secret?: string }>
}) {
  const { secret } = await searchParams
  const expected = process.env.ADMIN_SECRET
  // Refuse par défaut si l'env n'est pas configurée. Le secret n'est jamais en dur.
  if (!expected || secret !== expected) notFound()

  return <TikTokStudioClient secret={secret} />
}
