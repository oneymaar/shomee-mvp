#!/usr/bin/env npx tsx
/**
 * Upload les logos d'agences disponibles localement vers Cloudinary
 * (dossier `shomee/agencies/`), avec le bon `public_id` pour que les URLs
 * correspondent à celles de scripts/update-agency-logos.ts.
 *
 * Ne traite que les fichiers présents dans public/agencies/. Les enseignes
 * sans fichier local restent à uploader manuellement (puis relancer ce script
 * ou ajouter une entrée ci-dessous).
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
  // À compléter au fur et à mesure des logos récupérés :
  // ['public/agencies/Logo Engel.png', 'shomee/agencies/engel-volkers'],
  // ['public/agencies/Logo DanielFeau.png', 'shomee/agencies/daniel-feau'],
  // ['public/agencies/Logo Laforet.png', 'shomee/agencies/laforet'],
  // ['public/agencies/Logo Century21.png', 'shomee/agencies/century21'],
  // ['public/agencies/Logo Orpi.png', 'shomee/agencies/orpi'],
  // ['public/agencies/Logo Morriss.png', 'shomee/agencies/morriss'],
  // ['public/agencies/Logo GuyHoquet.png', 'shomee/agencies/guy-hoquet'],
  // ['public/agencies/Logo IAD.png', 'shomee/agencies/iad'],
  // ['public/agencies/Logo Varenne.png', 'shomee/agencies/varenne'],
  // ['public/agencies/Logo EnfantsRouges.png', 'shomee/agencies/enfants-rouges'],
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
      console.log(`• ${file}  →  ${publicId}`)
      done++
      continue
    }
    const res = await cloudinary.uploader.upload(abs, {
      public_id: publicId,
      overwrite: true,
      resource_type: 'image',
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
