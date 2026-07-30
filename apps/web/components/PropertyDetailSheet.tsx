'use client'

/**
 * Fiche descriptive du bien — jumelle web de
 * `apps/mobile/src/components/PropertyDetailSheet.tsx`.
 *
 * Cette fiche est OUVERTE PENDANT LE TEASER (parcours S9 : lien LLM → web,
 * avant installation de l'app). Tout ce qui change dans la fiche native doit
 * donc être répercuté ici, sinon le visiteur découvre une fiche différente de
 * celle qu'il retrouvera dans l'app.
 *
 * Ce que le web garde en propre, volontairement :
 *   – la barre collante haute (agence + croix) : sur mobile la poignée du
 *     bottom-sheet suffit à refermer, ici il faut une croix toujours visible ;
 *   – `previewMode` (aperçu agent : les champs vides s'affichent en « — ») ;
 *   – les compteurs like/partage des pastilles basses, qui n'existent pas
 *     encore côté natif.
 *
 * Tout le reste — typographie de l'en-tête, onglets média soulignés, carte de
 * quartier 260 px + légende + plein écran, stations groupées avec temps de
 * marche, formatage des euros — est aligné au pixel sur l'app.
 */

import { useState, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import {
  X, MapPin, Check, Heart, Share2, MessageCircle, Phone, CalendarPlus,
  Map as MapIcon, HelpCircle, Footprints, Maximize2,
} from 'lucide-react'
import clsx from 'clsx'
import type { Property } from '@/lib/types'
import { shareProperty } from '@/lib/share'
import { formatLocation } from '@shomee/core/utils/format'
import { DEFAULT_FALLBACK_IMAGE } from '@shomee/core/constants'
import PropertyMediaTabs from '@/components/property/PropertyMediaTabs'
import { useNearbyPois, POI_COLORS, POI_LABELS, type PoiCat } from '@/lib/useNearbyPois'

// Leaflet ne survit pas au rendu serveur : la carte est chargée côté client
// seulement. La palette des repères vit dans `lib/useNearbyPois` pour que cette
// fiche puisse s'en servir sans réimporter Leaflet.
const MapZone = dynamic(() => import('./MapZone'), { ssr: false })

// TODO : numéro de test — à remplacer par le téléphone de l'agence (feed live).
const TEST_PHONE = '+33670744935'

// TEMP démo média — appliqués à tous les biens tant que la base n'a ni galerie
// ni plan ni visite. Mêmes valeurs que l'app : la fiche du teaser doit montrer
// exactement les mêmes médias. À REMPLACER par les vrais médias.
const DEMO_PHOTOS = [
  'https://images.unsplash.com/photo-1600566753190-17f0baa2a6c3?w=1000&q=80',
  'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?w=1000&q=80',
  'https://images.unsplash.com/photo-1615874959474-d609969a20ed?w=1000&q=80',
]
// Plan = carrousel. Copie web du plan bundlé dans l'app.
const DEMO_PLAN_URLS = ['/plans/plan-demo.png']
// Visite virtuelle réelle (Giraffe360).
const DEMO_TOUR_URL = 'https://tour.giraffe360.com/4da4e76c9e9a4af5b95cc2afe33a1a22'

const ACCENT = '#A64B27'

/* ── Formatage FR ──────────────────────────────────────────────────────────
   Espace fine tous les 3 chiffres, comme le natif (qui n'a pas Intl sous
   Hermes). Utiliser la même fonction des deux côtés garantit le même rendu. */
function groupThousands(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
}
const euro = (n: number) => `${groupThousands(n)} €`
const perSqm = (n: number) => `${groupThousands(n)} €/m²`

/* ── DPE badge — flèche, lettre à gauche, couleurs ADEME officielles ────── */
const DPE_COLORS: Record<string, string> = {
  A: '#309630', B: '#59B340', C: '#C3D635',
  D: '#F2CA00', E: '#F49B14', F: '#E8601A', G: '#C82020',
}

const BADGE_LETTER_STYLE: React.CSSProperties = {
  color: 'white',
  WebkitTextStroke: '1.2px black',
  paintOrder: 'stroke fill',
  fontWeight: 900,
  fontSize: 20,
  lineHeight: 1,
}

function DpeBadge({ grade, label }: { grade: string; label: string }) {
  return (
    <div className="flex-1">
      <p className="text-neutral-400 text-[9px] font-bold uppercase tracking-widest mb-2">{label}</p>
      <div
        style={{
          backgroundColor: DPE_COLORS[grade],
          clipPath: 'polygon(0 0, calc(100% - 11px) 0, 100% 50%, calc(100% - 11px) 100%, 0 100%)',
          height: 36,
          width: 76,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingLeft: 12,
        }}
      >
        <span style={BADGE_LETTER_STYLE}>{grade}</span>
      </div>
    </div>
  )
}

/* ── GES badge — arrondi droite uniquement, bleus ardoise officiels ──────── */
const GES_COLORS: Record<string, string> = {
  A: '#C0D5E8', B: '#92B7D3', C: '#6495BE',
  D: '#4D7DA8', E: '#366592', F: '#214D7C', G: '#0F3566',
}

function GesBadge({ grade, label }: { grade: string; label: string }) {
  return (
    <div className="flex-1">
      <p className="text-neutral-400 text-[9px] font-bold uppercase tracking-widest mb-2">{label}</p>
      <div
        style={{
          backgroundColor: GES_COLORS[grade],
          borderRadius: '0 9999px 9999px 0',
          height: 36,
          width: 76,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingLeft: 12,
        }}
      >
        <span style={BADGE_LETTER_STYLE}>{grade}</span>
      </div>
    </div>
  )
}

/* ── Transports — parsing + couleurs de lignes (identiques au natif) ─────── */
const METRO_COLORS: Record<string, string> = {
  '1': '#FFCD00', '2': '#003CA6', '3': '#837902', '3b': '#6EC4E8',
  '4': '#CF009E', '5': '#FF7E2E', '6': '#6ECA97', '7': '#FA9ABA',
  '7b': '#6ECA97', '8': '#E19BDF', '9': '#B6BD00', '10': '#C9910D',
  '11': '#704B1C', '12': '#007852', '13': '#98D4E2', '14': '#62259D',
}
const RER_COLORS: Record<string, string> = {
  A: '#FF2442', B: '#4DA4DC', C: '#FFD200', D: '#00814F', E: '#C25BAA',
}

/** Jetons émis par le backfill : « M1 Bastille », « M7bis … », « RER A … », « TN H … ». */
function parseLine(str: string): { number: string; name: string; color: string; darkText: boolean } {
  const metro = str.match(/^M(\d{1,2})(bis)?\s+(.+)$/)
  if (metro) {
    const base = metro[1]
    return {
      number: metro[2] ? `${base}b` : base,
      name: metro[3],
      color: METRO_COLORS[base] || '#999',
      darkText: base === '1' || base === '9' || base === '13',
    }
  }
  const rer = str.match(/^RER\s+([A-E])\s+(.+)$/)
  if (rer) {
    const l = rer[1]
    return { number: l, name: rer[2], color: RER_COLORS[l] || '#999', darkText: l === 'C' }
  }
  const tn = str.match(/^TN\s+([A-Z]{1,2})\s+(.+)$/)
  if (tn) return { number: tn[1], name: tn[2], color: '#8D5BA6', darkText: false }
  return { number: str, name: str, color: '#666', darkText: false }
}

function getTransportType(str: string): 'metro' | 'rer' | 'transilien' {
  if (str.match(/^M\d/)) return 'metro'
  if (str.match(/^RER/)) return 'rer'
  if (str.match(/^TN/)) return 'transilien'
  return 'metro'
}

const TRANSPORT_ORDER = ['metro', 'rer', 'transilien'] as const
const TRANSPORT_LABELS: Record<string, string> = {
  metro: 'Métro', rer: 'RER', transilien: 'Transilien',
}

type Badge = { number: string; color: string; darkText: boolean }

/** Une ligne par STATION (et non par ligne) : les badges se cumulent. */
function groupStations(strs: string[]): Array<{ name: string; badges: Badge[] }> {
  const order: string[] = []
  const byStation: Record<string, Badge[]> = {}
  for (const s of strs) {
    const p = parseLine(s)
    let badges = byStation[p.name]
    if (!badges) {
      badges = []
      byStation[p.name] = badges
      order.push(p.name)
    }
    if (!badges.some((b) => b.number === p.number)) {
      badges.push({ number: p.number, color: p.color, darkText: p.darkText })
    }
  }
  return order.map((name) => ({ name, badges: byStation[name] ?? [] }))
}

function StationRow({ name, badges, walk }: { name: string; badges: Badge[]; walk?: number }) {
  return (
    <div className="flex items-center gap-2.5 py-2 border-b border-black/8">
      <div className="flex items-center shrink-0" style={{ gap: 3 }}>
        {badges.map((b) => (
          <span
            key={b.number}
            className="flex items-center justify-center rounded-full"
            style={{
              width: 20,
              height: 20,
              backgroundColor: b.color,
              color: b.darkText ? '#000' : '#fff',
              fontSize: 10,
              fontWeight: 900,
              lineHeight: 1,
            }}
          >
            {b.number}
          </span>
        ))}
      </div>
      <span className="truncate" style={{ color: '#57534E', fontSize: 14 }}>{name}</span>
      {walk != null && (
        <span className="flex items-center ml-auto shrink-0" style={{ gap: 3 }}>
          <Footprints size={11} color="#A8A29E" />
          <span style={{ color: '#A8A29E', fontSize: 12, fontWeight: 600 }}>{walk} min</span>
        </span>
      )}
    </div>
  )
}

/* ── Helpers de mise en page ─────────────────────────────────────────────── */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-neutral-400 text-[10px] font-bold uppercase tracking-widest mb-3">{children}</h3>
}

