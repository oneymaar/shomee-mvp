'use client'

/**
 * PROTOTYPE — écran Quartiers « deux moments » (jetable, banc d'essai d'agencement).
 *
 * Route: /proto/quartiers. NE MODIFIE aucun fichier protégé. Réutilise ZoneMap
 * et les fonctions core telles quelles ; COPIE (n'importe pas depuis) la logique
 * des pastilles 2 niveaux de ZoneMapEmbedClient, en la branchant sur un ÉTAT LOCAL
 * (pas de useSearchStore → aucun effet de bord sur l'onboarding réel / la persistance).
 *
 * Chaîne de données 100 % client (pas d'appel à /api/location/analyze) :
 *   query → parseSpatialIntent → intentToGeoConstraints → resolveConstraints(iris,…)
 *         → { irisIds, entityGroups } → sélection à plat + parents (deriveParents).
 *
 * Hors scope (assumé) : résolveur LLM/ambiance, POI « Phase 3 », WebView, store persistant.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { parseSpatialIntent } from '@shomee/core/parsing/spatialIntentParser'
import { intentToGeoConstraints } from '@shomee/core/parsing/spatialIntentToGeoConstraints'
import {
  resolveConstraints,
  type EntityGroup,
} from '@shomee/core/geo/geoConstraintService'
import {
  fetchParisGeoData,
  fetchParisIris,
  fetchSuburbanCommunes,
  getChildQuartiers,
  type GeoZone,
} from '@shomee/core/geo/geoDataService'

const ZoneMap = dynamic(() => import('@/components/onboarding/ZoneMap'), { ssr: false })

const TERRA = '#A64B27'
const PARIS_CENTER: [number, number] = [48.8566, 2.3522]

// ─── Pictos pastilles — `currentColor` : ils prennent la couleur du texte de
//     la pastille (terracotta sur les reconnues, gris sur les neutres). ───────
function PinIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z" /><circle cx="12" cy="10" r="3" />
    </svg>
  )
}
/** Transport = « M » en cercle, comme les marqueurs métro de la carte. */
function StationIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" strokeWidth="2" />
      <path d="M7.5 16.5V8.2l4.5 5.4 4.5-5.4v8.3" strokeWidth="2.1" />
    </svg>
  )
}

// ─── Bounds d'un ensemble de features (copie de l'embed) ──────────────────────
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
    for (const ring of rings) for (const pt of ring) {
      const lng = pt[0], lat = pt[1]
      if (lat < minLat) minLat = lat
      if (lat > maxLat) maxLat = lat
      if (lng < minLng) minLng = lng
      if (lng > maxLng) maxLng = lng
      found = true
    }
  }
  if (!found) return null
  return [[minLat, minLng], [maxLat, maxLng]]
}

interface Sel { arr: string[]; q: string[]; iris: string[]; com: string[] }
const EMPTY_SEL: Sel = { arr: [], q: [], iris: [], com: [] }

type LiveChip = {
  label: string
  icon: 'pin' | 'station' | null
  variant: 'zone' | 'place' | 'excl' | 'rel' | 'unknown'
}

