import { timingSafeEqual } from 'node:crypto'

/**
 * Admin auth — secret lu UNIQUEMENT depuis le header `x-admin-secret`, comparé
 * en timing-safe à `process.env.ADMIN_SECRET`. Refuse par défaut si l'env n'est
 * pas configurée. Jamais de secret en query string ni en dur dans le code.
 *
 * Miroir exact du `checkAdminSecret` déjà inline dans les routes
 * /api/admin/videos et /api/admin/video-tags — factorisé ici pour les
 * nouvelles routes du TikTok Studio.
 */
export function checkAdminSecret(req: Request): boolean {
  const expected = process.env.ADMIN_SECRET
  if (!expected) return false
  const provided = req.headers.get('x-admin-secret')
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
