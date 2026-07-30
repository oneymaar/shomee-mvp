/**
 * ÉLARGISSEMENT AUTOMATIQUE — « voie découverte » (étape 2).
 *
 * DEUX ÉTAPES, DEUX RESPONSABILITÉS. À l'étape 1, l'intercalaire rend la main à
 * l'acquéreur : on lui remet SA carte, SES curseurs, SES critères dans leur état
 * réel, et on ne suggère AUCUNE modification — c'est lui qui décide comment il
 * élargit. À l'étape 2 seulement — quand son propre élargissement n'a ramené
 * aucun bien — le système élargit POUR lui, UN critère à la fois, et annonce
 * chaque bien concerné avant de le montrer.
 *
 * CE MODULE EST LE CERVEAU DE L'ÉTAPE 2, ET RIEN D'AUTRE. Il est 100 % pur :
 * aucun accès store, aucun réseau, aucun React. Il répond à trois questions —
 * dans quel ORDRE élargir (`buildWideningPlan`), de COMBIEN (les `patch` des
 * étapes), et ce qu'on ANNONCE d'un bien rapporté (`describeDiscovery`).
 *
 * L'ORDRE EST UNE RÈGLE PRODUIT, PAS UNE HEURISTIQUE. On élargit d'abord le
 * critère que l'acquéreur a le moins bougé lui-même à l'étape 1. S'il vient de
 * pousser son budget de 20 % sans rien toucher d'autre, c'est qu'il a dit ce
 * qu'il était prêt à lâcher côté budget : insister là serait le contredire. On
 * prend donc l'axe qu'il a laissé intact — celui sur lequel il ne s'est pas
 * encore prononcé. D'où le tri par TAUX D'ÉLARGISSEMENT CROISSANT entre l'état
 * d'avant l'intercalaire et l'état d'après : un critère intouché vaut 0 et
 * passe premier.
 *
 * L'INVARIANT DE MATCHING TIENT. Rien ici n'écrit dans `searchStore` : les
 * `patch` produits sont posés sur une COPIE du snapshot au moment de l'appel
 * moteur (cf. `generateDiscoveryFeed`). Les critères déclarés de l'acquéreur
 * restent exactement ceux qu'il a validés — l'implicite ne modifie jamais
 * silencieusement le déclaratif.
 *
 * ON N'ANNONCE QUE CE QUI EST VRAI. Le moteur est génératif : élargir le budget
 * de 15 % ne garantit pas que les biens rapportés dépassent réellement le
 * plafond déclaré. `describeDiscovery` renvoie `null` dès que le bien respecte
 * le critère — il rejoint alors le feed SANS annonce. Annoncer « il sort de vos
 * critères » à propos d'un bien qui y rentre serait un mensonge gratuit.
 *
 * LES CHAMBRES (ET LES PIÈCES) NE SE DESSERRENT PAS — arbitrage du 29/07 :
 * « lorsqu'on cherche “minimum 3 chambres”, ce seuil est très rarement
 * abaissé. » L'axe est sorti du plan ET du vocabulaire d'annonce : un bien de
 * la voie serveur dont l'unique échec est le nombre de pièces n'est plus
 * annonçable, donc il est JETÉ (règle « pas d'annonce ⇒ pas de bien »). Seul
 * l'acquéreur peut toucher à ce critère, à l'étape 1 — c'est le sien.
 */
import type { Property } from '@shomee/core/types/domain'
import { arrLabel, neighbourArrsOf, suggestNeighbourArrs } from './searchDiagnosis'
import { BUDGET_UNLIMITED, SURFACE_SCALE } from './scales'

/** Les trois axes élargissables, dans l'ordre de départage (cf. `TIE_BREAK`). */
export type WideningKind = 'zone' | 'budget' | 'surface'

/**
 * Le sous-ensemble de la recherche que l'étape 2 sait faire bouger. Les
 * chambres et les pièces n'y figurent plus (arbitrage du 29/07) : l'étape 2 ne
 * les touche jamais, et n'annonce plus rien à leur sujet.
 */
export interface WideningSnapshot {
  budgetMax: number | null
  minSurface: number | null
  arrondissementIds: string[]
  communeIds: string[]
  quartierIds: string[]
  irisIds: string[]
}

/** Champs de `BriefSnapshot` réécrits pour UN appel moteur — jamais persistés. */
export interface WideningPatch {
  budgetMax?: number
  minSurface?: number
  arrondissementIds?: string[]
}