export default function ProtoQuartiersClient() {
  // ── Phase : moment 1 (saisie) / moment 2 (carte) ──────────────────────────
  const [phase, setPhase] = useState<'typing' | 'map'>('typing')
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // ── Géométries (chargées en arrière-plan dès le montage) ──────────────────
  const [arrondissements, setArrondissements] = useState<GeoZone[]>([])
  const [quartiers, setQuartiers] = useState<GeoZone[]>([])
  const [iris, setIris] = useState<GeoZone[]>([])
  const [communes, setCommunes] = useState<GeoZone[]>([])
  const [irisLoading, setIrisLoading] = useState(true)
  const [zoom, setZoom] = useState(12)

  // ── Sélection (ÉTAT LOCAL — jamais le store partagé) ──────────────────────
  const [sel, setSel] = useState<Sel>(EMPTY_SEL)
  const [initialIris, setInitialIris] = useState<string[]>([])
  const [entityGroups, setEntityGroups] = useState<EntityGroup[]>([])
  const [matchSummary, setMatchSummary] = useState<string[]>([])

  // ── Chargement géo (mêmes sources que LocationMapStep / embed) ────────────
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [{ arrondissements: arrs, quartiers: qus }, coms] = await Promise.all([
          fetchParisGeoData(),
          fetchSuburbanCommunes(),
        ])
        if (cancelled) return
        setArrondissements(arrs); setQuartiers(qus); setCommunes(coms)
        const ir = await fetchParisIris(qus, coms)
        if (cancelled) return
        setIris(ir); setIrisLoading(false)
      } catch { if (!cancelled) setIrisLoading(false) }
    })()
    return () => { cancelled = true }
  }, [])

  // Focus le champ au montage (moment 1).
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 300)
    return () => clearTimeout(t)
  }, [])

  // ── Index par id ──────────────────────────────────────────────────────────
  const arrById = useMemo(() => new Map(arrondissements.map((a) => [a.id, a])), [arrondissements])
  const communeById = useMemo(() => new Map(communes.map((c) => [c.id, c])), [communes])
  const quartierById = useMemo(() => new Map(quartiers.map((q) => [q.id, q])), [quartiers])
  const irisById = useMemo(() => new Map(iris.map((i) => [i.id, i])), [iris])

  // Recompose arr/quartier/commune depuis une liste d'IRIS (miroir de deriveParents).
  const deriveParents = useCallback((irisIds: string[]) => {
    const arr = new Set<string>(), q = new Set<string>(), com = new Set<string>()
    for (const id of irisIds) {
      const p = irisById.get(id)?.parentId
      if (!p) continue
      if (p.startsWith('qu-')) { q.add(p); const qq = quartierById.get(p); if (qq?.parentId) arr.add(qq.parentId) }
      else if (p.startsWith('arr-')) arr.add(p)
      else if (p.startsWith('com-')) com.add(p)
    }
    return { arr: [...arr], q: [...q], com: [...com] }
  }, [irisById, quartierById])

  // ══ MOMENT 1 — pastilles reconnues EN DIRECT (déterministe, sans libellé) ══
  // Tout ce que le parser comprend s'affiche : zones (sans picto), quartiers/POI
  // (pin gris), stations & lignes (picto station gris), EXCLUSIONS (« sans X »,
  // neutre), relations géo (« ~ Seine »), et entités NON COMPRISES (« ? », gris
  // pointillé — feedback honnête = ce qui partirait au LLM).
  const [liveChips, setLiveChips] = useState<LiveChip[]>([])
  useEffect(() => {
    const t = setTimeout(() => {
      const q = query.trim()
      if (q.length < 2) { setLiveChips([]); return }
      try {
        const intent = parseSpatialIntent(q)
        const seen = new Set<string>()
        const chips: LiveChip[] = []
        const push = (c: LiveChip) => {
          const key = `${c.variant}|${c.label}`
          if (seen.has(key)) return
          seen.add(key)
          chips.push(c)
        }
        for (const e of intent.primaryEntities) {
          const label = e.label ?? e.rawText
          if (e.type === 'unknown') {
            // Fragment non compris : pastille « ? » (pas de fantôme silencieux).
            if (label.trim().length >= 3) push({ label: label.trim(), icon: null, variant: 'unknown' })
            continue
          }
          const icon: LiveChip['icon'] =
            e.type === 'transport_station' || e.type === 'transport_line' ? 'station'
            : e.type === 'city' || e.type === 'district' ? null // arr/communes → aucun picto
            : 'pin' // quartier / poi / street → pin
          push({ label, icon, variant: e.type === 'city' || e.type === 'district' ? 'zone' : 'place' })
        }
        for (const r of intent.spatialRelations) {
          // edge_of porte une cible géo (Seine, bois…) absente des entités.
          if (r.type === 'edge_of' && r.targetText) push({ label: r.targetText, icon: 'pin', variant: 'rel' })
        }
        for (const e of intent.exclusions) {
          const label = e.label ?? e.rawText
          if (e.type === 'unknown') push({ label: label.trim(), icon: null, variant: 'unknown' })
          else push({ label, icon: null, variant: 'excl' })
        }
        setLiveChips(chips)
      } catch { setLiveChips([]) }
    }, 280)
    return () => clearTimeout(t)
  }, [query])

  // ── Résolution (au submit ou dès que les IRIS arrivent si submit anticipé) ─
  const [queryToResolve, setQueryToResolve] = useState<string | null>(null)
  const resolvedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!queryToResolve || iris.length === 0) return
    if (resolvedRef.current === queryToResolve) return
    resolvedRef.current = queryToResolve
    try {
      const intent = parseSpatialIntent(queryToResolve)
      const gc = intentToGeoConstraints(intent)
      if (gc.length === 0) {
        setInitialIris([]); setEntityGroups([]); setMatchSummary([]); setSel(EMPTY_SEL)
        return
      }
      // Le moteur gère désormais nativement l'union des zones admin DISJOINTES
      // (portage Phase 6 dans resolveConstraints, avec OK explicite) — le
      // contournement proto a été retiré : appel direct, le proto teste le vrai
      // comportement moteur.
      const res = resolveConstraints(gc, iris, quartiers, communes)
      const irisIds: string[] = res.irisIds ?? []
      const groupsRaw: EntityGroup[] = res.entityGroups ?? []
      const summary: string[] = res.matchSummary ?? []

      const initSet = new Set(irisIds)
      const groups = groupsRaw
        .filter((g) => g.type !== 'administrative_area')
        .map((g) => ({ ...g, irisIds: g.irisIds.filter((id) => initSet.has(id)) }))
        .filter((g) => g.irisIds.length > 0)
      const parents = deriveParents(irisIds)
      setInitialIris(irisIds)
      setEntityGroups(groups)
      setMatchSummary(summary)
      setSel({ iris: irisIds, arr: parents.arr, q: parents.q, com: parents.com })
    } catch {
      setInitialIris([]); setEntityGroups([]); setMatchSummary([]); setSel(EMPTY_SEL)
    }
  }, [queryToResolve, iris, quartiers, communes, deriveParents])

  const handleToMap = useCallback(() => {
    const q = query.trim()
    if (q.length < 2) return
    inputRef.current?.blur() // ferme le clavier
    setQueryToResolve(q)     // résolution instantanée si IRIS déjà chargés, sinon via l'effet
    setPhase('map')
  }, [query])

  const handleModifier = useCallback(() => {
    setPhase('typing')
    setTimeout(() => inputRef.current?.focus(), 120)
  }, [])

  // Reset : revient à la sélection d'ORIGINE (celle issue de la résolution),
  // en recomposant les parents — sans relancer le moteur.
  const resetSelection = useCallback(() => {
    const parents = deriveParents(initialIris)
    setSel({ iris: initialIris, arr: parents.arr, q: parents.q, com: parents.com })
  }, [initialIris, deriveParents])

  // ══ MOMENT 2 — toggles carte (répliques fidèles du searchStore, état local) ══
  const toggleArr = useCallback((id: string, childQ: string[], childI: string[]) => {
    setSel((s) => s.arr.includes(id)
      ? { ...s, arr: s.arr.filter((a) => a !== id), q: s.q.filter((x) => !childQ.includes(x)), iris: s.iris.filter((x) => !childI.includes(x)) }
      : { ...s, arr: [...s.arr, id], q: [...new Set([...s.q, ...childQ])], iris: [...new Set([...s.iris, ...childI])] })
  }, [])

  const toggleQuartier = useCallback((id: string, parentArrId: string, allSiblingIds: string[], childI: string[]) => {
    setSel((s) => {
      const isSel = s.q.includes(id)
      const q = isSel ? s.q.filter((x) => x !== id) : [...s.q, id]
      const irisN = isSel ? s.iris.filter((x) => !childI.includes(x)) : [...new Set([...s.iris, ...childI])]
      const selSiblings = allSiblingIds.filter((x) => q.includes(x))
      let arr = s.arr
      if (selSiblings.length === 0) arr = arr.filter((a) => a !== parentArrId)
      else if (selSiblings.length === allSiblingIds.length) { if (!arr.includes(parentArrId)) arr = [...arr, parentArrId] }
      else arr = arr.filter((a) => a !== parentArrId)
      return { ...s, arr, q, iris: irisN }
    })
  }, [])

  const toggleIris = useCallback((id: string, parentQ: string, parentArrId: string, allQSiblings: string[], allArrQ: string[]) => {
    setSel((s) => {
      const isSel = s.iris.includes(id)
      const irisN = isSel ? s.iris.filter((x) => x !== id) : [...s.iris, id]
      const selQSiblings = allQSiblings.filter((x) => irisN.includes(x))
      let q = s.q
      if (selQSiblings.length === 0) q = q.filter((x) => x !== parentQ)
      else if (selQSiblings.length === allQSiblings.length) { if (!q.includes(parentQ)) q = [...q, parentQ] }
      else q = q.filter((x) => x !== parentQ)
      const selArrQ = allArrQ.filter((x) => q.includes(x))
      let arr = s.arr
      if (selArrQ.length === 0) arr = arr.filter((a) => a !== parentArrId)
      else if (selArrQ.length === allArrQ.length) { if (!arr.includes(parentArrId)) arr = [...arr, parentArrId] }
      else arr = arr.filter((a) => a !== parentArrId)
      return { ...s, arr, q, iris: irisN }
    })
  }, [])

  const toggleCommune = useCallback((id: string) => {
    setSel((s) => ({ ...s, com: s.com.includes(id) ? s.com.filter((c) => c !== id) : [...s.com, id] }))
  }, [])

  const toggleCommuneIris = useCallback((id: string, parentCom: string, allSiblings: string[]) => {
    setSel((s) => {
      const isSel = s.iris.includes(id)
      const irisN = isSel ? s.iris.filter((x) => x !== id) : [...s.iris, id]
      const selSiblings = allSiblings.filter((x) => irisN.includes(x))
      let com = s.com
      if (selSiblings.length === 0) com = com.filter((c) => c !== parentCom)
      else if (selSiblings.length === allSiblings.length) { if (!com.includes(parentCom)) com = [...com, parentCom] }
      else com = com.filter((c) => c !== parentCom)
      return { ...s, com, iris: irisN }
    })
  }, [])

  // Handlers de clic carte (copie de l'embed).
  const handleClickArr = useCallback((zone: GeoZone) => {
    const childQ = getChildQuartiers(zone.id, quartiers).map((q) => q.id)
    const childI = iris.filter((i) => childQ.includes(i.parentId ?? '')).map((i) => i.id)
    toggleArr(zone.id, childQ, childI)
  }, [iris, quartiers, toggleArr])
  const handleClickQuartier = useCallback((zone: GeoZone) => {
    if (!zone.parentId) return
    const siblings = getChildQuartiers(zone.parentId, quartiers).map((q) => q.id)
    const childI = iris.filter((i) => i.parentId === zone.id).map((i) => i.id)
    toggleQuartier(zone.id, zone.parentId, siblings, childI)
  }, [iris, quartiers, toggleQuartier])
  const handleClickIris = useCallback((zone: GeoZone) => {
    if (!zone.parentId) return
    const parentQuartier = quartiers.find((q) => q.id === zone.parentId)
    if (!parentQuartier?.parentId) return
    const parentArrId = parentQuartier.parentId
    const allQSiblings = iris.filter((i) => i.parentId === zone.parentId).map((i) => i.id)
    const allArrQ = getChildQuartiers(parentArrId, quartiers).map((q) => q.id)
    toggleIris(zone.id, zone.parentId, parentArrId, allQSiblings, allArrQ)
  }, [iris, quartiers, toggleIris])
  const handleClickCommune = useCallback((zone: GeoZone) => toggleCommune(zone.id), [toggleCommune])
  const handleClickCommuneIris = useCallback((zone: GeoZone) => {
    if (!zone.parentId) return
    const allSiblings = iris.filter((i) => i.parentId === zone.parentId).map((i) => i.id)
    toggleCommuneIris(zone.id, zone.parentId, allSiblings)
  }, [iris, toggleCommuneIris])

  // ── Couverture réelle (sélection d'AFFICHAGE plein/partiel) — copie embed ──
  const coverage = useMemo(() => {
    const selIris = new Set(sel.iris)
    const irisByQuartier = new Map<string, string[]>()
    const irisByCommune = new Map<string, string[]>()
    for (const i of iris) {
      const p = i.parentId
      if (!p) continue
      const bucket = p.startsWith('com-') ? irisByCommune : p.startsWith('qu-') ? irisByQuartier : null
      if (!bucket) continue
      const arr = bucket.get(p); if (arr) arr.push(i.id); else bucket.set(p, [i.id])
    }
    const fullQuartierIds = new Set<string>()
    for (const [qid, ids] of irisByQuartier) if (ids.length > 0 && ids.every((x) => selIris.has(x))) fullQuartierIds.add(qid)
    const quartiersByArr = new Map<string, string[]>()
    for (const q of quartiers) {
      const a = q.parentId; if (!a) continue
      const arr = quartiersByArr.get(a); if (arr) arr.push(q.id); else quartiersByArr.set(a, [q.id])
    }
    const fullArrIds = new Set<string>()
    for (const [aid, qids] of quartiersByArr) if (qids.length > 0 && qids.every((q) => fullQuartierIds.has(q))) fullArrIds.add(aid)
    const fullCommuneIds = new Set<string>()
    for (const [cid, ids] of irisByCommune) if (ids.length > 0 && ids.every((x) => selIris.has(x))) fullCommuneIds.add(cid)
    const touchedArr = new Set<string>(), touchedCommune = new Set<string>()
    for (const iid of sel.iris) {
      const p = irisById.get(iid)?.parentId; if (!p) continue
      if (p.startsWith('com-')) touchedCommune.add(p)
      else { const aId = p.startsWith('qu-') ? quartierById.get(p)?.parentId : p; if (aId) touchedArr.add(aId) }
    }
    return {
      fullArrIds, fullQuartierIds, fullCommuneIds,
      partialArrIds: [...touchedArr].filter((a) => !fullArrIds.has(a)),
      partialCommuneIds: [...touchedCommune].filter((c) => !fullCommuneIds.has(c)),
    }
  }, [iris, quartiers, sel.iris, irisById, quartierById])

  const displayArrIds = useMemo(() => [...coverage.fullArrIds], [coverage])
  const displayQuartierIds = useMemo(() => [...coverage.fullQuartierIds], [coverage])
  const displayCommuneIds = useMemo(() => [...coverage.fullCommuneIds], [coverage])
  const { partialArrIds, partialCommuneIds } = coverage

  const removePartialArr = useCallback((arrId: string) => {
    const childQ = getChildQuartiers(arrId, quartiers).map((q) => q.id)
    const childI = iris.filter((i) => childQ.includes(i.parentId ?? '')).map((i) => i.id)
    setSel((s) => ({ ...s, q: s.q.filter((q) => !childQ.includes(q)), iris: s.iris.filter((i) => !childI.includes(i)) }))
  }, [iris, quartiers])
  const removePartialCommune = useCallback((comId: string) => {
    const childI = iris.filter((i) => i.parentId === comId).map((i) => i.id)
    setSel((s) => ({ ...s, com: s.com.filter((c) => c !== comId), iris: s.iris.filter((i) => !childI.includes(i)) }))
  }, [iris])

  // ── Niveau 2 : quartiers vécus (entityGroups) — plein/partiel + retrait ────
  const livedTags = useMemo(() => {
    const selSet = new Set(sel.iris)
    const out: { group: EntityGroup; state: 'full' | 'partial' }[] = []
    for (const g of entityGroups) {
      const total = g.irisIds.length
      const selected = g.irisIds.reduce((n, id) => n + (selSet.has(id) ? 1 : 0), 0)
      if (selected === 0) continue
      out.push({ group: g, state: selected >= total ? 'full' : 'partial' })
    }
    return out
  }, [entityGroups, sel.iris])

  const removeLivedEntity = useCallback((group: EntityGroup) => {
    const selSet = new Set(sel.iris)
    const protectedIris = new Set<string>()
    for (const g of entityGroups) {
      if (g === group) continue
      if (g.irisIds.some((id) => selSet.has(id))) for (const id of g.irisIds) protectedIris.add(id)
    }
    const toRemove = new Set(group.irisIds.filter((id) => !protectedIris.has(id)))
    if (toRemove.size === 0) return
    const newIris = sel.iris.filter((id) => !toRemove.has(id))
    const parents = deriveParents(newIris)
    setSel({ iris: newIris, arr: parents.arr, q: parents.q, com: parents.com })
  }, [entityGroups, sel.iris, deriveParents])

  // ── fitBounds : priorité aux polygones des IRIS sélectionnés (copie embed) ─
  const fitBounds = useMemo<Bounds | null>(() => {
    const byId = (list: GeoZone[], ids: string[]) => list.filter((z) => ids.includes(z.id))
    const selIris = byId(iris, initialIris)
    if (selIris.length > 0) return boundsOfFeatures(selIris)
    const fine = [...byId(quartiers, sel.q), ...byId(communes, sel.com)]
    if (fine.length > 0) return boundsOfFeatures(fine)
    const arrs = byId(arrondissements, sel.arr)
    return arrs.length > 0 ? boundsOfFeatures(arrs) : null
  }, [iris, quartiers, communes, arrondissements, initialIris, sel.q, sel.com, sel.arr])

  const center = useMemo<[number, number]>(() => {
    if (fitBounds) return [(fitBounds[0][0] + fitBounds[1][0]) / 2, (fitBounds[0][1] + fitBounds[1][1]) / 2]
    return PARIS_CENTER
  }, [fitBounds])

  const hasSelection = sel.arr.length > 0 || sel.com.length > 0 || sel.q.length > 0 || sel.iris.length > 0
  const canContinue = query.trim().length >= 2
  const headerSummary = matchSummary.length > 0 ? matchSummary.join(' · ') : query.trim()

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div
      className="fixed inset-x-0 top-0 mx-auto flex flex-col overflow-hidden"
      style={{ background: '#FDF5F2', maxWidth: 430, height: '100svh' }}
    >
      {/* ── Carte : montée dès que les géométries sont prêtes, sous l'overlay du
           moment 1 (opaque) → révélée sans reload au passage moment 2. ─────── */}
      <div className="absolute inset-0 z-0">
        {!irisLoading && arrondissements.length > 0 ? (
          <ZoneMap
            center={center}
            zoom={zoom}
            fitBounds={fitBounds}
            arrondissements={arrondissements}
            quartiers={quartiers}
            iris={iris}
            communes={communes}
            selectedArrIds={displayArrIds}
            selectedQuartierIds={displayQuartierIds}
            selectedIrisIds={sel.iris}
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
      </div>

      {/* ═══════════════ MOMENT 2 — chrome par-dessus la carte ═══════════════ */}
      {phase === 'map' && (
        <>
          {/* En-tête FLOTTANT au-dessus de la carte — aucun fade, la carte
              file jusqu'en haut de l'écran. */}
          <div className="absolute top-0 left-0 right-0 z-20 px-4"
               style={{ paddingTop: 'max(env(safe-area-inset-top), 14px)' }}>
            <button onClick={handleModifier}
                    className="w-full flex items-center gap-2.5 bg-white border border-black/8 rounded-2xl px-3.5 py-2.5 shadow-sm active:bg-black/[0.02]">
              <span className="flex-1 min-w-0 text-left text-[13.5px] font-semibold text-neutral-900 truncate">
                {headerSummary || 'Votre zone'}
              </span>
              <span className="flex-none inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: TERRA }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                Modifier
              </span>
            </button>
          </div>

          <div className="absolute left-0 right-0 bottom-0 z-20">
            {/* Bande de fondu SÉPARÉE : elle précède le bloc pastilles, donc
                elle commence TOUJOURS juste au-dessus d'elles, quel que soit
                le nombre de lignes. */}
            <div style={{ height: 30, background: 'linear-gradient(rgba(253,245,242,0), #FDF5F2)' }} />
            <div className="px-4" style={{ background: '#FDF5F2', paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
            {hasSelection && (
              <div className="mb-3 flex items-start gap-2">
              <div className="flex-1 min-w-0 max-h-[124px] overflow-y-auto">
                {/* Ligne 1 — arrondissements / communes (aucun picto) */}
                <div className="flex flex-wrap gap-1.5">
                  {displayArrIds.map((id) => { const z = arrById.get(id); return (
                    <button key={`arr-${id}`} onClick={() => z && handleClickArr(z)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold border"
                      style={{ backgroundColor: 'rgba(166,75,39,0.14)', color: TERRA, borderColor: TERRA }}>
                      {z?.shortName || z?.name || id}<span className="opacity-40 ml-0.5 text-[11px]">×</span>
                    </button> ) })}
                  {displayCommuneIds.map((id) => { const z = communeById.get(id); return (
                    <button key={`com-${id}`} onClick={() => toggleCommune(id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold border"
                      style={{ backgroundColor: 'rgba(166,75,39,0.14)', color: TERRA, borderColor: TERRA }}>
                      {z?.shortName || z?.name || id}<span className="opacity-40 ml-0.5 text-[11px]">×</span>
                    </button> ) })}
                  {partialArrIds.map((id) => { const z = arrById.get(id); return (
                    <button key={`parr-${id}`} onClick={() => removePartialArr(id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold border"
                      style={{ backgroundColor: 'rgba(166,75,39,0.07)', color: TERRA, borderColor: 'rgba(166,75,39,0.45)', borderStyle: 'dashed' }}>
                      {z?.shortName || z?.name || id}<span className="opacity-55 ml-0.5 text-[11px]">~</span><span className="opacity-40 ml-0.5 text-[11px]">×</span>
                    </button> ) })}
                  {partialCommuneIds.map((id) => { const z = communeById.get(id); return (
                    <button key={`pcom-${id}`} onClick={() => removePartialCommune(id)}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold border"
                      style={{ backgroundColor: 'rgba(166,75,39,0.07)', color: TERRA, borderColor: 'rgba(166,75,39,0.45)', borderStyle: 'dashed' }}>
                      {z?.shortName || z?.name || id}<span className="opacity-55 ml-0.5 text-[11px]">~</span><span className="opacity-40 ml-0.5 text-[11px]">×</span>
                    </button> ) })}
                </div>

                {/* Ligne 2 — quartiers vécus & transport (picto gris discret) */}
                {livedTags.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5">
                    {livedTags.map(({ group, state }, idx) => {
                      const isFull = state === 'full'
                      const isStation = group.type === 'transport_station' || group.type === 'transport_line'
                      return (
                        <button key={`lived-${group.type}-${group.label}-${idx}`} onClick={() => removeLivedEntity(group)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border"
                          style={{ backgroundColor: isFull ? 'rgba(166,75,39,0.14)' : 'rgba(166,75,39,0.07)', color: TERRA, borderColor: isFull ? TERRA : 'rgba(166,75,39,0.45)', borderStyle: isFull ? 'solid' : 'dashed' }}>
                          {isStation ? <StationIcon /> : <PinIcon />}
                          {group.label}
                          {!isFull && <span className="opacity-55 ml-0.5 text-[10px]">~</span>}
                          <span className="opacity-40 ml-0.5 text-[10px]">×</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Reset — revient à la sélection issue de la résolution. */}
              <button
                onClick={resetSelection}
                aria-label="Réinitialiser la sélection"
                className="flex-none w-8 h-8 rounded-full bg-white border flex items-center justify-center active:opacity-80 mt-0.5"
                style={{ borderColor: 'rgba(166,75,39,0.35)', color: TERRA }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />
                </svg>
              </button>
              </div>
            )}

            <button onClick={() => { /* proto : pas de nav vers l'étape Bien */ console.log('[proto] sélection', sel) }}
              disabled={!hasSelection}
              className="w-full py-3.5 rounded-2xl font-semibold text-[15px] text-white transition-opacity active:opacity-90"
              style={{ backgroundColor: hasSelection ? TERRA : '#DB947E' }}>
              Valider ma zone
            </button>
            </div>
          </div>
        </>
      )}

      {/* ═══════════════ MOMENT 1 — saisie (overlay opaque) ═══════════════ */}
      <div
        className="absolute inset-0 z-30 flex flex-col"
        style={{
          background: '#FDF5F2',
          transition: 'opacity .32s ease, transform .38s cubic-bezier(.32,.72,0,1)',
          opacity: phase === 'typing' ? 1 : 0,
          transform: phase === 'typing' ? 'none' : 'translateY(26px)',
          pointerEvents: phase === 'typing' ? 'auto' : 'none',
        }}
      >
        {/* Barre de progression (agencement onboarding) */}
        <div className="flex-none flex items-center gap-3 px-4 pb-1" style={{ paddingTop: 'max(env(safe-area-inset-top), 14px)' }}>
          <button className="w-9 h-9 rounded-full bg-white border border-black/8 flex items-center justify-center flex-none active:bg-black/5" style={{ color: '#404040' }}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="flex-1 flex gap-1.5">
            {['Quartiers', 'Bien', 'Budget', 'Critères'].map((label, i) => (
              <div key={label} className="flex-1 flex flex-col gap-[5px]">
                <div className="h-1 rounded-full" style={{ backgroundColor: i === 0 ? TERRA : 'rgba(0,0,0,0.1)' }} />
                <span className="text-[12px] leading-none text-center" style={{ color: i === 0 ? TERRA : '#525252', fontWeight: i === 0 ? 700 : 500 }}>{label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Titre */}
        <div className="flex-1 flex items-center justify-center px-6">
          <h2 className="text-[29px] font-bold text-neutral-900 text-center leading-tight tracking-tight">Où aimeriez-vous habiter&nbsp;?</h2>
        </div>

        {/* Bas : pastilles live + champ + CTA unique */}
        <div className="flex-none flex flex-col gap-3 px-4" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
          {liveChips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {liveChips.map((c, i) => {
                // Reconnu : terracotta très pâle. Exclusion : neutre, préfixe « sans ».
                // Relation géo : préfixe « ~ ». Non compris : gris pointillé + « ? ».
                const isExcl = c.variant === 'excl'
                const isUnknown = c.variant === 'unknown'
                return (
                  <span key={`${c.variant}-${c.label}-${i}`}
                    className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[12px] font-semibold border"
                    style={{
                      backgroundColor: isUnknown ? 'rgba(0,0,0,0.03)' : isExcl ? 'rgba(0,0,0,0.04)' : 'rgba(166,75,39,0.05)',
                      color: isUnknown ? '#9ca3af' : isExcl ? '#6b7280' : TERRA,
                      borderColor: isUnknown ? 'rgba(0,0,0,0.18)' : isExcl ? 'rgba(0,0,0,0.16)' : 'rgba(166,75,39,0.28)',
                      borderStyle: isUnknown ? 'dashed' : 'solid',
                    }}>
                    {c.icon === 'station' ? <StationIcon /> : c.icon === 'pin' ? <PinIcon /> : null}
                    {isExcl && <span className="opacity-70">sans</span>}
                    {c.variant === 'rel' && <span className="opacity-60">~</span>}
                    {c.label}
                    {isUnknown && <span className="opacity-60">?</span>}
                  </span>
                )
              })}
            </div>
          )}

          <div className="bg-white border rounded-2xl px-4 py-3.5 shadow-sm"
               style={{ borderColor: query.trim().length > 0 ? 'rgba(166,75,39,0.3)' : 'rgba(0,0,0,0.08)' }}>
            <textarea
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={3}
              placeholder={'Décrivez librement une ou plusieurs zones.\nEx : Autour de Daumesnil et Nation, proche métro Bel-Air'}
              className="w-full text-[16px] text-neutral-900 placeholder:text-neutral-400 bg-transparent outline-none resize-none leading-relaxed"
              autoComplete="off" autoCorrect="off" spellCheck={false}
            />
          </div>

          <button onClick={handleToMap} disabled={!canContinue}
            className="w-full py-4 rounded-2xl font-semibold text-[16px] text-white flex items-center justify-center gap-2 transition-opacity active:opacity-90"
            style={{ backgroundColor: canContinue ? TERRA : '#DB947E' }}>
            Voir sur la carte
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </div>
      </div>
    </div>
  )
}
