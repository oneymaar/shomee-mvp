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
  UserCriteriaBrief,
} from '../criteria/types'
import { tagsToCriteria } from '../criteria/tags'

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

  // 3. Raw onboarding tag list → deterministic structured rules.
  const fromTags: ParsedCriterion[] = tagsToCriteria(profile.rawTags ?? [])

  // Merge with dedup on lowercased display_label.
  const seen = new Set<string>()
  const merged: ParsedCriterion[] = []
  for (const c of [...persisted, ...fromPrefs, ...fromTags]) {
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
