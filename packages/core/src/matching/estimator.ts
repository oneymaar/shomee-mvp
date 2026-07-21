/**
 * Shomee — estimateur de rareté (idée Olivier, récap d'onboarding).
 *
 * « Avec vos critères, comptez ~N biens par semaine. » Deux usages :
 *  - préparer les acquéreurs très précis à voir PEU de biens (c'est voulu) ;
 *  - donner un ordre de grandeur aux recherches larges (début de parcours).
 *
 * Deux sources combinées :
 *  1. COMPTAGE réel : biens PUBLIÉS matchant les filtres durs (fourni par
 *     la route, requête Prisma) — total + fenêtre récente (28 j).
 *  2. ESTIMATION de flux : quand la fenêtre récente n'est pas représentative
 *     (catalogue seedé d'un coup, historique court), on estime le flux par
 *     rotation du stock : ~2,5 %/semaine du stock parisien remis sur le
 *     marché (constante WEEKLY_TURNOVER, à ajuster avec les vraies données).
 *
 * Fonction pure — la route fournit les comptes, ce module la lecture.
 */

export interface EstimateInput {
  /** Biens publiés matchant les filtres durs (total, toutes dates). */
  matchingCount: number
  /** Dont créés dans les 28 derniers jours (null = fenêtre inconnue). */
  matchingLast28d: number | null
  /** Taille totale du catalogue publié (pour détecter un seed massif). */
  poolCount: number
  /** Dont créés dans les 28 derniers jours. */
  poolLast28d: number | null
}

export type RarityBand = 'rare' | 'selective' | 'steady' | 'abundant'

export interface RarityEstimate {
  /** Estimation basse/haute de biens par semaine. */
  perWeekMin: number
  perWeekMax: number
  band: RarityBand
  /** true = fondé sur la fenêtre récente réelle ; false = rotation estimée. */
  fromRealWindow: boolean
  /** Message prêt à afficher au récap (fr). */
  message: string
}

/** Rotation hebdo estimée du stock (marché parisien, à recaler). */
const WEEKLY_TURNOVER = 0.025

/**
 * La fenêtre 28 j est représentative si elle contient une part « normale »
 * du catalogue (ni ~0 ni ~tout, symptômes d'un seed massif ponctuel).
 */
function windowIsRepresentative(input: EstimateInput): boolean {
  if (input.poolLast28d === null || input.matchingLast28d === null) return false
  if (input.poolCount === 0) return false
  const share = input.poolLast28d / input.poolCount
  return share >= 0.05 && share <= 0.6
}

function bandFor(perWeek: number): RarityBand {
  if (perWeek < 1) return 'rare'
  if (perWeek < 4) return 'selective'
  if (perWeek < 12) return 'steady'
  return 'abundant'
}

const MESSAGES: Record<RarityBand, (min: number, max: number) => string> = {
  rare: () =>
    'Vos critères sont très précis — comptez quelques biens par mois, ' +
    'mais chacun aura été rigoureusement sélectionné. Nous vous préviendrons dès qu\'une pépite arrive.',
  selective: (min, max) =>
    `Recherche exigeante : environ ${min} à ${max} biens par semaine devraient correspondre. ` +
    'Chaque proposition comptera.',
  steady: (min, max) =>
    `Avec vos critères, comptez environ ${min} à ${max} biens par semaine — ` +
    'un rythme confortable pour comparer sans être submergé.',
  abundant: (min) =>
    `Vos critères sont larges : plus de ${min} biens par semaine. ` +
    'Idéal pour explorer le marché — nous vous aiderons à affiner au fil de vos réactions.',
}

export function estimateRarity(input: EstimateInput): RarityEstimate {
  const real = windowIsRepresentative(input)

  let perWeek: number
  if (real && input.matchingLast28d !== null) {
    perWeek = input.matchingLast28d / 4
  } else {
    perWeek = input.matchingCount * WEEKLY_TURNOVER
  }

  // Bornes ±35 % arrondies, minimum 0.
  const perWeekMin = Math.max(0, Math.floor(perWeek * 0.65))
  const perWeekMax = Math.max(perWeekMin, Math.ceil(perWeek * 1.35))
  const band = bandFor(perWeek)

  return {
    perWeekMin,
    perWeekMax,
    band,
    fromRealWindow: real,
    message: MESSAGES[band](Math.max(1, perWeekMin), Math.max(1, perWeekMax)),
  }
}
