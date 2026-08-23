import React, { useEffect, useMemo, useRef, useState } from 'react'
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'
import type { Poi, PoiCat } from '@/lib/useNearbyPois'

/**
 * Carte quartier mobile — Leaflet dans une WebView (react-native-webview).
 *
 * Ce que la carte porte :
 *  - la **zone IRIS** du bien, dessinée en terracotta (jamais nommée sur la
 *    carte : le libellé vit au-dessus, dans la fiche) ;
 *  - les **stations métro / RER** en pastille de ligne + nom + temps à pied,
 *    étiquetées en permanence — pas de point muet à taper pour savoir ;
 *  - les **repères de quartier** OpenStreetMap (commerces, écoles, parcs,
 *    santé, monuments), injectés APRÈS le premier rendu pour ne pas retarder
 *    la carte ni la recharger (`window.__setPois`) ;
 *  - **aucun repère de l'adresse** : la promesse produit est le micro-quartier,
 *    et un point central se lirait comme une adresse exacte.
 *
 * `interactive={false}` (carte de la fiche) coupe TOUTES les interactions
 * Leaflet : la carte ne dispute plus le geste vertical au défilement de la
 * feuille, et un `Pressable` parent l'ouvre en plein écran. C'est la même
 * précaution que pour l'intercalaire (cf. CARTE_DANS_INTERCALAIRE.md §3.2).
 *
 * react-native-webview est un module NATIF : chargé via un require gardé (comme
 * la visite virtuelle) ; si indispo (Expo Go, avant dev build),
 * MOBILE_MAP_AVAILABLE = false et l'appelant retombe sur le placeholder.
 */

interface WebViewHandle {
  injectJavaScript: (script: string) => void
}

type WebViewProps = {
  source: { html: string }
  originWhitelist?: string[]
  style?: StyleProp<ViewStyle>
  scrollEnabled?: boolean
  setSupportMultipleWindows?: boolean
  androidLayerType?: 'none' | 'software' | 'hardware'
  onLoadEnd?: () => void
}

type WebViewComponent = React.ComponentType<WebViewProps & React.RefAttributes<WebViewHandle>>

let RNWebView: WebViewComponent | null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  RNWebView = require('react-native-webview').WebView as WebViewComponent
} catch {
  RNWebView = null
}

export const MOBILE_MAP_AVAILABLE = RNWebView != null

type LatLng = [number, number]

export interface MapTransport {
  name: string
  line: string
  lat: number
  lng: number
  walkMin?: number
}

interface Props {
  lat: number
  lng: number
  polygon?: LatLng[]
  transports?: MapTransport[]
  /** Repères OpenStreetMap (useNearbyPois) — arrivent après le premier rendu. */
  pois?: Poi[]
  /** `mapPois` historique de la base : nom + position, sans catégorie. */
  legacyPois?: Array<{ name: string; lat: number; lng: number }>
  height?: number
  style?: StyleProp<ViewStyle>
  /** Zoom / déplacement / popups. `false` = vignette figée, tapable par le parent. */
  interactive?: boolean
  /**
   * Cadrage. `near` (défaut) : la zone IRIS + les stations à 8 min ou moins —
   * une vraie vue de micro-quartier. `all` : tout, y compris les stations
   * lointaines, pour le plein écran.
   */
  fit?: 'near' | 'all'
}

// Couleurs officielles des lignes (miroir du MapZone web).
const LINE_COLORS: Record<string, { bg: string; text: string }> = {
  M1: { bg: '#FFCD00', text: '#000' }, M2: { bg: '#003CA6', text: '#fff' },
  M3: { bg: '#9F9825', text: '#fff' }, M4: { bg: '#BE418D', text: '#fff' },
  M5: { bg: '#FF7E2E', text: '#fff' }, M6: { bg: '#7BC9A2', text: '#000' },
  M7: { bg: '#FA9ABA', text: '#000' }, M8: { bg: '#E19BDF', text: '#000' },
  M9: { bg: '#B6BD00', text: '#000' }, M10: { bg: '#C9910D', text: '#fff' },
  M11: { bg: '#704B1C', text: '#fff' }, M12: { bg: '#007852', text: '#fff' },
  M13: { bg: '#98D4E2', text: '#000' }, M14: { bg: '#6628B4', text: '#fff' },
  'RER A': { bg: '#E2231A', text: '#fff' }, 'RER B': { bg: '#5191CD', text: '#fff' },
  'RER C': { bg: '#F4CE00', text: '#000' }, 'RER D': { bg: '#00A650', text: '#fff' },
  'RER E': { bg: '#BA4A9D', text: '#fff' },
}

