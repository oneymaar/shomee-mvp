/**
 * Formatage d'une date de visite CÔTÉ SERVEUR — toujours en Europe/Paris,
 * explicitement. Le serveur (Vercel) vit en UTC : `formatVisitDateFr` de
 * @shomee/core, pensée pour le CLIENT (fuseau de l'appareil), y afficherait
 * l'heure décalée de 1-2 h. Ne sert qu'aux textes écrits en base (aperçus).
 */
export function formatVisitDateParis(d: Date): string {
  const day = d.toLocaleDateString('fr-FR', {
    timeZone: 'Europe/Paris',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  })
  const time = d.toLocaleTimeString('fr-FR', {
    timeZone: 'Europe/Paris',
    hour: 'numeric',
    minute: '2-digit',
  })
  // « 14:30 » → « 14 h 30 », « 14:00 » → « 14 h »
  const [h, min] = time.split(':')
  return `${day} à ${h} h${min && min !== '00' ? ` ${min}` : ''}`
}
