/**
 * Web instance of the favorites/conversations store.
 *
 * The store logic + factory live in `@shomee/core`; here we bind it to
 * `localStorage` (key 'shomee-favorites', partialize unchanged) and re-export
 * the rest of the module's surface so existing `@/lib/store` imports keep
 * working unchanged. The localStorage thunk is evaluated lazily at hydration
 * (this module is only imported by client components, as before).
 */
import { createShomeeStore } from '@shomee/core/stores/store'

export * from '@shomee/core/stores/store'

export const useShomeeStore = createShomeeStore(() => localStorage)
