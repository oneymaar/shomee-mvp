#!/usr/bin/env node
/**
 * SHOMEE — MCP server
 *
 * Exposes 3 tools to an LLM (e.g. Claude Desktop):
 *   - shomee_creer_annonce: create a draft listing on SHOMEE
 *   - shomee_lister_biens : list the agent's listings
 *   - shomee_get_bien     : fetch a full listing by id
 *
 * Auth: a Bearer API key is read from process.env.SHOMEE_API_KEY and forwarded
 * to the SHOMEE Next.js API.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const SHOMEE_API_URL = process.env.SHOMEE_API_URL?.replace(/\/$/, '') ?? 'https://shomee-mvp.vercel.app'
const SHOMEE_API_KEY = process.env.SHOMEE_API_KEY

if (!SHOMEE_API_KEY) {
  console.error('[shomee-mcp] SHOMEE_API_KEY env var is required')
  process.exit(1)
}

// ─── Instructions exposed to the AI client ────────────────────────────────
const INSTRUCTIONS = `Tu es l'assistant SHOMEE, spécialisé dans la création d'annonces immobilières haut de gamme pour le marché parisien.

QUAND UN AGENT TE PARLE D'UN BIEN À VENDRE :

ÉTAPE 1 — ANALYSE DES DOCUMENTS
Si l'agent joint des documents (PDF, photos, plan, dossier de vente, mandat, estimation, diagnostics, PV d'AG), analyse-les immédiatement et en priorité avant toute question.

Porte une attention particulière au DDT (Dossier de Diagnostics Techniques) — c'est souvent le document le plus riche : il contient les surfaces détaillées de chaque pièce, le numéro ADEME du DPE, les étiquettes DPE et GES, l'année de construction. Ce document contient souvent des tableaux et des images — lis-les attentivement et extrais toutes les valeurs numériques. Si après une première lecture tu as des doutes sur des valeurs extraites d'un tableau ou d'une image dans le DDT, relis ce document spécifiquement avant de conclure que l'information est manquante.

Extrais silencieusement toutes les informations disponibles sans les commenter une par une.

ÉTAPE 2 — QUESTIONS PAR THÈME
Après l'analyse, identifie les informations manquantes et pose tes questions de façon conversationnelle, par thème, dans cet ordre de priorité :

1. GÉNÉRAL : adresse complète, quartier, type de bien (appartement/maison/loft/atelier), surface totale, nombre de pièces, nombre de chambres, étage, nombre d'étages total
2. CARACTÉRISTIQUES : ascenseur, cave, parking, balcon, terrasse, gardien, parquet, cheminée, double vitrage, digicode, jardin, piscine — propose une liste et demande de confirmer/compléter
3. SPÉCIFICITÉS : observations qualitatives fines — orientation du séjour, luminosité, absence de vis-à-vis, hauteur sous plafond, vue, calme, chambres sur cour, immeuble haussmannien, charmes de l'ancien...
4. COMPOSITION : liste des pièces avec surface de chacune (salon, cuisine, chambres, salle de bain, dressing, entrée...)
5. COPROPRIÉTÉ : type d'immeuble, année de construction, nombre de lots, charges mensuelles de copropriété, procédures en cours (oui/non)
6. ÉNERGIE : numéro ADEME, étiquette DPE (A à G), étiquette GES (A à G), type de chauffage, type d'eau chaude
7. FINANCES : prix FAI en euros, taxe foncière annuelle, frais d'agence TTC, frais à la charge de l'acquéreur ou du vendeur
8. TEXTE D'ANNONCE : rédige une description sobre et factuelle de 60 à 120 mots, ton haut de gamme parisien, sans superlatifs exagérés
9. MANDAT : type de mandat (simple ou exclusif), avant-première sur SHOMEE (oui/non), référence interne agence

RÈGLES POUR LES QUESTIONS :
- Pose maximum 3-4 questions à la fois, jamais toutes en même temps
- Si une information est dans les documents, ne la redemande JAMAIS
- Ne mentionne jamais "ambiance", "standing" ou toute section qui ne figure pas dans la liste ci-dessus
- Continue jusqu'à avoir épuisé toutes les informations raisonnablement disponibles

ÉTAPE 3 — RÉCAPITULATIF ET CONFIRMATION
Quand tu estimes avoir collecté un maximum d'informations, présente un récapitulatif structuré organisé selon les 9 thèmes ci-dessus :
- Ce que tu as collecté (avec les valeurs)
- Ce qui reste manquant (que l'agent pourra compléter dans l'app)
Demande confirmation : "Voulez-vous que je crée l'annonce avec ces informations ?"

ÉTAPE 4 — CRÉATION
Seulement après confirmation explicite de l'agent, appelle shomee_creer_annonce avec toutes les données collectées.

ÉTAPE 5 — CONFIRMATION FINALE
Après création, confirme brièvement :
- Taux de complétion atteint
- Lien direct vers l'éditeur SHOMEE
- Les 2-3 éléments prioritaires restants à compléter (vidéo en premier)

RÈGLES GÉNÉRALES :
- Ne jamais inventer une adresse, un DPE ou un GES
- Pour les spécificités, privilégie des observations objectives ("Pas de vis-à-vis", "Orienté sud", "Hauteur sous plafond > 3m") — pas de marketing exagéré
- Ne crée jamais l'annonce sans confirmation explicite de l'agent
- Réponds toujours en français

CITATIONS DE SOURCES
Pour chaque information extraite d'un document, inclus le champ source correspondant dans le JSON envoyé à shomee_creer_annonce :
- "surface_source": "DDT" si la surface vient du DDT
- "prix_source": "Mandat de vente" si le prix vient du mandat
- "dpe_source": "DDT" si le DPE vient du DDT
- "description_source": "Rédigé par l'assistant" si tu as rédigé la description
Les valeurs possibles sont : "DDT", "Mandat de vente", "Estimation", "PV d'AG", "Photos", "Brief oral", "Rédigé par l'assistant".
Ne crée jamais un champ _source sans son champ de données correspondant.`

const server = new McpServer(
  { name: 'shomee-mcp', version: '0.1.0' },
  {
    instructions: INSTRUCTIONS,
    capabilities: { tools: {} },
  },
)

// ─── Helpers ──────────────────────────────────────────────────────────────

async function shomeeFetch(path: string, init?: RequestInit) {
  const res = await fetch(`${SHOMEE_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${SHOMEE_API_KEY}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })
  const text = await res.text()
  let json: unknown
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }
  return { ok: res.ok, status: res.status, body: json }
}

function asTextResult(payload: unknown, isError = false) {
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

// ─── Tool 1: shomee_creer_annonce ─────────────────────────────────────────

const CreateShape = {
  adresse:            z.string().describe('Adresse postale complète, obligatoire (ex: "12 rue X, 75008 Paris")'),
  prix:               z.number().int().nonnegative().optional().describe('Prix de vente en euros (entier)'),
  surface:            z.number().nonnegative().optional().describe('Surface en m²'),
  nb_pieces:          z.number().int().nonnegative().optional(),
  nb_chambres:        z.number().int().nonnegative().optional(),
  type_bien:          z.string().optional().describe('Appartement | Maison | Loft | Atelier'),
  description:        z.string().optional(),
  quartier:           z.string().optional().describe('Nom du micro-quartier (ex: "Île Saint-Louis")'),
  etage:              z.number().int().optional(),
  nb_etages_total:    z.number().int().positive().optional(),
  annee_construction: z.number().int().optional(),
  caracteristiques:   z.array(z.string()).optional().describe('Tags simples (ex: ["Ascenseur","Cave","Parquet"])'),
  specificites:       z.array(z.string()).optional().describe('Observations qualitatives (ex: ["Pas de vis-à-vis","Lumineux"])'),
  composition:        z.array(z.object({ label: z.string(), surface: z.number() })).optional(),
  mandat_type:        z.enum(['SIMPLE', 'EXCLUSIF']).optional(),
  avant_premiere:     z.boolean().optional(),
  ref_interne:        z.string().optional(),
  dpe:                z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G']).optional(),
  ges:                z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G']).optional(),
  prix_fai:           z.number().int().nonnegative().optional(),
  taxe_fonciere:      z.number().int().nonnegative().optional(),
  charges_copro:      z.number().int().nonnegative().optional(),
}

server.tool(
  'shomee_creer_annonce',
  [
    'Crée une nouvelle annonce immobilière en brouillon sur SHOMEE.',
    "Appelle cet outil uniquement après avoir posé toutes les questions nécessaires à l'agent pour maximiser le taux de complétion.",
    "Avant d'appeler, présente un récapitulatif des informations collectées et des éléments manquants, et demande confirmation.",
  ].join(' '),
  CreateShape,
  async (args) => {
    const { ok, status, body } = await shomeeFetch('/api/biens/import-llm', {
      method: 'POST',
      body: JSON.stringify(args),
    })
    if (!ok) return asTextResult({ error: `HTTP ${status}`, response: body }, true)

    const data = body as {
      bien_id: string
      completion_rate: number
      fields_filled: number
      fields_total: number
      next_step_url: string
      message: string
    }
    const pct = Math.round(data.completion_rate * 100)
    const summary = [
      `✓ Annonce créée — ${data.message}`,
      ``,
      `bien_id        : ${data.bien_id}`,
      `complétion     : ${pct}% (${data.fields_filled}/${data.fields_total})`,
      `lien d'édition : ${SHOMEE_API_URL}${data.next_step_url}`,
    ].join('\n')
    return asTextResult(summary)
  },
)

// ─── Tool 2: shomee_lister_biens ──────────────────────────────────────────

server.tool(
  'shomee_lister_biens',
  "Liste tous les biens de l'agent connecté avec leur statut, taux de complétion et lien vers la vidéo.",
  {},
  async () => {
    const { ok, status, body } = await shomeeFetch('/api/agent/me/properties')
    if (!ok) return asTextResult({ error: `HTTP ${status}`, response: body }, true)
    return asTextResult(body)
  },
)

// ─── Tool 3: shomee_get_bien ──────────────────────────────────────────────

server.tool(
  'shomee_get_bien',
  "Récupère les détails complets d'un bien par son ID (toutes sections, tags IA et analyse vidéo inclus).",
  { bien_id: z.string().describe('ID Prisma du bien (cuid)') },
  async ({ bien_id }) => {
    const { ok, status, body } = await shomeeFetch(`/api/biens/${encodeURIComponent(bien_id)}`)
    if (!ok) return asTextResult({ error: `HTTP ${status}`, response: body }, true)
    return asTextResult(body)
  },
)

// ─── Start ────────────────────────────────────────────────────────────────

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  // stdio servers don't log to stdout; emit a tiny diagnostic to stderr.
  console.error(`[shomee-mcp] connected — API base ${SHOMEE_API_URL}`)
}

main().catch((err) => {
  console.error('[shomee-mcp] fatal:', err)
  process.exit(1)
})
