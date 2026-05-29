import { NextResponse } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import {
  PropertyStatus,
  MandatType,
  DpeRating,
  TagSource,
  type Agent,
  type Agency,
  type AgentApiKey,
} from '@prisma/client'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ─── Validation ────────────────────────────────────────────────────────────

const DpeSchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G'])

const ImportLLMSchema = z.object({
  adresse:                   z.string().min(1, 'adresse est obligatoire'),
  location_source:           z.string().optional(),
  prix:                      z.number().int().nonnegative().optional(),
  prix_source:               z.string().optional(),
  surface:                   z.number().nonnegative().optional(),
  surface_source:            z.string().optional(),
  nb_pieces:                 z.number().int().nonnegative().optional(),
  nb_pieces_source:          z.string().optional(),
  nb_chambres:               z.number().int().nonnegative().optional(),
  nb_chambres_source:        z.string().optional(),
  type_bien:                 z.string().optional(),
  type_bien_source:          z.string().optional(),
  description:               z.string().optional(),
  description_source:        z.string().optional(),
  quartier:                  z.string().optional(),
  quartier_source:           z.string().optional(),
  etage:                     z.number().int().optional(),
  etage_source:              z.string().optional(),
  nb_etages_total:           z.number().int().positive().optional(),
  annee_construction:        z.number().int().optional(),
  annee_construction_source: z.string().optional(),
  caracteristiques:          z.array(z.string()).optional(),
  specificites:              z.array(z.string()).optional(),
  composition:               z.array(z.object({ label: z.string(), surface: z.number() })).optional(),
  composition_source:        z.string().optional(),
  mandat_type:               z.enum(['SIMPLE', 'EXCLUSIF']).optional(),
  mandat_type_source:        z.string().optional(),
  avant_premiere:            z.boolean().optional(),
  ref_interne:               z.string().optional(),
  ref_interne_source:        z.string().optional(),
  dpe:                       DpeSchema.optional(),
  dpe_source:                z.string().optional(),
  ges:                       DpeSchema.optional(),
  ges_source:                z.string().optional(),
  prix_fai:                  z.number().int().nonnegative().optional(),
  taxe_fonciere:             z.number().int().nonnegative().optional(),
  taxe_fonciere_source:      z.string().optional(),
  charges_copro:             z.number().int().nonnegative().optional(),
  charges_copro_source:      z.string().optional(),
})

type ImportPayload = z.infer<typeof ImportLLMSchema>

// 15 key fields used to compute completion rate
const COMPLETION_FIELDS: Array<keyof ImportPayload> = [
  'adresse', 'prix', 'surface', 'nb_pieces', 'nb_chambres', 'type_bien',
  'description', 'quartier', 'etage', 'annee_construction', 'caracteristiques',
  'specificites', 'composition', 'dpe', 'taxe_fonciere',
]

// Payload key → Property field key (the editor reads Property-side names).
const PAYLOAD_TO_PROPERTY_KEY: Partial<Record<keyof ImportPayload, string>> = {
  adresse:            'location',
  prix:               'price',
  surface:            'surface',
  nb_pieces:          'rooms',
  nb_chambres:        'bedrooms',
  type_bien:          'subtitle',
  description:        'description',
  quartier:           'district',
  etage:              'floor',
  annee_construction: 'yearBuilt',
  caracteristiques:   'features',
  specificites:       'tags',
  composition:        'composition',
  dpe:                'dpe',
  ges:                'ges',
  taxe_fonciere:      'propertyTax',
  charges_copro:      'monthlyCharges',
  mandat_type:        'mandatType',
  ref_interne:        'refInterneAgence',
}

function deriveLlmFilledFields(payload: ImportPayload): string[] {
  const seen = new Set<string>()
  for (const f of COMPLETION_FIELDS) {
    if (!isFilled(payload, f)) continue
    const key = PAYLOAD_TO_PROPERTY_KEY[f]
    if (key) seen.add(key)
  }
  // Extras not in COMPLETION_FIELDS but worth marking.
  if (payload.ges)             seen.add('ges')
  if (payload.charges_copro)   seen.add('monthlyCharges')
  if (payload.mandat_type)     seen.add('mandatType')
  if (payload.ref_interne)     seen.add('refInterneAgence')
  return Array.from(seen)
}

