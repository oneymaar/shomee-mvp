/**
 * /api/matching/score
 *
 * Two modes:
 *  - POST: stateless. Caller supplies brief + property profiles; engine
 *    runs over the payload, no DB hit.
 *  - GET ?buyerProfileId=…: convenience. Loads the BuyerProfile and all
 *    PUBLISHED properties from the DB, builds the brief / profiles via
 *    the mappers, runs the engine, returns the same shape as POST.
 *
 * No LLM calls in either mode. No persistence of results.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAppToken } from '@/lib/auth/appToken'
import { z } from 'zod'
import { matchProperty } from '@shomee/core/matching/engine'
import type { MatchResult, PropertyProfile } from '@shomee/core/matching/types'
import type { UserCriteriaBrief, ParsedCriterion } from '@shomee/core/criteria/types'
import { prisma } from '@/lib/prisma'
import { toPropertyProfile } from '@/lib/matching/propertyProfileBuilder'
import { toBuyerBrief } from '@/lib/matching/buyerBriefBuilder'

// ─── Zod schemas ─────────────────────────────────────────────────────────

const ImportanceSchema = z.enum(['desired', 'mandatory', 'dealbreaker'])
const MatchTypeSchema  = z.enum(['structured_rule', 'conditional_rule', 'semantic', 'fuzzy'])
const CategorySchema   = z.enum(['outdoor', 'bedroom', 'living', 'building', 'location', 'ambiance'])
const PolaritySchema   = z.enum(['positive', 'negative'])
const OperatorSchema   = z.enum(['=', '!=', '>', '>=', '<', '<=', 'in', 'not_in'])

const RuleValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number()])),
])

const StructuredRuleSchema = z.object({
  attribute: z.string().min(1),
  operator: OperatorSchema,
  value: RuleValueSchema,
})

const ConditionalRuleSchema = z.object({
  if: StructuredRuleSchema,
  then: StructuredRuleSchema,
})

const ParsedCriterionSchema = z.object({
  id: z.string().min(1),
  display_label: z.string().min(1),
  category: CategorySchema,
  polarity: PolaritySchema,
  importance: ImportanceSchema,
  match_type: MatchTypeSchema,
  rule: z.union([StructuredRuleSchema, ConditionalRuleSchema, z.null()]),
  semantic_hint: z.union([z.string(), z.null()]),
  raw_input: z.string(),
  confidence: z.number().min(0).max(1),
  importance_override: z.boolean(),
})

const UserCriteriaBriefSchema = z.object({
  user_id: z.string().min(1),
  parsed_criteria: z.array(ParsedCriterionSchema),
  raw_tags: z.array(z.string()),
  raw_text_input: z.string(),
  created_at: z.string(),
  updated_at: z.string(),
})

const OrientationSchema = z.enum(['north', 'south', 'east', 'west'])
const DpeSchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G'])

const PropertyTypeSchema = z.enum(['appartement', 'maison', 'loft', 'atelier'])

const StructuredAttributesSchema = z.object({
  price: z.number(),
  property_type: PropertyTypeSchema,
  floor: z.number(),
  total_floors: z.number(),
  has_elevator: z.boolean(),
  has_terrace: z.boolean(),
  terrace_surface_m2: z.number().nullable(),
  has_balcony: z.boolean(),
  balcony_surface_m2: z.number().nullable(),
  has_garden: z.boolean(),
  garden_surface_m2: z.number().nullable(),
  has_cellar: z.boolean(),
  has_parking: z.boolean(),
  has_concierge: z.boolean(),
  is_ground_floor: z.boolean(),
  surface_m2: z.number(),
  room_count: z.number(),
  bedroom_count: z.number(),
  bedroom_street_side: z.boolean().nullable(),
  orientation: z.array(OrientationSchema),
  is_quiet_street: z.boolean().nullable(),
  building_year: z.number().nullable(),
  dpe_rating: DpeSchema.nullable(),
})

const SemanticScoresSchema = z.object({
  luminosity: z.number().nullable(),
  quietness: z.number().nullable(),
  charm: z.number().nullable(),
  spaciousness: z.number().nullable(),
  living_quality: z.number().nullable(),
  outdoor_usability: z.number().nullable(),
})

const PropertyProfileSchema = z.object({
  property_id: z.string().min(1),
  structured: StructuredAttributesSchema,
  semantic: SemanticScoresSchema,
  raw_description: z.string(),
  /** Accept ISO strings or null; the engine itself does not read the
   *  field but the schema enforces type safety. */
  enriched_at: z.union([z.string(), z.null()]),
})

const BodySchema = z.object({
  brief: UserCriteriaBriefSchema,
  properties: z.array(PropertyProfileSchema).max(500),
})

// ─── Route handler ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const guard = requireAppToken(req)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ success: false, error: 'invalid_json' }, { status: 400 })
  }

  const parsed = BodySchema.safeParse(body)
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: 'invalid_body', details: parsed.error.flatten() },
      { status: 400 },
    )
  }

  const { brief, properties } = parsed.data

  // Convert schema-validated payload into the runtime types the engine
  // expects (enriched_at is a Date in the type but arrives as string).
  const profiles: PropertyProfile[] = properties.map((p) => ({
    ...p,
    enriched_at: p.enriched_at ? new Date(p.enriched_at) : null,
  }))

  // Zod's z.union resolves the rule shape to a structural type — re-cast
  // the brief into the criteria module's shape (the engine doesn't
  // mutate it, so this is safe).
  const briefTyped: UserCriteriaBrief = {
    ...brief,
    parsed_criteria: brief.parsed_criteria as unknown as ParsedCriterion[],
  }

  const allResults: MatchResult[] = profiles.map((p) => matchProperty(p, briefTyped))
  const excluded_count = allResults.filter((r) => r.is_excluded).length
  const results = allResults
    .filter((r) => !r.is_excluded)
    .sort((a, b) => b.global_score - a.global_score)

  return NextResponse.json({
    success: true,
    data: {
      results,
      excluded_count,
      total_scored: results.length,
    },
  })
}

/**
 * GET /api/matching/score?buyerProfileId=...
 *
 * DB-backed scoring. Loads the buyer profile, all PUBLISHED properties,
 * runs each through `toPropertyProfile` + the engine. Same response shape
 * as POST so downstream consumers can switch transparently.
 */
export async function GET(req: NextRequest) {
  const guard = requireAppToken(req)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const buyerProfileId = req.nextUrl.searchParams.get('buyerProfileId')
  if (!buyerProfileId) {
    return NextResponse.json(
      { success: false, error: 'buyerProfileId required' },
      { status: 400 },
    )
  }

  const profile = await prisma.buyerProfile.findUnique({
    where: { id: buyerProfileId },
  })
  if (!profile) {
    return NextResponse.json(
      { success: false, error: 'buyer_profile_not_found' },
      { status: 404 },
    )
  }

  const properties = await prisma.property.findMany({
    where: { statut: 'PUBLISHED' },
  })

  const brief = toBuyerBrief(profile)
  const profiles: PropertyProfile[] = properties.map(toPropertyProfile)

  const allResults: MatchResult[] = profiles.map((p) => matchProperty(p, brief))
  const excluded_count = allResults.filter((r) => r.is_excluded).length
  const results = allResults
    .filter((r) => !r.is_excluded)
    .sort((a, b) => b.global_score - a.global_score)

  return NextResponse.json({
    success: true,
    data: {
      results,
      excluded_count,
      total_scored: results.length,
      total_candidates: properties.length,
    },
  })
}
