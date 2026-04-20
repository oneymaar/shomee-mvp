'use client'

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import dynamic from 'next/dynamic'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import {
  X, MapPin, Check, Heart, Share2, MessageCircle, Phone, CalendarPlus,
  ChevronLeft, ChevronRight, Camera, Map, Globe,
} from 'lucide-react'
import clsx from 'clsx'
import type { Property } from '@/lib/types'

const MapZone = dynamic(() => import('./MapZone'), { ssr: false })

/* ── DPE badge — flèche, lettre à gauche, couleurs ADEME officielles ────── */
const DPE_COLORS: Record<string, string> = {
  A: '#309630', B: '#59B340', C: '#C3D635',
  D: '#F2CA00', E: '#F49B14', F: '#E8601A', G: '#C82020',
}

const BADGE_LETTER_STYLE: React.CSSProperties = {
  color: 'white',
  WebkitTextStroke: '1.2px black',
  fontWeight: 900,
  fontSize: 20,
  lineHeight: 1,
}

function DpeBadge({ grade, label }: { grade: string; label: string }) {
  return (
    <div className="flex-1">
      <p className="text-white/40 text-[9px] font-bold uppercase tracking-widest mb-2">{label}</p>
      <div
        style={{
          backgroundColor: DPE_COLORS[grade],
          clipPath: 'polygon(0 0, calc(100% - 11px) 0, 100% 50%, calc(100% - 11px) 100%, 0 100%)',
          height: 36,
          minWidth: 60,
          maxWidth: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingLeft: 10,
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
      <p className="text-white/40 text-[9px] font-bold uppercase tracking-widest mb-2">{label}</p>
      <div
        style={{
          backgroundColor: GES_COLORS[grade],
          borderRadius: '0 9999px 9999px 0',
          height: 36,
          minWidth: 60,
          maxWidth: 80,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-start',
          paddingLeft: 10,
        }}
      >
        <span style={BADGE_LETTER_STYLE}>{grade}</span>
      </div>
    </div>
  )
}

/* ── Transport grouping ──────────────────────────────────────────────────── */
const METRO_COLORS: Record<string, string> = {
  '1': '#FFCD00', '2': '#003CA6', '3': '#837902', '3b': '#6EC4E8',
  '4': '#CF009E', '5': '#FF7E2E', '6': '#6ECA97', '7': '#FA9ABA',
  '7b': '#6ECA97', '8': '#E19BDF', '9': '#B6BD00', '10': '#C9910D',
  '11': '#704B1C', '12': '#007852', '13': '#98D4E2', '14': '#62259D',
}
const RER_COLORS: Record<string, string> = {
  A: '#FF2442', B: '#4DA4DC', C: '#FFD200', D: '#00814F', E: '#C25BAA',
}

function parseLine(str: string): { number: string; name: string; color: string; darkText?: boolean } {
  const metro = str.match(/^M(\d{1,2}[ab]?)\s*(.*)$/)
  if (metro) {
    const n = metro[1]; const c = METRO_COLORS[n] || '#999'
    return { number: n, name: metro[2], color: c, darkText: n === '1' || n === '9' || n === '13' }
  }
  const rer = str.match(/^RER\s+([A-E])\s*(.*)$/)
  if (rer) {
    const l = rer[1]; const c = RER_COLORS[l] || '#999'
    return { number: l, name: rer[2] || `RER ${l}`, color: c, darkText: l === 'C' }
  }
  const bus = str.match(/^Bus\s+(.+)$/)
  if (bus) return { number: bus[1], name: `Bus ${bus[1]}`, color: '#5A9FC9' }
  return { number: str, name: str, color: '#666' }
}

function getTransportType(str: string): 'metro' | 'rer' | 'tramway' | 'bus' {
  if (str.match(/^M\d/)) return 'metro'
  if (str.match(/^RER/)) return 'rer'
  if (str.match(/^T\d/)) return 'tramway'
  return 'bus'
}

const TRANSPORT_ORDER: Array<'metro' | 'rer' | 'tramway' | 'bus'> = ['metro', 'rer', 'tramway', 'bus']
const TRANSPORT_LABELS = { metro: 'Métro', rer: 'RER', tramway: 'Tramway', bus: 'Bus' }

function TransportItem({ line }: { line: string }) {
  const p = parseLine(line)
  return (
    <div className="flex items-center gap-2.5 py-2 border-b border-white/6 last:border-0">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-black text-[10px] leading-none"
        style={{ backgroundColor: p.color, color: p.darkText ? '#000' : '#fff' }}
      >
        {p.number}
      </div>
      <span className="text-white/70 text-sm">{p.name}</span>
    </div>
  )
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-3">{children}</h3>
}

function GreyBox({ children, className, style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div className={clsx('bg-white/4 border border-white/8 rounded-2xl', className)} style={style}>
      {children}
    </div>
  )
}

function TableRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-white/6 last:border-0 gap-4">
      <span className="text-white/50 text-sm shrink-0">{label}</span>
      <span className="text-white text-sm font-medium text-right">{value}</span>
    </div>
  )
}

