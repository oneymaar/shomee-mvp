import type { User } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { verifySession } from './jwt'

/**
 * Resout l'utilisateur courant depuis `Authorization: Bearer <jwt>`.
 * Renvoie null si absent / invalide / expire / user introuvable.
 */
export async function getSessionUser(req: Request): Promise<User | null> {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!header || !header.toLowerCase().startsWith('bearer ')) return null
  const token = header.slice(7).trim()
  if (!token) return null
  const claims = verifySession(token)
  if (!claims) return null
  return prisma.user.findUnique({ where: { id: claims.sub } })
}
