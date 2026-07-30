import { create } from 'zustand'
import type { StateStorage } from 'zustand/middleware'
import type { Property } from '../types/domain'

/**
 * FEED = JOURNAL PERSISTANT (chantier « mécanique du feed », lot 1).
 *
 * Le feed n'est plus le résultat d'une requête, rejoué à chaque session : c'est
 * le journal d'une recherche — la trace de ce que le chasseur a montré, dans
 * l'ordre où il l'a montré. Rouvrir l'app = retrouver son feed, à la position
 * quittée. Le tri par score ne vaut que pour la constitution initiale ;
 * ensuite, l'ordre est celui du journal.
 *
 * DEUX ENVELOPPES DE PERSISTANCE, ET C'EST LE CŒUR DU DESIGN :
 *
 *  · le JOURNAL (fiches + méta d'entrée + liste noire + empreinte de recherche)
 *    — volumineux (des dizaines de fiches complètes), mais il ne change qu'aux
 *    événements rares : constitution, relance, découverte, suppression ;
 *  · la PROGRESSION (biens vus + position de lecture) — minuscule, mais elle
 *    change à CHAQUE geste de scroll.
 *
 * Le middleware `persist` de zustand sérialise tout l'état à chaque `set` :
 * avec les fiches dedans, chaque swipe aurait réécrit des centaines de Ko sur
 * le disque. D'où une persistance MANUELLE : le journal n'est écrit que par les
 * mutations qui le concernent, la progression est écrite à part, débouncée.
 * (`getStorage` — longtemps ignoré « par parité de signature » — sert enfin.)
 *
 * LISTE NOIRE : un bien supprimé par l'acquéreur ne revient JAMAIS, par aucune
 * voie — `setFeed` et `appendFeed` la filtrent systématiquement, quelle que
 * soit la source (constitution, relance, découverte, veille). Elle survit à
 * `clearFeed` : « définitivement » veut dire ce qu'il dit, pas « jusqu'au
 * prochain changement de brief ». Les biens VUS survivent de même : re-croiser
 * dans une nouvelle recherche un bien déjà regardé hier mérite le marqueur.
 */

/** Comment un bien est entré au journal — la donnée d'historique par excellence. */
export type FeedEntryReason = 'initial' | 'rerun' | 'discovery' | 'market' | 'resurface'

export interface FeedEntryMeta {
  enteredAt: number
  entryReason: FeedEntryReason
  /** Trace de l'annonce d'origine (bien entré hors brief). DONNÉE, pas UI : les
   *  annonces affichées restent dérivées et éphémères (état React, doctrine). */
  noticeKind?: string
  noticeLine?: string
}

export interface RemovedEntry {
  propertyId: string
  /** Raisons cochées dans la modale (« Trop cher », …) — optionnelles. */
  reasons?: string[]
  /** Texte libre de la modale — optionnel. */
  freeText?: string
  at: number
}

// ─── Diagnostic A / B / C ────────────────────────────────────────────────────
//
// Le « parcours » est un ÉTAT RECALCULÉ à chaque (re)constitution, jamais une
// étiquette posée au lancement : une recherche étroite élargie à douze biens
// DEVIENT calibrée, une recherche large affinée à quinze aussi.

export type FeedShape = 'sparse' | 'calibrated' | 'large'

/** ≤ 5 biens : recherche étroite (parcours C). */
export const SPARSE_MAX = 5
/** ≤ 20 biens : recherche calibrée (parcours A). Au-delà : large (parcours B). */
export const WELL_SIZED_MAX = 20

export function diagnoseShape(mainCount: number): FeedShape {
  if (mainCount <= SPARSE_MAX) return 'sparse'
  if (mainCount <= WELL_SIZED_MAX) return 'calibrated'
  return 'large'
}

// ─── Formes persistées ───────────────────────────────────────────────────────

const JOURNAL_KEY = 'shomee-feed-journal-v1'
const PROGRESS_KEY = 'shomee-feed-progress-v1'
/** Délai d'écriture de la progression : un geste de scroll ne doit jamais
 *  attendre le disque, et une rafale de swipes ne doit produire qu'une écriture. */
const PROGRESS_FLUSH_MS = 600

interface PersistedJournalV1 {
  v: 1
  properties: Property[]
  meta: Record<string, FeedEntryMeta>
  removed: RemovedEntry[]
  /** Biens absents du catalogue à la dernière ré-hydratation (vendus/retirés).
   *  JAMAIS retirés en pleine séance — les lignes bougeraient sous le doigt —
   *  mais écartés à la PROCHAINE ouverture. */
  staleIds: string[]
  searchEpoch: string | null
  shape: FeedShape | null
  feedSessionId: string | null
}

