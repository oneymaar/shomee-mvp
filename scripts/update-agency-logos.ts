#!/usr/bin/env npx tsx
/**
 * Met à jour `Agency.logo` avec les URLs Cloudinary des logos d'agences.
 *
 * Pré-requis : les logos doivent avoir été uploadés sur Cloudinary dans
 * `shomee/agencies/` (cf. scripts/upload-agency-logos.ts ou upload manuel).
 *
 * Sécurité : par défaut, le script VÉRIFIE que chaque URL répond (HTTP 200)
 * avant d'écrire. Si un logo n'est pas encore en ligne, l'agence est laissée
 * avec `logo = null` → PropertyOverlay affiche l'initiale du nom (fallback MVP).
 * On évite ainsi de remplacer une initiale propre par une image cassée.
 *
 * Usage :
 *   npx tsx scripts/update-agency-logos.ts          # vérifie puis écrit
 *   npx tsx scripts/update-agency-logos.ts --force    # écrit sans vérifier
 *   npx tsx scripts/update-agency-logos.ts --dry      # simulation
 */

import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const FORCE = process.argv.includes('--force')
const DRY_RUN = process.argv.includes('--dry')

const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME ?? 'dcysksoo3'
const BASE = `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/shomee/agencies`

// Nom d'agence (exact, tel qu'en DB) → fichier Cloudinary (.jpg = pastille
// blanche aplatie, cf. scripts/upload-agency-logos.ts).
// Les agences d'une même enseigne partagent le logo (Laforêt, Orpi).
// Varenne & Enfants Rouges : pas de logo trouvable → URL absente, la
// vérification les ignore et le feed garde l'initiale.
const AGENCY_LOGOS: Record<string, string> = {
  'Kretz Real Estate': `${BASE}/kretz.jpg`,
  'Barnes Tour Eiffel': `${BASE}/barnes.jpg`,
  'Junot Immobilier': `${BASE}/junot.jpg`,
  'Varenne & Associés': `${BASE}/varenne.jpg`,
  'Engel & Völkers Marais': `${BASE}/engel-volkers.jpg`,
  'Daniel Féau Passy': `${BASE}/daniel-feau.jpg`,
  'Frédélion Trocadéro': `${BASE}/fredelion.jpg`,
  'Laforêt Monceau': `${BASE}/laforet.jpg`,
  'Laforêt Batignolles': `${BASE}/laforet.jpg`,
  'Century 21 Bastille': `${BASE}/century21.jpg`,
  'Orpi Nation': `${BASE}/orpi.jpg`,
  'Orpi Saint-Cloud Sèvres': `${BASE}/orpi.jpg`,
  "L'Agence des Enfants Rouges": `${BASE}/enfants-rouges.jpg`,
  'Morriss Montparnasse': `${BASE}/morriss.jpg`,
  'Guy Hoquet Neuilly': `${BASE}/guy-hoquet.jpg`,
  'IAD Boulogne-Issy': `${BASE}/iad.jpg`,
}

async function urlExists(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { method: 'HEAD' })
    return res.ok
  } catch {
    return false
  }
}

async function main() {
  console.log(`\n🖼️  Mise à jour des logos d'agences${DRY_RUN ? ' (DRY RUN)' : ''}${FORCE ? ' (FORCE)' : ''}\n`)

  let updated = 0
  let skipped = 0

  for (const [name, logo] of Object.entries(AGENCY_LOGOS)) {
    if (!FORCE) {
      const ok = await urlExists(logo)
      if (!ok) {
        console.log(`⏭️   ${name.padEnd(30)} — logo absent sur Cloudinary, on garde le fallback initiale`)
        skipped++
        continue
      }
    }

    if (!DRY_RUN) {
      const res = await prisma.agency.updateMany({ where: { name }, data: { logo } })
      if (res.count === 0) {
        console.warn(`⚠️   Aucune agence "${name}" en DB`)
        continue
      }
    }
    console.log(`✅  ${name.padEnd(30)} → ${logo}`)
    updated++
  }

  console.log(`\n${updated} logo(s) mis à jour, ${skipped} ignoré(s)${DRY_RUN ? ' (simulation)' : ''}.\n`)
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
