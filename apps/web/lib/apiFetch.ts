import { createApiFetch } from '@shomee/core/utils/apiFetch'

/**
 * Instance web d'apiFetch : same-origin (baseUrl ''), AUCUN token applicatif.
 * Le web est autorisé par l'allowlist d'Origin côté serveur — le token ne doit
 * jamais être bundlé côté client. Sert surtout à homogénéiser les appels et à
 * préparer le partage avec le mobile.
 */
export const apiFetch = createApiFetch({ baseUrl: '' })
