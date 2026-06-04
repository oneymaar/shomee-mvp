import { notFound } from 'next/navigation'
import VideoTaggerClient from './VideoTaggerClient'

export const dynamic = 'force-dynamic'

const ADMIN_SECRET = 'shomee_admin'

export default async function VideoTaggerPage({
  searchParams,
}: {
  searchParams: Promise<{ secret?: string }>
}) {
  const { secret } = await searchParams
  if (secret !== ADMIN_SECRET) notFound()

  return <VideoTaggerClient secret={secret} />
}
