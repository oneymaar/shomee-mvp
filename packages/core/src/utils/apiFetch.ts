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
  /** En-têtes statiques additionnels, appliqués à chaque requête (ex. bypass
   *  d'infra d'un preview protégé). Génériques : core ne connaît aucune
   *  plateforme — le nom d'en-tête est fourni par l'appelant.
   *  Précédence : extraHeaders < init.headers < appToken. */
  extraHeaders?: Record<string, string>
}

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

export function createApiFetch(config: ApiFetchConfig = {}): ApiFetch {
  const { baseUrl = '', appToken, extraHeaders } = config
  return (path, init) => {
    // Base : en-têtes statiques de config ; surchargés par ceux de l'appel ;
    // le token applicatif garde la priorité absolue.
    const headers = new Headers(extraHeaders)
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
    if (appToken) headers.set('x-shomee-app-token', appToken)
    return fetch(`${baseUrl}${path}`, { ...init, headers })
  }
}
