/**
 * Visites — vocabulaire partagé mobile ↔ web (agent).
 *
 * QUATRE tranches horaires, pas trois : « heure du déjeuner » ajoutée à la
 * demande d'Olivier (24/08) — dans le luxe, beaucoup de visites se calent sur
 * la pause déjeuner de l'acquéreur. L'acquéreur coche des tranches GROSSIÈRES
 * (jamais d'heure précise : c'est l'agent qui cale l'heure exacte en
 * répondant — dans ce marché, l'agent se plie au calendrier de l'acquéreur).
 */

export type VisitSlotId = 'morning' | 'lunch' | 'afternoon' | 'evening'

export const VISIT_SLOTS: Array<{ id: VisitSlotId; label: string; hint: string }> = [
  { id: 'morning', label: 'Matinée', hint: 'avant 12 h' },
  { id: 'lunch', label: 'Déjeuner', hint: '12 h – 14 h' },
  { id: 'afternoon', label: 'Après-midi', hint: '14 h – 18 h' },
  { id: 'evening', label: 'Soir', hint: 'après 18 h' },
]

export const VISIT_SLOT_LABEL: Record<VisitSlotId, string> = {
  morning: 'matinée',
  lunch: 'déjeuner',
  afternoon: 'après-midi',
  evening: 'soir',
}

/** Un jour coché par l'acquéreur : date locale (YYYY-MM-DD) + tranches. */
export interface AvailabilityDay {
  date: string
  slots: VisitSlotId[]
}

/** payload du message AVAILABILITIES. */
export interface AvailabilitiesPayload {
  days: AvailabilityDay[]
}

/** payload du message VISIT_REQUEST — le brief qualifié, photographié côté
 *  mobile au moment de la demande (le serveur ne connaît pas le brief local). */
export interface VisitRequestPayload {
  budgetMax?: number | null
  budgetMin?: number | null
  minSurface?: number | null
  minRooms?: number | null
  minBedrooms?: number | null
  locationLabel?: string | null
  /** Critères par exigence — libellés bruts, prêts à afficher. */
  criteria?: { must: string[]; want: string[]; never: string[] }
  /** Score de correspondance de CE bien (0..1) si le moteur l'a fourni. */
  matchScore?: number | null
}

/** payload du message VISIT_CONFIRMED. */
export interface VisitConfirmedPayload {
  visitId: string
  /** ISO UTC. */
  scheduledAt: string
  durationMin: number
  icsToken: string
  status?: 'CONFIRMED' | 'CANCELLED'
}

/** Les 14 prochains jours (aujourd'hui inclus), en dates LOCALES. */
export function nextDays(count = 14, from = new Date()): Array<{ date: string; weekday: string; dayNum: number; month: string }> {
  const out: Array<{ date: string; weekday: string; dayNum: number; month: string }> = []
  const d = new Date(from)
  for (let i = 0; i < count; i++) {
    const yyyy = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    out.push({
      date: `${yyyy}-${mm}-${dd}`,
      weekday: d.toLocaleDateString('fr-FR', { weekday: 'short' }).replace('.', ''),
      dayNum: d.getDate(),
      month: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''),
    })
    d.setDate(d.getDate() + 1)
  }
  return out
}

/** « jeu. 28 août » — pour les récapitulatifs. */
export function formatDayFr(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(y, (m ?? 1) - 1, d ?? 1)
  return dt.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'long' })
}

/** Récapitulatif lisible des disponibilités — même texte des deux côtés. */
export function formatAvailabilities(p: AvailabilitiesPayload): string {
  if (!p.days.length) return 'Aucune disponibilité indiquée.'
  return p.days
    .map((d) => `${formatDayFr(d.date)} — ${d.slots.map((s) => VISIT_SLOT_LABEL[s]).join(', ')}`)
    .join('\n')
}

/** « jeudi 28 août à 12 h 30 » — pour la confirmation de visite. */
export function formatVisitDateFr(iso: string): string {
  const d = new Date(iso)
  const day = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' })
  const h = d.getHours()
  const min = d.getMinutes()
  return `${day} à ${h} h${min > 0 ? ` ${String(min).padStart(2, '0')}` : ''}`
}
