#!/usr/bin/env npx tsx
/**
 * Génère src/data/iris_codes_insee.json — mapping (nom IRIS Shomee, arrondissement) → CODE_IRIS INSEE 9 chiffres.
 *
 * Source : référentiel IRIS officiel IGN/INSEE, dataset "Contours IRIS" sur data.gouv.fr.
 * Le mapping est nécessaire pour appeler l'API Intent Analytics à la maille IRIS fine
 * (v2 du moteur de prix, cf. ARCHITECTURE.md § "v2 — maille IRIS fine").
 *
 * Stratégie de résolution :
 *   1. Charge le GeoJSON IGN (--input <path> ou téléchargement auto via API data.gouv.fr).
 *   2. Filtre sur Paris (CODE_IRIS commence par 751).
 *   3. Construit un index : label normalisé → liste de { CODE_IRIS, CODE_COM }.
 *   4. Pour chaque (iris_code, arr du quartier) de shomee_quartiers.json :
 *        a. Match direct dans l'arr du quartier (cas standard).
 *        b. Fallback : match dans un autre arrondissement parisien
 *           (cas réel — beaucoup de quartiers Shomee débordent, ex. port-royal
 *           qui inclut "Val de grâce 2" alors qu'il est rattaché à arr-14).
 *        c. Sinon : non résolu.
 *   5. Output keyé par l'arr RÉEL de l'IRIS (déduit de CODE_IRIS), pas l'arr du quartier.
 *   6. Logue les non-résolus pour correction manuelle.
 *
 * Usage :
 *   npx tsx scripts/generate-iris-mapping.ts
 *   npx tsx scripts/generate-iris-mapping.ts --input /chemin/vers/contours-iris.geojson
 *
 * Output : src/data/iris_codes_insee.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

// ─── Config ─────────────────────────────────────────────────────────────────

const QUARTIERS_PATH = resolve(process.cwd(), 'shomee_quartiers.json')
const OUTPUT_PATH = resolve(process.cwd(), 'src/data/iris_codes_insee.json')
const CACHE_PATH = resolve(process.cwd(), 'tmp/contours-iris.geojson')

// Le dataset data.gouv.fr "Contours IRIS" n'expose pas de GeoJSON direct
// (uniquement WMS/WFS via la Géoplateforme IGN). On interroge le WFS directement
// pour récupérer tous les IRIS d'Île-de-France — nécessaire pour résoudre les
// quartiers Shomee qui débordent (ex. porte-maillot sur Neuilly/92).
//
// Le WFS plafonne à 5000 features par requête (hard limit serveur), donc on
// récupère un département à la fois (chacun fait <1000 IRIS).
const IDF_DEPT_CODES = ['75', '77', '78', '91', '92', '93', '94', '95']
const WFS_BASE = 'https://data.geopf.fr/wfs/ows'

function wfsUrlForDept(dept: string): string {
  return (
    WFS_BASE +
    '?SERVICE=WFS&VERSION=2.0.0&REQUEST=GetFeature' +
    '&TYPENAMES=STATISTICALUNITS.IRIS:contours_iris' +
    '&outputFormat=application/json' +
    '&CQL_FILTER=' + encodeURIComponent(`code_insee LIKE '${dept}%'`) +
    '&COUNT=5000'
  )
}

// ─── Types ──────────────────────────────────────────────────────────────────

interface Quartier {
  id: string
  arr: string  // "arr-1" .. "arr-20"
  iris_codes: string[]
  [key: string]: unknown
}

interface IrisProps {
  CODE_IRIS?: string
  NOM_IRIS?: string
  TYP_IRIS?: string
  TYPE_IRIS?: string
  INSEE_COM?: string
  CODE_COM?: string
  code_iris?: string
  nom_iris?: string
  type_iris?: string
  typ_iris?: string
  insee_com?: string
  code_com?: string
  [key: string]: unknown
}

interface IrisFeature {
  properties?: IrisProps
}

interface GeoJson {
  features: IrisFeature[]
}

interface IndexEntry {
  codeIris: string
  codeCom: string
  typeIris: string
}

interface MappingEntry {
  code_iris: string
  type_iris: string
  low_confidence?: true
  no_market_data?: true
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Normalisation pour le matching label-à-label : minuscules, sans accents, espaces réduits. */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[''']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/** "arr-12" → "75112" */
function arrToCodeCommune(arr: string): string {
  const n = parseInt(arr.split('-')[1], 10)
  if (!Number.isInteger(n) || n < 1 || n > 20) throw new Error(`arr invalide: ${arr}`)
  return `751${String(n).padStart(2, '0')}`
}

/**
 * Suffixe de clé pour le mapping :
 *   - Paris (CODE_COM 75101..75120) → "arr-N" (lisible, cohérent avec ARCHITECTURE.md)
 *   - Autres communes IDF           → CODE_COM 5 chiffres brut (ex. "92051" pour Neuilly)
 */
function codeComToKeySuffix(code: string): string {
  if (code.startsWith('751') && code.length === 5) {
    return `arr-${parseInt(code.slice(3), 10)}`
  }
  return code
}

function getCodeIris(p: IrisProps): string | undefined {
  return p.CODE_IRIS ?? p.code_iris
}

function getNomIris(p: IrisProps): string | undefined {
  return p.NOM_IRIS ?? p.nom_iris
}

function getTypeIris(p: IrisProps): string {
  return p.TYP_IRIS ?? p.type_iris ?? p.TYPE_IRIS ?? p.typ_iris ?? '?'
}

/**
 * Flags dérivés du type IRIS :
 *   - H (habitat)   → fiable, rien à signaler
 *   - A (activité)  → low_confidence (peu de logements résidentiels, DVF instable)
 *   - D (divers)    → no_market_data (parcs, monuments, plans d'eau, zéro logement)
 */
function flagsForType(t: string): Pick<MappingEntry, 'low_confidence' | 'no_market_data'> {
  if (t === 'D') return { no_market_data: true }
  if (t === 'A') return { low_confidence: true }
  return {}
}

async function downloadIrisDataset(): Promise<string> {
  process.stdout.write(`Téléchargement des IRIS Île-de-France via le WFS Géoplateforme (1 requête par dept)…\n`)
  const allFeatures: IrisFeature[] = []
  for (const dept of IDF_DEPT_CODES) {
    const url = wfsUrlForDept(dept)
    const res = await fetch(url, { signal: AbortSignal.timeout(120_000) })
    if (!res.ok) throw new Error(`HTTP ${res.status} sur dept ${dept}`)
    const json = await res.json() as { features: IrisFeature[]; numberMatched?: number; numberReturned?: number }
    const matched = json.numberMatched ?? json.features.length
    const returned = json.numberReturned ?? json.features.length
    if (matched > returned) {
      throw new Error(`Dept ${dept} tronqué : ${returned}/${matched} features. Plafond WFS atteint.`)
    }
    process.stdout.write(`  dept ${dept} : ${json.features.length} IRIS\n`)
    allFeatures.push(...json.features)
  }

  const merged: GeoJson = { features: allFeatures }
  mkdirSync(dirname(CACHE_PATH), { recursive: true })
  const out = JSON.stringify(merged)
  writeFileSync(CACHE_PATH, out, 'utf-8')
  process.stdout.write(`  Cache : ${CACHE_PATH} (${(out.length / 1024).toFixed(0)} KB, ${allFeatures.length} IRIS au total)\n`)
  return CACHE_PATH
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  // 1. Résoudre le chemin du GeoJSON
  const inputIdx = process.argv.indexOf('--input')
  let inputPath = inputIdx >= 0 ? process.argv[inputIdx + 1] : undefined
  if (!inputPath) {
    inputPath = existsSync(CACHE_PATH) ? CACHE_PATH : await downloadIrisDataset()
  }
  process.stdout.write(`\nLecture : ${inputPath}\n`)

  // 2. Parser le GeoJSON (déjà filtré IDF côté WFS)
  const geo: GeoJson = JSON.parse(readFileSync(inputPath, 'utf-8'))
  process.stdout.write(`  ${geo.features.length} IRIS chargés\n`)
  if (geo.features.length === 0) {
    throw new Error('Aucun IRIS trouvé. Vérifier le format du GeoJSON.')
  }

  // 3. Index : label normalisé → liste de matches (gère le cas — fréquent en
  //    grande couronne — où un même label IRIS existe dans plusieurs communes).
  const index = new Map<string, IndexEntry[]>()
  for (const f of geo.features) {
    const p = f.properties ?? {}
    const codeIris = getCodeIris(p)
    const nomIris = getNomIris(p)
    const typeIris = getTypeIris(p)
    if (!codeIris || !nomIris) continue
    const key = normalize(nomIris)
    const codeCom = codeIris.slice(0, 5)
    const list = index.get(key) ?? []
    list.push({ codeIris, codeCom, typeIris })
    index.set(key, list)
  }
  process.stdout.write(`  ${index.size} labels uniques indexés\n\n`)

  // 4. Résolution
  const quartiers: Quartier[] = JSON.parse(readFileSync(QUARTIERS_PATH, 'utf-8'))
  const mapping: Record<string, MappingEntry> = {}
  const direct: string[] = []
  const crossArr: { label: string; quartierArr: string; actualSuffix: string }[] = []
  const crossCommune: { label: string; quartierArr: string; actualCom: string }[] = []
  const unresolved: { label: string; quartierArr: string; expectedCom: string }[] = []

  for (const q of quartiers) {
    const expectedCom = arrToCodeCommune(q.arr)
    for (const label of q.iris_codes) {
      const matches = index.get(normalize(label)) ?? []
      if (matches.length === 0) {
        unresolved.push({ label, quartierArr: q.arr, expectedCom })
        continue
      }

      // a. Match préférentiel dans l'arr du quartier
      const inExpected = matches.find(m => m.codeCom === expectedCom)
      // b. Sinon fallback dans un autre arrondissement Paris
      const inOtherParis = !inExpected ? matches.find(m => m.codeCom.startsWith('751')) : undefined
      // c. Sinon n'importe quel match IDF (typiquement non-Paris)
      const chosen = inExpected ?? inOtherParis ?? matches[0]
      const actualSuffix = codeComToKeySuffix(chosen.codeCom)
      const outKey = `${label}|${actualSuffix}`

      if (!(outKey in mapping)) {
        mapping[outKey] = {
          code_iris: chosen.codeIris,
          type_iris: chosen.typeIris,
          ...flagsForType(chosen.typeIris),
        }
        if (inExpected) direct.push(outKey)
        else if (chosen.codeCom.startsWith('751')) crossArr.push({ label, quartierArr: q.arr, actualSuffix })
        else crossCommune.push({ label, quartierArr: q.arr, actualCom: chosen.codeCom })
      }
    }
  }

  // 5. Écriture
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true })
  writeFileSync(OUTPUT_PATH, JSON.stringify(mapping, null, 2) + '\n', 'utf-8')

  // Stats par type_iris
  const typeStats: Record<string, number> = {}
  let withLowConfidence = 0
  let withNoMarketData = 0
  for (const e of Object.values(mapping)) {
    typeStats[e.type_iris] = (typeStats[e.type_iris] ?? 0) + 1
    if (e.low_confidence) withLowConfidence++
    if (e.no_market_data) withNoMarketData++
  }

  process.stdout.write(`Écrit : ${OUTPUT_PATH}\n`)
  process.stdout.write(`  ${Object.keys(mapping).length} mappings au total\n`)
  process.stdout.write(`    ${direct.length} match direct\n`)
  process.stdout.write(`    ${crossArr.length} cross-arr (autre arr Paris)\n`)
  process.stdout.write(`    ${crossCommune.length} cross-commune (hors Paris, IDF)\n`)
  process.stdout.write(`    ${unresolved.length} non résolus\n`)
  process.stdout.write(`  Distribution type_iris : ${JSON.stringify(typeStats)}\n`)
  process.stdout.write(`    ${withLowConfidence} entrées flaggées low_confidence (type A)\n`)
  process.stdout.write(`    ${withNoMarketData} entrées flaggées no_market_data (type D)\n\n`)

  if (crossArr.length > 0) {
    process.stdout.write(`=== Cross-arr (IRIS dans un autre arrondissement Paris) ===\n`)
    const seen = new Set<string>()
    for (const c of crossArr) {
      const k = `${c.label}|${c.quartierArr}→${c.actualSuffix}`
      if (seen.has(k)) continue
      seen.add(k)
      process.stdout.write(`  ${c.label.padEnd(40)} quartier=${c.quartierArr.padEnd(7)} IRIS en ${c.actualSuffix}\n`)
    }
    process.stdout.write('\n')
  }

  if (crossCommune.length > 0) {
    process.stdout.write(`=== Cross-commune (IRIS hors Paris, dans l'IDF) ===\n`)
    const seen = new Set<string>()
    for (const c of crossCommune) {
      const k = `${c.label}|${c.quartierArr}→${c.actualCom}`
      if (seen.has(k)) continue
      seen.add(k)
      process.stdout.write(`  ${c.label.padEnd(40)} quartier=${c.quartierArr.padEnd(7)} IRIS en commune ${c.actualCom}\n`)
    }
    process.stdout.write('\n')
  }

  if (unresolved.length > 0) {
    process.stdout.write(`=== Non-résolus (à corriger manuellement dans shomee_quartiers.json) ===\n`)
    const seen = new Set<string>()
    for (const u of unresolved) {
      const k = `${u.label}|${u.quartierArr}`
      if (seen.has(k)) continue
      seen.add(k)
      process.stdout.write(`  ${u.label.padEnd(40)} quartier=${u.quartierArr.padEnd(7)} (cherché dans CODE_COM ${u.expectedCom} + fallback IDF)\n`)
    }
  }
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
