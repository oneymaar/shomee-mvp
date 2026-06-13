import { create } from 'zustand'
import { persist, createJSONStorage, type StateStorage } from 'zustand/middleware'
import type { Conversation, ChatMessage, Property } from '../types/domain'

interface ShomeeState {
  /**
   * Fiches complètes des biens favoris (générés ou statiques).
   * On stocke l'objet entier — et non juste l'id — pour que la vue Favoris
   * reste fonctionnelle pour les biens générés à la volée, qui ne sont pas
   * présents dans `lib/mockData.ts`.
   */
  favorites: Property[]
  conversations: Conversation[]

  /** Ajoute une fiche complète aux favoris (no-op si déjà présente). */
  addFavorite: (property: Property) => void
  /** Retire un favori par son id. */
  removeFavorite: (id: string) => void
  /** Ajoute/retire selon l'état courant. Accepte la fiche entière. */
  toggleFavorite: (property: Property) => void
  /** True si le bien est déjà en favori. */
  isFavorite: (id: string) => boolean
  addMessage: (propertyId: string, msg: ChatMessage) => void
  markUserMessagesRead: (propertyId: string) => void
  markConversationSeen: (propertyId: string) => void
}

/**
 * Factory — the persistence backend (localStorage on web, AsyncStorage on
 * mobile) is injected as a thunk so the store stays platform-agnostic. The
 * thunk is invoked lazily by zustand at hydration time, preserving the
 * original browser-only access. Name + partialize are platform-independent
 * and identical to the original singleton.
 */
export function createShomeeStore(getStorage: () => StateStorage) {
  return create<ShomeeState>()(
  persist(
    (set, get) => ({
      favorites: [],
      conversations: [],

      addFavorite: (property: Property) => {
        set((state) =>
          state.favorites.some((f) => f.id === property.id)
            ? state
            : { favorites: [...state.favorites, property] },
        )
      },

      removeFavorite: (id: string) => {
        set((state) => ({
          favorites: state.favorites.filter((f) => f.id !== id),
        }))
      },

      toggleFavorite: (property: Property) => {
        set((state) => ({
          favorites: state.favorites.some((f) => f.id === property.id)
            ? state.favorites.filter((f) => f.id !== property.id)
            : [...state.favorites, property],
        }))
      },

      isFavorite: (id: string) => get().favorites.some((f) => f.id === id),

  addMessage: (propertyId, msg) => {
    set(state => {
      const exists = state.conversations.some(c => c.propertyId === propertyId)
      if (exists) {
        return {
          conversations: state.conversations.map(c =>
            c.propertyId === propertyId
              ? { ...c, messages: [...c.messages, msg] }
              : c,
          ),
        }
      }
      return { conversations: [...state.conversations, { propertyId, messages: [msg], lastSeenAt: 0 }] }
    })
  },

  markUserMessagesRead: (propertyId) => {
    set(state => ({
      conversations: state.conversations.map(c =>
        c.propertyId === propertyId
          ? { ...c, messages: c.messages.map(m => m.from === 'user' ? { ...m, read: true } : m) }
          : c,
      ),
    }))
  },

  markConversationSeen: (propertyId) => {
    set(state => ({
      conversations: state.conversations.map(c =>
        c.propertyId === propertyId ? { ...c, lastSeenAt: Date.now() } : c,
      ),
    }))
  },
    }),
    {
      name: 'shomee-favorites',
      storage: createJSONStorage(getStorage),
      // On ne persiste que les favoris — conversations reste éphémère
      // (et currentIndex vit désormais dans le feedStore transient).
      partialize: (state) => ({ favorites: state.favorites }),
    },
  ),
  )
}

export type ShomeeStore = ReturnType<typeof createShomeeStore>

/** True if the conversation has agent messages the user hasn't seen yet */
export function hasUnread(conv: Conversation): boolean {
  return conv.messages.some(m => m.from === 'agent' && m.timestamp > conv.lastSeenAt)
}
