/**
 * Shomee — backfill des adresses manquantes.
 *
 * Les biens créés avant le champ `address` (seed synthétique + backfill démo)
 * n'ont pas d'adresse. Ce script en génère une plausible (numéro + vraie rue de
 * la zone + CP + ville) via Claude Haiku, groupée par arrondissement/commune,
 * et l'écrit en base. Idempotent : ne touche que les biens `address = null`.
 *
 * Run : npx tsx scripts/backfill-addresses.ts
 */

import { config as loadEnv } from 'dotenv'
loadEnv({ path: '.env.local' })
loadEnv({ path: '.env' })

import Anthropic from '@anthropic-ai/sdk'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const MODEL = 'claude-haiku-4-5-20251001'
const CONCURRENCY = 5

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })

async function mapPool<T, R>(items: T[], fn: (x: T) => Promise<R>, n: number): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const cur = i++
        out[cur] = await fn(items[cur])
      }
    }),
  )
  return out
}

async function addressesForZone(zone: string, count: number): Promise<string[]> {
  const resp = await anthropic.messages.create({
    model: MODEL,
    max_tokens: Math.min(8000, 300 + count * 40),
    messages: [
      {
        role: 'user',
        content: `Génère EXACTEMENT ${count} adresses postales françaises plausibles et variées situées dans « ${zone} ».
Chaque adresse = numéro + vraie rue/avenue existante de cette zone + code postal + ville (ex. "12 rue Saint-Dominique, 75007 Paris" ou "5 avenue du Roule, 92200 Neuilly-sur-Seine").
Varie les rues (pas deux fois la même). Retourne UNIQUEMENT un tableau JSON de ${count} chaînes, sans texte autour.`,
      },
    ],
  })
  const text = resp.content.map((c) => (c.type === 'text' ? c.text : '')).join('').trim()
  const match = text.match(/\[[\s\S]*\]/)
  if (!match) throw new Error(`pas de tableau JSON pour ${zone}`)
  const arr = JSON.parse(match[0]) as unknown[]
  return arr.filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL manquant')
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY manquant')

  const rows = await prisma.property.findMany({
    where: { address: null },
    select: { id: true, arrondissement: true },
  })
  console.log(`→ ${rows.length} biens sans adresse`)
  if (rows.length === 0) return

  // Regroupe par zone
  const byZone = new Map<string, string[]>()
  for (const r of rows) {
    const list = byZone.get(r.arrondissement) ?? []
    list.push(r.id)
    byZone.set(r.arrondissement, list)
  }
  const zones = [...byZone.entries()]
  console.log(`→ ${zones.length} zones distinctes`)

  let done = 0
  await mapPool(
    zones,
    async ([zone, ids]) => {
      let addrs: string[]
      try {
        addrs = await addressesForZone(zone, ids.length)
      } catch (err) {
        console.error(`  ✗ ${zone}: ${err instanceof Error ? err.message : String(err)}`)
        return
      }
      if (addrs.length === 0) {
        console.error(`  ✗ ${zone}: 0 adresse produite`)
        return
      }
      for (let j = 0; j < ids.length; j++) {
        const address = addrs[j % addrs.length] // cycle si le LLM en a produit moins
        await prisma.property.update({ where: { id: ids[j] }, data: { address } })
      }
      done += ids.length
      console.log(`  ✓ ${zone}: ${ids.length} adresses`)
    },
    CONCURRENCY,
  )

  console.log(`\n✓ ${done}/${rows.length} adresses écrites`)
}

main()
  .catch((e) => {
    console.error('[backfill-addresses] fatal:', e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
