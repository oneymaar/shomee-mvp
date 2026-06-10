/**
 * IRIS market data lookup.
 *
 * Source of truth: `src/data/iris_market.json` (sparse, populated by a batch
 * pipeline — TODO once the script lands).
 *
 * As long as the JSON is sparse, we fall back to a hardcoded per-commune
 * median (Paris arrondissements + a curated list of inner-suburb communes),
 * approximated from public 2024-2025 market data. The fallback is signalled
 * by `source: 'fallback'` so the UI can communicate uncertainty if needed.
 * Remove the fallback table once iris_market.json is populated.
 */

import rawIrisMarket from '@/src/data/iris_market.json'

type IrisMarketEntry = { median: number; n: number }
type IrisMarketJson = Record<string, IrisMarketEntry | unknown>

const IRIS_MARKET = rawIrisMarket as IrisMarketJson

export interface MarketLookup {
  median: number          // €/m²
  n: number               // number of observed transactions (0 when fallback)
  source: 'iris' | 'fallback'
}

// Per-commune medians (€/m²) — Paris arrondissements + first-ring suburbs.
// First 5 chars of an IRIS code = INSEE commune code.
const COMMUNE_FALLBACK: Record<string, number> = {
  // Paris
  '75101': 13500, '75102': 12500, '75103': 13800, '75104': 14500,
  '75105': 13500, '75106': 15800, '75107': 15500, '75108': 13800,
  '75109': 11500, '75110': 10000, '75111': 10200, '75112': 10500,
  '75113':  9800, '75114': 10800, '75115': 11200, '75116': 12500,
  '75117': 11000, '75118':  9500, '75119':  9000, '75120':  9200,
  // Hauts-de-Seine (92)
  '92012':  9500, // Boulogne-Billancourt
  '92024':  6000, // Clichy
  '92025':  6200, // Colombes
  '92026':  8500, // Courbevoie
  '92036':  4800, // Gennevilliers
  '92040':  8500, // Issy-les-Moulineaux
  '92044':  9800, // Levallois-Perret
  '92046':  8000, // Malakoff
  '92048':  8200, // Meudon
  '92049':  8500, // Montrouge
  '92050':  6500, // Nanterre
  '92051': 12000, // Neuilly-sur-Seine
  '92062':  9500, // Puteaux
  '92063':  7000, // Rueil-Malmaison
  '92064':  9500, // Saint-Cloud
  '92072':  8500, // Sèvres
  '92073':  8000, // Suresnes
  '92075':  8000, // Vanves
  '92004':  5800, // Asnières-sur-Seine
  // Seine-Saint-Denis (93)
  '93001':  4500, // Aubervilliers
  '93005':  4000, // Aulnay-sous-Bois
  '93006':  6200, // Bagnolet
  '93008':  4500, // Bobigny
  '93029':  4200, // Drancy
  '93045':  6500, // Les Lilas
  '93048':  6800, // Montreuil
  '93055':  6000, // Pantin
  '93066':  5500, // Saint-Denis
  '93070':  7800, // Saint-Ouen
  // Val-de-Marne (94)
  '94002':  5200, // Alfortville
  '94018':  7500, // Charenton-le-Pont
  '94028':  5000, // Créteil
  '94033':  6500, // Fontenay-sous-Bois
  '94037':  7200, // Gentilly
  '94041':  6200, // Ivry-sur-Seine
  '94042':  6800, // Joinville-le-Pont
  '94043':  6800, // Le Kremlin-Bicêtre
  '94046':  6000, // Maisons-Alfort
  '94052':  7800, // Nogent-sur-Marne
  '94058':  7500, // Le Perreux-sur-Marne
  '94067':  9500, // Saint-Mandé
  '94078':  4500, // Villeneuve-Saint-Georges
  '94080':  9800, // Vincennes
  '94081':  5000, // Vitry-sur-Seine
}

/** Strip the `iris-` prefix used in our store IDs and return the bare 9-digit code. */
function stripIrisPrefix(id: string): string {
  return id.startsWith('iris-') ? id.slice(5) : id
}

/**
 * Look up market median for an IRIS code. Returns null when no data is
 * available — caller should treat as "grey / unknown".
 */
export function irisMedian(idOrCode: string): MarketLookup | null {
  const code = stripIrisPrefix(idOrCode)
  const entry = IRIS_MARKET[code]
  if (entry && typeof entry === 'object' && 'median' in entry) {
    const e = entry as IrisMarketEntry
    if (typeof e.median === 'number' && e.median > 0) {
      return { median: e.median, n: e.n ?? 0, source: 'iris' }
    }
  }
  const communeKey = code.slice(0, 5)
  const fallback = COMMUNE_FALLBACK[communeKey]
  if (typeof fallback === 'number') {
    return { median: fallback, n: 0, source: 'fallback' }
  }
  return null
}