export interface WideningStep {
  kind: WideningKind
  patch: WideningPatch
}

/**
 * Axes sur lesquels on sait ANNONCER un dépassement. Sur-ensemble strict de
 * `WideningKind` : la voie découverte du serveur peut aussi rapporter un bien
 * dont l'unique défaut est un critère qualitatif (chip) obligatoire — `criteria`
 * porte cette annonce-là. Le nombre de pièces, lui, est SORTI du vocabulaire le
 * 29/07 : sans mot pour le dire, un bien « une pièce en moins » n'est plus
 * annonçable, donc plus servi (« pas d'annonce ⇒ pas de bien »).
 */
export type NoticeKind = WideningKind | 'criteria'

/**
 * Ce que l'écran d'annonce affiche, une fois le dépassement VÉRIFIÉ sur le bien.
 * Trois fragments : la phrase (« Il dépasse un peu votre budget. »), le chiffre
 * du bien (« 585 000 € ») et le rappel du critère déclaré (« votre maximum :
 * 500 000 € »). Le titre, lui, est invariant et vit dans le composant.
 */
export interface DiscoveryNotice {
  kind: NoticeKind
  line: string
  value: string
  reference: string
}

/** Forme du `searchStore` lue par `readWideningSnapshot` (structurelle : pas de
 *  dépendance au store, le module reste pur et testable). */
export interface WideningStoreShape {
  budgetMax: number | null
  minSurface: number | null
  selectedArrIds: string[]
  selectedCommuneIds: string[]
  selectedQuartierIds: string[]
  selectedIrisIds: string[]
}

// ─── Doses d'élargissement ───────────────────────────────────────────────────

/** +15 % sur le plafond — chiffre produit, fixé par Olivier (révisé le 29/07 :
 *  « +30 %, je trouve ça beaucoup trop »). */
const BUDGET_FACTOR = 1.15
/**
 * −20 % sur la surface minimum. La consigne était « abaisser la surface
 * minimum » sans chiffre : le facteur est un choix d'implémentation, calé sur
 * l'ordre de grandeur du budget (un minimum de 50 m² descend à 40, pas à 25).
 */
const SURFACE_FACTOR = 0.8
/** Nombre d'arrondissements limitrophes ajoutés d'un coup à l'étape « zone ». */
const NEIGHBOUR_LIMIT = 4
/** Départage à taux d'élargissement égal — l'ordre le moins intrusif d'abord. */
const TIE_BREAK: readonly WideningKind[] = ['zone', 'budget', 'surface']

/**
 * Plafond de temps de la boucle de découverte, en ms. Chaque étape est une
 * génération complète côté moteur : quatre d'affilée pourraient étirer le
 * loader bien au-delà du raisonnable. Passé ce délai, on s'arrête sur ce qu'on
 * a. (Valeur d'implémentation, pas de consigne produit.)
 */
export const DISCOVERY_DEADLINE_MS = 12_000
/**
 * Nombre maximum de biens retenus par étape élargie. Chaque bien hors critères
 * coûte un écran d'annonce à l'acquéreur : au-delà de quelques-uns, la
 * découverte devient une file d'attente. (Valeur d'implémentation.)
 */
export const DISCOVERY_MAX_PER_STEP = 4
/**
 * Plafond GLOBAL de biens hors-brief par session de découverte, toutes couches
 * confondues (voie serveur + étapes élargies). C'est la borne du « rayon » :
 * au-delà, on ne propose plus — le terminus prend la parole. (Spec feed v2 §4,
 * approuvé le 29/07.)
 */
export const DISCOVERY_MAX_TOTAL = 8

// ─── Zones : reconstituer l'ensemble RÉEL des arrondissements déclarés ────────

/**
 * IRIS id → arrondissement. Réplique `arrFromIrisId` de
 * `apps/web/app/api/feed/generate/route.ts` : le code INSEE parisien est
 * `751NN` où NN est le numéro d'arrondissement.
 */
function arrFromIrisId(id: string): number | null {
  const m = /(?:^|[^0-9])751(0[1-9]|1[0-9]|20)/.exec(id)
  if (!m) return null
  const n = parseInt(m[1], 10)
  return n >= 1 && n <= 20 ? n : null
}

/**
 * `qu-NN` → arrondissement. Réplique `arrFromAdminQuartierId` du même fichier :
 * Paris compte 80 quartiers administratifs, 4 par arrondissement dans l'ordre,
 * donc arr = ⌈c_qu / 4⌉.
 */
