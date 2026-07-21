/**
 * Shomee — normaliseur d'attributs CÔTÉ BIEN (harmonisation sémantique).
 *
 * Convertit les données textuelles d'une annonce (caractéristiques agent,
 * tags IA vidéo/doc, description) en ASSERTIONS tri-état sur les attributs
 * pivot du moteur : `true` (affirmé présent), `false` (affirmé absent),
 * absent du résultat (inconnu). Chaque assertion porte sa provenance.
 *
 * Principe : LLM aux bords, déterminisme au centre — ce module est 100 %
 * déterministe (lexique + négations), exécuté à l'ÉCRITURE (import, backfill)
 * et jamais au scoring. Utilisé par :
 *   - le script de backfill des 1500 biens réels (apps/web/scripts) ;
 *   - l'import agent (extension import-llm) ;
 *   - demain, l'interface agent mobile (mêmes fonctions via API).
 */

export type AttributeAssertions = {
  has_elevator?: boolean
  has_terrace?: boolean
  has_balcony?: boolean
  has_garden?: boolean
  has_cellar?: boolean
  has_parking?: boolean
  has_concierge?: boolean
  is_ground_floor?: boolean
  has_vis_a_vis?: boolean
  is_renovated?: boolean
  has_fireplace?: boolean
  is_traversant?: boolean
  is_quiet_street?: boolean
  floor?: number
}

export type AssertionProvenance = 'agent' | 'ai_video' | 'ai_doc' | 'description'

export interface NormalizedAttributes {
  assertions: AttributeAssertions
  /** provenance par attribut (le premier qui l'a affirmé gagne). */
  provenance: Partial<Record<keyof AttributeAssertions, AssertionProvenance>>
  /** Indices sémantiques détectés (lumineux, calme, charme…) → bump 0..1. */
  semanticHints: Partial<{
    luminosity: number
    quietness: number
    charm: number
    spaciousness: number
  }>
}

// ─── Normalisation texte ──────────────────────────────────────────────────────

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’ʼ]/g, "'")
}

// ─── Lexique : attribut → motifs positifs / négatifs ─────────────────────────
// Les motifs NÉGATIFS priment (« sans ascenseur » affirme has_elevator=false).

type BoolAttr = Exclude<keyof AttributeAssertions, 'floor'>

