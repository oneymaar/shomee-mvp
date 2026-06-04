#!/usr/bin/env npx tsx
/**
 * Upload les logos d'agences (public/agencies/) vers Cloudinary
 * (dossier `shomee/agencies/`), normalisés sur une pastille blanche carrée.
 *
 * Pourquoi la pastille blanche : le badge agence du feed est un cercle à fond
 * sombre (bg-neutral-900). Les logos à éléments foncés (wordmark Engel & Völkers,
 * flamme Moriss, "K" Kretz…) y seraient invisibles. On aplatit donc chaque logo
 * sur fond blanc (JPG) avec une marge → rendu homogène et lisible.
 *
 * Les public_id correspondent aux URLs de scripts/update-agency-logos.ts (.jpg).
 *
 * Usage :
 *   npx tsx scripts/upload-agency-logos.ts          # upload
 *   npx tsx scripts/upload-agency-logos.ts --dry      # liste ce qui serait fait
 */

import 'dotenv/config'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import cloudinary from '../lib/cloudinary'

const DRY_RUN = process.argv.includes('--dry')

// fichier local (public/agencies/…) → public_id Cloudinary (sans extension).
const FILES: ReadonlyArray<[string, string]> = [
  ['public/agencies/Logo Barnes.png', 'shomee/agencies/barnes'],
  ['public/agencies/Logo Junot.png', 'shomee/agencies/junot'],
  ['public/agencies/Logo Kretz.png', 'shomee/agencies/kretz'],
  ['public/agencies/Logo Fredelion.png', 'shomee/agencies/fredelion'],
  ['public/agencies/Logo Engel.png', 'shomee/agencies/engel-volkers'],
  ['public/agencies/Logo Century21.svg', 'shomee/agencies/century21'],
  ['public/agencies/Logo GuyHoquet.png', 'shomee/agencies/guy-hoquet'],
  ['public/agencies/Logo Laforet.jpg', 'shomee/agencies/laforet'],
  ['public/agencies/Logo DanielFeau.svg', 'shomee/agencies/daniel-feau'],
  ['public/agencies/Logo Orpi.svg', 'shomee/agencies/orpi'],
  ['public/agencies/Logo IAD.png', 'shomee/agencies/iad'],
  ['public/agencies/Logo Morriss.png', 'shomee/agencies/morriss'],
  // Sans logo trouvable → fallback initiale dans le feed :
  // Varenne & Associés, L'Agence des Enfants Rouges
]

// Aplatit le logo sur une pastille blanche carrée avec marge.
const WHITE_TILE = [
  { width: 340, height: 340, crop: 'fit' },
  { width: 400, height: 400, crop: 'pad', background: 'white' },
]

async function main() {
  console.log(`\n☁️  Upload des logos vers Cloudinary${DRY_RUN ? ' (DRY RUN)' : ''}\n`)

  let done = 0
  for (const [file, publicId] of FILES) {
    const abs = resolve(process.cwd(), file)
    if (!existsSync(abs)) {
      console.log(`⏭️   ${file} — introuvable, ignoré`)
      continue
    }
    if (DRY_RUN) {
      console.log(`• ${file}  →  ${publicId}.jpg`)
      done++
      continue
    }
    const res = await cloudinary.uploader.upload(abs, {
      public_id: publicId,
      overwrite: true,
      format: 'jpg',
      transformation: WHITE_TILE,
    })
    console.log(`✅  ${publicId}  →  ${res.secure_url}`)
    done++
  }

  console.log(`\n${done} logo(s) ${DRY_RUN ? 'à uploader' : 'uploadé(s)'}.\n`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
