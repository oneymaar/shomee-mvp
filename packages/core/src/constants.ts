// Shared media constants — platform-agnostic (web + mobile). Pure string
// values only, no runtime dependency (cf. import rules in ./index.ts).

/**
 * Image de repli universelle pour une fiche sans visuel propre. Utilisée quand
 * aucune vignette ne peut être dérivée (ni gallery, ni poster Cloudinary).
 * Portrait 800×1400 pour coller au format des cartes du feed.
 */
export const DEFAULT_FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&h=1400&fit=crop&q=80'
