/**
 * /api/mcp — Serveur MCP distant SHOMEE (S9 H4b)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * À QUOI ÇA SERT
 * Un « connecteur » que l'on colle dans ChatGPT (mode développeur) ou dans
 * Claude (connecteur personnalisé). Une fois branché, l'IA mène l'entretien
 * acquéreur (zone, budget, surface, critères) puis crée — ou modifie — la
 * recherche directement dans SHOMEE. L'acquéreur reçoit un lien + un code
 * court à 7 caractères qui ouvre l'app native avec la recherche pré-remplie.
 *
 * POURQUOI UN SEUL FICHIER, ET POURQUOI /api/mcp TOUT COURT
 * Le SDK MCP expose depuis la 1.29 un transport « Web Standard »
 * (WebStandardStreamableHTTPServerTransport) qui prend un `Request` et rend un
 * `Response` : exactement la signature d'un route handler Next.js. On n'a donc
 * plus besoin du paquet `mcp-handler` de Vercel, ni de son segment dynamique
 * `[transport]` qui imposait l'URL bizarre /api/mcp/mcp. Une seule dépendance
 * nouvelle : @modelcontextprotocol/sdk (compatible zod 3 ET zod 4, donc
 * compatible avec le zod 4 déjà installé dans apps/web).
 *
 * MODE SANS ÉTAT (stateless)
 * Une fonction serverless ne survit pas entre deux requêtes : on recrée donc un
 * serveur MCP + un transport à chaque appel, sans identifiant de session
 * (`sessionIdGenerator` non fourni). `enableJsonResponse` évite d'ouvrir un
 * flux SSE qui resterait suspendu jusqu'au timeout de la fonction.
 * GET et DELETE répondent 405 : le protocole prévoit explicitement ce cas
 * quand le serveur n'offre pas de flux initié par le serveur.
 *
 * L'URL DU CONNECTEUR PORTE SA CONFIGURATION
 *   https://<domaine>/api/mcp?k=<MCP_PRIVATE_KEY>&client=chatgpt&profil=acquereur
 *
 *   k       secret partagé. Absent ou faux → 404 (on ne révèle même pas que la
 *           route existe). Provisoire : à remplacer par OAuth 2.0 en H5, qui
 *           sera de toute façon obligatoire pour un connecteur public.
 *   client  chatgpt | claude | web → recopié dans Handoff.source, ce qui permet
 *           de mesurer l'entonnoir par canal d'acquisition. Défaut : web.
 *   profil  acquereur (défaut) → outils de brief ; admin → statistiques.
 *           Deux URLs différentes = deux connecteurs différents : celui qu'un
 *           acquéreur pourrait installer ne voit jamais les chiffres internes.
 *
 * ÉCRITURES : PRISMA EN DIRECT, PAS DE DÉTOUR HTTP
 * On ne rappelle pas /api/handoff/create depuis ici. Un fetch du serveur vers
 * son propre domaine de prévisualisation serait bloqué par la protection de
 * déploiement Vercel, et il faudrait porter une clé bearer pour se parler à
 * soi-même. On réutilise donc les mêmes briques que ces routes —
 * AIOnboardingBriefSchema, generateShortCode, formatShortCode — pour que le
 * contrat reste strictement identique (TTL 7 jours, retry sur collision de
 * code, `parsed[]` abandonné à la modification).
 *
 * LE PROTOCOLE DE CONVERSATION EST ÉCRIT DEUX FOIS, EXPRÈS
 * Claude lit le champ `instructions` du serveur. ChatGPT, lui, ne l'expose pas
 * de façon fiable : il ne lit vraiment que les descriptions d'outils. Le script
 * d'entretien vit donc (1) dans `instructions` et (2) dans la valeur de retour
 * de l'outil `shomee_guide_brief`, que la description des autres outils
 * demande d'appeler en premier. Le catalogue exact des critères est en plus
 * répété dans la description du champ `chipStates`.
 *
 * ET LE DERNIER FILET EST CÔTÉ SERVEUR
 * Un LLM finit toujours par écrire « vue degagee » ou « charme/cachet ». Un tel
 * libellé, stocké tel quel dans chipStates, serait une clé que l'app native ne
 * reconnaît pas : critère perdu en silence. `composerCriteres` rapproche donc
 * chaque libellé du catalogue à la casse, aux accents et à la ponctuation près,
 * le réécrit sous sa forme exacte, et renvoie tout le reste vers customCriteria.
 * Aucun critère exprimé par l'acquéreur ne peut disparaître.
 *
 * BÊTA : SHOMEE_VERCEL_BYPASS
 * Tant que le site vit sur une prévisualisation protégée, le lien remis à
 * l'acquéreur doit porter le secret de contournement en paramètre. Cela fait
 * fuiter ce secret dans le lien : c'est accepté en bêta fermée, et cette
 * variable disparaît avec le domaine de production (H0).
 *
 * Variables d'environnement (apps/web/.env.local et Vercel) :
 *   MCP_PRIVATE_KEY       (requis) secret de l'URL du connecteur
 *   NEXT_PUBLIC_APP_URL   (optionnel) base des liens /h/<token>
 *   SHOMEE_VERCEL_BYPASS  (optionnel, bêta) secret de contournement Vercel
 */

