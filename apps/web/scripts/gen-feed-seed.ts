/**
 * Génère packages/core/src/data/feedSeed.json — snapshot statique des 4 biens
 * publiés les plus récents, projetés EXACTEMENT comme /api/properties (GET sans
 * brief). Source unique partagée web + mobile (importée via @shomee/core/data).
 * Sert à un accès instantané au feed (aucun fetch, aucun écran vide) lors de
 * l'accès direct sans critères.
 *
 * Régénérer après tout changement notable du catalogue :
 *   node --experimental-strip-types scripts/gen-feed-seed.ts
 */
import 'dotenv/config'
import { PrismaClient, PropertyStatus } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { toViewProperty } from '../lib/serializers/property.ts'

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
})

type RawChapter = { label: string; startSec?: number; fraction?: number }

async function main() {
  const props = await prisma.property.findMany({
    where: { statut: PropertyStatus.PUBLISHED },
    orderBy: { createdAt: 'desc' },
    include: {
      agency: { select: { name: true, logo: true } },
      videoAnalysis: { select: { chapitres: true } },
    },
    take: 4,
  })

  const seed = props.map((p) => {
    const view = toViewProperty(p)
    const va = p.videoAnalysis?.chapitres
    const chapters =
      Array.isArray(va) && va.length > 0 ? (va as unknown as RawChapter[]) : null
    return {
      ...view,
      agencyName: p.agency?.name ?? undefined,
      agencyLogo: p.agency?.logo ?? null,
      chapters,
    }
  })

  const out = join(dirname(fileURLToPath(import.meta.url)), '../../../packages/core/src/data/feedSeed.json')
  writeFileSync(out, JSON.stringify(seed, null, 2) + '\n')
  console.log(`wrote ${seed.length} biens -> ${out}`)
  for (const p of seed) {
    console.log(
      `  ${p.id} | ${p.title} | ${p.surface}m² ${p.rooms}p | video=${(p.videoUrl ?? '∅').slice(0, 46)} | chapters=${Array.isArray(p.chapters) ? p.chapters.length : 0}`,
    )
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