// ─── Helpers ───────────────────────────────────────────────────────────────

type AuthResult =
  | { ok: true;  apiKey: AgentApiKey; agent: Agent & { agency: Agency } }
  | { ok: false; status: 401; body: { error: string } }

async function authenticate(req: Request): Promise<AuthResult> {
  const header = req.headers.get('authorization') ?? req.headers.get('Authorization')
  if (!header || !header.toLowerCase().startsWith('bearer ')) {
    return { ok: false, status: 401, body: { error: 'Clé API invalide' } }
  }
  const key = header.slice(7).trim()
  if (!key) return { ok: false, status: 401, body: { error: 'Clé API invalide' } }

  const apiKey = await prisma.agentApiKey.findUnique({
    where: { key },
    include: { agent: { include: { agency: true } } },
  })
  if (!apiKey) return { ok: false, status: 401, body: { error: 'Clé API invalide' } }

  return { ok: true, apiKey, agent: apiKey.agent }
}

function isFilled(payload: ImportPayload, field: keyof ImportPayload): boolean {
  const v = payload[field]
  if (v === undefined || v === null) return false
  if (typeof v === 'string')  return v.trim().length > 0
  if (typeof v === 'number')  return v > 0 || field === 'etage' || field === 'annee_construction'
  if (Array.isArray(v))       return v.length > 0
  if (typeof v === 'boolean') return true
  return true
}

function deriveArrondissement(adresse: string, quartier?: string): string {
  const m = adresse.match(/\b75(\d{3})\b/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n >= 1 && n <= 20) return `PARIS ${n}${n === 1 ? 'er' : 'e'}`
  }
  return quartier ?? ''
}

function deriveTitle(adresse: string): string {
  const street = adresse.split(',')[0]?.trim()
  return street && street.length > 0 ? street : 'Nouvelle annonce'
}

const DEFAULT_FALLBACK_IMAGE =
  'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=800&h=1400&fit=crop&q=80'

// ─── POST ──────────────────────────────────────────────────────────────────

