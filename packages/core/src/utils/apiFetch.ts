/**
 * apiFetch — wrapper fetch agnostique, partagé web + mobile.
 *
 * Centralise l'injection du header `x-shomee-app-token` et la base URL, sans
 * dépendance Next ni token en dur (frontières @shomee/core respectées).
 *
 * - Web : `createApiFetch({ baseUrl: '' })` — same-origin, AUCUN token (le web
 *   passe par l'allowlist d'Origin ; le token ne doit jamais entrer dans le
 *   bundle web).
 * - Mobile : `createApiFetch({ baseUrl: <URL absolue>, appToken: <config app> })`
 *   — token injecté depuis la config de l'app, jamais en dur ici.
 */

export interface ApiFetchConfig {
  /** Préfixe d'URL. '' = relatif (web same-origin) ; URL absolue (mobile). */
  baseUrl?: string
  /** Token applicatif. Injecté côté mobile ; jamais fourni côté web. */
  appToken?: string
}

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

export function createApiFetch(config: ApiFetchConfig = {}): ApiFetch {
  const { baseUrl = '', appToken } = config
  return (path, init) => {
    const headers = new Headers(init?.headers)
    if (appToken) headers.set('x-shomee-app-token', appToken)
    return fetch(`${baseUrl}${path}`, { ...init, headers })
  }
}