function GreyBox({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={clsx('bg-white border border-black/8 rounded-2xl', className)} style={style}>
      {children}
    </div>
  )
}

function TableRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-black/8 gap-4">
      <span className="text-neutral-500 text-sm shrink-0">{label}</span>
      <span className="text-neutral-900 text-sm font-medium text-right">{value}</span>
    </div>
  )
}

/* ── Composant ───────────────────────────────────────────────────────────── */
interface PropertyDetailSheetProps {
  property: Property | null
  open: boolean
  onClose: () => void
  isFavorite: boolean
  onToggleFavorite: () => void
  onMessage?: () => void
  hideBottomBar?: boolean
  previewMode?: boolean
}

const EMPTY_VALUE = <span className="text-neutral-300 italic">—</span>

function PreviewRow({
  label,
  hasValue,
  value,
  previewMode,
}: {
  label: string
  hasValue: boolean
  value: React.ReactNode
  previewMode: boolean
}) {
  if (hasValue) return <TableRow label={label} value={value} />
  if (previewMode) return <TableRow label={label} value={EMPTY_VALUE} />
  return null
}

export default function PropertyDetailSheet({
  property,
  open,
  onClose,
  isFavorite,
  onToggleFavorite,
  onMessage,
  hideBottomBar,
  previewMode = false,
}: PropertyDetailSheetProps) {
  const [mounted, setMounted] = useState(false)
  const [mapFull, setMapFull] = useState(false)

  // Repères de quartier OpenStreetMap. APPEL AVANT tout retour anticipé :
  // l'ordre des hooks ne doit jamais changer d'un rendu à l'autre.
  const pois = useNearbyPois(property?.mapLat, property?.mapLng)
  const poiCounts = useMemo(() => {
    const c: Partial<Record<PoiCat, number>> = {}
    for (const p of pois) c[p.cat] = (c[p.cat] ?? 0) + 1
    return c
  }, [pois])

  useEffect(() => {
    queueMicrotask(() => setMounted(true))
  }, [])

  useEffect(() => {
    if (!open) queueMicrotask(() => setMapFull(false))
  }, [open])

  if (!property) return null

  // Identité de marque = agence (logo + nom), repli sur l'agent.
  const brandName = property.agencyName ?? property.agentName
  const brandLogo = property.agencyLogo ?? property.agentAvatar
  const brandInitial = (brandName?.trim().charAt(0) || '?').toUpperCase()

  const ppm = property.pricePerSqm ?? Math.round(property.price / Math.max(property.surface, 1))

  // « Cave » est déjà listée dans Caractéristiques : même filtre que le feed.
  const features = (property.features ?? []).filter((f) => f !== 'Cave')

  // Temps de marche par station (pré-calculé au backfill ; min si plusieurs quais).
  const walkByStation: Record<string, number> = {}
  for (const mt of property.mapTransports ?? []) {
    if (mt.walkMin != null) {
      walkByStation[mt.name] =
        walkByStation[mt.name] == null ? mt.walkMin : Math.min(walkByStation[mt.name], mt.walkMin)
    }
  }

  const hasMap = property.mapLat != null && property.mapLng != null

  // Médias de démonstration : jamais dans l'aperçu agent, qui doit montrer
  // exactement ce que l'agence a fourni (et rien d'autre).
  const photos =
    property.gallery.length > 0
      ? property.gallery
      : previewMode
        ? []
        : [property.imageUrlFallback || DEFAULT_FALLBACK_IMAGE, ...DEMO_PHOTOS]
  const planUrls = previewMode ? [] : DEMO_PLAN_URLS
  const tourUrl = property.matterportUrl ?? (previewMode ? undefined : DEMO_TOUR_URL)

  const showQuartier =
    previewMode ||
    hasMap ||
    Boolean(property.irisZone) ||
    (property.transports?.length ?? 0) > 0 ||
    (property.nearbyPlaces?.length ?? 0) > 0 ||
    Boolean(property.neighborhoodVibe)

  /* ── Carte plein écran (portail) ─────────────────────────────────────── */
  const MapFullPortal =
    mounted && mapFull && hasMap
      ? createPortal(
          <div className="fixed inset-0 z-[550]" style={{ backgroundColor: '#FDF5F2' }}>
            <MapZone
              lat={property.mapLat!}
              lng={property.mapLng!}
              polygon={property.irisPolygon}
              transports={property.mapTransports}
              pois={pois}
              legacyPois={property.mapPois}
              height="100%"
              interactive
              fit="all"
            />
            <button
              type="button"
              onClick={() => setMapFull(false)}
              className="absolute flex items-center justify-center rounded-full z-10"
              style={{
                right: 14,
                top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
                width: 38,
                height: 38,
                background: 'rgba(0,0,0,0.6)',
              }}
              aria-label="Fermer la carte"
            >
              <X size={24} strokeWidth={2.4} color="#fff" />
            </button>
            <div
              className="absolute flex flex-col pointer-events-none z-10"
              style={{
                left: 14,
                bottom: 'calc(env(safe-area-inset-bottom, 0px) + 20px)',
                background: 'rgba(255,255,255,0.94)',
                borderRadius: 14,
                paddingLeft: 13,
                paddingRight: 13,
                paddingTop: 11,
                paddingBottom: 11,
                gap: 7,
                boxShadow: '0 4px 12px rgba(0,0,0,0.14)',
              }}
            >
              {(Object.keys(POI_LABELS) as PoiCat[]).map((cat) => (
                <div key={cat} className="flex items-center" style={{ gap: 7 }}>
                  <span
                    className="rounded-full shrink-0"
                    style={{ width: 8, height: 8, backgroundColor: POI_COLORS[cat] }}
                  />
                  <span style={{ color: '#44403c', fontSize: 11.5, fontWeight: 500 }}>
                    {POI_LABELS[cat]}
                  </span>
                  <span style={{ color: '#A8A29E', fontSize: 11.5, fontWeight: 700 }}>
                    {poiCounts[cat] ?? 0}
                  </span>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      {MapFullPortal}

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              key="sheet-backdrop"
              className="absolute inset-0 z-[60] bg-black/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={onClose}
            />

            <motion.div
              key="sheet-body"
              className="absolute inset-0 z-[70] flex flex-col overflow-hidden"
              style={{ backgroundColor: '#FDF5F2' }}
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            >
              {/* ── BARRE COLLANTE — agence + croix ─────────────────────
                  Spécifique au web : sur mobile, la poignée du bottom-sheet
                  suffit à refermer. Tout le reste de l'en-tête défile, comme
                  dans l'app. */}
              <div
                className="shrink-0"
                style={{
                  backgroundColor: '#FDF5F2',
                  paddingTop: 'max(env(safe-area-inset-top, 12px), 12px)',
                  boxShadow: '0 2px 12px rgba(0,0,0,0.07), 0 1px 0 rgba(0,0,0,0.06)',
                }}
              >
                <div className="px-4 pb-3 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div
                      className="rounded-full overflow-hidden shrink-0 flex items-center justify-center"
                      style={{
                        width: 32,
                        height: 32,
                        backgroundColor: '#171717',
                        border: '1px solid rgba(0,0,0,0.1)',
                      }}
                    >
                      {brandLogo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={brandLogo} alt={brandName} className="w-full h-full object-contain" />
                      ) : (
                        <span className="text-white text-[12px] font-bold">{brandInitial}</span>
                      )}
                    </div>
                    <span className="truncate" style={{ color: '#1C1917', fontSize: 14, fontWeight: 600 }}>
                      {brandName}
                    </span>
                  </div>
                  <button
                    onClick={onClose}
                    className="w-9 h-9 bg-black/8 rounded-full flex items-center justify-center shrink-0"
                    aria-label="Fermer"
                  >
                    <X size={16} className="text-neutral-600" />
                  </button>
                </div>
              </div>

              {/* ── ZONE DE CONTENU ────────────────────────────────────── */}
              <div className="flex-1 relative overflow-hidden" style={{ backgroundColor: '#FDF5F2' }}>
                <div className="absolute inset-0 overflow-y-auto scrollbar-hide" style={{ paddingBottom: 96 }}>

                  {/* ── EN-TÊTE TEXTE — prix · lieu · chips · critères ── */}
                  <div className="px-4" style={{ paddingTop: 16 }}>
                    {/* Prix + prix au m² */}
                    <div className="flex items-baseline flex-wrap" style={{ columnGap: 8, marginTop: 4 }}>
                      <span style={{ color: '#1C1917', fontSize: 24, fontWeight: 900, lineHeight: '26px' }}>
                        {euro(property.price)}
                      </span>
                      <span style={{ color: '#78716C', fontSize: 12 }}>soit {perSqm(ppm)}</span>
                    </div>

                    {/* Localisation */}
                    <div className="flex items-center" style={{ gap: 6, marginTop: 6 }}>
                      <MapPin size={12} color="#A8A29E" strokeWidth={2.5} className="shrink-0" />
                      <span style={{ color: '#1C1917', fontSize: 14, fontWeight: 500 }}>
                        {formatLocation(property.arrondissement, property.district)}
                      </span>
                    </div>

                    {/* Chips stats — l'étage vit dans Caractéristiques, comme dans l'app */}
                    <div className="flex flex-wrap" style={{ gap: 6, marginTop: 10 }}>
                      {[
                        `${property.surface} m²`,
                        `${property.rooms} pièces`,
                        ...(property.bedrooms != null ? [`${property.bedrooms} ch.`] : []),
                      ].map((v) => (
                        <span
                          key={v}
                          style={{
                            backgroundColor: 'rgba(0,0,0,0.05)',
                            border: '1px solid rgba(0,0,0,0.08)',
                            borderRadius: 12,
                            padding: '5px 10px',
                            color: '#292524',
                            fontSize: 12,
                            fontWeight: 600,
                          }}
                        >
                          {v}
                        </span>
                      ))}
                    </div>

                    {/* Équipements — puces ✓ vertes (même rendu que le feed) */}
                    {features.length > 0 && (
                      <div
                        className="flex flex-wrap"
                        style={{ columnGap: 14, rowGap: 8, marginTop: 12 }}
                      >
                        {features.map((f) => (
                          <span key={f} className="flex items-center" style={{ gap: 4 }}>
                            <Check size={11} color="#34d399" strokeWidth={3} className="shrink-0" />
                            <span style={{ color: '#44403C', fontSize: 13 }}>{f}</span>
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Critères NON matchés (✗ barrés) puis doutes (?) — la fiche
                        montre aussi ce qui ne colle pas, c'est la spec scoring. */}
                    {(property.matchDetail?.unmatched?.length ?? 0) +
                      (property.matchDetail?.doubts?.length ?? 0) >
                      0 && (
                      <div
                        className="flex flex-wrap"
                        style={{ columnGap: 14, rowGap: 8, marginTop: 12 }}
                      >
                        {(property.matchDetail?.unmatched ?? []).map((c) => (
                          <span key={`um-${c.label}`} className="flex items-center" style={{ gap: 4 }}>
                            <X size={11} color="#a8a29e" strokeWidth={3} className="shrink-0" />
                            <span style={{ color: '#a8a29e', fontSize: 13, textDecoration: 'line-through' }}>
                              {c.label}
                            </span>
                          </span>
                        ))}
                        {(property.matchDetail?.doubts ?? []).map((c) => (
                          <span key={`db-${c.label}`} className="flex items-center" style={{ gap: 4 }}>
                            <HelpCircle size={11} color="#d97706" strokeWidth={2.5} className="shrink-0" />
                            <span style={{ color: '#b45309', fontSize: 13 }}>{c.label}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="h-px bg-black/8 mx-4" style={{ marginTop: 14 }} />

                  {/* ── MÉDIAS — onglets soulignés Photos / Plan / Visite ── */}
                  <PropertyMediaTabs
                    photos={photos}
                    planUrls={planUrls}
                    virtualTourUrl={tourUrl}
                    coverUrl={property.imageUrlFallback || DEFAULT_FALLBACK_IMAGE}
                  />

                  {/* ── SECTIONS ── */}
                  <div className="px-4 flex flex-col" style={{ paddingTop: 24, gap: 28 }}>

                    {/* Description */}
                    <div>
                      <SectionTitle>Description</SectionTitle>
                      <GreyBox className="px-4 py-4">
                        <p style={{ color: '#57534E', fontSize: 14, lineHeight: '21px' }}>
                          {property.description}
                        </p>
                      </GreyBox>
                    </div>

                    {/* Quartier */}
                    {showQuartier && (
                      <div>
                        <SectionTitle>Quartier</SectionTitle>

                        {property.irisZone && (
                          <div style={{ marginBottom: 12 }}>
                            <p style={{ color: '#1C1917', fontSize: 14, fontWeight: 600 }}>
                              {property.irisZone}
                            </p>
                            {property.irisDescription && (
                              <p style={{ color: '#78716C', fontSize: 12, lineHeight: '17px', marginTop: 2 }}>
                                {property.irisDescription}
                              </p>
                            )}
                          </div>
                        )}
                        {previewMode && !property.irisZone && (
                          <div style={{ marginBottom: 12 }}>
                            <p className="text-neutral-300 italic text-sm">— Quartier non renseigné</p>
                          </div>
                        )}

                        {/* Carte de quartier — figée, comme dans l'app : les gestes
                            Leaflet se disputeraient le défilement de la fiche. Le
                            clic ouvre la version manipulable en plein écran. */}
                        {hasMap ? (
                          <>
                            <div className="relative">
                              <GreyBox className="overflow-hidden" style={{ height: 260, isolation: 'isolate' }}>
                                <MapZone
                                  lat={property.mapLat!}
                                  lng={property.mapLng!}
                                  polygon={property.irisPolygon}
                                  transports={property.mapTransports}
                                  pois={pois}
                                  legacyPois={property.mapPois}
                                  height="100%"
                                  interactive={false}
                                  fit="near"
                                />
                              </GreyBox>
                              {/* Couche de clic POSÉE SUR la carte : Leaflet avale
                                  les événements, un parent ne les verrait jamais. */}
                              <button
                                type="button"
                                onClick={() => setMapFull(true)}
                                className="absolute inset-0 rounded-2xl"
                                aria-label="Agrandir la carte du quartier"
                              />
                              <span
                                className="absolute flex items-center justify-center pointer-events-none"
                                style={{
                                  top: 10,
                                  right: 10,
                                  width: 32,
                                  height: 32,
                                  borderRadius: 10,
                                  background: 'rgba(0,0,0,0.55)',
                                }}
                              >
                                <Maximize2 size={17} strokeWidth={2.2} color="#fff" />
                              </span>
                            </div>

                            {/* Légende — même palette que les points de la carte */}
                            <div
                              className="flex flex-wrap items-center"
                              style={{ gap: 10, marginTop: 9 }}
                            >
                              {(Object.keys(POI_LABELS) as PoiCat[]).map((cat) => (
                                <span key={cat} className="flex items-center" style={{ gap: 5 }}>
                                  <span
                                    className="rounded-full shrink-0"
                                    style={{ width: 8, height: 8, backgroundColor: POI_COLORS[cat] }}
                                  />
                                  <span style={{ color: '#78716c', fontSize: 10.5, fontWeight: 500 }}>
                                    {POI_LABELS[cat]}
                                  </span>
                                </span>
                              ))}
                            </div>
                            <p style={{ color: '#A8A29E', fontSize: 10, marginTop: 6, marginBottom: 12 }}>
                              Repères OpenStreetMap · Toucher la carte pour l’agrandir
                            </p>
                          </>
                        ) : (
                          <GreyBox
                            className="flex flex-col items-center justify-center"
                            style={{ height: 150, gap: 6, marginBottom: 12 }}
                          >
                            <MapIcon size={26} color="#D6D3D1" />
                            <p style={{ color: '#A8A29E', fontSize: 12 }}>
                              Carte du quartier bientôt disponible
                            </p>
                          </GreyBox>
                        )}

                        {/* Transports — une ligne par STATION, badges cumulés */}
                        {property.transports && property.transports.length > 0 && (
                          <GreyBox className="px-4 py-1" style={{ marginBottom: 12 }}>
                            {TRANSPORT_ORDER.map((type) => {
                              const strs = (property.transports ?? []).filter(
                                (t) => getTransportType(t) === type,
                              )
                              if (!strs.length) return null
                              return (
                                <div key={type}>
                                  <p
                                    className="uppercase"
                                    style={{
                                      color: '#A8A29E',
                                      fontSize: 9,
                                      fontWeight: 700,
                                      letterSpacing: 1,
                                      paddingTop: 8,
                                      paddingBottom: 2,
                                    }}
                                  >
                                    {TRANSPORT_LABELS[type]}
                                  </p>
                                  {groupStations(strs).map((g) => (
                                    <StationRow
                                      key={g.name}
                                      name={g.name}
                                      badges={g.badges}
                                      walk={walkByStation[g.name]}
                                    />
                                  ))}
                                </div>
                              )
                            })}
                          </GreyBox>
                        )}

                        {((property.nearbyPlaces?.length ?? 0) > 0 || property.neighborhoodVibe) && (
                          <GreyBox className="px-4 py-1">
                            {property.nearbyPlaces && property.nearbyPlaces.length > 0 && (
                              <TableRow
                                label="À proximité"
                                value={
                                  <span className="flex flex-col items-end" style={{ gap: 2 }}>
                                    {property.nearbyPlaces.map((p) => (
                                      <span key={p} style={{ color: '#57534E', fontSize: 14, fontWeight: 400 }}>
                                        {p}
                                      </span>
                                    ))}
                                  </span>
                                }
                              />
                            )}
                            {property.neighborhoodVibe && (
                              <TableRow label="Ambiance" value={property.neighborhoodVibe} />
                            )}
                          </GreyBox>
                        )}
                      </div>
                    )}

                    {/* Caractéristiques */}
                    <div>
                      <SectionTitle>Caractéristiques</SectionTitle>
                      <GreyBox className="px-4 py-1">
                        <TableRow label="Type de bien" value="Appartement" />
                        <TableRow label="Surface Carrez" value={`${property.surface} m²`} />
                        <TableRow label="Pièces" value={`${property.rooms}`} />
                        <PreviewRow
                          label="Chambres"
                          hasValue={property.bedrooms !== undefined}
                          value={`${property.bedrooms}`}
                          previewMode={previewMode}
                        />
                        <PreviewRow
                          label="Étage"
                          hasValue={property.floor !== undefined}
                          value={property.totalFloors ? `${property.floor} / ${property.totalFloors}` : `${property.floor}`}
                          previewMode={previewMode}
                        />
                        <PreviewRow
                          label="Orientation"
                          hasValue={Boolean(property.orientation)}
                          value={property.orientation}
                          previewMode={previewMode}
                        />
                        <PreviewRow
                          label="Extérieur"
                          hasValue={Boolean(property.exteriorType)}
                          value={property.exteriorType}
                          previewMode={previewMode}
                        />
                        <PreviewRow
                          label="Ascenseur"
                          hasValue={Boolean(property.features?.includes('Ascenseur'))}
                          value="Oui"
                          previewMode={previewMode}
                        />
                        <PreviewRow
                          label="Gardien"
                          hasValue={Boolean(property.features?.includes('Gardien'))}
                          value="Oui"
                          previewMode={previewMode}
                        />
                        <PreviewRow
                          label="Cave"
                          hasValue={Boolean(property.features?.includes('Cave'))}
                          value="Oui"
                          previewMode={previewMode}
                        />
                        <PreviewRow
                          label="Chauffage"
                          hasValue={Boolean(property.heatingType)}
                          value={property.heatingType}
                          previewMode={previewMode}
                        />
                        <PreviewRow
                          label="Eau chaude"
                          hasValue={Boolean(property.hotWaterType)}
                          value={property.hotWaterType}
                          previewMode={previewMode}
                        />
                        <PreviewRow
                          label="Année de construction"
                          hasValue={Boolean(property.yearBuilt)}
                          value={`${property.yearBuilt}`}
                          previewMode={previewMode}
                        />
                        <PreviewRow
                          label="Nombre de lots"
                          hasValue={property.lotCount !== undefined}
                          value={`${property.lotCount}`}
                          previewMode={previewMode}
                        />
                        <PreviewRow
                          label="Procédures en cours"
                          hasValue={property.proceduresEnCours !== undefined}
                          value={property.proceduresEnCours ? 'Oui' : 'Non'}
                          previewMode={previewMode}
                        />
                        <PreviewRow
                          label="Charges mensuelles"
                          hasValue={property.monthlyCharges !== undefined}
                          value={property.monthlyCharges != null ? euro(property.monthlyCharges) : null}
                          previewMode={previewMode}
                        />
                        <PreviewRow
                          label="Taxe foncière"
                          hasValue={property.propertyTax !== undefined}
                          value={property.propertyTax != null ? euro(property.propertyTax) : null}
                          previewMode={previewMode}
                        />
                      </GreyBox>
                    </div>

                    {/* Diagnostics — DPE flèche, GES pilule */}
                    <div>
                      <SectionTitle>Diagnostics</SectionTitle>
                      <GreyBox className="px-4 py-4 flex gap-6">
                        <DpeBadge grade={property.dpe} label="DPE — Énergie" />
                        {property.ges && <GesBadge grade={property.ges} label="GES — Climat" />}
                      </GreyBox>
                    </div>

                    {/* Composition */}
                    {property.composition && property.composition.length > 0 && (
                      <div>
                        <SectionTitle>Composition</SectionTitle>
                        <GreyBox className="px-4 py-1">
                          {property.composition.map(({ label, surface }) => (
                            <TableRow key={label} label={label} value={`${surface} m²`} />
                          ))}
                        </GreyBox>
                      </div>
                    )}

                    {/* Marché immobilier */}
                    {property.marketAvgPricePerSqm != null && (
                      <div>
                        <SectionTitle>Marché immobilier</SectionTitle>
                        <GreyBox className="px-4 py-4">
                          <div className="flex items-baseline" style={{ gap: 8, marginBottom: 4 }}>
                            <span style={{ color: '#1C1917', fontSize: 20, fontWeight: 900 }}>
                              {euro(property.price)}
                            </span>
                            {property.pricePerSqm != null && (
                              <span style={{ color: '#78716C', fontSize: 12 }}>
                                {perSqm(property.pricePerSqm)}
                              </span>
                            )}
                          </div>
                          <div className="h-px bg-black/8" style={{ marginTop: 12, marginBottom: 12 }} />
                          <TableRow
                            label="Prix moyen secteur"
                            value={perSqm(property.marketAvgPricePerSqm)}
                          />
                          {property.marketEvolution10y && (
                            <TableRow
                              label="Évolution 10 ans"
                              value={
                                <span
                                  className="font-bold"
                                  style={{
                                    color: property.marketEvolution10y.startsWith('+')
                                      ? '#059669'
                                      : '#ef4444',
                                  }}
                                >
                                  {property.marketEvolution10y}
                                </span>
                              }
                            />
                          )}
                          {property.marketHighPrice != null && (
                            <TableRow label="Prix haut" value={perSqm(property.marketHighPrice)} />
                          )}
                          {property.marketLowPrice != null && (
                            <TableRow label="Prix bas" value={perSqm(property.marketLowPrice)} />
                          )}
                        </GreyBox>
                      </div>
                    )}

                    <div className="h-2" />
                  </div>
                </div>

                {/* ── PASTILLES FLOTTANTES ────────────────────────────── */}
                {!hideBottomBar && <div
                  className={clsx(
                    'absolute left-0 right-0 px-3 flex gap-2 items-center z-20',
                    previewMode && 'pointer-events-none grayscale brightness-90',
                  )}
                  style={{ bottom: 8, filter: 'drop-shadow(0 -2px 12px rgba(0,0,0,0.12))' }}
                >
                  {/* Pastille gauche — 3 CTA */}
                  <div className="flex-1 rounded-full shadow-xl shadow-black/20 flex items-center overflow-hidden" style={{ backgroundColor: ACCENT }}>
                    {[
                      { icon: MessageCircle, label: 'Message', onClick: onMessage },
                      { icon: Phone, label: 'Appeler', onClick: () => { window.location.href = `tel:${TEST_PHONE}` } },
                      { icon: CalendarPlus, label: 'Visiter', onClick: undefined },
                    ].map(({ icon: Icon, label, onClick }, i, arr) => (
                      <div key={label} className="flex-1 flex items-center justify-center">
                        <button onClick={onClick} className="flex flex-col items-center gap-0.5 flex-1 py-2.5 rounded-full active:bg-white/10 transition-colors">
                          <Icon size={18} strokeWidth={1.8} className="text-white" />
                          <span className="text-white text-[10px] font-semibold">{label}</span>
                        </button>
                        {i < arr.length - 1 && <div className="w-px h-6 bg-white/20 shrink-0" />}
                      </div>
                    ))}
                  </div>

                  {/* Pastille droite — Like + Partage (compteurs propres au web) */}
                  <div className="rounded-full shadow-xl shadow-black/20 flex items-center overflow-hidden px-1" style={{ backgroundColor: ACCENT }}>
                    <button
                      onClick={onToggleFavorite}
                      className="flex flex-col items-center gap-0.5 px-3 py-2.5 rounded-full active:bg-white/10 transition-colors"
                    >
                      <Heart size={18} strokeWidth={1.8} className={clsx(isFavorite ? 'fill-red-500 text-red-500' : 'text-white')} />
                      <span className="text-white text-[10px] font-semibold">{(property.likeCount ?? 0) + (isFavorite ? 1 : 0)}</span>
                    </button>
                    <div className="w-px h-6 bg-white/20" />
                    <button
                      onClick={() => shareProperty(property)}
                      className="flex flex-col items-center gap-0.5 px-3 py-2.5 rounded-full active:bg-white/10 transition-colors"
                    >
                      <Share2 size={18} strokeWidth={1.8} className="text-white" />
                      <span className="text-white text-[10px] font-semibold">{property.shareCount ?? 0}</span>
                    </button>
                  </div>
                </div>}

              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
