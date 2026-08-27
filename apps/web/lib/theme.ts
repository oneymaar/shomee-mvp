/**
 * SHOMEE — le nuancier, côté web.
 *
 * Jumeau de `apps/mobile/src/lib/theme.ts` : mêmes valeurs, mêmes rôles. Le
 * back-office agent vivait encore en gris froid génériques (#F7F5F2, #0a0a0a,
 * gray-200) pendant que l'app était passée en crème/terracotta — d'où
 * l'impression de deux produits différents. Tout ce qui est peint côté agent
 * pioche désormais ici.
 *
 * RÈGLE : un rôle par couleur. Le terracotta est l'ACTION, jamais une
 * décoration ni une alerte.
 */

export const couleurs = {
  /** Terracotta — LA couleur SHOMEE. Réservée aux vraies actions (CTA). */
  terracotta: '#A6512B',
  /** Terracotta éclairci — accents sur fond sombre. */
  terracottaClair: '#C96B45',
  /** Terracotta désaturé — CTA désactivé. */
  terracottaEteint: '#DB947E',

  /** Fond crème des écrans clairs. */
  creme: '#FAF3EE',
  /** Crème posée sur les fonds sombres. */
  cremeSurSombre: '#F6EDE6',
  /** Blanc des cartes. */
  carte: '#FFFFFF',
  /** Encre — le texte principal. */
  encre: '#201A16',
  /** Texte secondaire (gris CHAUD — jamais de gris froid). */
  doux: '#8A7A6E',
  /** Texte tertiaire, mentions discrètes. */
  estompe: '#B7A99D',
  /** Fond des puces et surfaces secondaires. */
  sable: '#EFE2D5',
  /** Filets et bordures sur fond clair. */
  ligne: '#E8D9CB',
  /** Filet très discret à l'intérieur d'une carte. */
  ligneDouce: '#F2E9DF',
  /** Chrome sombre (feed, splash) — un noir CHAUD, pas un noir pur. */
  nuit: '#171210',
  /** Surface au-dessus du chrome sombre (barre d'onglets du feed). */
  nuitHaute: '#14100E',

  /** Vert « satisfait » sur fond clair. */
  vert: '#35845F',
  /** Vert « satisfait » sur vidéo/fond sombre. */
  vertSurSombre: '#7BC9A2',
  /** Fond pâle d'une pastille verte sur fond clair. */
  vertPale: '#E7F1EB',

  /** Rouge d'alerte — destruction uniquement. */
  alerte: '#B0442C',

  /** Voiles fumés posés sur la vidéo. */
  fumee: 'rgba(23, 18, 16, 0.36)',
  fumeeLegere: 'rgba(23, 18, 16, 0.25)',
  /** Bordure claire des éléments fantômes sur vidéo. */
  bordFantome: 'rgba(246, 237, 230, 0.5)',
  /** Filet discret sur fond sombre. */
  filetSurSombre: 'rgba(246, 237, 230, 0.08)',
} as const

/** La serif de marque — Frank Ruhl Libre, exposée par `app/layout.tsx`. */
export const SERIF = "var(--font-serif), 'Frank Ruhl Libre', Georgia, serif"

/** Échelle serif (valeurs « 96 % » actées le 20/08). */
export const taillesSerif = {
  prixFiche: 35,
  titreEcran: 27,
  tagline: 28,
  score: 20,
  avatar: 19,
  prixFeed: 23,
  lettrine: 50,
} as const

/** Rayons — quatre, pas vingt-cinq. */
export const rayons = {
  petit: 10,
  carte: 20,
  feuille: 28,
  pilule: 999,
} as const

export const theme = { couleurs, taillesSerif, rayons, SERIF }
export default theme