export async function POST(req: Request) {
  // 1. Auth
  const auth = await authenticate(req)
  if (!auth.ok) return NextResponse.json(auth.body, { status: auth.status })

  const { apiKey, agent } = auth

  // 2. Body parsing
  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    return NextResponse.json({ error: 'JSON invalide' }, { status: 400 })
  }

  const parsed = ImportLLMSchema.safeParse(raw)
  if (!parsed.success) {
    const issues = parsed.error.issues
    const missingAdresse = issues.some((i) => i.path[0] === 'adresse')
    if (missingAdresse) {
      return NextResponse.json(
        { error: 'adresse est obligatoire', details: issues },
        { status: 400 },
      )
    }
    return NextResponse.json({ error: 'Validation échouée', details: issues }, { status: 400 })
  }

  const payload = parsed.data
  console.log('[import-llm] payload reçu:', JSON.stringify(payload, null, 2))

  // 3. Quota check (active = non-ARCHIVED)
  const activeCount = await prisma.property.count({
    where: { createdByAgentId: agent.id, statut: { not: PropertyStatus.ARCHIVED } },
  })
  if (activeCount >= agent.agency.maxProperties) {
    return NextResponse.json(
      {
        error: 'Quota atteint',
        message: `Limite de ${agent.agency.maxProperties} biens actifs atteinte. Passez en Pro pour en ajouter davantage.`,
        current: activeCount,
        max: agent.agency.maxProperties,
      },
      { status: 403 },
    )
  }

  // 4. Completion rate
  const fieldsFilled = COMPLETION_FIELDS.filter((f) => isFilled(payload, f)).length
  const fieldsTotal  = COMPLETION_FIELDS.length
  const completionRate = +(fieldsFilled / fieldsTotal).toFixed(2)

  // 5. Map payload → Prisma Property
  try {
    const created = await prisma.property.create({
      data: {
        // ── Required scalars with defaults ──
        arrondissement: deriveArrondissement(payload.adresse, payload.quartier),
        subtitle:       payload.type_bien ?? '',
        agentName:      agent.name,
        agentAvatar:    agent.avatar,
        title:          deriveTitle(payload.adresse),
        price:          payload.prix_fai ?? payload.prix ?? 0,
        surface:        payload.surface ?? 0,
        rooms:          payload.nb_pieces ?? 0,
        bedrooms:       payload.nb_chambres,
        location:       payload.adresse,
        district:       payload.quartier ?? '',
        description:    payload.description ?? '',
        dpe:            (payload.dpe as DpeRating | undefined) ?? DpeRating.D,
        ges:            payload.ges as DpeRating | undefined,
        imageUrlFallback: DEFAULT_FALLBACK_IMAGE,

        // ── Optional scalars ──
        floor:             payload.etage,
        totalFloors:       payload.nb_etages_total,
        yearBuilt:         payload.annee_construction,
        monthlyCharges:    payload.charges_copro,
        propertyTax:       payload.taxe_fonciere,

        // ── Composition ──
        composition: payload.composition ?? undefined,

        // ── Arrays ──
        features: payload.caracteristiques ?? [],
        gallery:  [],
        tags:     [],

        // ── Sprint / commercial ──
        mandatType:       (payload.mandat_type as MandatType | undefined) ?? MandatType.SIMPLE,
        avantPremiere:    payload.avant_premiere ?? false,
        refInterneAgence: payload.ref_interne,
        statut:           PropertyStatus.DRAFT,
        completionRate,
        llmFilledFields:  deriveLlmFilledFields(payload),

        // ── Source markers (per field) ──
        locationSource:         payload.location_source,
        priceSource:            payload.prix_source,
        surfaceSource:          payload.surface_source,
        roomsSource:            payload.nb_pieces_source,
        bedroomsSource:         payload.nb_chambres_source,
        descriptionSource:      payload.description_source,
        floorSource:            payload.etage_source,
        yearBuiltSource:        payload.annee_construction_source,
        compositionSource:      payload.composition_source,
        mandatTypeSource:       payload.mandat_type_source,
        refInterneAgenceSource: payload.ref_interne_source,
        dpeSource:              payload.dpe_source,
        gesSource:              payload.ges_source,
        monthlyChargesSource:   payload.charges_copro_source,
        propertyTaxSource:      payload.taxe_fonciere_source,

        // ── Relations ──
        agencyId:         agent.agencyId,
        createdByAgentId: agent.id,

        // ── PropertyTag from specificites (source AI_DOC) ──
        propertyTags: payload.specificites && payload.specificites.length > 0
          ? {
              create: payload.specificites.map((label) => ({
                label,
                category:   'ambiance',
                source:     TagSource.AI_DOC,
                validated:  false,
                confidence: 0.8,
              })),
            }
          : undefined,
      },
      select: { id: true },
    })

    // 6. Touch lastUsed on the key
    await prisma.agentApiKey.update({
      where: { id: apiKey.id },
      data:  { lastUsed: new Date() },
    })

    const pct = Math.round(completionRate * 100)
    return NextResponse.json({
      success: true,
      bien_id: created.id,
      completion_rate: completionRate,
      fields_filled: fieldsFilled,
      fields_total: fieldsTotal,
      next_step_url: `/agent/biens/${created.id}/editer`,
      message: `Annonce créée à ${pct}%. Ouvrez l'app SHOMEE pour ajouter la vidéo et finaliser.`,
    })
  } catch (err) {
    console.error('[POST /api/biens/import-llm]', err)
    return NextResponse.json({ error: 'Erreur serveur' }, { status: 500 })
  }
}
