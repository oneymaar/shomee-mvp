/**
 * Shomee — Prisma BuyerProfile → matching engine UserCriteriaBrief bridge.
 *
 * Pure mapping; no I/O. Builds a single `UserCriteriaBrief` from three
 * sources, in priority order:
 *
 *   1. `parsedCriteria` (LLM-parsed, with full structured rules).
 *   2. `searchPreferences.criteria` (3-state chips → desired | mandatory),
 *      lifted to semantic `ParsedCriterion`s carrying the label as the
 *      semantic hint.
 *   3. `rawTags` (canonical onboarding chips), via `tagsToCriteria` which
 *      maps known labels to structured boolean rules.
 *
 * Dedup is case-insensitive on `display_label` — when the same notion
 * appears twice, the highest-priority source wins (parsed > prefs > tags).
 *
 * Note: source field is `Json` in Prisma; we narrow with `Array.isArray`
 * before reading. Anything that does not parse as the expected shape is
 * dropped silently — the caller does not need to differentiate "absent"
 * from "malformed".
 */

import { randomUUID } from 'crypto'
import type { BuyerProfile as PrismaBuyerProfile } from '@prisma/client'
import type {
  CriterionImportance,
  ParsedCriterion,
  StructuredRule,
  UserCriteriaBrief,
} from '../criteria/types'
import { tagsToCriteria } from '../criteria/tags'

/**
 * Shape of the buyer-side snapshot accepted by {@link buildBriefFromSnapshot}.
 * Mirrors the relevant subset of the Zustand `SearchPreferences` so the API
 * can compose a brief on-the-fly without any persistence layer.
 * Everything is optional / nullable: an empty snapshot returns an empty
 * brief and the caller falls back to the chronological feed.
 */
export interface BriefSnapshot {
  minSurface?: number | null
  maxSurface?: number | null
  budgetMin?: number | null
  budgetMax?: number | null
  minRooms?: number | null
  maxRooms?: number | null
  minBedrooms?: number | null
  maxBedrooms?: number | null
  propertyTypes?: string[] | null
  chipStates?: Record<string, 0 | 1 | 2 | 3> | null
  customCriteria?: Array<{
    id?: string
    label: string
    state: 0 | 1 | 2 | 3
    polarity?: 'positive' | 'negative'
  }> | null
}

interface PrefsCriterion {
  label: string
  importance: CriterionImportance
  polarity: 'positive' | 'negative'
}

const ALLOWED_IMPORTANCES: ReadonlySet<CriterionImportance> = new Set([
  'desired',
  'mandatory',
  'dealbreaker',
])

