'use client'

/**
 * Glue de la carte budget embarquée — RÉUTILISE `BudgetFeasibilityMapShell`
 * (composant pur) + `geoDataService`, SANS toucher à l'onboarding web. La
 * sélection Quartiers (déjà résolue côté natif) arrive en `sel` ; on résout ici
 * les IRIS EFFECTIFS (expansion arr/quartier/commune → IRIS, copie de la logique
 * de `BudgetStep`) car le natif peut n'avoir que des arrondissements. Le budget
 * et la surface initiaux viennent aussi de `sel`, puis se mettent à jour en live
 * via `window.__shomeeSetBudget` (appelé par le natif au glissement du curseur).
 */
import { useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import {
  fetchParisGeoData,
  fetchParisIris,
  fetchSuburbanCommunes,
  type GeoZone,
} from '@shomee/core/geo/geoDataService'

// react-leaflet n'a pas de SSR → import dynamique côté client uniquement.
const MapShell = dynamic(() => import('@/components/onboarding/BudgetFeasibilityMapShell'), {
  ssr: false,
})

interface InitialSel {
  arrIds: string[]
  quartierIds: string[]
  irisIds: string[]
  communeIds: string[]
  budgetMax: number
  surface: number
}

function parseSel(selParam: string): InitialSel {
  try {
    const o = JSON.parse(selParam) as Record<string, unknown>
    const arr = (k: string) =>
      Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === 'string') : []
    const num = (k: string, d: number) =>
      typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : d
    return {
      arrIds: arr('arrIds'),
      quartierIds: arr('quartierIds'),
      irisIds: arr('irisIds'),
      communeIds: arr('communeIds'),
      budgetMax: num('budgetMax', 500_000),
      surface: num('surface', 50),
    }
  } catch {
    return { arrIds: [], quartierIds: [], irisIds: [], communeIds: [], budgetMax: 500_000, surface: 50 }
  }
}

function postToNative(payload: object) {
  const w = window as unknown as { ReactNativeWebView?: { postMessage: (m: string) => void } }
  if (w.ReactNativeWebView) w.ReactNativeWebView.postMessage(JSON.stringify(payload))
}

export default function BudgetMapEmbedClient({ selParam }: { selParam: string }) {
  const initial = useMemo(() => parseSel(selParam), [selParam])

  const [irisZones, setIrisZones] = useState<GeoZone[]>([])
  const [loading, setLoading] = useState(true)
  const [budgetMax, setBudgetMax] = useState(initial.budgetMax)
  const [surface, setSurface] = useState(initial.surface)

  // Pont natif → web : recoloration live sans recharger la page.
  useEffect(() => {
    const w = window as unknown as { __shomeeSetBudget?: (b: number, s: number) => void }
    w.__shomeeSetBudget = (b: number, s: number) => {
      if (typeof b === 'number' && Number.isFinite(b)) setBudgetMax(b)
      if (typeof s === 'number' && Number.isFinite(s)) setSurface(s)
    }
    return () => {
      delete w.__shomeeSetBudget
    }
  }, [])

  // Résolution des IRIS effectifs (copie de BudgetStep : expansion
  // arr/quartier/commune → IRIS pour que la carte marche quelle que soit la
  // granularité amont).
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const [geoData, communes] = await Promise.all([fetchParisGeoData(), fetchSuburbanCommunes()])
        const allIris = await fetchParisIris(geoData.quartiers, communes)
        if (cancelled) return

        const direct = new Set(initial.irisIds)
        const quSet = new Set(initial.quartierIds)
        const comSet = new Set(initial.communeIds)
        const arrSet = new Set(initial.arrIds)
        const arrChildQuartiers = new Map<string, Set<string>>()
        for (const qu of geoData.quartiers) {
          if (!qu.parentId) continue
          if (!arrChildQuartiers.has(qu.parentId)) arrChildQuartiers.set(qu.parentId, new Set())
          arrChildQuartiers.get(qu.parentId)!.add(qu.id)
        }

        const picked: GeoZone[] = []
        for (const iris of allIris) {
          if (direct.has(iris.id)) {
            picked.push(iris)
            continue
          }
          const parent = iris.parentId
          if (!parent) continue
          if (quSet.has(parent)) {
            picked.push(iris)
            continue
          }
          if (comSet.has(parent)) {
            picked.push(iris)
            continue
          }
          for (const a of arrSet) {
            if (arrChildQuartiers.get(a)?.has(parent)) {
              picked.push(iris)
              break
            }
          }
        }

        if (cancelled) return
        setIrisZones(picked)
        setLoading(false)
        postToNative({ action: 'ready' })
      } catch {
        if (!cancelled) {
          setLoading(false)
          postToNative({ action: 'ready' })
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [initial])

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#f5f5f4', overflow: 'hidden' }}>
      <MapShell irisZones={irisZones} loading={loading} budgetMax={budgetMax} surface={surface} />
    </div>
  )
}
