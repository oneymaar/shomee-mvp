import ZoneMapEmbedClient from './ZoneMapEmbedClient'

/**
 * Route embarquable `/embed/zonemap` — rend la carte de sélection Quartiers
 * (`ZoneMap` web réutilisé) dans une WebView native (funnel manuel S7, sous-écran
 * B). La sélection initiale (déjà résolue côté natif par `resolveGeoFromText`)
 * arrive en query-param `sel` (JSON URL-encodé) ; la sélection finale repart vers
 * le natif via `window.ReactNativeWebView.postMessage`. AUCUN appel à
 * `/api/location/analyze` ici : la page ne fait que rendre + renvoyer la sélection.
 *
 * Testable au navigateur : sans `window.ReactNativeWebView`, « Valider » est un
 * no-op (la page reste affichée).
 */
export const dynamic = 'force-dynamic'

type SearchParams = { [key: string]: string | string[] | undefined }

export default async function ZoneMapEmbedPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const sp = await searchParams
  const selParam = typeof sp.sel === 'string' ? sp.sel : ''
  return <ZoneMapEmbedClient selParam={selParam} />
}
