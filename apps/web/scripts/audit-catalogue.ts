/**
 * Audit du catalogue — répond à une seule question : combien de vidéos et de
 * biens existent réellement en base, et combien d'entre eux sont visibles par
 * le feed.
 *
 * Trois populations à ne pas confondre :
 *   1. les biens en base (tout ce qui a été créé, Studio TikTok compris) ;
 *   2. les biens porteurs d'une ligne VideoAnalysis — SEULS ceux-là remontent
 *      dans /api/admin/videos, donc seuls ceux-là sont taguables ;
 *   3. les vidéos présentes dans src/data/video-tags.json — SEULES celles-là
 *      sont candidates dans /api/feed/generate.
 *
 * Lancer :
 *   cd /Users/oliviermenart/shomee-mvp/apps/web
 *   node --experimental-strip-types scripts/audit-catalogue.ts
 */
import 'dotenv/config'
import { PrismaClient, PropertyStatus } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

/** Même extraction que /api/admin/videos — l'identité d'une vidéo est son id Cloudinary. */
function extractCloudinaryId(videoUrl: string): string {
  const match = videoUrl.match(/\/upload\/(?:v\d+\/)?(.+?)\.mp4/)
  return match?.[1] ?? videoUrl
}

type TagRow = { videoId?: unknown }

function readTaggedIds(): Set<string> {
  const file = join(dirname(fileURLToPath(import.meta.url)), '../src/data/video-tags.json')
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf-8')) as unknown
    if (!Array.isArray(parsed)) return new Set()
    const out = new Set<string>()
    for (const row of parsed as TagRow[]) {
      if (typeof row?.videoId === 'string') out.add(row.videoId)
    }
    return out
  } catch {
    return new Set()
  }
}

function line(label: string, value: number | string): void {
  console.log('  ' + label.padEnd(52, '.') + ' ' + String(value))
}

async function main() {
  const props = await prisma.property.findMany({
    select: {
      id: true,
      statut: true,
      videoUrl: true,
      createdAt: true,
      agency: { select: { name: true } },
      videoAnalysis: { select: { id: true } },
    },
  })

  const tagged = readTaggedIds()

  const published = props.filter((p) => p.statut === PropertyStatus.PUBLISHED)
  const withVideo = props.filter((p) => Boolean(p.videoUrl))
  const withAnalysis = withVideo.filter((p) => p.videoAnalysis !== null)

  const videosAll = new Set(withVideo.map((p) => extractCloudinaryId(p.videoUrl!)))
  const videosTaggable = new Set(withAnalysis.map((p) => extractCloudinaryId(p.videoUrl!)))
  const videosTaggedPresent = new Set([...videosAll].filter((v) => tagged.has(v)))

  const biensServisParLeFeed = withVideo.filter((p) =>
    tagged.has(extractCloudinaryId(p.videoUrl!)),
  ).length

  console.log('\nBASE')
  line('biens en base', props.length)
  line('dont PUBLISHED', published.length)
  line('dont porteurs d une videoUrl', withVideo.length)
  line('videos distinctes en base', videosAll.size)

  console.log('\nTAGGER  (/api/admin/videos : videoAnalysis obligatoire)')
  line('biens visibles dans le tagger', withAnalysis.length)
  line('videos distinctes taguables', videosTaggable.size)
  line('videos INVISIBLES dans le tagger', videosAll.size - videosTaggable.size)

  console.log('\nFEED  (/api/feed/generate : video-tags.json uniquement)')
  line('entrees dans video-tags.json', tagged.size)
  line('dont retrouvees en base', videosTaggedPresent.size)
  line('videos en base jamais taguees', videosAll.size - videosTaggedPresent.size)
  line('biens atteignables par le feed', biensServisParLeFeed)
  line('biens hors de portee du feed', withVideo.length - biensServisParLeFeed)

  const parAgence = new Map<string, number>()
  for (const p of props) {
    const name = p.agency?.name ?? '(sans agence)'
    parAgence.set(name, (parAgence.get(name) ?? 0) + 1)
  }
  console.log('\nREPARTITION PAR AGENCE')
  for (const [name, n] of [...parAgence].sort((a, b) => b[1] - a[1])) {
    line(name, n)
  }

  const parJour = new Map<string, number>()
  for (const p of props) {
    const day = p.createdAt.toISOString().slice(0, 10)
    parJour.set(day, (parJour.get(day) ?? 0) + 1)
  }
  console.log('\nCREATION PAR JOUR')
  for (const [day, n] of [...parJour].sort()) {
    line(day, n)
  }
  console.log('')
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