export function toBuyerBrief(profile: PrismaBuyerProfile): UserCriteriaBrief {
  // 1. Pre-parsed criteria already in the buyer profile.
  const persisted: ParsedCriterion[] = Array.isArray(profile.parsedCriteria)
    ? (profile.parsedCriteria as unknown as ParsedCriterion[]).filter(isParsedCriterion)
    : []

  // 2. 3-state chip selection, persisted under searchPreferences.criteria.
  const fromPrefs: ParsedCriterion[] = extractPrefsCriteria(profile.searchPreferences).map(
    prefsCriterionToParsed,
  )

  // 3. Hard filters from searchPreferences (min/max surface, budget, rooms,
  //    bedrooms, property type) → mandatory structured rules. These were
  //    previously dropped, so a buyer asking for 130m²+ at 3-7M€ was
  //    shown studios at 280k€.
  const fromHardFilters: ParsedCriterion[] = buildHardFilters(profile.searchPreferences)

  // 4. Raw onboarding tag list → deterministic structured rules.
  const fromTags: ParsedCriterion[] = tagsToCriteria(profile.rawTags ?? [])

  // Merge with dedup on lowercased display_label.
  const seen = new Set<string>()
  const merged: ParsedCriterion[] = []
  for (const c of [...persisted, ...fromPrefs, ...fromHardFilters, ...fromTags]) {
    const key = c.display_label.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(c)
  }

  const nowIso = new Date().toISOString()
  return {
    user_id: profile.userId,
    parsed_criteria: merged,
    raw_tags: profile.rawTags ?? [],
    raw_text_input: '',
    created_at: profile.createdAt.toISOString(),
    updated_at: nowIso,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Internals
// ─────────────────────────────────────────────────────────────────────────────

function extractPrefsCriteria(prefs: PrismaBuyerProfile['searchPreferences']): PrefsCriterion[] {
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return []
  const maybeCriteria = (prefs as { criteria?: unknown }).criteria
  if (!Array.isArray(maybeCriteria)) return []
  const out: PrefsCriterion[] = []
  for (const item of maybeCriteria) {
    if (!item || typeof item !== 'object') continue
    const label = (item as { label?: unknown }).label
    const importance = (item as { importance?: unknown }).importance
    const polarity = (item as { polarity?: unknown }).polarity
    if (typeof label !== 'string' || label.trim().length === 0) continue
    if (importance !== 'desired' && importance !== 'mandatory' && importance !== 'dealbreaker') continue
    const pol: 'positive' | 'negative' = polarity === 'negative' ? 'negative' : 'positive'
    out.push({ label: label.trim(), importance, polarity: pol })
  }
  return out
}

/**
 * Compile the buyer's hard filters (surface, budget, rooms, bedrooms,
 * property types) into mandatory structured criteria. `mandatory` means
 * the score is heavily penalised when violated, but the property is not
 * excluded from the feed (use `dealbreaker` for outright exclusion).
 *
 * `budgetMax` is interpreted as "no maximum" past 5_000_000 — the
 * onboarding slider tops out there and represents the "no cap" state.
 */
function buildHardFilters(prefs: PrismaBuyerProfile['searchPreferences']): ParsedCriterion[] {
  if (!prefs || typeof prefs !== 'object' || Array.isArray(prefs)) return []
  const p = prefs as {
    minSurface?: unknown
    maxSurface?: unknown
    budgetMin?: unknown
    budgetMax?: unknown
    minRooms?: unknown
    maxRooms?: unknown
    minBedrooms?: unknown
    maxBedrooms?: unknown
    propertyTypes?: unknown
  }

  const out: ParsedCriterion[] = []
  const make = (label: string, category: ParsedCriterion['category'], attribute: string,
    operator: '>=' | '<=' | 'in', value: number | string[]): ParsedCriterion => ({
    id: randomUUID(),
    display_label: label,
    category,
    polarity: 'positive',
    importance: 'mandatory',
    match_type: 'structured_rule',
    rule: { attribute, operator, value },
    semantic_hint: null,
    raw_input: '',
    confidence: 1,
    importance_override: false,
  })

  if (typeof p.minSurface === 'number' && p.minSurface > 0) {
    out.push(make(`Surface ≥ ${p.minSurface} m²`, 'living', 'surface_m2', '>=', p.minSurface))
  }
  if (typeof p.maxSurface === 'number' && p.maxSurface > 0) {
    out.push(make(`Surface ≤ ${p.maxSurface} m²`, 'living', 'surface_m2', '<=', p.maxSurface))
  }
  if (typeof p.budgetMin === 'number' && p.budgetMin > 0) {
    out.push(make(`Prix ≥ ${p.budgetMin} €`, 'location', 'price', '>=', p.budgetMin))
  }
  // budget slider tops out at 5M — past that the user means "no cap"
  if (typeof p.budgetMax === 'number' && p.budgetMax > 0 && p.budgetMax < 5_000_001) {
    out.push(make(`Prix ≤ ${p.budgetMax} €`, 'location', 'price', '<=', p.budgetMax))
  }
  if (typeof p.minRooms === 'number' && p.minRooms > 0) {
    out.push(make(`${p.minRooms} pièces minimum`, 'living', 'room_count', '>=', p.minRooms))
  }
  if (typeof p.maxRooms === 'number' && p.maxRooms > 0) {
    out.push(make(`${p.maxRooms} pièces maximum`, 'living', 'room_count', '<=', p.maxRooms))
  }
  if (typeof p.minBedrooms === 'number' && p.minBedrooms > 0) {
    out.push(make(`${p.minBedrooms} chambres minimum`, 'bedroom', 'bedroom_count', '>=', p.minBedrooms))
  }
  if (typeof p.maxBedrooms === 'number' && p.maxBedrooms > 0) {
    out.push(make(`${p.maxBedrooms} chambres maximum`, 'bedroom', 'bedroom_count', '<=', p.maxBedrooms))
  }
  if (Array.isArray(p.propertyTypes) && p.propertyTypes.length > 0) {
    const types = p.propertyTypes.filter((t): t is string => typeof t === 'string')
    if (types.length > 0) {
      out.push(make(`Type : ${types.join(', ')}`, 'living', 'property_type', 'in', types))
    }
  }
  return out
}

function prefsCriterionToParsed(c: PrefsCriterion): ParsedCriterion {
  return {
    id: randomUUID(),
    display_label: c.label,
    category: 'ambiance',
    polarity: c.polarity,
    importance: c.importance,
    match_type: 'semantic',
    rule: null,
    semantic_hint: c.label,
    raw_input: c.label,
    confidence: 1,
    importance_override: false,
  }
}

/**
 * Build a brief directly from a client-side snapshot of the Zustand store
 * — no DB hit, no auth. Mirrors {@link toBuyerBrief} but skips the
 * `parsedCriteria` (LLM) layer (the snapshot has nothing equivalent).
 *
 * Three contribution buckets:
 *   1. Hard scalar filters (surface, budget, rooms, bedrooms, types) →
 *      mandatory structured rules. Reuses {@link buildHardFilters}.
 *   2. `chipStates` (catalogue chips with their 1/2/3 state) → reuses the
 *      `tagsToCriteria` mapping and then overrides importance per state.
 *      State 3 (dealbreaker) flips boolean structured rules so e.g. the
 *      `Terrasse` chip in state 3 reads as `terrace.exists = false`.
 *   3. `customCriteria` (free-text + polarity) → semantic ParsedCriterion.
 *
 * Dedup is case-insensitive on `display_label` (same convention as
 * {@link toBuyerBrief}).
 */
export function buildBriefFromSnapshot(snapshot: BriefSnapshot | null | undefined): UserCriteriaBrief {
  const safe = snapshot ?? {}

  // 1. Hard filters — reuse the existing builder (it tolerates any
  // object-shaped input thanks to typeof guards).
  const fromHardFilters = buildHardFilters(safe as unknown as PrismaBuyerProfile['searchPreferences'])

  // 2. Catalogue chips → criteria with per-state importance.
  const fromChips: ParsedCriterion[] = chipStatesToCriteria(safe.chipStates ?? {})

  // 3. Custom user-added criteria.
  const fromCustom: ParsedCriterion[] = (safe.customCriteria ?? [])
    .filter((c) => c && typeof c.label === 'string' && c.state > 0)
    .map((c) => ({
      id: randomUUID(),
      display_label: c.label,
      category: 'ambiance' as const,
      polarity: (c.polarity === 'negative' ? 'negative' : 'positive') as 'positive' | 'negative',
      importance: stateToImportance(c.state),
      match_type: 'semantic' as const,
      rule: null,
      semantic_hint: c.label,
      raw_input: c.label,
      confidence: 1,
      importance_override: false,
    }))

  // Merge with dedup on lowercased display_label.
  const seen = new Set<string>()
  const merged: ParsedCriterion[] = []
  for (const c of [...fromHardFilters, ...fromChips, ...fromCustom]) {
    const key = c.display_label.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    merged.push(c)
  }

  const nowIso = new Date().toISOString()
  return {
    user_id: 'anonymous',
    parsed_criteria: merged,
    raw_tags: Object.keys(safe.chipStates ?? {}).filter((k) => (safe.chipStates?.[k] ?? 0) > 0),
    raw_text_input: '',
    created_at: nowIso,
    updated_at: nowIso,
  }
}

function stateToImportance(state: 0 | 1 | 2 | 3): CriterionImportance {
  if (state === 3) return 'dealbreaker'
  if (state === 2) return 'mandatory'
  return 'desired'
}

/**
 * Lift catalogue chip labels (Extérieur, Terrasse, Ascenseur, …) into
 * `ParsedCriterion` carrying the user's per-chip state. Unknown labels
 * fall through `tagsToCriteria`'s own semantic fallback. State 3 inverts
 * boolean structured rules so the chip reads as "I don't want this".
 */
function chipStatesToCriteria(chipStates: Record<string, 0 | 1 | 2 | 3>): ParsedCriterion[] {
  const active = Object.entries(chipStates).filter(([, s]) => s > 0)
  if (active.length === 0) return []

  const labelToState = new Map<string, 0 | 1 | 2 | 3>(active)
  const base = tagsToCriteria(active.map(([label]) => label))

  return base.map((c) => {
    const state = labelToState.get(c.display_label) ?? 1
    const importance = stateToImportance(state)
    const polarity: 'positive' | 'negative' = state === 3 ? 'negative' : 'positive'

    let rule = c.rule
    // Dealbreaker on a boolean structured chip → invert the expected value.
    // "Terrasse" desired = "I want a terrace" (terrace.exists = true).
    // "Terrasse" dealbreaker = "I don't want a terrace" (terrace.exists = false).
    if (state === 3 && rule && isFlippableBooleanRule(rule)) {
      rule = { ...rule, value: !rule.value }
    }
    return { ...c, importance, polarity, rule }
  })
}

function isFlippableBooleanRule(rule: ParsedCriterion['rule']): rule is StructuredRule & { value: boolean } {
  if (!rule || !('attribute' in rule)) return false
  return rule.operator === '=' && typeof rule.value === 'boolean'
}

/**
 * Light shape check on a JSON-decoded `parsedCriteria` entry — enough to
 * keep malformed entries out of the engine, not a full validation.
 */
function isParsedCriterion(value: unknown): value is ParsedCriterion {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    typeof v.id === 'string' &&
    typeof v.display_label === 'string' &&
    typeof v.match_type === 'string' &&
    typeof v.importance === 'string' &&
    ALLOWED_IMPORTANCES.has(v.importance as CriterionImportance)
  )
}