/** Palette des repères — reprise telle quelle par la légende de la fiche. */
export const POI_COLORS: Record<PoiCat, string> = {
  shop: '#F97316',
  school: '#6366F1',
  park: '#16A34A',
  health: '#DC2626',
  monument: '#A855F7',
}

export const POI_LABELS: Record<PoiCat, string> = {
  shop: 'Commerces',
  school: 'Écoles',
  park: 'Parcs',
  health: 'Santé',
  monument: 'Monuments',
}

const ACCENT = '#A6512B'
const NEAR_WALK_MAX = 8 // minutes

/** JSON sûr à coller dans une balise <script> (un nom OSM peut tout contenir). */
function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
}

interface HtmlArgs {
  lat: number
  lng: number
  polygon?: LatLng[]
  transports?: MapTransport[]
  interactive: boolean
  fit: 'near' | 'all'
}

function buildHtml(p: HtmlArgs): string {
  const interactive = p.interactive
  const data = {
    lat: p.lat,
    lng: p.lng,
    polygon: p.polygon ?? [],
    transports: p.transports ?? [],
    fitAll: p.fit === 'all',
    nearWalkMax: NEAR_WALK_MAX,
    interactive,
    colors: LINE_COLORS,
    poiColors: POI_COLORS,
    accent: ACCENT,
    poiR: interactive ? 5 : 3.5,
  }
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>
html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#FAF3EE}
.leaflet-container{background:#FAF3EE;font-family:-apple-system,BlinkMacSystemFont,Helvetica,Arial,sans-serif}
.stPill{display:flex;align-items:center;background:#fff;border-radius:999px;padding:2px 8px 2px 2px;
        box-shadow:0 1px 4px rgba(0,0,0,.28);white-space:nowrap}
.stPill b{width:17px;height:17px;border-radius:9px;display:flex;align-items:center;justify-content:center;
          font-size:9.5px;font-weight:800;margin-right:5px;flex:0 0 auto}
.stPill span{font-size:10px;font-weight:700;color:#201A16}
.stPill em{font-style:normal;font-weight:600;color:#B7A99D;margin-left:4px}
.leaflet-popup-content{margin:8px 12px;font-size:12.5px;font-weight:600;color:#201A16}
.leaflet-popup-content-wrapper{border-radius:10px}
</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var D = ${safeJson(data)};
var I = D.interactive;
var map = L.map('map', {
  zoomControl: I, attributionControl: false,
  dragging: I, touchZoom: I, doubleClickZoom: I, scrollWheelZoom: I,
  boxZoom: I, keyboard: I, tap: I
}).setView([D.lat, D.lng], 15);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(map);

/* ── Zone IRIS ─────────────────────────────────────────────────────────── */
var bounds = null;
function extend(latlng) { bounds = bounds ? bounds.extend(latlng) : L.latLngBounds(latlng, latlng); }
if (D.polygon && D.polygon.length) {
  var poly = L.polygon(D.polygon, { color: D.accent, fillColor: D.accent, fillOpacity: 0.13, weight: 2.4, opacity: 0.9 }).addTo(map);
  D.polygon.forEach(extend);
}

/* Aucun repère au centre : un point, même auréolé d'un rayon d'approximation,
   se lit comme « le bien est ICI ». Il ne l'est pas — la seule promesse tenue
   est la zone IRIS. Le point ne sert plus qu'au cadrage. */
extend([D.lat, D.lng]);

/* ── Stations : pastille de ligne + nom + temps à pied ─────────────────── */
function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
(D.transports || []).forEach(function (t) {
  var c = D.colors[t.line] || { bg: '#555', text: '#fff' };
  var num = String(t.line).replace(/^M/, '').replace(/^RER /, '');
  var walk = (t.walkMin != null) ? '<em>' + t.walkMin + ' min</em>' : '';
  var html = '<div class="stPill"><b style="background:' + c.bg + ';color:' + c.text + '">' + esc(num) + '</b>'
           + '<span>' + esc(t.name) + '</span>' + walk + '</div>';
  var w = 30 + String(t.name).length * 5.4 + (t.walkMin != null ? 34 : 0);
  L.marker([t.lat, t.lng], {
    icon: L.divIcon({ html: html, className: '', iconSize: [w, 21], iconAnchor: [10, 10] }),
    interactive: false, keyboard: false
  }).addTo(map);
  if (D.fitAll || t.walkMin == null || t.walkMin <= D.nearWalkMax) extend([t.lat, t.lng]);
});

if (bounds) { try { map.fitBounds(bounds, { padding: [26, 26], maxZoom: 16 }); } catch (e) {} }

/* ── Repères OpenStreetMap — injectés après coup ───────────────────────── */
var poiLayer = L.layerGroup().addTo(map);
window.__setPois = function (list) {
  poiLayer.clearLayers();
  (list || []).forEach(function (p) {
    var col = D.poiColors[p.cat] || '#8A7A6E';
    var m = L.circleMarker([p.lat, p.lng], {
      radius: D.poiR, color: '#fff', weight: 1.6, opacity: 1,
      fillColor: col, fillOpacity: 1, interactive: I
    }).addTo(poiLayer);
    if (I && p.name) m.bindPopup(esc(p.name));
  });
};
</script></body></html>`
}

export function MapZone({
  lat,
  lng,
  polygon,
  transports,
  pois,
  legacyPois,
  height,
  style,
  interactive = true,
  fit = 'near',
}: Props) {
  const webRef = useRef<WebViewHandle | null>(null)
  const [ready, setReady] = useState(false)

  // Le HTML ne dépend QUE de la géométrie : le recalculer à chaque rendu
  // rechargerait la WebView (et perdrait le zoom en cours en plein écran).
  // Les repères, eux, sont injectés à chaud — ils ne sont pas dans ce mémo.
  const html = useMemo(
    () => buildHtml({ lat, lng, polygon, transports, interactive, fit }),
    [lat, lng, polygon, transports, interactive, fit],
  )

  const merged = useMemo<Poi[]>(() => {
    const extra: Poi[] = (legacyPois ?? []).map((p) => ({ ...p, cat: 'monument' as PoiCat }))
    return [...(pois ?? []), ...extra]
  }, [pois, legacyPois])

  // Un changement de géométrie recharge la page : sans cette remise à zéro,
  // `ready` resterait vrai et l'injection partirait avant que la nouvelle page
  // ait défini `window.__setPois` — les repères disparaîtraient dès la 2e fiche
  // (le PropertyDetailSheet réutilise la même instance d'un bien à l'autre).
  useEffect(() => {
    setReady(false)
  }, [html])

  useEffect(() => {
    if (!ready || merged.length === 0) return
    webRef.current?.injectJavaScript(
      `window.__setPois && window.__setPois(${safeJson(merged)}); true;`,
    )
  }, [ready, merged])

  if (!RNWebView) return null
  const WV = RNWebView
  return (
    <View style={[styles.wrap, { height: height ?? 200 }, style]}>
      <WV
        ref={webRef}
        originWhitelist={['*']}
        source={{ html }}
        style={styles.web}
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        androidLayerType="hardware"
        onLoadEnd={() => setReady(true)}
      />
    </View>
  )
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  web: { flex: 1, backgroundColor: '#FAF3EE' },
})
