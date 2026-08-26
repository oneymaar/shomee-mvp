import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/**
 * Mots de passe agent — scrypt (node:crypto), AUCUNE dépendance ajoutée
 * (contrainte de la session du 24/08 : pas d'accès npm ; et scrypt natif est
 * une réponse parfaitement standard au besoin).
 *
 * Format stocké : `scrypt$N$r$p$<salt b64url>$<hash b64url>` — les paramètres
 * voyagent avec le hash, on pourra les durcir sans invalider l'existant.
 */

const N = 16384
const R = 8
const P = 1
const KEYLEN = 64

export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, KEYLEN, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${hash.toString('base64url')}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, saltB64, hashB64] = parts
  try {
    const salt = Buffer.from(saltB64, 'base64url')
    const expected = Buffer.from(hashB64, 'base64url')
    const actual = scryptSync(password, salt, expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    })
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}

/** Jeton d'activation / réinitialisation — 32 octets, URL-safe. */
export function newSetupToken(): string {
  return randomBytes(32).toString('base64url')
}

/** Règle produit : 8 caractères minimum. (Message d'erreur côté pages.) */
export const PASSWORD_MIN_LENGTH = 8
