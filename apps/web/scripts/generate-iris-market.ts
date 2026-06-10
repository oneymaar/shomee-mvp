#!/usr/bin/env npx tsx
/**
 * Génère src/data/iris_market.json — prix marché DVF à la maille IRIS fine (v2).
 *
 * Stratégie (cf. ARCHITECTURE.md § "v2 — maille IRIS fine") :
 *   - Lit src/data/iris_codes_insee.json (mapping label|arr → INSEE code_iris,
 *     produit par scripts/generate-iris-mapping.ts).
 *   - Skip les entrées flaggées no_market_data (type D : parcs, monuments, plans d'eau).
 *   - Pour les autres, appel API Intent Analytics GET /v1/market/snapshot par code_iris.
 *   - Propage le flag low_confidence (type A : zones d'activité, DVF souvent instable).
 *
 * Volume : 636 entrées dans le mapping − 27 type D = ~609 appels API.
 * À ~0,005€/req → ~3€ pour un run complet (couvert par le plan Starter 19€/mois).
 *
 * Throttling : batchs de 10 appels en parallèle, 100ms de pause entre batchs.
 *
 * Usage : INTENT_ANALYTICS_API_KEY=xxx npx tsx scripts/generate-iris-market.ts
 * Output : src/data/iris_market.json
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, unlinkSync } from 'node:fs'
import { resolve, dirname } from 'node:path'

// ─── Config ─────────────────────────────────────────────────────────────────

const API_BASE = 'https://api.intentanalytics.fr/v1/market/snapshot'
const PROPERTY_TYPE = 'apartment'
const BATCH_SIZE = 10
const BATCH_DELAY_MS = 100

// Retries pour erreurs transitoires (429, 503, network/timeout).
// 2 tentatives supplémentaires avec backoff 100ms puis 200ms.
const RETRY_DELAYS_MS = [100, 200]
const TRANSIENT_HTTP_STATUSES = new Set([429, 503])

const IRIS_CODES_PATH = resolve(process.cwd(), 'src/data/iris_codes_insee.json')
const OUTPUT_PATH = resolve(process.cwd(), 'src/data/iris_market.json')
const CHECKPOINT_PATH = resolve(process.cwd(), 'tmp/iris_market_progress.json')
const RAW_DUMP_PATH = resolve(process.cwd(), 'tmp/iris_market_raw_response.json')

// ─── Types ──────────────────────────────────────────────────────────────────

interface IrisCodeEntry {
  code_iris: string
  type_iris: string
  low_confidence?: true
  no_market_data?: true
}

type IrisCodeMapping = Record<string, IrisCodeEntry>

interface SnapshotResponse {
  median: number
  p25: number
  p75: number
  volume: number
}

interface MarketEntry {
  code_iris: string
  median: number
  p25: number
  p75: number
  n: number
  low_confidence?: true
  updated: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** YYYY-MM */
function currentMonth(): string {
  const now = new Date()
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms))
}

class FetchError extends Error {
  constructor(message: string, public transient: boolean, public status?: number) {
    super(message)
  }
}

// Dump persistant de la réponse brute du tout premier appel API, pour
// inspection de la forme exacte (Intent Analytics). N'est écrit qu'une seule
// fois — si le fichier existe déjà (run précédent), on n'écrase pas.
let rawDumped = existsSync(RAW_DUMP_PATH)

