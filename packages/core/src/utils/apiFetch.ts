/**
 * apiFetch — wrapper fetch agnostique, partagé web + mobile.
 *
 * Centralise l'injection du header `x-shomee-app-token`, du Bearer de session
 * (auth utilisateur) et la base URL, sans dépendance Next ni token en dur
 * (frontières @shomee/core respectées).
 *
 * - Web : `createApiFetch({ baseUrl: '' })` — same-origin, AUCUN token (le web
 *   passe par l'allowlist d'Origin ; le token ne doit jamais entrer dans le
 *   bundle web).
 * - Mobile : `createApiFetch({ baseUrl, appToken, getAuthToken })` — token
 *   applicatif injecté depuis la config ; Bearer utilisateur lu dynamiquement
 *   à chaque requête (il change au login/logout).
 */

export interface ApiFetchConfig {
  /** Préfixe d'URL. '' = relatif (web same-origin) ; URL absolue (mobile). */
  baseUrl?: string
  /** Token applicatif. Injecté côté mobile ; jamais fourni côté web. */
  appToken?: string
  /** En-têtes statiques additionnels, appliqués à chaque requête (ex. bypass
   *  d'infra d'un preview protégé). Génériques : core ne connaît aucune
   *  plateforme — le nom d'en-tête est fourni par l'appelant. */
  extraHeaders?: Record<string, string>
  /** Bearer de session utilisateur, lu À CHAQUE requête (change au login/
   *  logout). Renvoyer null/undefined = pas d'en-tête Authorization. */
  getAuthToken?: () => string | null | undefined
}

export type ApiFetch = (path: string, init?: RequestInit) => Promise<Response>

export function createApiFetch(config: ApiFetchConfig = {}): ApiFetch {
  const { baseUrl = '', appToken, extraHeaders, getAuthToken } = config
  return (path, init) => {
    // Précédence : extraHeaders < Authorization(session) < init.headers < appToken.
    const headers = new Headers(extraHeaders)
    const authToken = getAuthToken?.()
    if (authToken) headers.set('authorization', `Bearer ${authToken}`)
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value))
    if (appToken) headers.set('x-shomee-app-token', appToken)
    return fetch(`${baseUrl}${path}`, { ...init, headers })
  }
}
