/**
 * Store d'auth utilisateur — singleton module + hook `useAuth` via
 * useSyncExternalStore (aucune dépendance). Détient le user + le statut de
 * session, persiste le JWT en SecureStore, et le pousse dans `sessionToken`
 * (lu par apiFetch). Trois voies de connexion : invité, Apple, Google.
 *
 * Le rattachement des données anonymes (events/affinités clés par deviceId) au
 * compte se fait CÔTÉ SERVEUR via UserDevice (le deviceId part dans chaque
 * requête de login), donc rien à migrer côté client ici.
 */
import { useSyncExternalStore } from 'react'
import { apiFetch } from '@/lib/api'
import { getDeviceId } from '@/lib/tracker'
import { setSessionToken } from '@/lib/sessionToken'
import { secureGet, secureSet, secureDelete } from '@/lib/secureStore'
import { signInWithApple } from '@/components/auth/appleAuth'

const TOKEN_KEY = 'shomee-session-token'

export interface AuthUser {
  id: string
  email: string | null
  name: string | null
  avatar: string | null
  role: string
  isGuest: boolean
}

export type AuthStatus = 'loading' | 'authed' | 'anon'

interface AuthState {
  status: AuthStatus
  user: AuthUser | null
  busy: boolean
}

let state: AuthState = { status: 'loading', user: null, busy: false }
const listeners = new Set<() => void>()

function emit() {
  for (const l of listeners) l()
}
function setState(patch: Partial<AuthState>) {
  state = { ...state, ...patch }
  emit()
}
function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}
function getSnapshot(): AuthState {
  return state
}

export function useAuth(): AuthState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/** Au boot : restaure le token depuis SecureStore. Pas de token → anonyme. */
export async function hydrateAuth(): Promise<void> {
  let token: string | null = null
  try {
    token = await secureGet(TOKEN_KEY)
  } catch {
    token = null
  }
  if (token) {
    setSessionToken(token)
    setState({ status: 'authed' })
    void refreshMe()
  } else {
    setState({ status: 'anon' })
  }
}

async function refreshMe(): Promise<void> {
  try {
    const res = await apiFetch('/api/auth/me', { method: 'GET' })
    if (!res.ok) return
    const json = (await res.json()) as { user?: AuthUser }
    if (json.user) setState({ user: json.user })
  } catch {
    /* offline / transitoire → on garde la session locale */
  }
}

async function completeLogin(token: string, user: AuthUser): Promise<void> {
  await secureSet(TOKEN_KEY, token)
  setSessionToken(token)
  setState({ status: 'authed', user, busy: false })
}

async function postLogin(path: string, payload: Record<string, unknown>): Promise<boolean> {
  try {
    const deviceId = await getDeviceId()
    const res = await apiFetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, deviceId }),
    })
    if (!res.ok) return false
    const json = (await res.json()) as { token?: string; user?: AuthUser }
    if (!json.token || !json.user) return false
    await completeLogin(json.token, json.user)
    return true
  } catch {
    return false
  }
}

export async function loginGuest(): Promise<boolean> {
  setState({ busy: true })
  const ok = await postLogin('/api/auth/guest', {})
  if (!ok) setState({ busy: false })
  return ok
}

export async function loginApple(): Promise<boolean> {
  setState({ busy: true })
  const cred = await signInWithApple()
  if (!cred) {
    setState({ busy: false })
    return false
  }
  const ok = await postLogin('/api/auth/apple', {
    identityToken: cred.identityToken,
    ...(cred.fullName ? { fullName: cred.fullName } : {}),
  })
  if (!ok) setState({ busy: false })
  return ok
}

export async function loginGoogleIdToken(idToken: string): Promise<boolean> {
  setState({ busy: true })
  const ok = await postLogin('/api/auth/google', { idToken })
  if (!ok) setState({ busy: false })
  return ok
}

/**
 * Suppression DÉFINITIVE du compte. L'ordre est important :
 *  1. le serveur d'abord — la requête a besoin du token encore en place.
 *     Best-effort : hors ligne ou serveur pas encore déployé, la purge LOCALE
 *     reste due à l'acquéreur (c'est elle qui efface son historique visible) ;
 *  2. l'effacement local TOTAL : journal + biens vus + liste noire
 *     (`wipeAll`, là où `clearFeed` les préserve), favoris, conversations, et
 *     l'identité anonyme du tracker (deviceId régénéré → le comportement futur
 *     ne peut plus être rattaché à l'historique supprimé) ;
 *  3. `logout()` — brief, photo, token, retour à l'écran de connexion.
 */
export async function deleteAccount(): Promise<void> {
  setState({ busy: true })
  try {
    const deviceId = await getDeviceId()
    await apiFetch('/api/account/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId }),
    })
  } catch {
    /* best-effort — la purge serveur n'empêche jamais la purge locale */
  }
  try {
    const stores = await import('@/lib/stores')
    stores.useFeedStore.getState().wipeAll()
    stores.useShomeeStore.setState({ favorites: [], conversations: [] })
  } catch {
    /* ignore */
  }
  try {
    const tracker = await import('@/lib/tracker')
    await tracker.resetTrackerIdentity()
  } catch {
    /* ignore */
  }
  await logout()
}

export async function logout(): Promise<void> {
  try {
    await secureDelete(TOKEN_KEY)
  } catch {
    /* ignore */
  }
  setSessionToken(null)
  // Nouvelle session = repartir de zéro : on purge les données locales
  // (recherche, feed, photo de profil) pour ne rien laisser persister d'une
  // session à l'autre. Imports dynamiques → aucun cycle de modules.
  try {
    const stores = await import('@/lib/stores')
    stores.useSearchStore.getState().resetOnboarding()
    stores.useFeedStore.getState().clearFeed()
  } catch {
    /* ignore */
  }
  try {
    const profile = await import('@/lib/profileStore')
    profile.useProfileStore.getState().setPhoto(null)
  } catch {
    /* ignore */
  }
  setState({ status: 'anon', user: null, busy: false })
}
