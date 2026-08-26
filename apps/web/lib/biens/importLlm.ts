/**
 * Création d'une annonce à partir d'une description libre analysée par un LLM.
 *
 * Ce fichier était le corps de la route POST /api/biens/import-llm. Il en a été
 * sorti quand le connecteur MCP a eu besoin de créer des annonces lui aussi :
 * dupliquer un mapping de 24 champs, c'était s'assurer que les deux chemins
 * divergent au premier champ ajouté. Une seule définition, deux appelants —
 * la route HTTP (clé Bearer) et l'outil `shomee_creer_annonce` du connecteur.
 */
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { DEFAULT_FALLBACK_IMAGE } from '@shomee/core/constants'
import {
  PropertyStatus,
  MandatType,
  DpeRating,
  TagSource,
  type Agent,
  type Agency,
} from '@prisma/client'

// ─── Validation ────────────────────────────────────────────────────────────

const DpeSchema = z.enum(['A', 'B', 'C', 'D', 'E', 'F', 'G'])

export const ImportLLMSchema = z.object({
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

export type ImportPayload = z.infer<typeof ImportLLMSchema>

/** L'agent tel qu'il faut le passer ici : son agence sert au quota. */
export type AgentAvecAgence = Agent & { agency: Agency }

// 15 champs clés qui servent à calculer le taux de complétion.
const COMPLETION_FIELDS: Array<keyof ImportPayload> = [
  'adresse', 'prix', 'surface', 'nb_pieces', 'nb_chambres', 'type_bien',
  'description', 'quartier', 'etage', 'annee_construction', 'caracteristiques',
  'specificites', 'composition', 'dpe', 'taxe_fonciere',
]

// Clé du payload → clé du modèle Property (l'éditeur lit les noms côté Property).
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

function isFilled(payload: ImportPayload, field: keyof ImportPayload): boolean {
  const v = payload[field]
  if (v === undefined || v === null) return false
  if (typeof v === 'string')  return v.trim().length > 0
  if (typeof v === 'number')  return v > 0 || field === 'etage' || field === 'annee_construction'
  if (Array.isArray(v))       return v.length > 0
  if (typeof v === 'boolean') return true
  return true
}

function deriveLlmFilledFields(payload: ImportPayload): string[] {
  const seen = new Set<string>()
  for (const f of COMPLETION_FIELDS) {
    if (!isFilled(payload, f)) continue
    const key = PAYLOAD_TO_PROPERTY_KEY[f]
    if (key) seen.add(key)
  }
  if (payload.ges)             seen.add('ges')
  if (payload.charges_copro)   seen.add('monthlyCharges')
  if (payload.mandat_type)     seen.add('mandatType')
  if (payload.ref_interne)     seen.add('refInterneAgence')
  return Array.from(seen)
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

// ─── Quota ─────────────────────────────────────────────────────────────────

export type Quota = { ok: true } | { ok: false; current: number; max: number }

/** Biens actifs = tout sauf les archivés. */
export async function verifierQuota(agent: AgentAvecAgence): Promise<Quota> {
  const current = await prisma.property.count({
    where: { createdByAgentId: agent.id, statut: { not: PropertyStatus.ARCHIVED } },
  })
  return current >= agent.agency.maxProperties
    ? { ok: false, current, max: agent.agency.maxProperties }
    : { ok: true }
}

// ─── Création ──────────────────────────────────────────────────────────────

export type BienCree = {
  id: string
  completionRate: number
  fieldsFilled: number
  fieldsTotal: number
}

/**
 * Crée le bien en BROUILLON. Il n'est jamais publié d'un coup : il manque
 * toujours la vidéo, qu'aucun LLM ne peut téléverser. L'agent termine dans le
 * back-office, d'où le lien renvoyé aux appelants.
 */
export async function creerBienDepuisLLM(
  agent: AgentAvecAgence,
  payload: ImportPayload,
): Promise<BienCree> {
  const fieldsFilled = COMPLETION_FIELDS.filter((f) => isFilled(payload, f)).length
  const fieldsTotal = COMPLETION_FIELDS.length
  const completionRate = +(fieldsFilled / fieldsTotal).toFixed(2)

  const created = await prisma.property.create({
    data: {
      // ── Champs requis, avec valeurs par défaut ──
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

      // ── Champs optionnels ──
      floor:             payload.etage,
      totalFloors:       payload.nb_etages_total,
      yearBuilt:         payload.annee_construction,
      monthlyCharges:    payload.charges_copro,
      propertyTax:       payload.taxe_fonciere,

      composition: payload.composition ?? undefined,

      features: payload.caracteristiques ?? [],
      gallery:  [],
      tags:     [],

      // ── Commercial ──
      mandatType:       (payload.mandat_type as MandatType | undefined) ?? MandatType.SIMPLE,
      avantPremiere:    payload.avant_premiere ?? false,
      refInterneAgence: payload.ref_interne,
      statut:           PropertyStatus.DRAFT,
      completionRate,
      llmFilledFields:  deriveLlmFilledFields(payload),

      // ── Provenance, champ par champ ──
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

      // ── Spécificités → PropertyTag (source AI_DOC) ──
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

  return { id: created.id, completionRate, fieldsFilled, fieldsTotal }
}
