import { create } from 'zustand'
import type { Property } from './types'
import { properties } from './mockData'

interface ShomeeState {
  currentIndex: number
  favorites: string[]
  showSkipModal: boolean
  skippedProperty: Property | null

  setCurrentIndex: (index: number) => void
  toggleFavorite: (id: string) => void
  closeSkipFeedback: () => void
  dismissAndStay: () => void
}

export const useShomeeStore = create<ShomeeState>((set, get) => ({
  currentIndex: 0,
  favorites: [],
  showSkipModal: false,
  skippedProperty: null,

  // Called by IntersectionObserver when a card becomes active.
  // If the user scrolled forward past a "promising" property, show the skip modal.
  setCurrentIndex: (index: number) => {
    const { currentIndex } = get()
    if (index === currentIndex) return

    const prevProperty = properties[currentIndex]
    const scrolledForward = index > currentIndex

    if (scrolledForward && prevProperty?.promising) {
      set({ currentIndex: index, showSkipModal: true, skippedProperty: prevProperty })
    } else {
      set({ currentIndex: index })
    }
  },

  toggleFavorite: (id: string) => {
    set((state) => ({
      favorites: state.favorites.includes(id)
        ? state.favorites.filter((f) => f !== id)
        : [...state.favorites, id],
    }))
  },

  closeSkipFeedback: () => {
    set({ showSkipModal: false, skippedProperty: null })
  },

  // "Voir quand même" — close modal and scroll back (handled in FeedPage)
  dismissAndStay: () => {
    set({ showSkipModal: false, skippedProperty: null })
  },
}))
