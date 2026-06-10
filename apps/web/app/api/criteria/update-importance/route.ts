/**
 * PATCH /api/criteria/update-importance
 *
 * Records a manual importance change for a single criterion.
 *
 * No database yet — the route holds an in-memory map keyed by criterion
 * id. Treat this as a stub: the value lives in the server process and
 * is lost on cold start. The next session will replace this with the
 * real persistence layer (Supabase / Drizzle / whatever lands).
 *
 * The in-memory map IS the authoritative source for `importance_override`
 * between calls, so the matcher can read back overrides set earlier in
 * the same process.
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { CriterionImportance } from '@/lib/criteria/types'

const IMPORTANCE_VALUES: ReadonlyArray<CriterionImportance> = [
  'desired',
  'mandatory',
  'dealbreaker',
]

const BodySchema = z.object({
  criterion_id: z.string().uuid({ message: 'criterion_id must be a UUID' }),
  importance: z.enum(['desired', 'mandatory', 'dealbreaker']),
})

interface ImportanceOverride {
  importance: CriterionImportance
  importance_override: true
  updated_at: string
}

// Process-local store. Module-level Map → shared across requests within
// the same Node.js process; reset on cold start.
const STORE: Map<string, ImportanceOverride> = (globalThis as unknown as {
  __shomeeCriteriaOverrides?: Map<string, ImportanceOverride>
}).__shomeeCriteriaOverrides ??= new Map()

export async function PATCH(req: NextRequest) {
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
  const { criterion_id, importance } = parsed.data

  if (!IMPORTANCE_VALUES.includes(importance)) {
    return NextResponse.json({ success: false, error: 'invalid_importance' }, { status: 400 })
  }

  const entry: ImportanceOverride = {
    importance,
    importance_override: true,
    updated_at: new Date().toISOString(),
  }
  STORE.set(criterion_id, entry)

  return NextResponse.json({
    success: true,
    data: {
      criterion_id,
      ...entry,
    },
  })
}
