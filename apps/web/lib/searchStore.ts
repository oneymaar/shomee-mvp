'use client'

/**
 * Web instance of the search/onboarding store.
 *
 * The store logic + factory live in `@shomee/core`; here we bind it to
 * `localStorage` (default storage, key 'shomee-search-v2', partialize
 * unchanged) and re-export the rest of the module's surface so existing
 * `@/lib/searchStore` imports keep working unchanged.
 */
import { createSearchStore } from '@shomee/core/stores/searchStore'

export * from '@shomee/core/stores/searchStore'

export const useSearchStore = createSearchStore(() => localStorage)
