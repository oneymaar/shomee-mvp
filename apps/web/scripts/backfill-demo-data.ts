#!/usr/bin/env npx tsx
/**
 * backfill-demo-data — remplit les champs enrichis VIDES des biens PUBLISHED
 * avec des données de DÉMO (fausses mais plausibles, cf. lib/demoEnrichment).
 *
 * ⚠️ RÈGLES :
 *  - UPDATE ciblé uniquement — JAMAIS deleteMany/create (on préserve vidéos/scrape).
 *  - Ne remplit QUE le vide (NULL / string vide / tableau vide). N'écrase JAMAIS
 *    un champ déjà peuplé (ex. neighborhoodVibe à 88%).
 *  - Marque isDemoData=true sur chaque bien enrichi.
 *  - Idempotent : relançable sans dégât (un bien déjà complet → SKIP, no-op).
 *
 * Usage :
 *   npx tsx apps/web/scripts/backfill-demo-data.ts --dry-run --limit=3
 *   npx tsx apps/web/scripts/backfill-demo-data.ts --limit=3
 *   npx tsx apps/web/scripts/backfill-demo-data.ts             # tous les PUBLISHED
 */
import 'dotenv/config'
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  genMarket,
  genComposition,
  genTransports,
  genNearby,
  genVibe,
  genIris,
} from './lib/demoEnrichment.ts'

const DRY_RUN = process.argv.includes('--dry-run')
const limitArg = process.argv.find((a) => a.startsWith('--limit='))
const parsedLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : NaN
const LIMIT = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : undefined

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const isBlank = (s: string | null | undefined) => s == null || s.trim() === ''

async function main() {
  const biens = await prisma.property.findMany({
    where: { statut: 'PUBLISHED' },
    orderBy: { createdAt: 'desc' },
    take: LIMIT,
    select: {
      id: true, title: true, arrondissement: true, price: true, surface: true,
      rooms: true, bedrooms: true,
      marketAvgPricePerSqm: true, marketHighPrice: true, marketLowPrice: true, marketEvolution10y: true,
      composition: true, transports: true, nearbyPlaces: true,
      neighborhoodVibe: true, irisZone: true, irisDescription: true, isDemoData: true,
    },
  })

  console.log(
    `Mode: ${DRY_RUN ? 'DRY-RUN (aucun write)' : 'WRITE'} · biens PUBLISHED: ${biens.length}` +
    `${LIMIT ? ` (limite ${LIMIT})` : ''}\n`,
  )

  let enriched = 0
  let skipped = 0

  for (const b of biens) {
    const data: Prisma.PropertyUpdateInput = {}
    const filled: string[] = []
    const kept: string[] = []

    // ── Marché (4 colonnes) — génère si au moins une est vide
    const marketEmpty =
      b.marketAvgPricePerSqm == null || b.marketHighPrice == null ||
      b.marketLowPrice == null || isBlank(b.marketEvolution10y)
    if (marketEmpty) {
      const m = genMarket(b.arrondissement, b.price, b.surface, b.id)
      if (b.marketAvgPricePerSqm == null) { data.marketAvgPricePerSqm = m.marketAvgPricePerSqm; filled.push(`marché avg ${m.marketAvgPricePerSqm} €/m²`) }
      if (b.marketHighPrice == null) data.marketHighPrice = m.marketHighPrice
      if (b.marketLowPrice == null) data.marketLowPrice = m.marketLowPrice
      if (isBlank(b.marketEvolution10y)) { data.marketEvolution10y = m.marketEvolution10y; filled.push(`fourchette ${m.marketLowPrice}–${m.marketHighPrice}, évo ${m.marketEvolution10y}`) }
    } else {
      kept.push('marché')
    }

    // ── Composition (Json) — somme = surface
    const compEmpty = b.composition == null || (Array.isArray(b.composition) && b.composition.length === 0)
    if (compEmpty) {
      const c = genComposition(b.surface, b.rooms, b.bedrooms, b.id)
      data.composition = c as unknown as Prisma.InputJsonValue
      filled.push(`composition ${c.length} pièces (Σ ${c.reduce((s, p) => s + p.surface, 0)} m²)`)
    } else {
      kept.push('composition')
    }

    // ── Transports (String[])
    if (b.transports.length === 0) {
      const t = genTransports(b.arrondissement, b.id)
      data.transports = t
      filled.push(`transports [${t.join(', ')}]`)
    } else {
      kept.push('transports')
    }

    // ── À proximité (String[])
    if (b.nearbyPlaces.length === 0) {
      const nb = genNearby(b.arrondissement, b.id)
      data.nearbyPlaces = nb
      filled.push(`à-proximité [${nb.join(', ')}]`)
    } else {
      kept.push('nearbyPlaces')
    }

    // ── Ambiance — UNIQUEMENT si vide (88% déjà peuplés, à préserver)
    if (isBlank(b.neighborhoodVibe)) {
      const v = genVibe(b.arrondissement, b.id)
      data.neighborhoodVibe = v
      filled.push(`ambiance "${v}"`)
    } else {
      kept.push('neighborhoodVibe')
    }

    // ── IRIS (zone + description, texte)
    if (isBlank(b.irisZone) || isBlank(b.irisDescription)) {
      const iris = genIris(b.arrondissement, b.id)
      if (isBlank(b.irisZone)) { data.irisZone = iris.irisZone; filled.push(`irisZone "${iris.irisZone}"`) }
      if (isBlank(b.irisDescription)) data.irisDescription = iris.irisDescription
    } else {
      kept.push('iris')
    }

    // Rien à remplir → SKIP (idempotence : no-op)
    if (Object.keys(data).length === 0) {
      skipped++
      console.log(`— SKIP   ${b.arrondissement} · ${b.surface} m² · ${(b.title ?? '').slice(0, 36)} (déjà complet)`)
      continue
    }

    data.isDemoData = true
    enriched++

    const ppsm = b.surface > 0 ? Math.round(b.price / b.surface) : 0
    console.log(
      `${DRY_RUN ? '◇ DRY  ' : '● WRITE'} ${b.arrondissement} · ${b.surface} m² · ` +
      `${b.price.toLocaleString('fr-FR')} € (${ppsm} €/m²) · ${(b.title ?? '').slice(0, 42)}`,
    )
    console.log(`         id=${b.id}`)
    for (const f of filled) console.log(`         + ${f}`)
    if (kept.length) console.log(`         (gardés intacts : ${kept.join(', ')})`)

    if (!DRY_RUN) {
      await prisma.property.update({ where: { id: b.id }, data })
    }
  }

  console.log(`\n${'─'.repeat(64)}`)
  console.log(`${DRY_RUN ? 'DRY-RUN' : 'WRITE'} terminé · enrichis: ${enriched} · déjà complets (skip): ${skipped}`)
  if (DRY_RUN) console.log('⚠️  Aucune écriture effectuée (--dry-run).')
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  })
