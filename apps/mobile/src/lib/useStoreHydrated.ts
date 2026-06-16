import { useEffect, useState } from 'react'

/**
 * Indique si un store persisté a fini de réhydrater depuis AsyncStorage.
 *
 * AsyncStorage est asynchrone : au démarrage, un store persisté rend d'abord
 * son état initial (vide), puis l'état disque arrive. Le middleware `persist`
 * de Zustand expose `persist.hasHydrated()` + `persist.onFinishHydration()` —
 * ce hook les rend réactifs pour React (re-render au passage false → true).
 *
 * Mécanisme uniquement (Session 3). Le gating UX réel (masquer les favoris /
 * gérer la redirection pendant l'hydratation) se câblera sur les vrais écrans
 * en Session 4/6.
 *
 * À n'utiliser que sur les stores PERSISTÉS (useShomeeStore, useSearchStore).
 * Le feedStore est transient et n'a pas d'API `persist`.
 */
type PersistedStore = {
  persist: {
    hasHydrated: () => boolean
    onFinishHydration: (cb: () => void) => () => void
  }
}

export function useStoreHydrated(store: PersistedStore): boolean {
  const [hydrated, setHydrated] = useState(() => store.persist.hasHydrated())

  useEffect(() => {
    // Rattrape le cas où l'hydratation finit entre le 1er render et l'effet.
    if (store.persist.hasHydrated()) setHydrated(true)
    const unsub = store.persist.onFinishHydration(() => setHydrated(true))
    return unsub
  }, [store])

  return hydrated
}
