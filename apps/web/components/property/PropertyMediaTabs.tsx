'use client'

/**
 * Médias de la fiche — Photos / Plan / Visite virtuelle.
 *
 * Jumeau web de `apps/mobile/src/components/property/PropertyMediaTabs.tsx` :
 * onglets SOULIGNÉS (pas des pastilles), hauteur d'image fixe de 260 px,
 * carrousel avec flèches, points et bouton d'agrandissement, visite virtuelle
 * jouée EN LIGNE (le poster « Lancer la visite » n'existe que sur mobile,
 * comme repli quand le module natif manque).
 *
 * Deux différences d'implémentation assumées, invisibles à l'œil :
 *   – le carrousel natif triplique la liste dans une FlatList pour boucler ;
 *     ici un simple index modulo suffit, le DOM ne garde qu'une image ;
 *   – les images passent par <img> et non next/image : les photos de démo
 *     viennent de domaines externes non déclarés dans next.config.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, Camera, Map as MapIcon, Globe, Maximize2, X } from 'lucide-react'

type TabKey = 'photos' | 'plan' | 'tour'

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'photos', label: 'Photos' },
  { key: 'plan', label: 'Plan' },
  { key: 'tour', label: 'Visite virtuelle' },
]

const ACCENT = '#A64B27'
const HERO_HEIGHT = 260

interface Props {
  photos?: string[]
  planUrls?: string[]
  virtualTourUrl?: string
  coverUrl?: string
}

/* ── Message d'absence ─────────────────────────────────────────────────── */
function EmptyMedia({ tab }: { tab: TabKey }) {
  const txt =
    tab === 'photos'
      ? 'Photos bientôt disponibles'
      : tab === 'plan'
        ? 'Plan bientôt disponible'
        : 'Visite virtuelle bientôt disponible'
  const Icon = tab === 'photos' ? Camera : tab === 'plan' ? MapIcon : Globe
  return (
    <div className="w-full h-full flex flex-col items-center justify-center gap-2">
      <Icon size={26} className="text-neutral-300" />
      <p style={{ fontSize: 14, color: '#A8A29E' }}>{txt}</p>
    </div>
  )
}

/* ── Plein écran ───────────────────────────────────────────────────────── */
function Fullscreen({
  children,
  onClose,
}: {
  children: React.ReactNode
  onClose: () => void
}) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    queueMicrotask(() => setMounted(true))
  }, [])
  if (!mounted) return null

  return createPortal(
    <div className="fixed inset-0 z-[600] bg-black flex items-center justify-center">
      {children}
      <button
        type="button"
        onClick={onClose}
        className="absolute rounded-full flex items-center justify-center"
        style={{
          right: 14,
          top: 'calc(env(safe-area-inset-top, 0px) + 8px)',
          width: 40,
          height: 40,
          background: 'rgba(0,0,0,0.5)',
        }}
        aria-label="Fermer"
      >
        <X size={26} strokeWidth={2.4} color="#fff" />
      </button>
    </div>,
    document.body,
  )
}

