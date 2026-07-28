// app.config.js — étend app.json SANS le remplacer.
//
// NB : ce fichier est actuellement quasi-vestigial. Les secrets sont lus EN
// DIRECT via process.env.EXPO_PUBLIC_* dans src/lib/api.ts (le bloc `extra`
// ci-dessous ne remonte pas au runtime sous SDK 56). On le conserve pour
// l'instant (état validé) ; suppression à retenter après diagnostic splash.
//
// La config native (plugins, splash, icônes, bundleIdentifier…) reste la source
// de vérité dans app.json ; on ne fait qu'y ajouter `extra`.

// Fallback commité : l'alias de branche du monorepo (preview protégé Vercel).
const BRANCH_ALIAS =
  'https://shomee-mvp-git-feat-monorepo-oneymaars-projects.vercel.app'

module.exports = ({ config }) => ({
  ...config,
  extra: {
    ...config.extra,
    shomeeApiBaseUrl: process.env.EXPO_PUBLIC_API_BASE_URL ?? BRANCH_ALIAS,
    shomeeAppToken: process.env.EXPO_PUBLIC_SHOMEE_APP_TOKEN ?? '',
    vercelBypassToken: process.env.EXPO_PUBLIC_VERCEL_BYPASS_TOKEN ?? '',
  },
})
