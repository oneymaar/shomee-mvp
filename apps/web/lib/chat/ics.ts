/**
 * Fichier d'agenda .ics — généré à la main (une visite = un VEVENT), aucune
 * dépendance. Compatible Google Agenda, Apple Calendar, Outlook : c'est le
 * format d'échange universel, et il ne demande AUCUNE connexion de compte —
 * décision d'architecture du 24/08 : la vérité du calendrier vit dans SHOMEE,
 * les agendas externes reçoivent un fichier standard.
 *
 * Dates émises en UTC (suffixe Z) : le passage à l'heure d'hiver ne décale
 * rien, chaque app d'agenda convertit vers le fuseau de son utilisateur.
 */

function icsDate(d: Date): string {
  return d
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '')
}

/** Échappement RFC 5545 : virgules, points-virgules, retours à la ligne. */
function esc(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
}

export function buildVisitIcs(v: {
  id: string
  scheduledAt: Date
  durationMin: number
  cancelled: boolean
  propertyTitle: string
  propertyLocation: string
  agencyName: string
  agentName: string
}): string {
  const end = new Date(v.scheduledAt.getTime() + v.durationMin * 60 * 1000)
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//SHOMEE//Visites//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:visite-${v.id}@shomee.app`,
    `DTSTAMP:${icsDate(new Date())}`,
    `DTSTART:${icsDate(v.scheduledAt)}`,
    `DTEND:${icsDate(end)}`,
    `SUMMARY:${esc(`Visite — ${v.propertyTitle}`)}`,
    `LOCATION:${esc(v.propertyLocation)}`,
    `DESCRIPTION:${esc(`Visite organisée via SHOMEE.\n${v.agencyName} · ${v.agentName}`)}`,
    `STATUS:${v.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
  // RFC 5545 : fins de ligne CRLF.
  return lines.join('\r\n') + '\r\n'
}
