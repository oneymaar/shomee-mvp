'use client'

/**
 * Web instance du feed store (transient, en mémoire).
 *
 * La logique + la factory vivent dans `@shomee/core`. Ce store n'utilise PAS
 * de persistance : le thunk storage est fourni pour la parité de signature
 * avec les autres stores mais n'est jamais appelé. Le feed survit donc aux
 * navigations internes (favoris/messages/feed) et est perdu au reload.
 */
import { createFeedStore } from '@shomee/core/stores/feedStore'

export * from '@shomee/core/stores/feedStore'

export const useFeedStore = createFeedStore(() => localStorage)