interface PersistedProgressV1 {
  v: 1
  /** propertyId → premier horodatage de visualisation (la ligne est devenue
   *  courante). Le premier passage fait foi : « vu » ne se dé-voit pas. */
  seen: Record<string, number>
  /** Dernier bien réellement regardé — un ID et non un index : les lignes
   *  dérivées (annonces, intercalaire) rendraient tout index de ligne faux
   *  d'une session à l'autre. */
  lastReadId: string | null
}

interface FeedState {
  /** Feed courant — l'ordre du journal est l'ordre d'affichage. */
  properties: Property[]
  /** Méta d'entrée par id de bien (quand, pourquoi, annoncé comment). */
  meta: Record<string, FeedEntryMeta>
  /** Liste noire — suppressions définitives, filtrées de toutes les voies. */
  removed: RemovedEntry[]
  /** Biens signalés disparus du catalogue — écartés à la prochaine ouverture. */
  staleIds: string[]
  /** Identifiant de la génération courante (sait si un feed est déjà chargé). */
  feedSessionId: string | null
  /** Empreinte des critères au moment de la dernière (re)constitution. */
  searchEpoch: string | null
  /** Diagnostic A/B/C de la dernière (re)constitution — `null` = feed non noté. */
  shape: FeedShape | null
  /** propertyId → premier horodatage de visualisation. */
  seen: Record<string, number>
  /**
   * Photo de `seen` prise à l'hydratation, UNE FOIS PAR LANCEMENT. C'est elle —
   * et jamais `seen`, qui bouge en séance — qui pilote le marqueur « Déjà vu » :
   * un bien regardé il y a cinq minutes dans CETTE session n'est pas du déjà-vu,
   * un bien regardé lors d'une session antérieure l'est.
   */
  seenAtLaunch: Record<string, number>
  /** Position de reprise, dérivée de `lastReadId` à l'hydratation (index dans
   *  `properties`, borné). Sert d'`initialScrollIndex` à la liste. */
  lastReadIndex: number
  /** True quand `hydrateJournal` a rendu son verdict — la liste attend ce feu
   *  vert pour se monter, sinon elle naîtrait sur un état pré-hydratation. */
  journalHydrated: boolean
  /** Index de la carte active du feed. Volatile — jamais persisté tel quel. */
  currentIndex: number
  /** True une fois la séquence de révélation jouée pour le feed courant (web). */
  hasRevealed: boolean
  /** Son coupé — global au feed (comme TikTok), pas par carte. */
  muted: boolean

  /** Pose le feed + son identifiant de génération. Remet l'index à 0. */
  setFeed: (properties: Property[], sessionId: string, reason?: FeedEntryReason) => void
  /**
   * Ajoute des biens À LA SUITE du feed courant, sans rien remplacer. `notices`
   * — trace d'annonce par id — n'est que de la MÉTA de journal (data) : l'UI des
   * annonces reste dérivée côté écran, conformément à la doctrine.
   */
  appendFeed: (
    properties: Property[],
    reason?: FeedEntryReason,
    notices?: Record<string, { kind: string; line: string }>,
  ) => void
  /**
   * Suppression DÉFINITIVE d'un bien (bouton poubelle, lot 5) : liste noire +
   * retrait immédiat du journal. Les raisons/texte accompagnent l'événement
   * `removed` du tracker, elles ne conditionnent rien ici.
   */
  removeProperty: (propertyId: string, reasons?: string[], freeText?: string) => void
  isRemoved: (propertyId: string) => boolean
  /**
   * Ré-hydratation des fiches (prix, statut…) au retour du serveur : mise à
   * jour EN PLACE — jamais d'ajout, jamais de retrait en séance. Les ids
   * absents de `fresh` sont marqués périmés et tomberont à la prochaine
   * ouverture, pas sous le doigt de l'acquéreur.
   */
  applyFreshProperties: (fresh: Property[]) => void
  /**
   * Restaure le journal depuis le disque. Idempotent (une fois par lancement),
   * et JAMAIS destructif : un feed déjà en mémoire (handoff parti avant le
   * montage de l'onglet) fait autorité sur tout ce que le disque contient.
   */
  hydrateJournal: () => Promise<'restored' | 'empty' | 'skipped'>
  /** Note le premier passage sur un bien (le second appel est un no-op). */
  markSeen: (propertyId: string) => void
  /** Note le dernier bien regardé (position de reprise). */
  setLastRead: (propertyId: string) => void
  setSearchEpoch: (epoch: string | null) => void
  setShape: (shape: FeedShape | null) => void
  /** Vide le feed (changement de brief / reset onboarding). La liste noire et
   *  les biens vus SURVIVENT — ce sont des faits d'acquéreur, pas de recherche. */
  clearFeed: () => void
  /** Suppression de compte : contrairement à `clearFeed`, RIEN ne survit — ni
   *  les biens vus, ni la liste noire, ni les clés disque. « Recommencer sans
   *  historique » veut dire exactement ça. */
  wipeAll: () => void
  /** True si un feed est déjà en mémoire. */
  hasFeed: () => boolean
  setCurrentIndex: (index: number) => void
  /** Marque (ou réinitialise) l'état « révélé » du feed courant. */
  setHasRevealed: (value: boolean) => void
  /** Bascule le son global du feed. */
  toggleMuted: () => void
  setMuted: (value: boolean) => void
}