/* ── Photo slide variants ────────────────────────────────────────────────── */
const slideVariants = {
  enter: (dir: number) => ({ x: dir >= 0 ? '100%' : '-100%', opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir >= 0 ? '-100%' : '100%', opacity: 0 }),
}

/* ── Media tab type ──────────────────────────────────────────────────────── */
type MediaTab = 'photos' | 'plan' | 'matterport'

/* ── Component ───────────────────────────────────────────────────────────── */
interface PropertyDetailSheetProps {
  property: Property | null
  open: boolean
  onClose: () => void
  isFavorite: boolean
  onToggleFavorite: () => void
}

export default function PropertyDetailSheet({
  property,
  open,
  onClose,
  isFavorite,
  onToggleFavorite,
}: PropertyDetailSheetProps) {
  const [mediaTab, setMediaTab] = useState<MediaTab>('photos')
  const [photoState, setPhotoState] = useState({ index: 0, dir: 0 })
  const [lightbox, setLightbox] = useState(false)
  const [mounted, setMounted] = useState(false)
  const touchStartX = useRef<number | null>(null)
  const didSwipe = useRef(false)

  useEffect(() => { setMounted(true) }, [])

  useEffect(() => {
    if (!open) {
      setMediaTab('photos')
      setPhotoState({ index: 0, dir: 0 })
      setLightbox(false)
    }
  }, [open])

  if (!property) return null

  const gallery = property.gallery
  const fmtPrice = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.price)
  const fmtPpm = property.pricePerSqm
    ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.pricePerSqm)
    : null

  const goNext = () => setPhotoState(s => ({ index: (s.index + 1) % gallery.length, dir: 1 }))
  const goPrev = () => setPhotoState(s => ({ index: (s.index - 1 + gallery.length) % gallery.length, dir: -1 }))

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX
    didSwipe.current = false
  }
  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current === null) return
    const delta = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(delta) > 40) {
      didSwipe.current = true
      delta < 0 ? goNext() : goPrev()
    }
    touchStartX.current = null
  }
  const handlePhotoClick = () => { if (!didSwipe.current) setLightbox(true) }

  const tabs = [
    { key: 'photos' as MediaTab, label: 'Photos', Icon: Camera },
    { key: 'plan' as MediaTab, label: 'Plan', Icon: Map },
    ...(property.matterportUrl ? [{ key: 'matterport' as MediaTab, label: 'Visite virtuelle', Icon: Globe }] : []),
  ]

  /* ── Transport grouping ──────────────────────────────────────────────── */
  const groupedTransports = TRANSPORT_ORDER.reduce<Record<string, string[]>>((acc, type) => {
    acc[type] = (property.transports ?? []).filter(t => getTransportType(t) === type)
    return acc
  }, { metro: [], rer: [], tramway: [], bus: [] })

  /* ── Photo lightbox (portal) ─────────────────────────────────────────── */
  const LightboxPortal = mounted && lightbox ? createPortal(
    <div
      className="fixed inset-0 z-[500] bg-black flex items-center justify-center"
      onClick={() => setLightbox(false)}
    >
      <div className="relative w-full h-full" onClick={(e) => e.stopPropagation()}>
        <Image src={gallery[photoState.index]} alt="" fill className="object-contain" sizes="100vw" />
        <button
          onClick={() => setLightbox(false)}
          className="absolute right-4 w-9 h-9 bg-white/15 backdrop-blur-sm rounded-full flex items-center justify-center z-10"
          style={{ top: 'max(env(safe-area-inset-top, 16px), 16px)' }}
        >
          <X size={16} className="text-white" />
        </button>
        <div
          className="absolute left-1/2 -translate-x-1/2 bg-black/60 backdrop-blur-sm rounded-full px-3 py-1.5 z-10"
          style={{ top: 'max(env(safe-area-inset-top, 16px), 16px)' }}
        >
          <span className="text-white text-xs font-medium">{photoState.index + 1} / {gallery.length}</span>
        </div>
        <button
          onClick={goPrev}
          className="absolute left-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/50 rounded-full flex items-center justify-center"
        >
          <ChevronLeft size={20} className="text-white" />
        </button>
        <button
          onClick={goNext}
          className="absolute right-3 top-1/2 -translate-y-1/2 w-10 h-10 bg-black/50 rounded-full flex items-center justify-center"
        >
          <ChevronRight size={20} className="text-white" />
        </button>
      </div>
    </div>,
    document.body,
  ) : null

  return (
    <>
      {LightboxPortal}

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
              className="absolute inset-0 z-[70] flex flex-col bg-neutral-950 overflow-hidden"
              initial={{ y: '100%' }}
              animate={{ y: 0 }}
              exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 280 }}
            >
              {/* ── STICKY HEADER ─────────────────────────────────────── */}
              <div className="shrink-0 bg-neutral-950" style={{ paddingTop: 'max(env(safe-area-inset-top, 16px), 16px)' }}>
                <div className="px-4 py-3">
                  {/* Agency + Close */}
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-full bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
                        <span className="text-white text-[11px] font-bold">{property.agentName.charAt(0)}</span>
                      </div>
                      <span className="text-white/70 text-sm font-medium truncate">{property.agentName}</span>
                    </div>
                    <button
                      onClick={onClose}
                      className="w-9 h-9 bg-white/10 rounded-full flex items-center justify-center shrink-0"
                    >
                      <X size={16} className="text-white" />
                    </button>
                  </div>

                  {/* Price */}
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="text-white font-black text-[22px] leading-none">{fmtPrice} €</span>
                    {fmtPpm && <span className="text-white/40 text-xs">soit {fmtPpm} €/m²</span>}
                  </div>

                  {/* Location — prominent */}
                  <div className="flex items-center gap-1.5 mt-1">
                    <MapPin size={12} className="text-white/50 shrink-0" />
                    <span className="text-white text-sm font-medium">{property.location} · {property.district}</span>
                  </div>

                  {/* Stats chips */}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {[
                      { v: `${property.surface} m²` },
                      { v: `${property.rooms} pièces` },
                      ...(property.bedrooms ? [{ v: `${property.bedrooms} ch.` }] : []),
                      ...(property.floor ? [{ v: property.totalFloors ? `${property.floor}e / ${property.totalFloors}e ét.` : `${property.floor}e ét.` }] : []),
                    ].map(({ v }) => (
                      <span key={v} className="bg-white/8 border border-white/12 rounded-xl px-2.5 py-1 text-white text-xs font-semibold">{v}</span>
                    ))}
                  </div>

                  {/* Feature checkmarks — Cave excluded */}
                  {property.features && property.features.filter(f => f !== 'Cave').length > 0 && (
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                      {property.features.filter(f => f !== 'Cave').map((f) => (
                        <div key={f} className="flex items-center gap-1">
                          <Check size={10} className="text-emerald-400 shrink-0" />
                          <span className="text-white/65 text-xs">{f}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                <div className="h-px bg-white/8 mx-4" />
              </div>

              {/* ── CONTENT AREA ──────────────────────────────────────── */}
              <div className="flex-1 relative overflow-hidden">

                {/* Scrollable body */}
                <div className="absolute inset-0 overflow-y-auto scrollbar-hide" style={{ paddingBottom: 96 }}>

                  {/* Media tabs + carousel */}
                  <div className="px-3 pt-3">
                    <div className="flex gap-1.5 mb-2">
                      {tabs.map(({ key, label, Icon }) => (
                        <button
                          key={key}
                          onClick={() => setMediaTab(key)}
                          className={clsx(
                            'flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold transition-all',
                            mediaTab === key ? 'bg-white text-black' : 'text-white/45 border border-white/15',
                          )}
                        >
                          <Icon size={15} />
                          {label}
                        </button>
                      ))}
                    </div>

                    <div className="relative rounded-2xl overflow-hidden bg-neutral-900 mb-5" style={{ aspectRatio: '4/3' }}>
                      {mediaTab === 'photos' && (
                        <>
                          {/* Animated photo — swipe + tap */}
                          <div
                            className="absolute inset-0 cursor-pointer"
                            onClick={handlePhotoClick}
                            onTouchStart={handleTouchStart}
                            onTouchEnd={handleTouchEnd}
                          >
                            <AnimatePresence initial={false} custom={photoState.dir} mode="sync">
                              <motion.div
                                key={photoState.index}
                                custom={photoState.dir}
                                variants={slideVariants}
                                initial="enter"
                                animate="center"
                                exit="exit"
                                transition={{ type: 'tween', duration: 0.22, ease: 'easeInOut' }}
                                className="absolute inset-0"
                              >
                                <Image
                                  src={gallery[photoState.index]}
                                  alt={`Photo ${photoState.index + 1}`}
                                  fill
                                  className="object-cover"
                                  sizes="400px"
                                />
                              </motion.div>
                            </AnimatePresence>
                          </div>

                          {/* Left arrow — infinite */}
                          <button
                            onClick={(e) => { e.stopPropagation(); goPrev() }}
                            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center z-10"
                          >
                            <ChevronLeft size={16} className="text-white" />
                          </button>

                          {/* Right arrow — infinite */}
                          <button
                            onClick={(e) => { e.stopPropagation(); goNext() }}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-black/50 backdrop-blur-sm rounded-full flex items-center justify-center z-10"
                          >
                            <ChevronRight size={16} className="text-white" />
                          </button>

                          {/* Counter */}
                          <div className="absolute bottom-2.5 right-3 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1 z-10">
                            <span className="text-white text-[11px] font-medium">{photoState.index + 1} / {gallery.length}</span>
                          </div>
                        </>
                      )}
                      {mediaTab === 'plan' && (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                          <Map size={36} className="text-white/15" />
                          <p className="text-white/35 text-xs">Plan disponible sur demande</p>
                        </div>
                      )}
                      {mediaTab === 'matterport' && property.matterportUrl && (
                        <iframe src={property.matterportUrl} className="w-full h-full" allowFullScreen />
                      )}
                    </div>
                  </div>

                  {/* ── SECTIONS ── */}
                  <div className="px-4 flex flex-col gap-7 pb-4">

                    {/* Description */}
                    <div>
                      <SectionTitle>Description</SectionTitle>
                      <GreyBox className="px-4 py-4">
                        <p className="text-white/65 text-sm leading-relaxed">{property.description}</p>
                      </GreyBox>
                    </div>

                    {/* Quartier */}
                    {property.mapLat && property.mapLng && (
                      <div>
                        <SectionTitle>Quartier</SectionTitle>
                        {property.irisZone && (
                          <div className="mb-3">
                            <p className="text-white text-sm font-semibold">{property.irisZone}</p>
                            {property.irisDescription && (
                              <p className="text-white/50 text-xs mt-0.5 leading-relaxed">{property.irisDescription}</p>
                            )}
                          </div>
                        )}

                        <GreyBox className="overflow-hidden mb-3" style={{ height: 200, isolation: 'isolate' }}>
                          <MapZone lat={property.mapLat} lng={property.mapLng} polygon={property.irisPolygon} />
                        </GreyBox>

                        {/* Transports groupés par type */}
                        {property.transports && property.transports.length > 0 && (
                          <GreyBox className="px-4 py-2 mb-3">
                            {TRANSPORT_ORDER.map(type => {
                              const lines = groupedTransports[type]
                              if (!lines.length) return null
                              return (
                                <div key={type}>
                                  <p className="text-white/30 text-[9px] font-bold uppercase tracking-wider pt-2 pb-0.5">
                                    {TRANSPORT_LABELS[type]}
                                  </p>
                                  {lines.map(t => <TransportItem key={t} line={t} />)}
                                </div>
                              )
                            })}
                          </GreyBox>
                        )}

                        {(property.nearbyPlaces?.length || property.neighborhoodVibe) && (
                          <GreyBox className="px-4 py-1">
                            {property.nearbyPlaces && property.nearbyPlaces.length > 0 && (
                              <TableRow
                                label="À proximité"
                                value={
                                  <div className="flex flex-col items-end gap-0.5">
                                    {property.nearbyPlaces.map((p) => (
                                      <span key={p} className="text-white/70 text-sm">{p}</span>
                                    ))}
                                  </div>
                                }
                              />
                            )}
                            {property.neighborhoodVibe && <TableRow label="Ambiance" value={property.neighborhoodVibe} />}
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
                        {property.bedrooms !== undefined && <TableRow label="Chambres" value={`${property.bedrooms}`} />}
                        {property.floor !== undefined && (
                          <TableRow label="Étage" value={property.totalFloors ? `${property.floor} / ${property.totalFloors}` : `${property.floor}`} />
                        )}
                        {property.orientation && <TableRow label="Orientation" value={property.orientation} />}
                        {property.exteriorType && <TableRow label="Extérieur" value={property.exteriorType} />}
                        {property.features?.includes('Ascenseur') && <TableRow label="Ascenseur" value="Oui" />}
                        {property.features?.includes('Gardien') && <TableRow label="Gardien" value="Oui" />}
                        {property.features?.includes('Cave') && <TableRow label="Cave" value="Oui" />}
                        {property.heatingType && <TableRow label="Chauffage" value={property.heatingType} />}
                        {property.hotWaterType && <TableRow label="Eau chaude" value={property.hotWaterType} />}
                        {property.yearBuilt && <TableRow label="Année de construction" value={`${property.yearBuilt}`} />}
                        {property.lotCount !== undefined && <TableRow label="Nombre de lots" value={`${property.lotCount}`} />}
                        {property.proceduresEnCours !== undefined && (
                          <TableRow label="Procédures en cours" value={property.proceduresEnCours ? 'Oui' : 'Non'} />
                        )}
                        {property.monthlyCharges !== undefined && <TableRow label="Charges mensuelles" value={`${property.monthlyCharges} €`} />}
                        {property.propertyTax !== undefined && <TableRow label="Taxe foncière" value={`${property.propertyTax} €`} />}
                      </GreyBox>
                    </div>

                    {/* Diagnostics — DPE flèche, GES pilule */}
                    <div>
                      <SectionTitle>Diagnostics</SectionTitle>
                      <GreyBox className="px-4 py-4 flex gap-8">
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
                            <div key={label} className="flex items-center justify-between py-2.5 border-b border-white/6 last:border-0">
                              <span className="text-white/60 text-sm">{label}</span>
                              <span className="text-white text-sm font-semibold">{surface} m²</span>
                            </div>
                          ))}
                        </GreyBox>
                      </div>
                    )}

                    {/* Marché */}
                    {property.marketAvgPricePerSqm && (
                      <div>
                        <SectionTitle>Marché immobilier</SectionTitle>
                        <GreyBox className="px-4 py-3">
                          <div className="flex items-baseline gap-2 mb-1">
                            <span className="text-white font-black text-xl">{fmtPrice} €</span>
                            {fmtPpm && <span className="text-white/40 text-xs">{fmtPpm} €/m²</span>}
                          </div>
                          <div className="h-px bg-white/10 my-3" />
                          <div className="flex flex-col gap-2.5">
                            <div className="flex justify-between items-center">
                              <span className="text-white/50 text-sm">Prix moyen secteur</span>
                              <span className="text-white text-sm font-medium">
                                {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.marketAvgPricePerSqm)} €/m²
                              </span>
                            </div>
                            {property.marketEvolution10y && (
                              <div className="flex justify-between items-center">
                                <span className="text-white/50 text-sm">Évolution 10 ans</span>
                                <span className={clsx('text-sm font-bold', property.marketEvolution10y.startsWith('+') ? 'text-emerald-400' : 'text-red-400')}>
                                  {property.marketEvolution10y}
                                </span>
                              </div>
                            )}
                            {property.marketHighPrice && (
                              <div className="flex justify-between items-center">
                                <span className="text-white/50 text-sm">Prix haut</span>
                                <span className="text-white text-sm font-medium">
                                  {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.marketHighPrice)} €/m²
                                </span>
                              </div>
                            )}
                            {property.marketLowPrice && (
                              <div className="flex justify-between items-center">
                                <span className="text-white/50 text-sm">Prix bas</span>
                                <span className="text-white text-sm font-medium">
                                  {new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.marketLowPrice)} €/m²
                                </span>
                              </div>
                            )}
                          </div>
                        </GreyBox>
                      </div>
                    )}

                    <div className="h-2" />
                  </div>
                </div>

                {/* Gradient behind pills */}
                <div
                  className="absolute bottom-0 left-0 right-0 h-28 pointer-events-none z-10"
                  style={{ background: 'linear-gradient(to top, #0a0a0a 50%, transparent)' }}
                />

                {/* ── FLOATING PILLS ──────────────────────────────────── */}
                <div
                  className="absolute bottom-0 left-0 right-0 px-3 flex gap-2 items-center z-20"
                  style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 14px), 14px)' }}
                >
                  {/* Left pill — 3 CTAs */}
                  <div className="flex-1 bg-white rounded-full shadow-xl shadow-black/40 flex items-center overflow-hidden">
                    {[
                      { icon: MessageCircle, label: 'Message' },
                      { icon: Phone, label: 'Appeler' },
                      { icon: CalendarPlus, label: 'Visiter' },
                    ].map(({ icon: Icon, label }, i, arr) => (
                      <div key={label} className="flex-1 flex items-center justify-center">
                        <button className="flex flex-col items-center gap-0.5 flex-1 py-2.5 rounded-full active:bg-black/5 transition-colors">
                          <Icon size={18} strokeWidth={1.8} className="text-black" />
                          <span className="text-black text-[10px] font-semibold">{label}</span>
                        </button>
                        {i < arr.length - 1 && <div className="w-px h-6 bg-black/10 shrink-0" />}
                      </div>
                    ))}
                  </div>

                  {/* Right pill — Like + Share */}
                  <div className="bg-white rounded-full shadow-xl shadow-black/40 flex items-center overflow-hidden px-1">
                    <button
                      onClick={onToggleFavorite}
                      className="flex flex-col items-center gap-0.5 px-3 py-2.5 rounded-full active:bg-black/5 transition-colors"
                    >
                      <Heart size={18} strokeWidth={1.8} className={clsx(isFavorite ? 'fill-red-500 text-red-500' : 'text-black')} />
                      <span className="text-black text-[10px] font-semibold">{(property.likeCount ?? 0) + (isFavorite ? 1 : 0)}</span>
                    </button>
                    <div className="w-px h-6 bg-black/10" />
                    <button className="flex flex-col items-center gap-0.5 px-3 py-2.5 rounded-full active:bg-black/5 transition-colors">
                      <Share2 size={18} strokeWidth={1.8} className="text-black" />
                      <span className="text-black text-[10px] font-semibold">{property.shareCount ?? 0}</span>
                    </button>
                  </div>
                </div>

              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