async function fetchSnapshot(codeIris: string, apiKey: string): Promise<SnapshotResponse> {
  const url = `${API_BASE}?code_iris=${codeIris}&type=${PROPERTY_TYPE}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
        'User-Agent': 'shomee-iris-market/2.0',
      },
      signal: AbortSignal.timeout(30_000),
    })
  } catch (err) {
    // Network ou timeout (AbortSignal.timeout → TimeoutError) → transient
    const msg = err instanceof Error ? err.message : String(err)
    throw new FetchError(`Network/timeout pour code_iris=${codeIris}: ${msg}`, true)
  }
  if (!res.ok) {
    const body = await res.text()
    throw new FetchError(
      `HTTP ${res.status} pour code_iris=${codeIris}: ${body}`,
      TRANSIENT_HTTP_STATUSES.has(res.status),
      res.status,
    )
  }
  const body = await res.json() as unknown
  if (!rawDumped) {
    rawDumped = true
    mkdirSync(dirname(RAW_DUMP_PATH), { recursive: true })
    writeFileSync(
      RAW_DUMP_PATH,
      JSON.stringify({ code_iris: codeIris, fetched_at: new Date().toISOString(), response: body }, null, 2) + '\n',
      'utf-8',
    )
    process.stdout.write(`  [DEBUG] Réponse brute du 1er appel sauvegardée → ${RAW_DUMP_PATH}\n`)
  }
  return body as SnapshotResponse
}

async function fetchSnapshotWithRetry(codeIris: string, apiKey: string): Promise<SnapshotResponse> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0) {
      const delay = RETRY_DELAYS_MS[attempt - 1]
      await sleep(delay)
      process.stdout.write(`  ⟳ retry ${attempt}/${RETRY_DELAYS_MS.length} pour code_iris=${codeIris}\n`)
    }
    try {
      return await fetchSnapshot(codeIris, apiKey)
    } catch (err) {
      lastErr = err
      // Erreurs non-transitoires (4xx hors 429) → bail immédiat
      if (!(err instanceof FetchError) || !err.transient) throw err
    }
  }
  throw lastErr
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.INTENT_ANALYTICS_API_KEY
  if (!apiKey) {
    throw new Error('INTENT_ANALYTICS_API_KEY manquante dans l\'environnement')
  }

  // 1. Lecture du mapping IRIS
  const mapping: IrisCodeMapping = JSON.parse(readFileSync(IRIS_CODES_PATH, 'utf-8'))
  const allEntries = Object.entries(mapping)
  const toFetch = allEntries.filter(([, v]) => !v.no_market_data)
  const skipped = allEntries.length - toFetch.length
  process.stdout.write(`${allEntries.length} entrées dans iris_codes_insee.json\n`)
  process.stdout.write(`  ${skipped} skippées (no_market_data, type D)\n`)
  process.stdout.write(`  ${toFetch.length} à interroger via API Intent Analytics\n`)

  // 2. Reprise depuis checkpoint si présent
  const output: Record<string, MarketEntry> = {}
  if (existsSync(CHECKPOINT_PATH)) {
    const checkpoint = JSON.parse(readFileSync(CHECKPOINT_PATH, 'utf-8')) as Record<string, MarketEntry>
    const validKeys = new Set(toFetch.map(([k]) => k))
    let restored = 0
    let dropped = 0
    for (const [k, v] of Object.entries(checkpoint)) {
      if (validKeys.has(k)) { output[k] = v; restored++ }
      else dropped++
    }
    process.stdout.write(`  Checkpoint trouvé : ${restored} entrées reprises`)
    if (dropped > 0) process.stdout.write(`, ${dropped} entrées obsolètes ignorées`)
    process.stdout.write('\n')
  }

  const remaining = toFetch.filter(([k]) => !(k in output))
  process.stdout.write(`  → ${remaining.length} appels API restants à effectuer\n\n`)

  // 3. Appels batchés (avec retries + checkpoint après chaque batch)
  const updated = currentMonth()
  const totalBatches = Math.ceil(remaining.length / BATCH_SIZE)
  let done = 0
  const startTs = Date.now()
  mkdirSync(dirname(CHECKPOINT_PATH), { recursive: true })

  for (let i = 0; i < remaining.length; i += BATCH_SIZE) {
    const batch = remaining.slice(i, i + BATCH_SIZE)
    const batchNum = Math.floor(i / BATCH_SIZE) + 1

    const results = await Promise.all(
      batch.map(async ([key, mapEntry]) => {
        const snap = await fetchSnapshotWithRetry(mapEntry.code_iris, apiKey)
        return { key, mapEntry, snap }
      }),
    )

    for (const { key, mapEntry, snap } of results) {
      const entry: MarketEntry = {
        code_iris: mapEntry.code_iris,
        median: snap.median,
        p25: snap.p25,
        p75: snap.p75,
        n: snap.volume,
        updated,
      }
      if (mapEntry.low_confidence) entry.low_confidence = true
      output[key] = entry
    }

    // Checkpoint après batch réussi
    writeFileSync(CHECKPOINT_PATH, JSON.stringify(output) + '\n', 'utf-8')

    done += batch.length
    process.stdout.write(
      `  batch ${String(batchNum).padStart(3)}/${totalBatches} → ${done}/${remaining.length} ` +
      `(${Math.round(100 * done / remaining.length)}%)\n`,
    )

    if (i + BATCH_SIZE < remaining.length) {
      await sleep(BATCH_DELAY_MS)
    }
  }

  // 4. Écriture finale + suppression du checkpoint (run complet réussi)
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n', 'utf-8')
  if (existsSync(CHECKPOINT_PATH)) unlinkSync(CHECKPOINT_PATH)

  const elapsed = ((Date.now() - startTs) / 1000).toFixed(1)
  const lowConfCount = Object.values(output).filter(e => e.low_confidence).length
  process.stdout.write(`\nÉcrit : ${OUTPUT_PATH}\n`)
  process.stdout.write(`  ${Object.keys(output).length} IRIS avec prix (${lowConfCount} flaggés low_confidence)\n`)
  process.stdout.write(`  Durée : ${elapsed}s\n`)
}

main().catch(err => {
  console.error('FATAL:', err)
  process.exit(1)
})
