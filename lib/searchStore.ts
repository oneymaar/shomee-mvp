'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface LocationIntent {
  location_terms: string[]
  lifestyle_terms: string[]
  transport_constraints: string[]
  confidence: number
}

export type PropertyType = 'appartement' | 'maison' | 'studio' | 'loft' | 'duplex'

export interface SearchPreferences {
  locationQuery: string
  locationLabel: string
  locationLat: number | null
  locationLng: number | null
  locationRadius: number
  locationIntent: LocationIntent | null
  // Hierarchical zone selection
  selectedArrIds: string[]    // e.g. ['arr-11', 'arr-12']
  selectedQuartierIds: string[] // e.g. ['qu-41', 'qu-42'] — explicit quartier selection at high zoom
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
  toggleArr: (id: string, childIds: string[]) => void
  toggleQuartier: (id: string, parentId: string, allSiblingIds: string[]) => void
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

      /** Toggle an arrondissement. childIds = all quartier IDs belonging to this arr. */
      toggleArr: (id, childIds) => {
        const state = get()
        const isSelected = state.selectedArrIds.includes(id)
        if (isSelected) {
          // Deselect arr + all its quartiers
          set({
            selectedArrIds: state.selectedArrIds.filter((a) => a !== id),
            selectedQuartierIds: state.selectedQuartierIds.filter((q) => !childIds.includes(q)),
          })
        } else {
          // Select arr + all its quartiers
          const newQuartierIds = [...new Set([...state.selectedQuartierIds, ...childIds])]
          set({
            selectedArrIds: [...state.selectedArrIds, id],
            selectedQuartierIds: newQuartierIds,
          })
        }
      },

      /** Toggle a single quartier. Updates parent partial/full state accordingly. */
      toggleQuartier: (id, parentId, allSiblingIds) => {
        const state = get()
        const isSelected = state.selectedQuartierIds.includes(id)
        let newQuartierIds: string[]
        if (isSelected) {
          newQuartierIds = state.selectedQuartierIds.filter((q) => q !== id)
        } else {
          newQuartierIds = [...state.selectedQuartierIds, id]
        }

        // Recompute parent arr selection
        const selectedSiblings = allSiblingIds.filter((s) => newQuartierIds.includes(s))
        let newArrIds = state.selectedArrIds
        if (selectedSiblings.length === 0) {
          // No siblings selected → parent not selected
          newArrIds = newArrIds.filter((a) => a !== parentId)
        } else if (selectedSiblings.length === allSiblingIds.length) {
          // All siblings selected → parent fully selected
          if (!newArrIds.includes(parentId)) newArrIds = [...newArrIds, parentId]
        } else {
          // Partial → parent removed from fully-selected list (handled by partial state in UI)
          newArrIds = newArrIds.filter((a) => a !== parentId)
        }

        set({ selectedQuartierIds: newQuartierIds, selectedArrIds: newArrIds })
      },

      setBudgetMax: (max) => set({ budgetMax: max }),

      setPropertyTypes: (types) => set({ propertyTypes: types }),

      togglePropertyType: (type) =>
        set((state) => ({
          propertyTypes: state.propertyTypes.includes(type)
            ? state.propertyTypes.filter((t) => t !== type)
            : [...state.propertyTypes, type],
        })),

      setMinRooms: (min) => set({ minRooms: min }),

      setSurface: (min, max) => set({ minSurface: min, maxSurface: max }),

      togglePriority: (priority) =>
        set((state) => ({
          priorities: state.priorities.includes(priority)
            ? state.priorities.filter((p) => p !== priority)
            : [...state.priorities, priority],
        })),

      completeOnboarding: () => set({ onboardingCompleted: true }),

      resetOnboarding: () =>
        set({
          locationQuery: '',
          locationLabel: '',
          locationLat: null,
          locationLng: null,
          locationRadius: 2,
          locationIntent: null,
          selectedArrIds: [],
          selectedQuartierIds: [],
          budgetMax: null,
          propertyTypes: [],
          minRooms: null,
          minSurface: null,
          maxSurface: null,
          priorities: [],
          onboardingCompleted: false,
        }),
    }),
    { name: 'shomee-search' }
  )
)