function arrFromQuartierId(id: string): number | null {
  const m = /^qu-(\d{1,2})$/.exec(id)
  if (!m) return null
  const cQu = parseInt(m[1], 10)
  if (cQu < 1 || cQu > 80) return null
  return Math.ceil(cQu / 4)
}

/**
 * Ensemble COMPLET des arrondissements déclarés : ceux choisis en tant que tels,
 * PLUS ceux impliqués par un quartier ou un IRIS. Indispensable dans les deux
 * sens — sans ça, un acquéreur qui n'a sélectionné que des quartiers n'aurait
 * aucun limitrophe à se voir proposer, et un bien de SON arrondissement lui
 * serait annoncé « hors zone ».
 */
export function declaredArrs(s: WideningSnapshot): Set<number> {
  const out = new Set<number>()
  for (const id of s.arrondissementIds) {
    const m = /^arr-(\d{1,2})$/.exec(id)
    const n = m ? parseInt(m[1], 10) : NaN
    if (n >= 1 && n <= 20) out.add(n)
  }
  for (const id of s.quartierIds) {
    const n = arrFromQuartierId(id)
    if (n != null) out.add(n)
  }
  for (const id of s.irisIds) {
    const n = arrFromIrisId(id)
    if (n != null) out.add(n)
  }
  return out
}

/** Nombre de zones déclarées, tous grains confondus — sert à mesurer de combien
 *  l'acquéreur a ouvert sa carte lui-même. */
function zoneCount(s: WideningSnapshot): number {
  return (
    s.arrondissementIds.length +
    s.communeIds.length +
    s.quartierIds.length +
    s.irisIds.length
  )
}

// ─── Mesure de l'élargissement déjà consenti à l'étape 1 ─────────────────────

/**
 * Taux d'élargissement, en pour mille et jamais négatif. `delta` est déjà
 * orienté « dans le sens de l'ouverture », d'où les deux enveloppes ci-dessous.
 * Le pour mille est une QUANTIFICATION délibérée : deux axes réellement à
 * égalité (typiquement 0 et 0, les deux intouchés) doivent tomber sur le
 * départage, pas sur un écart de virgule flottante.
 */
function looseningRate(before: number, delta: number): number {
  if (!(before > 0)) return 0
  return Math.max(0, Math.round((delta / before) * 1000))
}
/** Un plafond qu'on monte (budget) s'ouvre vers le haut. */
function raised(before: number | null, after: number | null): number {
  if (before == null || after == null) return 0
  return looseningRate(before, after - before)
}
/** Un plancher qu'on baisse (surface, chambres) s'ouvre vers le bas. */
function lowered(before: number | null, after: number | null): number {
  if (before == null || after == null) return 0
  return looseningRate(before, before - after)
}

export function readWideningSnapshot(s: WideningStoreShape): WideningSnapshot {
  return {
    budgetMax: s.budgetMax,
    minSurface: s.minSurface,
    arrondissementIds: [...s.selectedArrIds],
    communeIds: [...s.selectedCommuneIds],
    quartierIds: [...s.selectedQuartierIds],
    irisIds: [...s.selectedIrisIds],
  }
}

/**
 * Le plan : les axes réellement élargissables, du moins bougé au plus bougé par
 * l'acquéreur. Un axe absent du plan est un axe sur lequel il n'y a rien à
 * élargir (pas de plafond déclaré, minimum déjà au plancher, une seule chambre
 * demandée, aucune zone parisienne d'où partir) — pas un axe écarté.
 *
 * `before` = l'état au moment où l'intercalaire s'est ouvert. `after` = l'état
 * validé par « Appliquer et relancer ». Les patchs, eux, partent TOUJOURS de
 * `after` : on élargit à partir de ce que l'acquéreur vient de déclarer.
 */
