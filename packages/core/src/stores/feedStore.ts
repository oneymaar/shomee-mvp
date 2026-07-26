import { create } from 'zustand'
import type { StateStorage } from 'zustand/middleware'
import type { Property } from '../types/domain'

interface FeedState {
  /** Feed courant — survit aux navigations internes (mémoire, durée de session). */
  properties: Property[]
  /** Identifiant de la génération courante (sait si un feed est déjà chargé). */
  feedSessionId: string | null
  /**
   * Index de la carte active du feed. Consolidé ici (il vivait avant dans
   * useShomeeStore) : c'est une donnée de feed, on garde une source unique.
   */
  currentIndex: number
  /**
   * True une fois la séquence de révélation (blocked→pre-reveal→revealed) jouée
   * pour le feed courant. Vit dans le store — au même titre que `properties` —
   * pour que l'état « révélé » survive aux navigations internes : un feed déjà
   * révélé qu'on réaffiche s'ouvre directement en `'revealed'` (cf. feed/page),
   * sans rejouer la révélation ni désaligner les IntersectionObserver.
   */
  hasRevealed: boolean
  /**
   * Son coupé — global au feed (comme TikTok), pas par carte. Initialisé à
   * `false` (son activé au lancement, choix produit). La carte active applique
   * ce flag au lecteur.
   */
  muted: boolean

  /** Pose le feed + son identifiant de génération. Remet l'index à 0. */
  setFeed: (properties: Property[], sessionId: string) => void
  /** Vide le feed (changement de brief / reset onboarding). */
  clearFeed: () => void
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
 * Feed store — TRANSIENT, en mémoire uniquement. **Pas** de middleware
 * `persist` : le feed survit à toute navigation interne tant que l'app reste
 * ouverte, mais un vrai reload le perd (acceptable et cohérent).
 *
 * La factory reçoit la même signature `getStorage` que createShomeeStore /
 * createSearchStore par cohérence avec @shomee/core, MAIS ne l'utilise pas
 * (aucune persistance). Sur mobile, ce même store donnera la persistance feed
 * inter-onglets gratuitement, sans réécriture.
 */

/**
 * Écarte les biens de même id en conservant le premier (l'ordre de scoring est
 * significatif : le meilleur match arrive en tête). Le feed généré côté LLM peut
 * produire des ids identiques (`gen-${Date.now()}-${idx}` collisionne si deux
 * lots sont générés dans la même milliseconde) et le catalogue peut renvoyer un
 * bien deux fois si une jointure dérape.
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

export function createFeedStore(_getStorage: () => StateStorage) {
  void _getStorage // parité de signature uniquement — store volontairement transient
  return create<FeedState>()((set, get) => ({
    properties: [],
    feedSessionId: null,
    currentIndex: 0,
    hasRevealed: false,
    muted: false,

    // Un feed fraîchement posé arrive NON-révélé : la séquence blocked→…→revealed
    // doit jouer pour lui. On ne touche donc pas `hasRevealed` ici — il passe à
    // true seulement quand la révélation s'achève (feed/page → setHasRevealed).
    //
    // Dédoublonnage par id OBLIGATOIRE : la FlatList du feed utilise
    // keyExtractor={(p) => p.id} et laisse tomber silencieusement les doublons.
    // Sans ça, `properties.length` (annoncé à l'utilisateur : « 4 biens trouvés »)
    // peut dépasser le nombre de cartes réellement affichées (3) — incohérence
    // visible et injustifiable côté produit.
    setFeed: (properties, sessionId) =>
      set({ properties: dedupeById(properties), feedSessionId: sessionId, currentIndex: 0 }),

    // Un feed effacé n'est plus révélé : on remet le flag à false pour que le
    // prochain feed (reset onboarding / changement de brief) rejoue sa révélation.
    clearFeed: () =>
      set({ properties: [], feedSessionId: null, currentIndex: 0, hasRevealed: false }),

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
  }))
}

export type FeedStore = ReturnType<typeof createFeedStore>