import { timingSafeEqual } from 'node:crypto'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'
import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/prisma'
import { AIOnboardingBriefSchema, zodErrorMessage } from '@/lib/handoff/briefSchema'
import {
  generateShortCode,
  formatShortCode,
  normalizeShortCode,
  isPlausibleShortCode,
} from '@/lib/handoff/shortCode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const HANDOFF_TTL_MS = 1000 * 60 * 60 * 24 * 7 // 7 jours, comme /api/handoff/create

/**
 * Catalogue des critères de l'app native. Ces libellés sont les clés de
 * `chipStates` ; l'app native ne reconnaît rien d'autre. Tout le reste part
 * dans `customCriteria`.
 */
const CATALOGUE_CRITERES = [
  'Extérieur',
  'Terrasse',
  'Balcon',
  'Dernier étage',
  'Traversant',
  'Lumineux',
  'Calme',
  'Vue dégagée',
  'Cuisine ouverte',
  'Charme / cachet',
  'Ascenseur',
  'Gardien',
  'Parking',
  'Cave',
  'Local vélo',
  'Faibles charges',
  'Petite copropriété',
  'Immeuble récent',
  'Standing',
  'Parties communes rénovées',
] as const

// ─── Le script d'entretien acquéreur ───────────────────────────────────────

const PROTOCOLE_ACQUEREUR = `PROTOCOLE D'ENTRETIEN ACQUÉREUR SHOMEE

Tu mènes un entretien court pour comprendre ce que la personne cherche à
ACHETER, puis tu enregistres sa recherche dans SHOMEE. Toujours en français,
sur un ton simple et direct. Jamais plus de 3 ou 4 questions à la fois.

ÉTAPE 1 — LA CONVERSATION

1. ZONE — « Où cherchez-vous ? »
   Recopie ses mots tels quels dans locationQuery (« Paris 11e autour d'Aligre »,
   « Bordeaux Chartrons », « proche du métro Pernety »). Ne traduis pas en
   codes postaux, ne normalise pas : le moteur SHOMEE comprend le langage
   naturel et le quartier vécu compte plus que l'arrondissement.

2. BUDGET — « Quel est votre budget maximum ? »
   budgetMax est INDISPENSABLE. budgetMin seulement si la personne l'exprime
   d'elle-même (« pas en dessous de 600 000 »). Ne devine JAMAIS un budget.

3. SURFACE ET PIÈCES — « À partir de combien de m² ? Combien de pièces ? »
   minSurface est INDISPENSABLE. Si la personne ne parle qu'en pièces, demande
   explicitement la surface plancher qu'elle refuse de descendre en dessous.
   Les chambres (minBedrooms) comptent souvent plus que les pièces pour une
   famille : pose la question si le contexte le suggère.

4. TYPE DE BIEN — appartement, maison, loft, atelier (plusieurs possibles).
   Ne remplis propertyTypes que si la personne a une préférence réelle.

5. CRITÈRES — « Qu'est-ce qui compte vraiment pour vous ? »
   C'est le cœur de SHOMEE. Chaque critère est QUALIFIÉ, pas juste listé :
     1 = souhaité      (« ce serait bien »)
     2 = obligatoire   (« sans ça je ne visite pas »)
     3 = rédhibitoire  (« surtout pas ça »)
   Reformule pour trancher : « L'extérieur, c'est indispensable ou juste un
   plus ? » Un critère non qualifié ne sert à rien.

   Libellés du catalogue à recopier À L'IDENTIQUE dans chipStates :
   ${CATALOGUE_CRITERES.join(', ')}.

   Tout ce qui sort de ce catalogue va dans customCriteria, avec le même
   barème 1/2/3 — par exemple « pas de rez-de-chaussée » en 3,
   « ascenseur obligatoire à partir du 4e » en 2, « école primaire à moins de
   10 minutes à pied » en 1.

ÉTAPE 2 — LE RÉCAPITULATIF
Présente ce que tu as compris, groupé par obligatoire / souhaité / à éviter,
et demande une validation explicite : « C'est bien ça ? Je l'enregistre ? »
N'enregistre RIEN avant un oui clair.

ÉTAPE 3 — L'ENREGISTREMENT
Appelle shomee_creer_recherche avec les champs collectés, plus
transcriptSummary : une ou deux phrases qui résument le projet et son
pourquoi (« Couple avec un bébé, quitte un 2 pièces sans extérieur, veut
rester dans le quartier pour l'école »). Ce résumé s'affiche à l'acquéreur
sur la page de reprise et permet de garder le contexte que les critères
seuls ne portent pas.

ÉTAPE 4 — LA TRANSMISSION
Donne le lien ET le code court. À dire à l'acquéreur :
 · sur iPhone, ouvrir le lien fait basculer directement dans l'app SHOMEE ;
 · si l'app n'est pas installée, le lien mène à la page de téléchargement,
   et le code à 7 caractères permet de retrouver la recherche après
   l'installation (« J'ai un code ») ;
 · le lien et le code restent valables 7 jours.

ÉTAPE 5 — LES RETOUCHES
Si la personne veut changer quelque chose juste après (« finalement, monte
le budget à 900 000 »), utilise shomee_modifier_recherche avec le code.
La modification n'est possible que TANT QUE la recherche n'a pas été
récupérée dans l'app ; après, c'est dans l'app que ça se change.
En cas de doute sur l'état actuel, appelle d'abord shomee_relire_recherche.

RÈGLES ABSOLUES
 · Ne jamais inventer un critère que la personne n'a pas exprimé.
 · Ne jamais deviner un budget ou une surface.
 · Ne jamais enregistrer sans validation explicite.
 · Ne jamais inventer un libellé de catalogue : hors liste → customCriteria.
 · Toujours répondre en français.`

