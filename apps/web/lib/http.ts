import { NextResponse } from 'next/server'

/** Corps JSON en objet (jamais throw) — {} si absent/illisible. */
export async function readJsonObject(req: Request): Promise<Record<string, unknown>> {
  try {
    const j: unknown = await req.json()
    return j && typeof j === 'object' ? (j as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** String non-vide trimmee, sinon undefined. */
export function getString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key]
  return typeof v === 'string' && v.trim() ? v.trim() : undefined
}

export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}
