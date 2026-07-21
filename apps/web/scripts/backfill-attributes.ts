/**
 * Backfill tri-état + IRIS — à lancer APRÈS la migration nullable
 * (`npx prisma db push`) et AVANT de compter sur les doutes du feed réel.
 *
 *   cd apps/web
 *   npx tsx scripts/backfill-attributes.ts            # dry-run (rapport seul)
 *   npx tsx scripts/backfill-attributes.ts --write    # applique
 *   npx tsx scripts/backfill-attributes.ts --write --limit 50
 *
 * Ce qu'il fait, PAR BIEN RÉEL (isDemoData=false ; les biens démo gardent
 * leurs données plausibles) :
 *  1. RESET tri-état : les booléens structurés hérités du @default(false)
 *     repassent à NULL (= inconnu) puis…
 *  2. RÉ-AFFIRMATION : le normaliseur déterministe (features agent + tags
 *     IA + description) ré-affirme ce que le texte PROUVE — y compris les
 *     négations (« sans ascenseur » → hasElevator=false).
 *  3. Étage : extrait du texte si la colonne est vide.
 *  4. Scores sémantiques : bump quand le texte l'affirme et que la colonne
 *     est vide (lumineux → luminosity 0.8…).
 *  5. irisId : mapLat/mapLng → point-in-polygon sur les IRIS (Paris + 92/93/94)
 *     → filtre géo EXACT du feed réel. (--skip-iris pour sauter cette étape.)
 */

import { PrismaClient } from '@prisma/client'
import { normalizePropertyText } from '@shomee/core/matching/attributes'
import {
  fetchParisGeoData,
  fetchParisIris,
  fetchSuburbanCommunes,
  type GeoZone,
} from '@shomee/core/geo/geoDataService'

const prisma = new PrismaClient()

const WRITE = process.argv.includes('--write')
const SKIP_IRIS = process.argv.includes('--skip-iris')
const limitIdx = process.argv.indexOf('--limit')
const LIMIT = limitIdx > -1 ? parseInt(process.argv[limitIdx + 1], 10) : undefined

// ─── Point-in-polygon (ray casting), lon/lat GeoJSON ────────────────────────

function pointInRing(lng: number, lat: number, ring: number[][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside
    }
  }
  return inside
}

function pointInZone(lng: number, lat: number, zone: GeoZone): boolean {
  const g = zone.feature?.geometry
  if (!g) return false
  if (g.type === 'Polygon') {
    const [outer, ...holes] = g.coordinates as number[][][]
    return pointInRing(lng, lat, outer) && !holes.some((h) => pointInRing(lng, lat, h))
  }
  if (g.type === 'MultiPolygon') {
    for (const poly of g.coordinates as number[][][][]) {
      const [outer, ...holes] = poly
      if (pointInRing(lng, lat, outer) && !holes.some((h) => pointInRing(lng, lat, h))) return true
    }
  }
  return false
}

// ─── Main ───────────────────────────────────────────────────────────────────

const TRISTATE_COLUMNS = [
  'hasElevator', 'hasTerrace', 'hasBalcony', 'hasGarden', 'hasCellar',
  'hasParking', 'hasConcierge', 'isGroundFloor',
] as const

const ASSERTION_TO_COLUMN: Record<string, string> = {
  has_elevator: 'hasElevator',
  has_terrace: 'hasTerrace',
  has_balcony: 'hasBalcony',
  has_garden: 'hasGarden',
  has_cellar: 'hasCellar',
  has_parking: 'hasParking',
  has_concierge: 'hasConcierge',
  is_ground_floor: 'isGroundFloor',
  has_vis_a_vis: 'hasVisAVis',
  is_renovated: 'isRenovated',
  has_fireplace: 'hasFireplace',
  is_traversant: 'isTraversant',
  is_quiet_street: 'isQuietStreet',
}

const SEMANTIC_TO_COLUMN: Record<string, string> = {
  luminosity: 'luminosity',
  quietness: 'quietness',
  charm: 'charm',
  spaciousness: 'spaciousness',
}