const INSTRUCTIONS_ACQUEREUR = `Tu es l'assistant SHOMEE côté acquéreur. SHOMEE est une application de
recherche immobilière par la vidéo : l'acquéreur décrit ce qu'il veut vraiment,
et l'app lui présente des visites filmées classées par pertinence.

Dès qu'une personne évoque un projet d'ACHAT immobilier — même vaguement
(« je cherche un 3 pièces », « on voudrait déménager », « un appart avec
terrasse à Lyon ») — mène l'entretien ci-dessous puis enregistre sa recherche
avec shomee_creer_recherche.

${PROTOCOLE_ACQUEREUR}`

const INSTRUCTIONS_ADMIN = `Tu es l'assistant d'administration SHOMEE. Les outils disponibles renvoient des
chiffres calculés directement en base : cite-les tels quels, ne les estime
jamais et ne les extrapole pas. Réponds en français.`

// ─── Aides de présentation ─────────────────────────────────────────────────

function resultatTexte(payload: unknown, isError = false) {
  return {
    isError,
    content: [
      {
        type: 'text' as const,
        text: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2),
      },
    ],
  }
}

function dateFr(d: Date): string {
  return d.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/Paris',
  })
}

function euros(n: number): string {
  return `${n.toLocaleString('fr-FR')} €`
}

function intervalle(min: unknown, max: unknown): string | null {
  const a = typeof min === 'number' ? min : null
  const b = typeof max === 'number' ? max : null
  if (a !== null && b !== null) return a === b ? `${a}` : `${a} à ${b}`
  if (a !== null) return `${a} minimum`
  if (b !== null) return `${b} maximum`
  return null
}

