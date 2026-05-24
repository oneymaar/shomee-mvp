'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'
import type { GeoZone } from '@/lib/services/geoDataService'

/**
 * Read-only map showing each selected IRIS polygon coloured by feasibility
 * (budget / median × surface). Style updates are imperative — moving the
 * budget slider rewrites fillColor on existing Leaflet path layers without
 * triggering a React re-render of the map. That keeps the slider at 60fps
 * even with hundreds of polygons.
 *
 * The IRIS geometries are passed in directly (loaded by the parent step).
 * That way we avoid a second fetch and we trust the parent to have already
 * expanded any arrondissement / quartier / commune selection into its
 * constituent IRIS — a coverage detail the map shouldn't have to know about.
 */

interface BudgetFeasibilityMapProps {
  irisZones: GeoZone[]
  loading: boolean
  budgetMax: number
  surface: number
}

// Dynamic load: react-leaflet has no SSR support.
const MapShell = dynamic(() => import('./BudgetFeasibilityMapShell'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-neutral-50">
      <Loader2 size={24} className="text-neutral-300 animate-spin" />
    </div>
  ),
})

export default function BudgetFeasibilityMap(props: BudgetFeasibilityMapProps) {
  return (
    <div
      className="w-full rounded-2xl overflow-hidden border border-black/8 relative"
      style={{ aspectRatio: '1 / 1' }}
    >
      <MapShell {...props} />
    </div>
  )
}