/* ── Carrousel ─────────────────────────────────────────────────────────── */
function MediaCarousel({ items, contain }: { items: string[]; contain?: boolean }) {
  const [index, setIndex] = useState(0)
  const [full, setFull] = useState(false)
  const touchX = useRef<number | null>(null)
  const n = items.length

  const go = useCallback(
    (dir: 1 | -1) => setIndex((i) => (i + dir + n) % n),
    [n],
  )

  const src = items[Math.min(index, n - 1)]

  return (
    <>
      <div
        className="relative w-full overflow-hidden"
        style={{ height: HERO_HEIGHT, backgroundColor: '#F5F5F4', borderRadius: 14 }}
        onTouchStart={(e) => {
          touchX.current = e.touches[0].clientX
        }}
        onTouchEnd={(e) => {
          const start = touchX.current
          touchX.current = null
          if (start == null || n < 2) return
          const dx = e.changedTouches[0].clientX - start
          if (Math.abs(dx) > 40) go(dx < 0 ? 1 : -1)
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          className={`w-full h-full ${contain ? 'object-contain' : 'object-cover'}`}
          style={{ transition: 'opacity 150ms' }}
        />

        {/* Agrandir */}
        <button
          type="button"
          onClick={() => setFull(true)}
          className="absolute flex items-center justify-center rounded-full"
          style={{ top: 10, right: 10, width: 34, height: 34, background: 'rgba(0,0,0,0.45)' }}
          aria-label="Agrandir"
        >
          <Maximize2 size={18} strokeWidth={2.2} color="#fff" />
        </button>

        {n > 1 && (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              className="absolute flex items-center justify-center rounded-full"
              style={{
                left: 10,
                top: HERO_HEIGHT / 2 - 18,
                width: 36,
                height: 36,
                background: 'rgba(0,0,0,0.38)',
              }}
              aria-label="Précédent"
            >
              <ChevronLeft size={22} strokeWidth={2.5} color="#fff" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              className="absolute flex items-center justify-center rounded-full"
              style={{
                right: 10,
                top: HERO_HEIGHT / 2 - 18,
                width: 36,
                height: 36,
                background: 'rgba(0,0,0,0.38)',
              }}
              aria-label="Suivant"
            >
              <ChevronRight size={22} strokeWidth={2.5} color="#fff" />
            </button>

            <div
              className="absolute left-0 right-0 flex items-center justify-center"
              style={{ bottom: 12, gap: 6 }}
            >
              {items.map((_, i) => (
                <span
                  key={i}
                  style={{
                    height: 6,
                    width: i === index ? 18 : 6,
                    borderRadius: 3,
                    background: i === index ? '#fff' : 'rgba(255,255,255,0.55)',
                    transition: 'width 160ms',
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {full && (
        <Fullscreen onClose={() => setFull(false)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="max-w-full max-h-full object-contain" />
        </Fullscreen>
      )}
    </>
  )
}

/* ── Visite virtuelle ──────────────────────────────────────────────────── */
function TourFrame({ url }: { url: string }) {
  const [full, setFull] = useState(false)
  return (
    <>
      <div
        className="relative w-full overflow-hidden"
        style={{ height: HERO_HEIGHT, backgroundColor: '#1A1A1A', borderRadius: 14 }}
      >
        <iframe
          src={url}
          className="w-full h-full border-0"
          allow="fullscreen; accelerometer; gyroscope; magnetometer; xr-spatial-tracking"
          allowFullScreen
        />
        <button
          type="button"
          onClick={() => setFull(true)}
          className="absolute flex items-center justify-center rounded-full"
          style={{ top: 10, right: 10, width: 34, height: 34, background: 'rgba(0,0,0,0.45)' }}
          aria-label="Agrandir"
        >
          <Maximize2 size={18} strokeWidth={2.2} color="#fff" />
        </button>
      </div>

      {full && (
        <Fullscreen onClose={() => setFull(false)}>
          <iframe
            src={url}
            className="w-full h-full border-0"
            allow="fullscreen; accelerometer; gyroscope; magnetometer; xr-spatial-tracking"
            allowFullScreen
          />
        </Fullscreen>
      )}
    </>
  )
}

/* ── Composant ─────────────────────────────────────────────────────────── */
export default function PropertyMediaTabs({ photos, planUrls, virtualTourUrl, coverUrl }: Props) {
  const has = {
    photos: (photos?.length ?? 0) > 0 || !!coverUrl,
    plan: (planUrls?.length ?? 0) > 0,
    tour: !!virtualTourUrl,
  }
  const [tab, setTab] = useState<TabKey>('photos')

  const photoList = (photos?.length ?? 0) > 0 ? photos! : coverUrl ? [coverUrl] : []

  return (
    <div style={{ paddingLeft: 16, paddingRight: 16, paddingTop: 12 }}>
      {/* Onglets soulignés. Le libellé gras est doublé en fantôme invisible :
          il fixe la largeur, sinon la ligne saute au changement d'onglet. */}
      <div className="flex" style={{ gap: 20, marginBottom: 12 }}>
        {TABS.map((t) => {
          const on = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className="flex flex-col"
            >
              <span className="relative">
                <span
                  aria-hidden
                  style={{ fontSize: 14, fontWeight: 700, opacity: 0, whiteSpace: 'nowrap' }}
                >
                  {t.label}
                </span>
                <span
                  className="absolute inset-0 text-center"
                  style={{
                    fontSize: 14,
                    fontWeight: on ? 700 : 500,
                    color: on ? '#1C1917' : '#A8A29E',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {t.label}
                </span>
              </span>
              <span
                style={{
                  height: 2,
                  borderRadius: 1,
                  marginTop: 6,
                  background: on ? ACCENT : 'transparent',
                }}
              />
            </button>
          )
        })}
      </div>

      {tab === 'photos' &&
        (has.photos ? (
          <MediaCarousel items={photoList} />
        ) : (
          <div
            className="w-full"
            style={{ height: HERO_HEIGHT, backgroundColor: '#F5F5F4', borderRadius: 14 }}
          >
            <EmptyMedia tab="photos" />
          </div>
        ))}

      {tab === 'plan' &&
        (has.plan ? (
          <MediaCarousel items={planUrls!} contain />
        ) : (
          <div
            className="w-full"
            style={{ height: HERO_HEIGHT, backgroundColor: '#F5F5F4', borderRadius: 14 }}
          >
            <EmptyMedia tab="plan" />
          </div>
        ))}

      {tab === 'tour' &&
        (has.tour ? (
          <TourFrame url={virtualTourUrl!} />
        ) : (
          <div
            className="w-full"
            style={{ height: HERO_HEIGHT, backgroundColor: '#F5F5F4', borderRadius: 14 }}
          >
            <EmptyMedia tab="tour" />
          </div>
        ))}
    </div>
  )
}