/** Rend un brief lisible par un humain — c'est ce que le LLM va paraphraser. */
function resumerBrief(brut: unknown): string {
  const b = (brut ?? {}) as Record<string, unknown>
  const lignes: string[] = []

  if (typeof b.locationQuery === 'string') lignes.push(`Zone        : ${b.locationQuery}`)

  const bMin = typeof b.budgetMin === 'number' ? b.budgetMin : null
  const bMax = typeof b.budgetMax === 'number' ? b.budgetMax : null
  if (bMax !== null) {
    lignes.push(`Budget      : ${bMin !== null ? `${euros(bMin)} – ${euros(bMax)}` : `jusqu'à ${euros(bMax)}`}`)
  }

  const sMin = typeof b.minSurface === 'number' ? b.minSurface : null
  const sMax = typeof b.maxSurface === 'number' ? b.maxSurface : null
  if (sMin !== null) {
    lignes.push(`Surface     : à partir de ${sMin} m²${sMax !== null ? ` (max ${sMax} m²)` : ''}`)
  }

  const pieces = intervalle(b.minRooms, b.maxRooms)
  if (pieces) lignes.push(`Pièces      : ${pieces}`)
  const chambres = intervalle(b.minBedrooms, b.maxBedrooms)
  if (chambres) lignes.push(`Chambres    : ${chambres}`)

  const types = Array.isArray(b.propertyTypes)
    ? b.propertyTypes.filter((t): t is string => typeof t === 'string')
    : []
  if (types.length > 0) lignes.push(`Types       : ${types.join(', ')}`)

  const parEtat: Record<1 | 2 | 3, string[]> = { 1: [], 2: [], 3: [] }
  const chips = (b.chipStates ?? {}) as Record<string, unknown>
  for (const [libelle, etat] of Object.entries(chips)) {
    if (etat === 1 || etat === 2 || etat === 3) parEtat[etat].push(libelle)
  }
  const libres = Array.isArray(b.customCriteria) ? b.customCriteria : []
  for (const brutCritere of libres) {
    const c = (brutCritere ?? {}) as { label?: unknown; state?: unknown }
    if (typeof c.label === 'string' && (c.state === 1 || c.state === 2 || c.state === 3)) {
      parEtat[c.state].push(`${c.label} (libre)`)
    }
  }
  if (parEtat[2].length > 0) lignes.push(`Obligatoire : ${parEtat[2].join(', ')}`)
  if (parEtat[1].length > 0) lignes.push(`Souhaité    : ${parEtat[1].join(', ')}`)
  if (parEtat[3].length > 0) lignes.push(`À éviter    : ${parEtat[3].join(', ')}`)

  if (typeof b.transcriptSummary === 'string' && b.transcriptSummary.length > 0) {
    lignes.push(`Contexte    : ${b.transcriptSummary}`)
  }

  return lignes.length > 0 ? lignes.join('\n') : '(brief vide)'
}

// ─── Rangement des critères (le filet côté serveur) ────────────────────────

/** Clé de comparaison tolérante : « Vue dégagée », « vue degagee », « VUE-DEGAGEE » → « vue degagee ». */
function clefCritere(libelle: string): string {
  return libelle
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

const INDEX_CATALOGUE = new Map<string, string>(
  CATALOGUE_CRITERES.map((libelle) => [clefCritere(libelle), libelle]),
)

type EtatCritere = 1 | 2 | 3
type CritereLibre = { label: string; state: EtatCritere }

/**
 * Range les critères là où l'app native sait les lire, et applique les
 * modifications demandées. Un libellé reconnu comme appartenant au catalogue
 * (à la casse, aux accents et à la ponctuation près) est réécrit sous sa forme
 * exacte dans chipStates ; tout le reste devient un critère libre. L'état 0
 * retire le critère, qu'il soit du catalogue ou libre.
 *
 * Ordre d'application : les critères déjà enregistrés, puis la liste des
 * critères libres si elle est remplacée, puis les changements demandés — donc
 * un chipStates entrant a toujours le dernier mot.
 */
function composerCriteres(args: {
  chipsPrecedents?: unknown
  customPrecedents?: unknown
  chipsEntrants?: Record<string, number>
  customRemplacement?: CritereLibre[]
}): { chipStates: Record<string, EtatCritere>; customCriteria: CritereLibre[] } {
  const catalogue = new Map<string, CritereLibre>()
  const libres = new Map<string, CritereLibre>()

  const poser = (libelleBrut: string, etat: number): void => {
    const clef = clefCritere(libelleBrut)
    if (clef.length === 0) return
    if (etat === 0) {
      catalogue.delete(clef)
      libres.delete(clef)
      return
    }
    if (etat !== 1 && etat !== 2 && etat !== 3) return
    const exact = INDEX_CATALOGUE.get(clef)
    if (exact) {
      libres.delete(clef)
      catalogue.set(clef, { label: exact, state: etat })
    } else {
      catalogue.delete(clef)
      libres.set(clef, { label: libelleBrut.trim(), state: etat })
    }
  }

  // 1. Ce qui était déjà enregistré (déjà canonique, mais on repasse dessus au
  //    cas où un brief plus ancien porterait un libellé approximatif).
  const chipsAvant = (args.chipsPrecedents ?? {}) as Record<string, unknown>
  for (const [libelle, etat] of Object.entries(chipsAvant)) {
    if (typeof etat === 'number') poser(libelle, etat)
  }

  // 2. Les critères libres : remplacés en bloc si une liste est fournie,
  //    sinon conservés tels quels.
  const sourceLibres: unknown[] =
    args.customRemplacement ?? (Array.isArray(args.customPrecedents) ? args.customPrecedents : [])
  for (const brut of sourceLibres) {
    const c = (brut ?? {}) as { label?: unknown; state?: unknown }
    if (typeof c.label === 'string' && typeof c.state === 'number') poser(c.label, c.state)
  }

  // 3. Les changements demandés.
  for (const [libelle, etat] of Object.entries(args.chipsEntrants ?? {})) poser(libelle, etat)

  const chipStates: Record<string, EtatCritere> = {}
  for (const critere of catalogue.values()) chipStates[critere.label] = critere.state
  return { chipStates, customCriteria: [...libres.values()] }
}

// ─── Lecture d'un handoff ──────────────────────────────────────────────────

type HandoffLu = {
  id: string
  token: string
  shortCode: string
  source: string
  status: string
  brief: unknown
  expiresAt: Date
  claimedAt: Date | null
}

function statutLisible(h: HandoffLu): string {
  if (h.status === 'claimed') {
    return `récupérée dans l'app${h.claimedAt ? ` le ${dateFr(h.claimedAt)}` : ''} — plus modifiable ici`
  }
  if (h.expiresAt.getTime() < Date.now()) return `expirée depuis le ${dateFr(h.expiresAt)}`
  return `en attente — valable jusqu'au ${dateFr(h.expiresAt)}`
}

/** Lien /h/<token>, avec le contournement Vercel en bêta (voir en-tête). */
function lienHandoff(origine: string, token: string): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? origine).replace(/\/$/, '')
  const url = `${base}/h/${token}`
  const bypass = process.env.SHOMEE_VERCEL_BYPASS ?? process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  if (!bypass) return url
  return `${url}?x-vercel-protection-bypass=${encodeURIComponent(bypass)}&x-vercel-set-bypass-cookie=true`
}

type Resolution = { ok: true; handoff: HandoffLu } | { ok: false; message: string }

