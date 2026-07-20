'use client'

/**
 * Glue de la carte embarquée — RÉUTILISE `ZoneMap` (composant pur) + les
 * fonctions core (`geoDataService`, actions `toggle*` du searchStore) SANS
 * modifier l'onboarding web (`LocationMapStep` non réutilisé : il re-résout
 * depuis `locationIntent` au montage, ce qu'on ne veut pas ici — le natif a déjà
 * résolu). On ne recompose donc que la glue minimale : seed de la sélection,
 * chargement des géométries, handlers de clic (copie des handlers de
 * LocationMapStep), pastilles, et renvoi de la sélection au natif.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { useSearchStore } from '@/lib/searchStore'
import {
  fetchParisGeoData,
  fetchParisIris,
  fetchSuburbanCommunes,
  getChildQuartiers,
  type GeoZone,
} from '@shomee/core/geo/geoDataService'

const ZoneMap = dynamic(() => import('@/components/onboarding/ZoneMap'), { ssr: false })

const PARIS_CENTER: [number, number] = [48.8566, 2.3522]

interface InitialSel {
  arrIds: string[]
  quartierIds: string[]
  irisIds: string[]
  communeIds: string[]
  label: string
}

function parseSel(selParam: string): InitialSel {
  try {
    const o = JSON.parse(selParam) as Record<string, unknown>
    const arr = (k: string) => (Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [])
    return {
      arrIds: arr('arrIds'),
      quartierIds: arr('quartierIds'),
      irisIds: arr('irisIds'),
      communeIds: arr('communeIds'),
      label: typeof o.label === 'string' ? o.label : '',
    }
  } catch {
    return { arrIds: [], quartierIds: [], irisIds: [], communeIds: [], label: '' }
  }
}

// ─── Bounds d'un ensemble de features (pour fitBounds Leaflet [[lat,lng],…]) ──
type Bounds = [[number, number], [number, number]]
function boundsOfFeatures(features: GeoZone[]): Bounds | null {
  let minLat = 90, minLng = 180, maxLat = -90, maxLng = -180
  let found = false
  for (const f of features) {
    const g = f.feature?.geometry
    if (!g) continue
    const rings: GeoJSON.Position[][] =
      g.type === 'Polygon' ? (g.coordinates as GeoJSON.Position[][])
      : g.type === 'MultiPolygon' ? (g.coordinates as GeoJSON.Position[][][]).flat()
      : []
    for (const ring of rings) {
      for (const pt of ring) {
        const lng = pt[0], lat = pt[1]
        if (lat < minLat) minLat = lat
        if (lat > maxLat) maxLat = lat
        if (lng < minLng) minLng = lng
        if (lng > maxLng) maxLng = lng
        found = true
      }
    }
  }
  if (!found) return null
  return [[minLat, minLng], [maxLat, maxLng]]
}

export default function ZoneMapEmbedClient({ selParam }: { selParam: string }) {
  const initial = useMemo(() => parseSel(selParam), [selParam])

  const [arrondissements, setArrondissements] = useState<GeoZone[]>([])
  const [quartiers, setQuartiers] = useState<GeoZone[]>([])
  const [iris, setIris] = useState<GeoZone[]>([])
  const [communes, setCommunes] = useState<GeoZone[]>([])
  const [irisLoading, setIrisLoading] = useState(true)
  const [zoom, setZoom] = useState(12)
  const [ready, setReady] = useState(false)

  const {
    selectedArrIds, selectedQuartierIds, selectedIrisIds, selectedCommuneIds,
    toggleArr, toggleQuartier, toggleIris, toggleCommune, toggleCommuneIris,
  } = useSearchStore()

  // Seed du store depuis la sélection initiale (résolue par le natif) — une fois,
  // au montage (jamais pendant le rendu → pas d'update pendant render).
  useEffect(() => {
    useSearchStore.setState({
      selectedArrIds: initial.arrIds,
      selectedQuartierIds: initial.quartierIds,
      selectedIrisIds: initial.irisIds,
      selectedCommuneIds: initial.communeIds,
      locationLabel: initial.label,
    })
  }, [initial])

  // Chargement des géométries (mêmes sources que LocationMapStep / handoff).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [{ arrondissements: arrs, quartiers: qus }, coms] = await Promise.all([
          fetchParisGeoData(),
          fetchSuburbanCommunes(),
        ])
        if (cancelled) return
        setArrondissements(arrs)
        setQuartiers(qus)
        setCommunes(coms)
        setReady(true)
        const ir = await fetchParisIris(qus, coms)
        if (cancelled) return
        setIris(ir)
        setIrisLoading(false)
      } catch {
        if (!cancelled) { setReady(true); setIrisLoading(false) }
      }
    })()
    return () => { cancelled = true }
  }, [])

  // fitBounds calculé sur la sélection INITIALE (stable), PAS sur la sélection
  // live → la carte ne se re-cadre pas à chaque tap. Se resserre quand les IRIS
  // arrivent (arr grossier → IRIS précis), puis reste stable.
  const fitBounds = useMemo<Bounds | null>(() => {
    const byId = (list: GeoZone[], ids: string[]) => list.filter((z) => ids.includes(z.id))
    const sel = [
      ...byId(iris, initial.irisIds),
      ...byId(quartiers, initial.quartierIds),
      ...byId(communes, initial.communeIds),
      ...byId(arrondissements, initial.arrIds),
    ]
    return sel.length > 0 ? boundsOfFeatures(sel) : null
  }, [iris, quartiers, communes, arrondissements, initial])

  const center = useMemo<[number, number]>(() => {
    if (fitBounds) {
      return [(fitBounds[0][0] + fitBounds[1][0]) / 2, (fitBounds[0][1] + fitBounds[1][1]) / 2]
    }
    return PARIS_CENTER
  }, [fitBounds])

  // ── Handlers de clic (copie fidèle de LocationMapStep) ──────────────────────
  const handleClickArr = useCallback((zone: GeoZone) => {
    const childQuartierIds = getChildQuartiers(zone.id, quartiers).map((q) => q.id)
    const childIrisIds = iris.filter((i) => childQuartierIds.includes(i.parentId ?? '')).map((i) => i.id)
    toggleArr(zone.id, childQuartierIds, childIrisIds)
  }, [iris, quartiers, toggleArr])

  const handleClickQuartier = useCallback((zone: GeoZone) => {
    if (!zone.parentId) return
    const siblings = getChildQuartiers(zone.parentId, quartiers).map((q) => q.id)
    const childIrisIds = iris.filter((i) => i.parentId === zone.id).map((i) => i.id)
    toggleQuartier(zone.id, zone.parentId, siblings, childIrisIds)
  }, [iris, quartiers, toggleQuartier])

  const handleClickIris = useCallback((zone: GeoZone) => {
    if (!zone.parentId) return
    const parentQuartier = quartiers.find((q) => q.id === zone.parentId)
    if (!parentQuartier || !parentQuartier.parentId) return
    const parentArrId = parentQuartier.parentId
    const allQuartierSiblingIds = iris.filter((i) => i.parentId === zone.parentId).map((i) => i.id)
    const allArrQuartierIds = getChildQuartiers(parentArrId, quartiers).map((q) => q.id)
    toggleIris(zone.id, zone.parentId, parentArrId, allQuartierSiblingIds, allArrQuartierIds)
  }, [iris, quartiers, toggleIris])

  const handleClickCommune = useCallback((zone: GeoZone) => {
    toggleCommune(zone.id)
  }, [toggleCommune])

  const handleClickCommuneIris = useCallback((zone: GeoZone) => {
    if (!zone.parentId) return
    const allSiblingIds = iris.filter((i) => i.parentId === zone.parentId).map((i) => i.id)
    toggleCommuneIris(zone.id, zone.parentId, allSiblingIds)
  }, [iris, toggleCommuneIris])

  // ── Pastilles ───────────────────────────────────────────────────────────────
  const arrById = useMemo(() => new Map(arrondissements.map((a) => [a.id, a])), [arrondissements])
  const communeById = useMemo(() => new Map(communes.map((c) => [c.id, c])), [communes])
  const quartierById = useMemo(() => new Map(quartiers.map((q) => [q.id, q])), [quartiers])
  const irisById = useMemo(() => new Map(iris.map((i) => [i.id, i])), [iris])

  // Arrondissements « partiels » : des IRIS/quartiers sélectionnés sans l'arr entier.
  const partialArrIds = useMemo(() => {
    const set = new Set<string>()
    for (const qid of selectedQuartierIds) {
      const arrId = quartierById.get(qid)?.parentId
      if (arrId && !selectedArrIds.includes(arrId)) set.add(arrId)
    }
    for (const iid of selectedIrisIds) {
      const qId = irisById.get(iid)?.parentId
      const arrId = qId ? quartierById.get(qId)?.parentId : undefined
      if (arrId && !selectedArrIds.includes(arrId)) set.add(arrId)
    }
    return [...set]
  }, [selectedQuartierIds, selectedIrisIds, quartierById, irisById, selectedArrIds])

  const removePartialArr = useCallback((arrId: string) => {
    const childQ = getChildQuartiers(arrId, quartiers).map((q) => q.id)
    const childI = iris.filter((i) => childQ.includes(i.parentId ?? '')).map((i) => i.id)
    useSearchStore.setState((s) => ({
      selectedQuartierIds: s.selectedQuartierIds.filter((q) => !childQ.includes(q)),
      selectedIrisIds: s.selectedIrisIds.filter((i) => !childI.includes(i)),
    }))
  }, [iris, quartiers])

  const hasSelection =
    selectedArrIds.length > 0 || selectedCommuneIds.length > 0 ||
    selectedQuartierIds.length > 0 || selectedIrisIds.length > 0

  // Libellé dérivé de la sélection courante (fallback : libellé initial).
  const deriveLabel = useCallback(() => {
    const parts: string[] = []
    for (const id of selectedArrIds) { const z = arrById.get(id); if (z) parts.push(z.shortName || z.name) }
    for (const id of selectedCommuneIds) { const z = communeById.get(id); if (z) parts.push(z.shortName || z.name) }
    for (const id of partialArrIds) { const z = arrById.get(id); if (z) parts.push(`${z.shortName || z.name} (secteur)`) }
    return parts.length > 0 ? parts.join(' · ') : (initial.label || '')
  }, [selectedArrIds, selectedCommuneIds, partialArrIds, arrById, communeById, initial.label])

  const handleValidate = useCallback(() => {
    const s = useSearchStore.getState()
    const label = deriveLabel()
    useSearchStore.setState({ locationLabel: label })
    const payload = {
      selectedArrIds: s.selectedArrIds,
      selectedQuartierIds: s.selectedQuartierIds,
      selectedIrisIds: s.selectedIrisIds,
      selectedCommuneIds: s.selectedCommuneIds,
      locationLabel: label,
    }
    const w = window as unknown as { ReactNativeWebView?: { postMessage: (m: string) => void } }
    if (w.ReactNativeWebView) w.ReactNativeWebView.postMessage(JSON.stringify(payload))
  }, [deriveLabel])

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: '#FDF5F2' }}>
      {/* Carte */}
      <div className="flex-1 relative">
        {ready && arrondissements.length > 0 ? (
          <ZoneMap
            center={center}
            zoom={zoom}
            fitBounds={fitBounds}
            arrondissements={arrondissements}
            quartiers={quartiers}
            iris={iris}
            communes={communes}
            selectedArrIds={selectedArrIds}
            selectedQuartierIds={selectedQuartierIds}
            selectedIrisIds={selectedIrisIds}
            selectedCommuneIds={selectedCommuneIds}
            irisLoading={irisLoading}
            onClickArr={handleClickArr}
            onClickQuartier={handleClickQuartier}
            onClickIris={handleClickIris}
            onClickCommune={handleClickCommune}
            onClickCommuneIris={handleClickCommuneIris}
            onZoomChange={setZoom}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[13px] text-neutral-500">Préparation de la carte…</p>
          </div>
        )}
      </div>

      {/* Pastilles + Valider */}
      <div
        className="flex-shrink-0 px-4 pt-2"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
      >
        {hasSelection && (
          <div className="flex flex-wrap gap-1.5 mb-3 max-h-[92px] overflow-y-auto">
            {selectedArrIds.map((id) => {
              const z = arrById.get(id)
              return (
                <button
                  key={`arr-${id}`}
                  onClick={() => z && handleClickArr(z)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold border"
                  style={{ backgroundColor: 'rgba(166,75,39,0.14)', color: '#A64B27', borderColor: '#A64B27' }}
                >
                  {z?.shortName || z?.name || id}
                  <span className="opacity-40 ml-0.5 text-[11px]">×</span>
                </button>
              )
            })}
            {selectedCommuneIds.map((id) => {
              const z = communeById.get(id)
              return (
                <button
                  key={`com-${id}`}
                  onClick={() => toggleCommune(id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold border"
                  style={{ backgroundColor: 'rgba(166,75,39,0.14)', color: '#A64B27', borderColor: '#A64B27' }}
                >
                  {z?.shortName || z?.name || id}
                  <span className="opacity-40 ml-0.5 text-[11px]">×</span>
                </button>
              )
            })}
            {partialArrIds.map((id) => {
              const z = arrById.get(id)
              return (
                <button
                  key={`parr-${id}`}
                  onClick={() => removePartialArr(id)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold border"
                  style={{ backgroundColor: '#fff', color: '#A64B27', borderColor: '#A64B27', borderStyle: 'dashed' }}
                >
                  {(z?.shortName || z?.name || id)}
                  <span className="opacity-55 text-[9px]">secteur</span>
                  <span className="opacity-40 ml-0.5 text-[11px]">×</span>
                </button>
              )
            })}
          </div>
        )}

        <button
          onClick={handleValidate}
          disabled={!hasSelection}
          className="w-full py-3.5 rounded-2xl font-semibold text-[15px] text-white transition-opacity active:opacity-90"
          style={{ backgroundColor: hasSelection ? '#A64B27' : '#DB947E' }}
        >
          Valider ma zone
        </button>
      </div>
    </div>
  )
}
