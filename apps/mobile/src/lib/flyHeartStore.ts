import { create } from 'zustand'

/**
 * flyHeartStore — coordination de l'animation « fly-heart » (cœur qui vole du
 * rail d'action vers l'onglet Favoris). Store UI transient, mobile-only (aucun
 * lien avec les stores métier de @shomee/core).
 *
 * - la source (cœur du rail) appelle `launch(from)` à l'instant du tap ;
 * - la cible (icône Favoris) enregistre son centre mesuré via `setTarget` ;
 * - l'overlay racine rend un <FlyingHeart> par vol ;
 * - `land(id)` retire le vol ET incrémente `pulseToken` → l'onglet rebondit.
 */

export type XY = { x: number; y: number }

export type HeartFlight = {
  id: string
  from: XY
}

const MAX_CONCURRENT = 8

type FlyHeartState = {
  target: XY | null
  flights: HeartFlight[]
  pulseToken: number
  setTarget: (xy: XY) => void
  launch: (from: XY) => void
  land: (id: string) => void
}

export const useFlyHeartStore = create<FlyHeartState>((set, get) => ({
  target: null,
  flights: [],
  pulseToken: 0,
  setTarget: (xy) => set({ target: xy }),
  launch: (from) => {
    const { target, flights } = get()
    if (!target) return // onglet pas encore mesuré → on ignore silencieusement
    if (flights.length >= MAX_CONCURRENT) return
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    set({ flights: [...flights, { id, from }] })
  },
  land: (id) =>
    set((s) => ({
      flights: s.flights.filter((f) => f.id !== id),
      pulseToken: s.pulseToken + 1, // pulse déclenché à l'arrivée
    })),
}))