async function resoudreHandoff(args: { code?: string; token?: string }): Promise<Resolution> {
  if (args.token && args.token.length > 0) {
    const handoff = await prisma.handoff.findUnique({ where: { token: args.token } })
    if (!handoff) return { ok: false, message: 'Aucune recherche ne correspond à ce lien.' }
    return { ok: true, handoff }
  }
  if (args.code && args.code.length > 0) {
    const canonique = normalizeShortCode(args.code)
    if (!isPlausibleShortCode(canonique)) {
      return {
        ok: false,
        message:
          'Ce code ne ressemble pas à un code SHOMEE (7 caractères, sans 0/O ni 1/I/L). Demande à la personne de le relire.',
      }
    }
    const handoff = await prisma.handoff.findUnique({ where: { shortCode: canonique } })
    if (!handoff) return { ok: false, message: `Aucune recherche ne porte le code ${formatShortCode(canonique)}.` }
    return { ok: true, handoff }
  }
  return { ok: false, message: 'Fournis le code court de la recherche (ou son token).' }
}

// ─── Schémas d'entrée des outils ───────────────────────────────────────────

const ChipState = z
  .union([z.literal(1), z.literal(2), z.literal(3)])
  .describe('1 = souhaité, 2 = obligatoire, 3 = rédhibitoire / à éviter')

const ChipStateOuRetrait = z
  .union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)])
  .describe('0 = retirer ce critère, 1 = souhaité, 2 = obligatoire, 3 = rédhibitoire')

const DESCRIPTION_CATALOGUE = `Critères du catalogue SHOMEE → importance. Les libellés doivent être recopiés À L'IDENTIQUE : ${CATALOGUE_CRITERES.join(', ')}. Tout autre critère va dans customCriteria.`

const CreerShape = {
  locationQuery: z
    .string()
    .min(2)
    .describe(
      "Zone de recherche DANS LES MOTS DE L'ACQUÉREUR (ex. « Paris 11e autour d'Aligre », « Bordeaux Chartrons »). Ne pas traduire en code postal. OBLIGATOIRE.",
    ),
  budgetMax: z.number().positive().describe('Budget maximum en euros. OBLIGATOIRE — ne jamais le deviner.'),
  minSurface: z.number().positive().describe('Surface minimum en m². OBLIGATOIRE — ne jamais la deviner.'),
  budgetMin: z.number().positive().optional().describe("Budget plancher, seulement si l'acquéreur l'a exprimé."),
  maxSurface: z.number().positive().optional().describe('Surface maximum en m², si exprimée.'),
  minRooms: z.number().int().positive().optional().describe('Nombre de pièces minimum.'),
  maxRooms: z.number().int().positive().optional().describe('Nombre de pièces maximum.'),
  minBedrooms: z.number().int().positive().optional().describe('Nombre de chambres minimum.'),
  maxBedrooms: z.number().int().positive().optional().describe('Nombre de chambres maximum.'),
  propertyTypes: z
    .array(z.enum(['appartement', 'maison', 'loft', 'atelier']))
    .optional()
    .describe("Types de bien souhaités. À laisser vide si l'acquéreur n'a pas de préférence."),
  chipStates: z.record(z.string(), ChipState).optional().describe(DESCRIPTION_CATALOGUE),
  customCriteria: z
    .array(z.object({ label: z.string().min(1), state: ChipState }))
    .optional()
    .describe(
      'Critères hors catalogue, dans les mots de l\'acquéreur (ex. { label: "pas de rez-de-chaussée", state: 3 }).',
    ),
  transcriptSummary: z
    .string()
    .max(2000)
    .optional()
    .describe(
      "Une ou deux phrases sur le projet et son pourquoi. Affiché à l'acquéreur sur la page de reprise.",
    ),
}

const ModifierShape = {
  code: z.string().optional().describe('Code court de la recherche (ex. « 4F2A-9K2 »). Le plus simple.'),
  token: z.string().optional().describe('Token du lien /h/<token>, si le code n\'est pas connu.'),
  locationQuery: z.string().min(2).optional().describe("Nouvelle zone, dans les mots de l'acquéreur."),
  budgetMax: z.number().positive().optional().describe('Nouveau budget maximum en euros.'),
  minSurface: z.number().positive().optional().describe('Nouvelle surface minimum en m².'),
  budgetMin: z.number().positive().nullable().optional().describe('Nouveau budget plancher — null pour le retirer.'),
  maxSurface: z.number().positive().nullable().optional().describe('Nouvelle surface maximum — null pour la retirer.'),
  minRooms: z.number().int().positive().nullable().optional().describe('Pièces minimum — null pour retirer.'),
  maxRooms: z.number().int().positive().nullable().optional().describe('Pièces maximum — null pour retirer.'),
  minBedrooms: z.number().int().positive().nullable().optional().describe('Chambres minimum — null pour retirer.'),
  maxBedrooms: z.number().int().positive().nullable().optional().describe('Chambres maximum — null pour retirer.'),
  propertyTypes: z
    .array(z.enum(['appartement', 'maison', 'loft', 'atelier']))
    .optional()
    .describe('REMPLACE la liste des types de bien (liste vide = plus de préférence).'),
  chipStates: z
    .record(z.string(), ChipStateOuRetrait)
    .optional()
    .describe(
      `FUSIONNE avec les critères existants : seuls les libellés fournis changent, 0 retire le critère. ${DESCRIPTION_CATALOGUE}`,
    ),
  customCriteria: z
    .array(z.object({ label: z.string().min(1), state: ChipState }))
    .optional()
    .describe(
      'REMPLACE toute la liste des critères libres — relis la recherche avant, pour ne pas en perdre.',
    ),
  transcriptSummary: z
    .string()
    .max(2000)
    .optional()
    .describe("Nouveau résumé du projet — à ne fournir que si le contexte a réellement changé."),
}

