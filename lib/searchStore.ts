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

/** 4-state chip: 0 = unselected, 1 = desired, 2 = mandatory, 3 = dealbreaker. */
export type ChipState = 0 | 1 | 2 | 3

/** Prefixes triggering automatic negative/dealbreaker creation when an
 *  AI-parsed custom criterion is added. Order matters: longest first so
 *  "pas de " strips fully before "pas " can hit. */
const NEGATIVE_PREFIXES = [
  'pas de ',
  'sans le ',
  'sans la ',
  'aucun ',
  'aucune ',
  'pas ',
  'sans ',
  'ni ',
  'no ',
]

function detectNegative(label: string): { isNegative: boolean; cleanLabel: string } {
  const lower = label.toLowerCase()
  for (const p of NEGATIVE_PREFIXES) {
    if (lower.startsWith(p)) {
      const rest = label.slice(p.length).trim()
      if (rest.length === 0) return { isNegative: false, cleanLabel: label }
      const cleanLabel = rest.charAt(0).toUpperCase() + rest.slice(1)
      return { isNegative: true, cleanLabel }
    }
  }
  return { isNegative: false, cleanLabel: label }
}

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
  /** 4-state per chip — keyed by chip label. Covers both "Le bien" and
   *  "L'immeuble" chips. Absent = state 0 (unselected). */
  chipStates: Record<string, ChipState>
  /** User-added criteria. Same 4-state semantics; default state 1 on add,
   *  or state 3 (dealbreaker) when the original input started with a
   *  negative prefix like "pas de" / "sans". `polarity` is fixed at add
   *  time and travels with the criterion into the matching brief. */
  customCriteria: Array<{
    id: string
    label: string
    state: ChipState
    polarity: 'positive' | 'negative'
  }>
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
  /** Cycle a chip 0 → 1 → 2 → 3 → 0. */
  cycleChipState: (label: string) => void
  /** Cycle a custom criterion 0 → 1 → 2 → 3 → 0. */
  cycleCustomCriteriaState: (id: string) => void
  /** Add new custom criteria. Without overrides: state defaults to 1 (desired),
   *  or 3 (dealbreaker) if the label starts with a negative prefix.
   *  Pass `state` / `polarity` to bypass auto-detection (used by the AI
   *  import flow where the brief already carries explicit values). */
  addCustomCriteria: (items: Array<{
    label: string
    state?: ChipState
    polarity?: 'positive' | 'negative'
  }>) => void
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
          const next = ((current + 1) % 4) as ChipState
          const nextStates = { ...s.chipStates }
          if (next === 0) delete nextStates[label]
          else nextStates[label] = next
          return { chipStates: nextStates }
        }),
      cycleCustomCriteriaState: (id) =>
        set((s) => ({
          customCriteria: s.customCriteria.map((c) =>
            c.id === id ? { ...c, state: ((c.state + 1) % 4) as ChipState } : c,
          ),
        })),
      addCustomCriteria: (items) =>
        set((s) => ({
          customCriteria: [
            ...s.customCriteria,
            ...items.map((it) => {
              // Auto-detection runs only when the caller didn't provide
              // explicit overrides. The AI import flow passes both fields
              // so the brief's structured intent is preserved verbatim.
              const auto = detectNegative(it.label)
              const useAuto = it.state === undefined && it.polarity === undefined
              const label = useAuto ? auto.cleanLabel : it.label
              const state = (it.state ?? (auto.isNegative ? 3 : 1)) as ChipState
              const polarity = (it.polarity ?? (auto.isNegative ? 'negative' : 'positive')) as 'positive' | 'negative'
              return {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                label,
                state,
                polarity,
              }
            }),
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

// ─────────────────────────────────────────────────────────────────────────────
// buildSelectedCriteria — canonical shape consumed by the matching brief.
// ─────────────────────────────────────────────────────────────────────────────

export interface SelectedCriterion {
  label: string
  importance: 'desired' | 'mandatory' | 'dealbreaker'
  polarity: 'positive' | 'negative'
}

/**
 * Derive the canonical { label, importance, polarity } list expected by
 * downstream consumers (matching engine glue, AI summary screen) from the
 * chip-state map + custom criteria. State 0 entries are dropped.
 *
 *  - state 1 → desired     / positive
 *  - state 2 → mandatory   / positive
 *  - state 3 → dealbreaker / negative  ← exclusion when attribute present
 *
 * Custom criteria carry their own polarity (set at add-time via the
 * negative-prefix detection), so their state-3 entries inherit the
 * polarity they were created with.
 */
export function buildSelectedCriteria(
  chipStates: Record<string, ChipState>,
  customCriteria: Array<{ label: string; state: ChipState; polarity?: 'positive' | 'negative' }>,
): SelectedCriterion[] {
  const fromChips: SelectedCriterion[] = Object.entries(chipStates)
    .filter(([, state]) => state > 0)
    .map(([label, state]) => mapState(label, state as ChipState, 'positive'))
  const fromCustom: SelectedCriterion[] = customCriteria
    .filter((c) => c.state > 0)
    .map((c) => mapState(c.label, c.state, c.polarity ?? 'positive'))
  return [...fromChips, ...fromCustom]
}

function mapState(
  label: string,
  state: ChipState,
  polarity: 'positive' | 'negative',
): SelectedCriterion {
  switch (state) {
    case 3:
      return { label, importance: 'dealbreaker', polarity: 'negative' }
    case 2:
      return { label, importance: 'mandatory', polarity }
    case 1:
    default:
      return { label, importance: 'desired', polarity }
  }
}
