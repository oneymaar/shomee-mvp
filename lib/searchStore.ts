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

export type PropertyType = 'appartement' | 'maison' | 'loft' | 'atelier'

/** 3-state chip: 0 = unselected, 1 = desired, 2 = mandatory. */
export type ChipState = 0 | 1 | 2

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
  budgetMin: number | null
  budgetMax: number | null
  propertyTypes: PropertyType[]
  minRooms: number | null
  minSurface: number | null
  maxSurface: number | null
  /** 3-state per chip — keyed by chip label. Covers both "Le bien" and
   *  "L'immeuble" chips. Absent = state 0 (unselected). */
  chipStates: Record<string, ChipState>
  /** User-added criteria. Same 3-state semantics; default state 1 on add. */
  customCriteria: Array<{ id: string; label: string; state: ChipState }>
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
  setBudgetMin: (min: number | null) => void
  setBudgetMax: (max: number | null) => void
  setBudgetRange: (min: number | null, max: number | null) => void
  setPropertyTypes: (types: PropertyType[]) => void
  togglePropertyType: (type: PropertyType) => void
  setMinRooms: (min: number | null) => void
  setSurface: (min: number | null, max: number | null) => void
  /** Cycle a chip 0 → 1 → 2 → 0. */
  cycleChipState: (label: string) => void
  /** Cycle a custom criterion 0 → 1 → 2 → 0. */
  cycleCustomCriteriaState: (id: string) => void
  /** Add new custom criteria — created at state 1 (desired) by default. */
  addCustomCriteria: (items: Array<{ label: string }>) => void
  removeCustomCriteria: (id: string) => void
  clearCustomCriteria: () => void
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
      budgetMin: null,
      budgetMax: null,
      propertyTypes: [],
      minRooms: null,
      minSurface: null,
      maxSurface: null,
      chipStates: {},
      customCriteria: [],
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

      setBudgetMin: (min) => set({ budgetMin: min }),
      setBudgetMax: (max) => set({ budgetMax: max }),
      setBudgetRange: (min, max) => set({ budgetMin: min, budgetMax: max }),
      setPropertyTypes: (types) => set({ propertyTypes: types }),
      togglePropertyType: (type) =>
        set((s) => ({ propertyTypes: s.propertyTypes.includes(type) ? s.propertyTypes.filter((t) => t !== type) : [...s.propertyTypes, type] })),
      setMinRooms: (min) => set({ minRooms: min }),
      setSurface: (min, max) => set({ minSurface: min, maxSurface: max }),
      cycleChipState: (label) =>
        set((s) => {
          const current = s.chipStates[label] ?? 0
          const next = ((current + 1) % 3) as ChipState
          const nextStates = { ...s.chipStates }
          if (next === 0) delete nextStates[label]
          else nextStates[label] = next
          return { chipStates: nextStates }
        }),
      cycleCustomCriteriaState: (id) =>
        set((s) => ({
          customCriteria: s.customCriteria.map((c) =>
            c.id === id ? { ...c, state: ((c.state + 1) % 3) as ChipState } : c,
          ),
        })),
      addCustomCriteria: (items) =>
        set((s) => ({
          customCriteria: [
            ...s.customCriteria,
            ...items.map((it) => ({
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              label: it.label,
              state: 1 as ChipState,
            })),
          ],
        })),
      removeCustomCriteria: (id) =>
        set((s) => ({ customCriteria: s.customCriteria.filter((c) => c.id !== id) })),
      clearCustomCriteria: () => set({ customCriteria: [] }),
      completeOnboarding: () => set({ onboardingCompleted: true }),
      resetOnboarding: () =>
        set({
          locationQuery: '', locationLabel: '', locationLat: null, locationLng: null, locationRadius: 2,
          locationIntent: null, selectedArrIds: [], selectedQuartierIds: [], selectedIrisIds: [], selectedCommuneIds: [],
          budgetMin: null, budgetMax: null, propertyTypes: [], minRooms: null, minSurface: null, maxSurface: null,
          chipStates: {}, customCriteria: [], onboardingCompleted: false,
        }),
    }),
    {
      name: 'shomee-search',
      partialize: (state) => ({
        budgetMin: state.budgetMin,
        budgetMax: state.budgetMax,
        propertyTypes: state.propertyTypes,
        minRooms: state.minRooms,
        minSurface: state.minSurface,
        maxSurface: state.maxSurface,
        chipStates: state.chipStates,
        customCriteria: state.customCriteria,
        onboardingCompleted: state.onboardingCompleted,
      }),
    }
  )
)
