/**
 * Instances mobiles des stores Zustand de @shomee/core.
 *
 * Pendant des shims web (`apps/web/lib/{store,searchStore,feedStore}.ts`) : la
 * logique + les factories vivent dans core, ici on injecte le backend de
 * persistance. Côté mobile c'est AsyncStorage (au lieu de localStorage).
 *
 * AsyncStorage implémente l'interface `StateStorage` de Zustand (getItem /
 * setItem / removeItem renvoient des Promises). `createJSONStorage`, utilisé
 * dans les factories de core, gère nativement le storage asynchrone — l'injection
 * est donc directe. Les clés et `partialize` sont définis dans core et restent
 * identiques au web (shomee-favorites, shomee-search-v2).
 *
 * Un seul module consolidé (plutôt que 3 fichiers re-exportant chacun le barrel)
 * pour éviter toute ambiguïté de ré-export.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import {
  createShomeeStore,
  createSearchStore,
  createFeedStore,
} from '@shomee/core/stores'

// Re-exporte la surface du barrel (types, helpers, constantes) — point d'accès
// unique pour les écrans à venir. Pas de collision : les hooks ci-dessous ont
// des noms distincts des exports du barrel.
export * from '@shomee/core/stores'

// Favoris + conversations — persiste `favorites` sous `shomee-favorites`.
export const useShomeeStore = createShomeeStore(() => AsyncStorage)

// Brief / onboarding — persiste le brief sous `shomee-search-v2`.
export const useSearchStore = createSearchStore(() => AsyncStorage)

// Feed transient (pas de persistance) — storage ignoré, parité de signature.
export const useFeedStore = createFeedStore(() => AsyncStorage)
