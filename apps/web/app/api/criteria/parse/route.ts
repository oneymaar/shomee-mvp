/**
 * POST /api/criteria/parse
 *
 * Turns the user's onboarding selection (raw free-text + the tags they
 * clicked) into a complete {@link UserCriteriaBrief}. The text goes through
 * the LLM parser; the tags are mapped deterministically; the two lists are
 * concatenated. No persistence — the caller owns storage.
 */

import { NextRequest, NextResponse } from 'next/server'
import { requireAppToken } from '@/lib/auth/appToken'
import { checkRateLimit } from '@/lib/rateLimit'
import { z } from 'zod'
import { CriteriaParseError, parseUserCriteria } from '@/lib/criteria/parser'
import { tagsToCriteria } from '@/lib/criteria/tags'
import type { UserCriteriaBrief } from '@shomee/core/criteria/types'

const BodySchema = z.object({
  raw_text: z.string().max(2000).optional().default(''),
  user_tags: z.array(z.string().max(120)).max(60).optional().default([]),
  /** Optional — when absent the route generates an anonymous brief id. */
  user_id: z.string().min(1).max(120).optional(),
})

export async function POST(req: NextRequest) {
  const guard = requireAppToken(req)
  if (!guard.ok) return NextResponse.json(guard.body, { status: guard.status })
  const rl = checkRateLimit(req)
  if (!rl.ok) return NextResponse.json(rl.body, { status: rl.status, headers: rl.headers })
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
  const { raw_text, user_tags, user_id } = parsed.data

  try {
    const [fromText, fromTags] = await Promise.all([
      parseUserCriteria(raw_text),
      Promise.resolve(tagsToCriteria(user_tags, 'tag')),
    ])

    const now = new Date().toISOString()
    const brief: UserCriteriaBrief = {
      user_id: user_id ?? `anon-${cryptoRandomId()}`,
      parsed_criteria: [...fromTags, ...fromText],
      raw_tags: user_tags,
      raw_text_input: raw_text,
      created_at: now,
      updated_at: now,
    }

    return NextResponse.json({ success: true, data: brief })
  } catch (err) {
    if (err instanceof CriteriaParseError) {
      const status = err.kind === 'missing_api_key' ? 500 : err.kind === 'upstream' ? 502 : 422
      console.error('[criteria/parse]', err.kind, err.message)
      return NextResponse.json(
        { success: false, error: err.kind, message: err.message },
        { status },
      )
    }
    console.error('[criteria/parse] unexpected:', err)
    return NextResponse.json({ success: false, error: 'internal' }, { status: 500 })
  }
}

/** Short random id for anonymous briefs — not cryptographically meaningful. */
function cryptoRandomId(): string {
  return Math.random().toString(36).slice(2, 10)
}