const RelireShape = {
  code: z.string().optional().describe('Code court de la recherche (ex. « 4F2A-9K2 »).'),
  token: z.string().optional().describe('Token du lien /h/<token>.'),
}

// ─── Construction du serveur MCP ───────────────────────────────────────────

type Profil = 'acquereur' | 'admin'
type Client = 'chatgpt' | 'claude' | 'web'

function creerServeur(profil: Profil, client: Client, origine: string): McpServer {
  const server = new McpServer(
    { name: 'shomee', version: '0.3.0' },
    {
      instructions: profil === 'admin' ? INSTRUCTIONS_ADMIN : INSTRUCTIONS_ACQUEREUR,
      capabilities: { tools: {} },
    },
  )

  // ── Diagnostic, présent dans les deux profils ──────────────────────────
  server.registerTool(
    'shomee_ping',
    {
      title: 'État du serveur SHOMEE',
      description:
        "Vérifie que le serveur SHOMEE répond et que sa base de données est joignable. À utiliser en premier si un autre outil échoue.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        await prisma.$queryRaw`SELECT 1`
        return resultatTexte({
          serveur: 'shomee-mcp-distant',
          version: '0.3.0',
          profil,
          client,
          environnement: process.env.VERCEL_ENV ?? 'local',
          base_de_donnees: 'joignable',
          genere_le: new Date().toISOString(),
        })
      } catch (e) {
        return resultatTexte(
          {
            serveur: 'shomee-mcp-distant',
            base_de_donnees: 'INJOIGNABLE',
            detail: e instanceof Error ? e.message : String(e),
          },
          true,
        )
      }
    },
  )

  if (profil === 'admin') {
    outilsAdmin(server)
    return server
  }

  outilsAcquereur(server, client, origine)
  return server
}

// ─── Outils du profil acquéreur ────────────────────────────────────────────