const LEXICON: Array<{ attr: BoolAttr; pos: RegExp; neg?: RegExp }> = [
  { attr: 'has_elevator',
    pos: /\bascenseur\b/,
    neg: /\b(?:sans|pas d')\s*ascenseur\b/ },
  { attr: 'has_terrace',
    pos: /\bterrasses?\b/,
    neg: /\b(?:sans|pas de)\s*terrasses?\b/ },
  { attr: 'has_balcony',
    pos: /\bbalcons?\b/,
    neg: /\b(?:sans|pas de)\s*balcons?\b/ },
  { attr: 'has_garden',
    pos: /\bjardins?\b/,
    neg: /\b(?:sans|pas de)\s*jardins?\b/ },
  { attr: 'has_cellar',
    pos: /\bcaves?\b/,
    neg: /\b(?:sans|pas de)\s*caves?\b/ },
  { attr: 'has_parking',
    pos: /\b(?:parking|box|place de stationnement|garage)\b/,
    neg: /\b(?:sans|pas de)\s*(?:parking|box|garage)\b/ },
  { attr: 'has_concierge',
    pos: /\b(?:gardien(?:ne)?|concierge)\b/,
    neg: /\b(?:sans|pas de)\s*(?:gardien(?:ne)?|concierge)\b/ },
  { attr: 'is_ground_floor',
    pos: /\b(?:rez[- ]de[- ]chauss[ée]e|rdc)\b/ },
  { attr: 'has_vis_a_vis',
    // « pas de vis-à-vis » / « sans vis-à-vis » → affirmé ABSENT (false).
    pos: /\bvis[- ]?a[- ]?vis\b/,
    neg: /\b(?:sans|pas de|aucun)\s*vis[- ]?a[- ]?vis\b/ },
  { attr: 'is_renovated',
    pos: /\b(?:refait(?:e)?s?\s+(?:a\s+neuf|entierement)|renov[ée]e?s?|renovation recente)\b/,
    neg: /\b(?:travaux\s+(?:a\s+prevoir|importants)|a\s+renover|a\s+rafraichir)\b/ },
  { attr: 'has_fireplace',
    pos: /\bcheminees?\b/ },
  { attr: 'is_traversant',
    pos: /\btraversante?s?\b/ },
  { attr: 'is_quiet_street',
    pos: /\b(?:au\s+calme|tres\s+calme|rue\s+calme|sur\s+cour)\b/,
    neg: /\b(?:rue\s+(?:passante|bruyante)|bruyante?)\b/ },
]

// Étage : « 3ème étage », « au 4e », « étage 5 », « dernier étage » (non résolu ici).
const FLOOR_RE = /\b(?:au\s+)?(\d{1,2})\s*(?:e(?:me)?|er)?\s+etage\b|\betage\s+(\d{1,2})\b/

// Indices sémantiques (bump de score quand le texte l'affirme).
const SEMANTIC_LEXICON: Array<{ key: keyof NormalizedAttributes['semanticHints']; re: RegExp; value: number }> = [
  { key: 'luminosity', re: /\b(?:tres\s+lumineux|lumineuse?|baigne[ée]?\s+de\s+lumiere|ensoleill[ée]e?|plein\s+sud)\b/, value: 0.8 },
  { key: 'quietness', re: /\b(?:au\s+calme|tres\s+calme|sur\s+cour|silencieux)\b/, value: 0.8 },
  { key: 'charm', re: /\b(?:cachet|moulures?|parquet|cheminees?|haussmannien(?:ne)?|pierre de taille|caractere)\b/, value: 0.8 },
  { key: 'spaciousness', re: /\b(?:beaux?\s+volumes?|hauteur\s+sous\s+plafond|spacieux|spacieuse|grands?\s+volumes?)\b/, value: 0.75 },
]

// ─── API ─────────────────────────────────────────────────────────────────────

export interface NormalizeInput {
  /** Caractéristiques saisies par l'agent (features[]). */
  features?: string[]
  /** Tags libres (dont IA vidéo / doc). */
  tags?: Array<string | { label: string; source?: string }>
  /** Description de l'annonce. */
  description?: string
}

/**
 * Normalise les textes d'un bien en assertions tri-état.
 * Priorité de provenance : agent (features) > ai_video/ai_doc (tags) >
 * description. Le premier à affirmer un attribut fixe sa valeur — un
 * conflit ultérieur ne l'écrase pas (l'agent fait foi).
 */
export function normalizePropertyText(input: NormalizeInput): NormalizedAttributes {
  const out: NormalizedAttributes = { assertions: {}, provenance: {}, semanticHints: {} }

  const sources: Array<{ text: string; prov: AssertionProvenance }> = []
  for (const f of input.features ?? []) sources.push({ text: f, prov: 'agent' })
  for (const t of input.tags ?? []) {
    if (typeof t === 'string') sources.push({ text: t, prov: 'ai_video' })
    else sources.push({ text: t.label, prov: t.source === 'AI_DOC' ? 'ai_doc' : 'ai_video' })
  }
  if (input.description) sources.push({ text: input.description, prov: 'description' })

  for (const { text, prov } of sources) {
    const n = norm(text)

    for (const { attr, pos, neg } of LEXICON) {
      if (out.assertions[attr] !== undefined) continue // premier affirmant gagne
      if (neg && neg.test(n)) {
        // Négation : « sans ascenseur » → elevator=false ; « pas de
        // vis-à-vis » → vis_a_vis=false (bonne nouvelle pour l'acquéreur).
        out.assertions[attr] = attr === 'is_renovated' ? false : false
        out.provenance[attr] = prov
      } else if (pos.test(n)) {
        out.assertions[attr] = true
        out.provenance[attr] = prov
      }
    }

    if (out.assertions.floor === undefined) {
      const fm = n.match(FLOOR_RE)
      if (fm) {
        const val = parseInt(fm[1] ?? fm[2], 10)
        if (Number.isFinite(val) && val >= 0 && val <= 40) {
          out.assertions.floor = val
          out.provenance.floor = prov
        }
      }
    }

    for (const { key, re, value } of SEMANTIC_LEXICON) {
      if (out.semanticHints[key] === undefined && re.test(n)) {
        out.semanticHints[key] = value
      }
    }
  }

  return out
}
