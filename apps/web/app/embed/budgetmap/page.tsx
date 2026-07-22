import BudgetMapEmbedClient from './BudgetMapEmbedClient'

/**
 * Route embarquable `/embed/budgetmap` — jumelle de `/embed/zonemap`, dédiée à
 * l'étape Budget native. Rend la carte de faisabilité budgétaire (choroplèthe
 * IRIS coloré par ratio budget/prix, `BudgetFeasibilityMapShell` web réutilisé)
 * dans une WebView native CARRÉE, en lecture seule.
 *
 * La sélection Quartiers + budget + surface initiaux arrivent en query-param
 * `sel` (JSON URL-encodé). Ensuite, budget/surface se mettent à jour EN LIVE via
 * `window.__shomeeSetBudget(budgetMax, surface)`, appelé par le natif quand
 * l'utilisateur glisse le curseur — les IRIS se recolorent sans recharger.
 */
export const dynamic = 'force-dynamic'

type SearchParams = { [key: string]: string | string[] | undefined }

export default async function BudgetMapEmbedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const selParam = typeof sp.sel === 'string' ? sp.sel : ''
  return <BudgetMapEmbedClient selParam={selParam} />
}
