/**
 * SHOMEE — le nuancier officiel (design system, phase 3 de la refonte).
 *
 * RÈGLE UNIQUE : plus aucune couleur, taille de police ou rayon en dur dans les
 * écrans — tout vient d'ici. C'est ce fichier qui garantit la cohérence que
 * l'audit du 20/08 a montrée manquante (104 couleurs, 19 tailles, 25 rayons).
 *
 * Direction artistique validée par Olivier le 20/08/2026 (direction A
 * « Éditorial chaleureux », cf. maquettes/directions/) :
 *  - serif de marque : Frank Ruhl Libre à 96 % (prix, scores, lettrines) ;
 *  - interface : police système (SF Pro) ;
 *  - tagline d'accueil : Montserrat Light + « en vidéo. » en serif droite ;
 *  - UN terracotta, UN rôle : l'action. Le feed vit en chrome sombre, le reste
 *    de l'app en crème.
 */

export const colors = {
  /** Terracotta — LA couleur SHOMEE. Réservée aux vraies actions (CTA). */
  terracotta: '#A6512B',
  /** Terracotta éclairci — accents sur fond sombre (tab bar du feed, cœur liké). */
  terracottaBright: '#C96B45',
  /** Terracotta désaturé — état désactivé d'un CTA. */
  terracottaDisabled: '#DB947E',

  /** Fond crème des écrans clairs. */
  cream: '#FAF3EE',
  /** Texte/éléments crème posés sur les fonds sombres. */
  creamOnDark: '#F6EDE6',
  /** Encre — le texte principal. */
  ink: '#201A16',
  /** Texte secondaire (gris chaud — jamais de gris froid). */
  muted: '#8A7A6E',
  /** Fond des puces et surfaces secondaires. */
  sand: '#EFE2D5',
  /** Filets et bordures sur fond clair. */
  line: '#E8D9CB',
  /** Chrome sombre (feed, splash) — un noir chaud, pas un noir pur. */
  night: '#171210',
  /** Surface au-dessus du chrome sombre (tab bar du feed). */
  nightRaised: '#14100E',

  /** Vert « critère satisfait » sur fond clair. */
  green: '#35845F',
  /** Vert « critère satisfait » sur vidéo/fond sombre. */
  greenOnDark: '#7BC9A2',

  /** Voiles fumés posés sur la vidéo (capsules, cercles du rail). */
  smoke: 'rgba(23, 18, 16, 0.36)',
  smokeLight: 'rgba(23, 18, 16, 0.25)',
  /** Bordure claire des éléments fantômes sur vidéo. */
  ghostBorder: 'rgba(246, 237, 230, 0.5)',
  /** Filet discret sur fond sombre. */
  hairlineOnDark: 'rgba(246, 237, 230, 0.08)',
} as const

/**
 * Familles de polices. Les clés correspondent aux fontFamily chargées dans
 * `app/_layout.tsx` via expo-font (fichiers dans assets/fonts/).
 * L'interface courante n'a PAS de famille : elle reste en police système.
 */
export const fonts = {
  /** Frank Ruhl Libre 500 — prix, scores, lettrines, « en vidéo. ». */
  serif: 'FrankRuhlLibre-Medium',
  /** Frank Ruhl Libre 600 — renfort ponctuel (grands prix). */
  serifStrong: 'FrankRuhlLibre-SemiBold',
  /** Montserrat 300 — uniquement la tagline de l'écran d'accueil. */
  taglineSans: 'Montserrat-Light',
} as const

/**
 * Échelle typographique de la serif — les valeurs « 96 % » actées par Olivier,
 * arrondies. Toute nouvelle utilisation de la serif pioche ici.
 */
export const serifSizes = {
  /** Prix sur la fiche bien. */
  priceSheet: 35,
  /** Question d'une étape d'onboarding (« Où aimeriez-vous habiter ? »). */
  stepTitle: 27,
  /** « en vidéo. » de l'accueil. */
  tagline: 28,
  /** Score de correspondance (92 %). */
  score: 20,
  /** Lettre de l'avatar d'agence. */
  avatar: 19,
  /** Prix sur le feed — présent sans crier (18 px était trop effacé à
   *  l'écran : remonté à 23 après essai sur simulateur le 23/08). */
  priceFeed: 23,
  /** Lettrine de la description. */
  lettrine: 50,
} as const

/** Échelle de texte de l'interface (police système). */
export const textSizes = {
  caption: 11,
  small: 12.5,
  body: 14,
  bodyLarge: 15.5,
  title: 18,
  headline: 24,
} as const

/** Rayons — quatre, pas vingt-cinq. */
export const radii = {
  small: 10,
  card: 20,
  sheet: 28,
  pill: 999,
} as const

/** Espacements de base. */
export const spacing = {
  xs: 4,
  s: 8,
  m: 12,
  l: 16,
  xl: 24,
} as const

export const theme = { colors, fonts, serifSizes, textSizes, radii, spacing }
export default theme
