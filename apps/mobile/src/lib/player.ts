import type { VideoPlayer } from 'expo-video'

/**
 * Accès défensifs au lecteur expo-video.
 *
 * `VideoPlayer` est un **objet natif partagé** : une fois `useVideoPlayer`
 * démonté, le moindre accès — lecture d'une propriété comme écriture — lève
 * `NativeSharedObjectNotFoundException`, qui remonte en Render Error plein
 * écran.
 *
 * Deux fenêtres où ça arrive dans le feed :
 *  - React détruit les effets du PARENT avant ceux de ses enfants : quand la
 *    barre de progression nettoie son abonnement, `FeedItem` a déjà libéré le
 *    lecteur ;
 *  - un geste (hold-pause, tap chapitre, scrub) peut se conclure pendant le
 *    recyclage de la ligne par la `FlatList`, donc après la libération.
 *
 * Ces deux helpers absorbent ce cas précis — et lui seul : ils ne masquent
 * aucune erreur de logique, uniquement l'accès à un objet déjà disparu.
 */

/** Durée en secondes, 0 si le lecteur n'est plus là. */
export function readDuration(player: VideoPlayer): number {
  try {
    return player.duration || 0
  } catch {
    return 0
  }
}

/** Exécute une commande sur le lecteur ; ne fait rien s'il a été libéré. */
export function safePlayer(run: () => void): void {
  try {
    run()
  } catch {
    /* lecteur déjà libéré */
  }
}
