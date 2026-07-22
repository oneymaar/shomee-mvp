/**
 * Sign in with Apple — wrapper require-guard autour d'expo-apple-authentication.
 * Renvoie l'identityToken (JWT signé Apple, vérifié côté serveur) + le nom
 * (Apple ne le fournit qu'à la 1re autorisation).
 */
interface AppleFullName {
  givenName?: string | null
  familyName?: string | null
}
interface AppleCredential {
  identityToken: string | null
  fullName?: AppleFullName | null
  email?: string | null
}
interface AppleModule {
  isAvailableAsync: () => Promise<boolean>
  signInAsync: (opts: { requestedScopes: number[] }) => Promise<AppleCredential>
  AppleAuthenticationScope: { FULL_NAME: number; EMAIL: number }
}

let mod: AppleModule | null
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  mod = require('expo-apple-authentication')
} catch {
  mod = null
}

export const appleModuleAvailable = mod != null

export async function signInWithApple(): Promise<{ identityToken: string; fullName?: string } | null> {
  if (!mod) return null
  try {
    const cred = await mod.signInAsync({
      requestedScopes: [mod.AppleAuthenticationScope.FULL_NAME, mod.AppleAuthenticationScope.EMAIL],
    })
    if (!cred.identityToken) return null
    const parts = [cred.fullName?.givenName, cred.fullName?.familyName].filter((p): p is string => !!p)
    const fullName = parts.length ? parts.join(' ') : undefined
    return { identityToken: cred.identityToken, fullName }
  } catch {
    // Annulation utilisateur ou erreur → pas de connexion.
    return null
  }
}
