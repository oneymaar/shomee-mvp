/**
 * Stockage sécurisé du token de session. Utilise expo-secure-store si présent
 * (Keychain iOS), sinon retombe sur AsyncStorage (déjà installé) — require-guard
 * pour rester tsc-clean tant que le module natif n'est pas installé/rebuild.
 */
import AsyncStorage from '@react-native-async-storage/async-storage'

interface SecureStoreModule {
  getItemAsync: (key: string) => Promise<string | null>
  setItemAsync: (key: string, value: string) => Promise<void>
  deleteItemAsync: (key: string) => Promise<void>
}

let mod: SecureStoreModule | null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mod = require('expo-secure-store')
} catch {
  mod = null
}

export async function secureGet(key: string): Promise<string | null> {
  if (mod) {
    try {
      return await mod.getItemAsync(key)
    } catch {
      /* fallthrough vers AsyncStorage */
    }
  }
  try {
    return await AsyncStorage.getItem(key)
  } catch {
    return null
  }
}

export async function secureSet(key: string, value: string): Promise<void> {
  if (mod) {
    try {
      await mod.setItemAsync(key, value)
      return
    } catch {
      /* fallthrough */
    }
  }
  try {
    await AsyncStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

export async function secureDelete(key: string): Promise<void> {
  if (mod) {
    try {
      await mod.deleteItemAsync(key)
      return
    } catch {
      /* fallthrough */
    }
  }
  try {
    await AsyncStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}
