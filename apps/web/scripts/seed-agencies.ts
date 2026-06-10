/**
 * Shomee — seed 15 fictional agencies + one demo agent each.
 *
 * Idempotent: an agency is skipped (by name) if it already exists; partial
 * runs are safe to resume. For each fresh agency, one agent and one demo
 * API key are created. `zone`, `initials` and `color` are display-only
 * metadata; the Agency schema does not store them, so they show up only
 * in the script log.
 *
 * Run:
 *   npx tsx scripts/seed-agencies.ts
 */

import 'dotenv/config'
import { randomBytes } from 'crypto'
import { PrismaClient, AgencyPlan } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

interface AgencyDef {
  name: string
  plan: AgencyPlan
  zone: string
  initials: string
  color: string
  /** Agent attached to the agency on creation. */
  agent: { firstName: string; lastName: string }
}

const AGENCIES: AgencyDef[] = [
  // Luxe / prestige
  { name: 'Barnes Tour Eiffel',            plan: 'PREMIUM', zone: 'Paris 7ème & 15ème',         initials: 'B',   color: '#8B0000', agent: { firstName: 'Sophie',         lastName: 'Marchand' } },
  { name: 'Junot Immobilier',              plan: 'PREMIUM', zone: 'Paris 18ème Montmartre',     initials: 'J',   color: '#B8960C', agent: { firstName: 'Thomas',         lastName: 'Lebrun' } },
  { name: 'Varenne & Associés',            plan: 'PREMIUM', zone: 'Paris 6ème & 7ème',          initials: 'V',   color: '#2C4A7C', agent: { firstName: 'Pierre-Olivier', lastName: 'Roux' } },
  { name: 'Engel & Völkers Marais',        plan: 'PREMIUM', zone: 'Paris 3ème & 4ème',          initials: 'EV',  color: '#C41E3A', agent: { firstName: 'Klaus',          lastName: 'Hoffmann' } },
  { name: 'Daniel Féau Passy',             plan: 'PREMIUM', zone: 'Paris 16ème Passy',          initials: 'DF',  color: '#1A1A2E', agent: { firstName: 'Catherine',      lastName: 'de Maistre' } },

  // Mid-market rive droite
  { name: 'Frédélion Trocadéro',           plan: 'PRO',     zone: 'Paris 16ème Trocadéro',      initials: 'FR',  color: '#4A90A4', agent: { firstName: 'Yasmine',        lastName: 'Benali' } },
  { name: 'Laforêt Monceau',               plan: 'PRO',     zone: 'Paris 8ème & 17ème Monceau', initials: 'LF',  color: '#2E7D32', agent: { firstName: 'Nadia',          lastName: 'Fontaine' } },
  { name: 'Century 21 Bastille',           plan: 'PRO',     zone: 'Paris 11ème & 12ème',        initials: 'C21', color: '#FFB300', agent: { firstName: 'Alexandre',      lastName: 'Petrov' } },
  { name: 'Orpi Nation',                   plan: 'PRO',     zone: 'Paris 20ème & 11ème',        initials: 'O',   color: '#E65100', agent: { firstName: 'Camille',        lastName: 'Dubois' } },
  { name: "L'Agence des Enfants Rouges",   plan: 'PRO',     zone: 'Paris 3ème & 10ème',         initials: 'ER',  color: '#E07B54', agent: { firstName: 'Mehdi',          lastName: 'Hassan' } },

  // Mid-market rive gauche & périphérie
  { name: 'Morriss Montparnasse',          plan: 'PRO',     zone: 'Paris 14ème & 15ème',        initials: 'MM',  color: '#6B4E71', agent: { firstName: 'Charlotte',      lastName: 'Renaud' } },
  { name: 'Laforêt Batignolles',           plan: 'PRO',     zone: 'Paris 17ème Batignolles',    initials: 'LF',  color: '#2E7D32', agent: { firstName: 'Lucas',          lastName: 'Moreau' } },
  { name: 'Guy Hoquet Neuilly',            plan: 'PRO',     zone: 'Neuilly-sur-Seine',          initials: 'GH',  color: '#0277BD', agent: { firstName: 'Béatrice',       lastName: 'Caron' } },
  { name: 'IAD Boulogne-Issy',             plan: 'BASIC',   zone: 'Boulogne-Billancourt & Issy', initials: 'IAD', color: '#00695C', agent: { firstName: 'Karim',          lastName: 'El Amrani' } },
  { name: 'Orpi Saint-Cloud Sèvres',       plan: 'BASIC',   zone: 'Saint-Cloud & Sèvres',       initials: 'O',   color: '#E65100', agent: { firstName: 'Anne-Laure',     lastName: 'Vasseur' } },
]

function maxPropertiesFor(plan: AgencyPlan): number {
  if (plan === 'PREMIUM') return 50
  if (plan === 'PRO') return 20
  return 10
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, ' et ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

function demoApiKey(): string {
  return `shomee_demo_${randomBytes(4).toString('hex')}`
}

async function main() {
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not defined')
  }
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
  const prisma = new PrismaClient({ adapter })

  let created = 0
  let skipped = 0

  try {
    for (const def of AGENCIES) {
      const existing = await prisma.agency.findFirst({ where: { name: def.name } })
      if (existing) {
        console.log(`↷ ${def.name} — déjà en base, skip`)
        skipped++
        continue
      }

      const agentName = `${def.agent.firstName} ${def.agent.lastName}`
      const agentEmail = `agent@${slugify(def.name)}.fr`
      const apiKey = demoApiKey()

      const agency = await prisma.agency.create({
        data: {
          name: def.name,
          plan: def.plan,
          maxProperties: maxPropertiesFor(def.plan),
          agents: {
            create: {
              name: agentName,
              email: agentEmail,
              avatar: null,
              apiKeys: {
                create: {
                  label: 'Demo key',
                  key: apiKey,
                },
              },
            },
          },
        },
        include: { agents: true },
      })

      const agent = agency.agents[0]
      console.log(
        `✓ ${agency.name} — ${def.zone} — agent: ${agent.name} — key: ${apiKey}`,
      )
      created++
    }
  } finally {
    await prisma.$disconnect()
  }

  console.log('')
  console.log('───────────────────────────────────────────')
  console.log(`Total demandé : ${AGENCIES.length}`)
  console.log(`Créées        : ${created}`)
  console.log(`Skippées      : ${skipped}`)
  console.log('───────────────────────────────────────────')
}

main().catch((err) => {
  console.error('[seed-agencies] erreur:', err)
  process.exit(1)
})
