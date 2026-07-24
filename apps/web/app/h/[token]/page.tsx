/**
 * /h/<token> — porte d'entrée du handoff (S9).
 *
 * H2 : l'expérience vit dans /onboarding?h=<token> (réplique exacte du récap
 * natif + édition par les étapes du funnel + panneau d'installation). Cette
 * route ne fait que rediriger — mais elle RESTE le contrat public :
 *   - c'est l'URL que les LLM émettent (lien court, stable) ;
 *   - c'est le chemin que couvrira l'apple-app-site-association (H0) pour que
 *     l'app installée intercepte /h/* en Universal Link ;
 *   - le scheme natif shomee://h/<token> lui fait écho côté app.
 *
 * Le paramètre de bypass Vercel (preview beta) survit à la redirection via le
 * cookie que Vercel pose AVANT d'atteindre cette route (x-vercel-set-bypass-
 * cookie=true dans les liens émis par le MCP).
 */

import { redirect } from 'next/navigation'

export const dynamic = 'force-dynamic'

export default async function HandoffEntryPage({
  params,
}: {
  params: Promise<{ token: string }>
}) {
  const { token } = await params
  redirect(`/onboarding?h=${encodeURIComponent(token)}`)
}
