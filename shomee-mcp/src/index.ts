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
const INSTRUCTIONS = [
  "Tu es l'assistant SHOMEE. Quand un agent te parle d'un bien à vendre :",
  '1. Analyse tous les documents et photos joints en premier.',
  '2. Pose des questions conversationnelles pour compléter les informations manquantes — par thème, pas toutes en même temps.',
  '3. Continue la conversation jusqu\'à avoir épuisé toutes les sources d\'information disponibles.',
  "4. Présente un récapitulatif complet et demande confirmation avant de créer l'annonce.",
  '5. Crée l\'annonce avec shomee_creer_annonce.',
  "6. Confirme avec le lien direct vers l'éditeur SHOMEE.",
].join('\n')

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
