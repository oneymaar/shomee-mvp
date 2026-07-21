/**
 * Tracker comportemental (P5) — file d'événements anonymes → /api/events/batch.
 *
 * Invariant produit : ces événements ne modifient JAMAIS les critères
 * déclarés. Ils nourrissent les affinités (classement intra-critères,
 * plafonné), la voie découverte et les QUESTIONS posées à l'acquéreur
 * (intercalaires) — la validation explicite reste le seul chemin de
 * modification des critères.
 *
 * - deviceId anonyme (uuid v4 maison, persisté AsyncStorage) — le
 *   rattachement au compte viendra avec S8 (Sign in Apple/Google).
 * - File en mémoire, flush par lot (20 événements ou 15 s), fire-and-forget
 *   avec ré-empilement en cas d'échec réseau (l'app ne doit JAMAIS attendre
 *   le tracking).
 * - S'abonne au store favoris : fav/unfav sont émis sans toucher à l'UI
 *   (zéro modification d'ActionRail/VideoCard).
 */
import AsyncStorage from '@react-native-async-storage/async-storage'
import { apiFetch } from './api'
import { useShomeeStore } from './stores'

const DEVICE_ID_KEY = 'shomee-device-id'
const FLUSH_SIZE = 20
const FLUSH_INTERVAL_MS = 15_000
const MAX_QUEUE = 200

export type TrackedEventType =
  | 'session_start'
  | 'video_start'
  | 'dwell'
  | 'skip'
  | 'skip_fast'
  | 'detail_open'
  | 'detail_dwell'
  | 'fav'
  | 'unfav'
  | 'share'
  | 'contact'
  | 'map_open'
  | 'probe_answer'
  | 'interstitial_shown'
  | 'interstitial_accepted'
  | 'interstitial_dismissed'

export interface TrackedEvent {
  type: TrackedEventType
  propertyId?: string
  valueMs?: number
  lane?: 'main' | 'discovery'
  servedScore?: number
  criteriaHash?: string
  meta?: Record<string, unknown>
}

let deviceId: string | null = null
let queue: TrackedEvent[] = []
let flushTimer: ReturnType<typeof setInterval> | null = null
let flushing = false

function uuid(): string {
  // uuid v4 sans dépendance (Hermes n'a pas crypto.randomUUID partout).
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

async function ensureDeviceId(): Promise<string> {
  if (deviceId) return deviceId
  try {
    const stored = await AsyncStorage.getItem(DEVICE_ID_KEY)
    if (stored) {
      deviceId = stored
      return stored
    }
  } catch { /* storage indisponible → id de session */ }
  const fresh = uuid()
  deviceId = fresh
  AsyncStorage.setItem(DEVICE_ID_KEY, fresh).catch(() => {})
  return fresh
}

async function flush(): Promise<void> {
  if (flushing || queue.length === 0) return
  flushing = true
  const batch = queue.splice(0, Math.min(queue.length, 100))
  try {
    const id = await ensureDeviceId()
    const res = await apiFetch('/api/events/batch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ deviceId: id, events: batch }),
    })
    if (!res.ok) throw new Error(`events/batch ${res.status}`)
  } catch {
    // Ré-empile (borné) — on retentera au prochain flush. Jamais bloquant.
    queue = [...batch, ...queue].slice(0, MAX_QUEUE)
  } finally {
    flushing = false
  }
}

/** Enregistre un événement (non bloquant). Démarre le flush périodique. */
export function track(event: TrackedEvent): void {
  queue.push(event)
  if (queue.length > MAX_QUEUE) queue = queue.slice(-MAX_QUEUE)
  if (queue.length >= FLUSH_SIZE) void flush()
  if (!flushTimer) {
    flushTimer = setInterval(() => void flush(), FLUSH_INTERVAL_MS)
  }
}

/** Force l'envoi (appeler au passage en arrière-plan). */
export function flushNow(): void {
  void flush()
}

// ─── Session + favoris (aucune modification d'UI nécessaire) ────────────────

let initialized = false

/** Initialise le tracker : session_start + abonnement favoris. Idempotent. */
export function initTracker(): void {
  if (initialized) return
  initialized = true

  track({ type: 'session_start' })

  // fav/unfav par DIFF sur le store — zéro changement dans ActionRail.
  let prevIds = new Set(useShomeeStore.getState().favorites.map((f) => f.id))
  useShomeeStore.subscribe((state) => {
    const nextIds = new Set(state.favorites.map((f) => f.id))
    for (const id of nextIds) {
      if (!prevIds.has(id)) track({ type: 'fav', propertyId: id })
    }
    for (const id of prevIds) {
      if (!nextIds.has(id)) track({ type: 'unfav', propertyId: id })
    }
    prevIds = nextIds
  })
}
