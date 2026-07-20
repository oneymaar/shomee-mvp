/**
 * Harnais de non-régression — sémantique de la recherche Quartiers.
 *
 * Exécution : `npx tsx scripts/parser-harness.ts` (depuis packages/core)
 * Sort avec le code 1 si un cas échoue — à lancer avant/après toute modification
 * de spatialIntentParser / spatialIntentToGeoConstraints / geoConstraintService.
 *
 * Partie A — parser + converter (déterministe pur, aucune donnée géo requise).
 * Partie B — moteur de résolution sur fixtures synthétiques (aucun réseau).
 */

import { parseSpatialIntent } from '../src/parsing/spatialIntentParser'
import { intentToGeoConstraints } from '../src/parsing/spatialIntentToGeoConstraints'
import { resolveConstraints, type GeoConstraint } from '../src/geo/geoConstraintService'
import type { GeoZone } from '../src/geo/geoDataService'

let failures = 0
let checks = 0

function check(label: string, cond: boolean, detail?: string) {
  checks++
  if (!cond) {
    failures++
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

// ═══════════════════════ Partie A — parser + converter ═══════════════════════

interface Expect {
  /** requiresLLM attendu */
  llm: boolean
  /** resolvedIds attendus parmi les entités primaires (ordre libre) */
  ids?: string[]
  /** nombre minimal d'entités primaires connues */
  minKnown?: number
  /** resolvedIds attendus parmi les exclusions */
  exclIds?: string[]
  /** nombre d'exclusions attendues */
  exclCount?: number
  /** contraintes attendues : "type:operator" (sous-ensemble) */
  constraints?: string[]
  /** ligne attendue sur une contrainte transport_line */
  line?: string
  /** rayon attendu sur la contrainte transport_line */
  lineRadius?: number
}

const CASES: Array<{ q: string; e: Expect }> = [
  // ── Listes & séparateurs (comportements historiques à préserver) ──
  { q: 'Paris 12, Montreuil, Paris 18, Montparnasse',
    e: { llm: false, ids: ['arr-12', 'com-93048', 'arr-18', 'montparnasse'] } },
  { q: 'Aligre / Ledru-Rollin ; Picpus', e: { llm: false, minKnown: 3 } },
  { q: 'Batignolles et Montreuil', e: { llm: false, ids: ['batignolles', 'com-93048'] } },
  { q: 'Neuilly ou Levallois', e: { llm: false, ids: ['com-92051', 'com-92044'] } },
  { q: 'entre Pigalle et Montmartre',
    e: { llm: false, ids: ['pigalle', 'montmartre'], constraints: ['semantic_neighborhood:between'] } },
  { q: 'Paris 16 côté bois', e: { llm: false, ids: ['arr-16'], constraints: ['poi:near'] } },
  { q: 'Paris 15 pas trop excentré', e: { llm: false, ids: ['arr-15'], exclIds: ['zone-periph-elargie'] } },
  { q: 'près de la Sorbonne', e: { llm: false, minKnown: 1 } },
  { q: 'Paris 18 sauf la Goutte d\'Or', e: { llm: false, ids: ['arr-18'], exclIds: ['goutte-d-or'] } },

  // ── Nouveaux : séparateurs & nombres en lettres ──
  { q: 'Paris 12\nMontreuil\nParis 18', e: { llm: false, ids: ['arr-12', 'com-93048', 'arr-18'] } },
  { q: 'Paris douze, Montreuil, Paris dix-huit, Montparnasse',
    e: { llm: false, ids: ['arr-12', 'com-93048', 'arr-18', 'montparnasse'] } },
  { q: 'le quatorzième', e: { llm: false, ids: ['arr-14'] } },
  { q: 'le premier', e: { llm: false, ids: ['arr-1'] } },

  // ── Nouveaux : fillers conversationnels ──
  { q: 'je veux vivre dans le 18ème', e: { llm: false, ids: ['arr-18'] } },
  { q: 'dans le 14e', e: { llm: false, ids: ['arr-14'] } },
  { q: 'j\'aimerais habiter à Montmartre ou dans le Marais',
    e: { llm: false, ids: ['montmartre', 'le-marais'] } },
  { q: 'Autour de Daumesnil et Nation, proche métro Bel-Air', e: { llm: false, minKnown: 3 } },

  // ── Nouveaux : lignes de métro & transport générique ──
  { q: 'proche de la ligne 6', e: { llm: false, line: '6', constraints: ['transport_line:near'] } },
  { q: 'ligne 9', e: { llm: false, line: '9' } },
  { q: 'dans le 14e proche de la ligne 6',
    e: { llm: false, ids: ['arr-14'], line: '6', constraints: ['administrative_area:inside', 'transport_line:near'] } },
  { q: 'Paris 12 proche ligne 1', e: { llm: false, ids: ['arr-12'], line: '1' } },
  { q: 'métro ligne 3', e: { llm: false, line: '3' } },
  { q: 'RER A', e: { llm: false, line: 'A' } },
  { q: 'proche métro', e: { llm: false, line: 'metro' } },
  { q: 'Paris 13 à moins de 5mn du métro',
    e: { llm: false, ids: ['arr-13'], line: 'metro', lineRadius: 200 } },
  { q: 'dans le 6e proche de la Seine', e: { llm: false, ids: ['arr-6'], constraints: ['poi:near'] } },

  // ── Nouveaux : exclusions robustes (fin des échecs silencieux) ──
  { q: 'dans le 18e sauf Clignancourt', e: { llm: false, ids: ['arr-18'], exclIds: ['clignancourt'] } },
  { q: 'Paris 11 sauf Bastille et Oberkampf', e: { llm: false, ids: ['arr-11'], exclCount: 2 } },
  { q: 'dans le 18e mais pas proche du périphérique',
    e: { llm: false, ids: ['arr-18'], exclIds: ['zone-periph'] } },

  // ── Références de proximité élargies ──
  { q: 'Paris 10 proche gare du Nord',
    e: { llm: false, ids: ['arr-10'], constraints: ['transport_station:near'] } },

  // ── Compositions multi-clauses ──
  { q: 'Daumesnil et Nation, proche ligne 6, sauf Bercy',
    e: { llm: false, minKnown: 3, line: '6', exclCount: 1 } },

  // ── Doit TOUJOURS partir en LLM ──
  { q: 'un quartier vivant avec des cafés', e: { llm: true } },
  { q: 'quelque part de calme et familial', e: { llm: true } },
  { q: 'Paris 18 sauf Zorglub-sur-Marne', e: { llm: true, ids: ['arr-18'] } }, // exclusion inconnue → LLM (fini le silencieux)
]

console.log('═══ Partie A — parser + converter ═══')
for (const { q, e } of CASES) {
  const i = parseSpatialIntent(q)
  const gc = intentToGeoConstraints(i)
  const known = i.primaryEntities.filter((x) => x.type !== 'unknown')
  const ids = new Set(i.primaryEntities.map((x) => x.resolvedId).filter(Boolean) as string[])
  const exclIds = new Set(i.exclusions.map((x) => x.resolvedId).filter(Boolean) as string[])
  const pairs = new Set(gc.map((c) => `${c.type}:${c.operator}`))
  const lineC = gc.find((c) => c.type === 'transport_line')

  const before = failures
  check(`llm=${e.llm}`, i.requiresLLM === e.llm, `obtenu ${i.requiresLLM}`)
  for (const id of e.ids ?? []) check(`id ${id}`, ids.has(id), `ids=[${[...ids].join(',')}]`)
  if (e.minKnown !== undefined) check(`≥${e.minKnown} connues`, known.length >= e.minKnown, `obtenu ${known.length}`)
  for (const id of e.exclIds ?? []) check(`excl ${id}`, exclIds.has(id), `excl=[${[...exclIds].join(',')}]`)
  if (e.exclCount !== undefined) check(`${e.exclCount} exclusions`, i.exclusions.length === e.exclCount, `obtenu ${i.exclusions.length}`)
  for (const c of e.constraints ?? []) check(`constraint ${c}`, pairs.has(c), `pairs=[${[...pairs].join(',')}]`)
  if (e.line !== undefined) check(`line=${e.line}`, lineC?.line === e.line, `obtenu ${lineC?.line}`)
  if (e.lineRadius !== undefined) check(`lineRadius=${e.lineRadius}`, lineC?.radiusM === e.lineRadius, `obtenu ${lineC?.radiusM}`)
  console.log(`${failures === before ? '✓' : '✗'} ${JSON.stringify(q)}`)
}

// ═══════════════════════ Partie B — moteur sur fixtures ══════════════════════

function square(lat: number, lng: number, d = 0.0008): GeoJSON.Feature {
  return {
    type: 'Feature', properties: {},
    geometry: {
      type: 'Polygon',
      coordinates: [[[lng - d, lat - d], [lng + d, lat - d], [lng + d, lat + d], [lng - d, lat + d], [lng - d, lat - d]]],
    },
  }
}
function zone(id: string, name: string, type: GeoZone['type'], parentId: string | null, lat: number, lng: number): GeoZone {
  return { id, name, shortName: name, type, parentId, feature: square(lat, lng) }
}

// Monde synthétique : arr-12 (Quinze-vingts = IRIS d'Aligre + Bercy), arr-17
// (Batignolles), arr-14 (Denfert sur ligne 6 + Alésia hors ligne 6), commune
// Montreuil. Coordonnées = vraies stations pour les tests de ligne.
const quartiersFx: GeoZone[] = [
  zone('qu-qv', 'Quinze-Vingts', 'quartier', 'arr-12', 48.849, 2.372),
  zone('qu-bercy', 'Bercy', 'quartier', 'arr-12', 48.834, 2.383),
  zone('qu-batignolles', 'Batignolles', 'quartier', 'arr-17', 48.887, 2.319),
  zone('qu-denfert', 'Petit-Montrouge', 'quartier', 'arr-14', 48.833, 2.332),
]
const irisFx: GeoZone[] = [
  zone('i-qv6', 'Quinze-vingts 6', 'iris', 'qu-qv', 48.8485, 2.3715),
  zone('i-qv7', 'Quinze-vingts 7', 'iris', 'qu-qv', 48.8495, 2.3735),
  zone('i-bercy1', 'Bercy 1', 'iris', 'qu-bercy', 48.834, 2.383),
  zone('i-bat1', 'Batignolles 1', 'iris', 'qu-batignolles', 48.8865, 2.3185),
  zone('i-bat2', 'Batignolles 2', 'iris', 'qu-batignolles', 48.8878, 2.3205),
  zone('i-denfert', 'Petit-Montrouge 1', 'iris', 'qu-denfert', 48.8338, 2.3324),  // Denfert-Rochereau — ligne 6
  zone('i-alesia', 'Petit-Montrouge 2', 'iris', 'qu-denfert', 48.8225, 2.3270),   // Alésia — ligne 4, loin de la 6
  zone('i-mtr1', 'Centre 1', 'iris', 'com-93048', 48.861, 2.442),
  zone('i-mtr2', 'Centre 2', 'iris', 'com-93048', 48.863, 2.446),
]

function resolveQuery(q: string) {
  return resolveConstraints(intentToGeoConstraints(parseSpatialIntent(q)), irisFx, quartiersFx, [])
}

console.log('\n═══ Partie B — moteur (fixtures synthétiques) ═══')

{ // B1 — additif disjoint : quartier vécu + commune disjointe → UNION
  const r = resolveQuery('Batignolles et Montreuil')
  const s = new Set(r.irisIds)
  const before = failures
  check('B1 Batignolles présents', s.has('i-bat1') && s.has('i-bat2'), `iris=[${r.irisIds.join(',')}]`)
  check('B1 Montreuil présent (plus squeezé)', s.has('i-mtr1') && s.has('i-mtr2'), `iris=[${r.irisIds.join(',')}]`)
  console.log(`${failures === before ? '✓' : '✗'} B1 "Batignolles et Montreuil" → union additive`)
}

{ // B2 — narrowing préservé : admin CONTENANT le précis → seulement le précis
  const constraints: GeoConstraint[] = [
    { type: 'administrative_area', label: 'Paris 12', operator: 'inside', confidence: 0.9, zoneId: 'arr-12' },
    { type: 'semantic_neighborhood', label: 'Aligre', operator: 'inside', confidence: 0.9, neighborhoodId: 'aligre' },
  ]
  const r = resolveConstraints(constraints, irisFx, quartiersFx, [])
  const s = new Set(r.irisIds)
  const before = failures
  check('B2 Aligre présent', s.has('i-qv6') && s.has('i-qv7'), `iris=[${r.irisIds.join(',')}]`)
  check('B2 Bercy ABSENT (narrowing intact)', !s.has('i-bercy1'), `iris=[${r.irisIds.join(',')}]`)
  console.log(`${failures === before ? '✓' : '✗'} B2 "Paris 12 + Aligre" → narrowing préservé`)
}

{ // B3 — ligne seule : IRIS proches des stations de la ligne 6, standalone
  const r = resolveQuery('proche de la ligne 6')
  const s = new Set(r.irisIds)
  const before = failures
  check('B3 Denfert (ligne 6) présent', s.has('i-denfert'), `iris=[${r.irisIds.join(',')}]`)
  check('B3 Alésia (ligne 4) absent', !s.has('i-alesia'), `iris=[${r.irisIds.join(',')}]`)
  check('B3 Montreuil absent', !s.has('i-mtr1'), `iris=[${r.irisIds.join(',')}]`)
  console.log(`${failures === before ? '✓' : '✗'} B3 "proche de la ligne 6" → résolution standalone`)
}

{ // B4 — intersection zone + ligne : seulement les IRIS du 14e proches de la 6
  const r = resolveQuery('dans le 14e proche de la ligne 6')
  const s = new Set(r.irisIds)
  const before = failures
  check('B4 Denfert présent', s.has('i-denfert'), `iris=[${r.irisIds.join(',')}]`)
  check('B4 Alésia absent (pas ligne 6)', !s.has('i-alesia'), `iris=[${r.irisIds.join(',')}]`)
  check('B4 hors 14e absent', !s.has('i-qv6') && !s.has('i-bat1'), `iris=[${r.irisIds.join(',')}]`)
  console.log(`${failures === before ? '✓' : '✗'} B4 "dans le 14e proche de la ligne 6" → intersection`)
}

{ // B5 — entityGroups toujours présents pour les pastilles niveau 2
  const r = resolveQuery('Batignolles et Montreuil')
  const labels = (r.entityGroups ?? []).map((g) => g.label)
  const before = failures
  check('B5 groupe Batignolles', labels.some((l) => /batignolles/i.test(l)), `groups=[${labels.join(',')}]`)
  console.log(`${failures === before ? '✓' : '✗'} B5 entityGroups conservés`)
}

console.log(`\n${checks} vérifications, ${failures} échec(s).`)
process.exit(failures > 0 ? 1 : 0)
