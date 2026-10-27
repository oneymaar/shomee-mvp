/**
 * Fond de carte unique pour toutes les cartes Leaflet du web.
 *
 * Contexte (27/10/2026) : CARTO exige désormais une clé API — sans elle, chaque
 * tuile affiche « API KEY REQUIRED ». Clé gratuite (usage commercial jusqu'à
 * 1 M de tuiles/mois) à demander sur carto.com/basemaps/apikey.
 *
 * - `NEXT_PUBLIC_CARTO_KEY` défini → CARTO Voyager (le rendu d'origine, avec la
 *   version SANS libellés + libellés séparés au zoom fort).
 * - sinon → Plan IGN (Géoplateforme, gratuit, sans clé, Licence Ouverte),
 *   adouci par un filtre CSS (`.shomee-basemap-ign`, globals.css) pour rester
 *   dans la charte crème/terracotta. Le Plan IGN porte ses propres libellés :
 *   pas de variante « sans libellés ».
 */
const CARTO_KEY = (process.env.NEXT_PUBLIC_CARTO_KEY ?? '').trim()
export const HAS_CARTO_KEY = CARTO_KEY.length > 0

const keyQs = HAS_CARTO_KEY ? `?key=${encodeURIComponent(CARTO_KEY)}` : ''
const carto = (style: string) =>
  `https://{s}.basemaps.cartocdn.com/rastertiles/${style}/{z}/{x}/{y}{r}.png${keyQs}`

export const IGN_PLAN_URL =
  'https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0' +
  '&LAYER=GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2&STYLE=normal&TILEMATRIXSET=PM' +
  '&FORMAT=image/png&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}'

export interface BasemapLayer {
  url: string
  subdomains?: string
  maxNativeZoom: number
  className?: string
  attribution: string
}

const ATTR_CARTO = '© OpenStreetMap · © CARTO'
const ATTR_IGN = '© IGN'

const IGN: BasemapLayer = {
  url: IGN_PLAN_URL,
  maxNativeZoom: 19,
  className: 'shomee-basemap-ign',
  attribution: ATTR_IGN,
}

/** Fond complet (avec libellés). */
export const BASEMAP_FULL: BasemapLayer = HAS_CARTO_KEY
  ? { url: carto('voyager'), subdomains: 'abcd', maxNativeZoom: 20, attribution: ATTR_CARTO }
  : IGN

/** Fond sans libellés (repli IGN : avec libellés, il n'existe pas de variante). */
export const BASEMAP_NO_LABELS: BasemapLayer = HAS_CARTO_KEY
  ? { url: carto('voyager_nolabels'), subdomains: 'abcd', maxNativeZoom: 20, attribution: ATTR_CARTO }
  : IGN

/** Libellés seuls, à superposer au zoom fort — null quand le fond les porte déjà. */
export const BASEMAP_LABELS_ONLY: BasemapLayer | null = HAS_CARTO_KEY
  ? { url: carto('voyager_only_labels'), subdomains: 'abcd', maxNativeZoom: 20, attribution: ATTR_CARTO }
  : null
