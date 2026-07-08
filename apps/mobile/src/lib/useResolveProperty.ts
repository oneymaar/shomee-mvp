import { useCallback } from 'react'
import type { Property } from '@shomee/core/types/domain'
import { useFeedStore, useShomeeStore } from '@/lib/stores'

/**
 * Résout une fiche complète par son id parmi les sources chargées en session.
 *
 * Les conversations ne stockent que `propertyId` (shape du store partagé, non
 * modifiée). Côté natif la fiche complète vit déjà là où l'utilisateur l'a
 * ouverte : le feed courant (`feedStore.properties`) et/ou les favoris. Comme
 * les conversations sont éphémères (créées depuis une fiche du feed dans la même
 * session), l'une de ces deux sources contient toujours le bien.
 *
 * Renvoie un résolveur mémoïsé (utilisable pour un bien unique ou en `.map`).
 */
export function usePropertyResolver() {
  const feed = useFeedStore((s) => s.properties)
  const favorites = useShomeeStore((s) => s.favorites)
  return useCallback(
    (id: string): Property | null =>
      feed.find((p) => p.id === id) ?? favorites.find((p) => p.id === id) ?? null,
    [feed, favorites],
  )
}
