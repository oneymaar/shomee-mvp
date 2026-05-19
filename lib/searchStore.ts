'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// Reset persisted state on every page load — each refresh = fresh onboarding
if (typeof window !== 'undefined') {
  localStorage.removeItem('shomee-search')
}

export interface LocationIntent {
  location_terms: string[]
  lifestyle_terms: string[]
  transport_constraints: string[]
  confidence: number
  geoConstraints?: import('./services/geoConstraintService').GeoConstraint[]
  resolutionStrategy?: string
  /** DEBUG — remove after parser validation */
  parserSource?: 'spatial_intent_parser' | 'llm_fallback'
}

export type PropertyType = 'appartement' | 'maison' | 'studio' | 'loft' | 'duplex'

export interface SearchPreferences {
  locationQuery: string
  locationLabel: string
  locationLat: number | null
  locationLng: number | null
  locationRadius: number
  locationIntent: LocationIntent | null
  selectedArrIds: string[]
  selectedQuartierIds: string[]
  selectedIrisIds: string[]
  selectedCommuneIds: string[]
  budgetMax: number | null
  propertyTypes: PropertyType[]
  minRooms: number | null
  minSurface: number | null
  maxSurface: number | null
  priorities: string[]
  onboardingCompleted: boolean
}

interface SearchStore extends SearchPreferences {
  setLocation: (opts: { query: string; label: string; lat: number; lng: number; intent?: LocationIntent | null }) => void
  setLocationRadius: (radius: number) => void
  setSelectedArrs: (ids: string[]) => void
  /** Toggle arrondissement: selects/deselects it + all child quartiers + all child iris */
  toggleArr: (id: string, childQuartierIds: string[], childIrisIds: string[]) => void
  /** Toggle quartier: updates partial state of parent arr + selects/deselects child iris */
  toggleQuartier: (id: string, parentArrId: string, allSiblingIds: string[], childIrisIds: string[]) => void
  /** Toggle individual IRIS zone: propagates partial state up through quartier → arrondissement */
  toggleIris: (id: string, parentQuartierId: string, parentArrId: string, allQuartierSiblingIds: string[], allArrQuartierIds: string[]) => void
  /** Toggle suburban commune (no hierarchy) */
  toggleCommune: (id: string) => void
  /** Toggle IRIS zone inside a suburban commune — propagates up to commune */
  toggleCommuneIris: (id: string, parentCommuneId: string, allCommuneSiblingIds: string[]) => void
  setBudgetMax: (max: number | null) => void
  setPropertyTypes: (types: PropertyType[]) => void
  togglePropertyType: (type: PropertyType) => void
  setMinRooms: (min: number | null) => void
  setSurface: (min: number | null, max: number | null) => void
  togglePriority: (priority: string) => void
  completeOnboarding: () => void
  resetOnboarding: () => void
}

