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
  selectedZoneIds: string[]
  budgetMax: number | null
  propertyTypes: PropertyType[]
  minRooms: number | null
  minSurface: number | null
  maxSurface: number | null
  priorities: string[]
  onboardingCompleted: boolean
}

interface SearchStore extends SearchPreferences {
  setLocation: (opts: {
    query: string
    label: string
    lat: number
    lng: number
    intent?: LocationIntent | null
  }) => void
  setLocationRadius: (radius: number) => void
  setSelectedZones: (ids: string[]) => void
  toggleZone: (id: string) => void
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
    (set) => ({
      locationQuery: '',
      locationLabel: '',
      locationLat: null,
      locationLng: null,
      locationRadius: 2,
      locationIntent: null,
      selectedZoneIds: [],
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

      setSelectedZones: (ids) => set({ selectedZoneIds: ids }),

      toggleZone: (id) =>
        set((state) => ({
          selectedZoneIds: state.selectedZoneIds.includes(id)
            ? state.selectedZoneIds.filter((z) => z !== id)
            : [...state.selectedZoneIds, id],
        })),

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
          selectedZoneIds: [],
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
