/**
 * Comparer des noms de zone sans se faire piéger par l'orthographe.
 *
 * LE BUG QUE ÇA CORRIGE. Le dépôt écrivait les arrondissements sous TROIS
 * formes différentes selon le module :
 *   · « PARIS 11e »    — le seed et la création de bien (donc toutes les lignes
 *                        réellement présentes en base) ;
 *   · « Paris 11ème »  — le filtre du feed (/api/properties, /api/feed/estimate) ;
 *   · « Paris 11e »    — /api/feed/generate.
 * Le filtre du feed comparait donc « Paris 11ème » à « PARIS 11e » en SQL, à
 * l'octet près : aucune correspondance, jamais. Un bien publié dans le 11e
 * restait invisible dès que l'acquéreur sélectionnait une zone — il ne
 * réapparaissait que dans une recherche sans zone du tout. Rien dans les
 * journaux, rien dans les types : deux chaînes qui ne se ressemblent pas.
 *
 * La règle est désormais : on ne compare JAMAIS deux libellés de zone
 * directement, on compare leurs clés.
 *   « PARIS 11e » → « PARIS 11 »
 *   « Paris 11ème » → « PARIS 11 »
 *   « Paris 1er » → « PARIS 1 »
 *   « Boulogne-Billancourt » → « BOULOGNE-BILLANCOURT »
 */

/** Clé de comparaison : majuscules, sans accent, sans suffixe ordinal. */
export function cleZone(libelle: string): string {
  const brut = libelle
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .trim()
    .replace(/\s+/g, ' ')
  const paris = brut.match(/^PARIS\s+(\d{1,2})\s*(ER|EME|E)?$/)
  return paris ? `PARIS ${Number(paris[1])}` : brut
}

/** « arr-11 » → clé de zone. null si l'identifiant n'est pas un arrondissement. */
export function cleDepuisArrondissementId(id: string): string | null {
  const m = id.match(/^arr-(\d{1,2})$/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n >= 1 && n <= 20 ? `PARIS ${n}` : null
}

/** Libellé canonique d'affichage — celui qu'écrivent le seed et la création. */
export function libelleArrondissement(n: number): string {
  return `PARIS ${n}${n === 1 ? 'er' : 'e'}`
}

/**
 * Toutes les orthographes qu'un arrondissement peut avoir en base.
 *
 * Pour les endroits qui filtrent en SQL et ne peuvent pas normaliser côté
 * serveur : on élargit la liste au lieu de parier sur une seule graphie.
 */
export function variantesArrondissement(n: number): string[] {
  const suffixes = n === 1 ? ['er', 'ER', 'ème', 'eme'] : ['e', 'E', 'ème', 'eme', 'ÈME', 'EME']
  return [...new Set(['PARIS', 'Paris'].flatMap((base) => suffixes.map((s) => `${base} ${n}${s}`)))]
}
