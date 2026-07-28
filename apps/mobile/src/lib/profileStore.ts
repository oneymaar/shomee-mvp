import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import AsyncStorage from '@react-native-async-storage/async-storage'

interface ProfileState {
  /** URI local de la photo de profil (retourné par expo-image-picker), ou null. */
  photoUri: string | null
  setPhoto: (uri: string | null) => void
}

/**
 * Store profil local — mobile uniquement, persisté (AsyncStorage, clé
 * `shomee-profile`). Volontairement séparé des stores core partagés dont la
 * shape est figée (favoris/conversations/brief). Ne contient pour l'instant que
 * la photo de profil.
 */
export const useProfileStore = create<ProfileState>()(
  persist(
    (set) => ({
      photoUri: null,
      setPhoto: (uri) => set({ photoUri: uri }),
    }),
    { name: 'shomee-profile', storage: createJSONStorage(() => AsyncStorage) },
  ),
)
