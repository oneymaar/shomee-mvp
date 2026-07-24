import { randomInt } from 'node:crypto'

/**
 * Code court de handoff — le « ticket » humain qui franchit l'App Store
 * quand aucun canal automatique n'a marché (cascade §4.2 du doc d'archi).
 *
 * - Alphabet SANS caractères ambigus (pas de 0/O, 1/I/L) → dictable au
 *   téléphone, saisissable sans erreur.
 * - Canonique : 7 caractères SANS tiret (stocké en base tel quel).
 * - Affiché : « 4F2A-9K2 » (tiret après le 4e caractère).
 * - Entropie : 31^7 ≈ 27,5 milliards — collision gérée par retry (create).
 */

export const SHORT_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
export const SHORT_CODE_LENGTH = 7

/** Génère un code canonique (7 chars, alphabet non ambigu), crypto-aléatoire. */
export function generateShortCode(): string {
  let out = ''
  for (let i = 0; i < SHORT_CODE_LENGTH; i++) {
    out += SHORT_CODE_ALPHABET[randomInt(SHORT_CODE_ALPHABET.length)]
  }
  return out
}

/** « 4F2A9K2 » → « 4F2A-9K2 » (forme affichée / dictée). */
export function formatShortCode(canonical: string): string {
  if (canonical.length !== SHORT_CODE_LENGTH) return canonical
  return `${canonical.slice(0, 4)}-${canonical.slice(4)}`
}

/**
 * Normalise une saisie utilisateur vers la forme canonique : majuscules,
 * séparateurs (tirets, espaces, ponctuation) retirés. Les caractères hors
 * alphabet (0/O/1/I/L…) ne sont PAS « corrigés » silencieusement : le lookup
 * échouera proprement et l'UI invitera à revérifier la saisie —
 * `isPlausibleShortCode` permet de le dire avant même d'interroger la base.
 */
export function normalizeShortCode(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '') // retire tirets/espaces/ponctuation
    .trim()
}

/** Vrai si la forme canonique a une chance d'exister (longueur + alphabet). */
export function isPlausibleShortCode(canonical: string): boolean {
  if (canonical.length !== SHORT_CODE_LENGTH) return false
  for (const ch of canonical) {
    if (!SHORT_CODE_ALPHABET.includes(ch)) return false
  }
  return true
}
