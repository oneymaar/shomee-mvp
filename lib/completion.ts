import type { Property } from '@prisma/client'

/**
 * Recomputes `completionRate` from a Property row.
 *
 * Same heuristic as the import-llm endpoint (~15 key fields). Used by the
 * upload/confirm route to keep the dashboard's completion bar in sync each
 * time a media is attached.
 */
export function computeCompletionRate(p: Property): number {
  const composition = p.composition as Array<{ label: string; surface: number }> | null
  const checks: boolean[] = [
    !!p.location?.trim(),
    !!p.title?.trim(),
    p.surface > 0,
    p.rooms > 0,
    p.price > 0,
    !!p.description?.trim(),
    Array.isArray(composition) && composition.length > 0,
    !!p.videoUrl,
    p.gallery.length > 0,
    p.dpe != null,
    p.ges != null,
    p.bedrooms != null,
    p.floor != null,
    !!p.arrondissement?.trim(),
    p.yearBuilt != null,
  ]
  const filled = checks.filter(Boolean).length
  return +(filled / checks.length).toFixed(2)
}
