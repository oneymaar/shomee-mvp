import { create } from 'zustand'
import type { Property } from './types'

interface ShomeeState {
  currentIndex: number
  favorites: string[]

  setCurrentIndex: (index: number) => void
  toggleFavorite: (id: string) => void
}

export const useShomeeStore = create<ShomeeState>((set, get) => ({
  currentIndex: 0,
  favorites: [],

  setCurrentIndex: (index: number) => {
    if (index === get().currentIndex) return
    set({ currentIndex: index })
  },

  toggleFavorite: (id: string) => {
    set((state) => ({
      favorites: state.favorites.includes(id)
        ? state.favorites.filter((f) => f !== id)
        : [...state.favorites, id],
    }))
  },
}))