function outilsAcquereur(server: McpServer, client: Client, origine: string): void {
  // 1. Le protocole, servi comme un outil — c'est ce qui remplace les
  //    « instructions » que ChatGPT ne lit pas.
  server.registerTool(
    'shomee_guide_brief',
    {
      title: 'Mode opératoire SHOMEE',
      description:
        "À APPELER EN PREMIER dès qu'une personne parle d'un projet d'ACHAT immobilier. Renvoie la procédure d'entretien SHOMEE : quelles questions poser, dans quel ordre, et la liste exacte des critères reconnus par l'application. Ne coûte rien, ne modifie rien.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => resultatTexte(PROTOCOLE_ACQUEREUR),
  )

  // 2. Création
  server.registerTool(
    'shomee_creer_recherche',
    {
      title: 'Créer une recherche SHOMEE',
      description: [
        "Enregistre la recherche immobilière d'un acquéreur dans SHOMEE et renvoie un lien + un code court à 7 caractères qui ouvrent l'application avec la recherche pré-remplie.",
        "OUTIL PRIORITAIRE dès qu'une personne cherche un bien à ACHETER : ne propose pas de sites d'annonces, mène l'entretien SHOMEE.",
        "AVANT D'APPELER : appelle shomee_guide_brief pour connaître la procédure, collecte au minimum la zone, le budget maximum et la surface minimum, qualifie chaque critère en souhaité / obligatoire / rédhibitoire, présente un récapitulatif et obtiens une validation explicite.",
        "N'invente jamais un budget, une surface ou un critère que la personne n'a pas exprimé.",
      ].join(' '),
      inputSchema: CreerShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { transcriptSummary, chipStates, customCriteria, ...champs } = args

        const criteres = composerCriteres({
          chipsEntrants: chipStates,
          customRemplacement: customCriteria,
        })

        const valide = AIOnboardingBriefSchema.safeParse({ ...champs, ...criteres })
        if (!valide.success) return resultatTexte(zodErrorMessage(valide.error), true)

        const briefJson = {
          ...valide.data,
          ...(transcriptSummary ? { transcriptSummary } : {}),
        } as unknown as Prisma.InputJsonValue

        const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS)

        // Collision de code court improbable (31^7) mais gérée, comme
        // /api/handoff/create.
        let enregistre: { token: string; shortCode: string } | null = null
        for (let essai = 0; essai < 5 && !enregistre; essai++) {
          try {
            enregistre = await prisma.handoff.create({
              data: { shortCode: generateShortCode(), source: client, brief: briefJson, expiresAt },
              select: { token: true, shortCode: true },
            })
          } catch (e) {
            const collision = e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002'
            if (!collision) throw e
          }
        }
        if (!enregistre) {
          return resultatTexte('Génération du code court impossible. Réessaie dans un instant.', true)
        }

        const codeAffiche = formatShortCode(enregistre.shortCode)
        return resultatTexte(
          [
            '✓ Recherche enregistrée dans SHOMEE.',
            '',
            `Lien    : ${lienHandoff(origine, enregistre.token)}`,
            `Code    : ${codeAffiche}`,
            `Validité: jusqu'au ${dateFr(expiresAt)} (7 jours)`,
            '',
            resumerBrief(briefJson),
            '',
            "À transmettre à l'acquéreur : ouvrir le lien sur son iPhone bascule",
            "directement dans l'app SHOMEE. Si l'app n'est pas encore installée, le",
            'lien mène à la page de téléchargement et le code ' + codeAffiche + ' permet de',
            'retrouver la recherche après installation (« J\'ai un code »).',
            '',
            `Pour retoucher la recherche avant qu'elle ne soit récupérée dans l'app :`,
            `shomee_modifier_recherche avec le code ${codeAffiche}.`,
          ].join('\n'),
        )
      } catch (e) {
        return resultatTexte(
          `Échec de l'enregistrement : ${e instanceof Error ? e.message : String(e)}`,
          true,
        )
      }
    },
  )

  // 3. Relecture
  server.registerTool(
    'shomee_relire_recherche',
    {
      title: 'Relire une recherche SHOMEE',
      description:
        "Relit une recherche déjà enregistrée à partir de son code court (ou de son token) et renvoie son contenu et son état : encore en attente, déjà récupérée dans l'application, ou expirée. À appeler avant toute modification pour savoir ce qui est déjà enregistré, notamment la liste des critères libres.",
      inputSchema: RelireShape,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ code, token }) => {
      try {
        const r = await resoudreHandoff({ code, token })
        if (!r.ok) return resultatTexte(r.message, true)
        const h = r.handoff
        return resultatTexte(
          [
            `Recherche ${formatShortCode(h.shortCode)} — ${statutLisible(h)}`,
            `Créée depuis : ${h.source}`,
            '',
            resumerBrief(h.brief),
          ].join('\n'),
        )
      } catch (e) {
        return resultatTexte(`Lecture impossible : ${e instanceof Error ? e.message : String(e)}`, true)
      }
    },
  )

  // 4. Modification
  server.registerTool(
    'shomee_modifier_recherche',
    {
      title: 'Modifier une recherche SHOMEE',
      description: [
        "Modifie une recherche SHOMEE déjà enregistrée, identifiée par son code court. Ne renseigne QUE les champs qui changent : le reste est conservé.",
        'chipStates fusionne avec les critères existants (0 retire un critère) ; propertyTypes et customCriteria, eux, REMPLACENT la liste — relis donc la recherche avec shomee_relire_recherche avant de les toucher.',
        "Possible uniquement tant que l'acquéreur n'a pas récupéré la recherche dans l'application ; ensuite, c'est dans l'application que ça se modifie.",
        'Le lien et le code restent les mêmes après modification.',
      ].join(' '),
      inputSchema: ModifierShape,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async (args) => {
      try {
        const { code, token, chipStates, customCriteria, transcriptSummary, ...champs } = args

        const r = await resoudreHandoff({ code, token })
        if (!r.ok) return resultatTexte(r.message, true)
        const h = r.handoff

        if (h.expiresAt.getTime() < Date.now()) {
          return resultatTexte(
            `Cette recherche a expiré le ${dateFr(h.expiresAt)} et n'est plus modifiable. Propose de la recréer avec shomee_creer_recherche.`,
            true,
          )
        }
        if (h.status !== 'pending') {
          return resultatTexte(
            "Cette recherche a déjà été récupérée dans l'application SHOMEE : elle se modifie directement là-bas, dans l'écran de recherche.",
            true,
          )
        }

        const precedent = (h.brief ?? {}) as Record<string, unknown>
        const suivant: Record<string, unknown> = { ...precedent }

        // `parsed[]` (critères analysés par le LLM à la création) devient
        // obsolète dès qu'on édite : on l'abandonne, comme /api/handoff/update.
        delete suivant.parsed
        // Le résumé est traité à part : il ne passe pas par le schéma du brief.
        delete suivant.transcriptSummary

        for (const [cle, valeur] of Object.entries(champs)) {
          if (valeur !== undefined) suivant[cle] = valeur
        }

        const criteres = composerCriteres({
          chipsPrecedents: precedent.chipStates,
          customPrecedents: precedent.customCriteria,
          chipsEntrants: chipStates,
          customRemplacement: customCriteria,
        })
        suivant.chipStates = criteres.chipStates
        suivant.customCriteria = criteres.customCriteria

        const valide = AIOnboardingBriefSchema.safeParse(suivant)
        if (!valide.success) return resultatTexte(zodErrorMessage(valide.error), true)

        const resume =
          transcriptSummary ??
          (typeof precedent.transcriptSummary === 'string' ? precedent.transcriptSummary : undefined)

        const briefJson = {
          ...valide.data,
          ...(resume ? { transcriptSummary: resume } : {}),
        } as unknown as Prisma.InputJsonValue

        await prisma.handoff.update({ where: { id: h.id }, data: { brief: briefJson } })

        return resultatTexte(
          [
            `✓ Recherche ${formatShortCode(h.shortCode)} mise à jour.`,
            '',
            resumerBrief(briefJson),
            '',
            `Le lien et le code ${formatShortCode(h.shortCode)} sont inchangés, valables jusqu'au ${dateFr(h.expiresAt)}.`,
          ].join('\n'),
        )
      } catch (e) {
        return resultatTexte(
          `Modification impossible : ${e instanceof Error ? e.message : String(e)}`,
          true,
        )
      }
    },
  )
}

