/**
 * apiFetch mobile — instance de `createApiFetch` (@shomee/core).
 *
 * Les secrets viennent des variables `EXPO_PUBLIC_*` lues EN DIRECT via
 * `process.env` : Metro (babel-preset-expo) les inline dans le bundle au build,
 * de façon fiable. On NE passe PAS par `Constants.expoConfig.extra` (l'indirection
 * app.config.js ne remonte pas au runtime sous SDK 56 — `extra` reste vide, cf.
 * DIAG B : `env.hasBypass=true` mais `extra.hasBypass=false`).
 *
 * Deux couches d'auth traversées à chaque requête vers le preview protégé :
 *   1. Vercel Deployment Protection (preview privé) → header
 *      `x-vercel-protection-bypass` (secret « Protection Bypass for Automation »).
 *   2. Garde applicatif → header `x-shomee-app-token` (injecté par createApiFetch).
 *
 * Le nom d'en-tête Vercel vit ICI uniquement — core reste agnostique de la
 * plateforme (config générique `extraHeaders`).
 */
import { createApiFetch } from '@shomee/core/utils/apiFetch'

// Fallback commité : l'alias de branche du monorepo (preview protégé Vercel).
const BRANCH_ALIAS = 'https://shomee-mvp-git-feat-monorepo-oneymaars-projects.vercel.app'

const baseUrl = process.env.EXPO_PUBLIC_API_BASE_URL ?? BRANCH_ALIAS
const appToken = process.env.EXPO_PUBLIC_SHOMEE_APP_TOKEN || undefined
const bypassToken = process.env.EXPO_PUBLIC_VERCEL_BYPASS_TOKEN || undefined

export const apiFetch = createApiFetch({
  baseUrl,
  appToken,
  extraHeaders: bypassToken ? { 'x-vercel-protection-bypass': bypassToken } : undefined,
})
