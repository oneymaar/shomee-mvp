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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useSearchStore } from '@/lib/searchStore'
import {
  fetchParisGeoData,
  fetchParisIris,
  fetchSuburbanCommunes,
  getChildQuartiers,
  type GeoZone,
} from '@shomee/core/geo/geoDataService'
import {
  resolveConstraints,
  type GeoConstraint,
  type EntityGroup,
} from '@shomee/core/geo/geoConstraintService'

const ZoneMap = dynamic(() => import('@/components/onboarding/ZoneMap'), { ssr: false })

const PARIS_CENTER: [number, number] = [48.8566, 2.3522]

interface InitialSel {
  arrIds: string[]
  quartierIds: string[]
  irisIds: string[]
  communeIds: string[]
  label: string
  /** Contraintes nommées (compactes) — pour dériver entityGroups localement. */
  geoConstraints: GeoConstraint[]
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
      geoConstraints: Array.isArray(o.geoConstraints) ? (o.geoConstraints as GeoConstraint[]) : [],
    }
  } catch {
    return { arrIds: [], quartierIds: [], irisIds: [], communeIds: [], label: '', geoConstraints: [] }
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
  const [fitNonce, setFitNonce] = useState(0)

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
        const ir = await fetchParisIris(qus, coms)
        if (cancelled) return
        setIris(ir)
        setIrisLoading(false)
      } catch {
        if (!cancelled) setIrisLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // fitBounds calculé sur la sélection INITIALE (stable), PAS sur la sélection
  // live → la carte ne se re-cadre pas à chaque tap.
  // PRIORITÉ aux polygones des IRIS RÉELLEMENT sélectionnés → cadrage serré sur
  // les poches (padding [28,28] + maxZoom 15 appliqués par ZoneMap). Poches
  // disjointes (Daumesnil + Nation) → l'union englobe les deux avec de l'air.
  // Fallback (aucun IRIS, ou géométrie IRIS pas encore chargée) : zones parentes
  // disponibles — remplacé par le cadrage serré dès que les IRIS arrivent.
  const fitBounds = useMemo<Bounds | null>(() => {
    const byId = (list: GeoZone[], ids: string[]) => list.filter((z) => ids.includes(z.id))
    const selIris = byId(iris, initial.irisIds)
    if (selIris.length > 0) return boundsOfFeatures(selIris)
    // Fallback tant que les IRIS chargent (~2 Mo) : quartiers/communes sélectionnés
    // (petits → ≈ l'emprise réelle). PAS les arrondissements : leurs polygones
    // entiers (ex. arr-11) élargiraient la bbox et donneraient un cadrage large,
    // visible pendant les quelques secondes de chargement IRIS.
    const fine = [
      ...byId(quartiers, initial.quartierIds),
      ...byId(communes, initial.communeIds),
    ]
    if (fine.length > 0) return boundsOfFeatures(fine)
    const arrs = byId(arrondissements, initial.arrIds)
    return arrs.length > 0 ? boundsOfFeatures(arrs) : null
  }, [iris, quartiers, communes, arrondissements, initial])

  const center = useMemo<[number, number]>(() => {
    if (fitBounds) {
      return [(fitBounds[0][0] + fitBounds[1][0]) / 2, (fitBounds[0][1] + fitBounds[1][1]) / 2]
    }
    return PARIS_CENTER
  }, [fitBounds])

  // Cadrage « nudgé » : epsilon piloté par fitNonce → force ZoneMap à re-cadrer au Reset.
  const fitBoundsNudged = useMemo<Bounds | null>(() => {
    if (!fitBounds) return null
    const eps = (fitNonce % 2) * 0.00003
    return [[fitBounds[0][0] + eps, fitBounds[0][1]], [fitBounds[1][0], fitBounds[1][1]]]
  }, [fitBounds, fitNonce])

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

  // ── Couverture réelle (sélection D'AFFICHAGE) ───────────────────────────────
  // `deriveParents` (résolution native) place l'ARR entier dans selectedArrIds dès
  // qu'UN SEUL de ses IRIS est pris → `computeArrState` (qui teste
  // `selectedArrIds.includes` en premier) renverrait 'selected' (plein) pour une
  // simple poche. On recalcule donc une sélection d'affichage : un arr / quartier /
  // commune n'est « plein » que si TOUS ses IRIS sont pris ; sinon il tombe en
  // 'partial' (pointillé sans remplissage). Le STORE garde la sélection brute (arr
  // inclus) pour le postMessage + le filtre feed arr-granulaire — on ne touche NI
  // `computeArrState`, NI la résolution, NI le feed.
  const coverage = useMemo(() => {
    const selIris = new Set(selectedIrisIds)
    const irisByQuartier = new Map<string, string[]>()
    const irisByCommune = new Map<string, string[]>()
    for (const i of iris) {
      const p = i.parentId
      if (!p) continue
      const bucket = p.startsWith('com-') ? irisByCommune : p.startsWith('qu-') ? irisByQuartier : null
      if (!bucket) continue
      const arr = bucket.get(p)
      if (arr) arr.push(i.id)
      else bucket.set(p, [i.id])
    }
    const fullQuartierIds = new Set<string>()
    for (const [qid, ids] of irisByQuartier) {
      if (ids.length > 0 && ids.every((x) => selIris.has(x))) fullQuartierIds.add(qid)
    }
    const quartiersByArr = new Map<string, string[]>()
    for (const q of quartiers) {
      const a = q.parentId
      if (!a) continue
      const arr = quartiersByArr.get(a)
      if (arr) arr.push(q.id)
      else quartiersByArr.set(a, [q.id])
    }
    const fullArrIds = new Set<string>()
    for (const [aid, qids] of quartiersByArr) {
      if (qids.length > 0 && qids.every((q) => fullQuartierIds.has(q))) fullArrIds.add(aid)
    }
    const fullCommuneIds = new Set<string>()
    for (const [cid, ids] of irisByCommune) {
      if (ids.length > 0 && ids.every((x) => selIris.has(x))) fullCommuneIds.add(cid)
    }
    // Arrs « touchés » (≥1 IRIS pris) mais pas pleins → partiels (pointillé).
    const touchedArr = new Set<string>()
    const touchedCommune = new Set<string>()
    for (const iid of selectedIrisIds) {
      const p = irisById.get(iid)?.parentId
      if (!p) continue
      if (p.startsWith('com-')) {
        touchedCommune.add(p)
      } else {
        const aId = p.startsWith('qu-') ? quartierById.get(p)?.parentId : p
        if (aId) touchedArr.add(aId)
      }
    }
    const partialArrIds = [...touchedArr].filter((a) => !fullArrIds.has(a))
    const partialCommuneIds = [...touchedCommune].filter((c) => !fullCommuneIds.has(c))
    return { fullArrIds, fullQuartierIds, fullCommuneIds, partialArrIds, partialCommuneIds }
  }, [iris, quartiers, selectedIrisIds, irisById, quartierById])

  const displayArrIds = useMemo(() => [...coverage.fullArrIds], [coverage])
  const displayQuartierIds = useMemo(() => [...coverage.fullQuartierIds], [coverage])
  const displayCommuneIds = useMemo(() => [...coverage.fullCommuneIds], [coverage])
  const partialArrIds = coverage.partialArrIds
  const partialCommuneIds = coverage.partialCommuneIds

  const removePartialArr = useCallback((arrId: string) => {
    const childQ = getChildQuartiers(arrId, quartiers).map((q) => q.id)
    const childI = iris.filter((i) => childQ.includes(i.parentId ?? '')).map((i) => i.id)
    useSearchStore.setState((s) => ({
      selectedQuartierIds: s.selectedQuartierIds.filter((q) => !childQ.includes(q)),
      selectedIrisIds: s.selectedIrisIds.filter((i) => !childI.includes(i)),
    }))
  }, [iris, quartiers])

  const removePartialCommune = useCallback((comId: string) => {
    const childI = iris.filter((i) => i.parentId === comId).map((i) => i.id)
    useSearchStore.setState((s) => ({
      selectedCommuneIds: s.selectedCommuneIds.filter((c) => c !== comId),
      selectedIrisIds: s.selectedIrisIds.filter((i) => !childI.includes(i)),
    }))
  }, [iris])

  // ── Niveau 2 : quartiers vécus cités (Daumesnil, Nation, métro…) ─────────────
  // On ré-exécute le MÊME `resolveConstraints` que le natif, sur les MÊMES données
  // géo, pour récupérer son `entityGroups` (label→IRIS par entité). Sert UNIQUEMENT
  // aux pastilles niveau 2 : le seeding de la sélection reste celui du natif (à plat).
  // Les IRIS de chaque groupe sont intersectés avec la sélection INITIALE → chaque
  // entité démarre « pleine », robuste à tout écart de résolution.
  // On EXCLUT les groupes administratifs : le niveau 1 (arr/communes) est dérivé de
  // `coverage`, pas d'entityGroups. Les garder ici casserait le retrait niveau 2 (le
  // groupe admin « Paris 12 » protégerait les IRIS de « Daumesnil » qu'il recouvre).
  const entityGroups = useMemo<EntityGroup[]>(() => {
    if (irisLoading || iris.length === 0 || initial.geoConstraints.length === 0) return []
    try {
      const res = resolveConstraints(initial.geoConstraints, iris, quartiers, communes)
      const initSel = new Set(initial.irisIds)
      return (res.entityGroups ?? [])
        .filter((g) => g.type !== 'administrative_area')
        .map((g) => ({ ...g, irisIds: g.irisIds.filter((id) => initSel.has(id)) }))
        .filter((g) => g.irisIds.length > 0)
    } catch {
      return []
    }
  }, [irisLoading, iris, quartiers, communes, initial.geoConstraints, initial.irisIds])

  // État plein/partiel par entité vécue.
  const livedTags = useMemo(() => {
    const selSet = new Set(selectedIrisIds)
    const out: { group: EntityGroup; state: 'full' | 'partial' }[] = []
    for (const g of entityGroups) {
      const total = g.irisIds.length
      const selected = g.irisIds.reduce((n, id) => n + (selSet.has(id) ? 1 : 0), 0)
      if (selected === 0) continue // entité entièrement désélectionnée → disparaît
      out.push({ group: g, state: selected >= total ? 'full' : 'partial' })
    }
    return out
  }, [entityGroups, selectedIrisIds])

  // Recompose arr/quartier/commune depuis une liste d'IRIS (miroir de deriveParents
  // du handoff) — garde la sélection parente cohérente après un retrait d'entité,
  // donc le feed (arr-granulaire) reste aligné sur les IRIS restants.
  const deriveParents = useCallback((irisIds: string[]) => {
    const arrIds = new Set<string>()
    const quartierIds = new Set<string>()
    const communeIds = new Set<string>()
    for (const id of irisIds) {
      const p = irisById.get(id)?.parentId
      if (!p) continue
      if (p.startsWith('qu-')) {
        quartierIds.add(p)
        const q = quartierById.get(p)
        if (q?.parentId) arrIds.add(q.parentId)
      } else if (p.startsWith('arr-')) {
        arrIds.add(p)
      } else if (p.startsWith('com-')) {
        communeIds.add(p)
      }
    }
    return { arrIds: [...arrIds], quartierIds: [...quartierIds], communeIds: [...communeIds] }
  }, [irisById, quartierById])

  // Retrait d'une entité vécue : on soustrait ses IRIS de la sélection SAUF ceux
  // partagés avec une autre entité encore présente (chevauchement), puis on recompose
  // les parents. On NE relance PAS le moteur.
  const removeLivedEntity = useCallback((group: EntityGroup) => {
    const selSet = new Set(selectedIrisIds)
    const protectedIris = new Set<string>()
    for (const g of entityGroups) {
      if (g === group) continue
      if (g.irisIds.some((id) => selSet.has(id))) {
        for (const id of g.irisIds) protectedIris.add(id)
      }
    }
    const toRemove = new Set(group.irisIds.filter((id) => !protectedIris.has(id)))
    if (toRemove.size === 0) return
    const newIris = selectedIrisIds.filter((id) => !toRemove.has(id))
    const parents = deriveParents(newIris)
    useSearchStore.setState({
      selectedIrisIds: newIris,
      selectedArrIds: parents.arrIds,
      selectedQuartierIds: parents.quartierIds,
      selectedCommuneIds: parents.communeIds,
    })
  }, [entityGroups, selectedIrisIds, deriveParents])

  const hasSelection =
    selectedArrIds.length > 0 || selectedCommuneIds.length > 0 ||
    selectedQuartierIds.length > 0 || selectedIrisIds.length > 0

  // Libellé : on garde le libellé sémantique initial (« Daumesnil ») quand il
  // existe — cohérence du titre (verif #5). Sinon on dérive des zones affichées.
  const deriveLabel = useCallback(() => {
    if (initial.label) return initial.label
    const parts: string[] = []
    for (const id of displayArrIds) { const z = arrById.get(id); if (z) parts.push(z.shortName || z.name) }
    for (const id of displayCommuneIds) { const z = communeById.get(id); if (z) parts.push(z.shortName || z.name) }
    for (const id of partialArrIds) { const z = arrById.get(id); if (z) parts.push(`${z.shortName || z.name} (secteur)`) }
    return parts.join(' · ')
  }, [initial.label, displayArrIds, displayCommuneIds, partialArrIds, arrById, communeById])

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

  // ── Modifier : renvoie le natif au moment 1 (édition texte). ────────────────
  const handleModifier = useCallback(() => {
    const w = window as unknown as { ReactNativeWebView?: { postMessage: (m: string) => void } }
    if (w.ReactNativeWebView) w.ReactNativeWebView.postMessage(JSON.stringify({ action: 'edit' }))
  }, [])

  // ── Sélection déviée de la livraison initiale ? (affiche le Reset) ───────────
  const selectionDirty = useMemo(() => {
    const norm = (a: string[]) => [...a].sort().join(',')
    return (
      norm(selectedIrisIds) !== norm(initial.irisIds) ||
      norm(selectedArrIds) !== norm(initial.arrIds) ||
      norm(selectedQuartierIds) !== norm(initial.quartierIds) ||
      norm(selectedCommuneIds) !== norm(initial.communeIds)
    )
  }, [selectedIrisIds, selectedArrIds, selectedQuartierIds, selectedCommuneIds, initial])

  // ── Reset : restaure la sélection d'origine + recentre. ─────────────────────
  const resetSelection = useCallback(() => {
    useSearchStore.setState({
      selectedArrIds: initial.arrIds,
      selectedQuartierIds: initial.quartierIds,
      selectedIrisIds: initial.irisIds,
      selectedCommuneIds: initial.communeIds,
    })
    setFitNonce((n) => n + 1)
  }, [initial])

  // ── Indice de zoom (pincement) : à l'arrivée si zoom < 15, jusqu'à la 1re interaction. ─
  const [hintMounted, setHintMounted] = useState(false)
  const [hintVisible, setHintVisible] = useState(false)
  const zoomLiveRef = useRef(zoom)
  useEffect(() => { zoomLiveRef.current = zoom }, [zoom])
  const hintDoneRef = useRef(false)
  useEffect(() => {
    if (irisLoading || hintDoneRef.current) return
    const t = setTimeout(() => {
      hintDoneRef.current = true
      if (zoomLiveRef.current >= 15) return
      setHintMounted(true)
      requestAnimationFrame(() => setHintVisible(true))
    }, 1000)
    return () => clearTimeout(t)
  }, [irisLoading])
  const dismissHint = useCallback(() => {
    setHintVisible(false)
    setTimeout(() => setHintMounted(false), 340)
  }, [])
  useEffect(() => {
    if (zoom >= 15 && hintMounted) dismissHint()
  }, [zoom, hintMounted, dismissHint])

  return (
    <div className="fixed inset-0 flex flex-col" style={{ background: '#FDF5F2' }}>
      {/* Carte — on ATTEND le chargement des IRIS avant de monter ZoneMap : ainsi
          le premier (et unique) fitBounds au montage se fait sur l'union des IRIS
          réellement sélectionnés → cadrage serré fiable, sans dépendre d'un re-fit
          ultérieur ni du fallback arr/quartier. */}
      <div
        className="flex-1 relative"
        onPointerDownCapture={dismissHint}
        onTouchStartCapture={dismissHint}
        onWheelCapture={dismissHint}
      >
        {!irisLoading && arrondissements.length > 0 ? (
          <ZoneMap
            center={center}
            zoom={zoom}
            fitBounds={fitBoundsNudged}
            arrondissements={arrondissements}
            quartiers={quartiers}
            iris={iris}
            communes={communes}
            selectedArrIds={displayArrIds}
            selectedQuartierIds={displayQuartierIds}
            selectedIrisIds={selectedIrisIds}
            selectedCommuneIds={displayCommuneIds}
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

        {/* Indice de zoom (pincement) — persiste jusqu'à la 1re interaction. */}
        {hintMounted && (
          <div className="absolute inset-0 z-[1100] flex flex-col items-center justify-center pointer-events-none"
               style={{ opacity: hintVisible ? 1 : 0, transition: 'opacity 320ms ease' }}>
            <style>{`
              @keyframes shomeePinchA { 0%,12%{transform:translate(-8px,8px) scale(1)} 55%,70%{transform:translate(-21px,21px) scale(1.06)} 100%{transform:translate(-8px,8px) scale(1)} }
              @keyframes shomeePinchB { 0%,12%{transform:translate(8px,-8px) scale(1)} 55%,70%{transform:translate(21px,-21px) scale(1.06)} 100%{transform:translate(8px,-8px) scale(1)} }
              @keyframes shomeePinchRing { 0%,12%{transform:scale(0.55);opacity:0} 45%{opacity:0.45} 70%{transform:scale(1);opacity:0.25} 100%{transform:scale(0.55);opacity:0} }
            `}</style>
            <div style={{ width: 96, height: 96, borderRadius: 48, position: 'relative', background: 'rgba(28,25,23,0.72)', backdropFilter: 'blur(4px)' }}>
              <div style={{ position: 'absolute', left: '50%', top: '50%', width: 64, height: 64, marginLeft: -32, marginTop: -32, borderRadius: 32, border: '2px solid rgba(255,255,255,0.9)', animation: 'shomeePinchRing 1.7s ease-in-out infinite' }} />
              <div style={{ position: 'absolute', left: '50%', top: '50%', width: 15, height: 15, marginLeft: -7.5, marginTop: -7.5, borderRadius: 8, background: '#fff', boxShadow: '0 0 0 3px rgba(255,255,255,0.28)', animation: 'shomeePinchA 1.7s ease-in-out infinite' }} />
              <div style={{ position: 'absolute', left: '50%', top: '50%', width: 15, height: 15, marginLeft: -7.5, marginTop: -7.5, borderRadius: 8, background: '#fff', boxShadow: '0 0 0 3px rgba(255,255,255,0.28)', animation: 'shomeePinchB 1.7s ease-in-out infinite' }} />
            </div>
            <div className="mt-3 px-4 py-2 rounded-full text-[13px] font-semibold text-white text-center"
                 style={{ background: 'rgba(28,25,23,0.78)', backdropFilter: 'blur(4px)', maxWidth: 280 }}>
              Zoomez pour sélectionner des quartiers précis
            </div>
          </div>
        )}

        {/* Encart flottant : zone recherchée + Modifier (retour au moment 1). */}
        <div className="absolute top-0 left-0 right-0 z-[1100] px-4" style={{ paddingTop: 'max(env(safe-area-inset-top), 12px)' }}>
          <button onClick={handleModifier}
                  className="w-full flex items-center gap-2.5 bg-white border border-black/8 rounded-2xl px-3.5 py-2.5 shadow-sm active:bg-black/[0.02]">
            <span className="flex-1 min-w-0 text-left text-[13.5px] font-semibold text-neutral-900 truncate">
              {initial.label || deriveLabel() || 'Votre zone'}
            </span>
            <span className="flex-none inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: '#A64B27' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
              Modifier
            </span>
          </button>
        </div>
      </div>

      {/* Pastilles + Valider */}
      <div
        className="flex-shrink-0 px-4 pt-2"
        style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 16px)' }}
      >
        {hasSelection && (
          <div className="mb-3 flex items-start gap-2">
            <div className="flex-1 min-w-0 max-h-[124px] overflow-y-auto">
            {/* Ligne 1 — arrondissements / communes (plein si entier, pointillé si partiel) */}
            <div className="flex flex-wrap gap-1.5">
              {displayArrIds.map((id) => {
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
              {displayCommuneIds.map((id) => {
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
                    style={{ backgroundColor: 'rgba(166,75,39,0.07)', color: '#A64B27', borderColor: 'rgba(166,75,39,0.45)', borderStyle: 'dashed' }}
                  >
                    {(z?.shortName || z?.name || id)}
                    <span className="opacity-55 ml-0.5 text-[11px]">~</span>
                    <span className="opacity-40 ml-0.5 text-[11px]">×</span>
                  </button>
                )
              })}
              {partialCommuneIds.map((id) => {
                const z = communeById.get(id)
                return (
                  <button
                    key={`pcom-${id}`}
                    onClick={() => removePartialCommune(id)}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold border"
                    style={{ backgroundColor: 'rgba(166,75,39,0.07)', color: '#A64B27', borderColor: 'rgba(166,75,39,0.45)', borderStyle: 'dashed' }}
                  >
                    {z?.shortName || z?.name || id}
                    <span className="opacity-55 ml-0.5 text-[11px]">~</span>
                    <span className="opacity-40 ml-0.5 text-[11px]">×</span>
                  </button>
                )
              })}
            </div>

            {/* Ligne 2 — quartiers vécus cités (Daumesnil, Nation, métro…), un peu plus petites */}
            {livedTags.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1.5">
                {livedTags.map(({ group, state }, idx) => {
                  const isFull = state === 'full'
                  const isStation = group.type === 'transport_station'
                  return (
                    <button
                      key={`lived-${group.type}-${group.label}-${idx}`}
                      onClick={() => removeLivedEntity(group)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border"
                      style={{
                        backgroundColor: isFull ? 'rgba(166,75,39,0.14)' : 'rgba(166,75,39,0.07)',
                        color: '#A64B27',
                        borderColor: isFull ? '#A64B27' : 'rgba(166,75,39,0.45)',
                        borderStyle: isFull ? 'solid' : 'dashed',
                      }}
                    >
                      {isStation && (
                        <span
                          className="inline-flex items-center justify-center rounded-full text-[8px] font-bold leading-none"
                          style={{
                            width: 13, height: 13,
                            backgroundColor: isFull ? '#A64B27' : 'transparent',
                            color: isFull ? '#fff' : '#A64B27',
                            border: `1px solid ${isFull ? '#A64B27' : 'rgba(166,75,39,0.45)'}`,
                          }}
                        >
                          M
                        </span>
                      )}
                      {group.label}
                      {!isFull && <span className="opacity-55 ml-0.5 text-[10px]">~</span>}
                      <span className="opacity-40 ml-0.5 text-[10px]">×</span>
                    </button>
                  )
                })}
              </div>
            )}
            </div>
            {selectionDirty && (
              <button onClick={resetSelection} aria-label="Réinitialiser la sélection"
                className="flex-none w-8 h-8 rounded-full bg-white border flex items-center justify-center active:opacity-80 mt-0.5"
                style={{ borderColor: 'rgba(166,75,39,0.35)', color: '#A64B27' }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" /></svg>
              </button>
            )}
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