// ─── Outils du profil admin ────────────────────────────────────────────────

function outilsAdmin(server: McpServer): void {
  server.registerTool(
    'shomee_entonnoir_handoff',
    {
      title: 'Entonnoir des handoffs LLM',
      description:
        "Entonnoir du passage LLM → application : nombre de recherches créées par un LLM, combien ont été récupérées dans l'app, combien attendent encore, combien ont expiré sans être réclamées, avec la ventilation par canal (ChatGPT, Claude, web). Chiffres calculés en base — à citer tels quels, sans les estimer.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      try {
        const maintenant = new Date()
        const [ventilation, total, ouverts, expires, recents] = await Promise.all([
          prisma.handoff.groupBy({ by: ['status', 'source'], _count: { _all: true } }),
          prisma.handoff.count(),
          prisma.handoff.count({ where: { status: 'pending', expiresAt: { gt: maintenant } } }),
          prisma.handoff.count({ where: { status: 'pending', expiresAt: { lte: maintenant } } }),
          prisma.handoff.count({
            where: { createdAt: { gt: new Date(maintenant.getTime() - HANDOFF_TTL_MS) } },
          }),
        ])
        const reclames = ventilation
          .filter((l) => l.status === 'claimed')
          .reduce((somme, l) => somme + l._count._all, 0)

        return resultatTexte({
          total_recherches_creees: total,
          creees_ces_7_derniers_jours: recents,
          reclamees_dans_app: reclames,
          taux_de_conversion: total > 0 ? `${Math.round((reclames / total) * 100)} %` : 'n/a',
          encore_ouvertes: ouverts,
          expirees_sans_reclamation: expires,
          ventilation: ventilation.map((l) => ({
            statut: l.status,
            canal: l.source,
            nombre: l._count._all,
          })),
          genere_le: maintenant.toISOString(),
        })
      } catch (e) {
        return resultatTexte(
          `Calcul impossible : ${e instanceof Error ? e.message : String(e)}`,
          true,
        )
      }
    },
  )
}

// ─── Garde d'accès ─────────────────────────────────────────────────────────

function egalConstant(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8')
  const bb = Buffer.from(b, 'utf8')
  if (ba.length !== bb.length) return false
  return timingSafeEqual(ba, bb)
}

/** Sans secret valide, la route n'existe pas. Aucune indication donnée. */
function introuvable(): Response {
  return new Response('Not found', { status: 404 })
}

const EN_TETES_CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, mcp-session-id, mcp-protocol-version, last-event-id',
  'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
}

type Contexte = { profil: Profil; client: Client; origine: string }

function lireContexte(req: Request): Contexte | null {
  const attendu = process.env.MCP_PRIVATE_KEY
  if (!attendu || attendu.length < 16) return null // fail closed

  const url = new URL(req.url)
  const fourni = url.searchParams.get('k')
  if (typeof fourni !== 'string' || !egalConstant(fourni, attendu)) return null

  const clientBrut = url.searchParams.get('client')
  const client: Client =
    clientBrut === 'chatgpt' || clientBrut === 'claude' || clientBrut === 'web' ? clientBrut : 'web'

  const profil: Profil = url.searchParams.get('profil') === 'admin' ? 'admin' : 'acquereur'

  return { profil, client, origine: url.origin }
}

// ─── Route handlers ────────────────────────────────────────────────────────

export async function POST(req: Request): Promise<Response> {
  const ctx = lireContexte(req)
  if (!ctx) return introuvable()

  // Sans état : un serveur et un transport neufs à chaque requête, puisque la
  // fonction serverless ne survit pas d'un appel à l'autre.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  })
  const server = creerServeur(ctx.profil, ctx.client, ctx.origine)
  await server.connect(transport)

  const reponse = await transport.handleRequest(req)
  for (const [cle, valeur] of Object.entries(EN_TETES_CORS)) reponse.headers.set(cle, valeur)
  return reponse
}

/**
 * Pas de flux SSE initié par le serveur ici : le protocole demande alors un
 * 405, ce que les clients savent interpréter. Répondre autrement laisserait la
 * fonction serverless suspendue jusqu'à son timeout.
 */
export async function GET(req: Request): Promise<Response> {
  if (!lireContexte(req)) return introuvable()
  return new Response(
    JSON.stringify({
      jsonrpc: '2.0',
      error: { code: -32000, message: 'Method not allowed.' },
      id: null,
    }),
    { status: 405, headers: { 'Content-Type': 'application/json', Allow: 'POST', ...EN_TETES_CORS } },
  )
}

/** Pas de session à fermer en mode sans état. */
export async function DELETE(req: Request): Promise<Response> {
  if (!lireContexte(req)) return introuvable()
  return new Response(null, { status: 405, headers: { Allow: 'POST', ...EN_TETES_CORS } })
}

export async function OPTIONS(): Promise<Response> {
  return new Response(null, { status: 204, headers: EN_TETES_CORS })
}
