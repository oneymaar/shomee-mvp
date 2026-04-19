'use client'

import { useRef, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import {
  X, MapPin, Check, Heart, Share2, MessageCircle, Phone, CalendarPlus,
} from 'lucide-react'
import clsx from 'clsx'
import type { Property } from '@/lib/types'

/* ── DPE ────────────────────────────────────────────────────────────────── */
const DPE_GRADES = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
const DPE_COLORS: Record<string, string> = {
  A: '#00b050', B: '#70ad47', C: '#c5e0b4',
  D: '#ffc000', E: '#ed7d31', F: '#c00000', G: '#7b2929',
}

function DpeMeter({ grade, label }: { grade: string; label: string }) {
  const idx = DPE_GRADES.indexOf(grade)
  return (
    <div className="flex items-center gap-2">
      <span className="text-white/40 text-[11px] w-7 shrink-0">{label}</span>
      <div className="flex gap-0.5 flex-1">
        {DPE_GRADES.map((g, i) => (
          <div
            key={g}
            className="h-3.5 flex-1 rounded-sm flex items-center justify-center"
            style={{ backgroundColor: DPE_COLORS[g] + (i <= idx ? 'ff' : '25') }}
          >
            {i === idx && <span className="text-white font-black text-[8px]">{g}</span>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Helpers ─────────────────────────────────────────────────────────────── */
function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h3 className="text-white/40 text-[10px] font-bold uppercase tracking-widest mb-3">{children}</h3>
}

function TableRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2.5 border-b border-white/6 last:border-0 gap-4">
      <span className="text-white/50 text-sm shrink-0">{label}</span>
      <span className="text-white text-sm font-medium text-right">{value}</span>
    </div>
  )
}

/* ── Media tab type ──────────────────────────────────────────────────────── */
type MediaTab = 'video' | 'plan' | 'photos'

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
  const miniVideoRef = useRef<HTMLVideoElement>(null)
  const [mediaTab, setMediaTab] = useState<MediaTab>('video')
  const [mapError, setMapError] = useState(false)

  useEffect(() => {
    if (!open) { setMediaTab('video'); setMapError(false) }
  }, [open])

  useEffect(() => {
    const v = miniVideoRef.current
    if (!v) return
    if (open && mediaTab === 'video') { v.currentTime = 0; v.play().catch(() => {}) }
    else v.pause()
  }, [open, property?.id, mediaTab])

  if (!property) return null

  const fmtPrice = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.price)
  const fmtPpm = property.pricePerSqm
    ? new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 }).format(property.pricePerSqm)
    : null

  const mapUrl = !mapError && property.mapLat && property.mapLng
    ? `https://staticmap.openstreetmap.de/staticmap.php?center=${property.mapLat},${property.mapLng}&zoom=15&size=400x180&maptype=mapnik&markers=${property.mapLat},${property.mapLng},red-pushpin`
    : null

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            key="sheet-backdrop"
            className="absolute inset-0 z-40 bg-black/50"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            key="sheet-body"
            className="absolute bottom-[60px] left-0 right-0 z-50 flex flex-col bg-neutral-950 rounded-t-3xl overflow-hidden border-t border-white/10"
            style={{ height: '92%' }}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 280 }}
          >
            {/* ── STICKY HEADER ─────────────────────────────────────────── */}
            <div className="shrink-0 bg-neutral-950">
              {/* Handle */}
              <div className="flex justify-center pt-3 pb-2">
                <div className="w-10 h-1 bg-white/20 rounded-full" />
              </div>

              {/* Media tabs */}
              <div className="flex gap-1.5 px-3 mb-2">
                {([
                  { key: 'video' as MediaTab, label: '▶  Visite virtuelle' },
                  { key: 'plan' as MediaTab, label: '⊞  Plan' },
                  { key: 'photos' as MediaTab, label: '⊡  Photos' },
                ]).map(({ key, label }) => (
                  <button
                    key={key}
                    onClick={() => setMediaTab(key)}
                    className={clsx(
                      'px-3 py-1.5 rounded-full text-[11px] font-semibold transition-all',
                      mediaTab === key
                        ? 'bg-white text-black'
                        : 'text-white/45 border border-white/15',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {/* Media area */}
              <div className="relative mx-3 rounded-2xl overflow-hidden bg-neutral-900" style={{ aspectRatio: '16/9' }}>
                {mediaTab === 'video' && (
                  <>
                    {property.videoUrl && (
                      <video
                        ref={miniVideoRef}
                        src={property.videoUrl}
                        className="w-full h-full object-cover"
                        loop muted playsInline preload="metadata"
                      />
                    )}
                    <Image
                      src={property.imageUrlFallback}
                      alt={property.title}
                      fill
                      className={clsx('object-cover', property.videoUrl && '-z-10')}
                      sizes="400px"
                    />
                  </>
                )}
                {mediaTab === 'photos' && (
                  <div className="flex h-full overflow-x-auto scrollbar-hide snap-x snap-mandatory">
                    {property.gallery.map((img, i) => (
                      <div key={i} className="relative shrink-0 w-full h-full snap-center">
                        <Image src={img} alt={`Photo ${i + 1}`} fill className="object-cover" sizes="400px" />
                      </div>
                    ))}
                  </div>
                )}
                {mediaTab === 'plan' && (
                  <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                    <div className="text-white/15 text-5xl">⊞</div>
                    <p className="text-white/35 text-xs">Plan disponible sur demande</p>
                  </div>
                )}

                {/* Close */}
                <button
                  onClick={onClose}
                  className="absolute top-2.5 right-2.5 w-7 h-7 bg-black/60 backdrop-blur-sm rounded-full flex items-center justify-center"
                >
                  <X size={13} className="text-white" />
                </button>

                {/* Arrondissement badge */}
                <div className="absolute bottom-2.5 left-2.5 bg-black/60 backdrop-blur-sm rounded-full px-2.5 py-1">
                  <span className="text-white font-bold text-[11px] tracking-wide">{property.arrondissement}</span>
                </div>
              </div>

              {/* Agency + price + key stats */}
              <div className="px-4 pt-3 pb-3">
                {/* Agency */}
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 rounded-full bg-white/10 border border-white/20 flex items-center justify-center shrink-0">
                    <span className="text-white text-[8px] font-bold">{property.agentName.charAt(0)}</span>
                  </div>
                  <span className="text-white/50 text-xs">{property.agentName}</span>
                </div>

                {/* Price */}
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-white font-black text-[22px] leading-none">{fmtPrice} €</span>
                  {fmtPpm && <span className="text-white/40 text-xs">soit {fmtPpm} €/m²</span>}
                </div>

                {/* Location */}
                <div className="flex items-center gap-1.5 mt-1">
                  <MapPin size={10} className="text-white/35 shrink-0" />
                  <span className="text-white/45 text-xs">{property.location} · {property.district}</span>
                </div>

                {/* Stats chips */}
                <div className="flex flex-wrap gap-1.5 mt-2.5">
                  {[
                    { v: `${property.surface} m²` },
                    { v: `${property.rooms} pièces` },
                    ...(property.bedrooms ? [{ v: `${property.bedrooms} ch.` }] : []),
                    ...(property.floor ? [{ v: property.totalFloors ? `${property.floor}e / ${property.totalFloors}e ét.` : `${property.floor}e ét.` }] : []),
                  ].map(({ v }) => (
                    <span key={v} className="bg-white/8 border border-white/12 rounded-xl px-2.5 py-1 text-white text-xs font-semibold">
                      {v}
                    </span>
                  ))}
                </div>

                {/* Feature checkmarks */}
                {property.features && property.features.length > 0 && (
                  <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                    {property.features.map((f) => (
                      <div key={f} className="flex items-center gap-1">
                        <Check size={10} className="text-emerald-400 shrink-0" />
                        <span className="text-white/65 text-xs">{f}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* DPE / GES */}
                <div className="mt-3 flex flex-col gap-1.5">
                  <DpeMeter grade={property.dpe} label="DPE" />
                  {property.ges && <DpeMeter grade={property.ges} label="GES" />}
                </div>
              </div>

              <div className="h-px bg-white/8 mx-4" />
            </div>

            {/* ── SCROLLABLE BODY ───────────────────────────────────────── */}
            <div className="flex-1 overflow-y-auto scrollbar-hide">
              <div className="px-4 py-5 flex flex-col gap-7">

                {/* Description */}
                <div>
                  <SectionTitle>Description</SectionTitle>
                  <p className="text-white/65 text-sm leading-relaxed">{property.description}</p>
                </div>

                {/* Localisation — mis en avant */}
                <div>
                  <SectionTitle>Localisation</SectionTitle>

                  {/* IRIS zone — info clé */}
                  {property.irisZone && (
                    <div className="flex items-start gap-3 mb-3 bg-amber-500/10 border border-amber-500/25 rounded-2xl px-4 py-3">
                      <div className="w-2 h-2 rounded-full bg-amber-400 mt-1 shrink-0" />
                      <div>
                        <p className="text-amber-300 text-xs font-bold uppercase tracking-wider mb-0.5">Zone IRIS</p>
                        <p className="text-white text-sm font-semibold">{property.irisZone}</p>
                        {property.irisDescription && (
                          <p className="text-white/50 text-xs mt-1 leading-relaxed">{property.irisDescription}</p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Map */}
                  <div className="relative rounded-2xl overflow-hidden bg-neutral-800 mb-3" style={{ height: 170 }}>
                    {mapUrl ? (
                      <img
                        src={mapUrl}
                        alt="Carte du quartier"
                        className="w-full h-full object-cover"
                        style={{ filter: 'grayscale(30%) brightness(0.75)' }}
                        onError={() => setMapError(true)}
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2 bg-neutral-800/80">
                        <MapPin size={22} className="text-white/20" />
                        <p className="text-white/30 text-xs">{property.district}</p>
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" />
                    {/* Pin */}
                    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                      <div className="w-3.5 h-3.5 rounded-full bg-red-500 border-2 border-white shadow-lg shadow-black/50" />
                    </div>
                    {/* District label bottom */}
                    <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between">
                      <span className="text-white/70 text-[11px] font-medium bg-black/50 backdrop-blur-sm px-2.5 py-1 rounded-full">
                        {property.district}
                      </span>
                    </div>
                  </div>

                  {/* Transport + nearby */}
                  <div className="bg-white/4 border border-white/8 rounded-2xl px-4 py-1">
                    {property.transports && property.transports.length > 0 && (
                      <TableRow
                        label="Transports"
                        value={
                          <div className="flex flex-wrap gap-1 justify-end">
                            {property.transports.map((t) => (
                              <span key={t} className="bg-white/10 text-white/80 text-[11px] px-2 py-0.5 rounded-full">{t}</span>
                            ))}
                          </div>
                        }
                      />
                    )}
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
                    {property.neighborhoodVibe && (
                      <TableRow label="Ambiance" value={property.neighborhoodVibe} />
                    )}
                  </div>
                </div>

                {/* Caractéristiques */}
                <div>
                  <SectionTitle>Caractéristiques</SectionTitle>
                  <div className="bg-white/4 border border-white/8 rounded-2xl px-4 py-1">
                    <TableRow label="Type de bien" value="Appartement" />
                    <TableRow label="Surface Carrez" value={`${property.surface} m²`} />
                    <TableRow label="Pièces" value={`${property.rooms}`} />
                    {property.bedrooms !== undefined && <TableRow label="Chambres" value={`${property.bedrooms}`} />}
                    {property.floor !== undefined && (
                      <TableRow label="Étage" value={property.totalFloors ? `${property.floor} / ${property.totalFloors}` : `${property.floor}`} />
                    )}
                    {property.orientation && <TableRow label="Orientation" value={property.orientation} />}
                    {property.exteriorType && <TableRow label="Extérieur" value={property.exteriorType} />}
                    {property.features?.includes('Ascenseur') !== false && property.features?.includes('Ascenseur') && (
                      <TableRow label="Ascenseur" value="Oui" />
                    )}
                    {property.features?.includes('Gardien') && <TableRow label="Gardien" value="Oui" />}
                    {property.features?.includes('Cave') && <TableRow label="Cave" value="Oui" />}
                    {property.heatingType && <TableRow label="Chauffage" value={property.heatingType} />}
                    {property.hotWaterType && <TableRow label="Eau chaude" value={property.hotWaterType} />}
                    <TableRow label="DPE" value={property.dpe} />
                    {property.ges && <TableRow label="GES" value={property.ges} />}
                    {property.yearBuilt && <TableRow label="Année de construction" value={`${property.yearBuilt}`} />}
                    {property.lotCount !== undefined && <TableRow label="Nombre de lots" value={`${property.lotCount}`} />}
                    {property.proceduresEnCours !== undefined && (
                      <TableRow label="Procédures en cours" value={property.proceduresEnCours ? 'Oui' : 'Non'} />
                    )}
                    {property.monthlyCharges !== undefined && (
                      <TableRow label="Charges mensuelles" value={`${property.monthlyCharges} €`} />
                    )}
                    {property.propertyTax !== undefined && (
                      <TableRow label="Taxe foncière" value={`${property.propertyTax} €`} />
                    )}
                  </div>
                </div>

                {/* Composition */}
                {property.composition && property.composition.length > 0 && (
                  <div>
                    <SectionTitle>Composition</SectionTitle>
                    <div className="bg-white/4 border border-white/8 rounded-2xl px-4 py-1">
                      {property.composition.map(({ label, surface }) => (
                        <div key={label} className="flex items-center justify-between py-2.5 border-b border-white/6 last:border-0">
                          <span className="text-white/60 text-sm">{label}</span>
                          <span className="text-white text-sm font-semibold">{surface} m²</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Marché */}
                {property.marketAvgPricePerSqm && (
                  <div>
                    <SectionTitle>Marché</SectionTitle>
                    <div className="bg-white/4 border border-white/8 rounded-2xl px-4 py-3">
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
                            <span className={clsx(
                              'text-sm font-bold',
                              property.marketEvolution10y.startsWith('+') ? 'text-emerald-400' : 'text-red-400'
                            )}>
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
                    </div>
                  </div>
                )}

                <div className="h-1" />
              </div>
            </div>

            {/* ── STICKY ACTION BAR — fond blanc, icônes noires ─────────── */}
            <div className="shrink-0 bg-white px-3 py-2.5 border-t border-black/8">
              <div className="flex items-center">
                {[
                  { icon: MessageCircle, label: 'Message' },
                  { icon: Phone, label: 'Appeler' },
                  { icon: CalendarPlus, label: 'Visiter' },
                ].map(({ icon: Icon, label }) => (
                  <button
                    key={label}
                    className="flex flex-col items-center gap-0.5 flex-1 py-1.5 rounded-xl active:bg-black/5 transition-colors"
                  >
                    <Icon size={20} strokeWidth={1.8} className="text-black" />
                    <span className="text-black/60 text-[10px] font-semibold">{label}</span>
                  </button>
                ))}
                <div className="w-px h-8 bg-black/12 mx-1" />
                <button
                  onClick={onToggleFavorite}
                  className="flex flex-col items-center gap-0.5 px-3.5 py-1.5"
                >
                  <Heart
                    size={20}
                    strokeWidth={1.8}
                    className={clsx(isFavorite ? 'fill-red-500 text-red-500' : 'text-black')}
                  />
                  <span className="text-black/60 text-[10px] font-semibold">
                    {(property.likeCount ?? 0) + (isFavorite ? 1 : 0)}
                  </span>
                </button>
                <button className="flex flex-col items-center gap-0.5 px-3.5 py-1.5">
                  <Share2 size={20} strokeWidth={1.8} className="text-black" />
                  <span className="text-black/60 text-[10px] font-semibold">{property.shareCount}</span>
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
