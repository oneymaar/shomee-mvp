import React from 'react'
import { View, StyleSheet, type StyleProp, type ViewStyle } from 'react-native'

/**
 * Carte quartier mobile — Leaflet dans une WebView (react-native-webview).
 * Réutilise l'approche web : polygone IRIS + marqueurs métro + POI, dessinés
 * dans une page HTML inline. react-native-webview est un module NATIF : chargé
 * via un require gardé (comme la visite virtuelle) ; si indispo (Expo Go, avant
 * dev build), MOBILE_MAP_AVAILABLE = false et l'appelant retombe sur le placeholder.
 */

type WebViewProps = {
  source: { html: string }
  originWhitelist?: string[]
  style?: StyleProp<ViewStyle>
  scrollEnabled?: boolean
  setSupportMultipleWindows?: boolean
  androidLayerType?: 'none' | 'software' | 'hardware'
}

let RNWebView: React.ComponentType<WebViewProps> | null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  RNWebView = require('react-native-webview').WebView
} catch {
  RNWebView = null
}

export const MOBILE_MAP_AVAILABLE = RNWebView != null

type LatLng = [number, number]

interface Props {
  lat: number
  lng: number
  polygon?: LatLng[]
  transports?: Array<{ name: string; line: string; lat: number; lng: number }>
  pois?: Array<{ name: string; lat: number; lng: number }>
  height?: number
}

// Couleurs officielles des lignes (miroir du MapZone web).
const LINE_COLORS: Record<string, { bg: string; text: string }> = {
  M1: { bg: '#FFCD00', text: '#000' }, M2: { bg: '#003CA6', text: '#fff' },
  M3: { bg: '#9F9825', text: '#fff' }, M4: { bg: '#BE418D', text: '#fff' },
  M5: { bg: '#FF7E2E', text: '#fff' }, M6: { bg: '#6ECA97', text: '#000' },
  M7: { bg: '#FA9ABA', text: '#000' }, M8: { bg: '#E19BDF', text: '#000' },
  M9: { bg: '#B6BD00', text: '#000' }, M10: { bg: '#C9910D', text: '#fff' },
  M11: { bg: '#704B1C', text: '#fff' }, M12: { bg: '#007852', text: '#fff' },
  M13: { bg: '#98D4E2', text: '#000' }, M14: { bg: '#6628B4', text: '#fff' },
  'RER A': { bg: '#E2231A', text: '#fff' }, 'RER B': { bg: '#5191CD', text: '#fff' },
  'RER C': { bg: '#F4CE00', text: '#000' }, 'RER D': { bg: '#00A650', text: '#fff' },
  'RER E': { bg: '#BA4A9D', text: '#fff' },
}

function buildHtml(p: Props): string {
  const data = JSON.stringify({
    lat: p.lat,
    lng: p.lng,
    polygon: p.polygon ?? [],
    transports: p.transports ?? [],
    pois: p.pois ?? [],
    colors: LINE_COLORS,
  })
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
<style>html,body,#map{margin:0;padding:0;height:100%;width:100%;background:#FDF5F2}.leaflet-container{background:#FDF5F2}</style>
</head><body>
<div id="map"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
var D = ${data};
var map = L.map('map', { zoomControl: true, attributionControl: false }).setView([D.lat, D.lng], 15);
L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { subdomains: 'abcd', maxZoom: 19 }).addTo(map);
if (D.polygon && D.polygon.length) {
  var poly = L.polygon(D.polygon, { color: '#7c3aed', fillColor: '#7c3aed', fillOpacity: 0.18, weight: 3, opacity: 0.85 }).addTo(map);
  try { map.fitBounds(poly.getBounds(), { padding: [24, 24] }); } catch (e) {}
}
function tIcon(line) {
  var c = D.colors[line] || { bg: '#555', text: '#fff' };
  var l = String(line).replace(/^M/, '').replace(/^RER /, '');
  return L.divIcon({ html: '<div style="background:' + c.bg + ';color:' + c.text + ';width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.35);font-family:sans-serif">' + l + '</div>', className: '', iconSize: [22, 22], iconAnchor: [11, 11] });
}
(D.transports || []).forEach(function (t) {
  L.marker([t.lat, t.lng], { icon: tIcon(t.line) }).addTo(map).bindPopup(t.name);
});
(D.pois || []).forEach(function (p) {
  L.marker([p.lat, p.lng], { icon: L.divIcon({ html: '<div style="width:9px;height:9px;border-radius:50%;background:#f97316;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)"></div>', className: '', iconSize: [9, 9], iconAnchor: [5, 5] }) }).addTo(map).bindPopup(p.name);
});
</script></body></html>`
}

export function MapZone(props: Props) {
  if (!RNWebView) return null
  return (
    <View style={[styles.wrap, { height: props.height ?? 200 }]}>
      <RNWebView
        originWhitelist={['*']}
        source={{ html: buildHtml(props) }}
        style={styles.web}
        scrollEnabled={false}
        setSupportMultipleWindows={false}
        androidLayerType="hardware"
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
    marginBottom: 12,
  },
  web: { flex: 1, backgroundColor: '#FDF5F2' },
})
