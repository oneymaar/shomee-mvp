/**
 * Chapitres vidéo — normalisation partagée (feed).
 *
 * La base transporte DEUX formes selon l'âge de la donnée :
 *   - `startSec` : sortie de l'analyse vidéo (videoAnalysisService) ;
 *   - `fraction` : forme historique 0..1, qui exige la durée pour être placée.
 * Les deux consommateurs (navigation au tap dans `VideoCard`, barre de
 * progression) doivent lire exactement la même liste — d'où ce module unique.
 */

export interface RawChapter {
  label: string
  startSec?: number
  fraction?: number
}

export interface Chapter {
  label: string
  startSec: number
}

/** Chapitres triés en secondes. `duration` n'est utile qu'aux `fraction`. */
export function normalizeChapters(raw: unknown, duration: number): Chapter[] {
  if (!Array.isArray(raw) || raw.length === 0) return []
  const dur = duration > 0 ? duration : 0
  const out: Chapter[] = []
  for (const c of raw as RawChapter[]) {
    if (!c || typeof c.label !== 'string') continue
    let startSec: number | null = null
    if (typeof c.startSec === 'number' && Number.isFinite(c.startSec)) {
      startSec = c.startSec
    } else if (typeof c.fraction === 'number' && Number.isFinite(c.fraction)) {
      startSec = c.fraction * (dur || 1)
    }
    if (startSec == null) continue
    out.push({ label: c.label, startSec: Math.max(0, startSec) })
  }
  out.sort((a, b) => a.startSec - b.startSec)
  return out
}

/**
 * Segments 0..1 pour la barre de progression. Le PREMIER segment part toujours
 * de 0 : si le 1er chapitre commence à 3 s, l'amorce lui appartient — sinon la
 * barre resterait vide pendant les trois premières secondes de lecture.
 * Retourne [] tant que la durée est inconnue (rien à segmenter).
 */
export function chapterSegments(
  chapters: Chapter[],
  duration: number,
): Array<{ label: string; start: number; end: number }> {
  if (duration <= 0 || chapters.length === 0) return []
  const inside = chapters.filter((c) => c.startSec < duration)
  if (inside.length === 0) return []
  return inside
    .map((c, i) => ({
      label: c.label,
      start: i === 0 ? 0 : Math.min(1, c.startSec / duration),
      end: i + 1 < inside.length ? Math.min(1, inside[i + 1].startSec / duration) : 1,
    }))
    .filter((s) => s.end > s.start + 0.0005)
}

/** Libellé du chapitre en cours à `t` secondes (null si aucun chapitre). */
export function chapterAt(chapters: Chapter[], t: number): string | null {
  if (chapters.length === 0) return null
  let cur = chapters[0].label
  for (const c of chapters) {
    if (c.startSec <= t + 0.001) cur = c.label
    else break
  }
  return cur
}

/** m:ss — sans Intl (support Hermes inégal), comme les prix du feed. */
export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}