export const useSearchStore = create<SearchStore>()(
  persist(
    (set, get) => ({
      locationQuery: '',
      locationLabel: '',
      locationLat: null,
      locationLng: null,
      locationRadius: 2,
      locationIntent: null,
      selectedArrIds: [],
      selectedQuartierIds: [],
      selectedIrisIds: [],
      selectedCommuneIds: [],
      budgetMax: null,
      propertyTypes: [],
      minRooms: null,
      minSurface: null,
      maxSurface: null,
      priorities: [],
      onboardingCompleted: false,

      setLocation: ({ query, label, lat, lng, intent }) =>
        set({ locationQuery: query, locationLabel: label, locationLat: lat, locationLng: lng, locationIntent: intent ?? null }),

      setLocationRadius: (radius) => set({ locationRadius: radius }),

      setSelectedArrs: (ids) => set({ selectedArrIds: ids }),

      toggleArr: (id, childQuartierIds, childIrisIds) => {
        const { selectedArrIds, selectedQuartierIds, selectedIrisIds } = get()
        const isSelected = selectedArrIds.includes(id)
        if (isSelected) {
          set({
            selectedArrIds: selectedArrIds.filter((a) => a !== id),
            selectedQuartierIds: selectedQuartierIds.filter((q) => !childQuartierIds.includes(q)),
            selectedIrisIds: selectedIrisIds.filter((i) => !childIrisIds.includes(i)),
          })
        } else {
          set({
            selectedArrIds: [...selectedArrIds, id],
            selectedQuartierIds: [...new Set([...selectedQuartierIds, ...childQuartierIds])],
            selectedIrisIds: [...new Set([...selectedIrisIds, ...childIrisIds])],
          })
        }
      },

      toggleQuartier: (id, parentArrId, allSiblingIds, childIrisIds) => {
        const { selectedArrIds, selectedQuartierIds, selectedIrisIds } = get()
        const isSelected = selectedQuartierIds.includes(id)
        let newQuartierIds: string[]
        let newIrisIds: string[]

        if (isSelected) {
          newQuartierIds = selectedQuartierIds.filter((q) => q !== id)
          newIrisIds = selectedIrisIds.filter((i) => !childIrisIds.includes(i))
        } else {
          newQuartierIds = [...selectedQuartierIds, id]
          newIrisIds = [...new Set([...selectedIrisIds, ...childIrisIds])]
        }

        // Recompute parent arr state
        const selectedSiblings = allSiblingIds.filter((s) => newQuartierIds.includes(s))
        let newArrIds = selectedArrIds
        if (selectedSiblings.length === 0) {
          newArrIds = newArrIds.filter((a) => a !== parentArrId)
        } else if (selectedSiblings.length === allSiblingIds.length) {
          if (!newArrIds.includes(parentArrId)) newArrIds = [...newArrIds, parentArrId]
        } else {
          newArrIds = newArrIds.filter((a) => a !== parentArrId)
        }
        set({ selectedArrIds: newArrIds, selectedQuartierIds: newQuartierIds, selectedIrisIds: newIrisIds })
      },

      toggleIris: (id, parentQuartierId, parentArrId, allQuartierSiblingIds, allArrQuartierIds) => {
        const { selectedArrIds, selectedQuartierIds, selectedIrisIds } = get()
        const isSelected = selectedIrisIds.includes(id)
        const newIrisIds = isSelected ? selectedIrisIds.filter((i) => i !== id) : [...selectedIrisIds, id]

        // Recompute parent quartier state
        const selectedQuartierSiblings = allQuartierSiblingIds.filter((s) => newIrisIds.includes(s))
        let newQuartierIds = selectedQuartierIds
        if (selectedQuartierSiblings.length === 0) {
          newQuartierIds = newQuartierIds.filter((q) => q !== parentQuartierId)
        } else if (selectedQuartierSiblings.length === allQuartierSiblingIds.length) {
          if (!newQuartierIds.includes(parentQuartierId)) newQuartierIds = [...newQuartierIds, parentQuartierId]
        } else {
          newQuartierIds = newQuartierIds.filter((q) => q !== parentQuartierId)
        }

        // Recompute parent arr state
        const selectedArrQuartiers = allArrQuartierIds.filter((q) => newQuartierIds.includes(q))
        let newArrIds = selectedArrIds
        if (selectedArrQuartiers.length === 0) {
          newArrIds = newArrIds.filter((a) => a !== parentArrId)
        } else if (selectedArrQuartiers.length === allArrQuartierIds.length) {
          if (!newArrIds.includes(parentArrId)) newArrIds = [...newArrIds, parentArrId]
        } else {
          newArrIds = newArrIds.filter((a) => a !== parentArrId)
        }
        set({ selectedArrIds: newArrIds, selectedQuartierIds: newQuartierIds, selectedIrisIds: newIrisIds })
      },

      toggleCommune: (id) => {
        const { selectedCommuneIds } = get()
        set({
          selectedCommuneIds: selectedCommuneIds.includes(id)
            ? selectedCommuneIds.filter((c) => c !== id)
            : [...selectedCommuneIds, id],
        })
      },

      toggleCommuneIris: (id, parentCommuneId, allCommuneSiblingIds) => {
        const { selectedCommuneIds, selectedIrisIds } = get()
        const isSelected = selectedIrisIds.includes(id)
        const newIrisIds = isSelected
          ? selectedIrisIds.filter((i) => i !== id)
          : [...selectedIrisIds, id]

        // Propagate to parent commune
        const selectedSiblings = allCommuneSiblingIds.filter((s) => newIrisIds.includes(s))
        let newCommuneIds = selectedCommuneIds
        if (selectedSiblings.length === 0) {
          newCommuneIds = newCommuneIds.filter((c) => c !== parentCommuneId)
        } else if (selectedSiblings.length === allCommuneSiblingIds.length) {
          if (!newCommuneIds.includes(parentCommuneId)) newCommuneIds = [...newCommuneIds, parentCommuneId]
        } else {
          newCommuneIds = newCommuneIds.filter((c) => c !== parentCommuneId)
        }
        set({ selectedCommuneIds: newCommuneIds, selectedIrisIds: newIrisIds })
      },

      setBudgetMax: (max) => set({ budgetMax: max }),
      setPropertyTypes: (types) => set({ propertyTypes: types }),
      togglePropertyType: (type) =>
        set((s) => ({ propertyTypes: s.propertyTypes.includes(type) ? s.propertyTypes.filter((t) => t !== type) : [...s.propertyTypes, type] })),
      setMinRooms: (min) => set({ minRooms: min }),
      setSurface: (min, max) => set({ minSurface: min, maxSurface: max }),
      togglePriority: (priority) =>
        set((s) => ({ priorities: s.priorities.includes(priority) ? s.priorities.filter((p) => p !== priority) : [...s.priorities, priority] })),
      completeOnboarding: () => set({ onboardingCompleted: true }),
      resetOnboarding: () =>
        set({
          locationQuery: '', locationLabel: '', locationLat: null, locationLng: null, locationRadius: 2,
          locationIntent: null, selectedArrIds: [], selectedQuartierIds: [], selectedIrisIds: [], selectedCommuneIds: [],
          budgetMax: null, propertyTypes: [], minRooms: null, minSurface: null, maxSurface: null,
          priorities: [], onboardingCompleted: false,
        }),
    }),
    {
      name: 'shomee-search',
      partialize: (state) => ({
        budgetMax: state.budgetMax,
        propertyTypes: state.propertyTypes,
        minRooms: state.minRooms,
        minSurface: state.minSurface,
        maxSurface: state.maxSurface,
        priorities: state.priorities,
        onboardingCompleted: state.onboardingCompleted,
      }),
    }
  )
)
