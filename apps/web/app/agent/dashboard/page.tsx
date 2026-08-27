import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

/**
 * L'accueil du back-office a déménagé en /agent/biens — le nom que porte
 * l'onglet. Cette redirection garde valides les anciens liens : raccourci sur
 * l'écran d'accueil, favori du navigateur, e-mails d'activation déjà envoyés.
 */
export default async function AncienneUrlDashboard({
  searchParams,
}: {
  searchParams: Promise<{ filter?: string | string[] }>
}) {
  const { filter } = await searchParams
  const f = Array.isArray(filter) ? filter[0] : filter
  redirect(f ? `/agent/biens?filter=${encodeURIComponent(f)}` : '/agent/biens')
}
