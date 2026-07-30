'use client'

/**
 * S9 — « teaser » du feed web.
 *
 * Quand on arrive d'un lien généré par un LLM (/h/<token>), le web ne sert
 * PAS l'application : il sert un aperçu. TEASER_VIDEO_COUNT vidéos, puis une
 * modale bloquante qui renvoie vers l'installation. Tout le reste du parcours
 * (récap complet, ajustements, favoris) vit dans l'app.
 *
 * Le relais entre l'écran de chargement et /feed passe par sessionStorage :
 * les deux pages sont deux routes distinctes, et un paramètre d'URL serait
 * à la fois visible et trivialement supprimable. sessionStorage disparaît à
 * la fermeture de l'onglet, ce qui est exactement la durée de vie voulue.
 *
 * Ce n'est PAS une barrière de sécurité — c'est un garde-fou de parcours.
 * Rien de confidentiel ne transite ici : le token est déjà dans l'URL.
 */

/** Clé sessionStorage du relais chargement → feed. */
export const TEASER_KEY = 'shomee:teaser'

/**
 * Nombre de biens visibles gratuitement sur le web avant la modale.
 * Source unique : l'écran de chargement, le feed et la modale s'y réfèrent
 * tous les trois. 2 = la première vidéo se regarde librement, la seconde
 * s'affiche puis se fait recouvrir au scroll.
 */
export const TEASER_VIDEO_COUNT = 2

export interface TeaserHandoff {
  /** Token du handoff — sert au bouton « ouvrir l'app » et au retour récap. */
  token: string
  /** Code court à saisir au premier lancement de l'app. */
  shortCode: string
  /** Date ISO d'expiration du lien. */
  expiresAt: string
}

export function writeTeaser(t: TeaserHandoff): void {
  try {
    sessionStorage.setItem(TEASER_KEY, JSON.stringify(t))
  } catch {
    // sessionStorage indisponible (navigation privée saturée, quota) : on
    // laisse filer. Le feed s'ouvrira sans garde-fou plutôt que de bloquer
    // l'utilisateur sur un écran de chargement.
  }
}

export function readTeaser(): TeaserHandoff | null {
  try {
    const raw = sessionStorage.getItem(TEASER_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<TeaserHandoff>
    if (!parsed || typeof parsed.token !== 'string' || !parsed.token) return null
    return {
      token: parsed.token,
      shortCode: typeof parsed.shortCode === 'string' ? parsed.shortCode : '',
      expiresAt: typeof parsed.expiresAt === 'string' ? parsed.expiresAt : '',
    }
  } catch {
    return null
  }
}

export function clearTeaser(): void {
  try {
    sessionStorage.removeItem(TEASER_KEY)
  } catch {
    /* rien à faire */
  }
}