async function main() {
  console.log(`Backfill tri-état + IRIS — mode ${WRITE ? 'ÉCRITURE' : 'DRY-RUN'}`)

  let iris: GeoZone[] = []
  if (!SKIP_IRIS) {
    console.log('Chargement des géométries IRIS (opendata)…')
    const [{ quartiers }, communes] = await Promise.all([
      fetchParisGeoData(),
      fetchSuburbanCommunes(),
    ])
    iris = await fetchParisIris(quartiers, communes)
    console.log(`  ${iris.length} IRIS chargés.`)
  }

  const properties = await prisma.property.findMany({
    where: { isDemoData: false },
    include: { propertyTags: { select: { label: true, source: true, validated: true } } },
    ...(LIMIT ? { take: LIMIT } : {}),
  })
  console.log(`${properties.length} biens réels à traiter.`)

  const stats = {
    updated: 0,
    assertionsSet: 0,
    resetToNull: 0,
    floorsSet: 0,
    semanticSet: 0,
    irisSet: 0,
    irisMiss: 0,
  }

  for (const p of properties) {
    const norm = normalizePropertyText({
      features: p.features,
      tags: p.propertyTags.map((t) => ({ label: t.label, source: t.source })),
      description: p.description,
    })

    const data: Record<string, unknown> = {}

    // 1+2. Tri-état : reset à NULL puis ré-affirmation par le texte.
    for (const col of TRISTATE_COLUMNS) {
      const assertionKey = Object.entries(ASSERTION_TO_COLUMN).find(([, c]) => c === col)?.[0]
      const asserted = assertionKey
        ? (norm.assertions as Record<string, boolean | number | undefined>)[assertionKey]
        : undefined
      const target = typeof asserted === 'boolean' ? asserted : null
      const current = (p as unknown as Record<string, unknown>)[col]
      if (current !== target) {
        data[col] = target
        if (target === null) stats.resetToNull++
        else stats.assertionsSet++
      }
    }
    // Colonnes pivot (nouvelles — pas de reset nécessaire, elles naissent NULL).
    for (const [aKey, col] of Object.entries(ASSERTION_TO_COLUMN)) {
      if ((TRISTATE_COLUMNS as readonly string[]).includes(col)) continue
      const asserted = (norm.assertions as Record<string, boolean | number | undefined>)[aKey]
      if (typeof asserted === 'boolean' && (p as unknown as Record<string, unknown>)[col] !== asserted) {
        data[col] = asserted
        stats.assertionsSet++
      }
    }

    // 3. Étage depuis le texte, seulement si la colonne est vide.
    if (p.floor === null && typeof norm.assertions.floor === 'number') {
      data.floor = norm.assertions.floor
      stats.floorsSet++
    }

    // 4. Scores sémantiques (colonne vide uniquement).
    for (const [key, col] of Object.entries(SEMANTIC_TO_COLUMN)) {
      const hint = (norm.semanticHints as Record<string, number | undefined>)[key]
      if (hint !== undefined && (p as unknown as Record<string, unknown>)[col] === null) {
        data[col] = hint
        stats.semanticSet++
      }
    }

    // 5. IRIS d'appartenance.
    if (!SKIP_IRIS && p.mapLat !== null && p.mapLng !== null) {
      const zone = iris.find((z) => pointInZone(p.mapLng as number, p.mapLat as number, z))
      if (zone) {
        const currentIris = (p as unknown as { irisId?: string | null }).irisId ?? null
        if (currentIris !== zone.id) {
          data.irisId = zone.id
          stats.irisSet++
        }
      } else {
        stats.irisMiss++
      }
    }

    if (Object.keys(data).length > 0) {
      stats.updated++
      if (WRITE) {
        await prisma.property.update({ where: { id: p.id }, data })
      }
    }
  }

  console.log('\n── Rapport ──')
  console.log(`biens modifiés     : ${stats.updated}${WRITE ? '' : ' (dry-run, rien écrit)'}`)
  console.log(`reset → NULL       : ${stats.resetToNull} (fin du faux « false »)`)
  console.log(`affirmations texte : ${stats.assertionsSet}`)
  console.log(`étages extraits    : ${stats.floorsSet}`)
  console.log(`scores sémantiques : ${stats.semanticSet}`)
  console.log(`irisId calculés    : ${stats.irisSet} (aucun IRIS trouvé : ${stats.irisMiss})`)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