export function buildWideningPlan(
  before: WideningSnapshot,
  after: WideningSnapshot,
): WideningStep[] {
  const found: { step: WideningStep; loosened: number }[] = []

  const arrs = declaredArrs(after)
  if (arrs.size > 0) {
    const added = suggestNeighbourArrs(
      [...arrs].map((n) => `arr-${n}`),
      NEIGHBOUR_LIMIT,
    )
    if (added.length > 0) {
      const zonesBefore = zoneCount(before)
      found.push({
        step: { kind: 'zone', patch: { arrondissementIds: [...after.arrondissementIds, ...added] } },
        loosened: looseningRate(Math.max(1, zonesBefore), zoneCount(after) - zonesBefore),
      })
    }
  }

  const budgetMax = after.budgetMax
  if (budgetMax != null && budgetMax > 0 && budgetMax < BUDGET_UNLIMITED) {
    found.push({
      step: { kind: 'budget', patch: { budgetMax: Math.round(budgetMax * BUDGET_FACTOR) } },
      loosened: raised(before.budgetMax, budgetMax),
    })
  }

  const minSurface = after.minSurface
  if (minSurface != null && minSurface > 0) {
    const widened = Math.max(SURFACE_SCALE[0], Math.floor(minSurface * SURFACE_FACTOR))
    // Un minimum déjà au plancher de l'échelle n'a plus rien à céder.
    if (widened < minSurface) {
      found.push({
        step: { kind: 'surface', patch: { minSurface: widened } },
        loosened: lowered(before.minSurface, minSurface),
      })
    }
  }

  // Les chambres, elles, ne figurent VOLONTAIREMENT pas ici (29/07) : « minimum
  // 3 chambres » est un seuil qui ne s'abaisse pas — un bien avec une chambre de
  // moins n'est pas le même bien, c'est un autre projet. Seul l'acquéreur peut
  // en décider, à l'étape 1.

  return found
    .sort(
      (a, b) =>
        a.loosened - b.loosened ||
        TIE_BREAK.indexOf(a.step.kind) - TIE_BREAK.indexOf(b.step.kind),
    )
    .map((f) => f.step)
}

// ─── Annonce : ce qu'on dit d'un bien rapporté par la découverte ─────────────

/** Prix à la française sans `Intl` (support Hermes inégal) — même formatage que
 *  les overlays du feed. Ex. 585000 → « 585 000 € ». */
function formatEuro(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ') + ' €'
}

/**
 * Numéro d'arrondissement d'un bien, lu sur son libellé (« Paris 20ème »), tel
 * que le pose `arrondissementLabel` côté moteur. Renvoie `null` pour tout ce
 * qui n'est pas Paris intra-muros — commune limitrophe ou adresse en repli.
 */
