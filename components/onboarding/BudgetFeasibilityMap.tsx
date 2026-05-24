'use client'

import dynamic from 'next/dynamic'
import { Loader2 } from 'lucide-react'

/**
 * Read-only map showing each selected IRIS polygon coloured by feasibility
 * (budget / median × surface). Style updates are imperative — moving the
 * budget slider rewrites fillColor on existing Leaflet path layers without
 * triggering a React re-render of the map. That keeps the slider at 60fps
 * even with hundreds of polygons.
 *
 * Same Leaflet stack + tile provider as ZoneMap (Quartiers step) for visual
 * consistency. Different component because feasibility has zero interactivity
 * — duplicating the simpler surface area is lighter than adding a mode flag
 * to ZoneMap.
 */

interface BudgetFeasibilityMapProps {
  selectedIrisIds: string[]
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
