/**
 * Shomee — calibration du score AFFICHÉ (décision D5).
 *
 * Le moteur produit un score brut 0..100 (moyenne pondérée). Problèmes
 * d'affichage : (1) un bien servi sous 60 % donne l'impression que le
 * système ne fonctionne pas ; (2) sans calibration tout se tasse entre
 * 75 et 95 et le badge devient illisible.
 *
 * Règles (validées par Olivier) :
 *  - Tout bien SERVI affiche ≥ 60 (plancher).
 *  - 90+ est RÉSERVÉ aux coups de cœur quasi certains : aucun obligatoire
 *    non-matché, ≥ 80 % des souhaités matchés, au plus 1 doute.
 *  - Entre les deux, le brut est étalé sur [60..89] pour recréer de la
 *    dispersion lisible.
 *
 * Fonction pure — s'applique au moment du SERVICE (routes feed), jamais
 * stockée : le brut reste la vérité du moteur.
 */

import type { MatchResult } from './types'

export interface CalibratedScore {
  /** Score affiché 0..100 (≥ 60 pour tout bien servi). */
  display: number
  /** Score brut du moteur (traçabilité / debug). */
  raw: number
  /** True si le bien remplit les conditions « coup de cœur » (90+). */
  topTier: boolean
}

/** Ratio de critères souhaités matchés (1 quand il n'y en a aucun). */
function desiredMatchedRatio(result: MatchResult): number {
  const desired = result.criteria_scores.filter((c) => c.importance === 'desired')
  if (desired.length === 0) return 1
  const matched = desired.filter((c) => c.status === 'matched').length
  return matched / desired.length
}

export function calibrateScore(result: MatchResult): CalibratedScore {
  const raw = result.global_score

  if (result.is_excluded) {
    // Jamais servi normalement — on renvoie le brut par transparence.
    return { display: raw, raw, topTier: false }
  }

  const noMandatoryFailure = result.mandatory_failures.length === 0
  const fewDoubts = result.doubts.length <= 1
  const topTier = noMandatoryFailure && fewDoubts && desiredMatchedRatio(result) >= 0.8

  if (topTier) {
    // 90..99 — proportionnel au brut dans la zone haute (brut 80..100 → 90..99).
    const t = Math.max(0, Math.min(1, (raw - 80) / 20))
    return { display: Math.round(90 + t * 9), raw, topTier }
  }

  // Étalement du brut sur [60..89]. Le brut d'un bien servi (filtres durs
  // passés) vit typiquement dans [40..95] → on normalise cette plage.
  const t = Math.max(0, Math.min(1, (raw - 40) / 55))
  return { display: Math.round(60 + t * 29), raw, topTier }
}