function parisArrOf(p: Property): number | null {
  const m = /^Paris\s+(\d{1,2})\s*(?:er|ème|e)$/.exec((p.arrondissement || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 10)
  return n >= 1 && n <= 20 ? n : null
}

/**
 * Le dépassement réel de ce bien sur l'axe élargi, ou `null` s'il n'y en a pas.
 * `declared` est l'état DÉCLARÉ par l'acquéreur (jamais le patch) : c'est son
 * plafond à lui que l'annonce rappelle.
 *
 * Cas `zone` : on n'annonce « limitrophe du Ne » que si le bien est dans un
 * arrondissement parisien voisin d'un arrondissement déclaré. Un bien en commune
 * (Montreuil, Vincennes…) rejoint le feed SANS annonce : le dépôt n'a pas de
 * table d'adjacence arrondissement ↔ commune, et l'inventer serait affirmer une
 * limitrophie qu'on n'a pas vérifiée.
 */
export function describeDiscovery(
  p: Property,
  declared: WideningSnapshot,
  kind: WideningKind,
): DiscoveryNotice | null {
  switch (kind) {
    case 'budget': {
      const max = declared.budgetMax
      if (max == null || max <= 0 || max >= BUDGET_UNLIMITED) return null
      if (!(p.price > max)) return null
      return {
        kind,
        line: 'Il dépasse un peu votre budget.',
        value: formatEuro(p.price),
        reference: `votre maximum : ${formatEuro(max)}`,
      }
    }
    case 'surface': {
      const min = declared.minSurface
      if (min == null || min <= 0) return null
      if (!(p.surface < min)) return null
      return {
        kind,
        line: 'Il est un peu plus petit que votre minimum.',
        value: `${Math.round(p.surface)} m²`,
        reference: `votre minimum : ${min} m²`,
      }
    }
    case 'zone': {
      const n = parisArrOf(p)
      if (n == null) return null
      const arrs = declaredArrs(declared)
      if (arrs.size === 0 || arrs.has(n)) return null
      const touch = neighbourArrsOf(n).find((nb) => arrs.has(nb))
      if (touch == null) return null
      return {
        kind,
        line: 'Il sort un peu de votre zone.',
        value: p.arrondissement,
        reference: `limitrophe du ${arrLabel(`arr-${touch}`)}`,
      }
    }
  }
}

// ─── Annonce d'un bien venu de la voie découverte DU SERVEUR ─────────────────

/**
 * Ordre de sondage quand l'axe n'est pas connu d'avance. Il réplique celui de
 * `discoveryDelta` côté moteur (budget, puis surface) pour que l'annonce nomme
 * le MÊME critère que celui qui a fait basculer le bien en découverte. `zone`
 * ferme la marche et ne devrait jamais sortir : le filtre géographique de
 * `/api/properties` est un mur, pas un score — un bien hors zone n'atteint même
 * pas le scoring. Les PIÈCES ne se sondent plus (29/07) : un bien que le moteur
 * a relâché sur cet axe n'a plus d'annonce possible, donc il est jeté par
 * l'appelant — c'est exactement l'effet voulu.
 */
const PROBE_ORDER: readonly WideningKind[] = ['budget', 'surface', 'zone']

/** `discoveryDelta` du serveur pour un obligatoire qualitatif : « Hors critère : X ». */
const DELTA_CRITERIA = /^Hors critère\s*:\s*(.+)$/

/**
 * Annonce d'un bien rapporté par la voie `discovery` du moteur — celle qui vient
 * gratuitement avec la requête principale, sans qu'on ait rien élargi nous-mêmes.
 * Le serveur garantit UN SEUL obligatoire en défaut ; encore faut-il dire lequel,
 * et il ne nous le dit qu'en toutes lettres (`discoveryDelta`), pas en structuré.
 * On resonde donc le bien contre la recherche DÉCLARÉE, axe par axe, et on
 * n'annonce que l'écart qu'on peut vérifier soi-même — même exigence que
 * `describeDiscovery` : jamais un mot qu'on n'aurait pas recalculé.
 *
 * `delta` n'est utilisé qu'en dernier recours, pour l'unique cas qu'aucun sondage
 * ne peut retrouver : un critère qualitatif (chip) manqué, que rien dans le bien
 * projeté ne permet de constater. Sans annonce possible, on rend `null` — à
 * l'appelant d'écarter le bien plutôt que de l'infiltrer sans un mot.
 */
export function describeAnyDiscovery(
  p: Property,
  declared: WideningSnapshot,
  delta?: string,
): DiscoveryNotice | null {
  for (const kind of PROBE_ORDER) {
    const notice = describeDiscovery(p, declared, kind)
    if (notice) return notice
  }

  const m = delta ? DELTA_CRITERIA.exec(delta.trim()) : null
  if (m) {
    return {
      kind: 'criteria',
      line: 'Il ne coche pas un de vos critères.',
      value: m[1].trim(),
      reference: 'critère indiqué obligatoire',
    }
  }
  return null
}

// ─── Distance au brief : le tri du rayon de découverte ───────────────────────

/**
 * Distance NORMALISÉE d'un bien hors-brief au brief déclaré — 1.0 = la borne du
 * rayon, au-delà de laquelle un bien n'est jamais proposé (spec feed v2 §4).
 * « Aussi légèrement que possible » devient un tri : les biens se présentent du
 * plus proche au plus loin, jamais l'inverse.
 *
 *   budget  : dépassement relatif / 0.15   (+15 % = la borne)
 *   surface : manque relatif      / 0.20   (−20 % = la borne)
 *   zone    : limitrophe          = 1.0    (la borne exacte — pas de « presque »)
 *   chip    : 0.9                          (réel mais non quantifiable — près
 *                                           de la borne, servi en dernier)
 *
 * Un bien CONFORME au brief rend 0 (il peut arriver ici par une requête
 * élargie : il entre au feed sans annonce, et passe naturellement devant).
 */
export function discoveryDistance(
  p: Property,
  declared: WideningSnapshot,
  delta?: string,
): number {
  const max = declared.budgetMax
  if (max != null && max > 0 && max < BUDGET_UNLIMITED && p.price > max) {
    return (p.price - max) / max / 0.15
  }
  const min = declared.minSurface
  if (min != null && min > 0 && p.surface < min) {
    return (min - p.surface) / min / 0.2
  }
  const n = parisArrOf(p)
  if (n != null) {
    const arrs = declaredArrs(declared)
    if (arrs.size > 0 && !arrs.has(n)) return 1
  }
  if (delta && DELTA_CRITERIA.test(delta.trim())) return 0.9
  return 0
}
