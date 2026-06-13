import { create } from 'zustand'
import type { StateStorage } from 'zustand/middleware'
import type { Property } from '../types/domain'

interface FeedState {
  /** Feed courant — survit aux navigations internes (mémoire, durée de session). */
  properties: Property[]
  /** Identifiant de la génération courante (sait si un feed est déjà chargé). */
  feedSessionId: string | null
  /**
   * Index de la carte active du feed. Consolidé ici (il vivait avant dans
   * useShomeeStore) : c'est une donnée de feed, on garde une source unique.
   */
  currentIndex: number

  /** Pose le feed + son identifiant de génération. Remet l'index à 0. */
  setFeed: (properties: Property[], sessionId: string) => void
  /** Vide le feed (changement de brief / reset onboarding). */
  clearFeed: () => void
  /** True si un feed est déjà en mémoire. */
  hasFeed: () => boolean
  setCurrentIndex: (index: number) => void
}

/**
 * Feed store — TRANSIENT, en mémoire uniquement. **Pas** de middleware
 * `persist` : le feed survit à toute navigation interne tant que l'app reste
 * ouverte, mais un vrai reload le perd (acceptable et cohérent).
 *
 * La factory reçoit la même signature `getStorage` que createShomeeStore /
 * createSearchStore par cohérence avec @shomee/core, MAIS ne l'utilise pas
 * (aucune persistance). Sur mobile, ce même store donnera la persistance feed
 * inter-onglets gratuitement, sans réécriture.
 */
export function createFeedStore(_getStorage: () => StateStorage) {
  void _getStorage // parité de signature uniquement — store volontairement transient
  return create<FeedState>()((set, get) => ({
    properties: [],
    feedSessionId: null,
    currentIndex: 0,

    setFeed: (properties, sessionId) =>
      set({ properties, feedSessionId: sessionId, currentIndex: 0 }),

    clearFeed: () => set({ properties: [], feedSessionId: null, currentIndex: 0 }),

    hasFeed: () => get().properties.length > 0,

    setCurrentIndex: (index) => {
      if (index === get().currentIndex) return
      set({ currentIndex: index })
    },
  }))
}

export type FeedStore = ReturnType<typeof createFeedStore>