/**
 * Écarte les biens de même id en conservant le premier (l'ordre d'entrée est
 * significatif : scoring décroissant à la constitution, chronologie ensuite).
 * Le catalogue peut renvoyer un bien deux fois si une jointure dérape, et une
 * relance renvoie forcément des biens déjà présents.
 */
function dedupeById(list: Property[]): Property[] {
  const seen = new Set<string>()
  const out: Property[] = []
  for (const p of list) {
    if (!p || seen.has(p.id)) continue
    seen.add(p.id)
    out.push(p)
  }
  return out
}

export function createFeedStore(getStorage: () => StateStorage) {
  /** Storage réellement disponible ? (SSR web : `localStorage` jette.) */
  const storage = (): StateStorage | null => {
    try {
      return getStorage()
    } catch {
      return null
    }
  }

  const readKey = async (key: string): Promise<unknown> => {
    const s = storage()
    if (!s) return null
    try {
      const raw = await Promise.resolve(s.getItem(key))
      if (typeof raw !== 'string' || raw.length === 0) return null
      return JSON.parse(raw) as unknown
    } catch {
      return null
    }
  }

  /** Écriture best-effort : le feed ne doit JAMAIS attendre le disque. */
  const writeKey = (key: string, value: unknown): void => {
    const s = storage()
    if (!s) return
    try {
      void Promise.resolve(s.setItem(key, JSON.stringify(value))).catch(() => {})
    } catch {
      /* stockage indisponible → le feed vit en mémoire, comme avant */
    }
  }

  let progressTimer: ReturnType<typeof setTimeout> | null = null
  let lastReadId: string | null = null
  let hydration: Promise<'restored' | 'empty' | 'skipped'> | null = null

  return create<FeedState>()((set, get) => {
    const persistJournal = () => {
      const s = get()
      const payload: PersistedJournalV1 = {
        v: 1,
        properties: s.properties,
        meta: s.meta,
        removed: s.removed,
        staleIds: s.staleIds,
        searchEpoch: s.searchEpoch,
        shape: s.shape,
        feedSessionId: s.feedSessionId,
      }
      writeKey(JOURNAL_KEY, payload)
    }

    const persistProgressSoon = () => {
      if (progressTimer) clearTimeout(progressTimer)
      progressTimer = setTimeout(() => {
        progressTimer = null
        const payload: PersistedProgressV1 = { v: 1, seen: get().seen, lastReadId }
        writeKey(PROGRESS_KEY, payload)
      }, PROGRESS_FLUSH_MS)
    }

    /** Méta d'entrée pour les ids qui n'en ont pas encore (dédup = 1er gagne). */
    const metaFor = (
      current: Record<string, FeedEntryMeta>,
      list: Property[],
      reason: FeedEntryReason,
      notices?: Record<string, { kind: string; line: string }>,
    ): Record<string, FeedEntryMeta> => {
      const out = { ...current }
      const now = Date.now()
      for (const p of list) {
        if (!p?.id || out[p.id]) continue
        const notice = notices?.[p.id]
        out[p.id] = {
          enteredAt: now,
          entryReason: reason,
          ...(notice ? { noticeKind: notice.kind, noticeLine: notice.line } : {}),
        }
      }
      return out
    }

    const removedIds = () => new Set(get().removed.map((r) => r.propertyId))

    return {
      properties: [],
      meta: {},
      removed: [],
      staleIds: [],
      feedSessionId: null,
      searchEpoch: null,
      shape: null,
      seen: {},
      seenAtLaunch: {},
      lastReadIndex: 0,
      journalHydrated: false,
      currentIndex: 0,
      hasRevealed: false,
      muted: false,

      // Un feed fraîchement posé arrive NON-révélé (cf. web : la séquence
      // blocked→…→revealed doit jouer pour lui). Dédoublonnage par id
      // OBLIGATOIRE : keyExtractor={(p) => p.id} laisse tomber les doublons en
      // silence, et le compte annoncé doit être le compte affiché.
      setFeed: (properties, sessionId, reason = 'initial') => {
        const excluded = removedIds()
        const clean = dedupeById(properties).filter((p) => !excluded.has(p.id))
        set({
          properties: clean,
          // Nouvelle constitution = nouveau journal : la méta repart avec elle.
          meta: metaFor({}, clean, reason),
          staleIds: [],
          feedSessionId: sessionId,
          currentIndex: 0,
        })
        persistJournal()
      },

      // Ni `feedSessionId` ni `currentIndex` ne bougent, et c'est délibéré : la
      // génération reste LA MÊME (le préfixe `brief:` doit survivre) et
      // l'acquéreur ne doit pas être téléporté hors de la carte qu'il regarde.
      // Le dédoublonnage garde le premier : un bien déjà présent conserve sa
      // place, sa méta et son score.
      appendFeed: (properties, reason = 'rerun', notices) => {
        set((state) => {
          const excluded = new Set(state.removed.map((r) => r.propertyId))
          const merged = dedupeById([...state.properties, ...properties]).filter(
            (p) => !excluded.has(p.id),
          )
          return {
            properties: merged,
            meta: metaFor(state.meta, merged, reason, notices),
          }
        })
        persistJournal()
      },

      removeProperty: (propertyId, reasons, freeText) => {
        if (get().removed.some((r) => r.propertyId === propertyId)) return
        set((state) => {
          const meta = { ...state.meta }
          delete meta[propertyId]
          return {
            removed: [
              ...state.removed,
              {
                propertyId,
                ...(reasons && reasons.length > 0 ? { reasons } : {}),
                ...(freeText ? { freeText } : {}),
                at: Date.now(),
              },
            ],
            properties: state.properties.filter((p) => p.id !== propertyId),
            meta,
          }
        })
        persistJournal()
      },

      isRemoved: (propertyId) => get().removed.some((r) => r.propertyId === propertyId),

      applyFreshProperties: (fresh) => {
        if (!Array.isArray(fresh) || fresh.length === 0) return
        const byId = new Map(fresh.filter((p) => p?.id).map((p) => [p.id, p]))
        set((state) => {
          const missing = state.properties
            .map((p) => p.id)
            .filter((id) => !byId.has(id))
          return {
            properties: state.properties.map((p) => byId.get(p.id) ?? p),
            staleIds: [...new Set([...state.staleIds, ...missing])],
          }
        })
        persistJournal()
      },

      hydrateJournal: () => {
        if (hydration) return hydration
        hydration = (async (): Promise<'restored' | 'empty' | 'skipped'> => {
          try {
            // La progression se charge dans TOUS les cas : le « déjà vu » vaut
            // aussi pour un feed régénéré qui recroise des biens d'hier.
            const rawProgress = (await readKey(PROGRESS_KEY)) as PersistedProgressV1 | null
            const seen =
              rawProgress && rawProgress.v === 1 && rawProgress.seen &&
              typeof rawProgress.seen === 'object'
                ? rawProgress.seen
                : {}
            lastReadId =
              rawProgress && typeof rawProgress.lastReadId === 'string'
                ? rawProgress.lastReadId
                : null
            set({ seen, seenAtLaunch: { ...seen } })

            // Un feed déjà en mémoire est PLUS RÉCENT que le disque : le handoff
            // (deep link) a pu générer avant que l'onglet Biens ne monte.
            if (get().properties.length > 0) return 'skipped'

            const raw = (await readKey(JOURNAL_KEY)) as PersistedJournalV1 | null
            if (!raw || raw.v !== 1 || !Array.isArray(raw.properties)) return 'empty'

            const removed: RemovedEntry[] = Array.isArray(raw.removed) ? raw.removed : []
            const excluded = new Set(removed.map((r) => r.propertyId))
            const stale = new Set(Array.isArray(raw.staleIds) ? raw.staleIds : [])
            // C'est ICI que les biens disparus (vendus) tombent : entre deux
            // sessions, jamais sous le doigt.
            const properties = raw.properties.filter(
              (p) => p?.id && !excluded.has(p.id) && !stale.has(p.id),
            )
            // La liste noire se restaure même sans feed : elle filtre AUSSI la
            // prochaine constitution.
            if (properties.length === 0) {
              set({ removed })
              return 'empty'
            }

            // OÙ REPOSER LA LISTE ? Sur la PREMIÈRE LIGNE NON VUE s'il en reste
            // une — pas sur le dernier bien lu. Rouvrir sur du déjà-vu quand du
            // non-vu attend juste en dessous obligerait à re-traverser l'acquis
            // (retour de test du 29/07). La règle absorbe d'avance les
            // nouveautés « en haut de la pile » du lot 6 (non vues, en tête →
            // on s'ouvre dessus), et répare aussi une progression partiellement
            // perdue (app tuée avant le flush débouncé : le dernier bien
            // regardé n'est pas marqué… mais il est précisément le premier
            // non-vu). Tout est vu → position quittée, comme une liseuse.
            const firstUnseen = properties.findIndex((p) => !seen[p.id])
            const readIdx = lastReadId
              ? properties.findIndex((p) => p.id === lastReadId)
              : -1
            const lastReadIndex =
              firstUnseen >= 0 ? firstUnseen : readIdx >= 0 ? readIdx : 0
            set({
              properties,
              meta: raw.meta && typeof raw.meta === 'object' ? raw.meta : {},
              removed,
              staleIds: [],
              feedSessionId:
                typeof raw.feedSessionId === 'string' ? raw.feedSessionId : null,
              searchEpoch:
                typeof raw.searchEpoch === 'string' ? raw.searchEpoch : null,
              shape: raw.shape ?? null,
              lastReadIndex,
              currentIndex: lastReadIndex,
              // Un feed restauré ne rejoue pas sa révélation (concept web).
              hasRevealed: true,
            })
            // Les périmés viennent d'être purgés : on réécrit le journal net.
            if (properties.length !== raw.properties.length) {
              persistJournal()
            }
            return 'restored'
          } catch {
            return 'empty'
          } finally {
            set({ journalHydrated: true })
          }
        })()
        return hydration
      },

      markSeen: (propertyId) => {
        if (!propertyId || get().seen[propertyId]) return
        set((state) => ({ seen: { ...state.seen, [propertyId]: Date.now() } }))
        persistProgressSoon()
      },

      setLastRead: (propertyId) => {
        if (!propertyId || lastReadId === propertyId) return
        lastReadId = propertyId
        persistProgressSoon()
      },

      setSearchEpoch: (epoch) => {
        if (epoch === get().searchEpoch) return
        set({ searchEpoch: epoch })
        persistJournal()
      },

      setShape: (shape) => {
        if (shape === get().shape) return
        set({ shape })
        persistJournal()
      },

      // Un feed effacé n'est plus révélé. `removed` et `seen` SURVIVENT (faits
      // d'acquéreur) ; le journal disque est vidé, la progression réécrite sans
      // position de reprise.
      clearFeed: () => {
        lastReadId = null
        set({
          properties: [],
          meta: {},
          staleIds: [],
          feedSessionId: null,
          searchEpoch: null,
          shape: null,
          lastReadIndex: 0,
          currentIndex: 0,
          hasRevealed: false,
        })
        const s = storage()
        if (s) {
          try {
            void Promise.resolve(s.removeItem(JOURNAL_KEY)).catch(() => {})
          } catch {
            /* best-effort */
          }
        }
        writeKey(PROGRESS_KEY, { v: 1, seen: get().seen, lastReadId: null })
      },

      // L'inverse exact de la philosophie de `clearFeed` : ici, l'acquéreur
      // demande l'OUBLI, pas un nouveau départ de recherche. Tout part, disque
      // compris — au prochain lancement, l'app ne sait plus rien de lui.
      wipeAll: () => {
        lastReadId = null
        if (progressTimer) {
          clearTimeout(progressTimer)
          progressTimer = null
        }
        set({
          properties: [],
          meta: {},
          removed: [],
          staleIds: [],
          feedSessionId: null,
          searchEpoch: null,
          shape: null,
          seen: {},
          seenAtLaunch: {},
          lastReadIndex: 0,
          currentIndex: 0,
          hasRevealed: false,
        })
        const s = storage()
        if (s) {
          try {
            void Promise.resolve(s.removeItem(JOURNAL_KEY)).catch(() => {})
            void Promise.resolve(s.removeItem(PROGRESS_KEY)).catch(() => {})
          } catch {
            /* best-effort */
          }
        }
      },

      hasFeed: () => get().properties.length > 0,

      setCurrentIndex: (index) => {
        if (index === get().currentIndex) return
        set({ currentIndex: index })
      },

      setHasRevealed: (value) => {
        if (value === get().hasRevealed) return
        set({ hasRevealed: value })
      },

      toggleMuted: () => set({ muted: !get().muted }),
      setMuted: (value) => {
        if (value === get().muted) return
        set({ muted: value })
      },
    }
  })
}

export type FeedStore = ReturnType<typeof createFeedStore>
