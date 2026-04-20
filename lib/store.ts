import { create } from 'zustand'
import type { Conversation, ChatMessage } from './types'

interface ShomeeState {
  currentIndex: number
  favorites: string[]
  conversations: Conversation[]

  setCurrentIndex: (index: number) => void
  toggleFavorite: (id: string) => void
  addMessage: (propertyId: string, msg: ChatMessage) => void
  markUserMessagesRead: (propertyId: string) => void
  markConversationSeen: (propertyId: string) => void
}

export const useShomeeStore = create<ShomeeState>((set, get) => ({
  currentIndex: 0,
  favorites: [],
  conversations: [],

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
}))

/** True if the conversation has agent messages the user hasn't seen yet */
export function hasUnread(conv: Conversation): boolean {
  return conv.messages.some(m => m.from === 'agent' && m.timestamp > conv.lastSeenAt)
}
