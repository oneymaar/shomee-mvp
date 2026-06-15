import { notFound } from 'next/navigation'
import VideoTaggerClient from './VideoTaggerClient'

export const dynamic = 'force-dynamic'

export default async function VideoTaggerPage({
  searchParams,
}: {
  searchParams: Promise<{ secret?: string }>
}) {
  const { secret } = await searchParams
  const expected = process.env.ADMIN_SECRET
  // Refuse par défaut si l'env n'est pas configurée. Le secret n'est plus en dur.
  if (!expected || secret !== expected) notFound()

  return <VideoTaggerClient secret={secret} />
}
