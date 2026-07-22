/**
 * Détenteur du Bearer de session courant (JWT utilisateur), lu par `apiFetch`
 * à chaque requête. Module séparé pour éviter un cycle api.ts <-> authStore.ts :
 * api.ts n'importe QUE ce module (get), authStore le met à jour (set).
 */
let current: string | null = null

export function getSessionToken(): string | null {
  return current
}

export function setSessionToken(token: string | null): void {
  current = token
}
