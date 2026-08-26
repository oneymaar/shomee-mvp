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

/**
 * L'INVERSE, et c'est le point délicat de tout le connecteur agent.
 *
 * Dans le back-office, la conversion heure locale → UTC est faite par le
 * NAVIGATEUR de l'agent (`datetime-local` → `toISOString()`). Un LLM n'a pas de
 * navigateur : si on le laissait fabriquer l'ISO UTC lui-même, il appliquerait
 * un décalage de tête — et se tromperait d'une heure la moitié de l'année, en
 * silence, sur des rendez-vous réels. Les outils MCP n'acceptent donc QUE de
 * l'heure locale parisienne (« 2026-08-28T10:30 ») et la conversion se fait
 * ici, avec les vraies règles de fuseau.
 *
 * Deux passes : le décalage dépend de l'instant, qui dépend du décalage. La
 * première passe donne une approximation, la seconde la corrige — ce qui rend
 * le résultat juste y compris aux week-ends de changement d'heure.
 */
function decalageParisMinutes(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Paris',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant)
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? '0')
  const commeUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'), n('second'))
  return (commeUtc - instant.getTime()) / 60000
}

/** « 2026-08-28T10:30 » (heure de Paris) → Date UTC. null si illisible. */
export function parisLocalToUtc(local: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{1,2}):(\d{2})$/.exec(local.trim())
  if (!m) return null
  const naif = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  if (Number.isNaN(naif)) return null
  const passe1 = new Date(naif - decalageParisMinutes(new Date(naif)) * 60000)
  const passe2 = new Date(naif - decalageParisMinutes(passe1) * 60000)
  return Number.isNaN(passe2.getTime()) ? null : passe2
}

/**
 * Le repère temporel donné au modèle. Sans lui, « jeudi » n'a pas de sens :
 * un LLM ne sait pas quel jour on est et inventerait une date.
 */
export function repereParis(maintenant = new Date()): {
  maintenant_paris: string
  aujourdhui_paris: string
} {
  return {
    maintenant_paris: maintenant.toLocaleString('fr-FR', {
      timeZone: 'Europe/Paris',
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
    aujourdhui_paris: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(maintenant),
  }
}
