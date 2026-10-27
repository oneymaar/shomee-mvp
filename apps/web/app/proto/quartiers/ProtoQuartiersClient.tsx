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
import { lassoToIris } from '@/lib/geo/lassoToIris'

const ZoneMap = dynamic(() => import('@/components/onboarding/ZoneMap'), { ssr: false })

const TERRA = '#A6512B'
// Direction A — mêmes valeurs que `apps/mobile/src/lib/theme.ts`. Cet écran est
// affiché en WebView À L'INTÉRIEUR de l'app : le moindre écart de teinte se voit
// au passage vers l'étape suivante, qui est native.
const TERRA_BRIGHT = '#C96B45'
const CREAM = '#FAF3EE'
const INK = '#201A16'
const MUTED = '#8A7A6E'
const LINE = '#E8D9CB'
const SAND = '#EFE2D5'
const SERIF = "var(--font-serif), Georgia, serif"
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
const noopZone = () => {}

/** Picto lasso (dessin au doigt) — currentColor. */
function LassoIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round">
      <path d="M7 15c-3-2-3.5-6 0-8.5 3.6-2.6 10-2.2 12.3 1 2.3 3.2-.4 7.3-5.3 8.1-2.4.4-4.7.1-6.4-.6" />
      <path d="M7.6 15c-.9 1.6-.6 3.6.7 4.6" strokeDasharray="2 2.2" />
      <circle cx="8.6" cy="20" r="1.3" fill="currentColor" />
    </svg>
  )
}
/** Picto carte (sélection par toucher) — currentColor. */
function MapIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round">
      <path d="M3 6.5 9 4l6 2.5L21 4v13.5L15 20l-6-2.5L3 20z" />
      <path d="M9 4v13.5M15 6.5V20" />
    </svg>
  )
}

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
  // Époque de recadrage : incrémentée au Reset → la clé du fitBounds change
  // (offset d'1 m, imperceptible) → MapViewController rejoue son fitBounds
  // ANIMÉ. Zéro modification de ZoneMap.
  const [fitNonce, setFitNonce] = useState(0)
  const [entityGroups, setEntityGroups] = useState<EntityGroup[]>([])
  const [matchSummary, setMatchSummary] = useState<string[]>([])

  // Pont vers le natif (WebView de l'onboarding) : renvoie la sélection / le retour.
  const postToNative = useCallback((payload: object) => {
    const w = window as unknown as { ReactNativeWebView?: { postMessage: (m: string) => void } }
    if (w.ReactNativeWebView) { w.ReactNativeWebView.postMessage(JSON.stringify(payload)); return }
    // Hote WEB : le meme ecran est embarque dans une iframe same-origin par
    // QuartiersProtoFrame (parcours /onboarding). On rejoue le meme contrat de
    // message, avec un discriminant 'source' pour ne pas confondre avec
    // d'autres postMessage de la page.
    if (window.parent !== window) {
      window.parent.postMessage({ source: 'shomee-proto-quartiers', ...payload }, window.location.origin)
    }
  }, [])

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

  // Vrai si on a demarre directement sur la carte (prefill ?q=&start=map) :
  // dans ce cas on ne veut ni focus ni clavier.
  const startedOnMapRef = useRef(false)

  // Focus le champ au montage (moment 1).
  useEffect(() => {
    const t = setTimeout(() => { if (!startedOnMapRef.current) inputRef.current?.focus() }, 300)
    return () => clearTimeout(t)
  }, [])

  // ── Hauteur dynamique selon le clavier (moment 1) ─────────────────────────
  // On cale la hauteur de l'app sur visualViewport (= zone RÉELLEMENT visible,
  // au-dessus du clavier). Le contenu se comprime donc pour tenir dans cet
  // espace : il n'y a jamais rien à faire défiler. Le scroll natif de la
  // WebView est coupé côté natif (scrollEnabled=false) → pas de « remontée »
  // ni de barre élastique. Ici on se contente de suivre la hauteur.
  const [viewportH, setViewportH] = useState<number | null>(null)
  useEffect(() => {
    if (typeof window === 'undefined') return
    const vv = window.visualViewport
    const apply = () => {
      if (vv) setViewportH(vv.height)
      window.scrollTo(0, 0) // garde la page collée en haut
    }
    apply()
    vv?.addEventListener('resize', apply)
    vv?.addEventListener('scroll', apply)
    // Cas iframe (hote WEB) : le clavier ne redimensionne pas le visualViewport
    // du document embarque, c'est le PARENT qui reduit la hauteur de l'iframe.
    // Ce redimensionnement declenche un window.resize ici : on le suit aussi.
    window.addEventListener('resize', apply)
    // Coupe tout défilement du document (desktop + filet de sécurité).
    const html = document.documentElement
    const body = document.body
    const savedHtml = html.style.overflow
    const savedBody = body.style.overflow
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'
    return () => {
      vv?.removeEventListener('resize', apply)
      vv?.removeEventListener('scroll', apply)
      window.removeEventListener('resize', apply)
      html.style.overflow = savedHtml
      body.style.overflow = savedBody
    }
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

  // Prefill : ?q=<recherche> [&start=map]. Utilise par l'hote WEB quand on
  // revient modifier le bloc Quartiers depuis le recap : on repart de la
  // recherche deja saisie, directement sur la carte.
  // Lecture dans un effet (et pas en initialisation d'etat) : la page est
  // rendue cote serveur, ou window.location n'existe pas encore. Un seul
  // passage au montage, donc aucun risque de rendus en cascade.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const q = (sp.get('q') ?? '').trim()
    if (!q) return
    // eslint-disable-next-line react-hooks/set-state-in-effect -- prefill URL, une seule fois au montage
    setQuery(q)
    if (sp.get('start') === 'map') {
      startedOnMapRef.current = true
      setQueryToResolve(q)
      setPhase('map')
    }
  }, [])
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

  // Signale a l'hote WEB (QuartiersProtoFrame) que la carte est prete : la
  // resolution est terminee ET la frame suivante est peinte. L'hote garde son
  // ecran de chargement jusque-la, exactement comme le faisait l'ancien
  // LocationMapStep (onReady). Sans interet en natif (aucun loader hote).
  const readySentRef = useRef(false)
  useEffect(() => {
    if (readySentRef.current) return
    if (!startedOnMapRef.current) return
    if (phase !== 'map' || irisLoading || resolvedRef.current === null) return
    readySentRef.current = true
    requestAnimationFrame(() => requestAnimationFrame(() => postToNative({ action: 'ready' })))
  }, [phase, irisLoading, initialIris, postToNative])

  // ══ MODE DE LA CARTE — « Quartiers » (toucher) / « Dessiner » (lasso) ══════
  // Décision du 27/10 : les deux modes NE SE CUMULENT PAS. Passer de l'un à
  // l'autre efface la sélection en cours (avec confirmation si elle existe).
  // Dessin = option A : chaque zone dessinée est traduite en îlots IRIS
  // (lassoToIris) ; la recherche ne reçoit que ces IRIS, comme d'habitude.
  type MapMode = 'select' | 'draw'
  type DrawnZone = { latlngs: [number, number][]; irisIds: string[] }
  const [mapMode, setMapMode] = useState<MapMode>('select')
  const [drawing, setDrawing] = useState(false)
  const [drawnZones, setDrawnZones] = useState<DrawnZone[]>([])
  const [pendingMode, setPendingMode] = useState<MapMode | null>(null)
  const [drawMiss, setDrawMiss] = useState(false)
  const mapModeRef = useRef<MapMode>('select')
  useEffect(() => { mapModeRef.current = mapMode }, [mapMode])

  const drawnOutlines = useMemo(() => drawnZones.map((z) => z.latlngs), [drawnZones])

  const selectionFromZones = useCallback((zones: DrawnZone[]): Sel => {
    const all = [...new Set(zones.flatMap((z) => z.irisIds))]
    const parents = deriveParents(all)
    return { iris: all, arr: parents.arr, q: parents.q, com: parents.com }
  }, [deriveParents])

  const applyMode = useCallback((mode: MapMode) => {
    setSel(EMPTY_SEL)
    setDrawnZones([])
    setDrawMiss(false)
    setMapMode(mode)
    setDrawing(mode === 'draw')
    // Une prochaine saisie texte, même identique, devra être re-résolue :
    // la sélection qu'elle avait produite vient d'être effacée.
    resolvedRef.current = null
  }, [])

  const hasAnySelection = sel.arr.length > 0 || sel.com.length > 0 || sel.q.length > 0 || sel.iris.length > 0
  const requestMode = useCallback((mode: MapMode) => {
    if (mode === mapMode) return
    if (hasAnySelection) setPendingMode(mode) // confirmation avant d'effacer
    else applyMode(mode)
  }, [mapMode, hasAnySelection, applyMode])

  const handleDrawComplete = useCallback((latlngs: [number, number][]) => {
    const irisIds = lassoToIris(latlngs, iris)
    if (irisIds.length === 0) { setDrawMiss(true); return } // hors de la zone couverte
    setDrawMiss(false)
    const next = [...drawnZones, { latlngs, irisIds }]
    setDrawnZones(next)
    setSel(selectionFromZones(next))
    setDrawing(false)
  }, [iris, drawnZones, selectionFromZones])

  const removeDrawnZone = useCallback((idx: number) => {
    const next = drawnZones.filter((_, i) => i !== idx)
    setDrawnZones(next)
    setSel(selectionFromZones(next))
    if (next.length === 0) setDrawing(true)
  }, [drawnZones, selectionFromZones])

  const redraw = useCallback(() => {
    setDrawnZones([])
    setSel(EMPTY_SEL)
    setDrawMiss(false)
    setDrawing(true)
  }, [])

  // Entrées directes depuis l'écran de saisie (sans texte).
  const startOnMap = useCallback((mode: MapMode) => {
    inputRef.current?.blur()
    setInitialIris([])
    setEntityGroups([])
    setMatchSummary([])
    applyMode(mode)
    setPhase('map')
  }, [applyMode])

  const handleToMap = useCallback(() => {
    const q = query.trim()
    if (q.length < 2) return
    inputRef.current?.blur() // ferme le clavier
    if (mapModeRef.current === 'draw') applyMode('select') // le texte mène aux quartiers
    setQueryToResolve(q)     // résolution instantanée si IRIS déjà chargés, sinon via l'effet
    setPhase('map')
  }, [query, applyMode])

  const handleModifier = useCallback(() => {
    setPhase('typing')
    setTimeout(() => inputRef.current?.focus(), 120)
  }, [])

  // ── Indication de zoom : si on ARRIVE sur la carte à un zoom où les IRIS
  // ne sont pas cliquables (< 15, seuil ZoneMap), une animation de pincement
  // (deux doigts qui s'écartent) PERSISTE au centre — et disparaît à la
  // PREMIÈRE interaction avec la carte, quelle qu'elle soit (zoom, dézoom,
  // déplacement, simple contact). Ré-armée à chaque retour en saisie.
  const [hintMounted, setHintMounted] = useState(false)
  const [hintVisible, setHintVisible] = useState(false)
  const zoomLiveRef = useRef(zoom)
  useEffect(() => { zoomLiveRef.current = zoom }, [zoom])
  const hintDoneRef = useRef(false)
  useEffect(() => {
    if (phase === 'typing') { hintDoneRef.current = false; return }
    if (hintDoneRef.current) return
    const t = setTimeout(() => {
      hintDoneRef.current = true
      if (zoomLiveRef.current >= 15) return // déjà au niveau IRIS (poche serrée)
      if (mapModeRef.current === 'draw') return // en dessin, c'est la consigne de tracé qui parle
      setHintMounted(true)
      requestAnimationFrame(() => setHintVisible(true))
    }, 1000) // laisse le fitBounds initial se poser avant d'évaluer le zoom
    return () => clearTimeout(t)
  }, [phase])

  // Toute interaction tactile/souris/molette sur la carte → l'indication part.
  const dismissHint = useCallback(() => {
    setHintVisible((v) => {
      if (v) setTimeout(() => setHintMounted(false), 350)
      return false
    })
  }, [])
  useEffect(() => {
    if (zoom >= 15 && hintMounted) dismissHint()
  }, [zoom, hintMounted, dismissHint])

  // Reset : revient à la sélection d'ORIGINE (celle issue de la résolution),
  // en recomposant les parents — sans relancer le moteur — et RECENTRE la
  // carte comme à la livraison initiale (fitBounds animé via fitNonce).
  const resetSelection = useCallback(() => {
    const parents = deriveParents(initialIris)
    setSel({ iris: initialIris, arr: parents.arr, q: parents.q, com: parents.com })
    setFitNonce((n) => n + 1)
  }, [initialIris, deriveParents])

  // Le Reset n'apparaît que si la sélection a DÉVIÉ de la livraison initiale.
  const selectionDirty = useMemo(() => {
    if (sel.iris.length !== initialIris.length) return true
    const cur = new Set(sel.iris)
    return initialIris.some((id) => !cur.has(id))
  }, [sel.iris, initialIris])

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

  // Commune prise EN ENTIER, avec cascade sur ses IRIS (comme toggleArr). Sans
  // la cascade, le clic n'écrivait que `sel.com`, alors que l'affichage (plein /
  // pastille) est dérivé des IRIS : le clic sur une commune limitrophe était
  // donc INVISIBLE à l'onboarding (bug 27/10 — même cause que celle corrigée le
  // 27/07 dans l'embed, jamais reportée ici).
  const toggleCommune = useCallback((id: string, childI: string[]) => {
    setSel((s) => s.com.includes(id)
      ? { ...s, com: s.com.filter((c) => c !== id), iris: s.iris.filter((x) => !childI.includes(x)) }
      : { ...s, com: [...s.com, id], iris: [...new Set([...s.iris, ...childI])] })
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
  const handleClickCommune = useCallback((zone: GeoZone) => {
    const childI = iris.filter((i) => i.parentId === zone.id).map((i) => i.id)
    toggleCommune(zone.id, childI)
  }, [iris, toggleCommune])
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
  // + les communes cochées qui n'ont AUCUN IRIS dans le jeu de données : sans
  // ça, elles resteraient invisibles quoi qu'on fasse.
  const communesWithIris = useMemo(() => {
    const out = new Set<string>()
    for (const i of iris) if (i.parentId?.startsWith('com-')) out.add(i.parentId)
    return out
  }, [iris])
  const displayCommuneIds = useMemo(() => {
    const out = new Set(coverage.fullCommuneIds)
    for (const c of sel.com) if (!communesWithIris.has(c)) out.add(c)
    return [...out]
  }, [coverage, sel.com, communesWithIris])
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
    // Cadrage calé sur la sélection INITIALE uniquement, jamais sur la
    // sélection vivante : quand la recherche ne donnait rien (initialIris vide),
    // le repli lisait sel.q / sel.com / sel.arr → CHAQUE clic recadrait la
    // carte, qui glissait sous le doigt (bug 27/10). Sans sélection initiale :
    // pas de cadrage, la carte reste où l'acquéreur l'a mise.
    const base = (() => {
      const selIris = byId(iris, initialIris)
      return selIris.length > 0 ? boundsOfFeatures(selIris) : null
    })()
    if (!base) return base
    const eps = (fitNonce % 2) * 0.00003 // ~3 m : invisible, mais change la clé
    return [[base[0][0], base[0][1]], [base[1][0] + eps, base[1][1]]] as Bounds
  }, [iris, initialIris, fitNonce])

  const center = useMemo<[number, number]>(() => {
    if (fitBounds) return [(fitBounds[0][0] + fitBounds[1][0]) / 2, (fitBounds[0][1] + fitBounds[1][1]) / 2]
    return PARIS_CENTER
  }, [fitBounds])

  const hasSelection = sel.arr.length > 0 || sel.com.length > 0 || sel.q.length > 0 || sel.iris.length > 0
  const canContinue = query.trim().length >= 2
  const headerSummary = matchSummary.length > 0 ? matchSummary.join(' · ') : query.trim()
  // Libellé du récap : texte saisi, sinon zone(s) dessinée(s), sinon les zones
  // touchées (entrée directe « Choisir des quartiers », sans texte).
  const validateLabel = mapMode === 'draw'
    ? (drawnZones.length > 1 ? `${drawnZones.length} zones dessinées` : 'Zone dessinée')
    : headerSummary || [
        ...displayArrIds.map((id) => arrById.get(id)?.shortName ?? id),
        ...displayCommuneIds.map((id) => communeById.get(id)?.shortName ?? id),
        ...partialArrIds.map((id) => `${arrById.get(id)?.shortName ?? id} (en partie)`),
        ...partialCommuneIds.map((id) => `${communeById.get(id)?.shortName ?? id} (en partie)`),
      ].join(', ')

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div
      className="fixed inset-x-0 top-0 mx-auto flex flex-col overflow-hidden"
      style={{ background: '#FDF5F2', maxWidth: 430, height: viewportH ? `${viewportH}px` : '100svh' }}
    >
      {/* ── Carte : montée dès que les géométries sont prêtes, sous l'overlay du
           moment 1 (opaque) → révélée sans reload au passage moment 2. ─────── */}
      <div
        className="absolute inset-0 z-0"
        onPointerDownCapture={dismissHint}
        onTouchStartCapture={dismissHint}
        onWheelCapture={dismissHint}
      >
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
            onClickArr={mapMode === 'draw' ? noopZone : handleClickArr}
            onClickQuartier={mapMode === 'draw' ? noopZone : handleClickQuartier}
            onClickIris={mapMode === 'draw' ? noopZone : handleClickIris}
            onClickCommune={mapMode === 'draw' ? noopZone : handleClickCommune}
            onClickCommuneIris={mapMode === 'draw' ? noopZone : handleClickCommuneIris}
            onZoomChange={setZoom}
            attributionOffsetTop={150}
            drawing={phase === 'map' && mapMode === 'draw' && drawing}
            drawnZones={drawnOutlines}
            onDrawComplete={handleDrawComplete}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-[13px] text-neutral-500">Préparation de la carte…</p>
          </div>
        )}
      </div>

      {/* Indication de zoom — animation de pincement (deux doigts), persiste
          jusqu'à la première interaction avec la carte. Non interactive. */}
      {phase === 'map' && mapMode === 'select' && hintMounted && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center justify-center pointer-events-none"
          style={{ opacity: hintVisible ? 1 : 0, transition: 'opacity 320ms ease' }}
        >
          <style>{`
            @keyframes shomeePinchA {
              0%, 12%   { transform: translate(-8px, 8px) scale(1); }
              55%, 70%  { transform: translate(-21px, 21px) scale(1.06); }
              100%      { transform: translate(-8px, 8px) scale(1); }
            }
            @keyframes shomeePinchB {
              0%, 12%   { transform: translate(8px, -8px) scale(1); }
              55%, 70%  { transform: translate(21px, -21px) scale(1.06); }
              100%      { transform: translate(8px, -8px) scale(1); }
            }
            @keyframes shomeePinchRing {
              0%, 12%   { transform: scale(0.55); opacity: 0; }
              45%       { opacity: 0.45; }
              70%       { transform: scale(1); opacity: 0.25; }
              100%      { transform: scale(0.55); opacity: 0; }
            }
          `}</style>
          <div
            style={{
              width: 96, height: 96, borderRadius: 48, position: 'relative',
              background: 'rgba(28,25,23,0.72)', backdropFilter: 'blur(4px)',
            }}
          >
            {/* cercle d'expansion (suggère l'agrandissement) */}
            <div style={{
              position: 'absolute', left: '50%', top: '50%', width: 64, height: 64,
              marginLeft: -32, marginTop: -32, borderRadius: 32,
              border: '2px solid rgba(255,255,255,0.9)',
              animation: 'shomeePinchRing 1.7s ease-in-out infinite',
            }} />
            {/* les deux doigts */}
            <div style={{
              position: 'absolute', left: '50%', top: '50%', width: 15, height: 15,
              marginLeft: -7.5, marginTop: -7.5, borderRadius: 8, background: '#fff',
              boxShadow: '0 0 0 3px rgba(255,255,255,0.28)',
              animation: 'shomeePinchA 1.7s ease-in-out infinite',
            }} />
            <div style={{
              position: 'absolute', left: '50%', top: '50%', width: 15, height: 15,
              marginLeft: -7.5, marginTop: -7.5, borderRadius: 8, background: '#fff',
              boxShadow: '0 0 0 3px rgba(255,255,255,0.28)',
              animation: 'shomeePinchB 1.7s ease-in-out infinite',
            }} />
          </div>
          <div
            className="mt-3 px-4 py-2 rounded-full text-[13px] font-semibold text-white text-center"
            style={{ background: 'rgba(28,25,23,0.78)', backdropFilter: 'blur(4px)', maxWidth: 280 }}
          >
            Zoomez pour sélectionner des quartiers précis
          </div>
        </div>
      )}

      {/* ═══════════════ MOMENT 2 — chrome par-dessus la carte ═══════════════ */}
      {phase === 'map' && (
        <>
          {/* En-tête FLOTTANT au-dessus de la carte — aucun fade, la carte
              file jusqu'en haut de l'écran. */}
          <div className="absolute top-0 left-0 right-0 z-20 px-4"
               style={{ paddingTop: 'max(calc(env(safe-area-inset-top) + 6px), 58px)' }}>
            <button onClick={handleModifier}
                    className="w-full flex items-center gap-2.5 bg-white border border-black/8 rounded-2xl px-3.5 py-2.5 shadow-sm active:bg-black/[0.02]">
              <span className="flex-1 min-w-0 text-left text-[13.5px] font-semibold text-neutral-900 truncate">
                {mapMode === 'draw'
                  ? (drawnZones.length > 0 ? 'Ma zone dessinée' : 'Dessiner ma zone')
                  : (headerSummary || 'Votre zone')}
              </span>
              <span className="flex-none inline-flex items-center gap-1 text-[12.5px] font-semibold" style={{ color: TERRA }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
                Modifier
              </span>
            </button>

            {/* Interrupteur Quartiers / Dessiner — modes exclusifs (27/10). */}
            <div className="mt-2 flex p-[3px] rounded-[14px] shadow-sm" style={{ background: 'rgba(255,255,255,0.94)', border: '1px solid rgba(0,0,0,0.06)' }}>
              {([['select', 'Quartiers'], ['draw', 'Dessiner']] as const).map(([m, label]) => {
                const on = mapMode === m
                return (
                  <button key={m} onClick={() => requestMode(m)}
                    className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-[11px] text-[12.5px] font-semibold transition-colors"
                    style={{ background: on ? TERRA : 'transparent', color: on ? '#fff' : MUTED }}>
                    {m === 'draw' ? <LassoIcon size={15} /> : <MapIcon size={15} />}
                    {label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Consigne de tracé (mode dessin, en attente d'un tracé). */}
          {mapMode === 'draw' && drawing && (
            <div className="absolute left-0 right-0 z-20 flex justify-center pointer-events-none" style={{ top: 'max(calc(env(safe-area-inset-top) + 112px), 164px)' }}>
              <div className="px-4 py-2 rounded-2xl text-[12.5px] font-medium text-white text-center" style={{ background: 'rgba(28,25,23,0.78)', backdropFilter: 'blur(4px)', maxWidth: 300 }}>
                {drawMiss
                  ? 'Cette zone est hors de notre carte — dessinez dans Paris ou la petite couronne'
                  : 'Entourez la zone qui vous plaît, sans lever le doigt'}
              </div>
            </div>
          )}

          <div className="absolute left-0 right-0 bottom-0 z-20">
            {/* Séparation NETTE carte / zone basse (le fade est abandonné). */}
            <div className="px-4 pt-3" style={{ background: '#FDF5F2', borderTop: '1px solid rgba(0,0,0,0.07)', paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
            {mapMode === 'draw' && (
              <div className="mb-3">
                {drawnZones.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2.5">
                    {drawnZones.map((_, i) => (
                      <button key={`draw-${i}`} onClick={() => removeDrawnZone(i)}
                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold border"
                        style={{ backgroundColor: 'rgba(166,75,39,0.14)', color: TERRA, borderColor: TERRA }}>
                        <LassoIcon size={13} />
                        {drawnZones.length > 1 ? `Zone dessinée ${i + 1}` : 'Zone dessinée'}
                        <span className="opacity-40 ml-0.5 text-[11px]">×</span>
                      </button>
                    ))}
                  </div>
                )}
                {drawing ? (
                  <div className="flex items-center justify-center gap-3 text-[12px]" style={{ color: MUTED }}>
                    <span>Pour déplacer la carte : deux doigts</span>
                    {drawnZones.length > 0 && (
                      <button onClick={() => setDrawing(false)} className="font-semibold" style={{ color: TERRA }}>Annuler le tracé</button>
                    )}
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <button onClick={() => { setDrawMiss(false); setDrawing(true) }}
                      className="flex-1 h-[38px] rounded-full bg-white border text-[12.5px] font-semibold active:opacity-80"
                      style={{ borderColor: LINE, color: INK }}>
                      ＋ Ajouter une zone
                    </button>
                    <button onClick={redraw}
                      className="flex-1 h-[38px] rounded-full bg-white border text-[12.5px] font-semibold active:opacity-80"
                      style={{ borderColor: LINE, color: INK }}>
                      ↺ Redessiner
                    </button>
                  </div>
                )}
              </div>
            )}
            {mapMode === 'select' && hasSelection && (
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
                    <button key={`com-${id}`} onClick={() => removePartialCommune(id)}
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

              {/* Reset — visible UNIQUEMENT quand la sélection a été modifiée.
                  Restaure la livraison initiale + recentre la carte (animé). */}
              {selectionDirty && (
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
              )}
              </div>
            )}

            <button onClick={() => postToNative({ action: 'validate', selectedArrIds: sel.arr, selectedQuartierIds: sel.q, selectedIrisIds: sel.iris, selectedCommuneIds: sel.com, locationLabel: validateLabel, locationQuery: mapMode === 'draw' ? '' : query })}
              disabled={!hasSelection}
              className="w-full py-3.5 rounded-2xl font-semibold text-[15px] text-white transition-opacity active:opacity-90"
              style={{ backgroundColor: hasSelection ? TERRA : '#DB947E' }}>
              Valider ma zone
            </button>
            </div>
          </div>
        </>
      )}

      {/* Confirmation avant de changer de mode (la sélection serait effacée). */}
      {phase === 'map' && pendingMode && (
        <div className="absolute inset-0 z-40 flex items-end" style={{ background: 'rgba(28,25,23,0.35)' }}
             onClick={() => setPendingMode(null)}>
          <div className="w-full rounded-t-[26px] px-5 pt-5" onClick={(e) => e.stopPropagation()}
               style={{ background: '#FDF5F2', paddingBottom: 'max(env(safe-area-inset-bottom), 24px)' }}>
            <p className="text-[19px] mb-1.5" style={{ fontFamily: SERIF, fontWeight: 500, color: INK }}>
              {pendingMode === 'draw' ? 'Passer au dessin ?' : 'Passer aux quartiers ?'}
            </p>
            <p className="text-[13.5px] leading-relaxed mb-5" style={{ color: MUTED }}>
              {pendingMode === 'draw'
                ? 'Votre sélection de quartiers sera effacée, pour laisser place à votre dessin.'
                : 'Vos zones dessinées seront effacées, pour laisser place à une sélection de quartiers.'}
            </p>
            <button onClick={() => { const m = pendingMode; setPendingMode(null); applyMode(m) }}
              className="w-full py-3.5 rounded-full font-semibold text-[15px] text-white mb-2 active:opacity-90"
              style={{ background: TERRA }}>
              Continuer
            </button>
            <button onClick={() => setPendingMode(null)}
              className="w-full py-3 rounded-full font-semibold text-[14px] active:opacity-80" style={{ color: MUTED }}>
              Annuler
            </button>
          </div>
        </div>
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
        <div className="flex-none flex items-center gap-3 px-4 pb-1" style={{ paddingTop: 'max(calc(env(safe-area-inset-top) + 6px), 58px)' }}>
          <button onClick={() => postToNative({ action: 'back' })} className="w-9 h-9 rounded-full bg-white flex items-center justify-center flex-none active:opacity-70" style={{ color: INK, border: `1.5px solid ${LINE}` }}>
            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-bold mb-[7px]" style={{ color: MUTED, letterSpacing: '2px' }}>
              ÉTAPE 1 SUR 4 — QUARTIERS
            </div>
            <div className="flex gap-1.5">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="flex-1 h-1 rounded-full" style={{ backgroundColor: i === 0 ? TERRA : LINE }} />
              ))}
            </div>
          </div>
        </div>

        {/* Titre — serif de marque, aligné à GAUCHE : centré ici et à gauche
            sur toutes les étapes suivantes, la ligne se cassait au passage. */}
        <div className="flex-none px-[22px] pt-7">
          <h2 className="text-[27px]" style={{ fontFamily: SERIF, fontWeight: 500, color: INK, lineHeight: 1.25, letterSpacing: '-0.2px' }}>
            Où aimeriez-vous<br />habiter&nbsp;?
          </h2>
        </div>
        <div className="flex-1 min-h-0" />

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
                      // Reconnu → blanc liseré terracotta (l'état « souhaité » des
                      // pastilles critères). Exclu / non compris → sable, en retrait.
                      backgroundColor: isUnknown || isExcl ? SAND : '#fff',
                      color: isUnknown || isExcl ? MUTED : TERRA,
                      borderColor: isUnknown ? MUTED : isExcl ? SAND : TERRA_BRIGHT,
                      borderStyle: isUnknown ? 'dashed' : 'solid',
                      borderWidth: 1.5,
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

          <div className="bg-white rounded-[22px] px-4 py-3.5"
               style={{
                 border: `1.5px solid ${query.trim().length > 0 ? TERRA : LINE}`,
                 boxShadow: query.trim().length > 0
                   ? '0 8px 22px rgba(166,81,43,0.12)'
                   : '0 4px 14px rgba(32,26,22,0.05)',
                 transition: 'border-color .2s ease, box-shadow .2s ease',
               }}>
            <textarea
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              rows={3}
              placeholder={'Décrivez librement une ou plusieurs zones.\nEx : Autour de Daumesnil et Nation, proche métro Bel-Air'}
              className="w-full text-[16px] placeholder:text-[#B7A99D] bg-transparent outline-none resize-none leading-relaxed"
              style={{ color: INK }}
              autoComplete="off" autoCorrect="off" spellCheck={false}
            />
          </div>

          {/* Alternatives au texte — directement sur la carte (27/10). Visibles
              tant que rien n'est saisi : dès qu'on écrit, le CTA prend le relais. */}
          {query.trim().length === 0 && (
            <div>
              <div className="flex items-center gap-2.5 mb-2.5 text-[11.5px] font-medium" style={{ color: MUTED }}>
                <div className="flex-1 h-px" style={{ background: LINE }} />
                ou directement sur la carte
                <div className="flex-1 h-px" style={{ background: LINE }} />
              </div>
              <div className="flex gap-2.5">
                <button onClick={() => startOnMap('draw')} disabled={irisLoading}
                  className="flex-1 flex flex-col items-center gap-1 rounded-2xl bg-white border px-2 py-2.5 active:opacity-80"
                  style={{ borderColor: LINE, opacity: irisLoading ? 0.6 : 1 }}>
                  <span style={{ color: TERRA }}><LassoIcon size={22} /></span>
                  <span className="text-[12.5px] font-semibold" style={{ color: INK }}>Dessiner ma zone</span>
                  <span className="text-[10.5px]" style={{ color: MUTED }}>au doigt, librement</span>
                </button>
                <button onClick={() => startOnMap('select')} disabled={irisLoading}
                  className="flex-1 flex flex-col items-center gap-1 rounded-2xl bg-white border px-2 py-2.5 active:opacity-80"
                  style={{ borderColor: LINE, opacity: irisLoading ? 0.6 : 1 }}>
                  <span style={{ color: TERRA }}><MapIcon size={22} /></span>
                  <span className="text-[12.5px] font-semibold" style={{ color: INK }}>Choisir des quartiers</span>
                  <span className="text-[10.5px]" style={{ color: MUTED }}>en touchant la carte</span>
                </button>
              </div>
            </div>
          )}

          <button onClick={handleToMap} disabled={!canContinue}
            className="w-full py-4 rounded-full font-semibold text-[15.5px] flex items-center justify-center gap-2 active:opacity-90"
            style={{
              backgroundColor: canContinue ? TERRA : SAND,
              color: canContinue ? CREAM : MUTED,
              // Le CTA flotte au-dessus du crème ; éteint, il se pose (plus d'ombre).
              boxShadow: canContinue ? '0 10px 22px rgba(166,81,43,0.28)' : 'none',
              transition: 'background-color .2s ease, box-shadow .2s ease, color .2s ease',
            }}>
            Voir sur la carte
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
          </button>
        </div>
      </div>
    </div>
  )
}
